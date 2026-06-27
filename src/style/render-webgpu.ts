// Native WebGPU/TSL render path (the `webgpu` branch port).
//
// Replaces the stopgap direct renderer.render() in render-target.ts's WebGPU
// branch with Three's node-based RenderPipeline (formerly PostProcessing): the
// scene renders through a PassNode at the PSX low-res scale, then composites to
// the screen. This restores the low-res fill win the classic pipeline got from
// its 0.4× lowResTarget — without it the WebGPU path was rendering full-res.
//
// The PSX look (palette / dither / depth-crush / bloom / inscatter) gets chained
// onto outputNode as TSL effect nodes incrementally — see WEBGPU-MIGRATION.md.
// For now outputNode is the raw scene pass (so it renders correctly, just
// without the post look yet).

import * as THREE from 'three';
import { RenderPipeline } from 'three/webgpu';
import { pass, vec3, vec4, float, screenUV, screenCoordinate, dot, smoothstep, mix,
  luminance, texture, uniform, mrt, output, normalView,
  acesFilmicToneMapping, agxToneMapping, neutralToneMapping } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

// SSAO (?ssao=…) — GTAO contact-darkening from an MRT depth+normal G-buffer.
// Budget-first for mobile: low sample count + half-res of the already-0.4x pass.
//   ?ssao=1     → on, default visible strength
//   ?ssao=2.5   → on, explicit strength (dial it from the URL on the phone)
//   ?ssao=show  → AO-ONLY debug view (raw occlusion, so you can SEE it works)
const _ssaoParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ssao') : null;
const SSAO = _ssaoParam != null && _ssaoParam !== '0' && _ssaoParam !== 'off';
const SSAO_SHOW = _ssaoParam === 'show';
const _ssaoNum = _ssaoParam ? parseFloat(_ssaoParam) : NaN;
const AO_SAMPLES = 6;        // GTAO sample count (low → 3 directions, cheap)
const AO_RES_SCALE = 0.4;    // AO buffer res relative to the (0.4x) scene pass
const AO_RADIUS = 0.45;      // metres — visible but tighter than 0.7 (big radius = cache-incoherent, costly)
const AO_STRENGTH = (_ssaoNum > 0 && _ssaoNum !== 1) ? _ssaoNum : 1.6;   // darkening boost
let aoPassRef: any = null;   // live handle for the runtime setter / window.__ssao

/** Live SSAO tuning (DEV). strength = darkening, radius = spread in metres. */
export function setSSAO(strength?: number, radius?: number): void {
  if (!aoPassRef) return;
  if (strength != null) aoPassRef.scale.value = strength;
  if (radius != null) aoPassRef.radius.value = radius;
}
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__ssao = (strength?: number, radius?: number) => setSSAO(strength, radius);
}

let pipeline: RenderPipeline | null = null;
let scenePass: ReturnType<typeof pass> | null = null;
let resScale = 0.4;   // match the WebGL PS1_SCALE_DEFAULT (0.4) — chunkier than 0.5
// ?raw=1 — ISOLATION: bypass the whole PSX grade (bloom/crush/inscatter/vignette/
// quantize), output the bare exposed scene. Tells us if the haze is the GRADE or
// something upstream (lighting / fog / material response).
const RAW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('raw') === '1';
// Runtime grade bypass (RAW initial) — the per-pass GPU probe flips this to price
// the whole PSX grade (CA/expose/crush/dither) by difference. Rebuilds on change.
let gradeBypass = RAW;
export function setGradeBypass(on: boolean): void {
  if (on === gradeBypass) return;
  gradeBypass = on;
  rebuildWebGPUPipeline();
}
// Scene-only bypass (probe) — outputs the bare scene sample so full−sceneOnly
// prices the whole post stack vs the scene render.
let sceneOnly = false;
export function setSceneOnly(on: boolean): void {
  if (on === sceneOnly) return;
  sceneOnly = on;
  rebuildWebGPUPipeline();
}
// TONEMAP — the response curve that turns linear HDR light into display values.
// The WebGL/main path got this for free from renderer.toneMapping = ACESFilmic;
// the WebGPU path runs NoToneMapping (main.ts) so WITHOUT this node bright torch-
// lit surfaces HARD-CLIP and stay saturated (the neon-yellow blade / shaft that
// doesn't match main). A real tonemap adds a filmic SHOULDER: highlights roll off
// and desaturate toward white instead of clipping to a primary.
//   aces    — matches the main/WebGL reference (what we're trying to get back to).
//   neutral — Khronos PBR-Neutral; gentler, preserves hue/saturation better.
//   agx     — strong filmic desaturation; moodiest, can mute the fire too much.
//   none    — bypass (the old hard-clip look) for A/B.
// Override live on the phone with ?tonemap=aces|neutral|agx|none — isolates the
// variable so you can eyeball the curve alone before touching exposure/bloom.
type ToneMap = 'aces' | 'neutral' | 'agx' | 'none';
const TONEMAP: ToneMap = ((): ToneMap => {
  const q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tonemap');
  return (q === 'aces' || q === 'neutral' || q === 'agx' || q === 'none') ? q : 'aces';
})();
const TONEMAP_FN: Record<Exclude<ToneMap, 'none'>, (c: any, e: any) => any> = {
  aces: acesFilmicToneMapping as any,
  neutral: neutralToneMapping as any,
  agx: agxToneMapping as any,
};

