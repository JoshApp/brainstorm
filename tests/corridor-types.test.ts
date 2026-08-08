// A CORRIDOR IS A WORD FIRST, AND THE WORD HAS TO SURVIVE THE GENERATOR.
//
// Josh: *"I wonder how we can make the corridor generation truly awesome."*
// The first answer is a section vocabulary — squeeze, passage, gallery — and
// the whole value of a vocabulary is that a downstream layer can READ it: the
// light planner, the content layer, the frame models that take `openHeight`.
// Which means the word and the geometry must not be able to disagree.
//
// Four things are checked, and each of them is a way the idea can quietly rot:
//
//   1. THE FLOOR UNDER `width` IS A MEASUREMENT, NOT A FEELING. A squeeze that
//      feels great and is 1.1m wide silently walls the wraith out of half the
//      floor — a bug that presents as "the mobs stopped chasing me sometimes"
//      and takes three sessions to trace. So the floor is checked against the
//      SHIPPING nav predicate (`gateAdmits`) and the REAL enemy roster: add a
//      wide mob and this test fails, rather than the level going quiet.
//   2. THE STAMP MATCHES THE GEOMETRY. Every corridor RoomSpec carries a
//      `corridorType` id; if the rect it is stamped on is a different width,
//      the word is decoration and every reader of it is wrong.
//   3. ONE SECTION PER LINK. A dogleg is three rects. A passage that changes
//      width and ceiling halfway along does not read as architecture.
//   4. THE VARIANCE IS ACTUALLY THERE. This is the failure mode a vocabulary
//      is MOST prone to: it type-checks, it ships, and the gates are set such
//      that 99% of links pick the same one. (That already happened once this
//      session — galleries landed on 1% of links because the thresholds were
//      set against a length three times larger than the one being branched on.)
//      So the mix is asserted as a proportion, both ends.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor, RESERVE_W, MARGIN } from '../src/level/poly-floor';
import {
  ALL_CORRIDOR_TYPES, CORRIDOR_TYPES, MIN_WALKABLE_WIDTH, WIDEST_ROAMER_RADIUS,
  corridorType, corridorTypeFor, type CorridorTypeId,
} from '../src/level/corridor-types';
import { gateAdmits } from '../src/level/nav-grid';
import { ceilingForLink } from '../src/level/corridor-ceiling';
import { archwayPassableHalfBand } from '../src/content/archway';
import { doorframePassableHalfBand } from '../src/content/doorframe';
import { ENEMIES } from '../src/content/enemies';
import type { LevelSpec, RoomSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444, 555, 66, 777, 8888];
const DEPTHS = [1, 2, 5, 6, 8, 11];

/** A corridor's clear width is its SHORT side — the rect runs along its length. */
const widthOf = (c: RoomSpec) => Math.min(c.rect.w, c.rect.d);

/**
 * The corridors of a floor, grouped into LINKS.
 *
 * Ids are `cor-3` for a straight run and `cor-3-0…2` for a dogleg's legs (spurs
 * use `cor-p0`), so a link is the id minus a LEG suffix — and only then.
 * Stripping any trailing number folds every straight corridor on the floor into
 * one imaginary link called `cor`, which is what the first version of this did
 * before it went red.
 */
const LEG = /^(cor-[a-z]?\d+)-\d+$/;
function linksOf(spec: LevelSpec): Map<string, RoomSpec[]> {
  const out = new Map<string, RoomSpec[]>();
  for (const c of spec.corridors) {
    assert.ok(/^cor-[a-z]?\d+(-\d+)?$/.test(c.id),
      `corridor id ${c.id} does not match the naming these tests group by`);
    const link = LEG.exec(c.id)?.[1] ?? c.id;
    (out.get(link) ?? out.set(link, []).get(link)!).push(c);
  }
  return out;
}

/** Every floor in the sample, generated once. */
const FLOORS = SEEDS.flatMap((seed) => DEPTHS.map((depth) => ({
  seed, depth, spec: generatePolyFloor(depth, seed),
})));

