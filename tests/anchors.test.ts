// A ROOM SAYS WHERE ITS DOORS CAN BE.
//
// Step 1 of docs/SPACES-AND-THRESHOLDS.md. The room publishes the openings its
// own walls can afford, before any corridor exists to come looking for one.
// Nothing consumes them yet — on purpose, so the derivation can be checked
// against the shipping pipeline BEFORE the pipeline is rebuilt on it.
//
// ── THE MEASUREMENT THAT MOTIVATES IT ────────────────────────────────────────
//
// Today a doorway lands wherever a corridor rect happened to cross a wall line,
// and the corridor has no idea what it is crossing. Over 656 doorways:
//
//   35% OVERLAP A CORNER. The 5th percentile is −1.52m — a doorway wrapping a
//   metre and a half past the corner, around onto the next wall.
//
// A door straddling a corner has no flat wall to be a door in. That is the
// chamfered opening `planPortals` had to grow multi-edge `cuts` for (#169), the
// frame that cannot sit flat, and the stone door photographed inset into a
// winding passage — one cause, three tickets.
//
// And the separation is clean, which is the result this whole model rests on.
// Of today's doors, those with a facing anchor near them sit a median 1.02m
// clear of a corner; those WITHOUT one sit a median 0.83m PAST a corner, and
// 92% of them overlap one. The doors the wall cannot account for are almost
// exactly the doors that should not be there.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import {
  deriveAnchors, facesToward, CORNER_CLEAR, CORNER_STRUCTURAL, MIN_HOSTING_EDGE,
  MIN_DOOR_EDGE, CRAWL_MIN, CRAWL_MAX, WIDEST_ROAMER, PORTAL_BANDS,
  whoFitsThrough, canHost, hostableBands,
} from '../src/level/anchors';
import { MIN_WALKABLE_WIDTH } from '../src/level/corridor-types';
import { PILASTER } from '../src/level/poly-dressing';
import { planPortals } from '../src/level/portals';
import { pointInPoly, type Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 6, 8, 11];
const FLOORS = SEEDS.flatMap((seed) => DEPTHS.map((depth) => ({
  seed, depth, spec: generatePolyFloor(depth, seed),
})));

/** Every polygon room on the sample, with the anchors its walls publish. */
function walled() {
  return FLOORS.flatMap(({ seed, depth, spec }) => spec.rooms
    .filter((r) => r.poly && r.poly.length >= 3)
    .map((r) => ({
      seed, depth, spec, room: r,
      anchors: deriveAnchors(r.id, r.poly as Poly, r.height),
    })));
}

test('AN ANCHOR IS NEVER IN A CORNER', () => {
  // The whole point. Checked on the finished polygons rather than on the
  // constructor's arithmetic, because a winding-order slip or a degenerate edge
  // would satisfy the arithmetic and still put a door round a corner.
  let checked = 0, worst = Infinity;
  for (const { room, anchors } of walled()) {
    const P = room.poly as Poly;
    for (const a of anchors) {
      checked++;
      for (const v of P) {
        const d = Math.hypot(v[0] - a.at[0], v[1] - a.at[1]) - a.width[0] / 2;
        worst = Math.min(worst, d);
        assert.ok(d >= CORNER_STRUCTURAL - 0.01,
          `an anchor's narrowest door would come within ${d.toFixed(2)}m of a corner, `
          + `under the ${CORNER_STRUCTURAL.toFixed(2)}m a pilaster and the wall ring need`);
      }
    }
  }
  assert.ok(checked > 500, `only ${checked} anchors sampled — this measured nothing`);
});

test('...and its normal points OUT of the room', () => {
  // A flipped normal is silent: every door would face into the stone and the
  // frames would all be backwards, which is exactly the bug found in the room
  // clutter placer earlier today.
  for (const { room, anchors } of walled()) {
    const P = room.poly as Poly;
    for (const a of anchors) {
      const out: [number, number] = [a.at[0] + a.normal[0] * 0.25, a.at[1] + a.normal[1] * 0.25];
      const inn: [number, number] = [a.at[0] - a.normal[0] * 0.25, a.at[1] - a.normal[1] * 0.25];
      assert.ok(!pointInPoly(P, out[0], out[1]),
        `an anchor on ${room.id} has its normal pointing INTO the room`);
      assert.ok(pointInPoly(P, inn[0], inn[1]),
        `an anchor on ${room.id} does not sit on its room's own wall`);
    }
  }
});

