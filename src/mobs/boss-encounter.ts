import { emit } from '../broadcast/event-bus';
import type { Enemy } from './enemy';

// Boss ENCOUNTER container — the single source of truth for "is the boss
// fight done." A boss is often several bodies over its lifetime (the king,
// then the princes it splits into); the encounter tracks ALL of them as
// one fight. "Done" therefore means EVERY registered body is dead — never
// a stray mid-fight moment when one body dropped but its spawns are still
// up. This replaces the old implicit "no `isBoss` enemy is alive anywhere"
// inference that the bar + room-clear each guessed at separately.
//
// Lifecycle, one boss fight per floor:
//   - registerBossMember(e)  — the builder calls this for the boss on
//     spawn AND for each split child as it spawns, so membership always
//     includes in-flight splits.
//   - engageBossEncounter()  — the bar calls this when the player commits
//     (fog crossed / first aggro).
//   - tickBossEncounter()    — each frame; once engaged AND every member is
//     dead, it fires ONCE: emits 'boss:defeated' + notifies onComplete
//     listeners. Split children register synchronously on the parent's
//     death (before this tick), so the king dying never trips completion.
//   - resetBossEncounter()   — on level load.

let members: Enemy[] = [];
let engaged = false;
let completed = false;
let phase = 1;
const completeListeners = new Set<() => void>();

/** Current fight phase (1 = the king; 2 = the spawns it split into; …).
 *  A phase is a designed beat of the SAME encounter — distinct from
 *  completion, which is the whole fight ending. */
export function bossPhase(): number {
  return phase;
}

/** Advance to the next phase (called by the split: king → princes = phase
 *  2). Emits 'boss:phase' so the bar / music / future phase-specific
 *  behaviour can react. */
export function advanceBossPhase(): void {
  phase += 1;
  emit({ type: 'boss:phase', phase });
}

/** Register a boss body with the current encounter (king + each split child). */
export function registerBossMember(e: Enemy): void {
  members.push(e);
}

/** Mark the fight as joined (the player committed). Gates completion so an
 *  un-engaged boss can't "complete" before the fight starts. */
export function engageBossEncounter(): void {
  engaged = true;
}

export function isBossEncounterEngaged(): boolean {
  return engaged;
}

/** Every still-alive boss body. The boss bar renders one health bar each. */
export function liveBossMembers(): Enemy[] {
  return members.filter((m) => m.alive);
}

export function bossEncounterHasMembers(): boolean {
  return members.length > 0;
}

export function isBossEncounterComplete(): boolean {
  return completed;
}

/** Subscribe to the authoritative "boss fully defeated" signal (fires once
 *  per fight). Returns an unsubscribe. For rewards, the fog-wall release,
 *  a victory beat, LLM epitaphs, etc. */
export function onBossEncounterComplete(fn: () => void): () => void {
  completeListeners.add(fn);
  return () => completeListeners.delete(fn);
}

/** Per-frame. Fires completion exactly once when the engaged fight's every
 *  registered body is down.
 *
 *  "Down" = not alive OR reduced to 0 HP. The hp==0 clause is a deadlock
 *  guard: if a body somehow reaches 0 HP without its death handler flipping
 *  `alive` (a DoT race, an off-screen kill, a body that leaped to an
 *  unreachable cell and bled out), the fight must still resolve — never hang
 *  with a permanent empty bar and a sealed exit. A live body with HP left
 *  still blocks completion, so this can't end the fight early.
 *
 *  Split children register synchronously on the parent's death (before this
 *  tick), so the king dying — hp 0, alive false — never trips completion on
 *  its own: its princes are already live members with HP by the time we run. */
export function tickBossEncounter(): void {
  if (completed || !engaged || members.length === 0) return;
  if (members.some((m) => m.alive && m.hp > 0)) return;
  completed = true;
  emit({ type: 'boss:defeated' });
  for (const fn of completeListeners) fn();
}

/** DEV diagnostic snapshot — what bodies the encounter is tracking and their
 *  live/HP state. Used by the on-screen boss-encounter readout to surface a
 *  stuck member (e.g. a 0-HP body that didn't die) instead of guessing. */
export function bossEncounterDebug(): {
  engaged: boolean; completed: boolean; phase: number;
  members: Array<{ kind: string; alive: boolean; dying: boolean; hp: number; max: number }>;
} {
  return {
    engaged, completed, phase,
    members: members.map((m) => ({
      kind: m.kind, alive: m.alive, dying: m.dying, hp: Math.round(m.hp * 10) / 10, max: m.maxHp,
    })),
  };
}

/** Clear all encounter state on level load / teardown. */
export function resetBossEncounter(): void {
  members = [];
  engaged = false;
  completed = false;
  phase = 1;
  completeListeners.clear();
}
