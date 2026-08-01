import type { StatModifier } from '../combat/modifiers';
import type { DomainId } from './domains';

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
  /** PROVENANCE — whose belongings these were ("Vess, who kept the lamps").
   *  Present on relic-lane sets; the pickup reveal + details use it. */
  owner?: string;
  /** The owner's leaning — tints the set line in that domain's register. */
  domain?: DomainId;
  /** Tiered bonuses; conventionally ordered ascending by `pieces`. */
  bonuses: SetBonus[];
}

// PROVENANCE SETS (docs/RELICS.md) — a named dead delver's belongings,
// scattered through the deep. Pieces are DISTINCT relics (duplicates stack
// their own payload but never advance the set); collect 2/3 and what the
// owner was becoming starts becoming you. The legacy paperdoll sets
// (pauper / ossuary / penitent) retired with the item purge; this is the
// machinery's second life on the relic lane.
export const SETS: Record<string, SetSpec> = {
  // Vess — the lamplighter. Ash: she fought the dark with fire, rationed
  // in drops, until she was burning what she wore. Her things still burn.
  'vess': {
    id: 'vess',
    name: 'What Vess Carried',
    owner: 'Vess, who kept the lamps',
    domain: 'ash',
    bonuses: [
      { pieces: 2, onHit: { buffId: 'burn', chance: 0.25, duration: 3 } },
      {
        pieces: 3,
        modifiers: [{ kind: 'weapon-damage', amount: 2 }],
        onHit: { buffId: 'burn', chance: 0.40, duration: 4 },
      },
    ],
  },
  // Maren — of the shallow grave. Bone: she mended, tied, counted, endured.
  // Her things hold the shape of standing.
  'maren': {
    id: 'maren',
    name: 'What Maren Kept',
    owner: 'Maren, of the shallow grave',
    domain: 'bone',
    bonuses: [
      { pieces: 2, modifiers: [{ kind: 'physical-armor', amount: 1 }, { kind: 'magic-armor', amount: 1 }] },
      { pieces: 3, modifiers: [{ kind: 'max-hp', amount: 3 }, { kind: 'incoming-damage-mult', amount: 0.94 }] },
    ],
  },
  // Cael — the plaguebearer. Rot: he let the sickness work. The attrition
  // build — poison bypasses physical armour, so the set answers tanks the way
  // Vess's fire answers swarms.
  'cael': {
    id: 'cael',
    name: 'What Cael Bore',
    owner: 'Cael, the plaguebearer',
    domain: 'rot',
    bonuses: [
      { pieces: 2, onHit: { buffId: 'poison', chance: 0.28, duration: 4 } },
      {
        pieces: 3,
        modifiers: [{ kind: 'magic-armor', amount: 1 }],
        onHit: { buffId: 'poison', chance: 0.45, duration: 5 },
      },
    ],
  },
  // Ysolde — who bled the dark. Blood: the wound feeds the one who opens it.
  // The sustain build — bleed to open them, lifesteal to drink it back.
  'ysolde': {
    id: 'ysolde',
    name: 'What Ysolde Drew',
    owner: 'Ysolde, who bled the dark',
    domain: 'blood',
    bonuses: [
      { pieces: 2, onHit: { buffId: 'bleed', chance: 0.30, duration: 4 } },
      {
        pieces: 3,
        modifiers: [{ kind: 'lifesteal-pct', amount: 0.08 }, { kind: 'weapon-damage', amount: 1 }],
      },
    ],
  },
  // Aldric — who did not kneel. Valor: hold the line, and the last blow is
  // yours. The finisher build — crit into a heavier killing strike.
  'aldric': {
    id: 'aldric',
    name: 'What Aldric Held',
    owner: 'Aldric, who did not kneel',
    domain: 'valor',
    bonuses: [
      { pieces: 2, modifiers: [{ kind: 'crit-chance', amount: 0.06 }] },
      { pieces: 3, modifiers: [{ kind: 'finisher-damage-mult', amount: 1.35 }, { kind: 'physical-armor', amount: 1 }] },
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
