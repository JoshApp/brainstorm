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
import { parseTileMap } from './tilemap';
import { TEMPLATES } from './templates';

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
  // Depth 3-4: mostly trash mobs, occasional skirmisher.
  if (depth <= 4) {
    return [
      { enemyId: 'rat',        weight: 3 },
      { enemyId: 'skirmisher', weight: 2 },
      { enemyId: 'ghoul',      weight: 1 },
      { enemyId: 'acolyte',    weight: 1 },
    ];
  }
  // Depth 5-7: ghouls in the mix more; acolytes start appearing in pairs
  // with melee escorts so they're not a solo gimmick.
  if (depth <= 7) {
    return [
      { enemyId: 'rat',        weight: 2 },
      { enemyId: 'skirmisher', weight: 2 },
      { enemyId: 'ghoul',      weight: 3 },
      { enemyId: 'acolyte',    weight: 2 },
    ];
  }
  // Depth 8+: wraiths possible, ghouls common, acolytes regular threat.
  return [
    { enemyId: 'rat',        weight: 1 },
    { enemyId: 'skirmisher', weight: 2 },
    { enemyId: 'ghoul',      weight: 3 },
    { enemyId: 'acolyte',    weight: 2 },
    { enemyId: 'wraith',     weight: 1 },
  ];
}

function bossFor(depth: number): string {
  // Bosses get nastier as you descend. Depth 3-5 wraith is unusual but
  // beatable; depth 6+ multiple ghouls + a wraith feels right.
  if (depth <= 5) return 'wraith';
  return 'wraith';  // for now, single boss type — extend with new
                    // boss specs later (lich, giant, etc.)
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

function populateTemplate(template: TileMap, depth: number, rand: () => number): TileMap {
  const table = rollTableFor(depth);
  const bossChar: Record<string, string> = { wraith: 'W' };
  const enemyChar: Record<string, string> = {
    rat: 'R', skirmisher: 'K', ghoul: 'G', wraith: 'W', acolyte: 'Y',
  };
  return template.map(row => {
    let out = '';
    for (const ch of row) {
      if (ch === 'X') {
        const id = pickWeighted(table, rand);
        out += enemyChar[id] ?? 'R';
      } else if (ch === 'B') {
        const id = bossFor(depth);
        out += bossChar[id] ?? enemyChar[id] ?? 'W';
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
  nextLevelId: string,
): LevelSpec {
  const seedForFloor = hashSeed(`floor-${depth}`, runSeed);
  const rand = rng(seedForFloor);

  // Pick a template. Rotate through the library by depth so consecutive
  // floors don't repeat. Within a single template, the populator's RNG
  // makes the SAME template feel different across runs (different
  // enemies rolled in 'X' slots).
  const templateIdx = (depth - 1) % TEMPLATES.length;
  const tmpl = TEMPLATES[templateIdx];

  const populated = populateTemplate(tmpl.map, depth, rand);

  const id = `depth-${depth}`;
  const spec = parseTileMap(populated, {
    id,
    displayName: `${romanize(depth)} — ${tmpl.name}`,
    spawnYaw: tmpl.spawnYaw ?? 0,
    roomHeight: tmpl.roomHeight ?? 3.2,
    torchTint: tmpl.torchTint,
    stairsTarget: nextLevelId,
  });
  spec.fogColor = tmpl.fogColor;
  spec.depth = depth;

  // Modifier rolls per spawn — drives the difficulty system. The
  // deeper you go, the more often spawns get tagged with a modifier
  // (and the more likely they stack two). Modifier ids must exist in
  // src/content/modifiers.ts.
  const modPool = ['fierce', 'swift', 'tough', 'withered', 'bloated'];
  const modChance = depth <= 2 ? 0
    : depth <= 4 ? 0.12
    : depth <= 7 ? 0.22
    : 0.35;
  for (const s of spec.spawns) {
    if (rand() < modChance) {
      const first = modPool[Math.floor(rand() * modPool.length)];
      s.modifiers = [first];
      // At depth 8+, occasional second modifier stacked on top.
      if (depth >= 8 && rand() < 0.20) {
        const second = modPool[Math.floor(rand() * modPool.length)];
        if (second !== first) s.modifiers.push(second);
      }
    }
  }

  // Stash decoration data on the spec; builder runs decorateFloor with
  // its root group at build-time so InstancedMesh batches land in the
  // right scene-graph spot.
  spec.procgenDecor = {
    grid: populated,
    seed: seedForFloor,
    tint: tmpl.torchTint ?? 0xffaa55,
  };

  // Sanity: every generated floor must have a player spawn + a stairs.
  // The template author is responsible for including 'S' and '/'.
  if (!hasSpawn(spec)) {
    // eslint-disable-next-line no-console
    console.warn(`Template '${tmpl.name}' (depth ${depth}) lacks player spawn 'S'`);
  }
  if (spec.stairs?.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`Template '${tmpl.name}' (depth ${depth}) lacks stairs '/'`);
  }
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

// Convenience used by tests / debug.
export function previewPopulated(depth: number, runSeed: number): string {
  const seedForFloor = hashSeed(`floor-${depth}`, runSeed);
  const rand = rng(seedForFloor);
  const templateIdx = (depth - 1) % TEMPLATES.length;
  const tmpl = TEMPLATES[templateIdx];
  return populateTemplate(tmpl.map, depth, rand).join('\n');
}

// Re-export TileMap typedef ergonomically.
export type { TileMap };
