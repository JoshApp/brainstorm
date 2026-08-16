// THE NARROW THRESHOLD IS A GATE, NOT A TRESTLE.
//
// Josh, comparing the two doorways: *"the massive stone one looks way better
// than the legacy one — can you remake that one to look awesome?"*
//
// The narrow frame was timber: two 0.18m posts under a median 2m of coursed
// wall, so it read as a table with masonry balanced on it. It is now a stone
// postern in the archway's own masonry family, and the thing that distinguishes
// the two thresholds is the CURVE:
//
//   the wide gate is SEGMENTAL because it must be — a round arch's rise is half
//   its span, and a 3.5m mouth would crown 1.75m up and punch the ceiling.
//   the postern is ROUND because it can be — at 1.0-2.0m the rise is 0.5-1.0m.
//
// That distinction is geometry, not decoration, so it is asserted here. The
// rest of this file is the same set of rules archway.test.ts holds its own
// model to, because the postern now solves the same equation and can fail it in
// all the same ways.
//
//   npm test -- postern

import assert from 'node:assert/strict';
import {
  doorframe, posternGeometry, posternColumnOffset, doorframeCollision,
  doorframePassableHalfBand,
} from '../src/content/doorframe';
import { ARCHWAY_MIN_WIDTH } from '../src/level/frame';
import { WALL_T } from '../src/level/poly-shell-plan';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// The band the generator actually hands this model: everything below the
// archway threshold. Measured over 144 floors — 230 of 1944 doorways, clear
// widths from 1.00m up to the 2.0m cutoff.
const WIDTHS = [1.0, 1.2, 1.4, 1.6, 1.7, 1.9];
const CEILINGS = [3.0, 3.2, 3.6, 4.8];
/** Real corridor ceilings. Rolled mine tunnels run 2.3-2.6m. */
const OPENS = [undefined, 2.4, 2.6, 3.0];

test('EVERY WIDTH IT IS GIVEN IS ONE THE ARCHWAY REFUSED', () => {
  // Guards the premise of the whole file. If the split moved and the postern
  // started receiving 3m mouths, "round because it can be" stops being true and
  // every assertion below would be measuring a case that never ships.
  for (const w of WIDTHS) {
    assert.ok(w < ARCHWAY_MIN_WIDTH,
      `${w}m is at or above the ${ARCHWAY_MIN_WIDTH}m archway threshold — the sample is wrong, not the model`);
  }
});

test('THE CURVE PASSES THROUGH ITS OWN SPRINGING POINTS', () => {
  // R = (s² + f²)/2f, checked against the circle rather than trusted. A sign or
  // a factor of two here is invisible at small rises and grotesque at large.
  for (const w of WIDTHS) for (const c of CEILINGS) {
    const g = posternGeometry(w, c);
    const dy = g.spring - g.centreY;
    const x = Math.sqrt(Math.max(0, g.radius ** 2 - dy ** 2));
    assert.ok(Math.abs(x - g.halfSpan) < 1e-6,
      `w${w} c${c}: the arch meets the springing line at ${x.toFixed(3)}m, not ${g.halfSpan.toFixed(3)}m`);
    assert.ok(Math.abs((g.centreY + g.radius) - (g.spring + g.rise)) < 1e-6,
      `w${w} c${c}: crown is not rise above the spring`);
  }
});

test('IT IS A ROUND ARCH WHENEVER THE HEADROOM ALLOWS', () => {
  // The whole point of the rebuild. A semicircle is rise === halfSpan, and it
  // falls out of the solve rather than being asserted into it — so this fails
  // the moment somebody caps the rise "just a little" for some other reason and
  // silently turns every postern back into a shallow segment.
  for (const w of WIDTHS) for (const c of CEILINGS) {
    const g = posternGeometry(w, c);
    assert.ok(Math.abs(g.rise - g.halfSpan) < 1e-9,
      `w${w} c${c}: rise ${g.rise.toFixed(2)} against half-span ${g.halfSpan.toFixed(2)} — that is a segment, not a round arch`);
    // A true semicircle centres ON the springing line and subtends a half turn.
    assert.ok(Math.abs(g.centreY - g.spring) < 1e-9, `w${w} c${c}: the circle's centre is off the springing line`);
    assert.ok(Math.abs(g.halfAngle - Math.PI / 2) < 1e-6,
      `w${w} c${c}: half-angle ${(g.halfAngle * 180 / Math.PI).toFixed(1)}°, not 90°`);
  }
});

