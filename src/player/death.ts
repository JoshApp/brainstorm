import { CONFIG } from '../config';
import { setPersistentVignette } from '../ui/vignette';
import { showDeathOverlay } from '../ui/death-overlay';
import { showEndScreen } from '../ui/end-screen';
import { getRunState, elapsedString, clearSave } from '../state/run-state';

// Death sequence orchestrator.
//
// Owns a global time-scale that the main tick multiplies dt by. Default 1.
// On triggerDeath(): scale ramps from 1 toward DEATH_SLOWMO_SCALE while
// the red vignette darkens and the epitaph fades in. After
// DEATH_SEQUENCE_DURATION the end-screen recap appears with run stats
// + a single RISE AGAIN action.
//
// RISE AGAIN reloads the page; the save was cleared at death, so the
// next boot lands on the title screen with no CONTINUE button.

let dying = false;
let elapsed = 0;

// Pulled at death-time from the death overlay's epitaph list so the
// end-screen can echo the same line. Set inside triggerDeath().
const EPITAPH_FALLBACKS = [
  'forgotten on depth 1.',
  'she was unmade in the first dark.',
  'the dungeon does not remember your name.',
  'a brief descent.',
  'unremarkable, even to the worms.',
];

export function isDying(): boolean {
  return dying;
}

/** Multiplier applied to dt in the main tick — slows world during death sequence. */
export function getTimeScale(): number {
  if (!dying) return 1;
  const t = Math.min(1, elapsed / 0.5);
  return 1 - (1 - CONFIG.DEATH_SLOWMO_SCALE) * t;
}

export function triggerDeath() {
  if (dying) return;
  dying = true;
  elapsed = 0;
  setPersistentVignette(1, CONFIG.DEATH_VIGNETTE_DARKEN_MS);
  const epitaph = showDeathOverlay();
  // Snapshot the run BEFORE clearing save so the recap shows real numbers.
  const run = getRunState();
  const depth = run?.depth ?? 1;
  const kills = run?.kills ?? 0;
  const itemsFound = run?.itemsFound.length ?? 0;
  const time = elapsedString();
  clearSave();
  // After the death sequence (slow-mo + vignette + initial overlay),
  // show the end screen + RISE AGAIN action.
  setTimeout(() => {
    showEndScreen(
      {
        depth,
        kills,
        itemsFound,
        elapsed: time,
        epitaph: epitaph ?? EPITAPH_FALLBACKS[0],
      },
      () => window.location.reload(),
    );
  }, CONFIG.DEATH_SEQUENCE_DURATION * 1000);
}

/** Advance the death timer. Always uses real dt (not scaled) so the sequence
 *  itself doesn't slow down with the world. */
export function tickDeath(realDt: number) {
  if (!dying) return;
  elapsed += realDt;
}