test('EVERY ROOM CAN HOST A DOOR, AND MOST CAN HOST A CHOICE', () => {
  // A room with no anchor is a room the layout cannot use. A room with exactly
  // one cannot be on a spine at all, let alone carry a loop — and the loop pass
  // needs a THIRD, which is the thing that made cycles impossible to plan
  // before (0 of 383 candidate pairs were connectable).
  const rooms = walled();
  const none = rooms.filter((r) => r.anchors.length === 0).length;
  const three = rooms.filter((r) => r.anchors.length >= 3).length;
  assert.equal(none, 0, `${none} rooms can host no door at all`);
  assert.ok(three / rooms.length > 0.7,
    `only ${((three / rooms.length) * 100).toFixed(0)}% of rooms can host three doors — `
    + 'a loop needs a third, and planning one needs the choice to exist');
});

test('THE WIDTH IS A RANGE, AND IT IS DERIVED', () => {
  // A fixed width makes every mismatch a conflict somebody loses. The range is
  // the wall stating what it CAN do; the layout takes what its section wants,
  // clamped into the overlap with the other side.
  for (const { room, anchors } of walled()) {
    for (const a of anchors) {
      assert.equal(a.width[0], CRAWL_MIN,
        'the narrow end of the range must be the narrowest hole the game cuts '
        + 'anywhere, not a taste call — and NOT MIN_WALKABLE_WIDTH, which is the '
        + "layout's requirement rather than the wall's capability");
      assert.ok(a.width[1] >= a.width[0],
        `${room.id} published an empty width range [${a.width[0]}, ${a.width[1]}]`);
      assert.ok(Math.abs(a.width[1] - (a.t1 - a.t0)) < 0.01,
        'the wide end must be the flat run the wall actually has');
      // Height is capped by the room. An opening taller than its wall is a hole
      // in the sky — the same rule the threshold type carries.
      assert.ok(a.height[1] <= room.height + 1e-6,
        `a ${a.height[1]}m opening published on a ${room.height}m wall`);
    }
  }
  // And the clearance is derived from the two things that constrain it, so it
  // moves when they do rather than being a number somebody liked.
  assert.ok(Math.abs(CORNER_STRUCTURAL - (PILASTER.width / 2 + 0.14)) < 1e-9,
    'the structural clearance has drifted from the pilaster and the wall ring');
  assert.ok(MIN_HOSTING_EDGE > 2 * CORNER_CLEAR,
    'an edge could host a door with no stone left beside it');
  assert.ok(MIN_DOOR_EDGE > MIN_HOSTING_EDGE,
    'a mainline door needs more wall than a crawl does, or the two are the same rule');
});

