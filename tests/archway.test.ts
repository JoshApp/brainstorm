// A GATE THAT DOES NOT LET THE VOID IN.
//
// The archway is the most-repeated piece of architecture in the game and it was
// just rebuilt around a curve, so the things that can go wrong changed shape:
//
//   - the arch springs from thin air rather than from the jambs (the first pass
//     of the rebuild did exactly this, and the bench showed a flared notch);
//   - the crown rises above the passage behind it, so you see void over the
//     corridor through the one hole in the wall — the artefact Josh reported;
//   - the wall fill ends up thinner than the wall it plugs, same symptom from
//     an oblique angle (the first pass did this too, at 0.34m — picked off a
//     misremembered wall thickness);
//   - the stone and the collision blockers disagree, because one snaps its
//     width and the other doesn't.
//
// None of those are visible in a screenshot of a well-lit test scene, which is
// why they are here as numbers.
//
//   npm test

import assert from 'node:assert/strict';
import { archway, archGeometry, archwayColumnOffset, archwayPassableHalfBand } from '../src/content/archway';
import { WALL_T } from '../src/level/poly-room-shell';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Every width the generator can hand a frame, coarse enough to run fast. */
const WIDTHS = [0.8, 1.0, 1.3, 1.6, 1.9, 2.2, 2.6, 3.0];
const CEILINGS = [2.8, 3.2, 3.6, 4.2];
const OPENS = [undefined, 2.3, 2.5, 2.8, 3.2];

test('THE CURVE PASSES THROUGH ITS OWN SPRINGING POINTS', () => {
  // The segmental solve, R = (s² + f²)/2f, checked against the circle rather
  // than trusted. A sign or a factor-of-two here is invisible on the bench at
  // small rises and grotesque at large ones.
  for (const w of WIDTHS) for (const c of CEILINGS) {
    const g = archGeometry(w, c);
    const dy = g.spring - g.centreY;
    const x = Math.sqrt(Math.max(0, g.radius ** 2 - dy ** 2));
    assert.ok(Math.abs(x - g.halfSpan) < 1e-6,
      `w${w} c${c}: the arch meets the springing line at ${x.toFixed(3)}m, not ${g.halfSpan.toFixed(3)}m`);
    // And it crowns exactly `rise` above the springing.
    assert.ok(Math.abs((g.centreY + g.radius) - (g.spring + g.rise)) < 1e-6,
      `w${w} c${c}: crown is not rise above the spring`);
  }
});

test('THE ARCH SPRINGS FROM THE JAMBS', () => {
  // Its intrados has to land on the stone meant to carry it, not a third of a
  // metre outboard in mid-air.
  for (const w of WIDTHS) {
    const g = archGeometry(w, 3.2);
    const jambInner = archwayColumnOffset(w) - 0.16;   // JAMB_HALF_THICK
    assert.ok(Math.abs(g.halfSpan - Math.max(0.35, jambInner)) < 1e-9,
      `w${w}: arch spans ±${g.halfSpan.toFixed(3)} but the jambs stand at ±${jambInner.toFixed(3)}`);
  }
});

test('THE CROWN NEVER RISES ABOVE THE PASSAGE BEHIND IT', () => {
  // The bore is the one place you can see through. A crown above the corridor's
  // ceiling shows the void over it — "wall faces leaking", from the inside.
  for (const w of WIDTHS) for (const c of CEILINGS) for (const o of OPENS) {
    const g = archGeometry(w, c, o);
    const crown = g.spring + g.rise;
    if (o !== undefined) {
      assert.ok(crown <= o + 1e-9, `w${w} c${c} open${o}: crown ${crown.toFixed(2)} above a ${o}m passage`);
    }
    assert.ok(crown <= c - 0.14 + 1e-9, `w${w} c${c}: crown ${crown.toFixed(2)} through a ${c}m ceiling`);
  }
});

test('...and you can still walk under it', () => {
  // The control for the rule above. Sinking the springing to clear a low
  // passage is only correct while the opening stays taller than a person; a
  // solve that satisfies the cap by collapsing the arch is worse than the slit.
  for (const w of WIDTHS) for (const o of OPENS) {
    const g = archGeometry(w, 3.2, o);
    assert.ok(g.spring >= 1.78 - 1e-9, `w${w} open${o}: springs at ${g.spring.toFixed(2)}m — you would duck`);
    assert.ok(g.rise >= 0.22 - 1e-9, `w${w} open${o}: a ${g.rise.toFixed(2)}m rise is a lintel, not an arch`);
  }
});

