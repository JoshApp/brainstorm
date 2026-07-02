// The boot loading veil (index.html #boot-loading) — progress bar + teardown.
// Module-scope so EVERY boot path can clear it (title, scenario, the debug
// ?show* hooks), not just the title. The title path holds it across a
// PWA-update reload; a safety timer guarantees it never strands if some path
// forgets to clear it.

/** Drive the veil's warmup progress bar (#boot-loading .boot-bar), 0..1 — fed
 *  by the roster warm's onProgress while pipelines compile. Reveals the bar on
 *  first call so fast/cached boots never flash it. */
export function setBootProgress(t: number): void {
  const bar = document.querySelector('#boot-loading .boot-bar') as HTMLElement | null;
  const fill = document.querySelector('#boot-loading .boot-bar-fill') as HTMLElement | null;
  if (!bar || !fill) return;
  bar.classList.add('on');
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, t))})`;
}

/** Fade out + remove the veil. Idempotent. */
export function hideBootLoading(): void {
  const el = document.getElementById('boot-loading');
  if (!el || el.classList.contains('boot-hide')) return;
  el.classList.add('boot-hide');
  window.setTimeout(() => el.remove(), 500);
}

/** Arm the strand-proof safety teardown. Just past awaitBootUpdate's own 6s
 *  cap, so a legit update gate resolves first; this only fires if a boot path
 *  never cleared the veil. */
export function armBootVeilSafetyNet(): void {
  window.setTimeout(hideBootLoading, 7000);
}