// Grade feel — trial-and-error toward the original's crushed blacks + colour.
// NOTE: with a real TONEMAP wired (above) the curve now supplies most of the
// contrast, so the manual CONTRAST pow is dialled back from the no-tonemap-era
// 1.18 — too much on top of the shoulder double-crushes the blacks.
const SATURATION = 1.15;   // >1 = punchier colour (tonemap desaturates highs, so keep some)
const CONTRAST = TONEMAP === 'none' ? 1.18 : 1.04;  // tonemap carries the curve now
let bloomEnabled = true;
// Bloom: subtle + HIGH threshold so ONLY bright sources (flames, glows, runes)
// bloom — not the whole image. Tune via the consts.
const BLOOM_STRENGTH = 0.08, BLOOM_RADIUS = 0.3, BLOOM_THRESHOLD = 1.0;
const BLOOM_RES_SCALE = 0.5;   // bloom mip-chain res vs the full buffer — scene is 0.4x, so bloom at full was over-resolved
// EXPOSURE — r184 dropped useLegacyLights, so ambient/emissive/point intensities
// read MUCH brighter than the legacy-tuned values → the whole dungeon lit pale.
// Crush exposure hard to restore the dark-with-pools-of-torchlight look. (Quick
// global knob; the deeper fix is re-tuning ambient/emissive for r184 units.)
// With a TONEMAP shoulder in front of the output, highlights roll off instead of
// clipping. But side-by-side vs the WebGL/main reference the WebGPU scene still
// read too bright in the near field, so exposure comes back DOWN under the
// tonemap (0.6 → 0.42). Still the global brightness knob.
const EXPOSURE = TONEMAP === 'none' ? 0.5 : 0.37;
// DEPTH CRUSH — fade to near-black with camera distance (DELVE's "darkness is
// the baseline" rule; the original did this in HORROR_BLIT_FRAG from linearized
// depth). Metres from camera. Tune on the dev server.
// Aligned to the WebGL/main reference (render-target.ts DEPTH_START/END/FLOOR =
// 6/12/0.16). The WebGPU re-guess (5/28/0.04) faded far too gently — mid-distance
// walls stayed lit out to 28m, which was most of the "too bright" gap vs WebGL.
const CRUSH_START_M = 6, CRUSH_END_M = 12, CRUSH_FLOOR = 0.16;
// FOG INSCATTER — the air glows the lights' colour, thicker with distance. The
// original reused the BLOOM texture (the blurred bright pass) as the haze colour
// × a depth weight, so it's coloured by whatever lights are near. We do the same.
const INSCATTER_STRENGTH = 0.06, INSCATTER_START_M = 8, INSCATTER_END_M = 30;   // subtle, was a fog-out

