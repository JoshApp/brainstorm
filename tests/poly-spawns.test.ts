// A ROOM FIELDS THE PACK ITS FLOOR BUDGETED FOR IT.
//
// `furnish` decides a room's enemy count from its area (`round(area / 40)`) and
// then has to stand those bodies somewhere. For a long time it did that by
// iterating the PACK and taking one random candidate spot per enemy: if the spot
// was already claimed — by clutter, a pilaster, the centrepiece, or by the enemy
// placed one iteration earlier, since the candidate list was never consumed —
// that enemy was dropped, with no second try.
//
// Measured across 288 floors it lost 54% of every pack. A 107 m² combat room
// asked for three bodies and stood up 1.25, and a polygon floor fielded half the
// enemies of the vault floor it replaces (6.6 against 12.5) — in a game whose
// first design pillar is combat. Nothing failed; the floor simply agreed with
// itself about a number of enemies that were not there.
//
// This is the same shape as the other silent-cap bugs in this repo (see
// tests/one-ring.test.ts): a producer decides a quantity, a consumer quietly
// delivers less, and no assertion sits between them. So the assertion sits here,
// on the property rather than on the mechanism — a rewrite of the placement loop
// that is correct will pass, and any rewrite that goes back to losing bodies
// will fail whatever it is internally shaped like.
//
//   npm test -- poly-spawns

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { polyArea } from '../src/level/room-shape';
import { isBossDepth } from '../src/level/acts';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 137);
const DEPTHS = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12];

/** The rule `furnish` uses to budget a room. Restated here rather than imported
 *  because it is a local `const` inside the room loop — so this is the one place
 *  in the file that duplicates shipped logic, and it is the BUDGET, not the
 *  placement. If the divisor moves, this test should fail and be re-read, which
 *  is the point of it being visible. */
const budgetFor = (area: number) => Math.max(1, Math.round(area / 40));

interface Room { id: string; type: string; area: number; spawns: number }
interface Floor { depth: number; seed: number; rooms: Room[]; spawns: number }

let CORPUS: Floor[] | null = null;
function corpus(): Floor[] {
  if (CORPUS) return CORPUS;
  CORPUS = [];
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      // Boss depths are excluded on purpose: a boss hall is his alone, so its
      // pack is deliberately zero and would drag every ratio here down for a
      // reason that is correct. tests/poly-boss.ts owns that floor.
      if (isBossDepth(depth)) continue;
      const spec = generatePolyFloor(depth, seed);
      const per = new Map<string, number>();
      for (const s of spec.spawns ?? []) per.set(s.roomId ?? '?', (per.get(s.roomId ?? '?') ?? 0) + 1);
      CORPUS.push({
        depth, seed,
        spawns: (spec.spawns ?? []).length,
        rooms: spec.rooms.filter((r) => r.poly).map((r) => ({
          id: r.id,
          type: r.roomType ?? 'unknown',
          area: polyArea(r.poly!),
          spawns: per.get(r.id) ?? 0,
        })),
      });
    }
  }
  return CORPUS;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

test('THE SAMPLE HAS COMBAT ROOMS TO MEASURE', () => {
  // Guard against every ratio below being computed over an empty list.
  const combat = corpus().flatMap((f) => f.rooms.filter((r) => r.type === 'combat'));
  assert.ok(combat.length >= 100,
    `only ${combat.length} combat rooms in the corpus — the ratios below would be noise`);
});

test('A COMBAT ROOM STANDS UP MOST OF ITS BUDGET', () => {
  // 70% is a DESIGN FLOOR, not the measured value — a room is allowed to lose a
  // body to its own centrepiece or a tight shape. The bug this catches lived at
  // 46%. Stated as a floor with real headroom so an ordinary tuning change to
  // clutter density does not trip it, and a return to dropping half the pack
  // cannot slip through.
  const FLOOR = 0.7;
  const rooms = corpus().flatMap((f) => f.rooms.filter((r) => r.type === 'combat'));
  const budget = rooms.reduce((n, r) => n + budgetFor(r.area), 0);
  const stood = rooms.reduce((n, r) => n + r.spawns, 0);
  const ratio = stood / budget;
  assert.ok(ratio >= FLOOR,
    `combat rooms stand up ${(100 * ratio).toFixed(0)}% of their budgeted pack `
    + `(${stood} of ${budget} across ${rooms.length} rooms) — under the ${100 * FLOOR}% floor`);
});

test('AND NO SINGLE COMBAT ROOM IS EMPTY', () => {
  // The aggregate above can be met while a tail of rooms is barren, which is the
  // version of the bug a player actually walks into: a big lit hall marked for a
  // fight with nothing in it.
  const empty = corpus().flatMap((f) =>
    f.rooms.filter((r) => r.type === 'combat' && r.spawns === 0)
      .map((r) => `d${f.depth}/s${f.seed} ${r.id} (${r.area.toFixed(0)} m²)`));
  const rooms = corpus().flatMap((f) => f.rooms.filter((r) => r.type === 'combat'));
  const share = empty.length / rooms.length;
  assert.ok(share <= 0.02,
    `${empty.length} of ${rooms.length} combat rooms (${(100 * share).toFixed(1)}%) have no enemies: `
    + empty.slice(0, 5).join(', '));
});

test('A FLOOR FIELDS A FLOOR-SIZED FIGHT', () => {
  // The headline number, on the median rather than the mean so one enormous
  // arena cannot carry a corpus of thin floors. The vault generator this
  // replaces fields 12.5/floor; 8 is the stated floor below which a polygon
  // floor is a different game from the one the combat was tuned on.
  const per = corpus().map((f) => f.spawns);
  const m = median(per);
  assert.ok(m >= 8, `median ${m} enemies per floor — a polygon floor is not fielding a fight`);
});

test('BUT THE ROOMS THAT NEVER FIGHT STILL NEVER FIGHT', () => {
  // The control. Every assertion above would also pass on a generator that
  // ignored room type and sprayed enemies everywhere — which would put a pack in
  // the shop, and there is a whole fixed bug about enemies spawning in shops.
  const PEACEFUL = new Set(['shop', 'trove', 'sanctum', 'quiet', 'entrance']);
  const armed = corpus().flatMap((f) =>
    f.rooms.filter((r) => PEACEFUL.has(r.type) && r.spawns > 0)
      .map((r) => `d${f.depth}/s${f.seed} ${r.id} [${r.type}] ×${r.spawns}`));
  assert.equal(armed.length, 0, `enemies in rooms that take no pack: ${armed.slice(0, 5).join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