test('THE CROWN NEVER RISES ABOVE THE PASSAGE BEHIND IT', () => {
  // The bore is the one place you can see through. A crown above the corridor's
  // ceiling shows the void over it — which is the same class of bug as the wall
  // cut with no floor behind it, seen from the other side.
  for (const w of WIDTHS) for (const c of CEILINGS) for (const o of OPENS) {
    const g = posternGeometry(w, c, o);
    const crown = g.spring + g.rise;
    if (o !== undefined) {
      assert.ok(crown <= o + 1e-9, `w${w} c${c} open${o}: crown ${crown.toFixed(2)} above a ${o}m passage`);
    }
    assert.ok(crown <= c - 0.12 + 1e-9, `w${w} c${c}: crown ${crown.toFixed(2)} through a ${c}m ceiling`);
  }
});

test('...and you can still walk under it', () => {
  // The control for the rule above. Sinking the springing to clear a low
  // passage is only correct while the opening stays taller than a person; a
  // solve that satisfies the cap by collapsing the arch is worse than the slit.
  for (const w of WIDTHS) for (const o of OPENS) {
    const g = posternGeometry(w, 3.2, o);
    assert.ok(g.spring >= 1.72 - 1e-9, `w${w} open${o}: springs at ${g.spring.toFixed(2)}m — you would duck`);
    assert.ok(g.rise >= 0.20 - 1e-9, `w${w} open${o}: a ${g.rise.toFixed(2)}m rise is a lintel, not an arch`);
    // And the way through clears a standing player at the CENTRE of the bore.
    assert.ok(g.spring + g.rise >= 2.0, `w${w} open${o}: a ${(g.spring + g.rise).toFixed(2)}m crown is a crawl`);
  }
});

test('THE ARCH SPRINGS FROM THE JAMBS', () => {
  // Its intrados has to land on the stone meant to carry it, not outboard in
  // mid-air — the failure the archway's own rebuild showed on the bench.
  for (const w of WIDTHS) {
    const g = posternGeometry(w, 3.2);
    const jambInner = posternColumnOffset(w) - 0.14;   // JAMB_HALF_THICK
    assert.ok(Math.abs(g.halfSpan - Math.max(0.32, jambInner)) < 1e-9,
      `w${w}: arch spans ±${g.halfSpan.toFixed(3)} but the jambs stand at ±${jambInner.toFixed(3)}`);
  }
});

test('THE JAMBS FLANK THE OPENING AND NEVER NARROW IT', () => {
  // The hard-won rule this rebuild had to carry over intact. When the jambs sat
  // INSIDE the gap, all 812 doorframes on 240 floors ate 0.36m of the way
  // through and a 1.7m squeeze arrived as 1.34m.
  for (const w of WIDTHS) {
    const blockers = doorframeCollision(w)!;
    assert.equal(blockers.length, 2, `w${w}: expected two blockers`);
    for (const b of blockers) {
      const inner = Math.abs((b as { ox: number }).ox) - (b as { halfW: number }).halfW;
      assert.ok(inner >= w / 2 - 1e-6,
        `w${w}: a blocker reaches to ±${inner.toFixed(3)}m, inside the ±${(w / 2).toFixed(3)}m opening`);
    }
    assert.ok(Math.abs(doorframePassableHalfBand(w) - w / 2) < 1e-9,
      `w${w}: the nav band is not the whole opening`);
  }
});

test('THE FILL IS THICKER THAN THE WALL IT PLUGS', () => {
  // A frame thinner than its hole shows a slit of void from any oblique angle.
  // Against the REAL wall thickness, imported — a hard-coded number here would
  // keep passing on the day WALL_T changed.
  const spec = doorframe({ width: 1.6, ceilingHeight: 3.2, wallDepth: WALL_T });
  const fill = spec.parts.find((p) => (p as { name?: string }).name === 'fill');
  assert.ok(fill, 'no fill part — the wall above the arch is open');
  const a = (fill as { a: { size: number[] } }).a;
  assert.ok(a.size[2] > WALL_T + 0.2,
    `fill is ${a.size[2]}m deep in a ${WALL_T}m poly wall — a slit shows obliquely`);
});

