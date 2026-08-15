import { CONFIG } from '../config';
import { getSettings, type Settings } from '../settings/settings';
import { isDesktopLike } from '../controls/platform';
import { setPS1Scale, setBloomEnabled } from '../style/render-frame';
import { setWebGPULeanBloom, setWebGPUGpuTimingWanted } from '../style/render-webgpu';
import { setAdaptiveCeiling, setAdaptiveResolution } from './adaptive-resolution';
import { profilerToolsWanted, type DelveRenderer } from './create-renderer';

// Video settings application — render scale (the adaptive ceiling + fixed value
// when adaptive is off), adaptive resolution (phones only), bloom, and the DPR
// cap. ONE module so boot and the onSettingsChanged subscription apply them
// identically. Owns the debounced pixel-ratio apply (the PIXEL DENSITY slider
// streams 'input' while dragging — buffers rebuild once when the drag settles).

let renderer: DelveRenderer | null = null;

/** Wire the renderer this module drives. Call once at boot, before the first
 *  applyVideoSettings(). Also applies the initial DPR cap + canvas size. */
export function initVideoSettings(r: DelveRenderer): void {
  renderer = r;
  // DPR cap — the biggest single lever against fragment/fill cost. Desktop
  // debug stays crisp at CONFIG.PIXEL_RATIO_CAP; mobile honours the live PIXEL
  // DENSITY setting (see effectiveDprCap + the GRAPHICS slider).
  r.setPixelRatio(Math.min(window.devicePixelRatio, effectiveDprCap()));
  r.setSize(window.innerWidth, window.innerHeight);
}

export function applyVideoSettings(s: Settings = getSettings()): void {
  setAdaptiveCeiling(s.renderScale);
  const adaptiveOn = s.adaptiveResolution && !isDesktopLike();
  setAdaptiveResolution(adaptiveOn);
  // setAdaptiveResolution early-returns when the flag is unchanged, so set the
  // fixed scale explicitly whenever adaptive is off (desktop, or toggled off).
  if (!adaptiveOn) setPS1Scale(s.renderScale);
  setBloomEnabled(s.bloom);
  setWebGPULeanBloom(s.leanBloom);   // WebGPU-only; no-op on WebGL
  // Only pay for GPU timestamps when something reads them. The adaptive scaler
  // is the one real consumer, and it is a setting the player can switch off —
  // which used to change nothing, because the flag that enables the timer is
  // decided at renderer construction from the platform alone. See
  // setWebGPUGpuTimingWanted.
  setWebGPUGpuTimingWanted(adaptiveOn || profilerToolsWanted());
  scheduleDprApply();   // honour the PIXEL DENSITY slider (debounced + no-op if unchanged)
}

// Effective DPR cap: desktop debug stays crisp at the CONFIG cap; mobile (the
// fill-bound target) honours the live PIXEL DENSITY setting.
function effectiveDprCap(): number {
  return isDesktopLike() ? CONFIG.PIXEL_RATIO_CAP : getSettings().pixelRatioCap;
}

// Apply the DPR cap to the renderer + resync the buffers. Re-creating the
// drawing buffer + render targets is exactly what a window resize does, so we
// reuse that path: set the ratio + size (so domElement.width is fresh BEFORE
// any resize listener reads it — order-independent), then dispatch 'resize' to
// resync the low-res target + bloom + post uniforms and the camera aspect
// (main.ts resize handler).
function applyDprNow(): void {
  if (!renderer) return;
  const target = Math.min(window.devicePixelRatio, effectiveDprCap());
  if (Math.abs(renderer.getPixelRatio() - target) < 0.001) return;   // unchanged → skip
  renderer.setPixelRatio(target);
  renderer.setSize(window.innerWidth, window.innerHeight);
  window.dispatchEvent(new Event('resize'));
}

let dprApplyTimer: number | undefined;
function scheduleDprApply(): void {
  if (dprApplyTimer !== undefined) clearTimeout(dprApplyTimer);
  dprApplyTimer = window.setTimeout(() => { dprApplyTimer = undefined; applyDprNow(); }, 120);
}
