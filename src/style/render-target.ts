import * as THREE from 'three';
import { CONFIG } from '../config';
import { isWebGPU, isWebGPUReady } from '../scene/renderer-mode';
import { renderProbeActive, reportRenderPhase, gpuPassActive, gpuPassBegin, gpuPassEnd } from '../debug/render-probe';

// PS1-era render pipeline, PSX-horror flavor.
//
// Render the scene to a low-res target, then blit it full-screen through a
// custom fragment shader that adds the moves from the Haunted PS1 / Mike
// Klubnika school (Buckshot Roulette, No I'm Not a Human, Mouthwashing,
// Faith, etc.):
//
//   - Bayer 4x4 ORDERED DITHER baked into the color, so gradients posterize
//     into that signature crosshatch instead of going smooth.
//   - COLOR QUANTIZATION to ~32 levels per channel — hard color steps.
//   - CHROMATIC ABERRATION at screen edges (subtle red/blue split).
//   - SCANLINES — 1px horizontal darkening, ~3%, the CRT phosphor feel.
//   - WARM AMBER TINT — Buckshot Roulette's sepia push, drives the dread.
//
// All five sit in one cheap fragment shader pass. Mobile-friendly.

// Scene-render resolution as a fraction of the canvas. The scene renders to
// this low-res target; the blit upscales it. 0.4 = ~16% the fragments — the
// single biggest fill-rate lever. Mutable so the adaptive-resolution scaler
// (scene/adaptive-resolution.ts) can nudge it down on a struggling phone.
export const PS1_SCALE_DEFAULT = 0.4;
let ps1Scale = PS1_SCALE_DEFAULT;

// SHARP UPSCALE — when on, the blit upscales the low-res target with
// sharp-bilinear (crisp pixels, ~1px anti-aliased boundary) instead of
// nearest. Smooths the sub-pixel "jitter" of lateral motion without blurring
// the look. Off by default = the authored nearest-neighbour PS1 crawl.
let sharpBilinear = false;

let lowResTarget: THREE.WebGLRenderTarget | null = null;
let blitScene: THREE.Scene | null = null;

// OVERDRAW HEATMAP — a DEV debug view of fill-rate, the #1 mobile-GPU cost no
// other tool sees. When on, every mesh draws with one ADDITIVE warm material and
// NO depth test, so overlapping geometry accumulates: dark = 1 layer, orange =
// a few, white = heavy overdraw (overlapping walls, transparent fog planes,
// stacked VFX meshes). It's an isolated early-return path in renderWithStyle —
// it never touches the normal pipeline. (Caveat: THREE Sprites use a separate
// draw path overrideMaterial doesn't catch, so additive sprite-VFX fill isn't
// counted here — mesh overdraw is.)
let overdrawMode = false;
let overdrawMat: THREE.MeshBasicMaterial | null = null;
export function setOverdrawMode(on: boolean): void { overdrawMode = on; }
function getOverdrawMat(): THREE.MeshBasicMaterial {
  if (!overdrawMat) {
    overdrawMat = new THREE.MeshBasicMaterial({
      // Warm per-layer add: 1×≈dim ember, ~3×≈orange, ~6×≈white — a natural heat ramp.
      color: 0x33200d,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
  }
  return overdrawMat;
}
// Shared scene for the single-call viewmodel depth pre-pass + its per-frame
// scratch lists (module-level so the hot path allocates nothing).
let prepassScene: THREE.Scene | null = null;
const prepassRoots: THREE.Object3D[] = [];
const prepassParents: THREE.Object3D[] = [];
let shadowFrameCounter = 0;
let blitCamera: THREE.OrthographicCamera | null = null;
let blitMaterial: THREE.ShaderMaterial | null = null;
let rendererRef: THREE.WebGLRenderer | null = null;

// Held viewmodels (weapon / lamp / offhand) registered for the depth-only
// pass in renderWithStyle — see the note there. They render depthTest:false
// for colour (always on top), so they need a separate pass to put their near
// depth in the buffer or the depth-keyed post effects paint the world onto
// them.
const viewmodelRoots: THREE.Object3D[] = [];
/** Register a held-viewmodel root for the near-depth pass. Idempotent. */
export function registerViewmodel(root: THREE.Object3D): void {
  if (!viewmodelRoots.includes(root)) viewmodelRoots.push(root);
}
/** Drop a viewmodel root (teardown). */
export function unregisterViewmodel(root: THREE.Object3D): void {
  const i = viewmodelRoots.indexOf(root);
  if (i >= 0) viewmodelRoots.splice(i, 1);
}
/** The registered held-viewmodel roots — for the draw report to classify hand/
 *  weapon/lamp meshes as dynamic (they animate) rather than static decor. */
export function getViewmodelRoots(): readonly THREE.Object3D[] {
  return viewmodelRoots;
}
function setMeshDepthOnly(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) { m.colorWrite = false; m.depthTest = true; m.depthWrite = true; }
}
function restoreMeshColor(o: THREE.Object3D): void {
  // Restore viewmodel materials to their MAIN-PASS state: depthTest on
  // so they occlude each other, depthWrite off so they don't overwrite
  // the depth values the pre-pass already wrote (which would lose the
  // closest-wins composition between viewmodel parts).
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) { m.colorWrite = true; m.depthTest = true; m.depthWrite = false; }
}

