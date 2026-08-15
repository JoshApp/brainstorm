import * as THREE from 'three';
import { setMaterialSeamChromaWebGPU } from './banded-lighting-webgpu';
import { texture as tslTexture, vec2, vec3, positionWorld, normalWorld, positionView, normalView, faceDirection, float, uniform as tslUniform, mix as tslMix, smoothstep as tslSmoothstep, clamp as tslClamp, materialColor, cameraPosition } from 'three/tsl';

import { DEV } from '../debug/dev';

// ── POM TUNING ───────────────────────────────────────────────────────────────
// Read ONCE at module load, not per material: the step count is unrolled into
// the node graph, so it is part of the shader's STRUCTURE. Reading it per
// install would fork a pipeline per value — the exact churn the tile/tint
// uniforms below exist to avoid.
//
// ?pom=0 disables, ?pom=<n> sets the step count (DEV only; the flag is stripped
// from production, the default is not).
const POM_DEFAULT_STEPS = 8;
const POM_DEPTH_M = 0.055;        // apparent depth of the height field, metres
const POM_STEPS: number = (() => {
  // DEV from debug/dev.ts, NOT a bare `import.meta.env.DEV`. This runs at
  // MODULE LOAD, and under the tsx test runner `import.meta.env` is undefined,
  // so reading `.DEV` off it throws before any test body runs. That took out 34
  // test files on the first attempt — the guard exists in dev.ts for exactly
  // this and its comment says so.
  if (!DEV || typeof window === 'undefined') return POM_DEFAULT_STEPS;
  const v = new URLSearchParams(window.location.search).get('pom');
  if (v == null) return POM_DEFAULT_STEPS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(24, n)) : POM_DEFAULT_STEPS;
})();

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cheap hash value noise — replaces mx_noise_float for the subtle world-mottle and
// seep-flow layers. mx_noise_float is 3D gradient noise (8 corner gradients + interp,
// the heaviest single thing in the surface shader); these layers only need a smooth
// [0,1] blob, so a 4-corner bilinear value noise looks identical at a fraction of the
// ALU. Same world frequency, so the look is unchanged.
function hash21(p: any): any {
  return (p.x.mul(127.1).add(p.y.mul(311.7))).sin().mul(43758.5453).fract();
}
function valueNoise2(p: any): any {
  const i: any = p.floor();
  const f: any = p.fract();
  const u: any = f.mul(f).mul(f.mul(-2.0).add(3.0));            // smoothstep weights
  const a = hash21(i), b = hash21(i.add((vec2 as any)(1, 0)));
  const c = hash21(i.add((vec2 as any)(0, 1))), d = hash21(i.add((vec2 as any)(1, 1)));
  return (tslMix as any)((tslMix as any)(a, b, u.x), (tslMix as any)(c, d, u.x), u.y); // → [0,1]
}
// WebGPU surface shading: triplanar-sample the baked texture in world space and
// modulate the base albedo by its shade channel × tint, via a colorNode (a
// supported migration slot on standard materials under WebGPURenderer).
function installSurfaceDetailWebGPU(mat: THREE.MeshStandardMaterial, cfg: SurfaceTexConfig): void {
  // WORLD-PROJECTED UVs (matches the GLSL, not generic triplanar — which rotated
  // the bricks 90° on differently-facing walls). For a WALL the vertical texture
  // axis is ALWAYS world-Y, and the horizontal axis is whichever world axis the
  // wall faces along (Z for an ±X-facing wall, X for a ±Z-facing wall). For HORIZ
  // (floor/ceiling) it's the world XZ plane. Anisotropic tile is respected.
  const pos: any = positionWorld;
  const nrm: any = normalWorld;
  // Meter-space projected coords (sU,sV); uv divides by the tile to get repeats.
  let sU: any, sV: any;
  if (cfg.proj === 'wall') {
    sU = (nrm.x.abs().greaterThan(nrm.z.abs()) as any).select(pos.z, pos.x);
    sV = pos.y;
  } else {
    sU = pos.x; sV = pos.z;
  }
  // Tile / tint / seam-scale ride PER-MATERIAL UNIFORMS, not baked literals: a
  // `cfg.tile[0]` divisor or `vec3(cfg.tint)` inlined into the WGSL forks a fresh
  // shader per config value (the `nodeVar0 / 1.5` vs `/ 4.8` churn the forensics
  // caught after the colour fix). As uniforms the generated code is invariant
  // across configs → configs sharing the same STRUCTURE (proj + flags) collapse
  // onto one pipeline. Only the structural flag branches below stay distinct
  // (bounded + warmable). See surface-ao.ts for the same lesson on base colour.
  const uTile: any = (tslUniform as any)(new THREE.Vector2(cfg.tile[0], cfg.tile[1]));
  const uv: any = (vec2 as any)(sU.div(uTile.x), sV.div(uTile.y));

  // ── PARALLAX OCCLUSION MAPPING ─────────────────────────────────────────────
  // Josh: *"arent there ways to have more texture in the shader ... there must
  // be good shader written games out there we can borrow techniques."* This is
  // the one worth borrowing. Everything above only ever perturbed the NORMAL
  // from the height field — which fakes lighting but never moves anything, so a
  // mortar line stays painted onto a flat plane and slides with the wall as you
  // pass. POM marches the view ray through the height field and returns the UV
  // where it first hits, so recesses actually displace: crevices you can look
  // INTO, and blocks that shift against each other with parallax as you move.
  //
  // POM is normally the wrong call on mobile. It is the right call HERE for a
  // measured reason: this game is CPU-encode / draw-call bound, and the GPU has
  // headroom (see the 2026-07-03 perf triage). Per-pixel ALU is precisely the
  // budget we have spare. It also needs a height map, and we have been baking
  // one all along and spending it only on a normal perturbation.
  //
  // The usual expensive part — building a tangent basis — is FREE here, because
  // these UVs are world-axis projected (see above): the U and V axes ARE world
  // axes, so the view ray's tangent-space components are just its world
  // components. No TBN, no per-vertex tangents.
  //
  // Linear search, no binary refinement. At this step count and depth the
  // stepping artefacts land below the PS1 render scale, and the second pass
  // would double the sample count for something the 0.4x buffer throws away.
  let pomUV: any = uv;
  if (POM_STEPS > 0 && cfg.relief > 0) {
    const viewW: any = (cameraPosition as any).sub(pos).normalize();   // surface → eye
    // Tangential components along the SAME world axes the UVs are projected on.
    let tU: any, tV: any;
    if (cfg.proj === 'wall') {
      tU = (nrm.x.abs().greaterThan(nrm.z.abs()) as any).select(viewW.z, viewW.x);
      tV = viewW.y;
    } else {
      tU = viewW.x; tV = viewW.z;
    }
    // Component along the surface normal. Clamped away from zero: at grazing
    // incidence the true offset tends to infinity and the march smears into
    // long streaks, the classic POM failure. The clamp trades a little depth at
    // glancing angles for never breaking — and glancing is exactly where these
    // walls are seen most (see the surface-lab notes on raking light).
    const tN: any = (tslClamp as any)(viewW.dot(nrm).abs(), 0.35, 1.0);
    const uPer: any = tU.div(tN).mul(POM_DEPTH_M).div(uTile.x);
    const vPer: any = tV.div(tN).mul(POM_DEPTH_M).div(uTile.y);
    const stepUV: any = (vec2 as any)(uPer, vPer).mul(-1 / POM_STEPS);
    const stepD: any = float(1 / POM_STEPS);

    let curUV: any = uv;
    let curD: any = float(0);
    let hitUV: any = uv;
    let done: any = float(0);
    for (let i = 0; i < POM_STEPS; i++) {
      // Height channel is 1 = face, lower = recessed, so depth below the face
      // is (1 - h). We have hit the surface once the ray is deeper than it.
      const surfD: any = float(1).sub((tslTexture as any)(cfg.tex, curUV).a);
      const hit: any = (curD.greaterThanEqual(surfD) as any).select(float(1), float(0));
      const fresh: any = hit.mul(float(1).sub(done));      // keep the FIRST hit only
      hitUV = (tslMix as any)(hitUV, curUV, fresh);
      done = (tslClamp as any)(done.add(hit), 0, 1);
      curUV = curUV.add(stepUV);
      curD = curD.add(stepD);
    }
    pomUV = hitUV;
  }

  const sampled: any = (tslTexture as any)(cfg.tex, pomUV);
  // UNIFORM-backed base colour (materialColor), NOT vec3(mat.color.*): a vec3(...)
  // literal bakes the wall/floor tint into the WGSL, forking a fresh shader per
  // distinct shell colour (per-floor pipeline churn). materialColor reads the
  // colour from a per-material uniform → identical WGSL across tints → one shared
  // pipeline. See the note in surface-ao.ts installPropHeightAOWebGPU.
  const base: any = materialColor;
  const tint: any = (tslUniform as any)(new THREE.Vector3(cfg.tint[0], cfg.tint[1], cfg.tint[2]));
  let albedo: any = base.mul(sampled.rgb).mul(tint);

  // ── WEAR LAYERS (surface v3) ───────────────────────────────────────────────
  // Josh: *"it all looks so uniform so perfect so bland ... i would like it to
  // be greasy rough worn."*
  //
  // What was here: ONE octave of value noise at ~3m modulating shade by ±6%.
  // Six percent, at a single scale, is below the threshold where an eye reads
  // "this surface has a history" — so the tile's own per-cell variation was the
  // only thing happening, and a tile repeating every ~5m with nothing on top of
  // it is the definition of uniform.
  //
  // Worn stone varies at SEVERAL scales at once, and the scales mean different
  // things: metres-wide staining and damp (where the room has been used),
  // hand-sized blotching (where the stone itself differs), and fine grain. Three
  // octaves, weighted toward the largest, with roughly four times the old range.
  const macro: any = valueNoise2((vec2 as any)(sU.mul(0.055), sV.mul(0.055)));  // ~18m patches
  const meso: any = valueNoise2((vec2 as any)(sU.mul(0.33), sV.mul(0.33)));     // ~3m (the old layer)
  const micro: any = valueNoise2((vec2 as any)(sU.mul(1.9), sV.mul(1.9)));      // ~0.5m grain
  const grime: any = macro.mul(0.55).add(meso.mul(0.30)).add(micro.mul(0.15));  // → [0,1]
  albedo = albedo.mul(float(0.78).add(grime.mul(0.40)));

  // CAVITY GRIME — dirt does not sit evenly, it collects. Everything low in the
  // height field (mortar lines, chips, the pits between flagstones) gets darker
  // and browner than the faces around it, and more so where the macro layer says
  // this part of the room is filthy. The existing seam shadow darkens grooves
  // for DEPTH; this is the same geometry read as ACCUMULATION.
  const cavity: any = float(1).sub((tslSmoothstep as any)(0.42, 0.95, sampled.a));
  albedo = albedo.mul((tslMix as any)(
    float(1.0), float(0.62), cavity.mul(float(0.45).add(macro.mul(0.55))),
  ));

  // GRAVITY STREAKS — walls only. Every layer above this one is isotropic, and
  // isotropic noise is a tell: real filth has a DIRECTION, because water and
  // soot run down. Sampling the noise with the vertical axis compressed ~12x
  // stretches its features into long vertical smears — damp runs and soot
  // trails under ledges — for the cost of one more noise lookup. Floors are
  // skipped: nothing runs down a floor.
  if (cfg.proj === 'wall') {
    const wp: any = positionWorld;
    const streak: any = valueNoise2((vec2 as any)(
      wp.x.add(wp.z).mul(1.15),   // across the wall, whichever axis it runs along
      wp.y.mul(0.095),            // and barely at all down it → vertical runs
    ));
    const runs: any = (tslSmoothstep as any)(0.54, 0.98, streak);
    albedo = albedo.mul((tslMix as any)(float(1.0), float(0.70), runs.mul(0.8)));
  }

  // Seam mask — strong in the low (recessed) grooves, used by both seep + wetness.
  const seam: any = float(1).sub((tslSmoothstep as any)(0.45, 0.85, sampled.a));

  // SEEP — the "liquid in the cracks" glow, walls only (grooveFill). Pools in the
  // seams, flows slowly with time, blended toward the floor's seep tint by
  // per-floor strength. Approximation of the GLSL groove-flow layer.
  if (cfg.grooveFill) {
    const flowPos = (vec2 as any)((positionWorld as any).x.mul(2.6), (positionWorld as any).z.mul(2.6).sub(seepTimeNode.mul(0.26)));
    const flow = valueNoise2(flowPos);                                           // → [0,1]
    const seepAmt = (tslClamp as any)(seam.mul(seepStrengthNode).mul(flow), 0, 1);
    albedo = (tslMix as any)(albedo, seepTintNode, seepAmt);
  }

  // ── SEAM SHADOW + GLOW (opt-in; scaled by relief so flat patches are spared) ──
  const reliefScale = Math.min(1, cfg.relief / 0.30);
  // Per-material uniform, not a baked literal — see the tile/tint note above.
  const uScale: any = (tslUniform as any)(reliefScale * (cfg.seamGlowScale ?? 1));
  // (a) SHADOW only — darken the recessed seams/panels for depth. Safe on broad
  // recesses (ceiling coffer panels) where a plain shadow reads as relief, not a
  // weird colour blotch. So this is the contrast knob for the ceiling too.
  if (cfg.seamShadow || cfg.seamGlow) {
    albedo = albedo.mul((tslMix as any)(float(1.0), float(SEAM_DARK), seam.mul(uScale)));
  }
  // (b)+(c) COLOURED GLOW — thin-crack surfaces ONLY (brick walls + flagstone
  // floors). Lift the deep channel toward bone-pale (matte hue pickup) and over-
  // saturate its LIT colour toward the light's hue (subtle, the skeleton trick).
  if (cfg.seamGlow) {
    const core: any = float(1).sub((tslSmoothstep as any)(0.28, 0.52, sampled.a)).mul(uScale);
    albedo = (tslMix as any)(albedo, (vec3 as any)(PALE_BONE[0], PALE_BONE[1], PALE_BONE[2]), core.mul(CORE_GLOW));
    setMaterialSeamChromaWebGPU(mat, float(1.0).add(core.mul(SEAM_CHROMA)));
  }

  // WETNESS (per-floor strength ONLY) — wet floors darken + gloss the seams; the
  // DEFAULT dry look stays fully MATTE (roughness drops only where wetnessNode > 0).
  const wetMask = (tslClamp as any)(seam.mul(wetnessNode), 0, 1);
  albedo = albedo.mul((tslMix as any)(float(1.0), float(0.6), wetMask));          // wet = darker

  // ── SPATIALLY VARYING ROUGHNESS (surface v3) ───────────────────────────────
  // THE "greasy" lever, and the one that was missing entirely: roughnessNode
  // used to be a CONSTANT everywhere except the wet-seam mix, and wetness
  // defaults to 0 — so every square metre of stone in the game returned light
  // in exactly the same way. Uniform response is what reads as "perfect", more
  // than uniform colour does; it's the same reason untextured plastic looks
  // like plastic.
  //
  // Worn stone varies its roughness MORE than its colour, and not randomly:
  //   GREASE  broad patches, handled and sooted, worn to a dull shine. Comes
  //           off the macro layer so it agrees with where the staining is.
  //   CAVITY  crevices hold dust and grit — rougher than the faces.
  //   PROUD   high points are polished by contact — smoother, and the first
  //           thing to catch a moving flame.
  // The payoff is that a single torch no longer lands evenly: it finds the
  // greasy patches and the worn edges and skips the dusty hollows, and that
  // changes as the player moves. Pure ALU on a surface already being shaded —
  // no extra draws, which is the budget that actually matters here.
  const grease: any = (tslSmoothstep as any)(0.58, 0.96, macro);
  const proud: any = (tslSmoothstep as any)(0.80, 1.05, sampled.a);
  const baseRough: any = (tslUniform as any)(mat.roughness);
  const varied: any = (tslClamp as any)(
    baseRough.add(cavity.mul(0.12)).sub(proud.mul(0.14)).sub(grease.mul(0.26)),
    0.22, 1.0,
  );
  (mat as any).roughnessNode = (tslMix as any)(varied, float(SEAM_ROUGH), wetMask);

  // colorNode replaces only the albedo input — the standard PBR lighting,
  // roughness, emissive, etc. still apply on top.
  (mat as any).colorNode = albedo;

  // RELIEF — perturb the view normal from the height channel so the bricks +
  // crevices catch torchlight in 3D. This is perturbNormalArb (Mikkelsen) exactly
  // as the GLSL did it (dFdx/dFdy of the sampled height in view space). NOTE: the
  // built-in `bumpMap()` node CAN'T be used here — it re-samples a TEXTURE node at
  // UV offsets to get the gradient, but our height is an already-sampled `.a`
  // swizzle, so bumpMap's offset re-sample is a no-op → zero relief → flat walls.
  // Hand-rolling with the real screen-space derivative of `sampled.a` fixes it.
  // RELIEF_BOOST: the GLSL's relief (cfg.relief ~0.30) read flat under TSL — the
  // perturbation lands ~an order of magnitude smaller here (mip/anisotropy damps
  // the sampled-height gradient more under the node renderer). 8x was still only
  // "slight", so 20x. This drives BOTH the brick bevels AND the crevice/groove
  // light-catch (the groove walls tilt into/out of the torchlight). Tune to taste.
  const RELIEF_BOOST = 26;
  const h: any = sampled.a;
  const dH: any = (vec2 as any)(h.dFdx(), h.dFdy()).mul((tslUniform as any)(cfg.relief * RELIEF_BOOST));
  const sp: any = positionView;
  const sx: any = sp.dFdx().normalize();
  const sy: any = sp.dFdy().normalize();
  const N: any = normalView;
  const R1: any = sy.cross(N);
  const R2: any = N.cross(sx);
  const fDet: any = sx.dot(R1).mul(faceDirection);
  const vGrad: any = fDet.sign().mul(dH.x.mul(R1).add(dH.y.mul(R2)));
  (mat as any).normalNode = fDet.abs().mul(N).sub(vGrad).normalize();
  // (Banded cel lighting is applied GLOBALLY at boot — installBandedLightingWebGPU
  // patches the node material's lighting model — so props/creatures band too, not
  // just these surfaces.)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Surface detail for the big stone surfaces — now driven by BAKED, MIPMAPPED
// tiling textures (see surface-textures.ts) rather than a per-pixel procedural
// pattern. The scene renders at 0.4x resolution, so the old per-pixel mortar
// lines were undersampled and crawled/flickered under motion; sampling a
// mipmapped + anisotropic texture lets the GPU resolve them per-pixel (the
// proper fix), and the relief reads off the mip-filtered height channel so it
// auto-settles at distance/grazing instead of buzzing. That made the old
// grazing-fade and footprint-fade hacks unnecessary — gone.
//
// World-PROJECTED UVs (axis picked by the surface normal): no UV authoring on
// the geometry, and it works on the tilted/arched ceilings too. RepeatWrapping
// tiles it; the hardware computes mip LOD from the UV derivatives, seamlessly.

export interface SurfaceTexConfig {
  tex: THREE.Texture;
  tile: readonly [number, number];     // world metres per repeat
  proj: 'wall' | 'horiz';              // wall = vertical plane, horiz = floor/ceiling
  tint: readonly [number, number, number];
  relief: number;                      // normal-perturbation strength
  /** WORLD-SPACE brick damage (rough masonry walls only): sparse
   *  missing bricks + uneven coursework, hashed on the WORLD brick id
   *  so it never repeats with the baked tile's 4-brick period. Keep
   *  OFF for dressed stone (clean frames) and non-brick surfaces. */
  brickDamage?: boolean;
  /** VEINY CREVICE GLOW (WebGPU): the thin mortar/gap seams drink light in
   *  their shoulders and glow the light's hue in their channel. ONLY for
   *  surfaces whose seams are genuine THIN cracks — brick walls + flagstone
   *  floors. MUST stay off for broad-recess surfaces (ceiling coffer panels,
   *  clean ashlar joints, base trims) where "low height" is a large area, not a
   *  crack, so the glow reads as out-of-context blotches. Opt-in. */
  seamGlow?: boolean;
  /** Seam SHADOW only — darken the recessed seams/panels for depth + contrast,
   *  WITHOUT the coloured glow/chroma. Safe on broad recesses (ceiling panels)
   *  where the glow would look weird but a plain shadow just reads as relief. */
  seamShadow?: boolean;
  /** Per-surface multiplier on the seam shadow+glow strength (default 1). The
   *  floor reads hotter than walls (warm tint + lit straight-on + wider gaps), so
   *  it runs lower. */
  seamGlowScale?: number;
  /** Sample the gameplay SPLAT MAP (scene/splat-map.ts): blood and
   *  spills stain, darken and wet this surface where events stamped.
   *  Floors only — ceilings share the 'horiz' projection but should
   *  not catch blood. */
  splat?: boolean;
  /** Groove fill + seep (the liquid-light layer). ONLY for surfaces
   *  whose height channel carries a real seam network (the brick
   *  walls). Near-flat heights (grain pillars ≈ 0.5 everywhere) read
   *  as all-seam to the mask and the WHOLE surface fills — the
   *  round-pillar bug. */
  grooveFill?: boolean;
}

const uDetailStrength = { value: 1 };   // 0 = off, 1 = on (live toggle)

// VEINY CREVICE GLOW tuning (WebGPU surface shader, installSurfaceDetailWebGPU).
// NOT a wet specular shine — a PALE MATTE diffuse pickup, like the skeleton: the
// deep seam channel reads as bone-pale, so it brightly + matte-ly takes on the
// HUE of whatever light reaches it and glows with it in the dark. The seam
// SHOULDERS stay darker (crevice shadow → contrast). Scaled by relief so flat
// columns are spared. Wetness gloss is now per-floor ONLY (no default wet look).
const SEAM_DARK = 0.66;    // seam-shoulder albedo floor (the crevice shadow)
const PALE_BONE: readonly [number, number, number] = [0.88, 0.86, 0.82];  // near-neutral pale the channel lifts toward (picks up light hue cleanly)
const CORE_GLOW = 0.06;    // how far the DEEPEST seam lifts toward PALE_BONE — KEEP TINY: the pale lift brightens the mortar to bright-yellow outlines and breaks the grimdark dark. Crevices should mostly DRINK light (shadow), not glow.
const SEAM_CHROMA = 0.25;  // VIVID: over-saturate the seam's LIT colour toward the light's hue — subtle, past this it reads as stark yellow rings
const SEAM_ROUGH = 0.22;   // roughness in WET seams only (per-floor wetness) — no dry gloss

// ── SEEP — liquid light in the grooves ───────────────────────────────
// The groove-glow made deliberate-then-LIQUID: a slow descending flow
// of emissive beads inside the mortar network, GATED by the direct
// light the fragment receives — torches spill it, darkness dries it.
// Tint + strength set per floor by the builder (dominant room mood:
// blood floors bleed, green floors ooze ichor). Walls only.
const uSeepTint = { value: new THREE.Vector3(0.8, 0.1, 0.08) };
const uSeepStrength = { value: 0 };      // 0 = off; builder enables per floor
const uSeepTime = { value: 0 };
// WebGPU mirrors of the seep uniforms (the GLSL path uses the {value} objects
// above; the TSL colorNode reads these uniform nodes). Kept in sync below.
const seepTintNode = (tslUniform as any)(new THREE.Vector3(0.8, 0.1, 0.08));
const seepStrengthNode = (tslUniform as any)(0);
const seepTimeNode = (tslUniform as any)(0);

export function setSurfaceSeep(colorHex: number, strength: number): void {
  uSeepTint.value.set(
    ((colorHex >> 16) & 255) / 255,
    ((colorHex >> 8) & 255) / 255,
    (colorHex & 255) / 255,
  );
  uSeepStrength.value = strength;
  seepTintNode.value.copy(uSeepTint.value);
  seepStrengthNode.value = strength;
}

export function tickSurfaceSeep(timeSec: number): void {
  uSeepTime.value = timeSec;
  seepTimeNode.value = timeSec;
}

// ── WETNESS — the crevices pick up light for real ────────────────────
// The liquid read that matters is SPECULAR, not emissive: wet seams
// are darker and far glossier than dry stone, so every torch (and the
// player's lamp) strikes real view-dependent glints that run along
// the mortar network and slide as you move. The light does the work;
// the colour comes from the lights themselves. Per-floor strength
// (mood floors run wet); the future splat map (kills, altar overflow)
// will feed the same uniform per-fragment.
const uWetness = { value: 0 };
const wetnessNode = (tslUniform as any)(0);   // WebGPU mirror (TSL roughnessNode reads it)

export function setSurfaceWetness(strength: number): void {
  uWetness.value = strength;
  wetnessNode.value = strength;
}

export function setSurfaceDetailEnabled(on: boolean): void {
  uDetailStrength.value = on ? 1 : 0;
}
export function getSurfaceDetailEnabled(): boolean { return uDetailStrength.value > 0; }

// Config kept out of material.userData on purpose: Material.clone() JSON-copies
// userData and would choke on the Texture ref. A WeakMap lets the arched-ceiling
// clone re-install from its base (see reinstallSurfaceDetail).
const cfgMap = new WeakMap<THREE.Material, SurfaceTexConfig>();

// Named configs (registered at material-build time) so the ModelSpec material
// compiler (build-model.ts) can opt a material into a detail by NAME — e.g. a
// 'dressed' archway, a 'grain' column — without importing the baked textures.
const namedConfigs = new Map<string, SurfaceTexConfig>();
export function registerSurfaceDetail(name: string, cfg: SurfaceTexConfig): void {
  namedConfigs.set(name, cfg);
}
export function installNamedSurfaceDetail(material: THREE.Material, name: string): void {
  const cfg = namedConfigs.get(name);
  if (cfg) installSurfaceDetail(material, cfg);
}

export function installSurfaceDetail(material: THREE.Material, cfg: SurfaceTexConfig): void {
  cfgMap.set(material, cfg);
  // WEBGPU: set a colorNode that triplanar-samples the (CPU-baked) surface
  // texture in WORLD space (matching the GLSL's world-projected UVs) and
  // modulates the base albedo by the shade channel × tint. First cut: albedo
  // pattern only — relief (height→normal), seep, wetness, and splat are
  // deferred. See WEBGPU-MIGRATION.
  installSurfaceDetailWebGPU(material as THREE.MeshStandardMaterial, cfg);
}

// Re-install onto a clone (the arched-ceiling material clones the base ceiling
// material; clone() carries the node graph but reinstalling re-registers its
// config). Pass the BASE material whose config is registered.
export function reinstallSurfaceDetail(clone: THREE.Material, base: THREE.Material): void {
  const cfg = cfgMap.get(base);
  if (!cfg) return;
  installSurfaceDetail(clone, cfg);
}
