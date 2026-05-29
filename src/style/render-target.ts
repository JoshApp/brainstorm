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

const PS1_SCALE = 0.4;

let lowResTarget: THREE.WebGLRenderTarget | null = null;
let blitScene: THREE.Scene | null = null;
let blitCamera: THREE.OrthographicCamera | null = null;
let blitMaterial: THREE.ShaderMaterial | null = null;

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
  uniform vec2 uResolution;
  uniform float uDarkAdapt;  // eye dark-adaptation, 0 = none .. 1 = full dark
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

    // CHROMATIC ABERRATION — red/blue split scaling with distance from center
    vec2 fromCenter = uv - 0.5;
    vec2 caOffset = fromCenter * 0.006;
    float r = texture2D(tDiffuse, uv + caOffset).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - caOffset).b;
    vec3 col = vec3(r, g, b);

    // EYE DARK-ADAPTATION (uDarkAdapt 0..1) — RAISE the shadow floor, don't
    // just multiply: a torchless corridor is near-black, and black × gain is
    // still black. An additive lift (with a slight cool scotopic tint) is what
    // actually makes the dark navigable, plus a mild gain on top. Applied
    // before posterize so the steps land on the lifted image. Rests at 0 in
    // torchlight, so lit rooms are untouched.
    col *= 1.0 + uDarkAdapt * 0.45;                       // mild gain
    col += uDarkAdapt * vec3(0.045, 0.060, 0.085);        // cool shadow lift

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

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function initRenderPipeline(renderer: THREE.WebGLRenderer) {
  const w = Math.max(1, Math.floor(renderer.domElement.width * PS1_SCALE));
  const h = Math.max(1, Math.floor(renderer.domElement.height * PS1_SCALE));

  lowResTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });

  blitScene = new THREE.Scene();
  blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  blitMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: lowResTarget.texture },
      uResolution: { value: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height) },
      uDarkAdapt: { value: 0 },
    },
    vertexShader: HORROR_BLIT_VERT,
    fragmentShader: HORROR_BLIT_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial);
  blitScene.add(blitMesh);

  window.addEventListener('resize', () => {
    if (!lowResTarget || !blitMaterial) return;
    const nw = Math.max(1, Math.floor(renderer.domElement.width * PS1_SCALE));
    const nh = Math.max(1, Math.floor(renderer.domElement.height * PS1_SCALE));
    lowResTarget.setSize(nw, nh);
    blitMaterial.uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
  });
}

/** Set the eye dark-adaptation amount (0..1) applied by the blit shader's
 *  shadow-lift. No-op until the pipeline is initialised. */
export function setDarkAdapt(amount: number): void {
  if (blitMaterial) blitMaterial.uniforms.uDarkAdapt.value = amount;
}

// ── Scene luminance metering (auto-exposure for eye dark-adaptation) ───────
// We read a small CENTRE block of the low-res scene target and average its
// perceived luminance — the reliable "how bright is what I'm looking at",
// accounting for every light source actually on screen. Metered on the RAW
// scene target (before the blit's dark-lift), so there's no feedback loop.
// Throttled + tiny region to keep the readback stall negligible on mobile.
const METER_EVERY = 6;          // frames between readbacks (~10Hz)
const METER_SIZE = 24;          // centre block side, in low-res target pixels
const meterBuf = new Uint8Array(METER_SIZE * METER_SIZE * 4);
let meterFrame = 0;
let lastLuminance = 0.12;

function meterLuminance(renderer: THREE.WebGLRenderer): void {
  if (!lowResTarget) return;
  const tw = lowResTarget.width;
  const th = lowResTarget.height;
  const w = Math.min(METER_SIZE, tw);
  const h = Math.min(METER_SIZE, th);
  const sx = Math.max(0, Math.floor((tw - w) / 2));
  const sy = Math.max(0, Math.floor((th - h) / 2));
  try {
    renderer.readRenderTargetPixels(lowResTarget, sx, sy, w, h, meterBuf);
  } catch {
    return;   // some mobile drivers reject mid-frame readback; keep last value
  }
  let sum = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    sum += 0.2126 * meterBuf[o] + 0.7152 * meterBuf[o + 1] + 0.0722 * meterBuf[o + 2];
  }
  lastLuminance = sum / (n * 255);
}

/** Perceived luminance (0..1) of the centre of the last metered frame. */
export function getSceneLuminance(): number {
  return lastLuminance;
}

export function renderWithStyle(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  if (lowResTarget && blitScene && blitCamera) {
    // Scene → low-res target, then the PSX blit (dither/quantize/CA/scanlines/
    // exposure) to screen. NOTE: tone mapping is disabled on render-target
    // passes, so all post + exposure must live in the blit shader.
    renderer.setRenderTarget(lowResTarget);
    renderer.clear();
    renderer.render(scene, camera);
    // Meter the raw scene (pre-lift) for eye dark-adaptation. Throttled.
    if ((meterFrame++ % METER_EVERY) === 0) meterLuminance(renderer);
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
  } else {
    // Before initRenderPipeline runs (shouldn't happen in practice).
    renderer.render(scene, camera);
  }
}
