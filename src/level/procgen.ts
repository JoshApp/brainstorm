// The floor entry point, and the depth-scaled enemy tables every floor rolls
// from.
//
// This file used to BE the generator: a library of hand-authored ASCII tile-map
// templates, a composer that stamped them into a floor, and a populator that
// substituted depth-appropriate enemies into their spawn slots. All of that is
// gone — level/poly-floor.ts builds floors out of shapes now, and it is the only
// generator. What is left here is the part the composer and the polygon
// generator always shared: what fights on a floor this deep.
//
// API:
//   generateFloor(depth, seed) → LevelSpec
//   rollFloorEnemies(depth, count, intensity, rand, archetype) → enemy ids
//
// The loader checks the LEVELS registry first (hand-authored levels — the
// tutorial, the safe rooms); if the id isn't found, it calls generateFloor with
// the depth implied by the id ('depth-3').

import type { LevelSpec } from './types';
import { ENEMIES } from '../content/enemies';
import { isIncluded } from '../content/content-status';
import { ROLE, ARCHETYPE_SLOTS, type EncounterSpec, type EncounterIntensity, type EncounterArchetype, type Role } from '../content/encounters';
import { generatePolyFloor } from './poly-floor';

// ── Enemy roll tables by depth ────────────────────────────────────────
// Each row: cumulative probability for the listed enemyIds at that depth.
// Picked weighted-random per 'X' slot in the template.
type EnemyRoll = { enemyId: string; weight: number };

function rollTableFor(depth: number): EnemyRoll[] {
  // Include-flag: dev/draft enemies drop out of the pool for this build. Filters
  // the raw table here so pickWeighted AND rollPack's `available` set (derived
  // from this table) both respect it in one place.
  return rollTableForRaw(depth).filter((r) => isIncluded(ENEMIES[r.enemyId]));
}
function rollTableForRaw(depth: number): EnemyRoll[] {
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
      // Bloat — the ooze that detonates. Enters here, after the green ooze has
      // read for a few floors, so the red one is legible as "that, but wrong."
      // Weight kept LOW: its blast hits its own packmates, so a room with
      // several is chaos rather than a puzzle, and the whole point is that one
      // of them changes how you move.
      { enemyId: 'bomb-ooze',     weight: 1 },
      { enemyId: 'defiler',       weight: 1 },
      { enemyId: 'skeleton',      weight: 2 },
      { enemyId: 'spider',        weight: 1 },
      { enemyId: 'stoneguard',    weight: 1 },
      { enemyId: 'carrion-hound', weight: 2 },
      { enemyId: 'sump-wisp',     weight: 2 },
      { enemyId: 'plague-spore',  weight: 1 },
      // Pit moth — high weight so when a room rolls one, several
      // tiles tend to land on it. That's the natural way to get a
      // swarm without adding a spawn-cluster mechanic. Low HP +
      // moveSpeed > player retreat = the swarm IS the threat.
      { enemyId: 'pit-moth',      weight: 3 },
      // Lasher — stationary long-reach. One per room is plenty,
      // weight kept low so encounters where it shows up read as a
      // fixture, not a roomful.
      { enemyId: 'lasher',        weight: 1 },
      // Burrower — floor ambush. Low weight so encountering one
      // remains a surprise, not a regular trash mob. Pairs the
      // moth's "look up" with "scan the floor."
      { enemyId: 'burrower',      weight: 1 },
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
    { enemyId: 'bomb-ooze',     weight: 2 },
    { enemyId: 'defiler',       weight: 2 },
    { enemyId: 'skeleton',      weight: 2 },
    { enemyId: 'spider',        weight: 1 },
    { enemyId: 'stoneguard',    weight: 2 },
    // (Wraith removed from the random pool — it's now a two-phase, boss-scale
    //  set-piece fight, the Hollow Choir. It appears as an authored encounter,
    //  not a stray roll that would drop an unstunnable elite into a trash room.)
    { enemyId: 'carrion-hound', weight: 2 },
    { enemyId: 'sump-wisp',     weight: 2 },
    // Plague spore commits more at deep dungeon — Verdant Rot
    // theme owns this depth band.
    { enemyId: 'plague-spore',  weight: 2 },
    // Pit moth + lasher show up here too — moth as a frequent
    // swarmer at deep dungeon (still high weight for natural
    // clustering), lasher a notch higher weight so the deep band
    // has the room-control fixture available regularly.
    { enemyId: 'pit-moth',      weight: 3 },
    { enemyId: 'lasher',        weight: 2 },
    { enemyId: 'burrower',      weight: 2 },
  ];
}

