// The unified attack-move runtime (combat/move-timeline.ts) — proves the two
// item stats behave as designed: attackSpeed compresses the WHOLE clock (motion
// + hits stay synced) and flurryHits adds loop iterations (more stabs + more
// hits), while the loop motion genuinely repeats.
//
//   npm test

import assert from 'node:assert/strict';
import { resolveMove, type MoveSpec } from '../src/combat/move-timeline';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// A move: intro 0.10s, a stab loop 0.10s (out at u=0, back at u=1), outro 0.20s.
// 3 loops, hit at the apex (u=0.4 within each loop).
const SPEC: MoveSpec = {
  motion: {
    intro: [{ t: 0, pose: p(0) }, { t: 1, pose: p(-0.2) }],
    loop:  [{ t: 0, pose: p(-0.2) }, { t: 0.5, pose: p(-0.6) }, { t: 1, pose: p(-0.2) }],
    outro: [{ t: 0, pose: p(-0.2) }, { t: 1, pose: p(0) }],
  },
  timing: { introS: 0.10, loopS: 0.10, outroS: 0.20 },
  loopCount: 3,
  hitAt: 0.4,
};
function p(z: number) { return { x: 0, y: 0, z, rotX: 0, rotY: 0, rotZ: 0 }; }

test('base: duration = intro + loops×loop + outro; one hit per loop', () => {
  const m = resolveMove(SPEC);
  assert.ok(approx(m.duration, 0.10 + 3 * 0.10 + 0.20), `duration ${m.duration}`);
  assert.equal(m.loops, 3);
  assert.equal(m.hitTimes.length, 3);
  // hits at intro + i×loop + hitAt×loop = 0.10 + i×0.10 + 0.04
  assert.ok(approx(m.hitTimes[0], 0.14), `hit0 ${m.hitTimes[0]}`);
  assert.ok(approx(m.hitTimes[1], 0.24), `hit1 ${m.hitTimes[1]}`);
  assert.ok(approx(m.hitTimes[2], 0.34), `hit2 ${m.hitTimes[2]}`);
});

test('attackSpeed is a RATE dial: recovery scales fully, the strike only partially', () => {
  const base = resolveMove(SPEC);
  const fast = resolveMove(SPEC, { attackSpeed: 2 });
  assert.ok(fast.duration < base.duration, `faster overall: ${fast.duration} !< ${base.duration}`);
  // NOT simply halved — the active strike stays mostly readable (ACTIVE_SPEED_SHARE);
  // only the recovery gets the full speedup. This is the anim-vs-rate split.
  assert.ok(fast.duration > base.duration / 2, `speed 2 must NOT halve the whole move: ${fast.duration}`);
  assert.equal(fast.hitTimes.length, 3, 'speed must NOT change the number of hits');
  assert.ok(fast.hitTimes[2] < fast.duration, 'hits stay inside the compressed timeline (synced)');
});

test('flurryHits adds loops AND hits (not speed)', () => {
  const m = resolveMove(SPEC, { flurryHits: 2 });
  assert.equal(m.loops, 5, 'two extra rips');
  assert.equal(m.hitTimes.length, 5);
  // loop spacing unchanged (0.10s); duration grows by 2×loop
  assert.ok(approx(m.duration, 0.10 + 5 * 0.10 + 0.20), `duration ${m.duration}`);
  assert.ok(approx(m.hitTimes[4], 0.10 + 4 * 0.10 + 0.04), `last hit ${m.hitTimes[4]}`);
});

test('the two stats are independent and compose', () => {
  const m = resolveMove(SPEC, { attackSpeed: 2, flurryHits: 1 });
  assert.equal(m.loops, 4);              // flurryHits → count
  assert.equal(m.hitTimes.length, 4);
  assert.ok(m.duration < resolveMove(SPEC, { flurryHits: 1 }).duration);   // attackSpeed → faster cadence
});

test('the loop MOTION repeats — same phase of each loop gives the same pose', () => {
  const m = resolveMove(SPEC);
  // apex of loop 0 vs loop 1 vs loop 2 (each at 40% into its 0.10s loop)
  const apex0 = m.poseAt(0.10 + 0.04);
  const apex1 = m.poseAt(0.10 + 0.10 + 0.04);
  const apex2 = m.poseAt(0.10 + 0.20 + 0.04);
  assert.ok(approx(apex0.z, apex1.z) && approx(apex1.z, apex2.z), `apexes ${apex0.z},${apex1.z},${apex2.z}`);
  // and the apex is the deepest thrust (most negative z) vs the loop edges
  const edge = m.poseAt(0.10 + 0.001);
  assert.ok(apex0.z < edge.z, `apex ${apex0.z} should thrust past edge ${edge.z}`);
});

test('poseAt walks intro → loops → outro and settles at rest', () => {
  const m = resolveMove(SPEC);
  assert.ok(approx(m.poseAt(0).z, 0), 'starts at intro[0]');
  assert.ok(approx(m.poseAt(m.duration + 1).z, 0), 'ends at outro rest, clamped past the end');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