/** Compile the viewmodels' PREPASS shader variant up front (call once at warmup).
 *
 *  The depth pre-pass renders the held viewmodels in `prepassScene`, which has
 *  ZERO lights — a different shader-program cache key than the ~11-light main
 *  scene the warmup pass compiles. So without this, the FIRST prepass draw of
 *  each viewmodel (the starting weapon, and again on every weapon/lamp/offhand
 *  swap) compiles a fresh 0-light variant mid-frame — a ~6ms prepass spike. This
 *  runs the real attach → depth-only → render → restore path once, into a
 *  throwaway target, so that compile happens on the loading screen instead. */
export function warmViewmodelPrepass(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
  if (!prepassScene || !viewmodelRoots.length) return;
  const moved: Array<{ vm: THREE.Object3D; parent: THREE.Object3D; vis: boolean }> = [];
  for (const vm of viewmodelRoots) {
    if (!vm.parent) continue;                  // need a parent to attach back to
    moved.push({ vm, parent: vm.parent, vis: vm.visible });
    vm.visible = true;                         // force-render even if currently hidden
    prepassScene.attach(vm);                   // world-transform-preserving move
    vm.traverse(setMeshDepthOnly);
  }
  const progBefore = renderer.info.programs?.length ?? 0;
  if (moved.length) {
    const target = new THREE.WebGLRenderTarget(16, 16);   // tiny — we only want the compile
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try { renderer.render(prepassScene, camera); } catch { /* best-effort warm */ }
    renderer.setRenderTarget(prevTarget);
    target.dispose();
  }
  for (const m of moved) {
    m.parent.attach(m.vm);                     // back to the camera, transform preserved
    m.vm.traverse(restoreMeshColor);
    m.vm.visible = m.vis;
  }
  if (import.meta.env.DEV) {
    const d = (renderer.info.programs?.length ?? 0) - progBefore;
    // eslint-disable-next-line no-console
    console.log(`[warm-prepass] ${moved.length} viewmodel root(s), +${d} program(s) — the 0-light depth variant; first in-game prepass should no longer spike.`);
  }
}