test('THE WIDEST MOB THAT WALKS A CORRIDOR STILL FITS DOWN THE NARROWEST ONE', () => {
  // Bosses are excluded because boss depths do not use polygon floors at all
  // (procgen.ts hands those to the vault composer), and a miniboss lives only
  // in its own arena vault. Everything else can and does chase you into a
  // corridor, so everything else has to fit.
  const roamers = Object.values(ENEMIES).filter(
    (e) => !(e as { isBoss?: boolean }).isBoss && !(e as { miniboss?: boolean }).miniboss,
  );
  assert.ok(roamers.length > 10, `only ${roamers.length} roaming enemies — the roster did not load`);
  let widest = { id: '?', r: 0 };
  for (const e of roamers) {
    const r = (e as { collisionRadius?: number }).collisionRadius ?? 0;
    if (r > widest.r) widest = { id: (e as { id: string }).id, r };
  }
  // THE ROSTER SIDE OF THE DERIVATION. corridor-types.ts declares the sizing
  // radius as a number rather than importing the whole enemy catalogue into the
  // layout generator, so this is what keeps that number honest: it must stay at
  // or above everything that roams. It is deliberately ABOVE — sized to the
  // wraith's 0.62 while the widest actual roamer is the stoneguard at 0.55,
  // because the wraith is kept off these floors by a placement convention and
  // not by anything about the mob.
  assert.ok(WIDEST_ROAMER_RADIUS >= widest.r,
    `${widest.id} has collisionRadius ${widest.r} but corridors are sized for `
    + `${WIDEST_ROAMER_RADIUS} — the floor is now under the widest body on the roster`);

  // AND THE GEOMETRY SIDE, THROUGH A REAL FRAME. A corridor's clear width is not
  // its doorway's: an archway's columns stand inside the jamb, and the first
  // version of this floor (1.30m, reasoned straight off the mob radius) admitted
  // a wraith down the passage and stopped it dead in the arch at the end.
  const halfBandAt = (w: number) =>
    Math.min(archwayPassableHalfBand(w), doorframePassableHalfBand(w));
  assert.ok(gateAdmits(halfBandAt(MIN_WALKABLE_WIDTH), WIDEST_ROAMER_RADIUS),
    `r=${WIDEST_ROAMER_RADIUS} does not fit the doorway of a ${MIN_WALKABLE_WIDTH}m corridor`);
  assert.ok(!gateAdmits(halfBandAt(MIN_WALKABLE_WIDTH - 0.051), WIDEST_ROAMER_RADIUS),
    `${MIN_WALKABLE_WIDTH}m is not the SMALLEST admitting width — the solver is not solving`);

  for (const t of ALL_CORRIDOR_TYPES) {
    assert.ok(t.width >= MIN_WALKABLE_WIDTH,
      `${t.id} is ${t.width}m, under the ${MIN_WALKABLE_WIDTH}m walkable floor`);
  }
  // Sitting ON the floor is not good enough for the section we deliberately made
  // narrow: the floor moves whenever the archway is retuned, and a squeeze with
  // two centimetres of clearance becomes a wedged wraith on that day.
  assert.ok(CORRIDOR_TYPES.squeeze.width >= MIN_WALKABLE_WIDTH + 0.15,
    `the squeeze is ${CORRIDOR_TYPES.squeeze.width}m against a ${MIN_WALKABLE_WIDTH}m floor — `
    + 'no margin for the next frame change');
});

test('the layout reservation still keeps a GALLERY clear of the rooms beside it', () => {
  // RESERVE_W is a placement heuristic from before the vocabulary existed: the
  // spine packs boxes long before anyone knows which section will fill the gap,
  // so it reserves a fixed 2.2m. What actually guarantees a wide corridor does
  // not clip a neighbouring room is MARGIN on top of it. Widen a section past
  // that and floors start overlapping their own walls, silently.
  const widest = Math.max(...ALL_CORRIDOR_TYPES.map((t) => t.width));
  assert.ok(RESERVE_W / 2 + MARGIN >= widest / 2,
    `a ${widest}m section needs ${widest / 2}m of clearance, and layout keeps `
    + `${RESERVE_W / 2 + MARGIN}m — widen RESERVE_W or narrow the gallery`);
});

test('EVERY CORRIDOR IS THE WIDTH AND HEIGHT ITS WORD SAYS IT IS', () => {
  let n = 0, clamped = 0;
  for (const { seed, depth, spec } of FLOORS) {
    for (const legs of linksOf(spec).values()) {
      const t = corridorType(legs[0].corridorType as CorridorTypeId | undefined);
      // The stamped height is the section's INTENT; a link that opens into a
      // room lower than itself is clamped down to it, as a whole link. Asked
      // through the SHIPPING rule rather than re-derived here, so this cannot
      // drift into measuring its own copy of the clamp.
      const allowed = ceilingForLink(t.height, legs.map((l) => l.rect), spec.rooms);
      if (allowed < t.height - 0.01) clamped++;
      for (const c of legs) {
        n++;
        assert.ok(c.corridorType,
          `d${depth}/s${seed} ${c.id} has no corridorType — the word did not survive addLink`);
        assert.ok(Math.abs(widthOf(c) - t.width) < 0.01,
          `d${depth}/s${seed} ${c.id} is stamped ${t.id} (${t.width}m) but measures ${widthOf(c).toFixed(2)}m`);
        assert.ok(Math.abs(c.height - allowed) < 0.01,
          `d${depth}/s${seed} ${c.id} is stamped ${t.id} and should stand ${allowed.toFixed(2)}m `
          + `(section ${t.height}m, clamped to the rooms it meets) but is ${c.height.toFixed(2)}m`);
        assert.ok(widthOf(c) >= MIN_WALKABLE_WIDTH - 0.01,
          `d${depth}/s${seed} ${c.id} is ${widthOf(c).toFixed(2)}m — too narrow to be chased down`);
      }
    }
  }
  assert.ok(n > 400, `only ${n} corridors sampled — this test measured nothing`);
  // The clamp has to actually FIRE somewhere in the sample, or the assertion
  // above is only checking that nothing was clamped — a detector that finds
  // nothing looks exactly like a codebase with nothing to find.
  assert.ok(clamped > 0, 'no link was ceiling-clamped in 72 floors — the clamp is untested here');
});

