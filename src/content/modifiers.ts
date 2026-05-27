import type { EnemySpec } from './enemies';

// Mob difficulty modifiers — a small declarative system that lets us
// scale combat without rewriting EnemySpec values per floor. Two levers
// operate on the same input EnemySpec:
//
//   1. Depth scaling — automatic per-floor multipliers (deeper = more
//      HP, more damage, slightly more XP/gold reward).
//   2. Modifier tags — named buckets of stat tweaks ("fierce", "tough")
//      that can be attached to individual spawns. Authored levels list
//      them explicitly on a spawn; procgen rolls them based on depth.
//
// Both feed into `scaleEnemySpec(base, depth, modifiers)`, which
// returns a NEW spec instance the builder hands to createEnemy. The
// original ENEMIES registry is never mutated.

/** A single stat-tweaking tag. Multiple can stack on one mob. */
export interface ModifierSpec {
  /** Stable id; what spawn entries reference. */
  id: string;
  /** Player-facing label — e.g. shown in floating tooltips later. */
  name: string;
  /** Stat multipliers — undefined → 1.0. */
  hpMul?: number;
  damageMul?: number;
  speedMul?: number;
  xpMul?: number;
  goldMul?: number;
  /** Flat stat additions — applied AFTER multipliers. */
  hpAdd?: number;
  damageAdd?: number;
}

/** Registry of available modifier tags. Add a new entry here, reference
 *  its id from a spawn (or from procgen's roll table). */
export const MODIFIERS: Record<string, ModifierSpec> = {
  fierce: {
    id: 'fierce',
    name: 'fierce',
    damageMul: 1.35,
    speedMul: 0.92,    // hits harder, moves slower
    xpMul: 1.3,
    goldMul: 1.2,
  },
  swift: {
    id: 'swift',
    name: 'swift',
    speedMul: 1.30,
    damageMul: 0.85,   // faster but lighter hits
    xpMul: 1.2,
  },
  tough: {
    id: 'tough',
    name: 'tough',
    hpMul: 1.7,
    speedMul: 0.88,
    xpMul: 1.4,
    goldMul: 1.3,
  },
  withered: {
    // Glass cannon — fast and dangerous, dies easily.
    id: 'withered',
    name: 'withered',
    hpMul: 0.65,
    damageMul: 1.5,
    speedMul: 1.1,
    xpMul: 1.25,
  },
  bloated: {
    id: 'bloated',
    name: 'bloated',
    hpMul: 2.0,
    speedMul: 0.70,
    damageMul: 1.1,
    xpMul: 1.5,
    goldMul: 1.5,
  },
};

// ── Depth scaling tuning ─────────────────────────────────────────────
// Linear-with-floor multipliers, kept gentle so early floors stay
// readable. At depth 10 a mob has ~2.3× HP and +2.7 damage (before
// any modifier). Tune these here in ONE place.
const DEPTH_HP_MUL_PER_LEVEL = 0.15;
const DEPTH_DAMAGE_ADD_PER_LEVEL = 0.3;
const DEPTH_XP_MUL_PER_LEVEL = 0.10;
const DEPTH_GOLD_MUL_PER_LEVEL = 0.12;
// Drop rate bonus per depth. Pool rolls get incrementally generous as
// the player descends — gentle ramp so floor 1 doesn't feel like a
// gift shop, but deeper floors visibly cough up more loot.
const DEPTH_DROP_RATE_BONUS_PER_LEVEL = 0.04;
const DROP_RATE_CAP = 0.75;

/**
 * Produce an instance-ready EnemySpec by applying depth-scaling and
 * stacking the given modifier tags onto the base spec. Returns a NEW
 * object (the original registry entry is never mutated). The model and
 * model-derived fields (collisionRadius, slots, perception ranges) are
 * passed through unchanged — modifiers don't reshape the silhouette.
 */
export function scaleEnemySpec(
  base: EnemySpec,
  depth: number,
  modifierIds: string[] = [],
): EnemySpec {
  // Resolve modifier ids → specs, dropping unknowns silently.
  const mods = modifierIds.map((id) => MODIFIERS[id]).filter((m): m is ModifierSpec => !!m);

  let hpMul = 1 + Math.max(0, depth - 1) * DEPTH_HP_MUL_PER_LEVEL;
  let damageAdd = Math.max(0, depth - 1) * DEPTH_DAMAGE_ADD_PER_LEVEL;
  let damageMul = 1;
  let speedMul = 1;
  let xpMul = 1 + Math.max(0, depth - 1) * DEPTH_XP_MUL_PER_LEVEL;
  let goldMul = 1 + Math.max(0, depth - 1) * DEPTH_GOLD_MUL_PER_LEVEL;
  let hpAdd = 0;

  for (const m of mods) {
    hpMul *= m.hpMul ?? 1;
    damageMul *= m.damageMul ?? 1;
    speedMul *= m.speedMul ?? 1;
    xpMul *= m.xpMul ?? 1;
    goldMul *= m.goldMul ?? 1;
    if (m.hpAdd) hpAdd += m.hpAdd;
    if (m.damageAdd) damageAdd += m.damageAdd;
  }

  const scaledHp = Math.max(1, Math.ceil(base.hp * hpMul + hpAdd));
  const scaledDamage = Math.max(1, Math.round(base.attackDamage * damageMul + damageAdd));
  const scaledSpeed = base.moveSpeed * speedMul;
  const scaledXp = Math.max(1, Math.round((base.xp ?? 1) * xpMul));
  const scaledGold: [number, number] | undefined = base.gold
    ? [
        Math.max(0, Math.round(base.gold[0] * goldMul)),
        Math.max(0, Math.round(base.gold[1] * goldMul)),
      ]
    : undefined;

  // Drops: bump rate by depth (deeper = more loot). Guaranteed and
  // pool weights pass through unchanged — only the gate softens.
  const scaledDrops = base.drops
    ? {
        ...base.drops,
        rate: Math.min(
          DROP_RATE_CAP,
          (base.drops.rate ?? 0.30) +
            Math.max(0, depth - 1) * DEPTH_DROP_RATE_BONUS_PER_LEVEL,
        ),
      }
    : undefined;

  return {
    ...base,
    hp: scaledHp,
    attackDamage: scaledDamage,
    moveSpeed: scaledSpeed,
    xp: scaledXp,
    gold: scaledGold,
    drops: scaledDrops,
  };
}
