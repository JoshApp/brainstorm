// Player action FSM — the single AUTHORITY for the player's combat action and
// the transitions between them. Every action-start request (swing, dodge,
// parry) routes through request(); a cancel table decides whether the action
// in progress permits it. One owner, one place the rules live — replacing the
// lockout logic that used to be scattered across the swing sim, the dash
// module, and swing-agency.
//
// DT-TICKED, not wall-clock. The owned states (dodging, parrying) carry a
// phase timer advanced by tickPlayerAction(dt) on the PLAYER clock, so they
// dilate correctly with hit-pause / bullet-time / the death dip — the bug a
// performance.now() window would have. (The enemy ability timeline + the
// swing sim are dt-ticked for the same reason; the player side now matches.)
//
// ANIMATION IS DELEGATED. The FSM owns WHICH action you're in and WHAT may
// interrupt it; the drivers own how it looks:
//   · attacking — the viewmodel swing sim (already a good dt-phase machine;
//     the FSM OBSERVES its phase for cancel windows rather than re-owning it).
//   · dodging   — the dash impulse + i-frames.
//   · parrying  — a viewmodel parry pose (per-weapon, the iteration step).
//
// Module-level mutable state with a getter/setter API — the project's
// standard pattern. Reset on floor load (loader.ts).

import type { SwingPhase } from '../player/viewmodel';

export type PlayerAction = 'idle' | 'attacking' | 'dodging' | 'parrying';

/** Live state the FSM OBSERVES for the one action it doesn't own (attacking)
 *  + the agency lock. Bound once at boot. Thunks, so this stays a pure policy
 *  layer with no heavy imports. */
export interface PlayerActionSources {
  /** The swing sim — the attacking state's driver. */
  isSwinging: () => boolean;
  swingPhase: () => SwingPhase;
}

let sources: PlayerActionSources | null = null;
export function bindPlayerActionSources(s: PlayerActionSources): void { sources = s; }

// ── Owned, dt-ticked states ──────────────────────────────────────────
// dodging + parrying are committed beats the FSM owns outright: a remaining
// timer (seconds) counted down on the player clock. attacking is observed
// from the swing sim (it owns its own phases).
let dodgeLeft = 0;
let parryLeft = 0;

/** Advance the owned states on the PLAYER clock. Called once per frame from
 *  the loop BEFORE input is processed, so a freshly-expired state frees the
 *  next action this same frame. */
export function tickPlayerAction(dt: number): void {
  if (dodgeLeft > 0) dodgeLeft = Math.max(0, dodgeLeft - dt);
  if (parryLeft > 0) parryLeft = Math.max(0, parryLeft - dt);
}

/** Current action. Priority: the owned committed beats (parry > dodge) win
 *  over the observed swing, so a parry/dodge started this frame reads
 *  immediately even if a swing is also winding down. */
export function getPlayerAction(): PlayerAction {
  if (parryLeft > 0) return 'parrying';
  if (dodgeLeft > 0) return 'dodging';
  if (sources?.isSwinging()) return 'attacking';
  return 'idle';
}

// ── The cancel table — the one place the rules live ──────────────────
// What may START given the action in progress. Encodes the existing rule
// (no dodge mid-strike) PLUS the committed-beat lockouts (nothing interrupts
// a parry; a dodge is committed until it ends). Phase-aware for attacking so
// a recovery can be cancelled but active frames can't.
export function canStartAction(kind: 'attack' | 'dodge' | 'parry'): boolean {
  if (parryLeft > 0) return false;   // parry is fully committed — its whole point
  if (dodgeLeft > 0) return false;   // the roll commits until it ends (cancel-into is a later tuning)
  const swinging = sources?.isSwinging() ?? false;
  const phase = sources?.swingPhase() ?? 'idle';
  const midStrike = swinging && (phase === 'windup' || phase === 'strike');
  switch (kind) {
    // A new swing during another swing is the COMBO chain — the swing sim
    // buffers/gates that itself, so don't second-guess it here.
    case 'attack': return true;
    // Can't roll out of a swing's committed frames (preserves the old
    // dash-lock); a recovery is cancelable.
    case 'dodge':  return !midStrike;
    // Can't catch a blow with the blade already committed to a strike; a
    // recovery is fine (reactive parries off a late swing).
    case 'parry':  return !midStrike;
  }
}

// ── Transitions — called at the three real begin-points ──────────────
/** Begin a committed dodge of `durationS` (the roll/i-frame window). */
export function enterDodge(durationS: number): void { dodgeLeft = durationS; parryLeft = 0; }
/** Begin a committed parry beat of `durationS` (locks out attack/dodge). */
export function enterParry(durationS: number): void { parryLeft = durationS; dodgeLeft = 0; }

export function isParrying(): boolean { return parryLeft > 0; }

export function resetPlayerAction(): void { dodgeLeft = 0; parryLeft = 0; }
