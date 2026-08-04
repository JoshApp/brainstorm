// Centrepieces (src/level/centrepieces.ts) — the ONE notable thing a role room
// stages, turned from a word in the type table into props on the floor.
//
// What's guarded here is the stuff that silently rots:
//   1. The SPACING CONTRACT. Offerings float name cards; below the configured
//      gap they overlap into mush. Placement is the only thing that can honour
//      it, so it's pinned.
//   2. The ONE-PER-ROOM CAP — the actual fix for #64. A centrepiece call must
//      never emit two notable things.
//   3. GRACEFUL DEGRADATION. Rooms are procgen; a centrepiece that can't fit
//      must degrade, never jam a plinth into a wall.

import assert from 'node:assert/strict';
import { planCentrepiece, type CentrepieceSite } from '../src/level/centrepieces';
import { CONFIG } from '../src/config';
import { ITEMS } from '../src/content/items';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A roomy site where everything within the room rect is open floor. */
function site(over: Partial<CentrepieceSite> = {}): CentrepieceSite {
  const base = { roomId: 'r1', x: 0, z: 0, w: 14, d: 12 };
  const s = { ...base, ...over };
  return {
    ...s,
    free: over.free ?? ((x, z) =>
      Math.abs(x - s.x) <= s.w / 2 - 1 && Math.abs(z - s.z) <= s.d / 2 - 1),
  };
}

/** Prop kinds that count as a NOTABLE thing — the cap is over these. */
const NOTABLE = new Set(['offering', 'merchant', 'challenge-offering', 'chest',
  'altar', 'blood-altar', 'fountain', 'tithe-basin', 'reliquary']);

test('a trove stands up the configured number of offerings', () => {
  const out = planCentrepiece('trove', site(), { depth: 4, rand: seeded(7) });
  const stones = out.props.filter((p) => p.kind === 'offering');
  assert.equal(stones.length, CONFIG.CENTREPIECE.TROVE_OFFERINGS);
});

test('the SPACING CONTRACT holds — no two offerings closer than the minimum', () => {
  const gap = CONFIG.CENTREPIECE.OFFERING_MIN_SPACING;
  for (let seed = 1; seed <= 30; seed++) {
    const out = planCentrepiece('trove', site(), { depth: 5, rand: seeded(seed) });
    const pts = out.props.filter((p) => p.kind === 'offering') as Array<{ x: number; z: number }>;
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const dist = Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z);
        assert.ok(dist >= gap - 1e-6, `seed ${seed}: offerings ${dist.toFixed(2)}m apart, need ${gap}`);
      }
    }
  }
});

test('a trove offers DISTINCT goods — three of one thing is not a choice', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const out = planCentrepiece('trove', site(), { depth: 6, rand: seeded(seed) });
    const ids = (out.props.filter((p) => p.kind === 'offering') as Array<{ itemId: string }>)
      .map((p) => p.itemId);
    assert.equal(new Set(ids).size, ids.length, `seed ${seed}: duplicate offering ${ids}`);
  }
});

test('every offering names a REAL item and shares one group id', () => {
  const out = planCentrepiece('trove', site(), { depth: 3, rand: seeded(11) });
  const stones = out.props.filter((p) => p.kind === 'offering') as Array<{ itemId: string; groupId: string }>;
  assert.ok(stones.length > 0);
  for (const s of stones) assert.ok(ITEMS[s.itemId], `unknown item ${s.itemId}`);
  assert.equal(new Set(stones.map((s) => s.groupId)).size, 1, 'stones must close together');
});

test('a room too tight for a CHOICE gets a chest, not a lone plinth', () => {
  // Only the exact centre is open — two stones can never stand apart.
  const tight = site({ free: (x, z) => x === 0 && z === 0 });
  const out = planCentrepiece('trove', tight, { depth: 4, rand: seeded(3) });
  assert.equal(out.props.filter((p) => p.kind === 'offering').length, 0);
  assert.equal(out.props.length, 1);
  assert.equal(out.props[0].kind, 'chest');
});

