// TWO WALLS AGREE ON ONE OPENING.
//
// Step 3 of docs/SPACES-AND-THRESHOLDS.md, checked before it is wired in. This
// is the step that removes the overshoot: today `connect()` guesses a lateral
// offset, ray-casts to find where a wall happens to be, and pushes 0.9m past it
// so a rect-crossing finder can see the crossing. With anchors both endpoints
// are already known and there is nothing to push past.
//
// What this measures, against the real generator rather than a fixture: can the
// rooms a floor actually links serve those links from their own walls, and how
// wide can they go. Josh asked for big entrances by default, so the width the
// chooser returns is checked for being GENEROUS, not merely legal.
//
//   npm test -- link-anchors

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { deriveAnchors } from '../src/level/anchors';
import {
  chooseLinkOpening, anchorSpan, GATE_MIN, GENEROSITY, bandForWidth,
} from '../src/level/link-anchors';
import { MIN_WALKABLE_WIDTH } from '../src/level/corridor-types';
import { pointInPoly, type Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 6, 8, 11];
const FLOORS = SEEDS.flatMap((seed) => DEPTHS.map((depth) => generatePolyFloor(depth, seed)));

/**
 * Every room pair the shipping generator actually joined, with the anchors
 * their walls publish.
 *
 * Reconstructed from the built corridors rather than from a re-implementation
 * of the layout: the question is whether anchors can serve the links the game
 * REALLY makes, and a hand-rolled set of pairs would answer a different one.
 */
const LINKS = (() => {
  const out: Array<{ A: { poly: Poly; anchors: ReturnType<typeof deriveAnchors> };
                     B: { poly: Poly; anchors: ReturnType<typeof deriveAnchors> };
                     toward: [number, number]; ids: string }> = [];
  for (const spec of FLOORS) {
    const rooms = spec.rooms.filter((r) => r.poly && r.poly.length >= 3);
    const cache = new Map<string, ReturnType<typeof deriveAnchors>>();
    const anch = (r: typeof rooms[number]) => {
      let v = cache.get(r.id);
      if (!v) cache.set(r.id, v = deriveAnchors(r.id, r.poly as Poly, r.height));
      return v;
    };
    for (const c of spec.corridors) {
      const ends: Array<[number, number]> = [
        [c.rect.x - c.rect.w / 2, c.rect.z], [c.rect.x + c.rect.w / 2, c.rect.z],
        [c.rect.x, c.rect.z - c.rect.d / 2], [c.rect.x, c.rect.z + c.rect.d / 2],
      ];
      const touch = rooms.filter((r) => ends.some((e) => pointInPoly(r.poly as Poly, e[0], e[1])));
      if (touch.length < 2) continue;
      const [ra, rb] = touch;
      out.push({
        A: { poly: ra.poly as Poly, anchors: anch(ra) },
        B: { poly: rb.poly as Poly, anchors: anch(rb) },
        toward: [rb.rect.x - ra.rect.x, rb.rect.z - ra.rect.z],
        ids: `${ra.id}→${rb.id}`,
      });
    }
  }
  return out;
})();

const SECTION = 2.2;   // corridor-types 'passage' — the common case

test('THE WALLS CAN SERVE THE LINKS THE FLOOR ACTUALLY MAKES', () => {
  assert.ok(LINKS.length > 150, `only ${LINKS.length} links sampled — this measured nothing`);
  const opened = LINKS.map((l) => chooseLinkOpening(l.A, l.B, l.toward, { section: SECTION }));
  const served = opened.filter(Boolean).length;
  assert.ok(served / LINKS.length > 0.8,
    `only ${((served / LINKS.length) * 100).toFixed(0)}% of links can be opened from the rooms' `
    + 'own walls — the layout would have to move rooms it currently does not');

  // A door, not a crawl. A mainline the roster cannot walk down is a deadlock,
  // and it would look exactly like a working floor until something chased you.
  const crawls = opened.filter((o) => o && o.band === 'crawl').length;
  assert.equal(crawls, 0,
    `${crawls} links resolved to a crawl — a mainline every mob must use`);
});

test('...and the opening is GENEROUS, not merely legal', () => {
  // Josh: "the big entrances are probably better by default." The chooser opens
  // the seam out beyond the corridor's own section wherever both walls allow,
  // which is the splayed mouth the design doc argues for — the flare belongs on
  // the threshold, never on the corridor.
  const ws = LINKS
    .map((l) => chooseLinkOpening(l.A, l.B, l.toward, { section: SECTION }))
    .filter(Boolean).map((o) => o!.width).sort((a, b) => a - b);
  const median = ws[ws.length >> 1];
  assert.ok(median > SECTION,
    `the median opening is ${median.toFixed(2)}m for a ${SECTION}m section — the seam is not `
    + 'opening out at all, so every doorway is exactly as wide as its corridor');
  assert.ok(ws.filter((w) => w > SECTION).length / ws.length > 0.5,
    'fewer than half the seams open out beyond their corridor');
});

