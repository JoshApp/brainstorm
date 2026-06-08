import * as THREE from 'three';
import { renderProbeActive, reportRenderPhase } from '../debug/render-probe';

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

let lowResTarget: THREE.WebGLRenderTarget | null = null;
let blitScene: THREE.Scene | null = null;
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
  uniform float uDarkAdapt;  // eye dark-adaptation, 0 = none .. 1 = full dark
  uniform float uInspect;    // 1 = bypass PSX post-process (inspection snaps)
  uniform float uOutlineStrength; // ink-outline darkness (0 = off)
  uniform float uOutlineThresh;   // metres of depth-gap to start an edge
  uniform float uOutlineWidth;    // sample step, in low-res texels
  uniform vec2  uOutlineTexel;    // 1.0 / low-res target size (texel step)
  uniform float uAOStrength;      // fake contact-AO darkness (0 = off)
  uniform float uAORadius;        // AO sample radius, in low-res texels
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

  // One contact-AO axis. Samples BOTH sides:
  //   curv  = (eC-a) + (eC-b)  → concavity; a flat slope cancels to ~0.
  //   slope = |a - b|          → how tilted the surface is along this axis.
  // On the LOW-RES depth buffer a grazing surface is coarsely stepped, and the
  // steps spike curv even though the surface is flat — so the trigger is
  // RAISED by the local slope (the false curvature scales with it). Only
  // curvature BEYOND the slope-explained amount — a real contact / crevice —
  // darkens. Big residuals (silhouette pockets) fade out so they don't halo.
  float aoAxis(vec2 uv, vec2 off, float eC) {
    float a = linDepth(uv + off);
    float b = linDepth(uv - off);
    float curv = (eC - a) + (eC - b);
    float thr = 0.05 + abs(a - b) * 0.7;
    return smoothstep(thr, thr + 0.14, curv) * (1.0 - smoothstep(0.6, 1.2, curv));
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
      vec3 linear = texture2D(tDiffuse, uv).rgb;
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
    float r = texture2D(tDiffuse, uv + caOffset).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - caOffset).b;
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

    // INK OUTLINE — depth-discontinuity silhouettes drawn as dark contour
    // lines, so the untextured primitive geometry reads as a deliberate
    // DRAWING (cel-banding + outline = the etched-toon look). Sample linear
    // eye-Z at the 4 cross neighbours; where a neighbour falls away much
    // FARTHER than the centre, the centre sits on the near lip of a
    // silhouette → ink it. Placed AFTER dark-adapt (so its shadow-lift
    // can't erase the line) but BEFORE dither/quantize (so the line takes
    // the same PSX crunch as everything else). Off when uOutlineStrength==0.
    if (uOutlineStrength > 0.0) {
      vec2 o = uOutlineTexel * uOutlineWidth;
      float eC = linDepth(uv);
      float eL = linDepth(uv + vec2(-o.x, 0.0));
      float eR = linDepth(uv + vec2( o.x, 0.0));
      float eU = linDepth(uv + vec2(0.0,  o.y));
      float eD = linDepth(uv + vec2(0.0, -o.y));
      // Largest "neighbour is farther than me" gap = silhouette front lip.
      float gap = max(max(eL, eR), max(eU, eD)) - eC;
      // Threshold grows with distance (perspective stretches per-texel
      // depth gradients) so a grazing floor doesn't read as one big edge.
      float thresh = uOutlineThresh * (1.0 + eC * 0.35);
      float edge = smoothstep(thresh, thresh * 2.2, gap);
      // Don't ink the far void itself — only edges on near geometry.
      edge *= 1.0 - smoothstep(uDepthEndM, uFar, eC);
      col *= 1.0 - edge * uOutlineStrength;
    }

    // FAKE CONTACT AO — cheap screen-space crevice/contact darkening that grounds
    // objects (props, enemies, the hand) without any extra geometry pass: it just
    // re-reads the depth already in the buffer. Six taps on a hexagon at a radius
    // that shrinks with distance (so far surfaces don't smear). Placed before the
    // dither/quantize so the darkening takes the same PSX crunch as everything else.
    float eC = linDepth(uv);
    // AO is a NEAR-pool grounding effect — fade it out by ~7m (where depth
    // precision drops and the far is crushed to black anyway). This is also
    // exactly where the grazing-surface streaks lived.
    float aoFade = 1.0 - smoothstep(4.5, 7.5, eC);
    if (uAOStrength > 0.0 && uInspect < 0.5 && aoFade > 0.0) {
      // Three hexagon AXES (each samples ±, so 6 taps total). Radius shrinks
      // with distance so far surfaces don't smear.
      vec2 px = uOutlineTexel * uAORadius * (3.0 / (3.0 + eC));
      float occ =
          aoAxis(uv, vec2( 1.0,  0.0)  * px, eC)
        + aoAxis(uv, vec2( 0.5,  0.87) * px, eC)
        + aoAxis(uv, vec2(-0.5,  0.87) * px, eC);
      col *= 1.0 - clamp(occ / 3.0, 0.0, 1.0) * uAOStrength * aoFade;
    }

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
    vec3 tint = vec3(1.05, 1.00, 0.92);
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
const BLOOM_BLUR_STEPS = 2;     // H+V blur pairs (more = wider, softer halo)
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

// Ink outline (depth-discontinuity silhouettes) — makes the untextured
// primitive geometry read as a deliberate drawing. Tunable here.
const OUTLINE_STRENGTH = 0.85;  // 0 = off, 1 = pure-black line
const OUTLINE_THRESH = 0.12;    // metres of depth-gap before an edge starts
const OUTLINE_WIDTH = 1.3;      // sample step in low-res texels (line thickness)
let outlineEnabled = true;

