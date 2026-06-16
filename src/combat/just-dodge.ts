// Just-dodge — the skill-ceiling layer on top of the baseline dodge (dash.ts).
// The MIRROR of the parry: where a parry is a precisely-timed TAP that catches
// a strike, a just-dodge is a precisely-timed ROLL that slips one. Both are
// resolved enemy-side at the instant a strike connects (enemy.ts) and gated on
// the same kind of read — NOT on "my i-frames happened to eat a hit" (that
// rewarded standing in the wrong place with invuln up — backwards + cheesy).
//
// The read: you START the roll within the PERFECT_WINDOW before the strike
// lands (reacting to the white/red flash). A baseline dodge that's merely
// EARLY (or whose i-frames clip a hit by luck) still saves you from damage — it
// just doesn't pay the bonus. Window tuned forgiving for touch latency.
//
// The payoff is the combat identity in one beat — forgiving defense, ruthless
// offense:
//   - asymmetric BULLET TIME (shared with the parry's dodge reward): the world
//     crawls, you keep full speed (reactive-defense's enterBulletTime),
//   - a COUNTER window: your next landed hit punishes harder AND cracks poise
//     harder (feeds the stagger→execute loop),
//   - a stamina kickback, so a clean dodge fuels the counter.
//
// Module-level mutable state with a getter/setter API, the project's standard
// pattern. NOT persisted: reset on floor load (loader.ts).

import { CONFIG } from '../config';
import { gameNow } from '../engine/game-clock';
import { gainStamina } from './stamina';
import { playBuffApply } from '../audio/sfx';
import { enterBulletTime } from './reactive-defense';
import { DEV } from '../debug/dev';
import { flashReaction } from '../debug/reaction-debug';

let dashStartedAt = -Infinity;   // gameNow() ms when the last dash fired
let counterUntil = 0;            // gameNow() ms — counter window end

/** dash.ts calls this the instant a dash fires, so the enemy can classify a
 *  strike landing soon after as a precisely-timed (perfect) dodge. */
export function noteDashStarted(): void {
  dashStartedAt = gameNow();
}

/** Pure: is a strike landing `sinceDashMs` after the roll a PERFECT (reactive)
 *  dodge? True only inside the perfect window — you committed the roll just
 *  before the blow, reading the telegraph. A larger value means you rolled
 *  early (safe, but not a read); a negative / huge value (no recent dash) is
 *  never perfect. */
export function isPerfectDodge(sinceDashMs: number): boolean {
  return sinceDashMs >= 0 && sinceDashMs <= CONFIG.JUST_DODGE.PERFECT_WINDOW_S * 1000;
}

/** enemy.ts calls this when a strike would connect with (or just-misses) a
 *  rolling player. If the roll START was a precise read of THIS strike, pay the
 *  just-dodge reward and report it. Consumes the dash marker so one roll
 *  rewards once, even against a flurry. The roll's own i-frames handle the
 *  actual damage negation — this is purely the skill payoff. */
export function tryJustDodge(): boolean {
  if (!isPerfectDodge(gameNow() - dashStartedAt)) return false;
  dashStartedAt = -Infinity;
  enterBulletTime();   // shared reward — world crawls, you keep moving
  counterUntil = gameNow() + CONFIG.JUST_DODGE.COUNTER_WINDOW_S * 1000;
  gainStamina(CONFIG.STAMINA.DASH_COST * CONFIG.JUST_DODGE.REFUND_FRAC);  // partial dodge kickback
  playBuffApply();
  try { navigator.vibrate?.(CONFIG.JUST_DODGE.HAPTIC_MS); } catch { /* unsupported */ }
  // DEV: hold the label for the bullet-time duration so the slow-mo window is
  // visible end-to-end — when it fades, the dip is over.
  if (DEV) flashReaction('JUST DODGE', '#7fe0ff', CONFIG.BULLET_TIME.DURATION_S * 1000);
  return true;
}

/** True while the post-dodge counter opening is live. attack.ts reads it to
 *  buff the player's next landed melee hit. */
export function isJustDodgeCounterActive(): boolean {
  return gameNow() < counterUntil;
}

/** Close the counter window — attack.ts calls this once a counter hit lands, so
 *  the bonus is a single discrete punish, not a free DPS window. */
export function consumeJustDodgeCounter(): void {
  counterUntil = 0;
}

/** Reset on floor load / death. (The slow-mo dip now lives in
 *  reactive-defense's bullet-time, reset alongside this.) */
export function resetJustDodge(): void {
  dashStartedAt = -Infinity;
  counterUntil = 0;
}
