// The boot loading veil (index.html #boot-loading) — progress bar + teardown.
// Module-scope so EVERY boot path can clear it (title, scenario, the debug
// ?show* hooks), not just the title. The title path holds it across a
// PWA-update reload; a safety timer guarantees it never strands if some path
// forgets to clear it.

/** Drive the veil's warmup progress bar (#boot-loading .boot-bar), 0..1 — fed
 *  by the roster warm's onProgress while pipelines compile. Reveals the bar on
 *  first call so fast/cached boots never flash it. */
export function setBootProgress(t: number): void {
  bootVeilHeartbeat();
  const bar = document.querySelector('#boot-loading .boot-bar') as HTMLElement | null;
  const fill = document.querySelector('#boot-loading .boot-bar-fill') as HTMLElement | null;
  if (!bar || !fill) return;
  bar.classList.add('on');
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, t))})`;
}

/** Fade out + remove the veil. Idempotent. */
export function hideBootLoading(): void {
  // The veil owns HUD visibility while it's up (body.booting — set in the HTML
  // so it holds from the very first paint); release it with the veil.
  document.body.classList.remove('booting');
  const el = document.getElementById('boot-loading');
  if (!el || el.classList.contains('boot-hide')) return;
  el.classList.add('boot-hide');
  window.setTimeout(() => el.remove(), 500);
}

/** Watchdog heartbeat: any boot path doing REAL work (update gate polling, warm
 *  progress, compile-settle frames) calls this to prove the boot isn't stranded.
 *  Without it, the safety net raced legitimate slow boots — a cold-cache warm can
 *  honestly take >7s, the net fired hideBootLoading() alone, and body.booting
 *  dropped before the title screen set body.hud-hidden: the whole HUD (the full
 *  gold flask, most visibly) leaked over the loading/title backdrop. */
let lastHeartbeat = 0;
export function bootVeilHeartbeat(): void {
  lastHeartbeat = performance.now();
}

/** Arm the strand-proof safety teardown — a WATCHDOG, not a fixed timer: it
 *  tears the veil down only after 7s with NO heartbeat, i.e. a boot path that
 *  genuinely stranded (forgot to clear the veil / hung with no progress). A slow
 *  but live boot keeps petting it and is left alone. */
export function armBootVeilSafetyNet(): void {
  const QUIET_MS = 7000;
  bootVeilHeartbeat();
  const check = (): void => {
    if (!document.getElementById('boot-loading')) return; // veil already gone
    const quiet = performance.now() - lastHeartbeat;
    if (quiet >= QUIET_MS) { hideBootLoading(); return; }
    window.setTimeout(check, QUIET_MS - quiet + 50);
  };
  window.setTimeout(check, QUIET_MS + 50);
}
