// The floor loot director — turns loot-anchor markers into a budgeted, spaced set
// of chests. Locks: no anchors survive, chests stay within/near the budget, no two
// chests cluster, and it's deterministic.
//
//   npm test

import assert from 'node:assert/strict';
import { distributeLoot } from '../src/level/loot-director';
import type { PropSpec } from '../src/level/types';

// A big room containing every test anchor (budget 3), so the per-room cap doesn't
// interfere with the spacing/budget assertions.
const ROOMS = [{ cx: 35, cz: 0, w: 80, d: 20 }];

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// A grid of well-spaced anchors (10m apart) so spacing never forces a drop.
function anchors(nMinor: number, nMajor: number): PropSpec[] {
  const out: PropSpec[] = [];
  let i = 0;
  for (let k = 0; k < nMinor; k++, i++) out.push({ kind: 'loot-anchor', prominence: 'minor', x: i * 10, z: 0 });
  for (let k = 0; k < nMajor; k++, i++) out.push({ kind: 'loot-anchor', prominence: 'major', x: i * 10, z: 0 });
  return out;
}

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('no loot-anchor survives — every marker becomes a chest or vanishes', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const out = distributeLoot(anchors(6, 2), 5, seeded(seed), ROOMS);
    assert.equal(out.filter((p) => p.kind === 'loot-anchor').length, 0, 'anchors all resolved');
  }
});

test('places at least one chest, never more than the anchor count', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const src = anchors(6, 2);
    const chests = distributeLoot(src, 5, seeded(seed), ROOMS).filter((p) => p.kind === 'chest');
    assert.ok(chests.length >= 1, 'at least a wood chest');
    assert.ok(chests.length <= src.length, 'never more chests than anchors');
  }
});

test('chests never cluster (min spacing honoured)', () => {
  // Anchors 10m apart, so spacing is easy; assert no two chests coincide/cluster.
  for (let seed = 1; seed <= 40; seed++) {
    const chests = distributeLoot(anchors(6, 2), 5, seeded(seed), ROOMS).filter((p) => p.kind === 'chest') as Array<{ x: number; z: number }>;
    for (let a = 0; a < chests.length; a++)
      for (let b = a + 1; b < chests.length; b++) {
        const d2 = (chests[a].x - chests[b].x) ** 2 + (chests[a].z - chests[b].z) ** 2;
        assert.ok(d2 >= 4.5 ** 2, `chests ${a},${b} too close (d²=${d2})`);
      }
  }
});

test('non-anchor props pass through untouched', () => {
  const src: PropSpec[] = [{ kind: 'altar', x: 1, z: 1 } as PropSpec, ...anchors(3, 1)];
  const out = distributeLoot(src, 5, seeded(9), ROOMS);
  assert.ok(out.some((p) => p.kind === 'altar'), 'the altar survives');
});

test('deterministic — same seed, same placement', () => {
  const a = distributeLoot(anchors(6, 2), 5, seeded(123), ROOMS).filter((p) => p.kind === 'chest') as Array<{ x: number; tier?: string }>;
  const b = distributeLoot(anchors(6, 2), 5, seeded(123), ROOMS).filter((p) => p.kind === 'chest') as Array<{ x: number; tier?: string }>;
  assert.deepEqual(a.map((c) => [c.x, c.tier]), b.map((c) => [c.x, c.tier]));
});

test('per-room budget — a small room already holding a big thing gets NO chest', () => {
  const small = [{ cx: 0, cz: 0, w: 7, d: 6 }];   // area 42 → budget 1
  // An altar sits at (-2,0) — the room's one big thing (and >2.6m from the anchor,
  // so it's the BUDGET that blocks, not the clearance).
  const src: PropSpec[] = [
    { kind: 'altar', x: -2, z: 0 } as PropSpec,
    { kind: 'loot-anchor', prominence: 'minor', x: 2, z: 0 } as PropSpec,
  ];
  const chests = distributeLoot(src, 5, seeded(3), small).filter((p) => p.kind === 'chest');
  assert.equal(chests.length, 0, 'small room already spoken for → no chest added');
});

test('per-room budget — an EMPTY small room gets its one chest', () => {
  const small = [{ cx: 0, cz: 0, w: 7, d: 6 }];
  const src: PropSpec[] = [{ kind: 'loot-anchor', prominence: 'minor', x: 0, z: 0 } as PropSpec];
  const chests = distributeLoot(src, 5, seeded(3), small).filter((p) => p.kind === 'chest');
  assert.ok(chests.length >= 1, 'an empty small room still earns a chest');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
