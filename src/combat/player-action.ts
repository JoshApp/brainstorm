// Player action state — the single source of truth for "what is the player
// DOING right now," and the one gate for "may a new action START."
//
// WHY THIS EXISTS. Combat grew three defensive/offensive actions tracked in
// three different places, with the lockout rules scattered as cross-module
// queries:
//   · ATTACKING — a real FSM already (viewmodel swing sim: windup/strike/
//     recover, isSwinging/getPhase).
//   · DODGING   — an impulse + i-frame window (dash.ts isDodging()), plus the
//     mid-strike lock (swing-agency isDashLocked()).
//   · PARRYING  — a timing window (reactive-defense isParryActive()).
// Nothing owned "the player's current action," so every new interaction
// (parry is the latest) re-derives lockouts by hand — which is how conflicts
// and freezes creep in.
//
// MIGRATION (incremental, so pillar-1 combat never breaks mid-step):
//   Phase 1 (THIS FILE, now): a single DERIVED view (getPlayerAction) + ONE
//     policy table (canStartAction) consolidating the lockout rules. Pure
//     reads over the existing sources — no behaviour change, nothing to
//     drift, safe to land while the deflect feel is still being tuned.
//   Phase 2 (next, with feel-validation): make this the AUTHORITY — the
//     attack/dodge/parry triggers consult canStartAction instead of their
//     own ad-hoc checks, and PARRY becomes a first-class state with a real
//     per-weapon animation + duration (a peer of the swing), not a window.
//
// Module-level mutable state with a getter/setter API — the project's
// standard pattern.

import type { SwingPhase } from '../player/viewmodel';

export type PlayerAction = 'idle' | 'attacking' | 'dodging' | 'parrying';

/** The live state sources, bound once at boot (main wires the viewmodel +
 *  combat modules). Kept as thunks so this module imports no heavy deps and
 *  stays a pure policy layer. */
export interface PlayerActionSources {
  isSwinging: () => boolean;
  swingPhase: () => SwingPhase;
  isDodging: () => boolean;
  parryActive: () => boolean;
  /** Mid-strike commitment that forbids a dash (swing-agency). */
  dashLocked: () => boolean;
}

let sources: PlayerActionSources | null = null;
export function bindPlayerActionSources(s: PlayerActionSources): void { sources = s; }

/** What the player is doing THIS frame. Priority resolves overlap windows:
 *  parry (briefest, most intentional) > dodge > attack > idle. A derived
 *  read — the owning systems still drive their own timers in Phase 1. */
export function getPlayerAction(): PlayerAction {
  if (!sources) return 'idle';
  if (sources.parryActive()) return 'parrying';
  if (sources.isDodging()) return 'dodging';
  if (sources.isSwinging()) return 'attacking';
  return 'idle';
}

/** The lockout policy in ONE place — what may begin given the current action.
 *  These encode the intended clean rules; Phase 2 routes the real triggers
 *  through here so the call sites stop each inventing their own gate.
 *
 *  Current rules:
 *   · attack — not while mid-roll (a dodge commits; you finish the roll
 *     before swinging). Chaining swings stays the viewmodel sim's job.
 *   · dodge  — not while the strike-commitment lock is up (can't cancel the
 *     active frames of a swing into a roll), matching swing-agency today.
 *   · parry  — not while mid-roll or mid-strike (you can't catch a blow with
 *     the blade already committed elsewhere); the anti-mash cooldown stays
 *     reactive-defense's own concern. */
export function canStartAction(kind: 'attack' | 'dodge' | 'parry'): boolean {
  if (!sources) return true;
  const phase = sources.swingPhase();
  const midStrike = sources.isSwinging() && (phase === 'windup' || phase === 'strike');
  switch (kind) {
    case 'attack': return !sources.isDodging();
    case 'dodge':  return !sources.dashLocked();
    case 'parry':  return !sources.isDodging() && !midStrike;
  }
}

export function resetPlayerAction(): void { /* derived — nothing to clear yet */ }
