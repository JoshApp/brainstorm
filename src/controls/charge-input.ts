// Hold-to-charge input — prototype.
//
// A second attack pathway parallel to attack-input.ts. While a right-
// side touch is held STILL (no drag) for longer than the tap window,
// a charge accumulates. On release, if the charge crossed the trigger
// threshold, a charged attack fires; otherwise the existing tap path
// runs as usual. Any drag past the tap movement threshold cancels the
// charge — looking around always wins.
//
// Per-weapon opt-in: not every weapon is a charge weapon. Combat reads
// `wasChargedAttack()` after the attack fires; weapons that don't use
// charges ignore the flag. Today only the sword uses it (prototype) —
// crossbow / focus / future greataxe will follow.

import { isWorldPausedByScreen } from '../ui/screen-manager';
import { CONFIG } from '../config';
import { reserveStamina, commitReserved, refundReserved } from '../combat/stamina';
import { getCurrentWeapon } from '../player/current-weapon';

// Aligned with TAP_MAX_MS in input-touch (320). Quick releases below
// this fire a normal tap; longer holds are intentional charges. Tuned
// up from 220 to reduce accidental-charges on slow taps — a thumb-
// down landing then immediate release commonly takes ~250ms.
const CHARGE_RAMP_START_MS = 320;
const CHARGE_FULL_MS       = 900;   // RANGED time-ramp: fully cooked at this hold

let liveProgress = 0;                // 0..1 — current visible charge, updated by setChargeProgress
let chargedPending = false;          // a charged attack release is queued for the game loop
let chargedAmount  = 0;              // the progress level at the moment of release (0..1)
let chargedPerfect = false;          // was the queued release inside the perfect window?

// MELEE charge is a stamina POUR (CONFIG.CHARGE): holding drains stamina and the
// charge level = stamina poured / CHARGED_COST, so it auto-caps when you run
// dry. Tracked here across frames; ranged keeps the old time-ramp (no drain).
let poured = 0;                      // stamina spent into the current melee charge
let lastHeldMs = 0;                  // previous frame's heldMs, for the per-frame delta
let perfectUntil = 0;                // performance.now() ms — end of the perfect-release window
let wasFull = false;                 // latched once liveProgress hits 1 (opens the window once)
let suppressed = false;              // dodge-canceled: don't rebuild until the touch releases
// Live touch position of the charging finger (clientX/Y). The
// charge-ring overlay reads these so the visual anchors to the
// thumb instead of a fixed corner. -1 means "no live charge".
let chargePosX = -1;
let chargePosY = -1;

/** Current charge progress (0..1) for the visible HUD ring. Returns 0
 *  when no charge is in flight. Called every frame by the overlay. */
export function getChargeProgress(): number {
  return liveProgress;
}

/** Live touch position of the charging finger, in client (CSS) pixels.
 *  Returns null when no charge is in flight. The charge-ring overlay
 *  reads this so it can anchor to the thumb instead of a fixed corner. */
export function getChargePosition(): { x: number; y: number } | null {
  if (chargePosX < 0 || liveProgress <= 0) return null;
  return { x: chargePosX, y: chargePosY };
}

/** Set by the input layer when a charge-eligible touch is held. The
 *  position usually tracks the touch's last clientX/Y so the ring
 *  follows the thumb if the player adjusts. */
export function setChargePosition(x: number, y: number): void {
  chargePosX = x;
  chargePosY = y;
}

/** Set by the input layer each frame as a touch is held. Pass the
 *  elapsed-since-touchstart in ms; this module computes the 0..1 progress and
 *  stores it for the overlay.
 *
 *  MELEE: a stamina RESERVATION — each frame reserves stamina at
 *  CONFIG.CHARGE.RESERVE_PER_SEC, and the charge level is the fraction of
 *  CHARGED_COST reserved so far. When usable stamina runs out reserveStamina
 *  returns 0, the charge stops filling, and you're left holding whatever you
 *  could lock — no fizzle, ever. Release COMMITS the reservation, cancel REFUNDS
 *  it. Hitting full opens the perfect-release window. RANGED: unchanged — a
 *  time-ramp with no reservation (cost is the flat per-shot spend + bloom). */
