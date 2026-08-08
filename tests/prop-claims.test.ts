// A ROOM TELLS ONE STORY.
//
// docs/LEVEL-ARCHITECTURE.md §5. Every prop implicitly asserts something about
// the room it stands in — a lit brazier says someone tends this place, a cobweb
// says nobody has been here in years. Those cannot both be true, and a room
// holding both stops meaning anything.
//
// The player-visible bug this comes from is "the merchant stands inside his own
// cobwebs". It was patched on 2026-08-04 with a feature apron, which kept webs
// off the vendor's toes — but distance was never the fault. A tended room should
// never have grown a web at ANY separation, and a spacing fix could not have
// known that.
//
// Two kinds of check here, deliberately:
//   - the TABLE's own consistency (symmetry, no self-conflict), which is a unit
//     property and cheap to get wrong silently;
//   - the FINAL FLOOR, which is the only place the rule can actually be observed
//     (DESIGN-METHOD §3: check a rule about the final state against the final
//     state). A room composed correctly by every individual pass can still end
//     up contradicting itself, and only the finished floor shows it.
//
//   npm test

import assert from 'node:assert/strict';
import { generateFloor } from '../src/level/procgen';
import { pointInPoly } from '../src/level/room-shape';
import {
  ALL_CLAIMS, claimsConflict, propFacts, resolveRoomClaims, roomAdmits,
  type Claim,
} from '../src/level/prop-taxonomy';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// ── the table's own consistency ──────────────────────────────────────────────

test('claim conflict is symmetric', () => {
  // A one-sided entry would make admission depend on which prop happened to be
  // asked about first — the kind of fault that produces "sometimes there's a web
  // in the shop" rather than a clean, reproducible bug.
  for (const a of ALL_CLAIMS) {
    for (const b of ALL_CLAIMS) {
      assert.equal(claimsConflict(a, b), claimsConflict(b, a),
        `${a} vs ${b} disagrees with ${b} vs ${a}`);
    }
  }
});

test('no claim conflicts with itself', () => {
  for (const c of ALL_CLAIMS) {
    assert.ok(!claimsConflict(c, c), `${c} contradicts itself — no room could hold it`);
  }
});

test('tended is never DRAWN — it must be earned by identity', () => {
  // `tended` is the one claim asserting a living presence. A randomly-tended room
  // lies about someone being there, and the player would learn to stop reading
  // the signal. It may only ever arrive from a room type that declares it.
  let n = 0;
  for (let i = 0; i < 4000; i++) {
    const claims = resolveRoomClaims(undefined, mulberry(i));
    if (claims.includes('tended')) n++;
  }
  assert.equal(n, 0, `${n} of 4000 undeclared rooms drew 'tended'`);
});

test('a declared claim is never overridden', () => {
  for (let i = 0; i < 200; i++) {
    assert.deepEqual(resolveRoomClaims(['tended'], mulberry(i)), ['tended']);
  }
});

// ── the finished floor ───────────────────────────────────────────────────────

interface Room { id: string; roomType?: string; logicalOnly?: boolean; poly?: Array<[number, number]>; rect: { x: number; z: number; w: number; d: number } }
interface Spec { rooms: Room[]; props: Array<Record<string, unknown>> }

const SEEDS = 40;
/** MEMOISED per depth — three tests sweep overlapping depth lists and each used
 *  to build its own copy of the same floors (99s, 8% of the suite's CPU). Floors
 *  are deterministic per (depth, seed) and nothing here mutates one. */
const FLOOR_CACHE = new Map<number, Spec[]>();
function floors(depth: number): Spec[] {
  let hit = FLOOR_CACHE.get(depth);
  if (!hit) {
    hit = Array.from({ length: SEEDS }, (_, s) => generateFloor(depth, 90210 + s * 6151) as unknown as Spec);
    FLOOR_CACHE.set(depth, hit);
  }
  return hit;
}

