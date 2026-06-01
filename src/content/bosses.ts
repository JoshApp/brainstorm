import type { EnemySpec } from './enemies';

// First-class boss architecture.
//
// A BossSpec is the HIGHER-ORDER concept of a boss — its preferred
// arena, intro/outro identity, future phase state machine, future
// LLM-driven naming. The MECHANICAL fight (HP, AI, attacks, model,
// scale) still lives on the matching EnemySpec in enemies.ts: a
// boss runs through the same combat pipeline as any mob, just with
// `isBoss: true` set.
//
// Why a separate registry rather than just more fields on EnemySpec:
//
//   1. Not every concept fits an enemy's plain mechanic shape. The
//      preferred vault, the intro card line, the bestiary entry —
//      these are about the FIGHT as a set-piece event, not the
//      creature's combat parameters.
//   2. Sets up the IDENTITY / MECHANICS seam we'll need in Phase 5.
//      An LLM can rewrite a BossSpec's identity per run (name,
//      intro line, drop flavor) without ever touching the
//      EnemySpec's HP/damage/AI math. Same architecture as items.
//   3. Lets the level generator REASON about bosses (preferred
//      vault, arena size needs, allowed trash count) without
//      digging through every EnemySpec for boss-flagged ones.
//
// Adding a new boss:
//   1. Author the fight in enemies.ts as a normal EnemySpec with
//      isBoss: true + bossName + scale set.
//   2. Add a BossSpec here referencing that enemy's id + the arena
//      you want.
//   3. Point an Act at the BossSpec via acts.ts → Act.bossId.
//
// That's it — the level generator picks the right arena, the boss
// bar finds the name, the intro card fires on first aggro.

export interface BossSpec {
  /** Stable id used by Act.bossId + by the intro card lookup. */
  id: string;
  /** EnemySpec id to actually spawn (must exist in ENEMIES). */
  enemyId: string;

  // ── Arena hookup ─────────────────────────────────────────────
  /** Preferred boss vault id (see vault-library.ts). When set, the
   *  level generator looks for this specific vault in the boss-tag
   *  candidate pool and uses it if found; otherwise falls through
   *  to the normal weighted pick. Lets a Boiling King demand the
   *  grand 18×16 hall while a future Abbot of Ash takes the
   *  cathedral with its god rays. */
  preferredVaultId?: string;

  // ── Identity (LLM-fillable seam) ─────────────────────────────
  // For Phase 5, these will be filled per-run by an LLM call
  // keyed by bossId + run-seed. Until then they're hand-authored
  // and the EnemySpec.bossName field mirrors defaultName.
  /** Default boss-bar name. Mirrors EnemySpec.bossName today; LLM
   *  layer will override per-run later. */
  defaultName: string;
  /** Optional one-line tell shown beneath the name on the intro
   *  title card. Terse, in-tone, Tone-Bible-clean. */
  introLine?: string;
  /** Optional flavor for the codex / bestiary. */
  bestiaryEntry?: string;
}

export const BOSSES: Record<string, BossSpec> = {
  // Act I — the king slime. Teaches the boss-fight pattern:
  // telegraphed AoE → dodge → land hits in the recovery window →
  // splits on death into smaller threats. Big arena (boss-hall)
  // gives the hops room to read.
  'boiling-king': {
    id: 'boiling-king',
    enemyId: 'boiling-king',
    preferredVaultId: 'boss-hall',
    defaultName: 'The Boiling King',
    introLine: 'It has eaten kings.',
    bestiaryEntry: "A king slime, swollen with everything it's swallowed. The kings, mostly. They never come back out.",
  },
  // Act II + III (for now) — the wraith. Spectral, magic-damage,
  // single-target focus. Cathedral arena's god rays suit its
  // ethereal palette; the long-windup teleport-cast wants room.
  'hollow-choir': {
    id: 'hollow-choir',
    enemyId: 'wraith',
    preferredVaultId: 'boss-cathedral',
    defaultName: 'The Hollow Choir',
    introLine: 'It is mostly absence.',
    bestiaryEntry: 'It sang once. The sound stayed.',
  },
};

/** Resolve a BossSpec by id, with a safe fallback to the wraith
 *  so a typo'd Act.bossId never breaks a run. */
export function bossById(id: string | undefined): BossSpec {
  return (id ? BOSSES[id] : undefined) ?? BOSSES['hollow-choir'];
}

/** Inverse lookup: given a spawned EnemySpec, find the BossSpec
 *  it backs (if any). Used by the intro card + the bestiary to
 *  read identity layered on top of the bare EnemySpec. Returns
 *  undefined for non-boss enemies. */
export function bossSpecForEnemy(spec: EnemySpec): BossSpec | undefined {
  if (!spec.isBoss) return undefined;
  for (const bs of Object.values(BOSSES)) {
    if (bs.enemyId === spec.id) return bs;
  }
  return undefined;
}
