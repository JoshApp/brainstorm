// Seedable gameplay RNG — the deterministic stream for runtime randomness
// (crit rolls, loot drops, prop variants). Distinct from procgen, which seeds
// its own local generators per floor.
//
// Why this exists / the path ahead: async multiplayer (Phase 4) wants "same
// seed → same run" for replay, bloodstain context, and ghost playback. With
// gameplay randomness behind one seeded stream, seeding it from the run seed
// at run start makes a run reproducible. Math.random() can't be seeded, so
// every gameplay roll should migrate to gameRng() over time. Cosmetic-only
// randomness (particle jitter) can stay on Math.random — it doesn't affect
// outcomes.
//
// mulberry32: tiny, fast, good-enough distribution for game rolls (not
// crypto). Same generator the level builder uses, kept independent here.

let state = 0x9e3779b9 >>> 0;

/** Seed the gameplay stream. Call once at run start with the run seed so the
 *  run is reproducible. */
export function seedRng(seed: number): void {
  state = (seed >>> 0) || 1;
}

/** Next float in [0, 1). Drop-in replacement for Math.random() in gameplay. */
export function gameRng(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function gameRngInt(min: number, max: number): number {
  return min + Math.floor(gameRng() * (max - min + 1));
}

/** True with probability `p` (0..1). */
export function gameRngChance(p: number): boolean {
  return gameRng() < p;
}

// ── Build stream ───────────────────────────────────────────────────────────
// A SEPARATE deterministic stream for floor construction (geometry jitter,
// prop variants, loot placement). Kept distinct from the runtime gameRng so a
// floor's appearance depends only on its floor seed — NOT on what the player
// did before reaching it. Re-seeded per floor at both generation time
// (procgen, where corpse/fixture rolls bake into the spec) and build time
// (buildLevel, where geometry + props are instantiated).

let buildState = 0x1a2b3c4d >>> 0;

/** Seed the build stream from a floor seed. Call at the start of each floor's
 *  generation AND its build so both phases are reproducible. */
export function seedBuildRng(seed: number): void {
  buildState = (seed >>> 0) || 1;
}

export function buildRng(): number {
  buildState = (buildState + 0x6d2b79f5) >>> 0;
  let t = buildState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function buildRngInt(min: number, max: number): number {
  return min + Math.floor(buildRng() * (max - min + 1));
}

/** Hash a string (e.g. a hand-authored floor id) into a 32-bit seed, so
 *  floors with no procgen seed still build deterministically. */
export function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5 >>> 0;            // FNV-1a basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
