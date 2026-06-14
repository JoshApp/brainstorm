// Just-dodge — the skill-ceiling layer on top of the baseline dodge (dash.ts).
//
// A dodge whose i-frames negate an incoming hit in the FIRST sliver of the
// window was a last-second, REACTIVE dodge: the threat was imminent and you
// read it. Reward that. A sloppy-but-functional EARLY dodge (the hit negated
// later in the i-frame window, or an entry-grace invuln with no recent dash)
// still saves you from damage — it just doesn't pay the bonus. So everyone can
// dodge to survive; only good timing earns the payoff. The window is tuned
// forgiving for touch latency (see CONFIG.JUST_DODGE).
//
// The payoff is the combat identity in one beat — forgiving defense, ruthless
// offense:
//   - a brief slow-mo "clarity" dip (folded into the loop's time-scale),
//   - a COUNTER window: your next landed hit punishes harder AND cracks poise
//     harder (feeds the future stagger→execute loop),
//   - a stamina kickback, so a clean dodge fuels the counter (aggression-as-
//     defense, the Bloodborne/Nightreign reward routed through the dodge).
//
// Module-level mutable state with a getter/setter API, the project's standard
// pattern. NOT persisted: reset on floor load (loader.ts).

import { CONFIG } from '../config';
import { gainStamina } from './stamina';
import { playBuffApply } from '../audio/sfx';
import { enterBulletTime } from './reactive-defense';

let dashStartedAt = -Infinity;   // performance.now() ms when the last dash fired
let counterUntil = 0;            // performance.now() ms — counter window end

/** dash.ts calls this the instant a dash fires, so a later i-frame-negated hit
 *  can be classified by how soon after the dash it arrived. */
export function noteDashStarted(): void {
  dashStartedAt = performance.now();
}

/** Pure: was a hit negated `sinceDashMs` after the dash a PERFECT (reactive)
 *  dodge? True only inside the perfect window — a small delay means the threat
 *  was imminent when you dodged (you reacted); a larger one means you dodged
 *  early (safe, but not a read). A negative / huge value (no recent dash) is
 *  never perfect. */
export function isPerfectDodge(sinceDashMs: number): boolean {
  return sinceDashMs >= 0 && sinceDashMs <= CONFIG.JUST_DODGE.PERFECT_WINDOW_S * 1000;
}

/** health.ts calls this when an incoming hit was negated by the player's
 *  invulnerability. If the timing makes it a perfect dodge, fire the reward.
 *  Returns whether it counted. Consumes the dash marker so a multi-hit flurry
 *  in one i-frame window only triggers the reward once. */
export function notePlayerHitNegated(): boolean {
  if (!isPerfectDodge(performance.now() - dashStartedAt)) return false;
  dashStartedAt = -Infinity;
  enterBulletTime();   // shared reward — world crawls, you keep moving
  counterUntil = performance.now() + CONFIG.JUST_DODGE.COUNTER_WINDOW_S * 1000;
  gainStamina(CONFIG.JUST_DODGE.STAMINA_REFUND);
  playBuffApply();
  try { navigator.vibrate?.(CONFIG.JUST_DODGE.HAPTIC_MS); } catch { /* unsupported */ }
  return true;
}

/** True while the post-dodge counter opening is live. attack.ts reads it to
 *  buff the player's next landed melee hit. */
export function isJustDodgeCounterActive(): boolean {
  return performance.now() < counterUntil;
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