test('A GATE IS ASKED FOR, NEVER INHERITED', () => {
  // The failure mode of "big by default" is that every seam with a long wall
  // beside it becomes a monument, and then nothing is one. Supply is not the
  // limit — 35% of links could afford 4m — so the scarcity has to be a
  // decision, and this is the assertion that keeps it one.
  const ordinary = LINKS
    .map((l) => chooseLinkOpening(l.A, l.B, l.toward, { section: SECTION }))
    .filter(Boolean);
  assert.equal(ordinary.filter((o) => o!.band === 'gate').length, 0,
    'an ordinary seam widened itself into the gate band');

  // And when it IS asked for, it is delivered wherever the walls can afford it.
  const asked = LINKS
    .map((l) => chooseLinkOpening(l.A, l.B, l.toward, { section: SECTION, monumental: true }))
    .filter(Boolean);
  const gates = asked.filter((o) => o!.band === 'gate').length;
  assert.ok(gates / asked.length > 0.25,
    `only ${((gates / asked.length) * 100).toFixed(0)}% of links could deliver a gate when asked`);
});

test('AN OPENING NEVER EXCEEDS WHAT EITHER WALL PUBLISHED', () => {
  // The whole point of a range is that it is binding on both sides. An opening
  // wider than a wall's own declared run is the overshoot again, wearing the
  // new model's clothes.
  for (const l of LINKS) {
    for (const want of [{ section: SECTION }, { section: SECTION, monumental: true },
                        { section: 3.6 }, { section: 1.55 }]) {
      const o = chooseLinkOpening(l.A, l.B, l.toward, want);
      if (!o) continue;
      assert.ok(o.width <= o.a.width[1] + 1e-9 && o.width <= o.b.width[1] + 1e-9,
        `${l.ids}: a ${o.width.toFixed(2)}m opening on walls offering at most `
        + `${Math.min(o.a.width[1], o.b.width[1]).toFixed(2)}m`);
      assert.ok(o.width >= o.a.width[0] - 1e-9 && o.width >= o.b.width[0] - 1e-9,
        `${l.ids}: a ${o.width.toFixed(2)}m opening under a wall's own minimum`);

      // And it sits INSIDE both usable runs — an opening centred on the overlap
      // but wider than it would be cut through a corner, which is the bug this
      // whole model exists to end.
      const alongX = Math.abs(l.toward[0]) > Math.abs(l.toward[1]);
      for (const [anchor, poly] of [[o.a, l.A.poly], [o.b, l.B.poly]] as const) {
        const s = anchorSpan(anchor, poly);
        const lo = Math.min(alongX ? s.from[1] : s.from[0], alongX ? s.to[1] : s.to[0]);
        const hi = Math.max(alongX ? s.from[1] : s.from[0], alongX ? s.to[1] : s.to[0]);
        assert.ok(o.lateral - o.width / 2 >= lo - 1e-6 && o.lateral + o.width / 2 <= hi + 1e-6,
          `${l.ids}: the opening runs off the end of a wall's usable span`);
      }
    }
  }
});

test('A LINK THAT CANNOT BE OPENED SAYS SO', () => {
  // Rather than clamping to something illegal. A 0.9m mainline built quietly is
  // worse than a link the layout is told to re-route, because it looks fine
  // right up until a stoneguard has to use it.
  const far: Poly = [[100, 100], [110, 100], [110, 110], [100, 110]];
  const near: Poly = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const A = { poly: near, anchors: deriveAnchors('a', near, 3) };
  const B = { poly: far, anchors: deriveAnchors('b', far, 3) };
  assert.equal(chooseLinkOpening(A, B, [1, 0], { section: SECTION }), null,
    'two rooms with no shared lateral produced an opening anyway');

  // A wall run too short for the section still yields the widest legal opening
  // rather than nothing — the range exists so most mismatches resolve.
  const slot: Poly = [[0, 0], [10, 0], [10, 3.6], [0, 3.6]];
  const C = { poly: slot, anchors: deriveAnchors('c', slot, 3) };
  const o = chooseLinkOpening(A, C, [0, -1], { section: 3.6 });
  assert.ok(o && o.width >= MIN_WALKABLE_WIDTH, 'two facing walls failed to agree at all');
});

test('THE BAND VOCABULARY AGREES WITH ITSELF', () => {
  assert.equal(bandForWidth(0.9)?.id, 'crawl');
  assert.equal(bandForWidth(2.2)?.id, 'door');
  assert.equal(bandForWidth(5)?.id, 'gate');
  assert.ok(GATE_MIN > MIN_WALKABLE_WIDTH * GENEROSITY,
    'a generously-opened mainline door reaches the gate band on arithmetic alone');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