test('EVERY VOUSSOIR SITS ON THE SAME CIRCLE', () => {
  // The ring is laid by polar arithmetic and the fill's hole is cut by a
  // cylinder. If the two ever disagree the blocks float off the opening they
  // are supposed to line — visible instantly, and only from inside the bore.
  const spec = doorframe({ width: 1.6, ceilingHeight: 3.6, wallDepth: WALL_T });
  const g = posternGeometry(1.6, 3.6);
  const ring = spec.parts.filter((p) => /^(voussoir-|keystone)/.test((p as { name?: string }).name ?? ''));
  assert.ok(ring.length >= 5, `only ${ring.length} ring blocks`);
  for (const v of ring) {
    const [x, y] = (v as { pos: number[] }).pos;
    const radial = (v as { size: number[] }).size[1];
    const rho = Math.hypot(x, y - g.centreY);
    // Each block's centre sits half its own radial thickness outside the
    // intrados, so measure back to the circle rather than to the centre.
    assert.ok(Math.abs((rho - radial / 2) - g.radius) < 1e-6,
      `a ring block sits ${(rho - radial / 2).toFixed(3)}m from centre, not ${g.radius.toFixed(3)}m`);
  }
});

test('THE SAME DOORWAY IS THE SAME OBJECT', () => {
  // The arch costs a CSG and the builder's CSG cache is keyed on the part
  // object, so a fresh-but-equal spec caches nothing. This is the assertion
  // that keeps a floor's posterns cheap.
  const a = doorframe({ width: 1.62, ceilingHeight: 3.2, wallDepth: WALL_T });
  const b = doorframe({ width: 1.63, ceilingHeight: 3.2, wallDepth: WALL_T });
  assert.equal(a, b, 'two doorways a centimetre apart built two specs — the width is not snapping');
});

test('IT IS THE SAME MASONRY AS THE WIDE GATE', () => {
  // Two gates in one dungeon. The postern used to be timber, deliberately, and
  // that is the decision Josh reversed — so the shared palette is asserted
  // rather than left to drift back apart the next time either is touched.
  const spec = doorframe({ width: 1.6, ceilingHeight: 3.2, wallDepth: WALL_T });
  const mats = spec.materials as Record<string, { color: number; emissive?: number; detail?: string }>;
  assert.ok(mats.stone, 'no stone material — withSill mounts its slab as "stone" and would render untextured');
  assert.equal(mats.stone.color, 0x262a30, 'the postern quarried its stone somewhere else');

  // ── ONE MATERIAL, AND IT IS THE WALL'S ─────────────────────────────────────
  // This test used to assert the opposite: that a second 'glow' material existed
  // and carried an emissive ring lit by player proximity. Josh called that glow
  // a bug — and the project's own lighting doctrine agrees, since an uncommon
  // light is supposed to MEAN something and that one was decoration on every
  // gate in the dungeon. So the assertion is inverted rather than deleted: the
  // property worth protecting is that a gate is ONE stone, and that nothing here
  // quietly starts glowing again.
  assert.equal(mats.glow, undefined,
    'the proximity glow material is back — an uncommon light that means nothing');
  for (const [name, m] of Object.entries(mats)) {
    assert.ok(!m.emissive, `'${name}' emits light; a gate is stone, not a lamp`);
  }
  assert.equal(mats.stone.detail, 'wall',
    'the gate stopped using the wall\'s masonry — its courses will not line up with the wall it pierces');

  // Every part is that one material, so no piece of the gate can drift onto a
  // different stone the next time this model is edited.
  const others = spec.parts
    .map((p) => (p as { mat?: string; name?: string }))
    .filter((p) => p.mat !== undefined && p.mat !== 'stone');
  assert.equal(others.length, 0,
    `parts on a non-stone material: ${others.map((p) => `${p.name}:${p.mat}`).join(', ')}`);
  // The structure is still all there — a "one material" rule is trivially
  // satisfied by a gate that lost its pieces.
  for (const want of ['fill', 'plinth', 'course-0']) {
    const p = spec.parts.find((q) => (q as { name?: string }).name === want);
    assert.ok(p, `no '${want}' part — the gate lost a piece of its structure`);
    assert.equal((p as { mat?: string }).mat, 'stone', `'${want}' should be plain stone`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