test('THE FILL IS THICKER THAN THE WALL IT PLUGS', () => {
  // A frame thinner than its hole shows a slit of void from any oblique angle.
  // Checked against the REAL wall thickness, imported — a hard-coded 0.5 here
  // would keep passing on the day WALL_T changed.
  const spec = archway({ width: 1.6, ceilingHeight: 3.2 });
  const fill = spec.parts.find((p) => (p as { name?: string }).name === 'fill');
  assert.ok(fill, 'no fill part — the wall above the arch is open');
  const a = (fill as { a: { size: number[] } }).a;
  assert.ok(a.size[2] > WALL_T,
    `fill is ${a.size[2]}m deep in a ${WALL_T}m poly wall`);
  // WALL_T is the POLY floor's wall and it is thin. A frame also lands in a
  // vault DIVIDER, which is a full grid cell — doorframe.ts carries 1.10 for
  // exactly that, and this must not be the shallower of the two.
  assert.ok(a.size[2] >= 1.10 - 1e-9,
    `fill is ${a.size[2]}m — shallower than the doorframe's 1.10 in the same walls`);
});

test('the fill spans the whole opening, not just the arch', () => {
  for (const w of WIDTHS) {
    const spec = archway({ width: w, ceilingHeight: 3.2 });
    const fill = spec.parts.find((p) => (p as { name?: string }).name === 'fill') as
      { a: { size: number[]; pos: number[] } };
    assert.ok(fill.a.size[0] >= w, `w${w}: fill is ${fill.a.size[0]}m across a ${w}m hole`);
  }
});

test('THE STONE AND THE BLOCKERS AGREE', () => {
  // Widths are snapped so the CSG can be cached. If only the MODEL snapped, the
  // visible jamb and the circle you collide with would drift apart by up to
  // half a step — you would bounce off nothing, beside a pillar you can walk
  // through.
  for (const w of [0.83, 1.14, 1.37, 1.62, 1.88, 2.41]) {
    const spec = archway({ width: w, ceilingHeight: 3.2 });
    const plinths = spec.parts.filter((p) => (p as { name?: string }).name === 'plinth') as
      Array<{ pos: number[] }>;
    assert.equal(plinths.length, 2);
    const modelX = Math.abs(plinths[0].pos[0]);
    assert.ok(Math.abs(modelX - archwayColumnOffset(w)) < 1e-9,
      `w${w}: jamb drawn at ${modelX.toFixed(3)} and blocked at ${archwayColumnOffset(w).toFixed(3)}`);
  }
});

test('every voussoir sits on the same circle', () => {
  // The ring and the hole are derived from one radius; a block off the curve
  // floats or buries itself, and neither reads as masonry.
  const spec = archway({ width: 1.8, ceilingHeight: 3.6 });
  const g = archGeometry(1.8, 3.6);
  const ring = spec.parts.filter((p) => /voussoir|keystone/.test((p as { name?: string }).name ?? '')) as
    Array<{ pos: number[]; size: number[]; name: string }>;
  assert.ok(ring.length >= 5, `only ${ring.length} blocks in the ring`);
  for (const v of ring) {
    // Distance from the arch's centre back to the block's INNER face.
    const d = Math.hypot(v.pos[0], v.pos[1] - g.centreY) - v.size[1] / 2;
    assert.ok(Math.abs(d - g.radius) < 1e-6,
      `${v.name}: intrados at ${d.toFixed(3)}m, the arch is at ${g.radius.toFixed(3)}m`);
  }
  assert.equal(ring.filter((v) => v.name === 'keystone').length, 1, 'an arch has one keystone');
});

test('THE SAME DOORWAY IS THE SAME OBJECT', () => {
  // Not an optimisation detail — the builder's CSG cache is a WeakMap keyed on
  // the part, so a fresh-but-identical spec caches nothing and every doorway on
  // the floor pays a full boolean solve. Measured at 27ms each.
  const a = archway({ width: 1.62, ceilingHeight: 3.2, openHeight: 2.45 });
  const b = archway({ width: 1.64, ceilingHeight: 3.19, openHeight: 2.44 });
  assert.equal(a, b, 'two doorways a centimetre apart built two different models');
  const c = archway({ width: 2.4, ceilingHeight: 3.2, openHeight: 2.45 });
  assert.notEqual(a, c, 'the memo is returning one model for every width');
});

test('the nav gate still fits a player', () => {
  // Unchanged contract, re-asserted: the pathfinder funnels through this band
  // and a mob that cannot fit stands in the doorway forever.
  for (const w of WIDTHS) {
    assert.ok(archwayPassableHalfBand(w) >= 0.2, `w${w}: a ${archwayPassableHalfBand(w)}m half-band`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
