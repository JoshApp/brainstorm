import type { StatModifier } from '../combat/modifiers';
import { getMutation, type TaintedMutation } from '../content/tainted-mutations';

// Run-lifetime mutations — the active brands a delver is carrying. Mostly
// populated by tainted fountains today; future Faustian sources (heart-eating,
// pacts, corpse altars) push into the same list.
//
// Stored as ids and resolved against the content table on read; saves stay
// rebalance-tolerant (we can change a mutation's modifiers without
// invalidating runs in progress).
//
// Cleared by startNewRun. Persisted by commitFloorEntry. A reload mid-run
// rehydrates from the save.

let mutationIds: string[] = [];

export function getMutationIds(): readonly string[] {
  return mutationIds;
}

export function getActiveMutations(): readonly TaintedMutation[] {
  const out: TaintedMutation[] = [];
  for (const id of mutationIds) {
    const m = getMutation(id);
    if (m) out.push(m);
  }
  return out;
}

export function addMutation(id: string): void {
  mutationIds.push(id);
}

export function clearMutations(): void {
  mutationIds = [];
}

export function serializeMutations(): string[] {
  return [...mutationIds];
}

export function hydrateMutations(ids: readonly string[] | undefined): void {
  mutationIds = Array.isArray(ids) ? [...ids] : [];
}

/** Stat modifiers contributed by all active mutations. Walked by
 *  aggregateModifiers() as one more source alongside equipment + buffs. */
export function aggregateMutationModifiers(): StatModifier[] {
  const out: StatModifier[] = [];
  for (const id of mutationIds) {
    const m = getMutation(id);
    if (m) out.push(...m.modifiers);
  }
  return out;
}
