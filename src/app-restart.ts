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

import { closeAllScreens } from './ui/screen-manager';

let handler: (() => void) | null = null;

/** Register the real return-to-title (boot does this once the title scene and
 *  its screen are both reachable). */
export function setReturnToTitle(fn: () => void): void { handler = fn; }

/** Tear the current run down and show the title, in this same JS context.
 *  Falls back to a page reload only if boot hasn't registered yet. */
export function returnToTitle(): void {
  // CLOSE EVERY SCREEN FIRST. The reload used to do this by destroying the
  // document; without it, whatever was open when you left the run is still open
  // on top of the title — the settings panel you quit FROM, the inventory behind
  // it, the end screen you rose from. Reported from the phone: "these menus stay
  // kinda open, going back to the main menu needs to close down menus".
  //
  // Here rather than at each call site because this is the one choke point all
  // three exits (quit, abandon, rise-again) already pass through, so a fourth
  // exit added later cannot forget. It runs before the reload fallback too —
  // harmless there, and it keeps the two paths behaviourally identical.
  closeAllScreens();
  if (handler) { handler(); return; }
  window.location.reload();
}
