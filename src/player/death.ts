import { CONFIG } from '../config';
import { setPersistentVignette } from '../ui/vignette';
import { showDeathOverlay } from '../ui/death-overlay';

// Death sequence orchestrator.
//
// Owns a global time-scale that the main tick multiplies dt by. Default 1.
// On triggerDeath(): scale ramps from 1 toward DEATH_SLOWMO_SCALE while the
// red vignette darkens and the epitaph fades in. After DEATH_SEQUENCE_DURATION
// the page reloads (cheap prototype restart — proper restart logic later).

let dying = false;
let elapsed = 0;

export function isDying(): boolean {
  return dying;
}

/** Multiplier applied to dt in the main tick — slows world during death sequence. */
export function getTimeScale(): number {
  if (!dying) return 1;
  // Ease from 1 → DEATH_SLOWMO_SCALE over 0.5s, then hold.
  const t = Math.min(1, elapsed / 0.5);
  return 1 - (1 - CONFIG.DEATH_SLOWMO_SCALE) * t;
}

export function triggerDeath() {
  if (dying) return;
  dying = true;
  elapsed = 0;
  setPersistentVignette(1, CONFIG.DEATH_VIGNETTE_DARKEN_MS);
  showDeathOverlay();
  // Reload after the full sequence — fresh dungeon, fresh HP, fresh enemy.
  setTimeout(() => {
    window.location.reload();
  }, CONFIG.DEATH_SEQUENCE_DURATION * 1000);
}

/** Advance the death timer. Always uses real dt (not scaled) so the sequence
 *  itself doesn't slow down with the world. */
export function tickDeath(realDt: number) {
  if (!dying) return;
  elapsed += realDt;
}
