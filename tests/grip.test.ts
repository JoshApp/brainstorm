// HOW A WEAPON IS HELD IS DATA, AND IT RESOLVES FROM THE REAL SPECS.
//
// The v3 grip moved "how is this held" out of a sniff — scan the parts for a cylinder named
// `grip` or `haft`, take its radius — and into a declaration on the weapon. Two things have to
// stay true for that to be worth having, and neither is visible from a screenshot:
//
//   1. A weapon that declares NOTHING is posed exactly as it was before. There are a dozen
//      weapons and only three say anything; if the default drifted, every other weapon's grip
//      would move and the only way to notice would be to look at all of them.
//   2. A weapon that declares a style actually gets it, including the derived `slide` — which is
//      the whole reason the spear stopped being gripped at the exact centre of a 0.40m haft.
//
// Imports the real resolver against the real weapon specs. A test that restated the style table
// would only prove the table equals itself.
//
//   npm test -- grip

import assert from 'node:assert/strict';
import { resolveGrip } from '../src/content/grip';
import { FOREARM_EXIT_DESIRED } from '../src/content/hand';
import { SPEAR, IRON_MAUL, HEARTBURN } from '../src/content/weapons';
import { PILGRIMS_PIKE } from '../src/content/new-weapons';
import { SWORD_RUSTED } from '../src/content/sword';

// ── THE DEFAULT IS THE OLD BEHAVIOUR ────────────────────────────────────────
// HEARTBURN declares no grip at all, which is the case this guards: ten of the thirteen weapons
// are in that position and nothing but this test would notice the default drifting under them.
{
  const g = resolveGrip(HEARTBURN);
  assert.equal(g.style, 'saber', 'a weapon that declares nothing is a sabre');
  assert.deepEqual(g.offset, [0, 0, 0], 'no declared `along` means no shift along the haft');
  assert.equal(g.roll, 0, 'no declared roll');
  assert.equal(g.thumb, 'wrap');
  assert.deepEqual(g.forearmExit, FOREARM_EXIT_DESIRED,
    'the sabre wrist is content/hand.ts\'s value, so nothing existing re-poses');
  // Sniffed from the weapon's own grip cylinder, not a constant.
  assert.equal(g.radius, 0.022, 'radius comes off the authored grip part');
}

// ── A DECLARED STYLE ARRIVES, AND MOVES THE HAND ────────────────────────────
{
  const g = resolveGrip(SPEAR);
  assert.equal(g.style, 'staff');
  assert.equal(g.thumb, 'along', 'a thrust grip runs the thumb down the shaft');
  // The point of the exercise: before this, an unnamed grip part meant the spear silently fell
  // back to a generic hilt and the hand sat wherever grip_anchor happened to be.
  const mag = Math.hypot(...g.offset);
  assert.ok(mag > 0.01, `staff must walk the hand down the haft, got ${mag.toFixed(3)}m`);
  // The spear's shaft runs along -Z (its cylinders carry rot [pi/2,0,0]), so the offset must be
  // along Z — sliding it along +Y would take the hand sideways off the shaft entirely.
  assert.ok(Math.abs(g.offset[2]) > Math.abs(g.offset[1]),
    `the offset must follow the grip cylinder's own axis, got [${g.offset}]`);
  assert.notDeepEqual(g.forearmExit, FOREARM_EXIT_DESIRED,
    'a polearm wrist is not a sabre wrist');
}

{
  const g = resolveGrip(PILGRIMS_PIKE);
  assert.equal(g.style, 'staff', 'the other polearm agrees with the first');
}

{
  const g = resolveGrip(IRON_MAUL);
  assert.equal(g.style, 'hammer');
  assert.ok(Math.hypot(...g.offset) > 0, 'a maul is held low toward the pommel');
  assert.equal(g.thumb, 'wrap', 'a maul is a closed fist');
}

// ── AN EXPLICIT FIELD BEATS THE STYLE ───────────────────────────────────────
{
  const g = resolveGrip({ ...SPEAR, grip: { style: 'staff', along: 0.5, radius: 0.03 } });
  assert.equal(Math.hypot(...g.offset), 0, 'an explicit `along` overrides the style default');
  assert.equal(g.radius, 0.03, 'an explicit radius overrides the sniffed cylinder');
  assert.equal(g.thumb, 'along', 'and the rest of the style still applies');
}

// ── THE STARTER SWORD IS CHOKED UP AGAINST ITS GUARD ────────────────────────
// Centred on the grip cylinder, the fist's top edge sat 47mm below the cross-guard, leaving a
// long bare stretch of hilt above the hand — Josh: "the grips is a bit too spread vertically".
{
  const g = resolveGrip(SWORD_RUSTED);
  // The claim is DIRECTIONAL — the hand rides up the hilt rather than sitting centred on it.
  // Not a magnitude: `along` is a feel number that has moved 0.85 -> 0.72 -> 0.62 as the hand
  // shrank and the fist gathered, and a test pinned to today's value would fail on every one of
  // those without a thing being wrong.
  assert.ok(g.offset[1] > 0.005,
    `the sword must ride UP its hilt toward the guard, got ${g.offset[1].toFixed(3)}m`);
  // Its hilt is authored along +Y, so the shift belongs there and nowhere else.
  assert.equal(g.offset[0], 0);
  assert.equal(g.offset[2], 0);
}

// ── A WEAPON WITH NO GRIP CYLINDER STILL RESOLVES ───────────────────────────
{
  const g = resolveGrip({ id: 'nothing', parts: [] });
  assert.equal(g.radius, 0.022, 'falls back to the baseline hilt rather than NaN');
  assert.deepEqual(g.offset, [0, 0, 0], 'and cannot slide along a haft it does not have');
}

console.log('grip: defaults preserve the old pose, declared styles resolve and move the hand');
