import type { StatModifier } from '../combat/modifiers';
import { gameRng } from '../engine/rng';

// Affix system — ARPG-lite hybrid for DELVE.
//
// Items keep their FIXED identity: a "rusted short sword" is always
// recognisably that, with a hand-written name + flavor. On top of that
// identity, every pickup INSTANCE rolls a small number of affixes from
// the item's affixPool. Each affix is a Souls-style suffix
// ("of the keening") attached to a small stat tweak with a rolled range.
//
// Goals:
//   - Items keep identity (no fully-procgen stat sticks).
//   - Each drop has a tiny element of surprise (this one rolled +5 crit?
//     this one rolled +1 magic armor?).
//   - The stat ranges are TIGHT — variance feels like flavor, not
//     "perfect roll" chasing.
//
// Tiers (future-friendly): an affix can have multiple rolls layered, or
// be tagged "rare" so the pool can roll it less often. For V1 we just
// have a flat pool with weights.

export interface AffixSpec {
  /** Stable id; referenced by ItemSpec.affixPool. */
  id: string;
  /** Suffix appended to the item name on instances that roll this. */
  suffix: string;
  /** Pool weight — higher = more likely to roll. Default 1. */
  weight?: number;
  /**
   * Stat tweaks granted by this affix. Each tweak rolls a value in
   * [min, max] when the affix is applied to an instance. Discrete
   * modifiers (e.g. flat +HP) use integer rolls; fractional ones
   * (crit chance, multipliers) use float rolls.
   */
  rolls: AffixRollSpec[];
}

export interface AffixRollSpec {
  kind: StatModifier['kind'];
  min: number;
  max: number;
  /** If true, round the rolled value to an integer. */
  integer?: boolean;
}

/** Rolled state of one affix on a specific item instance. */
export interface AffixInstance {
  affixId: string;
  suffix: string;
  modifiers: StatModifier[];
}

/** Affix registry. Add new ones here; reference by id from
 *  ItemSpec.affixPool. Keep the pool tight — too many similar suffixes
 *  blur identity. */
export const AFFIXES: Record<string, AffixSpec> = {
  // ── Common tier — small straightforward tweaks ───────────────────
  'keening': {
    id: 'keening',
    suffix: 'of the keening',
    weight: 2,
    rolls: [{ kind: 'weapon-damage', min: 1, max: 1, integer: true }],
  },
  'gallows': {
    id: 'gallows',
    suffix: 'of the gallows',
    weight: 2,
    rolls: [{ kind: 'damage-multiplier', min: 1.05, max: 1.15 }],
  },
  'spine': {
    id: 'spine',
    suffix: 'of stiff spine',
    weight: 2,
    rolls: [{ kind: 'max-hp', min: 1, max: 1, integer: true }],
  },
  'cinder': {
    id: 'cinder',
    suffix: 'cinder-bitten',
    weight: 2,
    rolls: [{ kind: 'physical-armor', min: 1, max: 1, integer: true }],
  },
  'salt': {
    id: 'salt',
    suffix: 'salt-bound',
    weight: 1,
    rolls: [{ kind: 'magic-armor', min: 1, max: 1, integer: true }],
  },

  // ── Rare tier — bigger effects, lower weight ─────────────────────
  'vile': {
    id: 'vile',
    suffix: 'of the vile',
    weight: 1,
    rolls: [
      { kind: 'weapon-damage', min: 1, max: 2, integer: true },
      { kind: 'damage-multiplier', min: 1.10, max: 1.20 },
    ],
  },
  'patience': {
    id: 'patience',
    suffix: 'of long patience',
    weight: 1,
    rolls: [
      { kind: 'max-hp', min: 1, max: 2, integer: true },
      { kind: 'physical-armor', min: 1, max: 1, integer: true },
    ],
  },
};

/**
 * Roll the affixes for a fresh item instance. Picks up to `maxCount`
 * distinct affixes from the pool by weight; rolls each affix's stat
 * ranges; returns the rolled AffixInstance list ready to be stored on
 * the item.
 *
 * Returns an empty array if the pool is missing/empty or maxCount <= 0.
 */
export function rollAffixes(
  affixPoolIds: readonly string[] | undefined,
  maxCount: number,
): AffixInstance[] {
  if (!affixPoolIds || affixPoolIds.length === 0 || maxCount <= 0) return [];
  const pool = affixPoolIds
    .map((id) => AFFIXES[id])
    .filter((a): a is AffixSpec => !!a);
  if (pool.length === 0) return [];

  const picked: AffixInstance[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < maxCount; i++) {
    // Reservoir: pick one from pool by weight, excluding already picked.
    const candidates = pool.filter((a) => !usedIds.has(a.id));
    if (candidates.length === 0) break;
    const total = candidates.reduce((s, a) => s + (a.weight ?? 1), 0);
    let r = gameRng() * total;
    let chosen: AffixSpec | null = null;
    for (const a of candidates) {
      r -= a.weight ?? 1;
      if (r <= 0) {
        chosen = a;
        break;
      }
    }
    if (!chosen) chosen = candidates[candidates.length - 1];

    // Roll the affix's stat ranges.
    const mods: StatModifier[] = chosen.rolls.map((roll) => {
      const raw = roll.min + gameRng() * (roll.max - roll.min);
      const amount = roll.integer ? Math.round(raw) : Math.round(raw * 100) / 100;
      return { kind: roll.kind, amount } as StatModifier;
    });
    picked.push({ affixId: chosen.id, suffix: chosen.suffix, modifiers: mods });
    usedIds.add(chosen.id);

    // Each subsequent affix has a lower chance to even appear. Roll
    // a 60% gate after the first — gives "mostly 1 affix, sometimes 2."
    if (i + 1 < maxCount && gameRng() > 0.55) break;
  }
  return picked;
}
