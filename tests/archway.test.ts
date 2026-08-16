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
import { archway, archGeometry, JAMB_HALF_THICK, archwayColumnOffset, archwayPassableHalfBand } from '../src/content/archway';
import { WALL_T } from '../src/level/poly-room-shell';
import { COURSE_H, BRICK_W } from '../src/style/stone-grid';

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
    const jambInner = archwayColumnOffset(w) - JAMB_HALF_THICK;
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
  const spec = archway({ width: 1.6, ceilingHeight: 3.2, wallDepth: WALL_T });
  const fill = spec.parts.find((p) => (p as { name?: string }).name === 'fill');
  assert.ok(fill, 'no fill part — the wall above the arch is open');
  const a = (fill as { a: { size: number[] } }).a;
  assert.ok(a.size[2] > WALL_T + 0.2,
    `fill is ${a.size[2]}m deep in a ${WALL_T}m poly wall — a slit shows obliquely`);
});

test('AND IT DOES NOT HANG OUT IN THE CORRIDOR', () => {
  // The other half of the same rule, and the one that was broken. Josh, on a
  // phone: *"doorways z fight with the corridor, they are halfways embedded."*
  //
  // The frame is centred in the wall, so any part reaching further than half
  // the reveal is stone standing in open air past the wall face — through the
  // corridor's own side-wall planes, which is the z-fight, and out past its
  // mouth, which is the "half embedded" read. Measured before the fix: 625 of
  // 625 generated doorways stood 0.425m proud on the fill and 0.545m on the
  // keystone, in a 0.25m wall.
  //
  // The keystone is ALLOWED to be the proudest block — it carries the dungeon's
  // eye and a flush one would be a painted circle — so the budget is stated per
  // part rather than as one number, and the ordering ring > fill > jamb is
  // asserted because that ordering is the whole read.
  for (const w of WIDTHS.filter((x) => x >= 2.0)) {
    const spec = archway({ width: w, ceilingHeight: 3.2, wallDepth: WALL_T });
    const named = (n: string) => spec.parts.find((p) => (p as { name?: string }).name === n);
    const fillDepth = (named('fill') as { a: { size: number[] } }).a.size[2];
    const keyDepth = (named('keystone') as { size: number[] }).size[2];
    const voussoir = (named('voussoir-0') as { size: number[] }).size[2];
    const shaft = (named('course-0') as { size: number[] }).size[2];
    const plinth = (named('plinth') as { size: number[] }).size[2];

    const proud = (d: number) => (d - WALL_T) / 2;
    assert.ok(proud(fillDepth) <= 0.20 + 1e-9,
      `w${w}: the wall fill stands ${proud(fillDepth).toFixed(3)}m out of a ${WALL_T}m wall on each face`);
    assert.ok(proud(keyDepth) <= 0.30 + 1e-9,
      `w${w}: the keystone stands ${proud(keyDepth).toFixed(3)}m proud — that is a buttress, not a boss`);
    assert.ok(keyDepth > voussoir && voussoir > fillDepth && fillDepth > shaft,
      `w${w}: depths out of order — key ${keyDepth.toFixed(2)} ring ${voussoir.toFixed(2)} `
      + `fill ${fillDepth.toFixed(2)} shaft ${shaft.toFixed(2)}`);
    assert.ok(plinth <= fillDepth + 1e-9,
      `w${w}: the plinth (${plinth.toFixed(2)}m) steps out past the wall face`);
  }
});

