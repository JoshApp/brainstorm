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

// Aligned with TAP_MAX_MS in input-touch (320). Quick releases below
// this fire a normal tap; longer holds are intentional charges. Tuned
// up from 220 to reduce accidental-charges on slow taps — a thumb-
// down landing then immediate release commonly takes ~250ms.
const CHARGE_RAMP_START_MS = 320;
const CHARGE_FULL_MS       = 900;   // at this point, charge is fully cooked

let liveProgress = 0;                // 0..1 — current visible charge, updated by setChargeProgress
let chargedPending = false;          // a charged attack release is queued for the game loop
let chargedAmount  = 0;              // the progress level at the moment of release (0..1)
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
 *  elapsed-since-touchstart in ms; this module computes the 0..1
 *  progress and stores it for the overlay. */
export function setChargeFromHeldMs(heldMs: number): void {
  if (heldMs < CHARGE_RAMP_START_MS) { liveProgress = 0; return; }
  const t = (heldMs - CHARGE_RAMP_START_MS) / (CHARGE_FULL_MS - CHARGE_RAMP_START_MS);
  liveProgress = Math.max(0, Math.min(1, t));
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
  if (liveProgress <= 0) return false;
  chargedAmount  = liveProgress;
  chargedPending = true;
  liveProgress   = 0;
  return true;
}

/** Called by the input layer when the charge is interrupted (drag past
 *  the tap-movement threshold, screen rotation, etc). Clears progress
 *  WITHOUT firing. */
export function cancelCharge(): void {
  liveProgress = 0;
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