// Fake contact AO — cheap screen-space grounding in the blit (no extra pass).
// Tunable knobs; defaults are deliberately gentle so it reads as grounding, not
// as the harsh point-light blobs it replaces.
const AO_STRENGTH = 0.55;   // darkness at full occlusion (0..1)
const AO_RADIUS = 2.5;      // sample radius in low-res texels
let aoEnabled = true;

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

/** Toggle the ink outline (A/B the depth-silhouette contour lines). */
export function setOutlineEnabled(on: boolean): void {
  outlineEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uOutlineStrength.value = on ? OUTLINE_STRENGTH : 0;
}

/** Toggle the fake contact-AO grounding (A/B it on the phone). */
export function setContactAOEnabled(on: boolean): void {
  aoEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uAOStrength.value = on ? AO_STRENGTH : 0;
}

/** Toggle bloom (so the look can be A/B'd / disabled on weak devices). */
export function setBloomEnabled(on: boolean): void {
  bloomEnabled = on;
  if (blitMaterial) blitMaterial.uniforms.uBloomStrength.value = on ? BLOOM_STRENGTH : 0;
}

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
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
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
      uDarkAdapt: { value: 0 },
      uInspect: { value: 0 },
      uOutlineStrength: { value: outlineEnabled ? OUTLINE_STRENGTH : 0 },
      uOutlineThresh: { value: OUTLINE_THRESH },
      uOutlineWidth: { value: OUTLINE_WIDTH },
      uOutlineTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
      uAOStrength: { value: aoEnabled ? AO_STRENGTH : 0 },
      uAORadius: { value: AO_RADIUS },
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
    blitMaterial.uniforms.uOutlineTexel.value.set(1 / nw, 1 / nh);
  });
}

/** Set the scene-render resolution fraction (clamped sane). Resizes the
 *  low-res target in place. Driven by the adaptive-resolution scaler; the
 *  blit upscales whatever size this target is, so lowering it trades crispness
 *  for fill-rate (and reads as more PS1, on-aesthetic). */
export function setPS1Scale(scale: number): void {
  ps1Scale = Math.min(0.6, Math.max(0.2, scale));
  if (!lowResTarget || !rendererRef) return;
  const nw = Math.max(1, Math.floor(rendererRef.domElement.width * ps1Scale));
  const nh = Math.max(1, Math.floor(rendererRef.domElement.height * ps1Scale));
  lowResTarget.setSize(nw, nh);
  resizeBloom();
  if (blitMaterial) blitMaterial.uniforms.uOutlineTexel.value.set(1 / nw, 1 / nh);
}

export function getPS1Scale(): number { return ps1Scale; }

/** Set the eye dark-adaptation amount (0..1) applied by the blit shader's
 *  shadow-lift. No-op until the pipeline is initialised. */
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
  // Reset renderer.info ONCE here so the per-frame draw/triangle counters
  // accumulate across both passes below (the scene render + the blit). main.ts
  // sets renderer.info.autoReset = false to hand us that control; without this
  // the perf overlay / probe would only ever see the 1-draw blit quad. A no-op
  // cost when info isn't being read.
  renderer.info.reset();

  // Feed the camera's near/far so the blit can linearise depth for the crush.
  if (blitMaterial && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const pc = camera as THREE.PerspectiveCamera;
    blitMaterial.uniforms.uNear.value = pc.near;
    blitMaterial.uniforms.uFar.value = pc.far;
  }

  // Profiler sub-phase timing — split the render system's cost into
  // prepass / scene / bloom / blit so "render: 11ms" becomes actionable.
  // Gated on renderProbeActive() so the performance.now() calls (and any
  // allocation) are skipped entirely for players. `pt` is the phase cursor.
  const prof = renderProbeActive();
  let pt = prof ? performance.now() : 0;

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
    if (viewmodelRoots.length) {
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      for (const vm of viewmodelRoots) {
        if (!vm.visible) continue;
        vm.traverse(setMeshDepthOnly);
        renderer.render(vm, camera);
        vm.traverse(restoreMeshColor);
      }
      renderer.autoClear = prevAutoClear;
      // Keep the depth values we just wrote; the scene render below
      // would otherwise auto-clear them and erase the pre-pass work.
      renderer.autoClearDepth = false;
    }
    if (prof) { const n = performance.now(); reportRenderPhase('render·prepass', n - pt); pt = n; }   // viewmodel depth pre-pass

    renderer.render(scene, camera);
    renderer.autoClearDepth = prevAutoClearDepth;
    if (prof) { const n = performance.now(); reportRenderPhase('render·scene', n - pt); pt = n; }      // main scene draw — incl. auto shadow-map passes (the bulk of the draws)

    // BLOOM passes — extract bright pixels, then ping-pong separable blur.
    // Builds the glow texture the blit composites. Skipped when disabled.
    if (bloomEnabled && bloomA && bloomB && bloomMesh && bloomExtractMat && bloomBlurMat && blitMaterial) {
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
    }
    if (prof) { const n = performance.now(); reportRenderPhase('render·bloom', n - pt); pt = n; }      // bright-extract + separable blur

    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
    if (prof) { const n = performance.now(); reportRenderPhase('render·blit', n - pt); pt = n; }        // fullscreen PSX post pass to the canvas
  } else {
    // Before initRenderPipeline runs (shouldn't happen in practice).
    renderer.render(scene, camera);
  }
  // NB: the gl.finish/readPixels GPU probe lives in frame-timing's frameEnd
  // (AFTER this system + the frame's timing is captured), so its synchronous
  // stall doesn't inflate the render system's CPU time or the frame's dt.
}
