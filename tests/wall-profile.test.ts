// Wall profiles — the vertical grammar a wall segment is built from
// (src/level/wall-profile.ts). These are the invariants the BUILDER relies on:
// it turns each resolved band into geometry and closes the steps between them,
// so a profile that doesn't tile the wall exactly leaves a visible seam or an
// overlapping z-fighting band in every room that uses it.
//
//   npm test -- wall-profile

import assert from 'node:assert/strict';
import {
  resolveProfile, WALL_PROFILE_NAMES, DEFAULT_WALL_PROFILE,
} from '../src/level/wall-profile';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const EPS = 1e-6;
// Real wall heights this game builds, plus the awkward ends of the range.
const HEIGHTS = [1.2, 1.8, 2.4, 2.8, 3.2, 4.0, 6.0];

test('bands tile the wall exactly — no gap, no overlap', () => {
  for (const name of WALL_PROFILE_NAMES) {
    for (const H of HEIGHTS) {
      const bands = resolveProfile(name, H);
      assert.ok(bands.length > 0, `${name}@${H}: emitted no bands`);
      assert.ok(Math.abs(bands[0].y0) < EPS, `${name}@${H}: first band starts at ${bands[0].y0}, not 0`);
      assert.ok(
        Math.abs(bands[bands.length - 1].y1 - H) < EPS,
        `${name}@${H}: last band ends at ${bands[bands.length - 1].y1}, not ${H}`,
      );
      for (let i = 1; i < bands.length; i++) {
        assert.ok(
          Math.abs(bands[i].y0 - bands[i - 1].y1) < EPS,
          `${name}@${H}: gap/overlap between band ${i - 1} and ${i} ` +
          `(${bands[i - 1].y1} → ${bands[i].y0})`,
        );
      }
    }
  }
});

test('every band has positive height', () => {
  // A zero- or negative-height band would bake a degenerate plane, and
  // mergeGeometries happily swallows those — it would show up as a corrupt
  // wall, not as an error.
  for (const name of WALL_PROFILE_NAMES) {
    for (const H of HEIGHTS) {
      for (const b of resolveProfile(name, H)) {
        assert.ok(b.y1 - b.y0 > 1e-4, `${name}@${H}: band '${b.name}' has height ${b.y1 - b.y0}`);
      }
    }
  }
});

test('fixed bands keep their authored height as the room grows', () => {
  // A plinth is a real-world size. If it scaled with room height, a tall hall
  // would get a waist-high skirting board.
  const tall = resolveProfile('coursed', 6.0);
  const short = resolveProfile('coursed', 2.8);
  const plinthTall = tall.find((b) => b.name === 'plinth');
  const plinthShort = short.find((b) => b.name === 'plinth');
  assert.ok(plinthTall && plinthShort, 'coursed lost its plinth');
  assert.ok(
    Math.abs((plinthTall!.y1 - plinthTall!.y0) - (plinthShort!.y1 - plinthShort!.y0)) < EPS,
    'plinth height changed with room height',
  );
});

test('short walls fall back to plain rather than emitting slivers', () => {
  // Below the point where flexible bands still read as courses, a profile with
  // no grammar beats a profile with broken grammar.
  const bands = resolveProfile('coursed', 1.0);
  assert.equal(bands.length, 1, `expected plain fallback, got ${bands.length} bands`);
  assert.equal(bands[0].depth, 0, 'fallback band should be flush with the wall plane');
});

test('plain is one flush band — the pre-grammar wall', () => {
  // The builder fast-paths on exactly this shape to reproduce the old geometry
  // byte-for-byte. If plain ever grows a second band or a depth, that fast path
  // silently stops matching and every un-opted room changes.
  for (const H of HEIGHTS) {
    const bands = resolveProfile('plain', H);
    assert.equal(bands.length, 1, `plain@${H} should be a single band`);
    assert.equal(bands[0].depth, 0, `plain@${H} should sit at depth 0`);
  }
});

test('depth offsets stay within the cosmetic budget', () => {
  // Wall collision is a line on the wall plane, so a proud band is geometry the
  // player walks through. Past ~8cm it reads as a ledge you ought to be able to
  // stand on and can't.
  for (const name of WALL_PROFILE_NAMES) {
    for (const b of resolveProfile(name, 3.2)) {
      assert.ok(
        Math.abs(b.depth) <= 0.08 + EPS,
        `${name}: band '${b.name}' depth ${b.depth} exceeds the 0.08m cosmetic budget`,
      );
    }
  }
});

test('the default profile resolves and is not plain', () => {
  // The default is what every un-opted room gets; if it silently became 'plain'
  // the whole grammar would ship switched off without anything failing.
  assert.ok(WALL_PROFILE_NAMES.includes(DEFAULT_WALL_PROFILE), 'default is not a known profile');
  assert.ok(resolveProfile(DEFAULT_WALL_PROFILE, 3.2).length > 1, 'default emits a single band');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