test('a thicker wall gets a deeper gate, and a plane still gets a gate', () => {
  // The rule is a FRACTION of the wall, not a constant (docs/DESIGN-METHOD.md).
  // Both ends of it: a rect room's wall is a single plane with no thickness at
  // all, and the arch still has to have depth for a lamp to rake across.
  const fillOf = (wallDepth: number) => {
    const spec = archway({ width: 2.2, ceilingHeight: 3.2, wallDepth });
    return ((spec.parts.find((p) => (p as { name?: string }).name === 'fill')) as
      { a: { size: number[] } }).a.size[2];
  };
  assert.ok(fillOf(0) >= 0.5, `a plane wall got a ${fillOf(0)}m gate — the ring has no depth`);
  assert.ok(fillOf(0.9) > fillOf(WALL_T), 'a thicker wall did not get a deeper reveal');
  assert.ok(fillOf(4.0) <= 1.10 + 1e-9, 'reveal ran away past a metre — that is a tunnel');
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

test('THE WALL ABOVE A GATE IS WALL, AND IT IS THE WALL S OWN THICKNESS', () => {
  // Josh, first: *"that stacked mass on top of it looks ugly, it's just a dumb
  // block."* The answer then was to lay coursed masonry on its face, standing
  // proud of the fill so the two read as stone on stone.
  //
  // Josh, again, 2026-08-16: *"lets make them not expand endless till they hit
  // the ceiling but make them simply a nice arch."* That is the same complaint
  // arriving from the other side, and it says the first fix treated a symptom.
  // The blank frontage was ugly because it was FRONTAGE — a slab at the gate's
  // full reveal depth, standing 0.16m proud of the wall on both faces, running
  // to the ceiling. Dressing it made it a better-looking wrong thing. It should
  // not have been part of the gate at all.
  //
  // So the invariant flipped, and this test flipped with it. The closure above
  // the hood is now the WALL's thickness, flush with the wall's faces, carrying
  // the same world-projected masonry as the stone either side of the doorway.
  // What this pins is that it stays flush: the day something makes it proud
  // again, the gate grows frontage again and it will be this that says so.
  for (const c of [3.6, 4.2, 4.8, 5.6]) {
    const spec = archway({ width: 2.4, ceilingHeight: c, wallDepth: WALL_T });
    const above = spec.parts.find((p) => (p as { name?: string }).name === 'wall-above') as
      { pos: number[]; size: number[] } | undefined;
    assert.ok(above, `c${c}: no closure above the arch — the doorway shows void`);
    // FLUSH. The wall is WALL_T thick; the closure must be that, not the gate's
    // reveal (which is WALL_T + 2 x FRAME_PROUD and would stand out both sides).
    assert.ok(above.size[2] <= WALL_T + 0.01,
      `c${c}: the closure is ${above.size[2].toFixed(2)}m deep in a ${WALL_T}m wall — that is frontage`);
    // And the GATE's own stone stops well below the ceiling, which is the thing
    // "not expand endless till they hit the ceiling" actually asks for.
    const fill = spec.parts.find((p) => (p as { name?: string }).name === 'fill') as
      { a: { pos: number[]; size: number[] } };
    const fillTop = fill.a.pos[1] + fill.a.size[1] / 2;
    assert.ok(fillTop < c - 0.2,
      `c${c}: the gate's fill reaches ${fillTop.toFixed(2)}m of a ${c}m ceiling`);
    // The closure has to actually meet it — a gap here is a slit of void.
    const closureBottom = above.pos[1] - above.size[1] / 2;
    assert.ok(closureBottom <= fillTop + 0.01,
      `c${c}: ${(closureBottom - fillTop).toFixed(3)}m of void between the hood and the wall above`);
    assert.ok(Math.abs((above.pos[1] + above.size[1] / 2) - c) < 0.01,
      `c${c}: the closure stops short of the ceiling`);
  }
  // A LOW room has no wall above the arch and must not grow one.
  const g = archGeometry(2.4, 2.8);
  if (2.8 - (g.spring + g.rise) < 0.3) {
    const low = archway({ width: 2.4, ceilingHeight: 2.8, wallDepth: WALL_T });
    assert.equal(low.parts.filter((p) => (p as { name?: string }).name === 'wall-above').length, 0,
      'a closure built in a room with no wall above the arch');
  }
});

test('THE HOOD FINISHES THE ARCH', () => {
  // The hood mould is what makes the gate END. Two things have to hold or it is
  // decoration rather than a termination: it must sit OUTSIDE the voussoir ring
  // (a hood inside the ring is just another voussoir), and it must run PAST the
  // ring at both springings so it lands on wall instead of stopping in mid-air.
  for (const w of [1.2, 2.4, 4.0]) {
    const spec = archway({ width: w, ceilingHeight: 4.2, wallDepth: WALL_T });
    const hood = spec.parts.filter((p) => /^hood-/.test((p as { name?: string }).name ?? '')) as
      Array<{ pos: number[] }>;
    assert.ok(hood.length > 0, `w${w}: no hood — the arch has no top`);
    const g = archGeometry(w, 4.2);
    const radial = (p: { pos: number[] }) =>
      Math.hypot(p.pos[0], p.pos[1] - g.centreY);
    for (const h of hood) {
      assert.ok(radial(h) > g.radius + 0.01,
        `w${w}: a hood block sits inside the arch ring`);
    }
    // Past the springing: the outermost hood block is wider apart in X than the
    // ring's own extrados.
    const extradosX = (g.radius + 0.19) * Math.sin(g.halfAngle);
    const hoodX = Math.max(...hood.map((h) => Math.abs(h.pos[0])));
    assert.ok(hoodX > extradosX,
      `w${w}: the hood stops at ${hoodX.toFixed(2)} inside the ring's ${extradosX.toFixed(2)} — it hangs in air`);
  }
});