const HORROR_BLIT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const HORROR_BLIT_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D uBloom;       // blurred bright-pass (glow bleeding into the dark)
  uniform float uBloomStrength;   // how much bloom adds back (0 = off)
  uniform sampler2D tDepth;       // scene depth (for the distance crush)
  uniform float uNear;            // camera near/far for depth linearisation
  uniform float uFar;
  uniform float uDepthStartM;     // world metres where the distance-crush begins
  uniform float uDepthEndM;       // metres where it reaches the floor
  uniform float uDepthFloor;      // brightness multiplier at uDepthEndM (0 = black)
  uniform float uDepthAmount;     // 0 = off, 1 = full crush
  uniform float uInscatterStrength;  // fog-inscatter glow amount (0 = off)
  uniform float uInscatterStartM;    // metres where the glowing haze begins
  uniform float uInscatterEndM;      // metres where the haze is fully thick
  uniform vec2 uResolution;
  uniform vec2 uLowResSize;     // low-res scene target size, in texels
  uniform float uSharpBilinear; // 1 = sharp-bilinear upscale, 0 = nearest texel-snap
  uniform float uDarkAdapt;
  uniform float uBrightness;
  uniform float uWick;  // eye dark-adaptation, 0 = none .. 1 = full dark
  uniform float uInspect;    // 1 = bypass PSX post-process (inspection snaps)
  uniform float uTime;       // seconds — drives the CRT film animation
  uniform float uCrtFilm;    // 1 = the opt-in CRT dirty-signal layer is on
  varying vec2 vUv;

  // Bayer 4x4 ordered dither matrix (values 0..15, normalized to 0..1)
  float bayer(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int i = y * 4 + x;
    float m;
    if (i ==  0) m =  0.0; else if (i ==  1) m = 12.0;
    else if (i ==  2) m =  3.0; else if (i ==  3) m = 15.0;
    else if (i ==  4) m =  8.0; else if (i ==  5) m =  4.0;
    else if (i ==  6) m = 11.0; else if (i ==  7) m =  7.0;
    else if (i ==  8) m =  2.0; else if (i ==  9) m = 14.0;
    else if (i == 10) m =  1.0; else if (i == 11) m = 13.0;
    else if (i == 12) m = 10.0; else if (i == 13) m =  6.0;
    else if (i == 14) m =  9.0; else m =  5.0;
    return m / 16.0 - 0.5;  // -0.5 .. +0.4375
  }

  vec3 quantize(vec3 col, float levels) {
    return floor(col * levels + 0.5) / levels;
  }

  // Linear eye-space depth (metres) from the depth texture at a uv.
  float linDepth(vec2 uv) {
    float dRaw = texture2D(tDepth, uv).x;
    float ndc = dRaw * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
  }

  // Sample the low-res scene target. The target is LINEAR-filtered, so the
  // mode is chosen here in the shader:
  //   SHARP UPSCALE on  — snap to texel centres but keep a ~1-output-pixel
  //     linear ramp across each texel boundary, so during sub-pixel camera
  //     motion (strafing) an edge GLIDES over one screen pixel instead of
  //     jumping a whole upscaled texel at once. Themaister's classic
  //     sharp-bilinear: pixels stay crisp, only the boundary is anti-aliased.
  //   SHARP UPSCALE off — sample exactly at the texel centre → identical to
  //     NearestFilter (the authored chunky PS1 crawl), zero blur.
  vec3 sampleScene(vec2 uv) {
    if (uSharpBilinear > 0.5) {
      vec2 texel = uv * uLowResSize;
      vec2 texelFloored = floor(texel);
      vec2 s = fract(texel);
      vec2 scale = uResolution / uLowResSize;        // output px per low-res texel
      vec2 regionRange = 0.5 - 0.5 / scale;
      vec2 centerDist = s - 0.5;
      vec2 f = (centerDist - clamp(centerDist, -regionRange, regionRange)) * scale + 0.5;
      return texture2D(tDiffuse, (texelFloored + f) / uLowResSize).rgb;
    }
    vec2 snapped = (floor(uv * uLowResSize) + 0.5) / uLowResSize;  // nearest emulation
    return texture2D(tDiffuse, snapped).rgb;
  }

  void main() {
    vec2 uv = vUv;

    // INSPECTION BYPASS — skip every PSX effect (chromatic aberration,
    // dark-adapt, dither, quantize, scanlines, amber tint, vignette)
    // when uInspect is on. They're stylistic crunchifiers for grimdark
    // gameplay; for snap-the-model-cleanly they fight the inspection
    // mode's bright-flat-lit intent and squash dim grey backdrops to
    // pure black. Direct pass-through of the rendered scene.
    if (uInspect > 0.5) {
      // The low-res target stores LINEAR-encoded radiance (Three.js's
      // intermediate render space). Output goes to canvas which
      // expects sRGB-encoded values; the gameplay blit lower down
      // doesn't need an explicit encode step because its tonemap +
      // amber tint + dither implicitly land near the right curve.
      // For the bypass we must apply the linear→sRGB encode by
      // hand or the backdrop looks gamma-crushed.
      vec3 linear = sampleScene(uv);
      vec3 srgb = pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2));
      gl_FragColor = vec4(srgb, 1.0);
      return;
    }

    // CHROMATIC ABERRATION — red/blue split scaling with distance from center.
    // Reduced 0.006 → 0.004 — strong CA was reading as a rendering bug on phone
    // screenshots; this dial keeps the analog wobble at the edges without
    // smearing the centre.
    vec2 fromCenter = uv - 0.5;
    vec2 caOffset = fromCenter * 0.004;
    float r = sampleScene(uv + caOffset).r;
    float g = sampleScene(uv).g;
    float b = sampleScene(uv - caOffset).b;
    vec3 col = vec3(r, g, b);

    // BLOOM — add the blurred bright-pass so emissive cores + dark-reactive
    // rims BLEED their colour into the surrounding black (the glow actually
    // radiating, not just sitting on the surface). Added BEFORE the dither/
    // quantize so the halo gets the same PSX crunch as everything else.
    col += texture2D(uBloom, uv).rgb * uBloomStrength;

    // EYE DARK-ADAPTATION (uDarkAdapt 0..1) — darkness-weighted
    // shadow detail, not a blue floodlight.
    //
    // Previous values (additive (0.075, 0.095, 0.125), gain 0.25)
    // painted true-black with a distinctly cool moonlight tint
    // that fought the dungeon's warm-amber atmosphere — read as
    // "night vision washout" even though hue was preserved on
    // coloured pixels.
    //
    // New tuning leans on GAIN (which amplifies whatever
    // micro-light is already in the rendered scene) rather than
    // ADDITIVE (which paints colour into pixels that had none):
    //   - Gain bumped 0.25 → 0.55 (darkness-weighted, so highlights
    //     untouched). Pulls existing faint shading OUT of darker
    //     regions — silhouettes, edges, the gleam of metal — so the
    //     player sees a *shimmer of what's there* instead of a flat
    //     blue-grey field.
    //   - Additive tint slashed to (0.034, 0.036, 0.040) — barely
    //     warmer than neutral, near-imperceptible on coloured
    //     pixels, just enough to lift pure-black above zero so it's
    //     navigable. The dungeon stays dark and atmospheric.
    float maxC = max(col.r, max(col.g, col.b));
    float darkness = 1.0 - maxC;
    col += uDarkAdapt * vec3(0.034, 0.036, 0.040) * darkness;
    col *= 1.0 + uDarkAdapt * 0.55 * darkness;


    // WICK — the player's calibrated floor of visibility (wick ritual).
    // Darkness-weighted: bright pixels are untouched, so torch pools and
    // signal lights keep their authored levels while the dark floor
    // rises (or sinks). Band re-targeting, not a gamma wash.
    {
      float wick = uWick - 1.0;
      float wickDark = 1.0 - max(max(col.r, col.g), col.b);
      col += max(wick, 0.0) * vec3(0.030, 0.032, 0.036) * wickDark;
      col *= 1.0 + wick * 0.45 * wickDark;
    }

    // MASTER BRIGHTNESS — settings dial; applied before dither/quantize
    // so the whole PSX chain sees the adjusted exposure.
    col *= uBrightness;

    // DITHER — add Bayer pattern below quantization to break smooth bands
    vec2 pixCoord = gl_FragCoord.xy;
    float d = bayer(pixCoord);
    col += d / 24.0;

    // QUANTIZE to ~32 levels per channel for hard PSX color steps
    col = quantize(col, 32.0);

    // SCANLINES — every other row gets a slight darken
    float scanline = mod(pixCoord.y, 2.0) < 1.0 ? 1.0 : 0.96;
    col *= scanline;

    // AMBER TINT — push the whole image warm, but no longer darken G/B
    vec3 tint = vec3(1.025, 1.00, 0.96);
    col *= tint;

    // VIGNETTE — slight darkening at edges (complements the existing DOM
    // damage vignette above this; tuned down so the room isn't crushed)
    float vig = 1.0 - dot(fromCenter, fromCenter) * 0.20;
    col *= vig;

    // DEPTH-BASED ATMOSPHERICS (steps 3 + 4) — both key off linear eye-Z.
    float depth = texture2D(tDepth, uv).x;
    float ndc = depth * 2.0 - 1.0;
    float eyeZ = (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));

    // STEP 3 — DEPTH CRUSH: recede DISTANCE to black so the near focal pool
    // (your lamp, the lit subject) pops and the rest sinks into the dark.
    // Last in the colour chain so dark-adapt can't lift it back.
    if (uDepthAmount > 0.0) {
      float t = smoothstep(uDepthStartM, uDepthEndM, eyeZ) * uDepthAmount;
      col *= mix(1.0, uDepthFloor, t);
    }

    // STEP 4 — FOG INSCATTER: the AIR glows the lights' colour, thickest in
    // the distant fog. Reuses the blurred bright-pass (uBloom) as the glow
    // source, weighted up with distance — so a torch's halo bleeds into the
    // haze around it and the bloodlit hall's atmosphere picks up the red.
    // Added AFTER the crush so the glowing haze survives in the far dark
    // (the crush darkens empty distance; this relights it where lights are).
    if (uInscatterStrength > 0.0) {
      float fogW = smoothstep(uInscatterStartM, uInscatterEndM, eyeZ);
      col += texture2D(uBloom, uv).rgb * fogW * uInscatterStrength;
    }

    // ── CRT DIRTY-SIGNAL FILM (opt-in, uCrtFilm) ───────────────────────────
    // A decaying-transmission layer ON TOP of the baked PSX crunch — the
    // grimdark register of CRT: rot, not cozy nostalgia. Deliberately OMITS
    // geometric curvature (it turns stomachs in a moving first-person view)
    // and adds NO centre chromatic aberration (colour carries MEANING in this
    // game, so we never fringe it). Grain is luminance-only — the same delta
    // to R, G and B — so it never shifts hue, and it lives mostly in the
    // shadows where a failing signal actually shows. uCrtFilm gates the whole
    // block, so OFF is byte-identical to the image above.
    if (uCrtFilm > 0.5) {
      float lum = max(max(col.r, col.g), col.b);
      float dark = 1.0 - lum;

      // Phosphor scanlines — deeper than the baked ~4%, but eased off the lit
      // subject (darkness-weighted) so torch pools and signal lights survive.
      float line = 0.5 + 0.5 * cos(gl_FragCoord.y * 3.14159265);
      col *= 1.0 - 0.10 * line * (0.5 + 0.5 * dark);

      // Vertical-hold ROLL — a slow bright band drifting up the screen, the
      // classic failing-sync artifact. Squared so it's mostly dark with a
      // soft moving crest rather than a constant brighten.
      float roll = sin((vUv.y + uTime * 0.10) * 6.2831853);
      col *= 1.0 + 0.03 * roll * roll;

      // Signal GRAIN — animated luminance hash, weighted into the darks.
      float n = fract(sin(dot(gl_FragCoord.xy + uTime * 53.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.05 * (0.35 + 0.65 * dark);

      // FLICKER — faint global brightness instability (tube + weak signal).
      col *= 0.985 + 0.015 * sin(uTime * 12.0);

      // Corner falloff — extra vignette reads as curved tube GLASS without
      // bending the geometry (curvature being the nausea trigger we refuse).
      col *= 1.0 - dot(fromCenter, fromCenter) * 0.25;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── BLOOM ─────────────────────────────────────────────────────────────────
// Cheap PS1-friendly bloom: extract the bright pixels from the (already
// low-res) scene target, blur them with a couple of separable passes at HALF
// that res, and add the result back in the blit. Total extra cost is ~3
// fullscreen passes at 0.5× the low-res target (~5% of canvas pixels) — the
// bloom only ever touches the few bright fragments (emissive cores, glowing
// rims, torch flames), so it's the "glow radiating into the dark" payoff at
// near-zero mobile cost.
const BLOOM_SCALE = 0.5;        // bloom target res, as a fraction of the low-res target
const BLOOM_THRESHOLD = 0.62;   // linear luma above which a pixel blooms (raised so
                               //   mid-bright volumetrics like the staircase god ray
                               //   bloom less; the hot emissive cores still pop)
const BLOOM_STRENGTH = 0.82;    // how much bloom adds back (eased from 1.05 — was a
                               //   tad too strong on the phone)
const BLOOM_BLUR_STEPS = 1;     // H+V blur pairs. 2→1: bloom was ~11ms (GPU-pass
                               //   timer), nearly the whole scene render — NOT fill
                               //   (the bloom targets are tiny) but render-target
                               //   SWITCH overhead on the tiler (each bind = a tile
                               //   flush/reload). 2 steps = 5 binds, 1 step = 3 —
                               //   removes 2 of the dearest ops. Halo is a touch
                               //   tighter; in the dark dungeon it barely reads.
let bloomEnabled = true;

let bloomA: THREE.WebGLRenderTarget | null = null;
let bloomB: THREE.WebGLRenderTarget | null = null;
let bloomExtractMat: THREE.ShaderMaterial | null = null;
let bloomBlurMat: THREE.ShaderMaterial | null = null;
let bloomMesh: THREE.Mesh | null = null;

const BLOOM_EXTRACT_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Keep the bright COLOUR, scaled by how far it exceeds the threshold —
    // so a red-hot core blooms red, a torch blooms amber.
    float w = max(luma - uThreshold, 0.0) / max(luma, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLOOM_BLUR_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;   // (texel, 0) for horizontal, (0, texel) for vertical
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
    s += texture2D(tDiffuse, vUv + uDir * 1.0).rgb * 0.194594;
    s += texture2D(tDiffuse, vUv - uDir * 1.0).rgb * 0.194594;
    s += texture2D(tDiffuse, vUv + uDir * 2.0).rgb * 0.121622;
    s += texture2D(tDiffuse, vUv - uDir * 2.0).rgb * 0.121622;
    s += texture2D(tDiffuse, vUv + uDir * 3.0).rgb * 0.054054;
    s += texture2D(tDiffuse, vUv - uDir * 3.0).rgb * 0.054054;
    gl_FragColor = vec4(s, 1.0);
  }
`;

// Depth crush (step 3) — the art-directed pool of reveal. World metres.
// Tuned to push more contrast into the distance — the previous floor (0.23)
// left far walls clearly readable on phone screenshots, which fought the
// "lantern is the pool of vision" pillar. Bringing the floor down to 0.16
// crushes more aggressively while the near pool stays full-bright.
const DEPTH_START_M = 6.0;    // near pool stays full-bright out to here
const DEPTH_END_M = 12.0;     // crushed to the floor by here (was 13)
const DEPTH_FLOOR = 0.16;     // brightness at the far end (was 0.23)
const DEPTH_AMOUNT = 0.85;    // 0 = off, 1 = full crush (was 0.8)
let depthCrushEnabled = true;

// Fog inscatter (step 4) — the air itself glows the lights' colour, thickest
// in the distant fog. Reuses the blurred bright-pass as the glow source.
const INSCATTER_STRENGTH = 0.55;  // how much the haze picks up the light
const INSCATTER_START_M = 2.5;    // metres where the haze begins
const INSCATTER_END_M = 11.0;     // metres where it's fully thick
let inscatterEnabled = true;

// CRT dirty-signal film — opt-in decaying-transmission layer (see the shader
// block). Off by default so the live look is unchanged until the player flips
// the CRT FILM toggle in Settings → Graphics. The amounts are tuned inside the
// shader; only the on/off (and the per-frame clock) live in JS.
let crtFilmEnabled = false;


/** Toggle fog inscatter (A/B the glowing-air). */
export function setInscatterEnabled(on: boolean): void {
  inscatterEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uInscatterStrength.value = on ? INSCATTER_STRENGTH : 0;
}

/** Toggle the depth crush (A/B the distance-to-black pool). */
export function setDepthCrushEnabled(on: boolean): void {
  depthCrushEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uDepthAmount.value = on ? DEPTH_AMOUNT : 0;
}

/** Toggle the CRT dirty-signal film (animated grain + rolling scanlines +
 *  flicker + tube-corner falloff). A/B the decaying-transmission look. The
 *  effect amounts are baked in the shader; this just gates the block. */
export function setCrtFilmEnabled(on: boolean): void {
  crtFilmEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uCrtFilm.value = on ? 1 : 0;
}
export function getCrtFilmEnabled(): boolean { return crtFilmEnabled; }

/** Toggle the SHARP UPSCALE (sharp-bilinear vs nearest blit). Off = the
 *  authored chunky PS1 crawl; on = crisp pixels with a 1px anti-aliased
 *  boundary, so lateral camera motion glides instead of jittering. */
export function setSharpBilinear(on: boolean): void {
  sharpBilinear = on;
  if (blitMaterial) blitMaterial.uniforms.uSharpBilinear.value = on ? 1 : 0;
}
export function getSharpBilinear(): boolean { return sharpBilinear; }

/** Toggle bloom (so the look can be A/B'd / disabled on weak devices). */
export function setBloomEnabled(on: boolean): void {
  bloomEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uBloomStrength.value = on ? BLOOM_STRENGTH : 0;
}

// Current-state getters — so a temporary A/B probe (GPU attribution) can capture
// the real setting and restore to IT, not to a hardcoded default (which is what
// left ink-outlines force-enabled after a sweep).
export function getBloomEnabled(): boolean { return bloomEnabled; }
export function getInscatterEnabled(): boolean { return inscatterEnabled; }
export function getDepthCrushEnabled(): boolean { return depthCrushEnabled; }

// Viewmodel depth pre-pass toggle — A/B probe only. Off = the held items lose
// correct world occlusion at the seams, which is fine for the seconds a GPU
// attribution sweep needs to price the pass.
let viewmodelPrepassEnabled = true;
export function setViewmodelPrepassEnabled(on: boolean): void { viewmodelPrepassEnabled = on; }
export function getViewmodelPrepassEnabled(): boolean { return viewmodelPrepassEnabled; }

function bloomDims(): [number, number] {
  const w = Math.max(1, Math.floor((rendererRef!.domElement.width * ps1Scale) * BLOOM_SCALE));
  const h = Math.max(1, Math.floor((rendererRef!.domElement.height * ps1Scale) * BLOOM_SCALE));
  return [w, h];
}

function resizeBloom(): void {
  if (!bloomA || !bloomB || !rendererRef) return;
  const [w, h] = bloomDims();
  bloomA.setSize(w, h);
  bloomB.setSize(w, h);
}

export function initRenderPipeline(renderer: THREE.WebGLRenderer) {
  rendererRef = renderer;
  const w = Math.max(1, Math.floor(renderer.domElement.width * ps1Scale));
  const h = Math.max(1, Math.floor(renderer.domElement.height * ps1Scale));

  lowResTarget = new THREE.WebGLRenderTarget(w, h, {
    // LINEAR so the blit's SHARP UPSCALE can anti-alias the texel boundary
    // (kills the strafe "jitter" — edges glide instead of popping a whole
    // upscaled texel at once). When the toggle is OFF the blit snaps UVs to
    // texel centres, which on a linear texture is byte-identical to
    // NearestFilter — the authored chunky PS1 look is intact.
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
  });
  // Sampleable DEPTH so the blit can crush distance to black (step 3) —
  // an art-directed pool of reveal independent of the fog's colour fade.
  lowResTarget.depthTexture = new THREE.DepthTexture(w, h);

  // Bloom ping-pong targets at BLOOM_SCALE of the low-res target. LINEAR
  // filtering so the blur is smooth (not chunky like the scene target).
  const [bw, bh] = [
    Math.max(1, Math.floor(w * BLOOM_SCALE)),
    Math.max(1, Math.floor(h * BLOOM_SCALE)),
  ];
  const bloomOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
  bloomA = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
  bloomB = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);

  blitScene = new THREE.Scene();
  blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  prepassScene = new THREE.Scene();

  blitMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: lowResTarget.texture },
      uBloom: { value: bloomA.texture },
      uBloomStrength: { value: bloomEnabled ? BLOOM_STRENGTH : 0 },
      tDepth: { value: lowResTarget.depthTexture },
      uNear: { value: 0.1 },
      uFar: { value: 50 },
      uDepthStartM: { value: DEPTH_START_M },
      uDepthEndM: { value: DEPTH_END_M },
      uDepthFloor: { value: DEPTH_FLOOR },
      uDepthAmount: { value: depthCrushEnabled ? DEPTH_AMOUNT : 0 },
      uInscatterStrength: { value: inscatterEnabled ? INSCATTER_STRENGTH : 0 },
      uInscatterStartM: { value: INSCATTER_START_M },
      uInscatterEndM: { value: INSCATTER_END_M },
      uResolution: { value: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height) },
      uLowResSize: { value: new THREE.Vector2(w, h) },
      uSharpBilinear: { value: sharpBilinear ? 1 : 0 },
      uDarkAdapt: { value: 0 },
      uBrightness: { value: 1 },
      uWick: { value: 1 },
      uInspect: { value: 0 },
      uTime: { value: 0 },
      uCrtFilm: { value: crtFilmEnabled ? 1 : 0 },
    },
    vertexShader: HORROR_BLIT_VERT,
    fragmentShader: HORROR_BLIT_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial);
  blitScene.add(blitMesh);

  // Bloom pass materials + a shared fullscreen quad (material swapped per pass).
  bloomExtractMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: lowResTarget.texture }, uThreshold: { value: BLOOM_THRESHOLD } },
    vertexShader: HORROR_BLIT_VERT, fragmentShader: BLOOM_EXTRACT_FRAG, depthTest: false, depthWrite: false,
  });
  bloomBlurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: HORROR_BLIT_VERT, fragmentShader: BLOOM_BLUR_FRAG, depthTest: false, depthWrite: false,
  });
  bloomMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bloomExtractMat);

  window.addEventListener('resize', () => {
    if (!lowResTarget || !blitMaterial) return;
    const nw = Math.max(1, Math.floor(renderer.domElement.width * ps1Scale));
    const nh = Math.max(1, Math.floor(renderer.domElement.height * ps1Scale));
    lowResTarget.setSize(nw, nh);
    resizeBloom();
    blitMaterial.uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    blitMaterial.uniforms.uLowResSize.value.set(nw, nh);
  });
}

/** Set the scene-render resolution fraction (clamped sane). Resizes the
 *  low-res target in place. Driven by the adaptive-resolution scaler; the
 *  blit upscales whatever size this target is, so lowering it trades crispness
 *  for fill-rate (and reads as more PS1, on-aesthetic). */
export function setPS1Scale(scale: number): void {
  // Ceiling raised 0.6 → 1.0 so the RENDER SCALE slider can reach near-native
  // (the smooth/high-res end of the crunchy↔smooth spectrum) on desktop and
  // strong phones; the adaptive scaler still floors it on weak devices.
  ps1Scale = Math.min(1.0, Math.max(0.2, scale));
  if (!lowResTarget || !rendererRef) return;
  const nw = Math.max(1, Math.floor(rendererRef.domElement.width * ps1Scale));
  const nh = Math.max(1, Math.floor(rendererRef.domElement.height * ps1Scale));
  lowResTarget.setSize(nw, nh);
  if (blitMaterial) blitMaterial.uniforms.uLowResSize.value.set(nw, nh);
  resizeBloom();
}

export function getPS1Scale(): number { return ps1Scale; }

/** The renderer's EFFECTIVE pixel ratio = min(device DPR, the PIXEL DENSITY
 *  cap). The true fill multiplier — for the perf recorder's meta snapshot, so a
 *  recording records the resolution it actually ran at (device DPR alone hides
 *  the cap). 0 before the pipeline is initialised. */
export function getRenderPixelRatio(): number { return rendererRef ? rendererRef.getPixelRatio() : 0; }

/** Set the eye dark-adaptation amount (0..1) applied by the blit shader's
 *  shadow-lift. No-op until the pipeline is initialised. */
export function setWickLift(v: number): void {
  if (blitMaterial) blitMaterial.uniforms.uWick.value = v;
}

export function setMasterBrightness(v: number): void {
  if (blitMaterial) blitMaterial.uniforms.uBrightness.value = v;
}

export function setDarkAdapt(amount: number): void {
  if (blitMaterial) blitMaterial.uniforms.uDarkAdapt.value = amount;
}

/** Bypass every PSX post-effect (quantize, dither, scanlines, amber
 *  tint, vignette, chromatic aberration, dark-adapt). For inspection
 *  snaps where the gameplay crunchifiers fight a clean material read. */
export function setInspectBypass(on: boolean): void {
  if (blitMaterial) blitMaterial.uniforms.uInspect.value = on ? 1 : 0;
}

export function renderWithStyle(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  // WEBGPU SPIKE: the PSX pipeline below is WebGL/GLSL-only. Under ?webgpu=1,
  // render the raw scene directly (node-converted standard materials) until the
  // pipeline is ported to TSL — see docs/WEBGPU-MIGRATION.md. renderAsync is
  // fire-and-forget per frame; nothing renders until init() has resolved.
  if (isWebGPU()) {
    if (isWebGPUReady()) {
      void (renderer as unknown as { renderAsync: (s: THREE.Scene, c: THREE.Camera) => Promise<void> })
        .renderAsync(scene, camera);
    }
    return;
  }

  // Reset renderer.info ONCE here so the per-frame draw/triangle counters
  // accumulate across both passes below (the scene render + the blit). main.ts
  // sets renderer.info.autoReset = false to hand us that control; without this
  // the perf overlay / probe would only ever see the 1-draw blit quad. A no-op
  // cost when info isn't being read.
  renderer.info.reset();

  // OVERDRAW DEBUG — isolated path: one additive, no-depth material on every
  // mesh, straight to the screen on black. Brighter = more layers of fill.
  // Returns before the normal low-res/bloom/blit pipeline runs (zero coupling).
  if (overdrawMode) {
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = getOverdrawMat();
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = prevOverride;
    return;
  }

  // Feed the camera's near/far so the blit can linearise depth for the crush.
  if (blitMaterial && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const pc = camera as THREE.PerspectiveCamera;
    blitMaterial.uniforms.uNear.value = pc.near;
    blitMaterial.uniforms.uFar.value = pc.far;
  }

  // Advance the CRT film clock ONLY while it's on — its grain/roll/flicker
  // animate off uTime. One performance.now() per frame when enabled, zero cost
  // (no uniform churn) when the film is off.
  if (blitMaterial && crtFilmEnabled) {
    blitMaterial.uniforms.uTime.value = performance.now() / 1000;
  }

  // Profiler sub-phase timing — split the render system's cost into
  // prepass / scene / bloom / blit so "render: 11ms" becomes actionable.
  // Gated on renderProbeActive() so the performance.now() calls (and any
  // allocation) are skipped entirely for players. `pt` is the phase cursor.
  const prof = renderProbeActive();
  let pt = prof ? performance.now() : 0;
  // Per-pass GPU spans (timer queries / sync probe) — same boundaries as the
  // CPU sub-phases above, but measuring actual GPU execution. Free when off.
  const gprof = gpuPassActive();

  if (lowResTarget && blitScene && blitCamera) {
    // Scene → low-res target, then the PSX blit (dither/quantize/CA/scanlines/
    // exposure) to screen. NOTE: tone mapping is disabled on render-target
    // passes, so all post + exposure must live in the blit shader.
    renderer.setRenderTarget(lowResTarget);
    renderer.clear();

    // VIEWMODEL DEPTH PRE-PASS — runs BEFORE the main scene render so:
    //   1. The world depth-tests against viewmodel depth and gets
    //      properly occluded where the viewmodel covers (so walls don't
    //      paint over the hand at the seam).
    //   2. Viewmodel parts in the scene render then depth-test against
    //      each other via the pre-pass depth (depthTest:true,
    //      depthWrite:false on the materials), so a finger wrapping a
    //      weapon visibly OCCLUDES the weapon at that pixel — the
    //      weapon's higher renderOrder no longer wins shared pixels.
    //   3. The depth-keyed post passes (distance crush, fog inscatter)
    //      see the viewmodel as foreground.
    //
    // setMeshDepthOnly writes depth with test+write on (closer wins);
    // restoreMeshColor sets the materials back to test:true / write:false
    // for the upcoming scene render.
    const prevAutoClearDepth = renderer.autoClearDepth;
    if (viewmodelRoots.length && viewmodelPrepassEnabled) {
      if (gprof) gpuPassBegin('prepass');
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      // ONE render call for all held items, not one per root. Each
      // renderer.render() pays fixed CPU overhead (light-state build, render
      // lists, program state) — 3 calls cost ~2.4ms of phone CPU for ~0.1ms
      // of GPU. attach() moves a root into the shared prepass scene
      // preserving its world transform; the originals are attach()ed back
      // right after, and the per-frame viewmodel animation rewrites the
      // local transforms next frame anyway, so no drift can accumulate.
      for (const vm of viewmodelRoots) {
        if (!vm.visible || !vm.parent) continue;
        prepassParents.push(vm.parent);
        prepassRoots.push(vm);
        prepassScene!.attach(vm);
        vm.traverse(setMeshDepthOnly);
      }
      if (prepassRoots.length) renderer.render(prepassScene!, camera);
      for (let i = 0; i < prepassRoots.length; i++) {
        const vm = prepassRoots[i];
        prepassParents[i].attach(vm);
        vm.traverse(restoreMeshColor);
      }
      prepassRoots.length = 0;
      prepassParents.length = 0;
      renderer.autoClear = prevAutoClear;
      // Keep the depth values we just wrote; the scene render below
      // would otherwise auto-clear them and erase the pre-pass work.
      renderer.autoClearDepth = false;
      if (gprof) gpuPassEnd();
    }
    if (prof) { const n = performance.now(); reportRenderPhase('render·prepass', n - pt); pt = n; }   // viewmodel depth pre-pass

    // Shadow cube-map throttle — the lamp's 6-face shadow pass re-renders
    // every Nth frame instead of every frame (CONFIG.SHADOW_UPDATE_EVERY_N_FRAMES).
    // Draw submission is the measured phone CPU wall; this halves the
    // shadow share of it at N=2.
    const shadowEvery = CONFIG.SHADOW_UPDATE_EVERY_N_FRAMES;
    if (shadowEvery > 1) {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = (shadowFrameCounter++ % shadowEvery) === 0;
    } else {
      renderer.shadowMap.autoUpdate = true;
    }

    if (gprof) gpuPassBegin('scene');
    renderer.render(scene, camera);
    if (gprof) gpuPassEnd();
    renderer.autoClearDepth = prevAutoClearDepth;
    if (prof) { const n = performance.now(); reportRenderPhase('render·scene', n - pt); pt = n; }      // main scene draw — incl. auto shadow-map passes (the bulk of the draws)

    // BLOOM passes — extract bright pixels, then ping-pong separable blur.
    // Builds the glow texture the blit composites. Skipped when disabled.
    if (bloomEnabled && bloomA && bloomB && bloomMesh && bloomExtractMat && bloomBlurMat && blitMaterial) {
      if (gprof) gpuPassBegin('bloom');
      const [bw, bh] = bloomDims();
      // 1) bright-extract: lowResTarget → bloomA
      bloomMesh.material = bloomExtractMat;
      bloomExtractMat.uniforms.tDiffuse.value = lowResTarget.texture;
      renderer.setRenderTarget(bloomA);
      renderer.clear();
      renderer.render(bloomMesh, blitCamera);
      // 2) separable blur, ping-ponging A↔B (horizontal then vertical, ×steps)
      bloomMesh.material = bloomBlurMat;
      let src = bloomA, dst = bloomB;
      for (let i = 0; i < BLOOM_BLUR_STEPS; i++) {
        bloomBlurMat.uniforms.tDiffuse.value = src.texture;
        bloomBlurMat.uniforms.uDir.value.set(1 / bw, 0);
        renderer.setRenderTarget(dst); renderer.clear();
        renderer.render(bloomMesh, blitCamera);
        [src, dst] = [dst, src];
        bloomBlurMat.uniforms.tDiffuse.value = src.texture;
        bloomBlurMat.uniforms.uDir.value.set(0, 1 / bh);
        renderer.setRenderTarget(dst); renderer.clear();
        renderer.render(bloomMesh, blitCamera);
        [src, dst] = [dst, src];
      }
      // `src` now holds the final blurred bloom; point the blit at it.
      blitMaterial.uniforms.uBloom.value = src.texture;
      if (gprof) gpuPassEnd();
    }
    if (prof) { const n = performance.now(); reportRenderPhase('render·bloom', n - pt); pt = n; }      // bright-extract + separable blur

    if (gprof) gpuPassBegin('blit');
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
    if (gprof) gpuPassEnd();
    if (prof) { const n = performance.now(); reportRenderPhase('render·blit', n - pt); pt = n; }        // fullscreen PSX post pass to the canvas
  } else {
    // Before initRenderPipeline runs (shouldn't happen in practice).
    renderer.render(scene, camera);
  }
  // NB: the gl.finish/readPixels GPU probe lives in frame-timing's frameEnd
  // (AFTER this system + the frame's timing is captured), so its synchronous
  // stall doesn't inflate the render system's CPU time or the frame's dt.
}