export function setChargeFromHeldMs(heldMs: number): void {
  if (heldMs < CHARGE_RAMP_START_MS) {
    liveProgress = 0;
    poured = 0;
    wasFull = false;
    suppressed = false;    // a fresh press (back in the tap window) clears suppression
    lastHeldMs = heldMs;   // track so the first charging frame has a small delta
    return;
  }
  if (suppressed) {
    // Dodge-canceled while the attack finger is still down — stay at zero until
    // they release and press again (the ramp-start branch above clears it).
    liveProgress = 0;
    lastHeldMs = heldMs;
    return;
  }
  if (getCurrentWeapon().ranged) {
    // Ranged: the original time-based ramp, no stamina pour.
    const t = (heldMs - CHARGE_RAMP_START_MS) / (CHARGE_FULL_MS - CHARGE_RAMP_START_MS);
    liveProgress = Math.max(0, Math.min(1, t));
    lastHeldMs = heldMs;
    return;
  }
  // Melee pour. Clamp the per-frame delta so a frame hitch can't dump the whole
  // bar into one charge step.
  const dtMs = Math.max(0, Math.min(50, heldMs - lastHeldMs));
  lastHeldMs = heldMs;
  const cost = CONFIG.STAMINA.CHARGED_COST;
  if (poured < cost) {
    const want = Math.min(CONFIG.CHARGE.RESERVE_PER_SEC * (dtMs / 1000), cost - poured);
    poured += reserveStamina(want);
    liveProgress = Math.min(1, poured / cost);
    if (liveProgress >= 1 && !wasFull) {
      // Just topped out — open the perfect-release window.
      wasFull = true;
      perfectUntil = performance.now() + CONFIG.CHARGE.PERFECT_RELEASE_MS;
    }
  }
}

/** True while the perfect-release window is open (charge full, within the timing
 *  window). The charge-ring + weapon gleam flash on this. */
export function isChargePerfectWindow(): boolean {
  return wasFull && liveProgress >= 1 && performance.now() <= perfectUntil;
}

/** Dodge-cancel: drop an in-flight charge and REFUND its reservation (free), and
 *  keep it from rebuilding until the held attack touch is released. Call before
 *  the dodge spends, so the refunded stamina can fund the escape. */
export function suppressChargeUntilRelease(): void {
  refundReserved();
  suppressed = true;
  liveProgress = 0;
  poured = 0;
  wasFull = false;
}

/** Called by the input layer when a charge-eligible touch ends. If the
 *  charge had any progress (> 0), queues a charged attack release for
 *  the game loop. Returns true if a charged attack was queued — the
 *  caller can then SKIP firing the normal tap-attack to avoid both
 *  firing on the same release. */
export function tryReleaseChargedAttack(): boolean {
  if (isWorldPausedByScreen()) {
    liveProgress = 0;
    return false;
  }
  if (liveProgress <= 0) {
    refundReserved();   // nothing to fire — hand back any stray reservation
    poured = 0;
    suppressed = false; // touch released → clear any dodge-cancel suppression
    return false;
  }
  chargedAmount  = liveProgress;
  chargedPerfect = isChargePerfectWindow();
  chargedPending = true;
  commitReserved();   // the heavy swung — spend the locked stamina
  liveProgress   = 0;
  poured = 0;
  wasFull = false;
  return true;
}

/** Called by the input layer when the charge is interrupted (drag past
 *  the tap-movement threshold, screen rotation, etc). Clears progress
 *  WITHOUT firing. */
export function cancelCharge(): void {
  refundReserved();   // backed out — give the locked stamina back, free
  liveProgress = 0;
  poured = 0;
  wasFull = false;
  suppressed = false;
  chargePosX = -1;
  chargePosY = -1;
}

/** Game-loop side: returns the charge amount (0..1) of the just-pressed
 *  attack, or 0 if it wasn't a charged attack. Consumed once per press,
 *  same pattern as consumeAttackPressed. */
export function consumeChargedAmount(): number {
  if (!chargedPending) return 0;
  chargedPending = false;
  const amt = chargedAmount;
  chargedAmount = 0;
  return amt;
}

/** Whether the just-consumed charged release landed in the perfect window. Read
 *  by combat right AFTER consumeChargedAmount, in the same press. Cleared on
 *  read so it bills once. */
export function consumeChargedPerfect(): boolean {
  const p = chargedPerfect;
  chargedPerfect = false;
  return p;
}
