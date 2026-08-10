// ── RETURN TO TITLE, WITHOUT THROWING THE PROCESS AWAY ───────────────────────
//
// "Quit to menu", "abandon run" and the death screen's continue were all
// `location.reload()`. That is the most expensive possible way to end a run:
//
//   - three's in-process pipeline cache (~250 pipelines, the ONE cache with a
//     guaranteed hit rate) is destroyed,
//   - `rosterPrecompiled` resets, so the next run's warm decision falls back to
//     the skip marker and the browser's pipeline cache,
//   - and when that cache doesn't deliver, the whole roster compiles in play —
//     measured at 215 in-play compiles in a single phone session.
//
// Which is why "pressing descend again does the whole loading screen the same as
// booting up the app": it WAS booting up the app.
//
// Nothing required the reload. The title-screen DESCEND handler already starts a
// fresh run in place — startNewRun + resetCharacter + resetRunDiscoveries +
// applyState(null) + startRun — and every floor-to-floor descent already tears
// down a level and builds another in the same context. The reload was doing by
// brute force what the normal paths already do properly.
//
// This is the seam: boot registers how to get back to the title, and the places
// that end a run call it instead of reloading. The fallback IS a reload, for the
// window before boot has registered anything — better a slow correct path than a
// dead button.

let handler: (() => void) | null = null;

/** Register the real return-to-title (boot does this once the title scene and
 *  its screen are both reachable). */
export function setReturnToTitle(fn: () => void): void { handler = fn; }

/** Tear the current run down and show the title, in this same JS context.
 *  Falls back to a page reload only if boot hasn't registered yet. */
export function returnToTitle(): void {
  if (handler) { handler(); return; }
  window.location.reload();
}
