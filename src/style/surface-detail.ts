import * as THREE from 'three';
import { setMaterialSeamChromaWebGPU } from './banded-lighting-webgpu';
import { texture as tslTexture, vec2, vec3, positionWorld, normalWorld, float, uniform as tslUniform, mix as tslMix, smoothstep as tslSmoothstep, clamp as tslClamp, max as tslMax, materialColor, cameraPosition, cameraViewMatrix } from 'three/tsl';

import { tuneUniform, tuneNumber, onKnobChange } from '../debug/tuning';

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
// Metres over which POM depth fades to nothing. Beyond this the mip chain has
// flattened the height field anyway, so marching it only buys artefacts.
const POM_FADE_NEAR = 3.5;
const POM_FADE_FAR = 7.0;

// ── STYLE DIALS ──────────────────────────────────────────────────────────────
// Registered with debug/tuning.ts, which means each declaration below is BOTH
// the value and its entry in the in-game panel — group, label, range and hint
// travel with the number they describe. URL params of the same id still seed
// them, so every ?relief= link from before keeps working.
// LIVE knobs — TSL uniforms, so dragging the slider moves the picture with no
// rebuild and no reload. Each `tuneUniform` call is also its own registration:
// it appears in the in-game panel under its group with no UI code anywhere.
const uStoneHue = tuneUniform({
  id: 'stonehue', group: 'Stone', label: 'Stone hue spread', min: 0, max: 2, value: 0.85,
  hint: 'how far apart different stones\u2019 colours sit',
});
const uStoneWear = tuneUniform({
  id: 'stonewear', group: 'Stone', label: 'Stone wear spread', min: 0, max: 1, value: 0.30,
  hint: 'how much stones differ in roughness',
});
const uPomDepth = tuneUniform({
  id: 'pomdepth', group: 'Relief', label: 'POM depth', min: 0, max: 0.3, value: POM_DEPTH_DEFAULT,
  hint: 'how deep the stone goes',
});
const uRelief = tuneUniform({
  id: 'relief', group: 'Relief', label: 'Relief amplitude', min: 0, max: 0.6, value: 0.25,
  hint: 'how hard light rakes across the surface',
});

// STRUCTURAL — unrolled into the node graph, so these cannot be uniforms. They
// register as 'reload' knobs, and the panel says so on the slider rather than
// pretending it worked.
const POM_STEPS: number = Math.round(tuneNumber({
  id: 'pom', group: 'Relief', label: 'POM steps', min: 0, max: 24, value: POM_DEFAULT_STEPS,
  step: 1, apply: 'reload', hint: '0 = off',
})());
const POM_REFINE: number = Math.round(tuneNumber({
  id: 'pomrefine', group: 'Relief', label: 'POM refine', min: 0, max: 8, value: 4,
  step: 1, apply: 'reload', hint: 'binary halvings; 0 shows the banding',
})());

/* eslint-disable @typescript-eslint/no-explicit-any */
// ── THE SHEEN GROUP — how the FLOOR answers light ────────────────────────────
// Josh: *"the floor is a bit too silver metallic, from afar it has this awesome
// sheen, and yes stone can be like mirror polished from stepping on it but i
// think it could be cool if we could experiment a bit with it ... we are going
// to make a kinda elaborate setup and then i will step by step experiment and
// tell you whats missing."*
//
// So this is the setup, not an opinion about where the values should land. Four
// things make that floor silver and until now not one of them could be moved
// without a reload:
//
//   COLOUR      the floor tint was pushed cool ([0.90, 0.97, 1.12]) to stop it
//               reading as the same stone as the wall. Cool + bright = silver.
//   BRIGHTNESS  a pale albedo takes more light back than a dark one, and 'too
//               metallic' is often just 'too bright' wearing a colour.
//   ROUGHNESS   0.72 is what gives it a broad specular sheen at all. This is
//               the dial between damp stone and dry stone.
//   POLISH      the grease layer subtracts up to 0.26 more roughness in broad
//               patches, and THAT is the mirror-from-being-stepped-on read.
//               Two knobs, because how STRONG the polish is and how much of the
//               floor gets it are different questions with different answers.
//
// Floor-scoped on purpose: the wall has never been the complaint, and roughness
// is a per-material property anyway. `cfg.role === 'floor'` selects them, which
// costs no new pipeline variant — the floor material already has a unique flag
// combination (horiz + splat + seamShadow + seamGlowScale), so its node graph
// was already its own.
const flrWarm = tuneNumber({
  id: 'flrwarm', group: 'Sheen', label: 'Floor warmth', min: -1, max: 1, value: 0,
  apply: 'live', hint: 'negative = colder/more silver, positive = warm stone',
});
const flrBright = tuneNumber({
  id: 'flrbright', group: 'Sheen', label: 'Floor albedo', min: 0.4, max: 1.6, value: 1.0,
  apply: 'live', hint: 'how much light the stone gives back at all',
});
const uFlrRough = tuneUniform({
  id: 'flrrough', group: 'Sheen', label: 'Floor roughness', min: 0.2, max: 1.0, value: 0.72,
  hint: 'low = wet/polished sheen, high = dry matte stone',
});
const uFlrPolish = tuneUniform({
  id: 'flrpolish', group: 'Sheen', label: 'Traffic polish', min: 0, max: 0.6, value: 0.26,
  hint: 'how much smoother the worn patches get',
});
const uFlrPolishAt = tuneUniform({
  id: 'flrpolishat', group: 'Sheen', label: 'Polish threshold', min: 0.1, max: 0.95, value: 0.58,
  hint: 'high = only a few lanes shine, low = the whole floor does',
});

