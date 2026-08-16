// ── A WALL FIXTURE STANDS OFF THE WALL BY ITS OWN REACH ─────────────────────
//
// A wall fixture's origin is its FLAME, with the bracket reaching back in local
// −Z into the masonry. The placer marks the wall SURFACE, and the builder pushes
// the model out along the inward normal by `mount.standoff`. So the standoff and
// the model's backmost part are the same measurement, written twice — and when
// two numbers describe one fact, they drift.
//
// They had. The torch declared 0.34m of arm and a 0.20m standoff; the cresset
// declared a 0.34m plate and a 0.18m one. Both fixtures ran most of the way
// through a 0.25m wall, and because the light is registered at the model ORIGIN,
// the light went in with them. Josh, on a screenshot: *"i think torch
// lightsources are partially wrong compared to the model and almost stuck inside
// the walls."*
//
// Nothing caught it because nothing was comparing the two numbers. This does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { WALL_TORCH } from '../src/content/torch';
import { WALL_CRESSET } from '../src/content/light-props';
import { WALL_T } from '../src/level/poly-room-shell';
import type { ModelSpec, PartSpec } from '../src/ecs/model-types';

/**
 * How far the model reaches BACKWARD from its origin, in metres.
 *
 * Sprites are excluded: they are flames and embers, they always sit at the
 * front, and a billboard has no meaningful depth to bury.
 */
function backReach(spec: ModelSpec): number {
  let back = 0;
  for (const p of spec.parts as PartSpec[]) {
    const any = p as { kind: string; pos?: number[]; size?: number[]; height?: number; radius?: number };
    if (any.kind === 'sprite' || any.kind === 'decal') continue;
    const z = any.pos?.[2] ?? 0;
    // Half-depth along Z. A box states it; anything round is bounded by its
    // radius, which over-estimates a lying cylinder and is the safe direction.
    const halfZ = any.size ? any.size[2] / 2 : (any.radius ?? 0);
    back = Math.max(back, -(z - halfZ));
  }
  return back;
}

/** How far a bolted bracket may bite into the masonry. */
const BITE = 0.06;

const FIXTURES: Array<[string, ModelSpec]> = [
  ['wall-torch', WALL_TORCH],
  ['wall-cresset', WALL_CRESSET],
];

test('a wall fixture does not bury itself in the masonry', () => {
  for (const [name, spec] of FIXTURES) {
    const mount = (spec as { mount?: { to: string; standoff: number } }).mount;
    assert.ok(mount && mount.to === 'wall', `${name}: no wall mount declared`);
    const reach = backReach(spec);
    const buried = reach - mount!.standoff;
    assert.ok(
      buried <= BITE + 1e-6,
      `${name}: reaches ${reach.toFixed(2)}m back on a ${mount!.standoff.toFixed(2)}m standoff — `
      + `${buried.toFixed(2)}m of it is inside a ${WALL_T}m wall. The light registers at the `
      + `model ORIGIN, so it goes in with the bracket.`,
    );
    // ...and does not float, either. A bracket hanging in mid-air off the wall
    // is the same bug with the sign flipped, and just as invisible in a dark room.
    assert.ok(
      buried >= -0.02,
      `${name}: stands ${(-buried).toFixed(2)}m clear of the wall — the bracket is floating`,
    );
  }
});

test('the flame — and therefore the light — clears the wall', () => {
  // The registered light sits at the model origin (scene/torchlight.ts adds
  // `light.pos`, which neither of these declares). A point light closer to the
  // masonry than this blows out the stone behind it and reaches very little
  // floor, which is the look Josh described as the torches not lighting the
  // ground. Half the wall thickness is the least that reads as "in the room".
  for (const [name, spec] of FIXTURES) {
    const mount = (spec as { mount?: { standoff: number } }).mount!;
    assert.ok(mount.standoff > WALL_T / 2,
      `${name}: the flame stands ${mount.standoff}m off a ${WALL_T}m wall — the light is in the stone`);
  }
});
