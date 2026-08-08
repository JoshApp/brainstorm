// ONE WALL'S OWN ANSWER.
//
// Step 3 of docs/SPACES-AND-THRESHOLDS.md. A link no longer makes two walls
// agree on a single number — once a corridor can bend (`corridor-route.ts`) its
// two ends are separate thresholds, each cut into one wall — so the question
// left here is small and sharp: **how wide will this wall open, and when will it
// decline?**
//
// ── WHAT USED TO BE HERE ─────────────────────────────────────────────────────
//
// `chooseLinkOpening`, the straight-corridor model: pick a facing anchor PAIR,
// intersect their ranges, take one width. It was superseded by the router and
// then deleted, because as a "straight only" baseline it was unsound — it never
// checked that the line between the two walls stayed out of the rooms, so it
// counted routes that would lay corridor floor indoors. By the end it was
// scoring HIGHER than the router that replaced it, which is exactly how a
// flattering baseline lies. The straight-vs-bent comparison now runs inside one
// solver, in corridor-route.test.ts.
//
//   npm test -- link-anchors

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { deriveAnchors, CRAWL_MIN, PORTAL_BANDS } from '../src/level/anchors';
import {
  mouthWidth, anchorSpan, GATE_MIN, GENEROSITY, bandForWidth,
} from '../src/level/link-anchors';
import { MIN_WALKABLE_WIDTH } from '../src/level/corridor-types';
import { type Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 6, 8, 11];
const SECTION = 2.2;   // corridor-types 'passage' — the common case

/** Every anchor every polygon room on the sample publishes. */
const ANCHORS = (() => {
  const out: Array<{ anchor: ReturnType<typeof deriveAnchors>[number]; poly: Poly }> = [];
  for (const seed of SEEDS) for (const depth of DEPTHS) {
    for (const r of generatePolyFloor(depth, seed).rooms) {
      if (!r.poly || r.poly.length < 3) continue;
      for (const a of deriveAnchors(r.id, r.poly as Poly, r.height)) {
        out.push({ anchor: a, poly: r.poly as Poly });
      }
    }
  }
  return out;
})();

test('A WALL OPENS WIDER THAN THE CORRIDOR BEHIND IT', () => {
  // Josh: "the big entrances are probably better by default."
  //
  // The default is not "whatever the section is" — it is the section opened out
  // as far as the wall can afford. That is the splayed embrasure the design doc
  // argues for: the flare belongs on the threshold, never on the corridor,
  // because a variable-width corridor breaks one-section-per-link and grows a
  // parameter in five placement systems.
  assert.ok(ANCHORS.length > 1000, `only ${ANCHORS.length} anchors — this measured nothing`);
  const widths = ANCHORS.map(({ anchor }) => mouthWidth(anchor, { section: SECTION }))
    .filter((w): w is number => w != null).sort((a, b) => a - b);
  const median = widths[widths.length >> 1];
  assert.ok(median > SECTION,
    `the median mouth is ${median.toFixed(2)}m for a ${SECTION}m section — walls are not `
    + 'opening out at all, so every doorway is exactly as wide as its corridor');
  assert.ok(widths.filter((w) => w > SECTION).length / widths.length > 0.7,
    'fewer than 70% of walls open out beyond their corridor');
});

test('A GATE IS ASKED FOR, NEVER INHERITED', () => {
  // The failure mode of "big by default" is that every wall with a long run
  // beside it becomes a monument, and then nothing is one. Supply is not the
  // limit, so the scarcity has to be a decision — this is what keeps it one.
  const ordinary = ANCHORS.map(({ anchor }) => mouthWidth(anchor, { section: SECTION }));
  assert.equal(ordinary.filter((w) => w != null && w >= GATE_MIN).length, 0,
    'an ordinary wall widened itself into the gate band');

  const asked = ANCHORS.map(({ anchor }) => mouthWidth(anchor, { section: SECTION, monumental: true }))
    .filter((w): w is number => w != null);
  // 43% of ANCHORS, which is the same fact as "77% of ROOMS could host a 4m
  // opening" seen per-wall instead of per-room: most rooms publish several
  // anchors and only their longest runs reach the gate band. Supply is not the
  // constraint either way.
  const gates = asked.filter((w) => w >= GATE_MIN).length;
  assert.ok(gates / asked.length > 0.35,
    `only ${((gates / asked.length) * 100).toFixed(0)}% of walls could deliver a gate when asked`);
});

test('A MOUTH NEVER EXCEEDS WHAT ITS WALL PUBLISHED', () => {
  // The whole point of a range is that it binds. A mouth wider than the run its
  // own wall declared is the overshoot again, wearing the new model's clothes.
  for (const { anchor, poly } of ANCHORS) {
    for (const want of [{ section: SECTION }, { section: SECTION, monumental: true },
                        { section: 3.6 }, { section: 1.55 },
                        { section: 1.55, minBand: 'crawl' as const }]) {
      const w = mouthWidth(anchor, want);
      if (w == null) continue;
      assert.ok(w <= anchor.width[1] + 1e-9,
        `a ${w.toFixed(2)}m mouth on a wall offering at most ${anchor.width[1].toFixed(2)}m`);
      assert.ok(w >= anchor.width[0] - 1e-9,
        `a ${w.toFixed(2)}m mouth under its wall's own minimum`);
      // And it fits inside the usable run with the corner clearance intact.
      const s = anchorSpan(anchor, poly);
      const run = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
      assert.ok(w <= run + 1e-6, `a ${w.toFixed(2)}m mouth on a ${run.toFixed(2)}m run`);
    }
  }
});

test('A WALL THAT CANNOT SERVE A MAINLINE DECLINES', () => {
  // Rather than shaving the width down to something illegal. A 0.9m mainline
  // built quietly is worse than a link the layout is told to re-route, because
  // it looks fine right up until a stoneguard has to use it.
  const tight = { width: [CRAWL_MIN, 1.0] as const, t0: 0, t1: 1 };
  assert.equal(mouthWidth(tight as never, { section: SECTION }), null,
    'a wall too narrow for the roster offered a mainline door anyway');
  // ...but it will happily serve a link that ASKED for a crawl. Josh: "having
  // the option for smaller ways could be handy for secret passages."
  const crawl = mouthWidth(tight as never, { section: SECTION, minBand: 'crawl' });
  assert.ok(crawl != null && crawl < MIN_WALKABLE_WIDTH,
    'a crawl was asked for and a door came back');
});

test('THE BAND VOCABULARY AGREES WITH ITSELF', () => {
  assert.equal(bandForWidth(0.9)?.id, 'crawl');
  assert.equal(bandForWidth(2.2)?.id, 'door');
  assert.equal(bandForWidth(5)?.id, 'gate');
  assert.ok(GATE_MIN > MIN_WALKABLE_WIDTH * GENEROSITY,
    'a generously-opened mainline door reaches the gate band on arithmetic alone');
  // The bands are ordered and disjoint, or "which band is this" has no answer.
  for (let i = 1; i < PORTAL_BANDS.length; i++) {
    assert.ok(PORTAL_BANDS[i].width[0] > PORTAL_BANDS[i - 1].width[1],
      `the ${PORTAL_BANDS[i - 1].id} and ${PORTAL_BANDS[i].id} bands overlap`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
