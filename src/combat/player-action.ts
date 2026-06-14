// Player action FSM — the single AUTHORITY for the player's combat action and
// the transitions between them. Every action-start request routes through
// canStartAction(); the cancel table is the one place the lockout rules live,
// replacing logic that used to be scattered across the swing sim, dash, and
// swing-agency.
//
// THE MEMBERS, AND WHY PARRY IS ONE. Parry is its OWN committed action, not a
// flag on the swing. The tap is its shared entry point: when an enemy is
// flashing a deflectable strike (a parry opportunity is open) a tap PARRIES;
// with no opportunity the same tap is a normal swing (main.ts routes this via
// resolveTap). So a player is never locked out of ATTACKING — outside the
// window the tap always swings — but the moment they commit a parry, that
// parry is a real beat with its own duration that briefly owns the player.
//   · attacking — the viewmodel swing sim (a good dt-phase machine already);
//                OBSERVED for its phase so the cancel table can read it.
//   · dodging   — its own gesture (double-tap move), i-frames + a roll; owned
//                here as a dt-ticked committed beat.
//   · parrying  — the deflect commit; owned here as a dt-ticked committed beat
//                so it dilates with the world and the cancel table can gate it.
//
// DT-TICKED, not wall-clock: the owned beats count down on the player clock
// (tickPlayerAction), so they dilate correctly under hit-pause / bullet-time /
// the death dip.
//
// Module-level mutable state with a getter/setter API. Reset on floor load.

import type { SwingPhase } from '../player/viewmodel';

export type PlayerAction = 'idle' | 'attacking' | 'dodging' | 'parrying';

/** Live state the FSM observes for attacking (the one action it doesn't own). */
export interface PlayerActionSources {
  isSwinging: () => boolean;
  swingPhase: () => SwingPhase;
}

let sources: PlayerActionSources | null = null;
export function bindPlayerActionSources(s: PlayerActionSources): void { sources = s; }

// The two committed beats the FSM owns: remaining timers (seconds) counted
// down on the player clock.
let dodgeLeft = 0;
let parryLeft = 0;

/** Advance the owned states on the PLAYER clock, BEFORE input each frame, so a
 *  beat that ends this frame frees the next action immediately. */
export function tickPlayerAction(dt: number): void {
  if (dodgeLeft > 0) dodgeLeft = Math.max(0, dodgeLeft - dt);
  if (parryLeft > 0) parryLeft = Math.max(0, parryLeft - dt);
}

/** Current action — committed beats outrank the observed swing; parry wins. */
export function getPlayerAction(): PlayerAction {
  if (parryLeft > 0) return 'parrying';
  if (dodgeLeft > 0) return 'dodging';
  if (sources?.isSwinging()) return 'attacking';
  return 'idle';
}

export function isParrying(): boolean { return parryLeft > 0; }

// The cancel table — the one place the rules live. What may START given the
// action in progress.
export function canStartAction(kind: 'attack' | 'dodge' | 'parry'): boolean {
  if (parryLeft > 0) return false;  // the parry commits until it ends
  if (dodgeLeft > 0) return false;  // the roll commits until it ends
  const swinging = sources?.isSwinging() ?? false;
  const phase = sources?.swingPhase() ?? 'idle';
  const midStrike = swinging && (phase === 'windup' || phase === 'strike');
  switch (kind) {
    // A new swing during another swing is the COMBO chain — the swing sim
    // buffers/gates that itself.
    case 'attack': return true;
    // Can't roll or parry out of a swing's committed frames (preserves the old
    // dash-lock); a recovery is cancelable into either.
    case 'dodge':  return !midStrike;
    case 'parry':  return !midStrike;
  }
}

/** Begin a committed dodge of `durationS` (the roll/i-frame window). */
export function enterDodge(durationS: number): void { dodgeLeft = durationS; }

/** Begin a committed parry of `durationS` (the deflect commit beat). */
export function enterParry(durationS: number): void { parryLeft = durationS; }

export function resetPlayerAction(): void { dodgeLeft = 0; parryLeft = 0; }
