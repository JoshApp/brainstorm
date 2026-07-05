import { getSettings } from '../settings/settings';
import { pipelineCount, type DelveRenderer } from '../scene/create-renderer';

// ── WARM CACHE — skip the roster warm on repeat app opens ────────────────────
//
// The full roster warm (runWarmupPassWebGPU + warmRealRoster) spawns one real
// instance of EVERY enemy / prop / item / effect and renders them behind the
// descent cover so their pipelines compile before play. That's the right price
// to pay ONCE per build — but the phone loop opens the app dozens of times a
// day, and the browser's persistent pipeline cache (Dawn's blob cache on
// Android/desktop Chrome) survives page loads: on a repeat open of the SAME
// build, a first-use pipeline creation is a fast cache hit, not a 50-300ms
// shader compile. So repeat opens skip the circus and go straight to the floor
// (warmSceneCompile still runs every descent and covers the floor's own set).
//
// The marker is keyed on everything that changes which pipeline VARIANTS the
// game renders: build SHA (new code = possibly new WGSL), backend, and the
// settings that alter the node graph. Change any of them → full warm again.
//
// SELF-HEALING: the browser may evict its pipeline cache (storage pressure,
// driver / Chrome update) — then a skipped warm means real compile hitches in
// play. We can't observe cache hits directly, but we can count pipeline
// CREATIONS (pipelineCount reads the renderer's cache map, prod-safe): every
// descent prewarm calls noteCoveredWarmPoint() after its covered compiles, so
// any growth BETWEEN those points is in-play compiling. If a session sees more
// of it than the known-benign trickle, the marker is cleared and the next open
// pays the full warm again.

declare const __BUILD_SHA__: string;

const KEY = 'delve.warm-cache.v1';
// Known-benign in-play creations per session: above this, the skip is judged
// to have been wrong. Was 12 while the clustered-grid warm mismatch made
// 10-24 per descent "normal"; with the fixed grid + coverage fixes a healthy
// session sits at ~0, so anything past a stray couple means the browser
// evicted its pipeline cache (or a real coverage gap — either way, re-warm).
const HEAL_THRESHOLD = 4;

/** The settings that change compiled pipeline variants. Resolution / DPR /
 *  frame cap are NOT here — they change target sizes and pacing, never WGSL. */
function variantKey(): string {
  const s = getSettings();
  const lampSpot = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('lampspot') !== '0';
  return [
    typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
    s.shadows, s.bloom ? 'b1' : 'b0',
    s.bandedLighting ? 'band' : 'smooth',
    s.surfaceDetail ? 'sd1' : 'sd0',
    s.aoStrength > 0 ? 'ao1' : 'ao0',
    lampSpot ? 'spot' : 'cube',
  ].join('|');
}

function readMarker(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** True when this build+settings combination has already paid the full roster
 *  warm on this device and the last such session ended compile-healthy.
 *  DEV note: dev builds share one SHA ('dev'), so the marker would ALWAYS hit
 *  and the warmup guard would warn on every session — dev skips only with
 *  ?warmskip=1 (the flag that also lets us test the skip path locally). */
export function canSkipRosterWarm(): boolean {
  if (import.meta.env.DEV
    && new URLSearchParams(location.search).get('warmskip') !== '1') return false;
  return readMarker() === variantKey();
}

/** Record that the full roster warm just completed cleanly for this key. */
export function markRosterWarmed(): void {
  try { localStorage.setItem(KEY, variantKey()); } catch { /* private mode */ }
}

// ── In-play compile health ───────────────────────────────────────────────────
let lastCoveredCount = 0;
let inPlayCreations = 0;
let healArmed = false;

/** Call right after any COVERED warm work (descent prewarm, roster warm) — the
 *  pipeline count here is the legitimate baseline; growth before the next call
 *  is in-play compiling. */
export function noteCoveredWarmPoint(renderer: DelveRenderer): void {
  const now = pipelineCount(renderer);
  if (lastCoveredCount > 0 && now > lastCoveredCount) {
    // Creations since the previous covered point happened in live play.
    inPlayCreations += now - lastCoveredCount;
    // Heal IMMEDIATELY at the descent boundary, not only at page teardown —
    // a phone session that ends in a task-kill (swipe-away) may never fire
    // pagehide, which used to leave a wrongly-warm marker in place forever.
    if (inPlayCreations > HEAL_THRESHOLD) {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
  }
  lastCoveredCount = now;
  if (!healArmed && typeof window !== 'undefined') {
    healArmed = true;
    const healCheck = (): void => {
      const tail = Math.max(0, pipelineCount(renderer) - lastCoveredCount);
      if (inPlayCreations + tail > HEAL_THRESHOLD) {
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      }
    };
    // pagehide for the normal close; visibilitychange→hidden is the reliable
    // last-chance signal on mobile (fires on tab switch / home button, before
    // a possible task-kill that never delivers pagehide).
    window.addEventListener('pagehide', healCheck);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') healCheck();
    });
  }
}
