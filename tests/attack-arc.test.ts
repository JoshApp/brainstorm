// The forward attack wedge — the fairness gate that makes "it visibly missed"
// and "it missed" the same statement.
//
//   npm test -- attack-arc

import assert from 'node:assert/strict';
import { withinForwardArc, OMNI_ARC } from '../src/combat/attack-arc';
import { CONFIG } from '../src/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const HALF = CONFIG.ENEMY_AI.MELEE_ARC_HALF;

// A mob at the origin with yaw 0 faces local -Z, i.e. toward NEGATIVE z.
const at = (x: number, z: number, half = HALF) => withinForwardArc(0, 0, 0, x, z, half);

test('yaw 0 faces -Z: dead ahead hits, dead behind does NOT', () => {
  assert.equal(at(0, -2), true, 'straight in front');
  assert.equal(at(0, 2), false, 'directly behind — this was the bug');
});

test('the flanks are outside a default swing', () => {
  // 90° off-axis. With a 57° half-angle this must miss, which is the whole
  // point: a committed sidestep beats a swing.
  assert.equal(at(2, 0), false, 'hard right');
  assert.equal(at(-2, 0), false, 'hard left');
});

test('the wedge is symmetric — no handedness bug', () => {
  for (const d of [0.2, 0.5, 0.9, 1.4]) {
    assert.equal(at(d, -1), at(-d, -1), `mirrored at ±${d}`);
  }
});

test('the boundary is exactly halfAngle from the facing direction', () => {
  const eps = 0.02;
  // A point at angle `a` off the -Z axis, at unit distance.
  const pt = (a: number) => ({ x: Math.sin(a), z: -Math.cos(a) });
  const inside = pt(HALF - eps);
  const outside = pt(HALF + eps);
  assert.equal(at(inside.x, inside.z), true, 'just inside the edge');
  assert.equal(at(outside.x, outside.z), false, 'just outside the edge');
});

test('yaw rotates the wedge with the body', () => {
  // Facing +X: yaw such that forward = (-sin y, -cos y) = (1, 0) → y = -PI/2.
  const yaw = -Math.PI / 2;
  assert.equal(withinForwardArc(0, 0, yaw, 2, 0, HALF), true, 'ahead after turning');
  assert.equal(withinForwardArc(0, 0, yaw, -2, 0, HALF), false, 'behind after turning');
});

test('omnidirectional and degenerate arcs behave', () => {
  assert.equal(at(0, 2, OMNI_ARC), true, 'a spin attack reaches behind');
  assert.equal(at(2, 0, OMNI_ARC), true);
  assert.equal(at(0, -2, 0), false, 'a zero arc hits nothing');
});

test('a target standing ON the attacker is never a miss', () => {
  // No meaningful direction at zero distance — "it is inside me" must not
  // resolve as a whiff, or a mob you are clipping into becomes harmless.
  assert.equal(at(0, 0), true);
  assert.equal(withinForwardArc(3, 3, 1.2, 3, 3, HALF), true);
});

test('the default arc is generous enough not to feel random', () => {
  // Design intent: a COMMITTED sidestep beats a swing; being slightly off-centre
  // does not. At a typical 1.4m reach, a small lateral offset must still connect.
  assert.ok(HALF >= 0.7, 'an arc under ~40° each side would read as random whiffs');
  assert.ok(HALF <= 1.4, 'an arc over ~80° each side stops rewarding circling');
  assert.equal(at(0.5, -1.4), true, 'half a metre off-centre at reach still lands');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
