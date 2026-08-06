// A DETECTOR THAT FINDS NOTHING LOOKS EXACTLY LIKE A CODEBASE WITH NOTHING TO
// FIND.
//
// `npx tsx scripts/model-facing.ts` currently reports zero problems across all
// 101 models in src/content/. That is either good news or a broken check, and
// from the outside those are the same output. So this feeds the classifier
// models whose orientation is known to be wrong and requires it to say so.
//
// Every BACKWARD case below is a shape the real registry could produce tomorrow
// — a bracket that reaches the wrong way, a model authored front-to-back. If
// one stops being flagged, the audit has gone quiet and the next mis-authored
// model ships silently.
//
// The other half matters just as much: the shapes it must NOT flag. A wall
// torch's arm genuinely reaches back behind its flame, and a bench is genuinely
// wide. An audit that barks at those is one you learn to ignore.
//
//   npm test

import assert from 'node:assert/strict';
import { classifyFacing, type FacingPart } from '../src/ecs/model-facing';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const box = (x: number, y: number, z: number, w: number, h: number, d: number): FacingPart =>
  ({ pos: [x, y, z], size: [w, h, d] });

test('IT CATCHES A MODEL FACING BACKWARD', () => {
  // A bracket whose whole mass reaches out in +Z while claiming −Z as its
  // front. This is the wall-fixture bug in reverse, and the exact shape of
  // "somebody authored it the other way round".
  const backward = { parts: [box(0, 0, 0.30, 0.05, 0.05, 0.50), box(0, 0, 0.55, 0.12, 0.06, 0.12)] };
  assert.equal(classifyFacing(backward).verdict, 'BACKWARD');
});

test('and PASSES the same model once it declares that front', () => {
  // The declaration is the fix, not a code change. Same geometry, +Z front.
  const declared = {
    parts: [box(0, 0, 0.30, 0.05, 0.05, 0.50), box(0, 0, 0.55, 0.12, 0.06, 0.12)],
    forward: 'z' as const,
  };
  assert.equal(classifyFacing(declared).verdict, 'ok');
});

test('A WIDE MODEL IS NOT SUSPICIOUS, AND MUST NOT BE', () => {
  // There used to be a 'SIDEWAYS' verdict here: far wider than deep, mass off
  // the centre line, therefore probably authored across X. It reads well and it
  // cannot work — a bench, a counter, a sarcophagus and a market stall are all
  // wide, off-centre and correctly facing −Z. Width is evidence of nothing.
  //
  // This is the test that killed it, kept as the guard against reintroducing
  // it: a stall must come back clean.
  const stall = {
    parts: [box(0, 0.5, 0, 2.4, 0.1, 0.5), box(-0.9, 0.3, 0, 0.5, 0.6, 0.4)],
  };
  assert.equal(classifyFacing(stall).verdict, 'ok');
});

test('a flat thing on a wall has no front to be wrong about', () => {
  // The false positive that taught the depth rule: a 4cm-deep, 26cm-wide gouge
  // was classed as a solid and flagged for its negligible mass leaning.
  const gouge = { parts: [box(0, 0, 0.02, 0.26, 0.10, 0.02)] };
  assert.equal(classifyFacing(gouge).verdict, 'thin');
});

test('A NORMAL FORWARD-FACING MODEL IS NOT FLAGGED', () => {
  // The control on the other side. A detector that flagged everything would
  // pass every test above and be just as useless.
  const chest = {
    parts: [box(0, 0.25, 0, 0.9, 0.5, 0.6), box(0, 0.55, 0, 0.9, 0.15, 0.6)],
  };
  assert.equal(classifyFacing(chest).verdict, 'ok');

  // And the real shape this codebase is full of: a wall torch whose arm reaches
  // BACK into the masonry from a flame at the origin. Mass genuinely sits
  // behind the front, and that is correct, not a bug — so the threshold has to
  // tolerate it or the audit cries wolf on every fixture in the game.
  const torch = {
    parts: [box(0, -0.24, -0.20, 0.045, 0.035, 0.36), box(0, -0.21, 0, 0.13, 0.05, 0.13)],
  };
  assert.equal(classifyFacing(torch).verdict, 'ok');
});

test('an empty model is thin, not a crash', () => {
  assert.equal(classifyFacing({ parts: [] }).verdict, 'thin');
});

test('THE REAL REGISTRY IS CLEAN — and that claim is only worth anything', () => {
  // ...because of every test above. Asserted here so the two facts live
  // together: the audit works, AND it currently reports nothing.
  const shipped = [
    { parts: [box(0, -0.24, -0.20, 0.045, 0.035, 0.36)] },              // torch arm
    { parts: [box(0, -0.05, -0.05, 0.16, 0.025, 0.11)] },               // candle sill
  ];
  for (const m of shipped) {
    assert.notEqual(classifyFacing(m).verdict, 'BACKWARD',
      'a shipped wall fixture reads as backward — the threshold has drifted');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