test('A CRAWL IS A DOOR THE BIG THINGS CANNOT USE', () => {
  // Josh: "I love the occasional massive portal as well as a sneaky way."
  //
  // The sneaky way is a MECHANIC, not a size, and this is the assertion that
  // says so. The first version of this band was derived from
  // WIDEST_ROAMER_RADIUS — a figure deliberately padded ABOVE the roster so
  // corridors fit everything — and the resulting "crawl" admitted all 23 mobs.
  // It looked exactly like a working one. Hence: assert the exclusion, never
  // the numbers.
  const door = PORTAL_BANDS.find((b) => b.id === 'door')!;
  const crawl = PORTAL_BANDS.find((b) => b.id === 'crawl')!;
  assert.ok(CRAWL_MIN < CRAWL_MAX,
    `the crawl band is empty (${CRAWL_MIN}..${CRAWL_MAX}) — the roster has outgrown `
    + 'the idea and this must fail rather than become an ordinary door');
  assert.ok(CRAWL_MAX < door.width[0], 'a crawl can be cut as wide as an ordinary door');

  const fitsDoor = new Set(whoFitsThrough(door.width[0]));
  // Sampled ACROSS the band, not just at its ends: the layout may cut anywhere
  // inside it, and a band that only works at one width is not a band.
  for (let w = CRAWL_MIN; w <= CRAWL_MAX + 1e-9; w += 0.05) {
    const fits = whoFitsThrough(w);
    assert.ok(fits.length < fitsDoor.size,
      `a ${w.toFixed(2)}m crawl lets through everything an ordinary door does — it excludes nothing`);
    for (const id of fits) assert.ok(fitsDoor.has(id), 'a crawl admits something a door refuses');
    // The two named ends of the mechanic.
    assert.ok(!fits.includes('stoneguard'),
      `the stoneguard follows you through a ${w.toFixed(2)}m crawl`);
  }
  // The widest roamer is read off the ROSTER, so a new heavy mob moves the band
  // instead of silently walking through it.
  assert.equal(WIDEST_ROAMER, 0.55, 'the widest roamer changed — re-check the crawl band');
  // And every ROAMER fits an ordinary door, or "door" is not circulation. Only
  // roamers: the bosses are 0.70 and 1.20 wide and live in arenas they never
  // leave, and sizing every doorway in the game for the marrow-sovereign would
  // put a 2.5m hole in every wall.
  assert.ok(whoFitsThrough(MIN_WALKABLE_WIDTH).includes('stoneguard'),
    'the widest roamer cannot use a mainline door — the layout would deadlock');
  assert.ok(2 * WIDEST_ROAMER + 0.06 <= MIN_WALKABLE_WIDTH,
    'MIN_WALKABLE_WIDTH has drifted below the widest roamer');

  // Both jobs are placeable on real floors, and a gate is scarce by DECISION
  // rather than by geometry — three quarters of rooms could hold one.
  const rooms = walled();
  const hosts = (id: string) => rooms.filter((r) =>
    r.anchors.some((a) => canHost(a, PORTAL_BANDS.find((b) => b.id === id)!))).length;
  assert.equal(hosts('crawl'), rooms.length, 'some room cannot hold a crawl anywhere');
  assert.equal(hosts('door'), rooms.length, 'some room cannot hold a door anywhere');
  assert.ok(hosts('gate') / rooms.length > 0.5,
    `only ${((hosts('gate') / rooms.length) * 100).toFixed(0)}% of rooms could hold a gate — `
    + 'the massive portal would be rare because the shapes cannot, not because we chose');
  // canHost must read BOTH ends of the range. Checking only the wide end says
  // yes to everything, which is what it did before this test existed.
  assert.ok(!canHost({ ...rooms[0].anchors[0], width: [6, 9] }, crawl),
    'a wall that can only hold a 6m opening was offered a crawl');
  assert.ok(hostableBands(rooms[0].anchors[0]).length >= 1);
});

test('THE DOORS THIS CANNOT ACCOUNT FOR ARE THE ONES IN CORNERS', () => {
  // The result the model rests on, and the one that would quietly rot: if the
  // anchors ever start missing GOOD doors, the derivation is too strict and the
  // layout will be unable to build floors it used to.
  const withA: number[] = [], without: number[] = [];
  for (const { spec, room, anchors } of walled()) {
    const P = room.poly as Poly;
    const cors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const p of planPortals(room.id, P, cors)) {
      let nearest = Infinity;
      for (const v of P) nearest = Math.min(nearest, Math.hypot(v[0] - p.mid[0], v[1] - p.mid[1]));
      const gap = nearest - p.width / 2;
      const covered = anchors.some((a) =>
        Math.hypot(a.at[0] - p.mid[0], a.at[1] - p.mid[1]) < Math.max(4, p.width)
        && facesToward(a, p.mid[0] - room.rect.x, p.mid[1] - room.rect.z));
      (covered ? withA : without).push(gap);
    }
  }
  const total = withA.length + without.length;
  assert.ok(total > 400, `only ${total} doors sampled — this measured nothing`);
  assert.ok(withA.length / total > 0.8,
    `only ${((withA.length / total) * 100).toFixed(0)}% of today's doors have a facing `
    + 'anchor — the derivation is too strict and would cost the layout doors it needs');
  const inCorner = (xs: number[]) => xs.filter((x) => x < 0).length / xs.length;
  assert.ok(inCorner(without) > 0.75,
    `only ${(inCorner(without) * 100).toFixed(0)}% of the unaccounted doors overlap a corner — `
    + 'they are ordinary doors the walls refuse to offer, which is a different problem');
  assert.ok(inCorner(without) > inCorner(withA) * 2,
    'the accounted and unaccounted doors are equally corner-bound — the anchors are not '
    + 'selecting for anything');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
