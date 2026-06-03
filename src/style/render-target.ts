import * as THREE from 'three';

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
function setMeshDepthOnly(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) { m.colorWrite = false; m.depthTest = true; m.depthWrite = true; }
}
function restoreMeshColor(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) { m.colorWrite = true; m.depthTest = false; m.depthWrite = false; }
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

    // CHROMATIC ABERRATION — red/blue split scaling with distance from center
    vec2 fromCenter = uv - 0.5;
    vec2 caOffset = fromCenter * 0.006;
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
// Loosened slightly from the first pass (start 5→6, floor 0.18→0.23) so the
// near pool is a touch larger and the distance doesn't go quite as black.
const DEPTH_START_M = 6.0;    // near pool stays full-bright out to here
const DEPTH_END_M = 13.0;     // crushed to the floor by here
const DEPTH_FLOOR = 0.23;     // brightness at the far end (0 = pure black)
const DEPTH_AMOUNT = 0.8;     // 0 = off, 1 = full crush
let depthCrushEnabled = true;

// Fog inscatter (step 4) — the air itself glows the lights' colour, thickest
// in the distant fog. Reuses the blurred bright-pass as the glow source.
const INSCATTER_STRENGTH = 0.55;  // how much the haze picks up the light
const INSCATTER_START_M = 2.5;    // metres where the haze begins
const INSCATTER_END_M = 11.0;     // metres where it's fully thick
let inscatterEnabled = true;

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

  if (lowResTarget && blitScene && blitCamera) {
    // Scene → low-res target, then the PSX blit (dither/quantize/CA/scanlines/
    // exposure) to screen. NOTE: tone mapping is disabled on render-target
    // passes, so all post + exposure must live in the blit shader.
    renderer.setRenderTarget(lowResTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // VIEWMODEL DEPTH PASS — the held weapon / lamp / offhand render
    // depthTest:false (always on top of walls, no clip), which per GL means
    // they NEVER write depth. So the depth-keyed post passes below (distance
    // crush + fog inscatter) read the BACKGROUND depth behind the blade and
    // paint the corridor/stairwell/mob onto it. Re-render the viewmodels
    // DEPTH-ONLY (colorWrite off, test+write on) so the buffer carries their
    // true near depth and the post passes treat them as the foreground they
    // are. Colour is untouched (already drawn correctly above). Solid meshes
    // only — additive flame sprites (not isMesh) are skipped.
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
    }

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

    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
  } else {
    // Before initRenderPipeline runs (shouldn't happen in practice).
    renderer.render(scene, camera);
  }
}
