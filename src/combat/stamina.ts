// Stamina — a second player resource, separate from HP.
//
// One pool, drawn by every committal physical action: light swings (a little),
// charged swings, ranged shots, and the dash/dodge (a lot). Walking is free.
// It's a RHYTHM meter, not a wall — regen pauses the instant you act and
// resumes after a short delay, so the loop is "commit a burst, then breathe."
//
// Two feel rules borrowed from Elden Ring:
//   - Never a dead tap: light swings always fire (see attack.ts); only the
//     committal actions (ranged/dash) gate, and only when the bar is *visibly*
//     empty, with a HUD flash so it's never a mystery.
//   - Bottoming out costs you: emptying the bar sets a LONGER recovery delay
//     ("gassed") than a normal spend, and the gassed state holds until regen
//     climbs back past EXHAUST_CLEAR. A single action no longer snaps straight
//     back to full.
//
// Module-level mutable state with a getter/setter API, the project's standard
// pattern. NOT persisted: regenerates in a few seconds, reset to full on every
// floor load (save-hydration).

import { CONFIG } from '../config';

let current = CONFIG.STAMINA.MAX;
// Seconds remaining before regen resumes. Refreshed on every spend/drain so a
// burst of spending holds regen off until the player stops.
let regenCooldown = 0;
// "Gassed" — set when a spend bottoms the bar out, cleared once regen climbs
// back past EXHAUST_CLEAR. Drives the HUD's exhausted flash and the longer
// recovery pause.
let exhausted = false;

/** Current stamina, 0..MAX. */
export function getStamina(): number {
  return current;
}

export function getMaxStamina(): number {
  return CONFIG.STAMINA.MAX;
}

/** 0..1 — for the HUD gauge. */
export function staminaFraction(): number {
  return current / CONFIG.STAMINA.MAX;
}

/** True while the bar is bottomed out ("gassed"). HUD flashes red; the longer
 *  EXHAUST_RECOVERY_S pause is in effect. Clears once regen passes EXHAUST_CLEAR. */
export function isStaminaExhausted(): boolean {
  return exhausted;
}

/** Can the player afford `cost` right now? Cheap, side-effect-free. */
export function canSpendStamina(cost: number): boolean {
  return current >= cost;
}

// After any drain, set the regen delay — longer ("gassed") if we bottomed out,
// normal otherwise — and update the exhausted flag.
function noteSpent(): void {
  if (current <= 0) {
    current = 0;
    exhausted = true;
    regenCooldown = CONFIG.STAMINA.EXHAUST_RECOVERY_S;
  } else {
    regenCooldown = CONFIG.STAMINA.REGEN_DELAY_S;
  }
}

/** Hard spend: only goes through if you can afford the FULL `cost`. Returns
 *  false (no change) otherwise. Used where partial payment makes no sense —
 *  a charged swing that can't afford its bonus fizzles to a normal swing. */
export function spendStamina(cost: number): boolean {
  if (current < cost) return false;
  current -= cost;
  noteSpent();
  return true;
}

/** Soft spend: fires as long as you have ANY stamina, draining up to `cost`
 *  (clamped at 0). Returns false ONLY when the bar is already empty. This is
 *  the "never a dead tap" path — an action with a sliver of stamina still
 *  commits and just gasses you, rather than being swallowed. Light swings call
 *  it and ignore the result (they always swing); ranged/dash respect false to
 *  gate when visibly empty. */
export function spendStaminaSoft(cost: number): boolean {
  if (current <= 0) return false;
  current = Math.max(0, current - cost);
  noteSpent();
  return true;
}

/** Continuous drain (reserved for a future hold-action). Drains up to
 *  `perSec * dt`, clamped to what's left; returns the amount actually drained. */
export function drainStamina(perSec: number, dt: number): number {
  const want = perSec * dt;
  const got = Math.min(current, want);
  if (got > 0) {
    current -= got;
    noteSpent();
  }
  return got;
}

/** Grant stamina back, clamped at MAX — the aggression-reward path (a melee
 *  hit refunds some) and any future on-hit/on-kill effects. Doesn't touch the
 *  regen delay (it's an instant top-up, not a spend), but a big enough refund
 *  can lift you out of the gassed state just like regen crossing EXHAUST_CLEAR. */
export function gainStamina(amount: number): void {
  if (amount <= 0) return;
  current = Math.min(CONFIG.STAMINA.MAX, current + amount);
  if (exhausted && current >= CONFIG.STAMINA.EXHAUST_CLEAR) exhausted = false;
}

/** Per-frame regen. Holds during the post-spend delay, then refills at
 *  REGEN_PER_SEC. Clears the gassed flag once it climbs past EXHAUST_CLEAR.
 *  Call from an 'unpaused' system so it pauses with the world. */
export function tickStamina(dt: number): void {
  if (regenCooldown > 0) {
    regenCooldown = Math.max(0, regenCooldown - dt);
    return;
  }
  if (current < CONFIG.STAMINA.MAX) {
    current = Math.min(CONFIG.STAMINA.MAX, current + CONFIG.STAMINA.REGEN_PER_SEC * dt);
  }
  if (exhausted && current >= CONFIG.STAMINA.EXHAUST_CLEAR) {
    exhausted = false;
  }
}

/** True while regen is held off (just spent). HUD uses it to keep the gauge
 *  visible through the pause rather than fading mid-refill. */
export function isStaminaRegenHeld(): boolean {
  return regenCooldown > 0;
}

/** Reset to full — called on floor load / run start (save-hydration). */
export function resetStamina(): void {
  current = CONFIG.STAMINA.MAX;
  regenCooldown = 0;
  exhausted = false;
}
