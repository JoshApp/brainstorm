import type { StatModifier } from '../combat/modifiers';

// Equipment sets — wear enough pieces of a matched set and the set's
// thresholds grant bonuses on top of each piece's own stats. The hook
// for "build around a theme": the pieces are individually mundane, but
// together they're worth keeping over a strictly-better loose drop.
//
// Membership is by ItemSpec.setId (the source of truth). The SETS
// registry only holds the bonuses keyed by that id. A bonus is active
// when the count of equipped pieces with that setId meets `pieces`.
//
// Bonuses can grant stat modifiers AND a player-wide on-hit status
// (aggregated through the same pipelines as affixes + buffs), so a set
// can change behaviour, not just numbers — e.g. the bone set poisons.

export interface SetBonus {
  /** Pieces of the set that must be equipped for this bonus to apply. */
  pieces: number;
  /** Stat modifiers granted while the threshold is met. */
  modifiers?: StatModifier[];
  /** Player-wide on-hit status granted while the threshold is met. */
  onHit?: { buffId: string; chance: number; duration: number };
}

export interface SetSpec {
  id: string;
  /** Display name — grimdark, terse (Tone Bible). */
  name: string;
  /** Tiered bonuses; conventionally ordered ascending by `pieces`. */
  bonuses: SetBonus[];
}

// Currently EMPTY — the legacy paperdoll sets (pauper / ossuary / penitent)
// were retired with the item purge. Sets return as PROVENANCE SETS on the
// relic lane: a named dead delver's belongings, thresholds at 2/3 pieces —
// see docs/RELICS.md. The machinery below stays live for that.
export const SETS: Record<string, SetSpec> = {};

/**
 * Collect every active set bonus given the setIds of all equipped items
 * (pass undefined for slots whose item has no setId — they're skipped).
 * A bonus is active when the equipped count for its set meets `pieces`.
 */
export function collectActiveSetBonuses(equippedSetIds: ReadonlyArray<string | undefined>): SetBonus[] {
  const counts = new Map<string, number>();
  for (const id of equippedSetIds) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: SetBonus[] = [];
  for (const [setId, count] of counts) {
    const set = SETS[setId];
    if (!set) continue;
    for (const b of set.bonuses) {
      if (count >= b.pieces) out.push(b);
    }
  }
  return out;
}
