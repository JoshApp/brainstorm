// Floor-level invariants across many generated floors. Codifies the smoke
// scripts I kept re-writing in /tmp (vault overlap, stairs reachable, chasm
// soft-lock) into permanent CI. Catches composer regressions — a winding
// step that self-intersects, a void with no bridge, an unreachable exit.
//
//   npm test
//
// Sample is kept modest so the suite stays fast (~1s).

import assert from 'node:assert/strict';
import { generateFloor } from '../src/level/procgen';
import { CONFIG } from '../src/config';
import type { LevelSpec } from '../src/level/types';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

type Rect = { x: number; z: number; w: number; d: number };
function penetration(a: Rect, b: Rect): number {
  const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
  const oz = (a.d + b.d) / 2 - Math.abs(a.z - b.z);
  return Math.min(ox, oz);
}

// Coarse BFS over rooms+corridors (minus void cells) → is every stair reachable
// from spawn? Mirrors the runtime walkable model closely enough to catch a
// chasm/void that strands the path.
const CELL = 0.25;
const PLAYER_RADIUS = 0.3;   // matches camera.ts — the path must FIT the player
function stairsReachable(spec: LevelSpec): boolean {
  const rects = [...spec.rooms.filter((r) => !r.logicalOnly), ...spec.corridors];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.rect.x - r.rect.w / 2); maxX = Math.max(maxX, r.rect.x + r.rect.w / 2);
    minZ = Math.min(minZ, r.rect.z - r.rect.d / 2); maxZ = Math.max(maxZ, r.rect.z + r.rect.d / 2);
  }
  const CX = Math.ceil((maxX - minX) / CELL), CZ = Math.ceil((maxZ - minZ) / CELL);
  const W = new Uint8Array(CX * CZ); const id = (x: number, z: number) => z * CX + x;
  const mark = (b: Rect, v: number) => {
    for (let cz = Math.max(0, Math.floor((b.z - b.d / 2 - minZ) / CELL)); cz <= Math.min(CZ - 1, Math.floor((b.z + b.d / 2 - minZ) / CELL)); cz++)
      for (let cx = Math.max(0, Math.floor((b.x - b.w / 2 - minX) / CELL)); cx <= Math.min(CX - 1, Math.floor((b.x + b.w / 2 - minX) / CELL)); cx++) W[id(cx, cz)] = v;
  };
  for (const r of rects) mark(r.rect, 1);
  // Voids block the player's CENTER within its radius (collision), so erode
  // around them — a strip thinner than ~2*radius next to a void isn't really
  // walkable (the soft-lock that slipped past the old point-BFS check).
  for (const v of spec.voids ?? []) mark({ x: v.x, z: v.z, w: v.w + 2 * PLAYER_RADIUS, d: v.d + 2 * PLAYER_RADIUS }, 0);
  const sx = Math.floor((spec.startPos.x - minX) / CELL), sz = Math.floor((spec.startPos.z - minZ) / CELL);
  const seen = new Uint8Array(CX * CZ); const q = [id(sx, sz)];
  if (!W[q[0]]) return false; seen[q[0]] = 1;
  while (q.length) {
    const c = q.pop()!; const cx = c % CX, cz = (c - cx) / CX;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ) continue;
      const ni = id(nx, nz); if (W[ni] && !seen[ni]) { seen[ni] = 1; q.push(ni); }
    }
  }
  for (const st of spec.stairs ?? []) {
    const x = Math.floor((st.x - minX) / CELL), z = Math.floor((st.z - minZ) / CELL);
    let ok = false;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = z + dz;
      if (a >= 0 && b >= 0 && a < CX && b < CZ && seen[id(a, b)]) ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

// Deterministic sample: depths 1..13 × 25 seeds.
const SEEDS = Array.from({ length: 25 }, (_, i) => 4242 + i * 1009);
const DEPTHS = Array.from({ length: 13 }, (_, i) => i + 1);

/**
 * GENERATE THE CORPUS ONCE.
 *
 * Every test below wants the same 325 floors, and each used to build its own —
 * seven independent sweeps of the whole sample. Measured with the runner's
 * per-file timing, this ONE file was 525s, 42% of the entire suite's CPU, for
 * 2275 floor generations where 325 would do. That is the same shape as the last
 * time the suite got slow (a file regenerating its 72-floor corpus 22 times),
 * which is why the runner now prints where the time went.
 *
 * Memoised, not precomputed: a filtered run of one test still pays for only
 * what that test asks for. Floors are deterministic per (depth, seed), so a
 * shared instance is the same object every test would have built for itself —
 * and nothing here mutates a spec.
 */
let CORPUS: Array<{ d: number; s: number; spec: LevelSpec }> | null = null;
function corpus(): Array<{ d: number; s: number; spec: LevelSpec }> {
  return (CORPUS ??= DEPTHS.flatMap((d) => SEEDS.map((s) => ({ d, s, spec: generateFloor(d, s) }))));
}

test('generation never throws', () => {
  // Building the corpus IS the assertion — `generateFloor` runs for every
  // (depth, seed) in the sample and this test fails if any of them throws.
  assert.equal(corpus().length, DEPTHS.length * SEEDS.length);
});

// The empty-early-floors bug: a floor could roll zero combat when few combat
// vaults were eligible at shallow depth. v3's content budget makes that
// impossible — every floor carries at least COMBAT_MIN live (non-dormant)
// enemies, seeded into open cells of any room. This is the regression lock.
test('every floor meets the combat budget minimum (never empty)', () => {
  const MIN = CONFIG.CONTENT_BUDGET.COMBAT_MIN;
  for (const { d, s, spec } of corpus()) {
    const live = (spec.spawns ?? []).filter(
      (sp) => !(sp as { dormant?: boolean }).dormant,
    ).length;
    assert.ok(live >= MIN, `depth ${d} seed ${s}: only ${live} live enemies (< MIN ${MIN})`);
  }
});

// The bug this missed before: archways (placed by the decoration pipeline at
// corridor mouths) carry collision columns that NARROW the opening. The old
// rect-level checks never saw them. This reads the ACTUAL emitted archway
// collision and asserts the gap between its columns leaves the 0.6m-diameter
// player a real passage — no choke, no soft-lock at a doorway.
test('no archway chokes a passage below the player', () => {
  const MIN_BAND = 0.5;   // required passable centre-band (player diameter 0.6, w/ margin)
  for (const { d, s, spec } of corpus()) {
    for (const p of spec.props as Array<{ _dbg?: string; collision?: Array<{ kind: string; r: number; ox?: number; oz?: number }> }>) {
      if (p._dbg !== 'archway' || !p.collision || p.collision.length < 2) continue;
      const [a, b] = p.collision;
      const gap = Math.hypot((a.ox ?? 0) - (b.ox ?? 0), (a.oz ?? 0) - (b.oz ?? 0));
      const band = gap - a.r - b.r - 2 * PLAYER_RADIUS;
      assert.ok(band >= MIN_BAND, `depth ${d} seed ${s}: archway columns leave only ${band.toFixed(2)}m (< ${MIN_BAND})`);
    }
  }
});

test('no column-archway on the perimeter of a stair room', () => {
  // A collision column at a STAIR room's mouth can pinch the path around the
  // stairwell to the interaction spot below player-width (the d4-0wgr
  // soft-lock). The fix doorframes every opening of a stair-containing room,
  // so assert no column-archway sits on such a room's edge. (A column-archway
  // in a NEIGHBOUR a few metres away is fine — that's why the old crude
  // distance check false-positived once stairs moved to back walls.)
  const onPerimeter = (px: number, pz: number, r: { x: number; z: number; w: number; d: number }) => {
    const onV = (Math.abs(px - (r.x - r.w / 2)) < 0.4 || Math.abs(px - (r.x + r.w / 2)) < 0.4)
      && pz >= r.z - r.d / 2 - 0.4 && pz <= r.z + r.d / 2 + 0.4;
    const onH = (Math.abs(pz - (r.z - r.d / 2)) < 0.4 || Math.abs(pz - (r.z + r.d / 2)) < 0.4)
      && px >= r.x - r.w / 2 - 0.4 && px <= r.x + r.w / 2 + 0.4;
    return onV || onH;
  };
  for (const { d, s, spec } of corpus()) {
    const stairRooms = spec.rooms.filter((r) => !r.logicalOnly && (spec.stairs ?? []).some((st) =>
      Math.abs(st.x - r.rect.x) <= r.rect.w / 2 && Math.abs(st.z - r.rect.z) <= r.rect.d / 2));
    for (const p of spec.props as Array<{ _dbg?: string; x: number; z: number; collision?: unknown[] }>) {
      if (p._dbg !== 'archway' || !p.collision) continue;
      for (const r of stairRooms) {
        assert.ok(!onPerimeter(p.x, p.z, r.rect), `depth ${d} seed ${s}: column-archway on a stair room's edge (should be a doorframe)`);
      }
    }
  }
});

test('no clutter prop floats inside a void (pit)', () => {
  // A pillar / brazier / debris dropped over a chasm cutout floats in mid-air
  // with no floor under it. The clutter passes shape the room from spec.voids
  // FIRST, then place props that avoid those rects (tooClose rejects void
  // cells). Guards against clutter regressing to ignore voids.
  for (const { d, s, spec } of corpus()) {
    for (const p of spec.props as Array<{ _dbg?: string; x?: number; z?: number; kind: string }>) {
      // Only clutter-generated props — authored vault props are the author's
      // problem, and some intentionally sit at a void edge.
      if (p._dbg !== 'geometry-warp' && p._dbg !== 'surface-clutter') continue;
      if (typeof p.x !== 'number' || typeof p.z !== 'number') continue;
      for (const v of spec.voids ?? []) {
        const inside = Math.abs(p.x - v.x) < v.w / 2 && Math.abs(p.z - v.z) < v.d / 2;
        assert.ok(!inside, `depth ${d} seed ${s}: clutter '${p.kind}' at (${p.x.toFixed(1)},${p.z.toFixed(1)}) floats inside void (${v.x},${v.z})`);
      }
    }
  }
});

test('no two vaults overlap on any floor', () => {
  for (const { d, s, spec } of corpus()) {
    const rooms = spec.rooms.filter((r) => !r.logicalOnly).map((r) => r.rect);
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++)
        assert.ok(penetration(rooms[i], rooms[j]) <= 0.05,
          `depth ${d} seed ${s}: vault overlap ${penetration(rooms[i], rooms[j]).toFixed(2)}m`);
  }
});

test('stairs are always reachable from spawn (incl. chasm bridges)', () => {
  for (const { d, s, spec } of corpus()) {
    assert.ok(stairsReachable(spec), `depth ${d} seed ${s}: stairs unreachable`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
