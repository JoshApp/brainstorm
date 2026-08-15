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
import { normalizeReadback } from './readback';
import { RenderPipeline } from 'three/webgpu';
import { pass, vec2, vec3, vec4, float, screenUV, screenCoordinate, dot, smoothstep, mix,
  luminance, texture, uniform, mrt, output, normalView, max as tslMax,
  acesFilmicToneMapping, agxToneMapping, neutralToneMapping } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import type { DelveRenderer } from '../scene/create-renderer';
import { setBundleMainCamera } from '../scene/bundle-pass-order';
import { getActiveGrade, setActiveGrade, setGradeOverrides, gradeNames, activeGradeName } from './grade-presets';

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

// ── INK — the contour that makes composed primitives read as DRAWN ──────────
//
// The problem this exists to solve: DELVE's geometry is boxes, cylinders and
// lathes composed in code, with no textures. Untextured primitives read as
// UNFINISHED 3D — the eye has nothing to grab but shading, and shading alone
// says "untextured", not "stylised". Every game that gets away with primitive
// geometry (Hollow Knight in 2D, Sable, Okami, Borderlands in 3D) declares the
// forms DRAWN, and the cheapest, oldest way to declare that is a line around
// them.
//
// So: a contour on DISCONTINUITY, sampled from the same depth+normal G-buffer
// SSAO already renders. Two edge sources, because one is not enough —
//
//   DEPTH edge   catches silhouettes: where a form ends and something further
//                away begins. This is the outline proper. Compared RELATIVE to
//                the centre depth, because a fixed threshold on nonlinear depth
//                inks everything near the camera and nothing past 3 metres.
//   NORMAL edge  catches CREASES: where two faces of the same solid meet. This
//                is what separates a box's front from its side when both are
//                lit the same, and it is what makes a composed model read as
//                one object with structure rather than as a flat blob.
//
// Applied pre-exposure, in the same place SSAO multiplies in, so the line lives
// in the world and gets exposed and graded with everything else. (Applying it
// after the grade gives a crisper, more graphic line — worth trying as a second
// preset knob if the in-world version reads too soft.)
//
// It is DARKENING ONLY, like the AO: grimdark never brightens. A white contour
// on black would read as sci-fi.
let inkStrength = 0;          // 0 = off. The pipeline rebuilds when this crosses 0.
const inkStrengthNode: any = (uniform as any)(0);
const inkWidthNode: any = (uniform as any)(0.0016);    // UV units, so it is resolution-independent
const inkDepthNode: any = (uniform as any)(2.2);       // how hard a depth step must be to ink
const inkNormalNode: any = (uniform as any)(1.0);      // how hard a crease must be to ink
/** True when the pipeline must render the depth+normal G-buffer for ink. */
function inkNeedsMRT(): boolean { return inkStrength > 0; }

/**
 * Turn the ink on/off and tune it. `strength` 0 disables it (and drops the MRT
 * again, so a look without ink pays nothing for the feature existing).
 *
 * Rebuilds the pipeline ONLY when the G-buffer requirement flips — the width
 * and threshold knobs are live uniforms, so dialling the line on a phone is
 * free, and only switching ink on or off costs a rebuild.
 */
export function setWebGPUInk(
  strength: number, opts?: { width?: number; depth?: number; normal?: number },
): void {
  const wasOn = inkNeedsMRT();
  inkStrength = Math.max(0, strength);
  inkStrengthNode.value = inkStrength;
  if (opts?.width !== undefined) inkWidthNode.value = opts.width;
  if (opts?.depth !== undefined) inkDepthNode.value = opts.depth;
  if (opts?.normal !== undefined) inkNormalNode.value = opts.normal;
  if (wasOn !== inkNeedsMRT()) rebuildWebGPUPipeline();
}

/** Live SSAO tuning (DEV). strength = darkening, radius = spread in metres. */
export function setSSAO(strength?: number, radius?: number): void {
  if (!aoPassRef) return;
  if (strength != null) aoPassRef.scale.value = strength;
  if (radius != null) aoPassRef.radius.value = radius;
}
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__ssao = (strength?: number, radius?: number) => setSSAO(strength, radius);
  // DEV: the honest presented-frame counter (bumps only on a REAL canvas submit — not on
  // pacer-skipped rAFs, not on warm renders). The only page-observable way to detect a
  // "canvas frozen, sim alive" backpressure stall from instrumentation.
  (window as any).__presentedFrames = () => presentedFrameCount();
  // DEV: latest native GPU frame ms (timer-query where supported) — the number the
  // adaptive scaler feeds on. For quick A/B costing from the console/CDP.
  (window as any).__gpuMs = () => lastWebGPUGpuMs();
  // DEV: submit-skip tally ring — who is holding the canvas still (warmingUp vs
  // inFlight backpressure), with second-resolution timestamps. __skipStats() reads.
  (window as any).__skipStats = () => skipLog.slice();
}
const skipLog: Array<{ atMs: number; reason: string; n: number }> = [];
function tallySkip(reason: string): void {
  const atMs = Math.round(performance.now() / 1000) * 1000;   // bucket per second
  const last = skipLog[skipLog.length - 1];
  if (last && last.atMs === atMs && last.reason === reason) { last.n++; return; }
  skipLog.push({ atMs, reason, n: 1 });
  if (skipLog.length > 400) skipLog.shift();
}

let pipeline: RenderPipeline | null = null;
let scenePass: ReturnType<typeof pass> | null = null;
let resScale = 0.4;   // scene-render scale (the adaptive scaler nudges this via setWebGPUResolutionScale)
let tsInFlight = false;   // throttle the async GPU-timestamp resolve
// Latest resolved GPU frame ms (native timestamp). The adaptive-resolution scaler
// (scene/adaptive-resolution.ts) reads this on WebGPU because its usual frame-time
// signal is BLIND here: MAX_IN_FLIGHT=1 skip-pacing pins the rAF interval to vsync
// even when the GPU is overloaded, so only the real GPU timestamp reflects the load.
let lastGpuMs = 0;
/** Latest GPU frame ms from native timestamps (0 until one resolves). */
export function lastWebGPUGpuMs(): number { return lastGpuMs; }

// LIVE presented-frame counter — bumps only when the live loop actually SUBMITS
// a frame to the canvas (not on pacer-skipped rAFs, not on warm renders). The
// covers use it to hold until a CLEAN frame is really on screen: "wait two
// rAFs" is NOT enough — under the frame cap both rAFs can be skipped draws,
// and the veil then drops on the stale last-warm-frame canvas (the "bright
// spheres before the title" artifact).
let presentedFrames = 0;
export function presentedFrameCount(): number { return presentedFrames; }
/** Resolve once `n` more live frames have PRESENTED (or timeoutMs passes —
 *  never strand a cover on a hidden tab where rAF stops). */
