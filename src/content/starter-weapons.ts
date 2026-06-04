// Starter-weapon pool — the base weapons that can be offered at the
// starter-chamber altars. Each run rolls a few DISTINCT entries from this
// pool (seeded), instead of the old static needle/sword/maul triad, so the
// opening choice varies run to run.
//
// Forward-looking (deliberately a plain id list + a roll fn): meta
// progression will gate this pool — you UNLOCK new base weapons into it as
// you descend deeper across runs — and later seed starting affixes onto the
// offered weapons. Both hang off this one module without touching the
// altar/chamber code.

import { ITEMS } from './items';

/** Base weapons eligible to be offered at the starter altars. All are
 *  mundane, roughly side-graded archetypes (crit / balanced / heavy /
 *  sweep / reach) so no roll is a strict loss. Add unlock gating here. */
export const STARTER_WEAPON_POOL: readonly string[] = [
  'rusted-sword',   // balanced — the honest baseline
  'bone-needle',    // dagger — fast, crit-fisher
  'iron-maul',      // hammer — slow, heavy, wide
  'bent-sickle',    // scythe — wide sweep, swarm-clearer
  'pilgrims-pike',  // spear — reach, poke-and-retreat
];

// Mulberry32 — a tiny seedable PRNG. Local to this module so the starter
// roll is reproducible from a single seed (e.g. ?seed=N) WITHOUT consuming
// the shared gameplay/build RNG streams (which would shift every other
// downstream roll).
function mulberry32(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Roll `count` DISTINCT starter-weapon ids from the pool, seeded so the
 * same seed always yields the same offering (and a re-entered chamber is
 * stable). Falls back gracefully if the pool is smaller than `count`.
 * Unknown ids are filtered, so an unlock-gated pool can't crash the altar.
 */
export function rollStarterWeapons(seed: number, count = 3): string[] {
  const rng = mulberry32(seed);
  const pool = STARTER_WEAPON_POOL.filter((id) => ITEMS[id]);
  // Fisher–Yates shuffle, then take the first `count`.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}