// Drift guard — every enemy a roll table can produce MUST exist in
// the ENEMIES registry. Validated at module load so a typo'd id
// throws in dev/build/CI the moment this file is imported, not 9
// floors deep.
(function validateRollTables() {
  const ids = new Set<string>();
  for (const d of [3, 6, 9]) for (const r of rollTableFor(d)) ids.add(r.enemyId);
  // Encounter-archetype role buckets are placeable too — same guard.
  for (const bucket of Object.values(ROLE)) for (const id of bucket) ids.add(id);
  for (const id of ids) {
    if (!ENEMIES[id]) {
      throw new Error(`Roll table / encounter role references '${id}', which is not in the ENEMIES registry`);
    }
  }
})();

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

/** Roll a COHERENT pack of `slotCount` enemy ids for an encounter archetype,
 *  depth-scaled. Each slot draws from its archetype role bucket, filtered to
 *  what's available at this depth (empty bucket → fall back to the weighted
 *  roll table). 'heavy' intensity upgrades one slot to an elite. */
function rollPack(spec: EncounterSpec, depth: number, slotCount: number, rand: () => number): string[] {
  const table = rollTableFor(depth);
  const available = new Set(table.map((r) => r.enemyId));
  // Intensity biases WHERE in a (threat-ascending) bucket we pick: 'light'
  // leans weak, 'heavy' leans tough, 'medium' is uniform.
  const bias = (r: number): number =>
    spec.intensity === 'light' ? r * r
    : spec.intensity === 'heavy' ? 1 - (1 - r) * (1 - r)
    : r;
  const fromRole = (role: Role): string => {
    const pool = ROLE[role].filter((id) => available.has(id));   // threat-ordered
    if (pool.length === 0) return pickWeighted(table, rand);     // depth has none → fallback
    return pool[Math.min(pool.length - 1, Math.floor(bias(rand()) * pool.length))];
  };
  const slots = ARCHETYPE_SLOTS[spec.archetype];
  const out: string[] = [];
  for (let i = 0; i < slotCount; i++) out.push(fromRole(slots[i % slots.length]));
  if (spec.intensity === 'heavy' && out.length > 0) {
    const elites = ROLE.elite.filter((id) => available.has(id));   // an elite anchors a heavy pack
    if (elites.length) out[Math.floor(rand() * out.length)] = elites[Math.floor(rand() * elites.length)];
  }
  return out;
}

/** Roll a coherent pack of `count` enemy ids for the v3 floor CONTENT BUDGET —
 *  a floor-level "mixed" squad scaled to the floor's intensity. Reuses rollPack
 *  so a room's pack reads as a designed fight rather than a grab-bag. Called
 *  per room by poly-floor's furnish pass and by its floor-level top-up. */
export function rollFloorEnemies(
  depth: number, count: number, intensity: EncounterIntensity, rand: () => number,
  // THE ROOM'S OWN SHAPE, when the caller knows it. This was hard-coded to
  // 'mixed' for every room on every polygon floor, which is why a hall was the
  // same fight as a chamber with more bodies in it — measured, the ranged share
  // of spawns ran 14.8% / 16.0% / 8.9% across mid / large / hall rooms, flat and
  // if anything backwards. See level/encounter-shape.ts.
  archetype: EncounterArchetype = 'mixed',
): string[] {
  if (count <= 0) return [];
  return rollPack({ archetype, intensity }, depth, count, rand);
}

/**
 * Generate a floor for the given depth, with reproducible seed.
 *
 *   depth        1-based depth number for display + difficulty rolls
 *   runSeed      seed for this RUN (so resume regenerates same floor)
 *   nextLevelId  the id to assign to the stairs ('depth-N+1')
 *
 * ── ONE GENERATOR ───────────────────────────────────────────────────────────
 *
 * level/poly-floor.ts builds a floor out of SHAPES and places its content by
 * asking each room. It is the only floor generator; the ASCII vault composer it
 * replaced (vault-library, vault-compose, tilemap, and the carve/decor/lighting
 * passes that served them) is deleted.
 *
 * This function is a one-line forward and stays only because ~40 call sites and
 * the level loader name it. What used to live here — a tile-grid composer, the
 * `?polyfloors` flag that chose between the two, and a template populator — was
 * ~6,500 lines that nothing on a shipping floor executed any more.
 */
export function generateFloor(
  depth: number,
  runSeed: number,
  /** Override the stair target. Pass undefined to let acts.ts decide
   *  (boss-floor → safe-N, else → depth-N+1). The override exists for the
   *  proving grounds and test scenarios that want a specific destination. */
  nextLevelIdOverride?: string,
): LevelSpec {
  return generatePolyFloor(depth, runSeed, nextLevelIdOverride);
}