/**
 * Every prop standing inside a room — its POLYGON when it has one.
 *
 * A polygon room is not its bounding box. Filtering on `r.rect` credits a shaped
 * room with everything in the corners it does not own: three gouges and a bone
 * pile that stand in the corridor space beside an L-shaped shop were reported as
 * the shop's own contradiction, and the dressing pass that placed them was
 * correct every time. This is the same substitution that has produced a bug in
 * doorway planning, corridor trimming, wall cutting and prop eviction — the
 * rect is a hint for broad-phase, never the room.
 */
function propsIn(f: Spec, r: Room) {
  return f.props.filter((p) => {
    const x = p.x as number | undefined, z = p.z as number | undefined;
    if (typeof x !== 'number' || typeof z !== 'number') return false;
    if (Math.abs(x - r.rect.x) > r.rect.w / 2 || Math.abs(z - r.rect.z) > r.rect.d / 2) return false;
    return r.poly ? pointInPoly(r.poly, x, z) : true;
  });
}

test('NOBODY WEBS A SHOP', () => {
  // The reported bug, checked exactly as a player meets it: walk into every
  // vendor's room on many floors and look for evidence the place is abandoned.
  let shops = 0, contradicted = 0;
  const offenders = new Set<string>();
  for (const depth of [3, 5, 8]) {
    for (const f of floors(depth)) {
      for (const r of f.rooms) {
        if (r.logicalOnly || r.roomType !== 'shop') continue;
        shops++;
        for (const p of propsIn(f, r)) {
          if (!roomAdmits(['tended'], p as never)) {
            contradicted++;
            const id = (p.model as { id?: string } | undefined)?.id ?? String(p.kind);
            offenders.add(id);
          }
        }
      }
    }
  }
  assert.equal(contradicted, 0,
    `${contradicted} props across ${shops} shop rooms contradict a tended room: ${[...offenders].join(', ')}`);
});

test('a room does not argue with itself', () => {
  // The general form. Take each room's props, collect what they collectively
  // assert, and check nothing in the set contradicts anything else.
  for (const depth of [2, 3, 5, 8, 9]) {
    let rooms = 0, arguing = 0;
    const worst: string[] = [];
    for (const f of floors(depth)) {
      for (const r of f.rooms) {
        if (r.logicalOnly) continue;
        rooms++;
        const asserted = new Map<Claim, string>();
        let bad = false;
        for (const p of propsIn(f, r)) {
          const facts = propFacts(p as never);
          if (!facts) continue;
          const id = (p.model as { id?: string } | undefined)?.id ?? String(p.kind);
          for (const c of facts.claims) {
            for (const [other, byWhat] of asserted) {
              if (claimsConflict(c, other)) {
                bad = true;
                if (worst.length < 5) worst.push(`${byWhat} (${other}) vs ${id} (${c})`);
              }
            }
            asserted.set(c, id);
          }
        }
        if (bad) arguing++;
      }
    }
    const pct = arguing / Math.max(1, rooms);
    assert.ok(pct <= 0.02,
      `depth ${depth}: ${(pct * 100).toFixed(0)}% of rooms (${arguing}/${rooms}) hold contradicting props — e.g. ${worst.join(' · ')}`);
  }
});

test('claims do not starve rooms of decoration', () => {
  // The failure mode in the OTHER direction, and the reason the contradiction
  // table is kept minimal. A rule that refuses too much produces empty rooms,
  // which is worse than a slightly incoherent one — an empty room reads as a bug.
  for (const depth of [2, 3, 5, 8]) {
    let rooms = 0, bare = 0;
    for (const f of floors(depth)) {
      for (const r of f.rooms) {
        if (r.logicalOnly) continue;
        rooms++;
        if (propsIn(f, r).filter((p) => propFacts(p as never)).length === 0) bare++;
      }
    }
    const pct = bare / Math.max(1, rooms);
    assert.ok(pct <= 0.35,
      `depth ${depth}: ${(pct * 100).toFixed(0)}% of rooms have no classified props at all — the claim rule is refusing too much`);
  }
});

/** Small deterministic PRNG so the table tests don't depend on Math.random. */
function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