// PSX GRADE TAIL — ported from the WebGL blit (render-target.ts) so WebGPU gets
// the same lo-fi crunch: chromatic aberration, dither, hard colour quantize,
// scanlines, amber tint. All but CA are pure ALU in the final fullscreen pass;
// CA adds 2 scene-texture taps. Matches the WebGL literals.
const CA_AMOUNT = 0.004;            // radial red/blue split (was reading as a bug above this)
const QUANTIZE_LEVELS = 32.0;       // hard PSX colour steps
const SCANLINE_DARKEN = 0.96;       // every other row
const AMBER_TINT: readonly [number, number, number] = [1.025, 1.0, 0.96];
const VIGNETTE = 0.22;              // matched toward the WebGL blit's 0.20 (was 0.55)

// ORDERED 4x4 BAYER dither texture — the exact matrix the WebGL blit used (index
// i = y*4 + x). Sampled NEAREST + REPEAT in screen space, it's a STABLE halftone
// locked to the screen, so the darks get a structured pattern instead of the
// random film-grain that interleaved-gradient noise produced. One tiny tex tap.
const BAYER_TEX = (() => {
  const M = [0, 12, 3, 15, 8, 4, 11, 7, 2, 14, 1, 13, 10, 6, 9, 5];
  const data = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const v = Math.round((M[i] / 16) * 255);   // m/16 → 0..0.9375 stored as byte
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, 4, 4);  // RGBAFormat / UnsignedByte (filterable everywhere)
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

// EYE DARK-ADAPTATION — the reveal is DRIVEN by dark-adaptation.ts (the same 0..1
// ramp the WebGL blit uses), NOT always-on. When the eye lingers in a dark,
// torchless area the value RAMPS UP (~4s) and the grade lifts the near-black so
// FORM emerges; stepping back toward torchlight RAMPS DOWN fast (~0.1s) and
// re-blinds you. render-target.ts's setDarkAdapt() pushes the value here each
// frame (so the SAME signal drives WebGL and WebGPU). A live uniform — no pipeline
// rebuild. The global brightness ramp rides the AmbientLight (systems.ts); this is
// the darkness-WEIGHTED shader lift on top, which reveals form in the near-black.
const darkAdaptNode = (uniform as any)(0);
// ?darkadapt=<0..1> PINS the value (ignores the live ramp) — to inspect the lift
// in a lit scene without walking into the dark. Undefined → the live ramp drives it.
const ADAPT_PIN = (() => {
  const q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('darkadapt');
  const n = q == null || q === false ? NaN : parseFloat(q);
  return Number.isFinite(n) ? n : null;
})();
if (ADAPT_PIN != null) (darkAdaptNode as any).value = ADAPT_PIN;
/** Drive the WebGPU eye dark-adaptation (0..1). Called from setDarkAdapt(). */
export function setWebGPUDarkAdapt(v: number): void {
  if (ADAPT_PIN == null) (darkAdaptNode as any).value = v;
}
// The reveal is the GATED DEEP-DARK gain we tuned earlier — surgical: only the
// truly near-black gets amplified (a high multiply that pulls faint form out of
// the void), so it CAN'T wash the mid-dark like the broad WebGL darkness-weighted
// formula did on WebGPU's higher ambient. Now RAMPED by the dark-adapt value
// instead of always-on: 0 in torchlight (off), 1 in a dark hall (full reveal).
// SOFTEN the dark, don't over-expose. As the eye adapts (darkAdaptNode 0→1) we
// RAISE THE FLOOR of the crushed shadows/fog and gently amplify their form —
// darkness-WEIGHTED so the LIT side is untouched (no overexposing the bright). The
// dark loosens, fog stops drowning, form swims up; step to light and it snaps back.
// NOTE: these are LINEAR-space values and the pipeline applies sRGB AFTER, which
// hugely amplifies small darks (linear 0.024 → ~0.17 display). So the additive
// floor-raise must be TINY in linear to read as a subtle display lift.
const ADAPT_LIFT: readonly [number, number, number] = [0.0025, 0.0024, 0.0021];  // additive floor-raise (faint warm-neutral), linear — sRGB makes this a gentle display lift
const ADAPT_GAIN = 0.1;       // gentle multiply on the darks — pulls their faint form up a touch (space-stable)
const ADAPT_CUTOFF = 0.30;    // LINEAR brightness above which the eye lift fades to 0 — keep it to the genuinely crushed shadows

/** Set the scene-render resolution scale (the PSX downscale). 0.5 = half-res. */
export function setWebGPUResolutionScale(s: number): void {
  resScale = s;
  scenePass?.setResolutionScale(s);
}

/** Toggle bloom (wired to the BLOOM setting). Rebuilds the pipeline next frame. */
export function setWebGPUBloomEnabled(on: boolean): void {
  if (on === bloomEnabled) return;
  bloomEnabled = on;
  rebuildWebGPUPipeline();
}

/** Drop the pipeline so the next renderWebGPU rebuilds it. */
export function rebuildWebGPUPipeline(): void { pipeline = null; scenePass = null; }

// A renderer resize (window or the PIXEL DENSITY / DPR apply, which dispatches
// 'resize') invalidates the RenderPipeline's pass targets — rebuild so a settings
// change doesn't freeze the image. Harmless in WebGL mode (pipeline stays null).
if (typeof window !== 'undefined') window.addEventListener('resize', rebuildWebGPUPipeline);

/* eslint-disable @typescript-eslint/no-explicit-any */
function ensurePipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  if (pipeline) return;
  scenePass = pass(scene, camera);
  scenePass.setResolutionScale(resScale);

  // SSAO: render normals into a second MRT target so GTAO can read depth+normal.
  if (SSAO) (scenePass as any).setMRT((mrt as any)({ output, normal: normalView }));

  // CHUNKY PS1 UPSCALE — the low-res pass target defaults to LinearFilter, so the
  // upscale to screen is SMOOTH: soft walls, soft edges, washed-out PS1 pixels.
  // WebGL upscales its low-res target with NEAREST (sharpBilinear off by default)
  // → hard chunky texels, the pronounced PS1 look. Match it: nearest-filter the
  // pass output so the upscale snaps to texel centres. (Re-applied every rebuild —
  // a resize rebuilds the pipeline — so it survives resolution-scale changes.)
  const rt: any = (scenePass as any).renderTarget;
  if (rt?.texture) {
    rt.texture.magFilter = THREE.NearestFilter;
    rt.texture.minFilter = THREE.NearestFilter;
    rt.texture.generateMipmaps = false;
    rt.texture.needsUpdate = true;
  }

  // CHROMATIC ABERRATION — radial red/blue split on the scene sample, matching the
  // WebGL blit: red sampled outward, blue inward, by CA_AMOUNT × distance-from-
  // centre. 2 extra taps of the (low-res) scene texture; all downstream is ALU.
  // Done on the raw scene (pre-expose/bloom) exactly as the WebGL path did it.
  const tex: any = SSAO ? (scenePass as any).getTextureNode('output') : (scenePass as any).getTextureNode();
  const suv: any = screenUV as any;
  const caOff: any = suv.sub(0.5).mul(CA_AMOUNT);
  let sceneCA: any = (vec3 as any)(
    tex.sample(suv.add(caOff)).r,
    tex.sample(suv).g,
    tex.sample(suv.sub(caOff)).b,
  );

  // SSAO — multiply contact occlusion into the scene BEFORE expose/bloom, so
  // crevices + object bases sit in their own dark (grimdark: only darkens). The
  // GTAO node runs its own half-res pass off the MRT depth+normal.
  let ssaoAoR: any = null;
  if (SSAO) {
    const aoPass: any = (ao as any)(
      (scenePass as any).getTextureNode('depth'),
      (scenePass as any).getTextureNode('normal'),
      camera,
    );
    aoPass.samples.value = AO_SAMPLES;
    aoPass.resolutionScale = AO_RES_SCALE;
    aoPass.radius.value = AO_RADIUS;
    aoPass.scale.value = AO_STRENGTH;
    aoPassRef = aoPass;
    ssaoAoR = aoPass.getTextureNode().r;
    sceneCA = sceneCA.mul(ssaoAoR);
  }

  // EXPOSE FIRST. r184's brighter lighting must be brought into range BEFORE
  // bloom, or bloom (threshold 1.0) catches half the scene and veils everything
  // in a desaturated white haze. Exposing first means only the genuinely-bright
  // sources (flames) clear the threshold → tight, subtle bloom.
  //
  const exposed: any = sceneCA.mul(float(EXPOSURE));

  // Exposed scene + native bloom, additive, LINEAR. Bloom optional (BLOOM
  // setting); the bloomPass also feeds the fog inscatter below.
  const bloomPass = bloomEnabled ? bloom(exposed, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD) : null;
  if (bloomPass) {
    // PERF: BloomNode sizes its 5-mip chain to the FULL drawing buffer (then /2),
    // but the scene is rendered at resScale (0.4x) — so bloom was processing MORE
    // pixels than the scene has. Scale its targets to ~match the scene; the soft
    // glow hides the lower res (PS1-appropriate). Override the instance setSize so
    // the pipeline's full-res call gets scaled down. ~the breakdown's 1.8ms slice.
    const bn: any = bloomPass;
    if (typeof bn.setSize === 'function') {
      const orig = bn.setSize.bind(bn);
      bn.setSize = (w: number, h: number) =>
        orig(Math.max(1, Math.round(w * BLOOM_RES_SCALE)), Math.max(1, Math.round(h * BLOOM_RES_SCALE)));
    }
  }
  let lit: any = bloomPass ? exposed.add(bloomPass) : exposed;

  // DEPTH CRUSH — multiply colour toward CRUSH_FLOOR with camera distance, in
  // linear space (a darkening multiply). getViewZNode() is camera-space Z
  // (negative); negate → metres from camera.
  const distM = (scenePass as any).getViewZNode().negate();
  const crush = (mix as any)(float(1.0), float(CRUSH_FLOOR), (smoothstep as any)(CRUSH_START_M, CRUSH_END_M, distM));
  lit = lit.mul(crush);

  // FOG INSCATTER — add the bloom colour as glowing air, weighted by distance.
  // Added AFTER crush so the haze isn't darkened by it (surfaces fade, air glows).
  // Only when bloom is on (it's the haze colour source).
  if (bloomPass) {
    const fogW = (smoothstep as any)(INSCATTER_START_M, INSCATTER_END_M, distM).mul(INSCATTER_STRENGTH);
    lit = lit.add((bloomPass as any).mul(fogW));
  }

  // ISOLATION: ?raw=1 outputs the bare exposed scene (no grade) so we can tell if
  // the haze is the grade vs upstream (lighting/fog/material).
  const build = (node: any) => {
    pipeline = new RenderPipeline(
      renderer as unknown as ConstructorParameters<typeof RenderPipeline>[0],
      node as ConstructorParameters<typeof RenderPipeline>[1],
    );
  };
  // ?ssao=show — output the raw occlusion (grayscale) so the AO is unmistakable.
  if (SSAO_SHOW && ssaoAoR) { build((vec4 as any)((vec3 as any)(ssaoAoR), 1.0)); return; }
  // Scene-only bypass — output the bare scene sample (skips ALL post: expose,
  // bloom, crush, inscatter, grade). The probe diffs full vs this to price the
  // post stack vs the scene render (geometry + lighting + material shaders).
  if (sceneOnly) { build((vec4 as any)(sceneCA, 1.0)); return; }
  if (gradeBypass) { build((vec4 as any)((lit as any).rgb, 1.0)); return; }

  // ── Colour grade + PSX tail, in display space after the tonemap below ──
  // The stylized cel light-step is handled per-material (banded-lighting-webgpu.ts
  // patches the node lighting model), NOT by quantizing the whole image here — a
  // full-image quantize banded materials + light together into harsh radial bands.
  // So the final QUANTIZE below is the PSX *colour-depth* crunch (32 levels), which
  // is a different thing from cel-banding the light and is safe on the graded image.
  const _vec4 = vec4 as any, _float = float as any, _dot = dot as any;
  const _uv = screenUV as any;

  let col: any = (lit as any).rgb;
  // ── TONEMAP — linear HDR → display, with a filmic shoulder. Applied AFTER
  // expose+bloom+crush+inscatter (all linear-HDR ops) and BEFORE the display-space
  // grade below. Exposure is already baked into `lit` (the pre-bloom .mul(EXPOSURE)
  // expose-before-bloom step), so we pass 1.0 here — don't double-expose. With
  // renderer.toneMapping = NoToneMapping the pipeline won't re-apply a curve; it
  // just does the final sRGB OETF after this node.
  if (TONEMAP !== 'none') col = TONEMAP_FN[TONEMAP](col, _float(1.0));
  // SATURATION — punchier colour (push away from luminance).
  const lum = (luminance as any)(col);
  col = (mix as any)((vec3 as any)(lum, lum, lum), col, SATURATION);
  // CONTRAST / BLACK-CRUSH — pow > 1 darkens mids/darks hard, keeps highlights.
  col = col.pow(_float(CONTRAST));

  // ── EYE DARK-ADAPTATION — soften the dark (see ADAPT_* notes above) ──
  // darkW = 1 in shadow/fog, ramping to 0 by ADAPT_CUTOFF brightness, so the LIT
  // side is left exactly as-is (no overexposure). Within the darks we raise the
  // floor (additive — the crush/fog loosens) and gently amplify (multiply — form
  // swims up), all scaled by darkAdaptNode (0 in torchlight, 1 in a dark hall).
  {
    const lum: any = col.r.max(col.g).max(col.b);
    const darkW: any = _float(1.0).sub((smoothstep as any)(_float(0.05), _float(ADAPT_CUTOFF), lum));
    const a: any = (darkAdaptNode as any).mul(darkW);   // adapt, restricted to the darks
    col = col.add((vec3 as any)(ADAPT_LIFT[0], ADAPT_LIFT[1], ADAPT_LIFT[2]).mul(a));
    col = col.mul(_float(1.0).add(a.mul(_float(ADAPT_GAIN))));
  }

  // ── PSX GRADE TAIL (ported from the WebGL blit) ──
  // DITHER — ordered 4x4 Bayer, sampled NEAREST+REPEAT in screen space (BAYER_TEX
  // above). Screen-locked structured pattern → a stable halftone in the darks,
  // NOT random grain. Centred (sample − 0.5) at amplitude ~1/24, matching WebGL.
  // DITHER + QUANTIZE done in ~display (GAMMA) space, NOT linear. The pipeline
  // applies the real sRGB OETF AFTER this node, so quantizing in linear put the
  // first step at linear 1/32 → ~19% display = harsh "rasterized" dark bands.
  // Encode to gamma, dither + quantize there (even perceptual steps, fine in the
  // darks), decode back; the pipeline's sRGB then lands it. This both softens the
  // dark rasterization AND makes form-emergence a smooth fine halftone.
  const px: any = screenCoordinate as any;
  const bayer: any = (texture as any)(BAYER_TEX, px.div(_float(4.0))).r;
  let disp: any = col.max(_float(0.0)).pow(_float(1.0 / 2.2));                 // linear → gamma
  disp = disp.add(bayer.sub(0.5).mul(_float(1.0 / 24.0)));                     // dither in gamma space
  disp = disp.mul(_float(QUANTIZE_LEVELS)).add(0.5).floor().div(_float(QUANTIZE_LEVELS));  // quantize
  col = disp.max(_float(0.0)).pow(_float(2.2));                               // gamma → linear
  // SCANLINES — every other output row slightly darker.
  const scan: any = (px.y.mod(_float(2.0)).lessThan(_float(1.0)) as any)
    .select(_float(1.0), _float(SCANLINE_DARKEN));
  col = col.mul(scan);
  // AMBER TINT — push the whole image warm (no G/B darken, just the warm bias).
  col = col.mul((vec3 as any)(AMBER_TINT[0], AMBER_TINT[1], AMBER_TINT[2]));
  // VIGNETTE — mild edge darkening (matched toward the WebGL blit).
  const d = _uv.sub(0.5);
  col = col.mul(_float(1.0).sub(_dot(d, d).mul(VIGNETTE)));
  build(_vec4(col, 1.0));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// FRAMES-IN-FLIGHT cap. renderAsync is async; submitting fire-and-forget let the
// CPU run arbitrarily far ahead of the GPU, so present latency wandered frame to
// frame (steady fps, but judder). We DON'T touch the rAF cadence to fix this —
// the pacer's refresh estimate reads rAF intervals, so delaying rAF made it read
// garbage. Instead: when MAX_IN_FLIGHT frames are already queued, SKIP this
// submit (show the last frame). rAF keeps firing at the display rate (hertz stays
// correct); the GPU queue is bounded; and on a display faster than the GPU can
// feed, this naturally paces to the GPU's rate instead of piling up.
// 1, not 2: when the GPU is the bottleneck, a 2-deep queue submits two frames
// back-to-back to fill it then drains — a BURSTY present cadence (the 4ms↔40ms
// "wait" jitter). One in flight submits exactly once per GPU completion → even
// cadence. The cost is a little GPU idle between completion and the next rAF (the
// loop is rAF-driven) — slightly lower peak fps, but smooth. NOTE: unlike the
// await approach, SKIPPING doesn't stall the CPU, so this doesn't tank fps.
const MAX_IN_FLIGHT = 1;
let inFlight = 0;

/** Render one frame through the native WebGPU pipeline (skips if the GPU is behind). */
export function renderWebGPU(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  ensurePipeline(renderer, scene, camera);
  if (import.meta.env.DEV && typeof window !== 'undefined' && !(window as any).__scenePassInfo) {
    (window as any).__scenePassInfo = () => {
      const rt: any = (scenePass as any)?.renderTarget;
      const buf = (renderer as any).getDrawingBufferSize?.(new THREE.Vector2()) ?? { x: 0, y: 0 };
      const tex = rt?.texture?.image ?? rt?.textures?.[0]?.image;
      return { passW: rt?.width ?? tex?.width, passH: rt?.height ?? tex?.height, bufW: buf.x, bufH: buf.y, resScale };
    };
  }
  // While the warm pass is driving its own renders (warmRenderWebGPU), the main loop
  // must NOT also submit — two concurrent renderAsync on one pipeline race. The warm
  // runs behind the load cover, so skipping here just holds the covered frame.
  if (warmingUp) return;
  if (frameSyncOn && inFlight >= MAX_IN_FLIGHT) return;   // GPU behind — drop this submit
  // Reset per frame so renderer.info reflects THIS frame's total (the pipeline's
  // passes accumulate into it); without this it climbs without bound.
  renderer.info.reset();
  // DEV: bracket each PSX render in a WebGPU validation error scope so a render-pass
  // hazard (e.g. the reported 'output texture writable+sampled in same scope') is
  // caught AT the render, logged with the frame's draw count, and stored on
  // window.__gpuErrors — these don't reliably surface in the devtools console, and
  // this localizes them to the PSX pass + the frame that triggered them.
  const dev: any = import.meta.env.DEV ? (renderer as any).backend?.device : null;
  if (dev) dev.pushErrorScope('validation');
  inFlight++;
  void (pipeline as unknown as { renderAsync: () => Promise<void> }).renderAsync()
    .then(() => {
      inFlight--;
      if (dev) dev.popErrorScope().then((err: any) => {
        if (err) {
          const msg = String(err.message || err);
          const draws = (renderer as any).info?.render?.drawCalls;
          // eslint-disable-next-line no-console
          console.error('[psx gpu-error] frame draws=' + draws + ' :: ' + msg.slice(0, 280));
          const w = window as any; (w.__gpuErrors = w.__gpuErrors || []).push(msg);
        }
      }).catch(() => {});
    }, () => { inFlight--; if (dev) dev.popErrorScope().catch(() => {}); });
}

// ── Warm render ─────────────────────────────────────────────────────────────
// Compile pipelines by rendering through the REAL PSX pipeline, so the compiled
// pipeline state matches the live render EXACTLY (the internal HDR scene-pass target
// format, the bloom/grade passes — everything). compileAsync warms the wrong target
// format (the canvas), so its pipelines get thrown away + recompiled on first real
// draw — that's the residual first-use stutter. This renders whatever is in `scene`
// (the loaded floor + any warm subjects added by the caller) a few times, awaiting
// each submit, with the main loop gated off via `warmingUp`. MUST run behind the load
// cover — it renders the warm subjects to the (covered) canvas.
let warmingUp = false;
export function isWarmingUp(): boolean { return warmingUp; }
export async function warmRenderWebGPU(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, passes = 3,
): Promise<void> {
  ensurePipeline(renderer, scene, camera);
  warmingUp = true;
  try {
    for (let i = 0; i < passes; i++) {
      renderer.info.reset();
      await (pipeline as unknown as { renderAsync: () => Promise<void> }).renderAsync();
    }
  } catch { /* best-effort — a driver hiccup must not brick the load */ } finally {
    warmingUp = false;
  }
}

// ?noframesync=1 reverts to pure fire-and-forget (no in-flight cap) for an A/B.
const frameSyncOn = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('noframesync') !== '1';
