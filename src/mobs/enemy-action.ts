// Enemy action-layer authority — the mob mirror of the player's action FSM
// (src/combat/player-action.ts). It is NOT the whole brain: the big
// EnemyState machine (idle / alerted / chasing / winding / striking /
// recovering / searching / returning) stays in enemy.ts — that's PERCEPTION
// + LOCOMOTION + the attack-phase timeline. What lives HERE is the one thing
// the player FSM's cancel table is: the single place that owns the INTERRUPT
// beats and answers "may I act, may I be interrupted right now."
//
// Two owned committed beats, both dt-ticked (so they dilate under hit-pause /
// bullet-time / boss slow-mo — the enemy update already passes a scaled dt):
//   · stagger    — poise broken; reeling, can't act; a free-hit window. Drives
//                  the 'staggered' behaviour in enemy.ts (which reads
//                  isStaggered / staggerElapsed instead of owning its own
//                  timer — single source of truth for "how long, how far in").
//   · flinchLock — parried (deflect); can't START a new attack, but still
//                  tracks + moves. The soft interrupt.
//
// Boss phase-entry invuln is deliberately NOT here: like the PLAYER's i-frames
// (which live in player/health, not the action FSM), it's an invulnerability
// concern, not an action beat. It stays inline in enemy.ts.
//
// INSTANCED (createEnemyAction per mob) rather than a module singleton — there
// is one player but many enemies. Same getter/setter shape, closed over
// per-instance state.

import { CONFIG } from '../config';

export interface EnemyAction {
  /** Advance the owned beats on the mob's clock (the enemy update's dt). Call
   *  once per frame BEFORE the state switch, so a beat that ends this frame
   *  frees the next action immediately. */
  tick(dt: number): void;

  // ── Interrupt entry points ──────────────────────────────────────────
  /** Poise broke → reel for `durationS`. Cancels acting until it ends. */
  enterStagger(durationS: number): void;
  /** Parried → can't start a new attack for `durationS` (still mobile). */
  enterFlinchLock(durationS: number): void;

  // ── The cancel table — the one place the rules live ─────────────────
  /** May the mob START a new ability this frame? Blocked while reeling from a
   *  stagger or locked out by a parry-flinch. */
  canAct(): boolean;
  /** May a heavy hit STAGGER it? False if it's already reeling (re-stagger is
   *  a no-op). The boss phase-invuln guard stays at the call site. */
  canBeStaggered(): boolean;

  // ── Observed state ──────────────────────────────────────────────────
  isStaggered(): boolean;
  isFlinchLocked(): boolean;
  /** Seconds elapsed into the current stagger (0 when not staggered). The
   *  stagger animation reads this to drive its dizzy → settle arc. */
  staggerElapsed(): number;
  /** Seconds remaining in the current stagger (0 when not staggered). */
  staggerLeft(): number;

  reset(): void;
}

export function createEnemyAction(): EnemyAction {
  let staggerT = 0;      // > 0 while reeling
  let flinchLockT = 0;   // > 0 while parry-locked out of attacking

  return {
    tick(dt: number): void {
      if (staggerT > 0)    staggerT = Math.max(0, staggerT - dt);
      if (flinchLockT > 0) flinchLockT = Math.max(0, flinchLockT - dt);
    },

    enterStagger(durationS: number): void { staggerT = durationS; },
    enterFlinchLock(durationS: number): void { flinchLockT = durationS; },

    canAct(): boolean { return staggerT <= 0 && flinchLockT <= 0; },
    canBeStaggered(): boolean { return staggerT <= 0; },

    isStaggered(): boolean { return staggerT > 0; },
    isFlinchLocked(): boolean { return flinchLockT > 0; },
    staggerElapsed(): number {
      return staggerT > 0 ? CONFIG.POISE.STAGGER_DURATION - staggerT : 0;
    },
    staggerLeft(): number { return staggerT; },

    reset(): void { staggerT = 0; flinchLockT = 0; },
  };
}