// Warmth + brightness fold into ONE vec3 that multiplies the floor's authored
// tint. Two scalars are what you want to drag; one uniform is what the shader
// wants to read, and recomputing here means the shader never has to know the
// knobs exist.
const uFlrTintAdj = (tslUniform as any)(new THREE.Vector3(1, 1, 1));
function refreshFloorTint(): void {
  const w = flrWarm(), b = flrBright();
  // Opposed R/B swing with G held: that is a colour-TEMPERATURE move, which is
  // what "silver vs warm stone" actually is. Scaling all three would only be
  // the brightness knob again.
  (uFlrTintAdj as any).value.set(b * (1 + w * 0.20), b, b * (1 - w * 0.22));
}
refreshFloorTint();
onKnobChange((k) => { if (k.spec.id === 'flrwarm' || k.spec.id === 'flrbright') refreshFloorTint(); });

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
// (Stochastic hex tiling — Heitz/Neyret in Mikkelsen's adaptation — was built
// here and REMOVED. Josh: *"lets get rid of the moss and the hex etc."* It
// worked: the ~2m repeat stopped marching along the wall. But it cost three
// texture taps on EVERY sample — base, all eight POM steps, and the four normal
// taps — and it left faint diagonal cell seams that only trade against contrast,
// with no free setting. Recoverable from git if the repeat ever becomes the
// loudest problem again; the finding worth keeping is that hex tiling fights
// STRUCTURED textures, and offsets must snap to the pattern's own period or
// every cell boundary jogs the brick courses.)
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

  // ── ONE PROJECTION FRAME, DECIDED ONCE ──────────────────────────────────────
  // Josh: *"some textures that are like top or bottom facing flicker weirdly"*,
  // and after a first fix, *"some of the top surfaces are still flickering ...
  // there seems to be a subset of operations unstable on the top and maybe
  // bottom surface."*
  //
  // "A subset of operations" is exactly right and is the whole bug. THREE
  // separate places in this function need to know which world axes the texture
  // runs along — the UV projection, the POM march direction, and the tangent
  // frame the height gradient is converted through — and each one used to
  // decide it independently by re-testing the normal.
  //
  // The test is `|nx| > |nz|`: which way does this wall face. It is fine on a
  // genuine wall, where one of them dominates. On a face pointing UP or DOWN
  // both are near zero, so the answer is decided by whatever noise is left in
  // the interpolated normal — it flips between neighbouring pixels and between
  // frames, and the texture snaps 90° as you move. Props, framing and the wall
  // profile's band closures all use the 'wall' projection and all have
  // horizontal faces, which is where it shows.
  //
  // I fixed ONE of the three sites last time (the UV projection) and reported
  // the flicker as fixed. The march and the tangent frame kept re-deciding,
  // which is why a subset of the shading went on flickering while the pattern
  // itself held still. Deciding once and passing the frame down is what makes
  // that class of bug impossible rather than fixed — three copies of a decision
  // will drift again the next time one of them is touched.
  //
  // DOMINANT AXIS, not a 0.707 cutoff: pick the world plane the face is most
  // parallel to. A two-axis projection cannot describe a horizontal surface at
  // all, so an up-facing one is laid out in the ground plane, which is both
  // stable and what you'd want anyway.
  //
  // A hard axis choice still has a seam at 45° — real triplanar blends across
  // it, and that costs three times the taps on a shader that already marches
  // this texture eight times, so it stays hard. The rooms are axis-aligned;
  // nothing in the shell sits near the seam.
  let sU: any, sV: any;      // metre-space projected coords
  let axisU: any, axisV: any; // and the WORLD directions they run along
  if (cfg.proj === 'wall') {
    const flat: any = nrm.y.abs().greaterThanEqual((tslMax as any)(nrm.x.abs(), nrm.z.abs()));
    const faceX: any = nrm.x.abs().greaterThan(nrm.z.abs());   // ±X-facing wall → U runs along Z
    sU = (flat as any).select(pos.x, (faceX as any).select(pos.z, pos.x));
    sV = (flat as any).select(pos.z, pos.y);
    axisU = (flat as any).select(
      (vec3 as any)(1, 0, 0),
      (faceX as any).select((vec3 as any)(0, 0, 1), (vec3 as any)(1, 0, 0)),
    );
    axisV = (flat as any).select((vec3 as any)(0, 0, 1), (vec3 as any)(0, 1, 0));
  } else {
    sU = pos.x; sV = pos.z;
    axisU = (vec3 as any)(1, 0, 0);
    axisV = (vec3 as any)(0, 0, 1);
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
    // Projecting onto the frame vectors rather than re-picking a component is
    // what keeps this in step with the UVs — it is the same decision by
    // construction, not the same decision written out twice.
    const tU: any = viewW.dot(axisU);
    const tV: any = viewW.dot(axisV);
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
    const depthN: any = (uPomDepth as any).mul(fade);
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
      const surfD: any = float(1).sub((tslTexture as any)(cfg.tex, curUV).a);
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
    let refined: any = (tslMix as any)(hitUV, prevUV, w);

    // ── BINARY REFINEMENT — the half I skipped, and Josh found it ─────────────
    // *"it looks like the card stack, is there a better technique for this?"*
    // Yes, and this is it. The linear interpolation above assumes the surface
    // varies LINEARLY between the last two samples. Across a sloped joint that
    // is true. Across anything steeper it is badly wrong, and the hit snaps to
    // the step that straddled it — one visible band per march step, which is
    // exactly what his screenshot shows (about eight bands, and POM_STEPS is 8).
    //
    // Bisecting instead makes no assumption about the shape at all: sample the
    // midpoint, keep whichever half still contains the crossing, repeat. Four
    // iterations divide the remaining error by sixteen, for four texture reads
    // and no extra marching. This is the step that separates parallax occlusion
    // mapping from relief mapping proper, and I described leaving it out as a
    // considered trade when it was really just an omission.
    let loUV: any = prevUV, hiUV: any = hitUV;
    let loD: any = prevRay, hiD: any = hitRay;
    for (let k = 0; k < POM_REFINE; k++) {
      const midUV: any = (tslMix as any)(loUV, hiUV, float(0.5));
      const midD: any = loD.add(hiD).mul(0.5);
      const midSurf: any = float(1).sub((tslTexture as any)(cfg.tex, midUV).a);
      // Still ABOVE the surface → the crossing is in the far half.
      const above: any = (midD.lessThan(midSurf) as any).select(float(1), float(0));
      loUV = (tslMix as any)(loUV, midUV, above);
      loD = (tslMix as any)(loD, midD, above);
      hiUV = (tslMix as any)(midUV, hiUV, above);
      hiD = (tslMix as any)(midD, hiD, above);
    }
    if (POM_REFINE > 0) refined = (tslMix as any)(loUV, hiUV, float(0.5));
    pomUV = refined;
    // Rays that never hit keep the flat UV rather than the last marched one.
    pomUV = (tslMix as any)(uv, pomUV, done);
  }

  const sampled: any = (tslTexture as any)(cfg.tex, pomUV);
  // UNIFORM-backed base colour (materialColor), NOT vec3(mat.color.*): a vec3(...)
  // literal bakes the wall/floor tint into the WGSL, forking a fresh shader per
  // distinct shell colour (per-floor pipeline churn). materialColor reads the
  // colour from a per-material uniform → identical WGSL across tints → one shared
  // pipeline. See the note in surface-ao.ts installPropHeightAOWebGPU.
  const base: any = materialColor;
  const tint: any = (tslUniform as any)(new THREE.Vector3(cfg.tint[0], cfg.tint[1], cfg.tint[2]));
  // `.r` BROADCAST, not `.rgb`. G and B do not duplicate R — they carry this
  // stone's VARIANT and WEAR (see surface-textures.ts). Reading .rgb here would
  // drag the identity channels in as a colour cast.
  //
  // (A second layout, for AI-generated COLOUR maps, briefly lived here and was
  // removed with the texture experiment.)
  const variant: any = sampled.g;
  const wear: any = sampled.b;
  const isFloor = cfg.role === 'floor';
  let albedo: any = base.mul((vec3 as any)(sampled.r, sampled.r, sampled.r)).mul(tint);
  // Warmth + brightness ride ON TOP of the authored tint rather than replacing
  // it, so the tint stays the thing a surface declares about itself and this
  // stays the thing being experimented with. At the defaults it is (1,1,1).
  if (isFloor) albedo = albedo.mul(uFlrTintAdj);

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
  albedo = albedo.mul((tslMix as any)((vec3 as any)(1, 1, 1), stoneHue, (uStoneHue as any)));

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

  // (MOSS / LICHEN was built here and REMOVED — Josh: *"lets get rid of the moss
  // and the hex etc."* It placed colonies by damp height, cavity shelter and a
  // patchy colony field, and went matte so highlights broke around it. The idea
  // that it was the first layer which ISN'T STONE still seems right, and it is
  // recoverable from git; it just isn't what this look wants yet.)
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
  // FLOOR: threshold + strength are live (the Sheen group), because "polished
  // from being stepped on" is a look with a wide right answer and the only way
  // to find it is to drag it. The window stays a fixed 0.38 wide — moving both
  // edges independently turns one judgement into two, and the edge that matters
  // is where the polish STARTS.
  const greaseLo: any = isFloor ? (uFlrPolishAt as any) : float(0.58);
  const greaseHi: any = isFloor ? (uFlrPolishAt as any).add(0.38) : float(0.96);
  const grease: any = (tslSmoothstep as any)(greaseLo, greaseHi, macro);
  const proud: any = (tslSmoothstep as any)(0.80, 1.05, sampled.a);
  const polish: any = isFloor ? (uFlrPolish as any) : float(0.26);
  const baseRough: any = isFloor ? (uFlrRough as any) : (tslUniform as any)(mat.roughness);
  // PER-STONE WEAR rides on top: some blocks are simply rougher rock than their
  // neighbours, and a spalled face or a bare-earth pit is rougher still (the
  // generators fold that into the wear channel). Centred on 0.5 so it pushes
  // both ways rather than only adding.
  const stoneWear: any = wear.sub(0.5).mul(uStoneWear as any);
  const varied: any = (tslClamp as any)(
    baseRough.add(cavity.mul(0.12)).sub(proud.mul(0.14)).sub(grease.mul(polish)).add(stoneWear),
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
    (tslTexture as any)(cfg.tex, pomUV.add((vec2 as any)(du * texel, dv * texel))).a;
  // Central differences → slope of the height field along U and V, converted
  // from texel-space to metres using the tile size.
  const dU: any = hAt(1, 0).sub(hAt(-1, 0)).mul(0.5 * texW).div(uTile.x);
  const dV: any = hAt(0, 1).sub(hAt(0, -1)).mul(0.5 * texW).div(uTile.y);
  const amp: any = (uRelief as any).mul(cfg.relief);
  // The tangent frame is FREE for the same reason POM's was: these UVs are
  // projected on world axes, so U and V *are* world axes — and they are the
  // ones already chosen above. This was the third site re-deciding for itself,
  // which meant that on a horizontal face the perturbed NORMAL flipped even
  // when the pattern under it did not: the stone held still and the lighting
  // on it strobed.
  const nWorld: any = nrm
    .sub(axisU.mul(dU.mul(amp)))
    .sub(axisV.mul(dV.mul(amp)))
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
  tile: readonly [number, number];     // world metres per repeat
  proj: 'wall' | 'horiz';              // wall = vertical plane, horiz = floor/ceiling
  /** WHAT this surface is, as opposed to how it is projected — the ceiling
   *  shares the floor's projection and should share none of its tuning. Opts a
   *  surface into the live Sheen knobs; only the floor has any today. Costs no
   *  extra pipeline variant while it names a config that was already structurally
   *  unique. */
  role?: 'floor';
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

// ── THIS IS A GPU-STRENGTH DIAL, NOT A FEATURE TOGGLE ───────────────────────
// The name says "enabled" and the body sets a uniform to 0. The node graph
// stays bolted to the material either way, so `material.colorNode` is still
// defined, three's containsNode() still returns true, and the PER-OBJECT CPU
// cost is byte-for-byte identical with this off.
//
// Which makes it the wrong instrument for the obvious experiment. A/B-ing a
// frame with this on and off measures the shader's GPU work and NOTHING about
// what the node graph costs on the CPU — and since the phone is CPU-encode
// bound (2026-07-03 triage, and the peer session's 2026-08-16 measurements),
// that is the half you would actually be trying to price. You would come away
// concluding the surface shader is CPU-free.
//
// Use the encode-breakdown's nodeMat/plain split for that question instead.
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
