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

export const SETS: Record<string, SetSpec> = {
  // The scrounger's kit — three mundane rags that, worn together, keep a
  // pauper alive a little longer. Reward for NOT chasing the shiny loose
  // drop early.
  'pauper': {
    id: 'pauper',
    name: "Pauper's Vigil",
    bonuses: [
      { pieces: 2, modifiers: [{ kind: 'physical-armor', amount: 1 }] },
      { pieces: 3, modifiers: [{ kind: 'max-hp', amount: 2 }, { kind: 'physical-armor', amount: 1 }] },
    ],
  },
  // The bone kit — needle + amulet. Leans into the venom/decay theme: the
  // amulet's magic armor plus a player-wide poison-on-hit, so the needle's
  // fast cadence stacks poison even before a venom affix.
  'ossuary': {
    id: 'ossuary',
    name: 'The Ossuary',
    bonuses: [
      {
        pieces: 2,
        modifiers: [{ kind: 'magic-armor', amount: 1 }],
        onHit: { buffId: 'poison', chance: 0.35, duration: 4 },
      },
    ],
  },
};

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