test('NO CORRIDOR STANDS TALLER THAN A ROOM IT REACHES INTO', () => {
  // The property itself, stated on the finished floor rather than on the rule
  // that is supposed to produce it. This is what Josh saw: a corridor whose
  // rect ends inside a lower room punches its ceiling out through that room's,
  // and you end up looking at the outside of a tunnel from indoors.
  let over = 0, worst = 0;
  for (const { spec } of FLOORS) {
    for (const c of spec.corridors) {
      for (const r of spec.rooms) {
        if (Math.abs(c.rect.x - r.rect.x) > (c.rect.w + r.rect.w) / 2) continue;
        if (Math.abs(c.rect.z - r.rect.z) > (c.rect.d + r.rect.d) / 2) continue;
        if (c.height > r.height + 0.01) { over++; worst = Math.max(worst, c.height - r.height); }
      }
    }
  }
  assert.equal(over, 0,
    `${over} corridor/room overlaps where the corridor is taller, worst by ${worst.toFixed(2)}m`);
});

test('A DOGLEG DOES NOT CHANGE SECTION HALFWAY ROUND THE BEND', () => {
  let links = 0, bent = 0;
  for (const { seed, depth, spec } of FLOORS) {
    for (const [link, legs] of linksOf(spec)) {
      links++;
      if (legs.length > 1) bent++;
      const types = new Set(legs.map((l) => l.corridorType));
      assert.equal(types.size, 1,
        `d${depth}/s${seed} link ${link} runs ${[...types].join(' then ')} — one link, one section`);
      const heights = new Set(legs.map((l) => l.height.toFixed(2)));
      assert.equal(heights.size, 1,
        `d${depth}/s${seed} link ${link} changes ceiling mid-run: ${[...heights].join(', ')}`);
    }
  }
  assert.ok(bent / links > 0.3,
    `only ${((bent / links) * 100).toFixed(0)}% of links are multi-leg — this test is not seeing doglegs`);
});

test('THE MIX IS ACTUALLY MIXED — no section is a rounding error', () => {
  const count = new Map<string, number>();
  let legs = 0, varied = 0;
  for (const { spec } of FLOORS) {
    const here = new Set<string>();
    for (const c of spec.corridors) {
      legs++;
      const id = c.corridorType ?? 'passage';
      count.set(id, (count.get(id) ?? 0) + 1);
      here.add(id);
    }
    if (here.size >= 2) varied++;
  }
  for (const t of ALL_CORRIDOR_TYPES) {
    const share = (count.get(t.id) ?? 0) / legs;
    // Both ends. A section nobody meets is dead content; a section that is
    // every corridor is the old single-width generator wearing a new name.
    assert.ok(share > 0.05,
      `${t.id} is ${(share * 100).toFixed(1)}% of corridors — its run gates have priced it out`);
    assert.ok(share < 0.80,
      `${t.id} is ${(share * 100).toFixed(0)}% of corridors — the vocabulary collapsed back to one word`);
  }
  assert.ok(varied / FLOORS.length > 0.6,
    `only ${varied}/${FLOORS.length} floors carry two different sections — `
    + 'a player walking one floor would never learn the vocabulary exists');
});

test('a section is chosen by the RUN, not by a free roll', () => {
  // The claim the length gates rest on, on the two ends where it is decidable.
  const always = () => 0.999;   // rolls the LAST eligible type
  const never = () => 0;        // rolls the FIRST
  // A four-metre hop cannot be a gallery: a short gallery is just a wide door.
  for (const roll of [always, never, () => 0.5]) {
    assert.notEqual(corridorTypeFor(4, roll).id, 'gallery',
      'a 4m run picked a gallery — gallery.minRun is not doing anything');
  }
  // A long trudge cannot be a squeeze.
  for (const roll of [always, never, () => 0.5]) {
    assert.notEqual(corridorTypeFor(14, roll).id, 'squeeze',
      'a 14m run picked a squeeze — squeeze.maxRun is not doing anything');
  }
  // And the fallback is total: no run length may leave the picker empty-handed.
  for (let run = 0; run < 40; run += 0.5) {
    assert.ok(corridorTypeFor(run, () => 0.5).width >= MIN_WALKABLE_WIDTH,
      `a run of ${run}m resolved to nothing walkable`);
  }
  assert.equal(corridorType(undefined).id, CORRIDOR_TYPES.passage.id,
    'an unstamped corridor should read as the workhorse');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