test('the row lays along the room LONG axis when it fits there', () => {
  const gap = CONFIG.CENTREPIECE.OFFERING_MIN_SPACING;
  const wide = planCentrepiece('trove', site({ w: 16, d: 8 }), { depth: 4, rand: seeded(5) });
  const wideStones = wide.props.filter((p) => p.kind === 'offering') as Array<{ x: number; z: number }>;
  assert.ok(wideStones.length >= 2);
  assert.ok(Math.abs(wideStones[0].x - wideStones[1].x) >= gap - 1e-6, 'wide room should spread along X');
  const deep = planCentrepiece('trove', site({ w: 8, d: 16 }), { depth: 4, rand: seeded(5) });
  const deepStones = deep.props.filter((p) => p.kind === 'offering') as Array<{ x: number; z: number }>;
  assert.ok(deepStones.length >= 2);
  assert.ok(Math.abs(deepStones[0].z - deepStones[1].z) >= gap - 1e-6, 'deep room should spread along Z');
});

test('ONE notable thing per room — the #64 cap, enforced by construction', () => {
  for (const role of ['trove', 'shop', 'arena', 'trap'] as const) {
    for (let seed = 1; seed <= 12; seed++) {
      const out = planCentrepiece(role, site(), { depth: 5, rand: seeded(seed) });
      const notable = out.props.filter((p) => NOTABLE.has(p.kind));
      // A trove is ONE choice made of several stones — that's one notable thing,
      // not three. Everything else must be a single prop.
      const count = role === 'trove' ? new Set(
        (notable as Array<{ groupId?: string }>).map((p) => p.groupId ?? 'solo'),
      ).size : notable.length;
      assert.equal(count, 1, `${role} seed ${seed}: staged ${count} notable things`);
    }
  }
});

test('a shop stages a merchant; an arena stages the trial altar', () => {
  const shop = planCentrepiece('shop', site(), { depth: 5, rand: seeded(2) });
  assert.deepEqual(shop.props.map((p) => p.kind), ['merchant']);
  const arena = planCentrepiece('arena', site(), { depth: 5, rand: seeded(2) });
  assert.deepEqual(arena.props.map((p) => p.kind), ['challenge-offering']);
});

test('a trap room rings its prize with spikes — the reward is defended, not hidden', () => {
  const out = planCentrepiece('trap', site(), { depth: 5, rand: seeded(9) });
  assert.equal(out.props.filter((p) => p.kind === 'chest').length, 1, 'the prize must be visible');
  assert.equal(
    out.props.filter((p) => p.kind === 'spike-trap').length,
    CONFIG.CENTREPIECE.HAZARD_RING_SPIKES,
  );
});

test('types the composer already owns stage NOTHING here (no double-placement)', () => {
  // The director places the fire, the stairs pass the descent, the boss vault
  // its own arena, the fill stage the bargain. Claiming them here would fight.
  for (const role of ['sanctum', 'finish', 'boss', 'miniboss', 'feature', 'combat', 'quiet', 'entrance']) {
    const out = planCentrepiece(role, site(), { depth: 5, rand: seeded(4) });
    assert.equal(out.props.length, 0, `${role} placed a centrepiece it doesn't own`);
  }
});

test('every claimed cell is reported so later passes can place AROUND it', () => {
  for (const role of ['trove', 'shop', 'arena', 'trap'] as const) {
    const out = planCentrepiece(role, site(), { depth: 5, rand: seeded(6) });
    assert.ok(out.claimed.length > 0, `${role} claimed nothing`);
    // Every prop position must be covered by a claim (else an enemy/vase can
    // spawn inside the thing the room is about).
    for (const p of out.props as Array<{ x: number; z: number }>) {
      assert.ok(
        out.claimed.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 1e-6),
        `${role}: prop at ${p.x},${p.z} was not claimed`,
      );
    }
  }
});

test('an unplaceable centrepiece degrades to an ordinary room, never a wall-jam', () => {
  const blocked = site({ free: () => false });
  for (const role of ['trove', 'shop', 'arena', 'trap'] as const) {
    const out = planCentrepiece(role, blocked, { depth: 5, rand: seeded(8) });
    assert.equal(out.props.length, 0, `${role} placed into a fully blocked room`);
  }
});

test('placement is DETERMINISTIC per seed — floors replay', () => {
  const a = planCentrepiece('trove', site(), { depth: 5, rand: seeded(42) });
  const b = planCentrepiece('trove', site(), { depth: 5, rand: seeded(42) });
  assert.deepEqual(a, b);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
