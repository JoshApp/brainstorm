// Stamina — a second player resource, separate from HP.
//
// Two pools, one budget:
//   - current  — usable stamina you spend on the power moves (dodge, ranged,
//                and any future committal action). Light swings are free.
//   - reserved — stamina LOCKED by an in-progress heavy charge. Charging
//                RESERVES (doesn't drain) from current; releasing the swing
//                COMMITS it (gone); canceling (or dodging out) REFUNDS it back.
// Invariant: current >= 0, reserved >= 0, current + reserved <= MAX.
//
// Why reservation, not drain: you can never "fizzle" a heavy — you only ever
// build the charge you could afford to lock — AND backing out is free (look
// around mid-charge, or dodge-cancel, and you get it back). Regen keeps running
// while you hold a charge, just SLOWED (HOLD_REGEN_MUL), so a patient hold
// trickles regen into current → which the charge can keep reserving. It's never
// fully frozen, just less effective than actually cooling down.
//
// It's still a RHYTHM meter: regen pauses briefly after a real spend and resumes
// after a short delay. Bottoming out ("gassed") sets a longer recovery. Module-
// level mutable state with a getter/setter API. NOT persisted: reset to full on
// every floor load (save-hydration / loader).

import { CONFIG } from '../config';

let current = CONFIG.STAMINA.MAX;
let reserved = 0;
// Seconds remaining before regen resumes. Refreshed on every real spend so a
// burst of spending holds regen off until the player stops.
let regenCooldown = 0;
// "Gassed" — set when a spend bottoms the bar out, cleared once regen climbs
// back past EXHAUST_CLEAR. Drives the HUD's exhausted flash + the longer pause.
let exhausted = false;

/** Current (usable) stamina, 0..MAX. */
export function getStamina(): number {
  return current;
}

/** Stamina locked by an in-flight charge, 0..MAX. */
export function getReserved(): number {
  return reserved;
}

export function getMaxStamina(): number {
  return CONFIG.STAMINA.MAX;
}

/** 0..1 usable fraction — for the HUD gauge. */
export function staminaFraction(): number {
  return current / CONFIG.STAMINA.MAX;
}

/** 0..1 reserved fraction — for the HUD's "locked charge" ghost segment. */
export function reservedFraction(): number {
  return reserved / CONFIG.STAMINA.MAX;
}

/** True while the bar is bottomed out ("gassed"). HUD flashes red; the longer
 *  EXHAUST_RECOVERY_S pause is in effect. Clears once regen passes EXHAUST_CLEAR. */
export function isStaminaExhausted(): boolean {
  return exhausted;
}

/** Can the player afford `cost` from usable stamina right now? Cheap, side-
 *  effect-free. */
export function canSpendStamina(cost: number): boolean {
  return current >= cost;
}

// After any real drain (spend/commit), set the regen delay — longer ("gassed")
// if we bottomed out, normal otherwise — and update the exhausted flag.
function noteSpent(): void {
  if (current <= 0) {
    current = 0;
    exhausted = true;
    regenCooldown = CONFIG.STAMINA.EXHAUST_RECOVERY_S;
  } else {
    regenCooldown = CONFIG.STAMINA.REGEN_DELAY_S;
  }
}

/** Hard spend from usable stamina: only goes through if you can afford the FULL
 *  `cost`. Returns false (no change) otherwise. */
export function spendStamina(cost: number): boolean {
  if (current < cost) return false;
  current -= cost;
  noteSpent();
  return true;
}

/** Soft spend from usable stamina: fires as long as you have ANY, draining up to
 *  `cost` (clamped at 0). Returns false ONLY when usable is already empty — the
 *  "never a dead tap" path. */
export function spendStaminaSoft(cost: number): boolean {
  if (current <= 0) return false;
  current = Math.max(0, current - cost);
  noteSpent();
  return true;
}

/** Reserve up to `amount` from usable into the locked pool (the heavy-charge
 *  pour). Returns how much was actually reserved (limited by what's usable).
 *  Does NOT note a spend — reservation isn't a commitment yet, and regen keeps
 *  trickling (slowed) so a held charge can keep reserving off it. */
export function reserveStamina(amount: number): number {
  if (amount <= 0) return 0;
  const got = Math.min(amount, current);
  current -= got;
  reserved += got;
  return got;
}

/** Commit the reserved pool — the heavy actually swung. The locked stamina is
 *  spent (gone) and the regen delay / gassed check kicks in. Returns the amount
 *  committed. */
export function commitReserved(): number {
  const spent = reserved;
  reserved = 0;
  if (spent > 0) noteSpent();
  return spent;
}

/** Refund the reserved pool back to usable — the charge was canceled (looked
 *  away, or dodge-canceled). Free: no spend, no regen penalty. */
export function refundReserved(): void {
  current = Math.min(CONFIG.STAMINA.MAX, current + reserved);
  reserved = 0;
}

/** Force the gassed recovery delay WITHOUT a spend — for the desperate "stumble"
 *  dodge thrown on an empty bar: it never blocks, but it still stalls your
 *  recovery so a no-stamina escape is a punishing last resort, not free. */
export function stallRegen(): void {
  exhausted = true;
  regenCooldown = CONFIG.STAMINA.EXHAUST_RECOVERY_S;
}

/** Grant usable stamina back, clamped at MAX − reserved (locked stamina holds
 *  its room). The aggression-reward path (a melee hit refunds some). A big
 *  enough refund can lift you out of the gassed state. */
export function gainStamina(amount: number): void {
  if (amount <= 0) return;
  current = Math.min(CONFIG.STAMINA.MAX - reserved, current + amount);
  if (exhausted && current >= CONFIG.STAMINA.EXHAUST_CLEAR) exhausted = false;
}

/** Per-frame regen into usable stamina, up to (MAX − reserved). Holds during the
 *  post-spend delay, then refills at REGEN_PER_SEC — SLOWED to HOLD_REGEN_MUL of
 *  that while a charge is reserved (held), so it's less effective than actually
 *  cooling down but never frozen. Call from an 'unpaused' system. */
export function tickStamina(dt: number): void {
  if (regenCooldown > 0) {
    regenCooldown = Math.max(0, regenCooldown - dt);
    return;
  }
  const cap = CONFIG.STAMINA.MAX - reserved;
  if (current < cap) {
    const rate = reserved > 0
      ? CONFIG.STAMINA.REGEN_PER_SEC * CONFIG.STAMINA.HOLD_REGEN_MUL
      : CONFIG.STAMINA.REGEN_PER_SEC;
    current = Math.min(cap, current + rate * dt);
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

/** Reset to full — called on floor load / run start (save-hydration / loader). */
export function resetStamina(): void {
  current = CONFIG.STAMINA.MAX;
  reserved = 0;
  regenCooldown = 0;
  exhausted = false;
}