export function waitForPresentedFrames(n = 1, timeoutMs = 1500): Promise<void> {
  const target = presentedFrames + n;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = (): void => {
      if (presentedFrames >= target || performance.now() - t0 > timeoutMs) { resolve(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}
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
// Inscatter / depth-crush — REAL pipeline toggles (rebuild on change) so the
// GPU-attribution "blit post-fx" probe prices what it claims to (the old
// render-frame flags went inert in the WebGL removal). Always on in play.
let inscatterOn = true;
export function setWebGPUInscatterEnabled(on: boolean): void {
  if (on === inscatterOn) return;
  inscatterOn = on;
  rebuildWebGPUPipeline();
}
let crushOn = true;
export function setWebGPUDepthCrushEnabled(on: boolean): void {
  if (on === crushOn) return;
  crushOn = on;
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
// SATURATION / CONTRAST now live per-preset (grade-presets.ts) — the grade is
// data the design layer authors, not hard-coded here. TONEMAP still supplies the
// filmic curve; presets are tuned for the default `aces` path.
let bloomEnabled = true;
// Bloom: subtle. STRENGTH/RADIUS stay global; the THRESHOLD is per-preset (lower
// = more edges/props catch a halo → silhouette separation). Tune via presets.
const BLOOM_STRENGTH = 0.08, BLOOM_RADIUS = 0.3;
const BLOOM_RES_SCALE = 0.5;   // bloom mip-chain res vs the full buffer — scene is 0.4x, so bloom at full was over-resolved
// ?leanbloom=1 — LEAN bloom: replace UnrealBloom's 5-mip chain (~11 render targets)
// with bright-extract (ALU) + ONE separable gaussian blur (~3 RTs). Far fewer
// render-target switches — the #1 tile-GPU bandwidth lever (research) — for DELVE's
// SUBTLE glow (strength 0.08), which doesn't need 5 mip levels. Off by default until
// eyeballed on a phone; the look should be ~identical at this strength.
let LEANBLOOM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('leanbloom') === '1';
// ?nobrightscale=1 — A/B the bright-extract resolution fix (see the note where
// it is applied). Restores the full-canvas RTT so the cost can be re-measured
// against the fix on the same machine and scene.
const AB_NO_BRIGHT_SCALE = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('nobrightscale') === '1';
/** Toggle lean bloom (wired to the LEAN BLOOM setting). Rebuilds the pipeline. */
export function setWebGPULeanBloom(on: boolean): void {
  if (on === LEANBLOOM) return;
  LEANBLOOM = on;
  rebuildWebGPUPipeline();
}
// EXPOSURE — r184 dropped useLegacyLights, so ambient/emissive/point intensities
// read MUCH brighter than the legacy-tuned values → the whole dungeon lit pale.
// Crush exposure hard to restore the dark-with-pools-of-torchlight look. (Quick
// global knob; the deeper fix is re-tuning ambient/emissive for r184 units.)
// With a TONEMAP shoulder in front of the output, highlights roll off instead of
// clipping. But side-by-side vs the WebGL/main reference the WebGPU scene still
// read too bright in the near field, so exposure comes back DOWN under the
// tonemap (0.6 → 0.42). Still the global brightness knob.
// EXPOSURE is per-preset now (grade-presets.ts). Presets carry the aces-path
// value (~0.37); ?expo= overrides it live on the phone.
// DEPTH CRUSH — fade to near-black with camera distance (DELVE's "darkness is
// the baseline" rule; the original did this in HORROR_BLIT_FRAG from linearized
// depth). Metres from camera. Tune on the dev server.
// Aligned to the WebGL/main reference (render-target.ts DEPTH_START/END/FLOOR =
// 6/12/0.16). The WebGPU re-guess (5/28/0.04) faded far too gently — mid-distance
// walls stayed lit out to 28m, which was most of the "too bright" gap vs WebGL.
// CRUSH_FLOOR is per-preset (truer blacks far away = the big value-separation
// lever); the START/END distances stay global.
const CRUSH_START_M = 6, CRUSH_END_M = 12;
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
// AMBER_TINT and VIGNETTE are per-preset now. amberTint [1,1,1] = OFF (light
// owns the hue — the Mörk Borg "takes the colour of its light" look).

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

// MASTER BRIGHTNESS — the GRAPHICS "BRIGHTNESS" slider. A live multiplier on the
// expose step (1.0 = authored exposure). A uniform, so the slider works with no
// pipeline rebuild. (Replaces the old WebGL blitMaterial uBrightness path that
// went dead in the WebGL removal.)
const brightnessNode = (uniform as any)(1);
/** Drive master output brightness (1 = authored). Called from setMasterBrightness(). */
export function setWebGPUBrightness(v: number): void {
  (brightnessNode as any).value = v;
}

// ── DAYLIGHT LEGIBILITY — the lever that actually survives sunlight ──────────
//
// You cannot MULTIPLY your way out of playing outdoors, and that is what the
// brightness slider above does. Sunlight on the glass adds a roughly constant
// reflected luminance to every pixel; two near-black pixels at 0.01 and 0.02
// scaled by 1.24 are still 0.012 and 0.025, both drowned by a reflection worth
// an order of magnitude more. A gain preserves RATIOS, and the ratio is exactly
// what stops mattering when the floor is raised by something outside the screen.
//
// What survives is matching the reflection with a pedestal of our own, and
// re-expanding the contrast that the crushed toe never had:
//   GAMMA first  — pow(<1) on the display-space image pulls the bottom decade
//                  apart, so shape returns to the darks instead of one flat mass.
//   PEDESTAL then — lifts the black point ABOVE the ambient wash so the darkest
//                  content is a distinguishable grey rather than glare-coloured.
// White is pinned, so the highlights and the torch pools do not blow out; only
// the bottom of the range moves, which is where every legibility complaint is.
//
// This is a deliberate trade of atmosphere for readability, so it is a knob the
// player owns rather than something we sneak into the grade.
const LEGIBILITY_FLOOR = 0.18;   // display-space black point at amount 1
const LEGIBILITY_GAMMA = 0.62;   // display-space shadow expansion at amount 1
const legibilityNode = (uniform as any)(0);
// ?daylight=<0..1> PINS the amount, so the four presets can be compared as
// snaps of the same room without driving the settings menu from a script.
const LEGIBILITY_PIN = (() => {
  const q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('daylight');
  const n = q == null || q === false ? NaN : parseFloat(q);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
})();
if (LEGIBILITY_PIN != null) (legibilityNode as any).value = LEGIBILITY_PIN;
/** Daylight legibility, 0 (authored dark) .. 1 (direct sun). */
export function setWebGPULegibility(v: number): void {
  if (LEGIBILITY_PIN != null) return;   // pinned for a comparison snap
  (legibilityNode as any).value = Math.min(1, Math.max(0, v));
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

/** Identity check for the PSX scene pass's render target — the per-pass CPU
 *  probe (debug/render-pass-cpu.ts) uses it to label 'render·scene' vs post. */
export function isScenePassTarget(rt: unknown): boolean {
  const target = (scenePass as unknown as { renderTarget?: unknown } | null)?.renderTarget;
  return target !== undefined && target !== null && rt === target;
}

/** The PSX scene pass target's pixel size, or null before the pipeline
 *  exists. Cluster/tile lighting must grid THIS domain — `screenCoordinate`
 *  in the scene pass is pass-local (the 0.4× target), not canvas pixels. */
export function sceneTargetSize(): { w: number; h: number } | null {
  const rt = (scenePass as unknown as { renderTarget?: { width?: number; height?: number } } | null)?.renderTarget;
  if (!rt || !Number.isFinite(rt.width) || !Number.isFinite(rt.height)) return null;
  return { w: rt.width as number, h: rt.height as number };
}

/** Set the scene-render resolution scale (the PSX downscale). 0.5 = half-res.
 *  Driven by the shared adaptive-resolution scaler (via setPS1Scale).
 *
 *  DEFERRED: applying the scale resizes the scene pass's render targets,
 *  which DESTROYS the old depth/output textures immediately — while up to
 *  MAX_IN_FLIGHT queued submits still reference them. That was THE flaky
 *  "Destroyed texture [depth] used in a submit" → per-frame usage-scope
 *  validation storm (root-caused 2026-07-05 via the error-context
 *  fingerprint: it fired with warming=1 inFlight=2 — the warm's 0.4↔0.05
 *  scale flips with frames in flight; adaptive-res steps in play were the
 *  same hazard). The scale is now staged and applied between frames, only
 *  when the GPU queue is EMPTY. */
export function setWebGPUResolutionScale(s: number): void {
  resScale = s;
  pendingResScale = s;
}
let pendingResScale: number | null = null;
function applyPendingResScale(): void {
  // BOTH queues must be empty: inFlight tracks live submits, but warm renders
  // submit outside that counter — warmSinceFlush > 0 means unawaited warm
  // frames may still reference the current pass textures (resizing then is
  // the exact destroyed-texture storm this defer exists to prevent).
  if (pendingResScale === null || inFlight > 0 || warmSinceFlush > 0 || warmDepth > 0 || !scenePass) return;
  scenePass.setResolutionScale(pendingResScale);
  pendingResScale = null;
}

/** Toggle bloom (wired to the BLOOM setting). Rebuilds the pipeline next frame. */
export function setWebGPUBloomEnabled(on: boolean): void {
  if (on === bloomEnabled) return;
  bloomEnabled = on;
  rebuildWebGPUPipeline();
}

// Retired pipeline pieces awaiting disposal. A rebuild (resize / setting toggle /
// probe) must FREE the old pass + bloom + AO render targets — RenderPipeline,
// PassNode, BloomNode, GaussianBlurNode and GTAONode all own GPU render targets
// and every one has a dispose() — or each rebuild leaks the full post stack
// (phone rotation alone fires this repeatedly). But we can't dispose while a
// submit may still reference the textures ("used in submit while destroyed"), so
// retire now, dispose when the in-flight queue is empty (drainRetired below).
let disposables: Array<{ dispose?: () => void }> = [];
let retired: Array<{ dispose?: () => void }> = [];

// ── The GPU-error dossier (DEV) ─────────────────────────────────────────────
// WebGPU validation errors don't reliably reach the devtools console attached
// to the code that caused them — they arrive later, uncaptured, as a wall of
// identical lines. So every path that SUBMITS brackets its submits in a
// validation error scope and reports them with a frame-state fingerprint:
// what was retired, whether a warm was driving, which frame, how deep the
// queue was. That fingerprint is what root-caused the 2026-07-05 resize storm,
// and the reason it exists in one place now is that the warm path did NOT have
// it and its errors were consequently unattributable.
//
// `nestOk` is about honest attribution, not safety. Scopes are a LIFO stack and
// pops are matched by count, so nesting can't corrupt anything — but a pop
// takes the TOP scope, so a scope opened while another is still pending
// collects the wrong path's errors. The live path nests with itself by design
// (MAX_IN_FLIGHT frames each hold a scope until GPU completion), so it opts in;
// occasional paths pass false and simply skip rather than scramble the label.
let openScopes = 0;
function openGpuErrorScope(
  renderer: DelveRenderer, label: string | (() => string), nestOk = true,
): () => void {
  const dev: unknown = import.meta.env.DEV
    ? (renderer as unknown as { backend?: { device?: unknown } }).backend?.device
    : null;
  const d = dev as { pushErrorScope?: (t: string) => void; popErrorScope?: () => Promise<unknown> } | null;
  if (!d?.pushErrorScope || (!nestOk && openScopes > 0)) return () => { /* not scoped */ };
  d.pushErrorScope('validation');
  openScopes++;
  // SNAPSHOT AT ENCODE TIME. The scope is popped after the GPU completes, so
  // reading the counters there describes the world as it is once the damage is
  // long done — inFlight has drained, the warm has ended. What identifies the
  // culprit is the state when the offending commands were ENCODED, which is
  // now. (`t` is the wall clock, so a destroy trace can be lined up against it.)
  const at = ` :: at{t=${Math.round(performance.now())} retired=${retired.length} warming=${warmDepth}`
    + ` presented=${presentedFrames} inFlight=${inFlight} pass=${sceneTargetSize()?.w ?? '?'}x${sceneTargetSize()?.h ?? '?'}}`;
  let closed = false;
  return () => {
    if (closed) return;   // pops must match pushes exactly, once
    closed = true;
    openScopes = Math.max(0, openScopes - 1);
    d.popErrorScope?.().then((err: unknown) => {
      if (!err) return;
      const msg = String((err as { message?: string }).message ?? err);
      const where = typeof label === 'function' ? label() : label;
      const ctx = at;
      // eslint-disable-next-line no-console
      console.error(`[psx gpu-error] ${where}${ctx} :: ${msg.slice(0, 280)}`);
      const w = window as unknown as { __gpuErrors?: string[] };
      (w.__gpuErrors = w.__gpuErrors ?? []).push(msg + ctx);
    }).catch(() => { /* device lost — nothing to report to */ });
  };
}
function drainRetired(): void {
  // The SAME three-way guard applyPendingResScale uses, and for the same
  // reason. Both destroy GPU resources a queued submit may still reference, but
  // this one only checked inFlight — which counts LIVE submits and nothing
  // else. Warm renders (warmRenderWebGPU) and the lux capture submit outside
  // that counter, so `inFlight === 0` does not mean the queue is empty, and
  // freeing here while a warm frame was still in flight is exactly the
  // "[Buffer ...] used in submit while destroyed" validation storm this defer
  // exists to prevent. Observed 2026-08-12 on desktop with retired=3 pending
  // across a burst of pipeline rebuilds.
  if (inFlight > 0 || warmSinceFlush > 0 || warmDepth > 0 || retired.length === 0) return;
  for (const d of retired) { try { d.dispose?.(); } catch { /* best-effort */ } }
  retired = [];
}

/** Defer a GPU-resource disposal until the GPU queue is provably empty
 *  (drained at frame start when no submit is in flight). THE seam for any
 *  dispose that could race an in-flight frame: level-teardown geometry,
 *  BatchedMesh disposal, retired pass targets. Caught red-handed 2026-07-04:
 *  the descent teardown's synchronous geometry.dispose() burst destroyed
 *  buffers a queued frame still referenced → `setIndexBuffer: not a
 *  GPUBuffer` → depth/output usage-scope storm → black world (the failure
 *  that killed the render-bundle experiment and blocked static batching). */
export function deferGpuDispose(dispose: () => void): void {
  retired.push({ dispose });
}

/** Drop the pipeline so the next renderWebGPU rebuilds it (old one disposed once
 *  the GPU queue drains). */
export function rebuildWebGPUPipeline(): void {
  // DEFERRED to the top of the next frame. Callers fire this from anywhere —
  // settings handlers, a resize event, the attribution sweep's per-frame stage
  // toggles — and tearing the graph down at an arbitrary point produced a pass
  // where the scene-pass DEPTH texture was both sampled and attached:
  //   [Texture "depth"] usage (TextureBinding|RenderAttachment) includes
  //   writable usage and another usage in the same synchronization scope.
  // That fails validation, so the encoder never finishes, so the submit never
  // completes, so inFlight never decrements and the backpressure gate skips
  // EVERY later frame — a permanently black canvas with a live DOM HUD. (The
  // same conflict on the 'output' texture is recorded in warmSceneCompile's
  // comment; this is the depth twin of it.)
  //
  // Rebuilding at frame start instead means the graph is only ever swapped when
  // no pass is bound, which is the same discipline drainRetired and
  // applyPendingResScale already follow.
  rebuildPending = true;
}
let rebuildPending = false;
function applyPendingRebuild(): void {
  if (!rebuildPending) return;
  rebuildPending = false;
  retired.push(...disposables);
  disposables = [];
  pipeline = null; scenePass = null; aoPassRef = null;
}

// A renderer resize (window or the PIXEL DENSITY / DPR apply, which dispatches
// 'resize') invalidates the RenderPipeline's pass targets — rebuild so a settings
// change doesn't freeze the image. Harmless in WebGL mode (pipeline stays null).
if (typeof window !== 'undefined') window.addEventListener('resize', rebuildWebGPUPipeline);

// ── COLOUR-GRADE live controls ───────────────────────────────────────────────
// Preset switching is safe on the live site (it's art direction, not a cheat),
// so setWebGPUGrade is exported for the video-settings UI. The finer per-axis
// dial-in (__gradeSet) is DEV-only console sugar for tuning on the phone.
/** Switch the active colour-grade preset (e.g. 'coldfire'). Rebuilds next frame. */
export function setWebGPUGrade(name: string): boolean {
  if (!setActiveGrade(name)) return false;
  rebuildWebGPUPipeline();
  return true;
}
/** Names available for a settings dropdown. */
export function webGPUGradeNames(): string[] { return gradeNames(); }
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // DEV: flip presets from the phone console — window.__grade('coldfire').
  (window as any).__grade = (name?: string) => {
    if (name) setWebGPUGrade(name);
    return { active: activeGradeName(), available: gradeNames() };
  };
  // DEV: dial individual axes live — window.__gradeSet({ split: 0.7, blacks: 0.03 }).
  // Keys: split, blacks, sat, expo, amber, vig, bloomth. {} clears overrides.
  (window as any).__gradeSet = (partial: Record<string, number>) => {
    setGradeOverrides(partial ?? {}, !partial || Object.keys(partial).length === 0);
    rebuildWebGPUPipeline();
    return getActiveGrade();
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function ensurePipeline(renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  // Honour a deferred rebuild here too, so the warm / lux / compile paths that
  // call ensurePipeline directly can't keep using a graph that has already been
  // invalidated. Safe at any of those call sites: none is mid-pass.
  applyPendingRebuild();
  if (pipeline) return;
  // Active colour-grade (preset + live URL/console overrides). Read once per
  // build; the DEV __grade/__gradeSet hooks rebuild the pipeline on change.
  const G = getActiveGrade();
  scenePass = pass(scene, camera);
  pendingResScale = null;   // fresh pass builds at the current resScale below — nothing staged
  disposables.push(scenePass as any);
  scenePass.setResolutionScale(resScale);

  // SSAO and INK both read a depth+normal G-buffer, so the MRT is rendered when
  // EITHER wants it — and not at all when neither does, which is the common
  // case and must stay free.
  const GBUF = SSAO || inkNeedsMRT();
  if (GBUF) (scenePass as any).setMRT((mrt as any)({ output, normal: normalView }));

  // CHUNKY PS1 UPSCALE — the low-res pass target defaults to LinearFilter, so the
  // upscale to screen is SMOOTH: soft walls, soft edges, washed-out PS1 pixels.
  // We NEAREST-filter the pass output so the upscale snaps to texel centres →
  // hard chunky texels, the pronounced PS1 look. (Re-applied every rebuild — a
  // resize rebuilds the pipeline — so it survives resolution-scale changes.)
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
  const tex: any = GBUF ? (scenePass as any).getTextureNode('output') : (scenePass as any).getTextureNode();
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
    disposables.push(aoPass);
    aoPassRef = aoPass;
    ssaoAoR = aoPass.getTextureNode().r;
    sceneCA = sceneCA.mul(ssaoAoR);
  }

  // ── INK ──────────────────────────────────────────────────────────────────
  // See the note at setWebGPUInk. Four taps of depth + four of normal, in a
  // cross; everything after that is ALU.
  if (inkNeedsMRT()) {
    const depthTex: any = (scenePass as any).getTextureNode('depth');
    const normTex: any = (scenePass as any).getTextureNode('normal');
    const w: any = inkWidthNode;
    const offs: any[] = [
      (vec2 as any)(w, float(0)), (vec2 as any)(w.negate(), float(0)),
      (vec2 as any)(float(0), w), (vec2 as any)(float(0), w.negate()),
    ];

    // DEPTH: relative difference, not absolute. Depth is nonlinear, so an
    // absolute threshold inks every crack within arm's reach and nothing at all
    // past a few metres — the line would thin out exactly where silhouettes
    // matter most, which is the far side of a room.
    const dC: any = depthTex.sample(suv).r;
    let depthEdge: any = float(0);
    for (const o of offs) {
      const dN: any = depthTex.sample(suv.add(o)).r;
      const rel: any = dN.sub(dC).abs().div(dC.max(float(0.0001)));
      depthEdge = (tslMax as any)(depthEdge, rel);
    }

    // NORMAL: 1 - dot, so a face turning away from its neighbour inks. This is
    // the crease detector — it is what makes a box read as a box when both of
    // its visible faces happen to catch the same amount of light.
    const nC: any = normTex.sample(suv).xyz.mul(float(2)).sub(vec3(1)).normalize();
    let normEdge: any = float(0);
    for (const o of offs) {
      const nN: any = normTex.sample(suv.add(o)).xyz.mul(float(2)).sub(vec3(1)).normalize();
      normEdge = (tslMax as any)(normEdge, float(1).sub((dot as any)(nC, nN)).max(float(0)));
    }

    const raw: any = depthEdge.mul(inkDepthNode).add(normEdge.mul(inkNormalNode));
    // Soft shoulder rather than a hard cut: a binary edge test crawls with
    // sub-pixel camera motion and reads as shimmer on a phone.
    const edge: any = (smoothstep as any)(float(0.35), float(1.0), raw).mul(inkStrengthNode);
    sceneCA = sceneCA.mul(float(1).sub(edge).max(float(0)));
  }

  // EXPOSE FIRST. r184's brighter lighting must be brought into range BEFORE
  // bloom, or bloom (threshold 1.0) catches half the scene and veils everything
  // in a desaturated white haze. Exposing first means only the genuinely-bright
  // sources (flames) clear the threshold → tight, subtle bloom.
  //
  const exposed: any = sceneCA.mul(float(G.exposure)).mul(brightnessNode);

  // Exposed scene + native bloom, additive, LINEAR. Bloom optional (BLOOM
  // setting); the bloomPass also feeds the fog inscatter below.
  let bloomPass: any = null;
  if (bloomEnabled && LEANBLOOM) {
    // LEAN bloom (~3 RTs): bright-extract above threshold (pure ALU, no pass) →
    // ONE separable gaussian blur at low res → × strength. Drops ~8 render-target
    // switches vs UnrealBloom's 5-mip chain. Feeds both the additive glow and the
    // inscatter below, same as the UnrealBloom path.
    const bright: any = (exposed as any).sub((float as any)(G.bloomThreshold)).max(0);
    const gb: any = (gaussianBlur as any)(bright, null, 6);
    gb.resolutionScale = 0.35;   // soft glow hides the low res (PS1-appropriate)
    // …and the BRIGHT-EXTRACT's own target, which is the expensive half.
    // `gaussianBlur(node)` wraps a non-texture input in convertToTexture() ->
    // an RTTNode, and RTTNode defaults _resolutionScale to 1 with autoResize on,
    // so it sizes itself to the FULL drawing buffer (RTTNode.updateBefore). The
    // line above only scales the blur's own two targets. So the "pure ALU, no
    // pass" bright extract was in fact a full-canvas HalfFloat pass that
    // re-evaluated the whole exposed chain — CA's three scene taps included —
    // once per canvas pixel, while the scene it samples is rendered at 0.4.
    // Measured on desktop (real GPU, gpu-attribution): bloom was 56% of the
    // frame, more than lighting, shadows and PBR combined, for a glow at
    // strength 0.08. Match the blur it feeds; the glow is soft either way.
    if (!AB_NO_BRIGHT_SCALE) (gb.textureNode as any)?.setResolutionScale?.(0.35);
    disposables.push(gb);
    // …and the RTT's OWN render target, which nothing else frees.
    // GaussianBlurNode.dispose() releases its two blur targets and its material
    // — not the convertToTexture() wrapper feeding it — and RTTNode does not
    // override Node.dispose(), which only dispatches an event. So retiring `gb`
    // alone left a HalfFloat colour target allocated per rebuild, and rebuilds
    // are not rare: window resize, PHONE ROTATION, DPR/settings apply, and every
    // grade/probe toggle all land here. Dispose the target itself.
    const brightRT: any = (gb.textureNode as any)?.renderTarget;
    if (brightRT?.dispose) disposables.push({ dispose: () => brightRT.dispose() });
    bloomPass = (gb as any).mul((float as any)(BLOOM_STRENGTH));
  } else if (bloomEnabled) {
    bloomPass = bloom(exposed, BLOOM_STRENGTH, BLOOM_RADIUS, G.bloomThreshold);
    disposables.push(bloomPass);
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
  if (crushOn) {
    const crush = (mix as any)(float(1.0), float(G.crushFloor), (smoothstep as any)(CRUSH_START_M, CRUSH_END_M, distM));
    lit = lit.mul(crush);
  }

  // FOG INSCATTER — add the bloom colour as glowing air, weighted by distance.
  // Added AFTER crush so the haze isn't darkened by it (surfaces fade, air glows).
  // Only when bloom is on (it's the haze colour source).
  if (bloomPass && inscatterOn) {
    const fogW = (smoothstep as any)(INSCATTER_START_M, INSCATTER_END_M, distM).mul(INSCATTER_STRENGTH);
    // inscatterTint colours the FAR air independently of the (warm) bloom source,
    // so a corridor fogs out toward cold-blue even when the near light is a torch.
    const inTint: any = (vec3 as any)(G.inscatterTint[0], G.inscatterTint[1], G.inscatterTint[2]);
    lit = lit.add((bloomPass as any).mul(inTint).mul(fogW));
  }

  // ISOLATION: ?raw=1 outputs the bare exposed scene (no grade) so we can tell if
  // the haze is the grade vs upstream (lighting/fog/material).
  const build = (node: any) => {
    pipeline = new RenderPipeline(
      renderer as unknown as ConstructorParameters<typeof RenderPipeline>[0],
      node as ConstructorParameters<typeof RenderPipeline>[1],
    );
    disposables.push(pipeline as any);
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
  col = (mix as any)((vec3 as any)(lum, lum, lum), col, G.saturation);
  // CONTRAST / BLACK-CRUSH — pow > 1 darkens mids/darks hard, keeps highlights.
  col = col.pow(_float(G.contrast));

  // ── SPLIT-TONE — the warm-key / cold-dark cinematic lever ──
  // Lerp a per-luminance tint over the image: dark pixels toward shadowTint
  // (cool), bright pixels toward highlightTint (warm). This is the contrast the
  // eye reads as DEPTH in a torchlit scene — and unlike a global tint it LEAVES
  // the hue the light gave a surface, only biasing shadow-vs-light temperature.
  // splitStrength 0 → identity (baseline preset), so this node is always present
  // but inert unless a preset/override asks for it.
  if (G.splitStrength > 0) {
    const sLum: any = (luminance as any)(col);
    const w: any = (smoothstep as any)(_float(0.0), _float(0.6), sLum);   // 0 dark → 1 light
    const tint: any = (mix as any)(
      (vec3 as any)(G.shadowTint[0], G.shadowTint[1], G.shadowTint[2]),
      (vec3 as any)(G.highlightTint[0], G.highlightTint[1], G.highlightTint[2]),
      w,
    );
    col = (mix as any)(col, col.mul(tint), _float(G.splitStrength));
  }

  // ── EYE DARK-ADAPTATION — soften the dark (see ADAPT_* notes above) ──
  // darkW = 1 in shadow/fog, ramping to 0 by ADAPT_CUTOFF brightness, so the LIT
  // side is left exactly as-is (no overexposure). Within the darks we raise the
  // floor (additive — the crush/fog loosens) and gently amplify (multiply — form
  // swims up), all scaled by darkAdaptNode (0 in torchlight, 1 in a dark hall).
  {
    const lum: any = col.r.max(col.g).max(col.b);
    const darkW: any = _float(1.0).sub((smoothstep as any)(_float(0.05), _float(ADAPT_CUTOFF), lum));
    // adaptScale lets a preset dial the "eyes adjust" lift down (→ truer blacks).
    const a: any = (darkAdaptNode as any).mul(darkW).mul(_float(G.adaptScale));   // adapt, restricted to the darks
    col = col.add((vec3 as any)(ADAPT_LIFT[0], ADAPT_LIFT[1], ADAPT_LIFT[2]).mul(a));
    col = col.mul(_float(1.0).add(a.mul(_float(ADAPT_GAIN))));
  }

  // ── DAYLIGHT LEGIBILITY (see LEGIBILITY_* above) ──
  // Placed BEFORE the dither+quantize below, deliberately: lifting after the
  // quantize would squeeze all 32 levels into the top of the range and band the
  // shadows we just made visible. Lifting first lets the newly-opened darks get
  // their own levels, and the dither breaks up what is left.
  {
    const amt: any = legibilityNode;
    let d: any = col.max(_float(0.0)).pow(_float(1.0 / 2.2));            // linear → display
    d = d.pow((mix as any)(_float(1.0), _float(LEGIBILITY_GAMMA), amt)); // open the shadow toe
    const floorV: any = amt.mul(_float(LEGIBILITY_FLOOR));
    d = d.mul(_float(1.0).sub(floorV)).add(floorV);                      // pedestal; white pinned
    col = d.pow(_float(2.2));                                            // display → linear
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
  // AMBER TINT — global warm bias. [1,1,1] on a preset turns it OFF, which is
  // what lets the LIGHT (not the grade) own each surface's hue.
  col = col.mul((vec3 as any)(G.amberTint[0], G.amberTint[1], G.amberTint[2]));
  // VIGNETTE — mild edge darkening (matched toward the WebGL blit).
  const d = _uv.sub(0.5);
  col = col.mul(_float(1.0).sub(_dot(d, d).mul(G.vignette)));
  build(_vec4(col, 1.0));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// FRAMES-IN-FLIGHT cap. pipeline.render() encodes + submits synchronously; the
// GPU executes async. Submitting fire-and-forget lets the CPU run arbitrarily
// far ahead of the GPU, so present latency wanders frame to frame (steady fps,
// but judder). We DON'T touch the rAF cadence to fix this — the pacer's refresh
// estimate reads rAF intervals, so delaying rAF made it read garbage. Instead:
// while MAX_IN_FLIGHT submits haven't COMPLETED on the GPU
// (device.queue.onSubmittedWorkDone), SKIP this submit (show the last frame).
// rAF keeps firing at the display rate (hertz stays correct); the GPU queue is
// bounded; on a display faster than the GPU can feed, this naturally paces to
// the GPU's rate instead of piling up.
// 1, not 2: when the GPU is the bottleneck, a 2-deep queue submits two frames
// back-to-back to fill it then drains — a BURSTY present cadence (the 4ms↔40ms
// "wait" jitter). One in flight submits exactly once per GPU completion → even
// cadence. The cost is a little GPU idle between completion and the next rAF (the
// loop is rAF-driven) — slightly lower peak fps, but smooth.
// HISTORY: this used to key off renderAsync's promise. In r184 renderAsync
// degenerated to `await init(); render()` — resolving at SUBMIT, same microtask —
// so the cap had silently stopped skipping. onSubmittedWorkDone restores the
// designed semantics (true GPU completion) and outlives the deprecated API.
// 2, not 1 (2026-07-02): with the FRAME CAP pacing submits (60 default — phones
// always run capped), submissions are already spaced ≥ a cap period, so 2-in-flight
// is classic double buffering, not the bursty fill-then-drain the note above fears
// (that analysis assumed uncapped rAF-rate submission). At 1, the completion
// round-trip (onSubmittedWorkDone lands a browser task AFTER the GPU finishes)
// regularly overshoots the next paced draw slot, which then gets DROPPED — the
// measured result was a hard ~30fps lock at a 60 cap with the GPU only ~8ms busy
// (present p50 33.8ms → 16.8ms with the gate off). 2 hides the round-trip while
// still bounding the queue. ?inflight1=1 restores the old serialization for A/B.
const MAX_IN_FLIGHT = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('inflight1') === '1' ? 1 : 2;
let inFlight = 0;
let inFlightSince = 0;   // when the queue last went from empty to non-empty

// ── In-flight watchdog ──────────────────────────────────────────────────────
// inFlight is decremented by onSubmittedWorkDone. If a submit never completes —
// a render pass that fails validation never finishes its encoder, and the
// promise for it can simply never settle — the counter stays pinned, the gate
// below skips every subsequent frame, and the canvas is black FOREVER while the
// DOM HUD keeps painting. Observed exactly that (skip log: 'inFlight' ~85/s
// sustained, still going minutes later, never recovering on its own).
//
// A frame gate whose failure mode is "permanently stop drawing" needs a way
// back. Past the cutoff we assume the submit is never landing and reopen the
// gate: at worst we run briefly unbounded, which is a jitter problem, versus a
// dead screen, which is the game being over. Deliberately far longer than any
// legitimate GPU frame so healthy backpressure is untouched.
const IN_FLIGHT_STUCK_MS = 2000;
// Bumped whenever the watchdog abandons a set of submits. A completion callback
// carries the generation it was issued under and only decrements if it still
// matches — otherwise a late completion from an abandoned batch would drive the
// counter NEGATIVE, and every "is the queue empty?" guard in this file tests
// `inFlight > 0`, which a negative value passes. That let drainRetired and
// applyPendingResScale free and resize textures while frames really were in
// flight — the destroyed-texture path, i.e. the very failure the watchdog
// exists to recover from, caused by the watchdog. (Caught immediately on
// device: "it now goes black almost immediately.")
let inFlightGen = 0;
function releaseStuckInFlight(): void {
  if (inFlight <= 0) return;
  // Not during a warm. Warm renders submit outside this counter and can occupy
  // the GPU for seconds, so a live submit issued just before one starts is
  // legitimately outstanding — that is backpressure working, not a stall.
  // (Observed firing once per load before this guard.)
  if (warmDepth > 0) { inFlightSince = performance.now(); return; }
  if (performance.now() - inFlightSince < IN_FLIGHT_STUCK_MS) return;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(`[psx] in-flight watchdog: ${inFlight} submit(s) never completed in `
      + `${IN_FLIGHT_STUCK_MS}ms — reopening the gate. A render pass probably failed `
      + `validation; check window.__gpuErrors.`);
  }
  inFlightGen++;   // disown the outstanding submits; their completions are ignored
  inFlight = 0;
  inFlightSince = performance.now();
}

/** Render one frame through the native WebGPU pipeline (skips if the GPU is behind). */
export function renderWebGPU(renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  applyPendingRebuild();   // swap the graph only at frame start, never mid-pass
  drainRetired();   // free any rebuilt-away pass/bloom/AO targets once the queue is empty
  releaseStuckInFlight();
  ensurePipeline(renderer, scene, camera);
  applyPendingResScale();   // resize pass targets only while the GPU queue is empty
  // Render bundles are gated to THIS camera's pass — shadow/depth-array passes
  // must not record or execute them (see bundle-pass-order.ts).
  setBundleMainCamera(camera);
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
  if (warmDepth > 0) { if (import.meta.env.DEV) tallySkip('warmingUp'); return; }
  if (frameSyncOn && inFlight >= MAX_IN_FLIGHT) { if (import.meta.env.DEV) tallySkip('inFlight'); return; }   // GPU behind — drop this submit
  // Reset per frame so renderer.info reflects THIS frame's total (the pipeline's
  // passes accumulate into it); without this it climbs without bound.
  renderer.info.reset();
  // DEV: bracket each PSX render in a WebGPU validation error scope so a render-pass
  // hazard (e.g. the reported 'output texture writable+sampled in same scope') is
  // caught AT the render and localized to the PSX pass + the frame that triggered
  // it. Draw count is read lazily, at report time, off this frame's info.
  const closeScope = openGpuErrorScope(
    renderer, () => `frame draws=${(renderer as any).info?.render?.drawCalls}`);
  // Whether the GPU queue was empty at this submit — the no-timestamp fallback
  // below only trusts submit→completion wall-clock as a GPU-cost proxy then
  // (with another frame queued ahead, the wall-clock includes its wait too).
  const soloSubmit = inFlight === 0;
  if (inFlight === 0) inFlightSince = performance.now();   // start the watchdog clock
  const submitGen = inFlightGen;   // completions from an abandoned batch must not count
  inFlight++;
  presentedFrames++;   // a real submit is happening (the skip paths returned above)
  // A SYNCHRONOUS throw (a bad node graph faults during encode) must not strand
  // the in-flight count — a stranded count makes every later frame skip
  // (permanent freeze). Decrement + rethrow so renderWithStyle's rate-limited
  // catch still logs it.
  try {
    (pipeline as unknown as { render: () => void }).render();
  } catch (err) {
    if (submitGen === inFlightGen) inFlight = Math.max(0, inFlight - 1);
    closeScope();
    throw err;
  }
  const backend: any = (renderer as any).backend;
  const t0 = performance.now();
  const done = (): void => {
    // Only count this completion if the watchdog has not disowned its batch,
    // and never below zero — a negative count reads as "queue empty" to every
    // guard in this file.
    if (submitGen === inFlightGen) inFlight = Math.max(0, inFlight - 1);
    // ADAPTIVE-RES SIGNAL: stash the REAL GPU frame ms from native timestamps.
    // Wall-clock at submit would read CPU encode time, not the GPU cost — only
    // the timestamp is the true bottleneck signal. The shared adaptive scaler
    // reads it via lastWebGPUGpuMs(). Self-throttled.
    if (!tsInFlight) {
      tsInFlight = true;
      const r = renderer as unknown as { resolveTimestampsAsync?: (t: string) => Promise<number> };
      r.resolveTimestampsAsync?.('render')
        .then((ms) => { tsInFlight = false; if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) lastGpuMs = ms; },
              () => { tsInFlight = false; });
      // Also drain the COMPUTE query pool (the GPU embers) — with trackTimestamp
      // on, unresolved pools fill up and warn ("Maximum number of queries
      // exceeded"); the profiler only drains them while a listener is attached.
      void r.resolveTimestampsAsync?.('compute').catch(() => {});
    }
    // FALLBACK GPU-load signal — WebGPU adapters WITHOUT timestamp-query
    // (backend.trackTimestamp forced false there): submit→completion wall-clock.
    // Only trusted when this submit found the queue EMPTY (soloSubmit) — with a
    // frame queued ahead (in-flight 2) the wall-clock includes its wait, which
    // would over-read GPU cost and make the adaptive scaler over-shrink.
    if (soloSubmit && backend?.isWebGPUBackend && backend.trackTimestamp === false) {
      lastGpuMs = performance.now() - t0;
    }
    closeScope();
  };
  // True GPU completion on WebGPU; the WebGL2 backend submits synchronously in
  // render() (no queue object), so it completes here and the cap never skips.
  const q = backend?.isWebGPUBackend ? backend.device?.queue : null;
  if (q?.onSubmittedWorkDone) q.onSubmittedWorkDone().then(done, done);
  else done();
}

// ── Display-frame capture (the LUX meter's readback) ────────────────────────
// Renders ONE frame through the real PSX pipeline into a small offscreen target
// and reads it back — the exact display-referred image (grade, dither and all).
// This exists because Chrome's WebGPU canvas cannot be reliably snapshotted
// (drawImage/createImageBitmap race the texture expiry and often read black);
// an explicit render-to-target + readRenderTargetPixelsAsync is deterministic.
// DEV-tool path: one extra low-res render per measurement, main loop held for
// the single frame via the warmingUp gate (same trick as the warm pass).
let luxRT: THREE.RenderTarget | null = null;
export async function captureDisplayFrame(
  renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera, width = 240,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  ensurePipeline(renderer, scene, camera);
  if (!pipeline) return null;
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  const height = Math.max(1, Math.round(width * (buf.y / Math.max(1, buf.x))));
  if (!luxRT || luxRT.width !== width || luxRT.height !== height) {
    // Same rule as everything else that frees GPU memory here: the previous
    // capture's submit may still be in flight, and a synchronous dispose is
    // how you get "used in a submit while destroyed". Retire it instead.
    const doomed = luxRT;
    if (doomed) deferGpuDispose(() => doomed.dispose());
    luxRT = new THREE.RenderTarget(width, height, { depthBuffer: false });
    // Display-referred bytes: the pipeline applies the sRGB output transform
    // when the target's texture asks for it (same as the canvas).
    luxRT.texture.colorSpace = THREE.SRGBColorSpace;
  }
  const prev = renderer.getRenderTarget();
  enterWarm();
  try {
    renderer.setRenderTarget(luxRT);
    (pipeline as unknown as { render: () => void }).render();
    renderer.setRenderTarget(prev);
    const px = await renderer.readRenderTargetPixelsAsync(luxRT as never, 0, 0, width, height) as unknown as Uint8Array;
    // Hand back ONE layout — tightly-packed, top-down RGBA — whichever backend
    // produced it. The two disagree on row order AND row stride; readback.ts
    // has the details and the bugs that came of not doing this here.
    const isWebGPU = !!(renderer as unknown as { backend?: { isWebGPUBackend?: boolean } })
      .backend?.isWebGPUBackend;
    return { data: normalizeReadback(px, width, height, isWebGPU ? 'webgpu' : 'webgl2'), width, height };
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[lux] capture failed:', err);
    return null;
  } finally {
    renderer.setRenderTarget(prev);
    leaveWarm();
  }
}

// ── Warm render ─────────────────────────────────────────────────────────────
// Compile pipelines by rendering through the REAL PSX pipeline, so the compiled
// pipeline state matches the live render EXACTLY (the internal HDR scene-pass target
// format, the bloom/grade passes — everything). compileAsync warms the wrong target
// format (the canvas), so its pipelines get thrown away + recompiled on first real
// draw — that's the residual first-use stutter. This renders whatever is in `scene`
// (the loaded floor + any warm subjects added by the caller) a few times, awaiting
// each submit, with the main loop gated off via `warmingUp`.
//
// NOTE — an offscreen-RT warm was tried (render into a tiny RenderTarget so
// warm frames never present) and REVERTED: binding an output target changes
// NodeManager state (isToneMappingState et al), so every warmed pipeline was
// the WRONG variant and the live render recompiled the world in-play (65
// post-warm compiles, caught by the warmup guard). Warm renders MUST present
// through the byte-identical live path — which is why they only ever run
// behind an opaque DOM cover, and why the cover must not drop until a CLEAN
// frame has presented after the warm (see bootWarm / fadeIn).
// ── WARM DEPTH, NOT A WARM FLAG ─────────────────────────────────────────────
//
// This gate is what holds the live frame loop still while a warm owns the
// render graph: renderWebGPU returns early whenever it is set, so nothing draws
// into a target the warm has bound or a scene the warm has forced visible.
//
// It used to be a plain boolean, and warms NEST — warmSceneCompile binds the
// scene target, forces every object visible + unculled, and then calls
// warmRenderWebGPU for the shadow-depth pass. That inner call's `finally` set
// the boolean back to FALSE while the outer warm was still running, so for the
// rest of warmSceneCompile the loop was free to render: a live frame with the
// WHOLE FLOOR forced visible, encoded against a graph mid-warm, before
// restoreCull() had run and while warm submits were still in flight.
//
// That is the same shape as the depth-texture conflict rebuildWebGPUPipeline
// documents — the graph touched while a pass is live — and it is deterministic
// at descent, because descent is where the nesting always happens.
//
// A COUNTER cannot be cleared by an inner scope. Every warm enters and leaves;
// the gate opens only when the outermost one is done.
let warmDepth = 0;
export function isWarmingUp(): boolean { return warmDepth > 0; }
function enterWarm(): void { warmDepth++; }
function leaveWarm(): void { warmDepth = Math.max(0, warmDepth - 1); }

// ── Warm-render pacing ──────────────────────────────────────────────────────
// The 2026-07-03 descent-freeze triage found the first-descent warm spending
// ~50s WALL on a fast desktop (minutes on a phone) with the main thread idle:
// every warm render awaited device.queue.onSubmittedWorkDone() — a full GPU
// execution + completion round-trip per pass, ~400 times. The wait exists only
// to BOUND the queue (an unbounded burst of heavy frames risks device pressure
// on phones); it does nothing for compile correctness — pipelines are created
// during ENCODE, on the CPU. So: await completion only every Nth warm render,
// and let callers flushWarmRenders() once at the end.
const WARM_FLUSH_EVERY = 4;
let warmSinceFlush = 0;

/** Await GPU completion of everything warm renders have submitted so far.
 *  Callers run this once after their last warm batch (and the descent gate
 *  awaits it) so no warm work is still in flight when the cover drops. */
export async function flushWarmRenders(renderer: DelveRenderer): Promise<void> {
  warmSinceFlush = 0;
  const q = (renderer as unknown as {
    backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<unknown> } } };
  }).backend?.device?.queue;
  if (q?.onSubmittedWorkDone) { try { await q.onSubmittedWorkDone(); } catch { /* best-effort */ } }
}

// Warm renders happen behind an opaque cover, so their pixels are never seen —
// render them TINY. setResolutionScale changes only the scene target's SIZE;
// the pipeline cache keys on target FORMATS (see the offscreen-RT note above:
// a different BINDING changes variants — a smaller size does not), so the
// warmed pipelines stay byte-identical while the GPU raster cost of each warm
// frame collapses. The compile guard (postWarmup counter) polices this claim.
const WARM_RES_SCALE = 0.05;
let preWarmResScale: number | null = null;
/** Scope the warm's tiny render scale: on(true) before the first warm render,
 *  on(false) — ALWAYS, in a finally — before the reveal presents real frames. */
export function setWarmLowRes(on: boolean): void {
  if (on) {
    if (preWarmResScale === null) { preWarmResScale = resScale; setWebGPUResolutionScale(WARM_RES_SCALE); }
  } else if (preWarmResScale !== null) {
    setWebGPUResolutionScale(preWarmResScale);
    preWarmResScale = null;
  }
}

/**
 * Land a staged resolution change from inside a WARM, by draining the queue and
 * then resizing the pass in place.
 *
 * ORDER IS THE WHOLE POINT. Resizing destroys the pass's output/depth textures,
 * and draining first is not sufficient on its own — the submit that dies comes
 * AFTER the destroy, not before it, because a render context stays primed
 * against the old textures across the resize:
 *
 *   Destroyed texture [Texture "depth"] used in a submit.
 *    - While calling [Queue].Submit([CommandBuffer from "renderContext_5"])
 *
 * and every later submit then fails validation (the console storm). Traced
 * 2026-08-15: destroy at t=3892, offending encode just after. Not render
 * bundles — it reproduces identically with ?bundles=0.
 *
 * So a warm REBUILDS the graph instead of resizing it: a fresh PassNode gets
 * fresh textures that no context has ever seen, and the old pass is retired to
 * drainRetired, which frees it only once the queue is provably empty. Ordering
 * the resize before the bind is NOT sufficient on its own — measured: the storm
 * came straight back (22 errors on a cold warm) with the in-place resize, even
 * landed ahead of compileAsync.
 *
 * WHERE it lands still matters, which is why both warm entry points call this
 * at their TOP. A rebuild throws away the whole post stack (pass + bloom + AO),
 * so doing it inside `warmSceneCompile`'s nested shadow warm meant rebuilding
 * immediately before the reveal and recompiling the post graph in the player's
 * first live frames. Landing it up front lets the compileAsync that follows
 * warm the graph it just built.
 *
 * The live/adaptive path keeps its in-place resize: it never binds the target
 * behind the pipeline's back, and a rebuild per adaptive step would churn the
 * post graph mid-play.
 *
 * The CALLER MUST ALREADY HOLD THE WARM GATE (warmDepth > 0). This awaits, and
 * an ungated await lets the live loop submit a frame into the drain window that
 * the resize then pulls the textures out from under.
 */
async function applyResScaleDrained(
  renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera,
): Promise<void> {
  if (pendingResScale === null) return;
  await flushWarmRenders(renderer);
  if (pendingResScale === null) return;
  pendingResScale = null;   // resScale already holds the value; build with it
  rebuildWebGPUPipeline();
  ensurePipeline(renderer, scene, camera);   // absorbs the rebuild → fresh pass, fresh textures
}

export async function warmRenderWebGPU(
  renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera, passes = 3,
): Promise<void> {
  drainRetired();
  ensurePipeline(renderer, scene, camera);
  // GATE THE LIVE LOOP BEFORE THE RESIZE, NOT AFTER IT.
  //
  // A staged resolution change (setWarmLowRes just flipped the scale to 0.05)
  // resizes the pass targets, and that DESTROYS the old output/depth textures
  // immediately — so the queue has to be drained first. But draining is an
  // `await`, and until warmDepth > 0 the live rAF loop is not gated: it wakes
  // up INSIDE that await, passes both the warmDepth and inFlight checks,
  // encodes a frame against the textures we are about to free, and then the
  // resize below pulls them out from under it:
  //
  //   Destroyed texture [Texture "output"] used in a submit
  //   → [Texture "output"] usage (TextureBinding|RenderAttachment) includes
  //     writable usage and another usage in the same synchronization scope
  //
  // which is the boot-time validation storm — every subsequent submit against
  // the poisoned encoder fails, including the async pipeline creations, so the
  // console fills with pipeline-compile failures that are only the wreckage.
  // Entering the warm first makes drain-then-resize atomic against the loop,
  // which is what the rest of this file's defer machinery already assumes.
  enterWarm();
  // The live path has been bracketing its submits in a validation error scope
  // since the storm hunt; the warm path never was, so warm-time errors arrived
  // as UNCAPTURED console blobs with no ctx{} fingerprint — the exact reason
  // this one read as unattributable. Now it lands in the same dossier.
  const closeScope = openGpuErrorScope(renderer, 'warm render', false);
  try {
    await applyResScaleDrained(renderer, scene, camera);
    // render() encodes + submits synchronously (pipeline compiles happen HERE,
    // on the CPU); completion is only awaited every WARM_FLUSH_EVERY renders to
    // keep the queue bounded without paying a GPU round-trip per batch.
    for (let i = 0; i < passes; i++) {
      renderer.info.reset();
      (pipeline as unknown as { render: () => void }).render();
      if (++warmSinceFlush >= WARM_FLUSH_EVERY) await flushWarmRenders(renderer);
    }
  } catch { /* best-effort — a driver hiccup must not brick the load */ } finally {
    leaveWarm();
    closeScope();
  }
}

/** Warm EVERY material in `scene` — ALL rooms, not just the camera frustum — at the correct PSX
 *  render-target FORMAT, then return. The format part is load-bearing: our scene renders into the
 *  scene pass's offscreen target (NOT the canvas), and Three's render-pipeline cache key includes
 *  the target format (Pipelines.js _getRenderCacheKey → backend.getRenderCacheKey). compileAsync
 *  warms at the CURRENTLY-BOUND target (three.js #31220, Mugen87), so we bind scenePass.renderTarget
 *  first — otherwise it warms the canvas format and the live PSX render recompiles (the hitch).
 *  Unlike a frustum render, compileAsync traverses every material in the scene, so rooms you walk
 *  into later are covered too. Use as the GATED descent prewarm: the whole floor compiles behind
 *  the load screen, killing both the descent hitch and the move-in-hitch. See docs/PIPELINE-BUDGET.md. */
export async function warmSceneCompile(
  renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera,
): Promise<void> {
  ensurePipeline(renderer, scene, camera);
  // Land any staged resolution change FIRST — before the bind below primes a
  // render context against this target, and before `rt` is read. Doing it here
  // rather than in the nested shadow warm below keeps the graph rebuild off the
  // frames right before the reveal, and lets the compileAsync that follows warm
  // the pass it just built (see applyResScaleDrained). Gate across the drain.
  enterWarm();
  try { await applyResScaleDrained(renderer, scene, camera); } finally { leaveWarm(); }
  const rt = (scenePass as any)?.renderTarget;
  if (!rt) return;
  const prev = renderer.getRenderTarget();
  // compileAsync builds its render list via _projectObject (Renderer.js), which SKIPS an object if
  // `object.visible === false` OR (`object.frustumCulled` && it's outside the camera frustum). So a
  // plain compileAsync only warms what the spawn camera FACES — walking into a room, or even just
  // LOOKING AROUND, then compiles the rest (the hitches). Force every object visible AND
  // frustum-unculled for the compile so the WHOLE floor (all rooms, all directions) warms behind the
  // cover, then restore. (Restore is belt-and-suspenders; culling re-derives next tick.)
  const forcedVis: THREE.Object3D[] = [];
  const forcedFrustum: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh & { isMesh?: boolean; isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isPoints?: boolean };
    const isLeafMesh = !!(m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || m.isPoints);
    // A leaf mesh with no position attribute is malformed — compileAsync warns ("position not
    // found") and can reject, aborting the rest of the warm (leaving later objects, e.g. enemies,
    // un-warmed). Don't expose it; leave its culling as-is.
    if (isLeafMesh && !m.geometry?.attributes?.position) return;
    if (o.visible === false) { o.visible = true; forcedVis.push(o); }
    if (isLeafMesh && m.frustumCulled === true) { m.frustumCulled = false; forcedFrustum.push(m); }
  });
  const restoreCull = (): void => {
    for (const o of forcedVis) o.visible = false;
    for (const o of forcedFrustum) (o as THREE.Mesh).frustumCulled = true;
  };
  enterWarm();
  try {
    // MAIN pass, ALL rooms + ALL directions — bind the PSX target so the format matches, then
    // compileAsync the whole (now-uncullable) scene. compileAsync only COMPILES (no draw calls /
    // render pass), so binding the scene-pass target here is safe — it can't create an 'output'
    // read+write conflict. (A raw pipeline.renderAsync() here — outside presentPass's setup —
    // once left the 'output' texture in a TextureBinding|RenderAttachment conflict on the next
    // live frame; the shadow warm below goes through warmRenderWebGPU's normal present path
    // instead, which the boot warm already proves safe.)
    renderer.setRenderTarget(rt);
    try {
      await (renderer as unknown as { compileAsync: (s: THREE.Scene, c: THREE.Camera) => Promise<unknown> }).compileAsync(scene, camera);
    } catch { /* best-effort */ }
    // SHADOW-DEPTH pass warm — compileAsync has no shadow pass, so every material's
    // depth pipeline used to compile ON FIRST CAST: the first reveal of a room whose
    // props cast into the lamp's shadow cube stalled the GPU queue mid-play (frozen
    // canvas for seconds while the sim kept ticking — the backpressure gate skips
    // submits until the stalled frame completes). While everything is still forced
    // visible + uncullable, drive ONE real frame through the normal present pass
    // (warmRenderWebGPU — the same path the boot warm uses; the raw renderAsync that
    // corrupted the 'output' texture is NOT this) so the shadow pass draws every
    // caster and compiles + flushes its depth pipelines behind the descent cover.
    renderer.setRenderTarget(prev);
    const hasShadowCaster = ((): boolean => {
      let found = false;
      scene.traverse((o) => { if ((o as THREE.Light).isLight && o.castShadow) found = true; });
      return found;
    })();
    // ?noshadowwarm=1 — A/B the shadow-depth warm only (leave the compileAsync warm on):
    // reverts to compile-on-first-cast so the reveal stall can be measured in isolation.
    const noShadowWarm = typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('noshadowwarm') === '1';
    if (hasShadowCaster && !noShadowWarm) {
      try { await warmRenderWebGPU(renderer, scene, camera, 1); } catch { /* best-effort */ }
    }
  } finally {
    restoreCull();
    renderer.setRenderTarget(prev);
    // DRAIN FIRST, THEN OPEN THE GATE. The descent gate reveals right after this
    // returns, so warm submits still in flight have to land before the first
    // real frame — but the drain AWAITS, and dropping the gate before it means
    // the loop encodes live frames against a graph whose warm work has not
    // retired yet. Leave the warm last.
    try { await flushWarmRenders(renderer); } catch { /* best-effort */ }
    leaveWarm();
  }
}

// ?noframesync=1 reverts to pure fire-and-forget (no in-flight cap) for an A/B.
const frameSyncOn = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('noframesync') !== '1';
