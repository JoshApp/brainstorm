// Stamina — a second player resource, separate from HP.
//
// It gates the high-value actions the playtest flagged as drawback-free:
// charged melee swings and ranged shots cost stamina (sprint/dodge will
// follow). Steady tapping never touches it; spamming the strong stuff
// runs you dry and forces a beat of normal play while it refills.
//
// Module-level mutable state with a getter/setter API, the project's
// standard pattern. Callers don't reach in — they ask `canSpend`, call
// `spend`/`drain`, and the regen tick + HUD read the rest. NOT persisted:
// it regenerates to full in a few seconds, and save-hydration resets it
// to full on every floor load.

import { CONFIG } from '../config';

let current = CONFIG.STAMINA.MAX;
// Seconds remaining before regen resumes. Refreshed on every spend/drain
// so a burst of spending holds regen off until the player stops.
let regenCooldown = 0;

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

/** Can the player afford `cost` right now? Cheap, side-effect-free —
 *  use it to gate an action before committing to it. */
export function canSpendStamina(cost: number): boolean {
  return current >= cost;
}

/** Spend a fixed `cost` (a charged swing, a shot). Returns true if it was
 *  affordable and spent, false if not (caller decides the fallback —
 *  fizzle to a normal swing, swallow the shot, etc.). Refreshes the regen
 *  delay only on a successful spend. */
export function spendStamina(cost: number): boolean {
  if (current < cost) return false;
  current -= cost;
  regenCooldown = CONFIG.STAMINA.REGEN_DELAY_S;
  return true;
}

/** Continuous drain (sprint/dodge-hold). Drains up to `perSec * dt`,
 *  clamped to what's left; returns the amount actually drained so the
 *  caller can tell whether the action could be sustained this frame.
 *  Holds regen off while anything is draining. */
export function drainStamina(perSec: number, dt: number): number {
  const want = perSec * dt;
  const got = Math.min(current, want);
  if (got > 0) {
    current -= got;
    regenCooldown = CONFIG.STAMINA.REGEN_DELAY_S;
  }
  return got;
}

/** Per-frame regen. Holds during the post-spend delay, then refills at
 *  REGEN_PER_SEC. Call from an 'unpaused' system so it pauses with the
 *  world (menus / hit-pause). */
export function tickStamina(dt: number): void {
  if (regenCooldown > 0) {
    regenCooldown = Math.max(0, regenCooldown - dt);
    return;
  }
  if (current < CONFIG.STAMINA.MAX) {
    current = Math.min(CONFIG.STAMINA.MAX, current + CONFIG.STAMINA.REGEN_PER_SEC * dt);
  }
}

/** True while regen is held off (just spent). The HUD uses this to keep
 *  the gauge visible through the pause rather than fading mid-refill. */
export function isStaminaRegenHeld(): boolean {
  return regenCooldown > 0;
}

/** Reset to full — called on floor load / run start (save-hydration). */
export function resetStamina(): void {
  current = CONFIG.STAMINA.MAX;
  regenCooldown = 0;
}
