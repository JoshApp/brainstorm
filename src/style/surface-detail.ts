import * as THREE from 'three';
import { setMaterialSeamChromaWebGPU } from './banded-lighting-webgpu';
import { texture as tslTexture, vec2, vec3, positionWorld, normalWorld, float, uniform as tslUniform, mix as tslMix, smoothstep as tslSmoothstep, clamp as tslClamp, materialColor, cameraPosition, cameraViewMatrix } from 'three/tsl';

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
// Apparent depth of the height field. Josh: *"cant we make the bricks even more
// 3d."* This is the dial for that — it is how far the ray marches, so it sets
// how deep a mortar line or a missing flagstone actually goes. Raised 0.055 →
// 0.10 now that missing stones and spalled faces punch real holes in the height
// map; at the old depth those holes were being marched through in one step and
// read as flat dark patches. ?pomdepth= to experiment.
const POM_DEPTH_DEFAULT = 0.10;

// ── STYLE DIALS ──────────────────────────────────────────────────────────────
// Josh: *"fuck the rules we have written lets invent this games art style."*
// These are the knobs worth pushing to find a look, exposed as DEV URL params
// so a style can be tried in a reload instead of an edit:
//   ?stonehue=0..2    how far apart different stones' colours sit
//   ?stonewear=0..1   how much stones differ in roughness
//   ?pomdepth=0..0.3  how deep the stone goes
//   ?pom=0..24        march steps (0 = off)
const urlNum = (key: string, dflt: number, lo: number, hi: number): number => {
  if (!DEV || typeof window === 'undefined') return dflt;
  const v = new URLSearchParams(window.location.search).get(key);
  if (v == null) return dflt;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const STONE_HUE_SPREAD = urlNum('stonehue', 0.85, 0, 2);
const STONE_WEAR_SPREAD = urlNum('stonewear', 0.30, 0, 1);
const POM_DEPTH_M = urlNum('pomdepth', POM_DEPTH_DEFAULT, 0, 0.3);
const MOSS_AMOUNT = urlNum('moss', 0.75, 0, 2);
// Metres over which POM depth fades to nothing. Beyond this the mip chain has
// flattened the height field anyway, so marching it only buys artefacts.
const POM_FADE_NEAR = 3.5;
const POM_FADE_FAR = 7.0;
// Relief amplitude in METRES of apparent height per unit of the height channel.
// A real quantity, unlike the RELIEF_BOOST=26 fudge it replaces — the gradient
// below is now a true slope, so this scales something meaningful. First value
// (0.06) came out visibly flatter than the old screen-space path: that path was
// over-driving relief at close range, which was part of what read as harsh.
// ?relief= to dial.
// 0.25 is Josh's setting after dialling it live: *"even the untextured looks
// better at higher relief, i think it looks flatter at relief 0, i settled on
// like 0.25."*
const RELIEF_METRES = urlNum('relief', 0.25, 0, 0.6);
// Hex-tiling strength. 0 = plain tiling (one sample), 1 = full stochastic
// blend. ?hex=0 to A/B the repeat back.
const HEX_MIX = urlNum('hex', 1, 0, 1);
// How hard the hex weights are sharpened. This is the technique's central
// trade and it has no free setting:
//   HIGH  one sample dominates → contrast preserved, but cell borders become
//         thin visible seams (the faint diagonal Xs across the wall)
//   LOW   wide smooth blend → seams vanish, but three overlapping stones
//         average toward grey mud and the stonework loses its punch
// ?hexsharp= to find where it should sit.
const HEX_SHARP = urlNum('hexsharp', 5, 1, 16);
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
// ── STOCHASTIC HEX TILING ────────────────────────────────────────────────────
// Heitz & Neyret's technique, in Morten Mikkelsen's cheaper adaptation — the
// standard answer to "the eye finds the repeat".
//
// Our tile repeats every couple of metres across every wall in the game, and
// once the stones stopped being identical to each other that repeat became the
// loudest remaining artefact: you see the same block, with the same chip in the
// same corner, marching along the wall.
//
// How it works: lay a virtual TRIANGULAR grid over the surface. Every point
// falls inside one triangle, so it has three corners and three barycentric
// weights. Each corner hashes to its own random OFFSET into the texture. Sample
// the texture three times at those three offsets and blend by the weights —
// the pattern is now shuffled differently in every cell, and the cells blend
// smoothly into each other, so nothing repeats and nothing seams.
//
// Mikkelsen's contribution is what makes it affordable: the original preserved
// the texture's histogram through an expensive transform, because naively
// averaging three samples washes out contrast (three random stones averaged
// look like grey mud). Instead we SHARPEN the weights — raise them to a power
// and renormalise — so one sample dominates almost everywhere and the blend
// only happens in a narrow band near cell borders. Contrast survives, at the
// cost of three taps instead of one.
function hexSample(tex: THREE.Texture, uv: any, period: readonly [number, number]): any {
  if (HEX_MIX <= 0) return (tslTexture as any)(tex, uv);
  // Skew into a simplex/triangular grid. 3.464 = 2*sqrt(3) sets the cell size
  // relative to one texture repeat — roughly one hex per tile, so the shuffle
  // happens at the same scale as the repeat it is hiding.
  const su: any = uv.mul(3.464);
  const sx: any = su.x.sub(su.y.mul(0.57735027));
  const sy: any = su.y.mul(1.15470054);
  const bx: any = sx.floor(), by: any = sy.floor();
  const fx: any = sx.fract(), fy: any = sy.fract();
  const fz: any = float(1).sub(fx).sub(fy);
  // Which half of the rhombus are we in — the lower-left or upper-right triangle.
  const s: any = (fz.lessThan(0) as any).select(float(1), float(0));
  const s2: any = s.mul(2).sub(1);
  let w1: any = fz.mul(s2).negate();
  let w2: any = s.sub(fy.mul(s2));
  let w3: any = s.sub(fx.mul(s2));
  // The three cell ids.
  const v1: any = (vec2 as any)(bx.add(s), by.add(s));
  const v2: any = (vec2 as any)(bx.add(s), by.add(float(1).sub(s)));
  const v3: any = (vec2 as any)(bx.add(float(1).sub(s)), by.add(s));
  // CONTRAST-PRESERVING WEIGHTS (the Mikkelsen part): sharpen so one sample
  // dominates except in a thin blend band.
  w1 = w1.max(0).pow(HEX_SHARP); w2 = w2.max(0).pow(HEX_SHARP); w3 = w3.max(0).pow(HEX_SHARP);
  const wsum: any = w1.add(w2).add(w3).max(1e-5);
  w1 = w1.div(wsum); w2 = w2.div(wsum); w3 = w3.div(wsum);
  // ── OFFSETS QUANTISED TO THE PATTERN'S OWN PERIOD ──────────────────────────
  // The first version used a free random offset, and it produced visible
  // diagonal criss-cross breaks across the wall. That is not a bug in the
  // implementation — it is what hex tiling DOES to a structured texture.
  //
  // The technique was designed for stochastic material (rock, dirt, bark),
  // where shifting the pattern by any amount is invisible because there is no
  // alignment to break. Masonry is the opposite: it is a GRID. Shift one hex
  // cell by an arbitrary amount and its courses no longer line up with its
  // neighbour's, so every cell boundary becomes a visible jog in the brickwork.
  //
  // Fix: snap the offset to whole multiples of the pattern's own period. The
  // wall bake lays 4 bricks x 8 courses per tile, so offsets of k/4 and k/8
  // land brick-on-brick — the courses stay continuous across cell boundaries
  // while the STONES still shuffle, which is the repetition we actually wanted
  // to kill. Structure preserved, repeat broken.
  const per: readonly [number, number] = period;
  const snap = (h: any, n: number): any => h.mul(n).floor().div(n);
  const off = (v: any): any => (vec2 as any)(
    snap(hash21(v), per[0]),
    snap(hash21(v.add((vec2 as any)(37.1, 17.7))), per[1]),
  );
  const t1: any = (tslTexture as any)(tex, uv.add(off(v1)));
  const t2: any = (tslTexture as any)(tex, uv.add(off(v2)));
  const t3: any = (tslTexture as any)(tex, uv.add(off(v3)));
  const blended: any = t1.mul(w1).add(t2.mul(w2)).add(t3.mul(w3));
  // HEX_MIX lets it be dialled back toward plain tiling for an A/B.
  return HEX_MIX >= 1 ? blended : (tslMix as any)((tslTexture as any)(tex, uv), blended, float(HEX_MIX));
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
  // The pattern's own period WITHIN one tile — what hex offsets snap to. The
  // wall bake lays 4 bricks x 8 courses; the flagstone Voronoi has period 5.
  const hexPeriod: readonly [number, number] =
    cfg.hexPeriod ?? (cfg.proj === 'wall' ? [4, 8] : [5, 5]);

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
    const tN: any = (tslClamp as any)(viewW.dot(nrm).abs(), 0.45, 1.0);
    // DISTANCE FADE. Past a few metres the mip chain has already averaged the
    // height field flat, so the march is stepping through mush — it produces
    // artefacts rather than depth, and pays full price for them. Fade the depth
    // out and the far wall simply goes back to being a normal-mapped surface,
    // which at that distance is indistinguishable anyway.
    const dist: any = (cameraPosition as any).sub(pos).length();
    const fade: any = float(1).sub((tslSmoothstep as any)(POM_FADE_NEAR, POM_FADE_FAR, dist));
    const depthN: any = float(POM_DEPTH_M).mul(fade);
    const uPer: any = tU.div(tN).mul(depthN).div(uTile.x);
    const vPer: any = tV.div(tN).mul(depthN).div(uTile.y);
    const stepUV: any = (vec2 as any)(uPer, vPer).mul(-1 / POM_STEPS);
    const stepD: any = float(1 / POM_STEPS);

    let curUV: any = uv;
    let curD: any = float(0);
    let hitUV: any = uv, prevUV: any = uv;
    let hitSurf: any = float(0), hitRay: any = float(0);
    let prevSurf: any = float(1), prevRay: any = float(0);
    let done: any = float(0);
    let lastUV: any = uv, lastSurf: any = float(1), lastRay: any = float(0);
    for (let i = 0; i < POM_STEPS; i++) {
      // Height channel is 1 = face, lower = recessed, so depth below the face
      // is (1 - h). We have hit the surface once the ray is deeper than it.
      const surfD: any = float(1).sub(hexSample(cfg.tex, curUV, hexPeriod).a);
      const hit: any = (curD.greaterThanEqual(surfD) as any).select(float(1), float(0));
      const fresh: any = hit.mul(float(1).sub(done));      // keep the FIRST hit only
      hitUV = (tslMix as any)(hitUV, curUV, fresh);
      hitSurf = (tslMix as any)(hitSurf, surfD, fresh);
      hitRay = (tslMix as any)(hitRay, curD, fresh);
      // ...and the sample just BEFORE it, which is what the interpolation needs.
      prevUV = (tslMix as any)(prevUV, lastUV, fresh);
      prevSurf = (tslMix as any)(prevSurf, lastSurf, fresh);
      prevRay = (tslMix as any)(prevRay, lastRay, fresh);
      done = (tslClamp as any)(done.add(hit), 0, 1);
      lastUV = curUV; lastSurf = surfD; lastRay = curD;
      curUV = curUV.add(stepUV);
      curD = curD.add(stepD);
    }
    // ── THE INTERPOLATION STEP, which I left out and Josh caught ──────────────
    // *"the pom is doing artifacts i confirmed."* Correct. A linear march alone
    // is STEEP PARALLAX, not parallax OCCLUSION — it snaps the hit to whichever
    // discrete step first went under the surface, so every recess edge lands on
    // a step boundary and the whole wall stairsteps. The occlusion part is
    // exactly this: solve for where the ray and the height field actually cross
    // BETWEEN the last two samples. One lerp, no extra texture reads, and it is
    // the difference between visible banding and none.
    const after: any = hitSurf.sub(hitRay);            // <= 0 at the hit
    const before: any = prevSurf.sub(prevRay);         // >  0 before it
    const denom: any = before.sub(after);
    const w: any = (tslClamp as any)(before.div(denom.add(1e-5)), 0, 1);
    pomUV = (tslMix as any)(hitUV, prevUV, w);
    // Rays that never hit keep the flat UV rather than the last marched one.
    pomUV = (tslMix as any)(uv, pomUV, done);
  }

  const sampled: any = hexSample(cfg.tex, pomUV, hexPeriod);
  // UNIFORM-backed base colour (materialColor), NOT vec3(mat.color.*): a vec3(...)
  // literal bakes the wall/floor tint into the WGSL, forking a fresh shader per
  // distinct shell colour (per-floor pipeline churn). materialColor reads the
  // colour from a per-material uniform → identical WGSL across tints → one shared
  // pipeline. See the note in surface-ao.ts installPropHeightAOWebGPU.
  const base: any = materialColor;
  const tint: any = (tslUniform as any)(new THREE.Vector3(cfg.tint[0], cfg.tint[1], cfg.tint[2]));
  // TWO TEXTURE LAYOUTS, and the shader has to know which it got.
  //
  // PACKED (the CPU bake): R = shade, G = variant, B = wear, A = height. Shade
  // is a greyscale multiplier over the material's own near-black colour, and
  // G/B carry per-stone identity — so it must be read as `.r` BROADCAST, never
  // `.rgb`, or the identity channels arrive as a colour cast.
  //
  // COLOUR (an AI-generated map): RGB is the finished colour of the stone and
  // A is a height derived from luminance. It must NOT be multiplied by the
  // material's base colour — that base is near-black by design (0x1a1714), so
  // multiplying would crush a perfectly good texture to nothing. It also has no
  // identity channels, so variant/wear go neutral and the per-stone colour and
  // roughness spread simply stop contributing — the texture is expected to
  // carry that variation itself, which is the whole point of the experiment.
  const isColorTex = cfg.colorTex === true;
  const variant: any = isColorTex ? float(0.5) : sampled.g;
  const wear: any = isColorTex ? float(0.5) : sampled.b;
  let albedo: any = isColorTex
    ? (sampled.rgb as any).mul(tint)
    : base.mul((vec3 as any)(sampled.r, sampled.r, sampled.r)).mul(tint);

  // ── PER-STONE COLOUR ───────────────────────────────────────────────────────
  // Josh: *"cant we kinda give the floor a different coloring."*
  //
  // Until now every stone in a wall or floor was THE SAME SUBSTANCE at a
  // different brightness — the generators varied `tone`, a scalar, and nothing
  // else. No amount of lighting work can turn that into a mosaic, because a
  // mosaic is made of different ROCKS, not one rock at different exposures.
  //
  // VARIANT is a per-cell constant, so each block picks a point on a three-way
  // ramp and holds it across its whole face: ochre sandstone, cold slate,
  // green-grey serpentine. The spread is deliberately wide enough to see — this
  // is the knob to push if the floor still reads as one material.
  const STONE_A: any = (vec3 as any)(1.14, 0.99, 0.80);   // warm ochre
  const STONE_B: any = (vec3 as any)(0.84, 0.94, 1.14);   // cold slate
  const STONE_C: any = (vec3 as any)(0.90, 1.06, 0.88);   // green-grey
  const lowHalf: any = (tslSmoothstep as any)(0.0, 0.5, variant);
  const hiHalf: any = (tslSmoothstep as any)(0.5, 1.0, variant);
  const stoneHue: any = (tslMix as any)((tslMix as any)(STONE_A, STONE_B, lowHalf), STONE_C, hiHalf);
  albedo = albedo.mul((tslMix as any)((vec3 as any)(1, 1, 1), stoneHue, float(STONE_HUE_SPREAD)));

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
  // ── DON'T DOUBLE UP ON A COLOUR MAP ────────────────────────────────────────
  // Josh: *"i think there are things infering with it."* Correct. These wear
  // layers were written to rescue a CLEAN procedural tile — but a generated map
  // arrives with its own grime, its own moss, its own stains already painted in.
  // Running the full stack on top applies filth to filth: contrast piles up,
  // the image goes muddy, and the high-frequency result aliases into exactly
  // the sparkle in the screenshots.
  //
  // So on a colour map the procedural layers back off to a light touch. They
  // still earn their place — they are WORLD-space and non-tiling, so they break
  // the repeat that the texture itself cannot — but they stop competing with
  // detail that is already there.
  const wearMix = isColorTex ? 0.35 : 1.0;
  albedo = albedo.mul(float(1 - 0.22 * wearMix).add(grime.mul(0.40 * wearMix)));

  // CAVITY GRIME — dirt does not sit evenly, it collects. Everything low in the
  // height field (mortar lines, chips, the pits between flagstones) gets darker
  // and browner than the faces around it, and more so where the macro layer says
  // this part of the room is filthy. The existing seam shadow darkens grooves
  // for DEPTH; this is the same geometry read as ACCUMULATION.
  const cavity: any = float(1).sub((tslSmoothstep as any)(0.42, 0.95, sampled.a));
  albedo = albedo.mul((tslMix as any)(
    float(1.0), float(0.62), cavity.mul(float(0.45).add(macro.mul(0.55))).mul(wearMix),
  ));

  // ── MOSS / LICHEN ──────────────────────────────────────────────────────────
  // Josh: *"i need more things its still bland, there must be other things we
  // can do like moss on the walls etc."*
  //
  // Every layer so far modulates STONE. Moss is the first thing that is not
  // stone — a second material living on top of it — and that is why it does
  // more for "bland" than another octave of grime would. It also carries the
  // only green in the palette, against a room lit amber, so it reads instantly.
  //
  // It is placed by the same logic that places real moss, which is what keeps
  // it from looking like green noise:
  //   LOW      it needs damp, and damp collects near the floor. Strongest in
  //            the bottom ~1.6m of a wall, gone by head height.
  //   SHELTER  it takes hold in the crevices and pits first, where water sits
  //            and nothing scrubs it off — so it keys off the SAME cavity term
  //            the dirt uses, which makes filth and growth agree.
  //   PATCHY   colonies, not a coat. A separate low-frequency field decides
  //            where a colony took, and a high-frequency one gives it a fuzzy,
  //            eaten edge instead of a painted outline.
  // It also goes ROUGH — moss is the least reflective thing in the room, so it
  // kills the grazing sheen exactly where it grows and breaks up the highlight.
  let mossMask: any = float(0);
  if (MOSS_AMOUNT > 0) {
    const colony: any = valueNoise2((vec2 as any)(sU.mul(0.19), sV.mul(0.19)));
    const fuzz: any = valueNoise2((vec2 as any)(sU.mul(2.6), sV.mul(2.6)));
    const damp: any = cfg.proj === 'wall'
      ? float(1).sub((tslSmoothstep as any)(0.35, 1.75, (positionWorld as any).y))
      : float(0.55);                       // floors are damp all over, less strongly
    const took: any = (tslSmoothstep as any)(0.52, 0.88, colony.mul(0.75).add(fuzz.mul(0.25)));
    mossMask = (tslClamp as any)(
      took.mul(damp).mul(float(0.45).add(cavity.mul(0.75))).mul(MOSS_AMOUNT * (isColorTex ? 0.4 : 1)), 0, 1,
    );
    // Two greens: the wet dark of a thick colony, and the pale grey-green of
    // lichen at its dying edge. Mixing by the fuzz field means a patch is
    // darker in its middle, which is what stops it reading as a flat decal.
    const MOSS_DEEP: any = (vec3 as any)(0.16, 0.30, 0.14);
    const MOSS_EDGE: any = (vec3 as any)(0.42, 0.48, 0.33);
    const mossCol: any = (tslMix as any)(MOSS_DEEP, MOSS_EDGE, fuzz);
    albedo = (tslMix as any)(albedo, albedo.mul(0.35).add(mossCol.mul(0.65)), mossMask);
  }

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
    albedo = albedo.mul((tslMix as any)(float(1.0), float(0.70), runs.mul(0.8 * wearMix)));
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
  // PER-STONE WEAR rides on top: some blocks are simply rougher rock than their
  // neighbours, and a spalled face or a bare-earth pit is rougher still (the
  // generators fold that into the wear channel). Centred on 0.5 so it pushes
  // both ways rather than only adding.
  const stoneWear: any = wear.sub(0.5).mul(STONE_WEAR_SPREAD);
  const varied: any = (tslClamp as any)(
    baseRough.add(cavity.mul(0.12)).sub(proud.mul(0.14)).sub(grease.mul(0.26)).add(stoneWear)
      // Moss is the least reflective thing in the room. Pushing it toward fully
      // matte kills the grazing sheen exactly where it grows, so the highlight
      // breaks around the colonies instead of sliding over them.
      .add(mossMask.mul(0.45)),
    0.18, 1.0,
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
  // ── NORMAL FROM HEIGHT, IN TEXTURE SPACE ───────────────────────────────────
  // Josh: *"is there a way to make like heightmaps or whatever from this? so it
  // can fake like depth in the texture that plays with the light without being
  // a performance nightmare?"*
  //
  // That is exactly what this is, and it has been running all along — but the
  // way it was derived is also part of why the wall *"pixelates quite hard"*.
  //
  // The old path took dFdx/dFdy of the sampled height: SCREEN-SPACE derivatives.
  // Those measure "how much did height change between this pixel and the one
  // next to it on screen", so the bump strength depends on how many screen
  // pixels a texel happens to cover — it changes with distance, with viewing
  // angle, and with the 0.4x PS1 buffer, and it is computed per 2x2 quad so it
  // is blocky by construction. The `RELIEF_BOOST = 26` that used to sit here is
  // the tell: the magnitude was arbitrary, so someone multiplied until it
  // looked right at one distance.
  //
  // Sampling the height at ±1 TEXEL instead measures the actual slope of the
  // stone, in metres per metre. It does not care how far away the wall is or
  // how it is angled, it is stable while you move, and the strength becomes a
  // real quantity instead of a fudge factor. Costs four texture reads on a
  // surface already sampling that texture — which is the cheap half of "plays
  // with light": this is what makes torchlight rake across the stone, while POM
  // (the expensive half) is only what makes it displace.
  const texW: number = Number((cfg.tex.image as { width?: number } | undefined)?.width) || 512;
  const texel: number = 1 / texW;
  const hAt = (du: number, dv: number): any =>
    hexSample(cfg.tex, pomUV.add((vec2 as any)(du * texel, dv * texel)), hexPeriod).a;
  // Central differences → slope of the height field along U and V, converted
  // from texel-space to metres using the tile size.
  const dU: any = hAt(1, 0).sub(hAt(-1, 0)).mul(0.5 * texW).div(uTile.x);
  const dV: any = hAt(0, 1).sub(hAt(0, -1)).mul(0.5 * texW).div(uTile.y);
  const amp: any = (tslUniform as any)(cfg.relief * RELIEF_METRES);
  // The tangent frame is FREE again for the same reason POM's was: these UVs
  // are projected on world axes, so U and V *are* world axes.
  let uAxisW: any, vAxisW: any;
  if (cfg.proj === 'wall') {
    uAxisW = (nrm.x.abs().greaterThan(nrm.z.abs()) as any)
      .select((vec3 as any)(0, 0, 1), (vec3 as any)(1, 0, 0));
    vAxisW = (vec3 as any)(0, 1, 0);
  } else {
    uAxisW = (vec3 as any)(1, 0, 0);
    vAxisW = (vec3 as any)(0, 0, 1);
  }
  const nWorld: any = nrm
    .sub(uAxisW.mul(dU.mul(amp)))
    .sub(vAxisW.mul(dV.mul(amp)))
    .normalize();
  // normalNode wants a VIEW-space normal; the frame above is world.
  (mat as any).normalNode = (cameraViewMatrix as any).transformDirection(nWorld);
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
  /** TRUE when `tex` is a COLOUR map (RGB = finished stone colour, A = height),
   *  as generated by scripts/gen-surface-tex.ts. FALSE/omitted for the CPU bake,
   *  whose RGB carries [shade, variant, wear] instead. This changes how the
   *  shader reads every channel — see the note at the top of the WebGPU install. */
  colorTex?: boolean;
  /** The pattern's own period WITHIN one tile, used to snap hex-tiling offsets
   *  so a structured texture's grid stays aligned across cells. Defaults to the
   *  CPU bake's periods (wall = 4 bricks x 8 courses, floor = 5x5 flagstones).
   *  A generated map needs its own value — see the note in hexSample. */
  hexPeriod?: readonly [number, number];
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
