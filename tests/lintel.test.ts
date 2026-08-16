// ── THE LINTEL LIVES IN A 0.31m WINDOW ──────────────────────────────────────
//
// A polygon room's wall closes its own doorways now: the shell builds a lintel
// from the arch's top up to the ceiling, and the gate stops building its own
// plate. Two independent computations of "how tall is the gate" therefore have
// to meet, and they are made from DIFFERENT INPUTS:
//
//   the SHELL  measures the doorway's OUTLINE and knows the corridor's height
//              only because it is now plumbed through OpeningRect.passageH.
//   the FRAME  measures the portal's CLEAR SPAN — narrower, since an outline
//              round a chamfer is longer than the way through.
//
// Two hazards, pulling opposite ways:
//
//   too HIGH — above the gate's hood — leaves a slit of void over the doorway
//              that nobody sees until it is on a phone in a dark room.
//   too LOW  — below the arch's crown — lays stone across the top of the way
//              through: the arch carves a bore and the wall fills it back in.
//
// Between them is the hood band, 0.31m. This sweeps the space and pins both.

import test from 'node:test';
import assert from 'node:assert/strict';
import { archwayGateTop } from '../src/content/archway';

/** The narrow width the shell substitutes to get the MINIMUM rise. */
const MIN_RISE_WIDTH = 0.7;
/** Voussoir ring + hood — the stone between the arch's crown and the gate's top. */
const HOOD_BAND = 0.19 + 0.12;

const WIDTHS = [1.0, 1.4, 1.8, 2.2, 2.6, 3.4, 4.6];
const CEILINGS = [2.8, 3.2, 3.6, 4.2, 4.8, 5.6];
/**
 * MEASURED, not assumed — and the difference mattered.
 *
 * The comment this replaced said "corridors are documented at 2.3-2.6m", which
 * is what the notes say and what the first sweep was built around. Running the
 * real generator over 24 floors reported passage heights of 2.3, 2.9, 3.0, 3.2,
 * 3.4, 3.7 ... 4.6 — nearly double the top of the documented band, because a
 * doorway's passage is whatever rect cuts it and plenty of those are rooms.
 *
 * That is the second time in this one feature that "what the generator produces"
 * turned out to be wrong from the outside. The band below spans the measured
 * range with margin at both ends.
 */
const PASSAGES = [1.8, 2.0, 2.2, 2.3, 2.45, 2.6, 3.0, 3.4, 3.9, 4.3, 4.6, 5.2];

test('the lintel sits in the band between the crown and the gate top', () => {
  let checked = 0, tightHigh = Infinity, tightLow = Infinity;
  for (const ceiling of CEILINGS) {
    for (const passage of PASSAGES) {
      const shellHead = archwayGateTop(MIN_RISE_WIDTH, ceiling, passage);
      for (const frameW of WIDTHS) {
        const frameTop = archwayGateTop(frameW, Math.max(ceiling, passage), passage);
        const frameCrown = frameTop - HOOD_BAND;
        const at = `w${frameW} c${ceiling} p${passage}`;

        assert.ok(shellHead <= frameTop + 1e-9,
          `${at}: the lintel starts ${(shellHead - frameTop).toFixed(3)}m ABOVE the gate top — daylight`);
        assert.ok(shellHead >= frameCrown - 1e-9,
          `${at}: the lintel starts ${(frameCrown - shellHead).toFixed(3)}m BELOW the crown — `
          + 'it lays stone across the way through');

        tightHigh = Math.min(tightHigh, frameTop - shellHead);
        tightLow = Math.min(tightLow, shellHead - frameCrown);
        checked++;
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} combinations swept`);
  assert.ok(tightHigh >= 0 && tightLow >= 0,
    `margins: ${tightHigh.toFixed(3)}m under the hood, ${tightLow.toFixed(3)}m over the crown`);
});

test('the width-blind version this replaced would have failed', () => {
  // The bounds above are only worth having if they discriminate. The first cut
  // passed the DOORWAY's width — always the larger of the two. Where the
  // springing clamps at its minimum the rise stops cancelling, the larger width
  // lifts the lintel, and it lifts it clear of the hood. This is that exact
  // case, kept as the reason MIN_RISE_WIDTH exists.
  const naive = archwayGateTop(1.4, 2.8, 1.8);     // shell measured the outline
  const real = archwayGateTop(1.0, 2.8, 1.8);      // frame measured the clear span
  assert.ok(naive > real,
    'the clamped regime no longer lifts a wider gate — if archGeometry changed, '
    + 're-derive MIN_RISE_WIDTH rather than deleting this');
  assert.ok(archwayGateTop(MIN_RISE_WIDTH, 2.8, 1.8) <= real + 1e-9,
    'MIN_RISE_WIDTH no longer clears the case it was chosen for');
});

test('a low chamber gets no lintel rather than a sliver', () => {
  // Where the ceiling barely clears the arch there is no wall above it, and a
  // few centimetres of lintel would only z-fight the hood. The shell skips
  // under 0.12m; this pins that such rooms exist, so the guard is live code.
  const H = 2.8;
  const head = archwayGateTop(MIN_RISE_WIDTH, H, 2.3);
  assert.ok(head > 0, 'gate top is degenerate');
  assert.ok(H - head < 0.6, `a ${H}m room still has ${(H - head).toFixed(2)}m over the arch`);
});
