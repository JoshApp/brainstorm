// Procedural floor generation.
//
// Strategy: a library of hand-authored ASCII tile-map TEMPLATES, parsed
// into LevelSpecs at descent time. Templates contain spawn slots ('X'
// for a generic enemy, 'B' for a tougher one) that the populator
// fills with depth-appropriate enemies — so the SHAPE of the floor is
// hand-tuned but the threat level scales.
//
// Each floor gets a SEED (depth + run start time) so resume regenerates
// the same floor. Floors deeper than the template library cycle, with
// rotated/mirrored variants to keep things varied.
//
// API:
//   generateFloor(depth, seed) → LevelSpec
//
// The loader checks the LEVELS registry first; if the id isn't found,
// it calls generateFloor with the depth implied by the id ('depth-3').

import type { LevelSpec, EnemySpawnSpec, TileMap } from './types';
import { composeFloor } from './vault-compose';
import { VAULTS } from './vault-library';
import { ENEMY_CHAR_BY_ID } from '../content/enemies';
import { actForDepth, isBossDepth, nextLevelAfter } from './acts';
import { seedBuildRng } from '../engine/rng';

// Tiny seedable RNG (Mulberry32). 32-bit seed in, deterministic 0..1 floats.
function rng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash an id like 'depth-3' + a seed into a deterministic 32-bit number.
function hashSeed(idOrDepth: string | number, seed: number): number {
  const s = String(idOrDepth);
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ── Enemy roll tables by depth ────────────────────────────────────────
// Each row: cumulative probability for the listed enemyIds at that depth.
// Picked weighted-random per 'X' slot in the template.
type EnemyRoll = { enemyId: string; weight: number };

function rollTableFor(depth: number): EnemyRoll[] {
  // Depth 3-4: mostly trash mobs, occasional skirmisher. Ooze
  // shows up here too — the AoE-or-suffer math is a worthwhile
  // mid-early teach.
  if (depth <= 4) {
    return [
      { enemyId: 'rat',           weight: 3 },
      { enemyId: 'skirmisher',    weight: 2 },
      { enemyId: 'ghoul',         weight: 1 },
      { enemyId: 'acolyte',       weight: 1 },
      { enemyId: 'ooze',          weight: 1 },
      { enemyId: 'skeleton',      weight: 1 },
      // Carrion hound — fast bleed-pack predator. Joins the early
      // mix at the same weight as the skirmisher so by depth 3-4
      // the player has met them.
      { enemyId: 'carrion-hound', weight: 2 },
    ];
  }
  // Depth 5-7: ghouls in the mix more; acolytes start appearing in pairs
  // with melee escorts so they're not a solo gimmick. Stoneguard makes
  // its first appearance here — rare so it's an "oh shit" moment.
  // Acid spitter joins the table here so the green ooze has read for
  // a few floors before its ranged cousin shows up.
  //
  // Sump wisp + plague spore appear at mid-depth: the wisp adds a
  // floating non-humanoid caster to mix with the acolyte; the spore
  // is a stationary AoE turret that forces "kill or sprint past."
  if (depth <= 7) {
    return [
      { enemyId: 'rat',           weight: 2 },
      { enemyId: 'skirmisher',    weight: 2 },
      { enemyId: 'ghoul',         weight: 3 },
      { enemyId: 'acolyte',       weight: 2 },
      { enemyId: 'ooze',          weight: 2 },
      { enemyId: 'acid-spitter',  weight: 1 },
      { enemyId: 'defiler',       weight: 1 },
      { enemyId: 'skeleton',      weight: 2 },
      { enemyId: 'spider',        weight: 1 },
      { enemyId: 'stoneguard',    weight: 1 },
      { enemyId: 'carrion-hound', weight: 2 },
      { enemyId: 'sump-wisp',     weight: 2 },
      { enemyId: 'plague-spore',  weight: 1 },
    ];
  }
  // Depth 8+: wraiths possible, ghouls common, acolytes regular threat,
  // stoneguards now a real fixture. Acid spitter same weight as the
  // acolyte — by deep dungeon the player should expect mixed ranged
  // threats, not just one kind.
  return [
    { enemyId: 'rat',           weight: 1 },
    { enemyId: 'skirmisher',    weight: 2 },
    { enemyId: 'ghoul',         weight: 3 },
    { enemyId: 'acolyte',       weight: 2 },
    { enemyId: 'ooze',          weight: 2 },
    { enemyId: 'acid-spitter',  weight: 2 },
    { enemyId: 'defiler',       weight: 2 },
    { enemyId: 'skeleton',      weight: 2 },
    { enemyId: 'spider',        weight: 1 },
    { enemyId: 'stoneguard',    weight: 2 },
    { enemyId: 'wraith',        weight: 1 },
    { enemyId: 'carrion-hound', weight: 2 },
    { enemyId: 'sump-wisp',     weight: 2 },
    // Plague spore commits more at deep dungeon — Verdant Rot
    // theme owns this depth band.
    { enemyId: 'plague-spore',  weight: 2 },
  ];
}

// Drift guard — every enemy a roll table can produce MUST have a tile
// char (else populateTemplate would silently fall back to a rat).
// Validated at module load so a typo'd or unplaceable id throws in
// dev/build/CI the moment this file is imported, not 9 floors deep.
(function validateRollTables() {
  const ids = new Set<string>();
  for (const d of [3, 6, 9]) for (const r of rollTableFor(d)) ids.add(r.enemyId);
  for (const id of ids) {
    if (!ENEMY_CHAR_BY_ID[id]) {
      throw new Error(`Roll table references '${id}', which has no tileChar in the enemy registry`);
    }
  }
})();

function bossFor(depth: number): string {
  // Rotate bosses across acts so each one has a different first
  // impression. Act I gets the king slime — it's the simplest fight
  // (telegraphed hop + split-on-death) so it teaches "yes, bosses
  // are a thing" without being punishing. Act II and III keep the
  // wraith until they get their own bespoke fights.
  const act = actForDepth(depth).number;
  if (act === 1) return 'boiling-king';
  return 'wraith';
}

function pickWeighted(rows: EnemyRoll[], rand: () => number): string {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let pick = rand() * total;
  for (const r of rows) {
    pick -= r.weight;
    if (pick <= 0) return r.enemyId;
  }
  return rows[rows.length - 1].enemyId;
}

// ── Template population ──────────────────────────────────────────────
// Walk the parsed LevelSpec's spawns array. Currently the parser handles
// G/R/K/W as concrete types; for procgen we want a generic 'X' slot.
// Pre-process the template string to REPLACE 'X' and 'B' with rolled
// enemy chars BEFORE parsing.

/**
 * Replace 'X' and 'B' tile chars with concrete enemy chars (G/R/K/W/Y)
 * picked from depth-appropriate roll tables. Exported so the vault
 * composer can call this per-vault before parseTileMap runs.
 */
export function populateTemplate(template: TileMap, depth: number, rand: () => number): TileMap {
  const table = rollTableFor(depth);
  // enemyId → tile char comes from the SINGLE registry in
  // content/enemies.ts (ENEMY_CHAR_BY_ID). No hand-kept map here, so a
  // new enemy is roll-placeable the moment it declares a tileChar —
  // and a roll-table id that lacks one is caught by validateRollTables
  // at module load rather than silently spawning as a rat.
  return template.map(row => {
    let out = '';
    for (const ch of row) {
      if (ch === 'X') {
        const id = pickWeighted(table, rand);
        out += ENEMY_CHAR_BY_ID[id] ?? 'R';
      } else if (ch === 'B') {
        const id = bossFor(depth);
        out += ENEMY_CHAR_BY_ID[id] ?? 'W';
      } else {
        out += ch;
      }
    }
    return out;
  });
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Generate a floor for the given depth, with reproducible seed.
 *
 *   depth        1-based depth number for display + difficulty rolls
 *   runSeed      seed for this RUN (so resume regenerates same floor)
 *   nextLevelId  the id to assign to the stairs ('depth-N+1')
 */
export function generateFloor(
  depth: number,
  runSeed: number,
  /** Override the stair target. Pass undefined to let acts.ts
   *  decide (boss-floor → safe-N, else → depth-N+1). The override
   *  exists for test scenarios that want a specific destination. */
  nextLevelIdOverride?: string,
): LevelSpec {
  const seedForFloor = hashSeed(`floor-${depth}`, runSeed);
  const rand = rng(seedForFloor);
  // Seed the build stream BEFORE composeFloor — vault-compose → parseTileMap
  // bakes corpse rotation + wall-fixture rolls into the spec, and those must
  // be reproducible per floor seed too.
  seedBuildRng(seedForFloor);

  // Act → palette + boss-flag. Stair target follows from the act
  // rule (boss floor → safe room; else → next depth).
  const act = actForDepth(depth);
  const nextLevelId = nextLevelIdOverride ?? nextLevelAfter(depth);
  const bossFloor = isBossDepth(depth);

  const id = `depth-${depth}`;
  const spec = composeFloor(depth, rand, nextLevelId, {
    id,
    displayName: `${romanize(depth)} — ${act.name}`,
    torchTint: act.torchTint,
    fogColor: act.fogColor,
    isBossFloor: bossFloor,
  });
  // Apply X→enemy substitution per spawn. parseTileMap doesn't handle
  // 'X' itself (it's only in vault grids); the composer's spawn list
  // already came back with 'X'-resolved enemies via the per-vault
  // populate step above. (See composeFloor for the populateTemplate
  // call on each vault's map.)

  // Modifier rolls per spawn — drives the difficulty system. The
  // deeper you go, the more often spawns get tagged with a modifier
  // (and the more likely they stack two).
  const modPool = ['fierce', 'swift', 'tough', 'withered', 'bloated'];
  const modChance = depth <= 2 ? 0
    : depth <= 4 ? 0.12
    : depth <= 7 ? 0.22
    : 0.35;
  for (const s of spec.spawns) {
    if (rand() < modChance) {
      const first = modPool[Math.floor(rand() * modPool.length)];
      s.modifiers = [first];
      if (depth >= 8 && rand() < 0.20) {
        const second = modPool[Math.floor(rand() * modPool.length)];
        if (second !== first) s.modifiers.push(second);
      }
    }
  }

  // Decoration is skipped for vault-composed floors in V1 — the
  // decorator's grid-based anchor system assumes a single contiguous
  // tilemap. Per-vault decoration is a follow-up pass.

  // Sanity: every composed floor must contain a player spawn + a
  // stairs. composeFloor's vault chain guarantees both by tag
  // (start vault has 'S', exit/boss vault has '/'), but warn loudly
  // if a vault library entry violates that contract.
  if (!hasSpawn(spec)) {
    // eslint-disable-next-line no-console
    console.warn(`Composed floor depth ${depth} lacks player spawn 'S'`);
  }
  if (spec.stairs?.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`Composed floor depth ${depth} lacks stairs '/'`);
  }
  // Stamp the floor seed so buildLevel re-seeds the build stream identically.
  spec.seed = seedForFloor;
  return spec;
}

function hasSpawn(spec: LevelSpec): boolean {
  return spec.startPos.x !== 0 || spec.startPos.z !== 0
    || spec.spawns.length > 0;  // soft check
}

function romanize(n: number): string {
  const numerals: [number, string][] = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of numerals) {
    while (n >= v) { out += s; n -= v; }
  }
  return out || 'I';
}

// Convenience used by tests / debug — picks the first START vault and
// returns its populated grid as a preview string. (The full floor
// preview is harder now that floors are composed of multiple vaults;
// this just spot-checks the X-enemy substitution math.)
export function previewPopulated(depth: number, runSeed: number): string {
  const seedForFloor = hashSeed(`floor-${depth}`, runSeed);
  const rand = rng(seedForFloor);
  const startVault = VAULTS.find((v) => v.tags.includes('start'));
  if (!startVault) return '';
  return populateTemplate(startVault.map, depth, rand).join('\n');
}

// Re-export TileMap typedef ergonomically.
export type { TileMap };
