/**
 * ELBOW PROBE — where do the arm IK joints sit, and do they intrude on frame?
 *
 * Josh, on the v3 presence pass: *"you can partially see the shoulder poking
 * into frame when moving forward for a while — i see one joint poking into
 * frame."* Both arms place their elbow with a POLE-BIASED 2-bone solve off the
 * hand position, and the presence pass moved BOTH hands — the lamp hand a lot
 * (18cm nearer, 13cm up). This prices it instead of guessing which joint.
 *
 * "Moving forward for a while" is a real mechanic, not flavour: momentum widens
 * the FOV by up to CONFIG.MOMENTUM.FOV_MAX_DEG, so the frustum GROWS the longer
 * you run — which is exactly when an off-frame joint would slide into view. The
 * sweep below covers rest FOV through full-momentum FOV.
 *
 * IMPORTS THE REAL SOLVER (anim/arm-ik.ts) and the real config — a probe that
 * re-inlines the math would launder a guess as a measurement.
 *
 * Run: npx tsx scripts/elbow-probe.ts
 */
import { ArmIK } from '../src/anim/arm-ik';
import {
  ARM_RIGHT, ARM_LEFT,
  ARM_RIGHT_HUMERUS_LENGTH, ARM_RIGHT_FOREARM_LENGTH,
  ARM_LEFT_HUMERUS_LENGTH, ARM_LEFT_FOREARM_LENGTH,
} from '../src/content/arm';
import { CONFIG } from '../src/config';

type V3 = [number, number, number];

/** Read a slot's authored position straight off the ModelSpec, so this probe
 *  can never disagree with the geometry it claims to be measuring. */
function slotPos(spec: typeof ARM_RIGHT, name: string): V3 {
  const p = (spec.slots as Record<string, { pos?: number[] }>)[name]?.pos;
  if (!p) throw new Error(`${spec.id}: no slot '${name}'`);
  return [p[0], p[1], p[2]];
}

// Elbow poles must match the two ArmIK constructions (player/viewmodel.ts,
// player/lamp-arm.ts); shoulder rests come from the specs above.
const RIGHT = {
  name: 'RIGHT (weapon)',
  shoulder: slotPos(ARM_RIGHT, 'shoulder'),
  pole: [1, -0.5, 0.2] as V3,
  humerus: ARM_RIGHT_HUMERUS_LENGTH,
  forearm: ARM_RIGHT_FOREARM_LENGTH,
  oldHand: [0.35, -0.40, -0.55] as V3,
  newHand: [CONFIG.SWORD_IDLE_POS[0], CONFIG.SWORD_IDLE_POS[1], CONFIG.SWORD_IDLE_POS[2]] as V3,
};
const LEFT = {
  name: 'LEFT (lamp)',
  shoulder: slotPos(ARM_LEFT, 'shoulder'),
  pole: [-1, -0.6, -0.3] as V3,
  humerus: ARM_LEFT_HUMERUS_LENGTH,
  forearm: ARM_LEFT_FOREARM_LENGTH,
  oldHand: [-0.36, -0.26, -0.78] as V3,   // pre-presence-pass LAMP_RAISED
  newHand: [-0.38, -0.13, -0.60] as V3,   // current LAMP_RAISED
};

// Joint sphere radii from content/arm.ts — "on screen" must account for the
// mesh, not just the joint's centre point.
const SHOULDER_R = 0.030;
const ELBOW_R = 0.028;

function solve(arm: typeof RIGHT, hand: V3, bobY: number) {
  const ik = new ArmIK({
    shoulderRest: arm.shoulder,
    shoulderSpringFreq: 1.8,
    shoulderSpringDamping: 1.0,
    shoulderHandBias: 0.10,
    humerusLength: arm.humerus,
    forearmLength: arm.forearm,
    elbowPole: arm.pole,
    jointDampHalfLife: 0.05,
  });
  let res!: ReturnType<ArmIK['solve']>;
  for (let i = 0; i < 200; i++) {           // settle the spring → steady state
    res = ik.solve({ x: hand[0], y: hand[1] + bobY, z: hand[2] }, 1 / 60);
  }
  return res;
}

/**
 * Clearance of a joint sphere from the nearest frame edge, in metres.
 * Negative = the sphere is intruding into frame.
 */
function clearance(p: { x: number; y: number; z: number }, r: number, fovDeg: number, aspect: number) {
  if (p.z > -0.001) return { edge: 'behind', margin: Infinity };
  const halfH = Math.abs(p.z) * Math.tan((fovDeg * Math.PI) / 360);
  const halfW = halfH * aspect;
  // Distance from the sphere's nearest edge to each frame boundary.
  const mBottom = -halfH - (p.y + r);      // >0 = below frame, clear
  const mSide = Math.abs(p.x) - r - halfW; // >0 = outside laterally, clear
  return mBottom >= mSide
    ? { edge: 'bottom', margin: mBottom }
    : { edge: 'side', margin: mSide };
}

const ASPECT = 844 / 390;                    // phone landscape — primary target
const FOV_REST = CONFIG.FOV;
const FOV_RUN = CONFIG.FOV + CONFIG.MOMENTUM.FOV_MAX_DEG;   // full momentum

console.log(`phone landscape ${ASPECT.toFixed(2)}:1 · FOV ${FOV_REST}° at rest → ${FOV_RUN}° at full momentum`);
console.log('margin > 0 = clear of frame; margin < 0 = INTRUDING\n');

// ── REACH UTILISATION ───────────────────────────────────────────────────────
// The check this probe DIDN'T have, and should have.
//
// The first version reported only frame clearance, so when the lamp-elbow fix
// dropped the LEFT shoulder 0.58 → 0.80 to get the elbow out of frame, the
// probe happily confirmed the clearance win and said nothing about the arm now
// being stretched past its own length. The game's own runtime warning caught it
// instead: "IK target at 106% of max reach — the arm is nearly locked straight."
//
// Clearance and reach pull in OPPOSITE directions — moving the shoulder away
// from the hand buys frame margin and spends reach — so a tool that measures
// one and not the other will cheerfully walk you off the other cliff.
console.log('── REACH UTILISATION (100% = arm locked straight) ──');
for (const arm of [RIGHT, LEFT]) {
  const max = arm.humerus + arm.forearm;
  const d = Math.hypot(
    arm.newHand[0] - arm.shoulder[0],
    arm.newHand[1] - arm.shoulder[1],
    arm.newHand[2] - arm.shoulder[2],
  );
  const pct = (d / max) * 100;
  const flag = pct > 100 ? '  ◀ OVER-EXTENDED' : pct > 92 ? '  ◀ tight' : '';
  console.log(
    `  ${arm.name.padEnd(16)} shoulder→hand ${d.toFixed(3)}m of ${max.toFixed(3)}m` +
    `  =  ${pct.toFixed(1)}%${flag}`,
  );
}
console.log('');

for (const arm of [RIGHT, LEFT]) {
  console.log(`── ${arm.name} ${'─'.repeat(46 - arm.name.length)}`);
  for (const [label, hand] of [['before v3', arm.oldHand], ['after  v3', arm.newHand]] as const) {
    for (const fov of [FOV_REST, FOV_RUN]) {
      // Worst case across the bob envelope = whichever phase lifts the joint most.
      let worst: { joint: string; margin: number; edge: string; p: any } | null = null;
      for (const bobY of [-0.035, 0, +0.035]) {
        const r = solve(arm, hand as V3, bobY);
        const joints: Array<[string, any, number]> = [
          ['elbow', r.elbowPos, ELBOW_R],
          ['shoulder', r.shoulderPos ?? { x: arm.shoulder[0], y: arm.shoulder[1], z: arm.shoulder[2] }, SHOULDER_R],
        ];
        for (const [jn, p, rad] of joints) {
          const c = clearance(p, rad, fov, ASPECT);
          if (!worst || c.margin < worst.margin) worst = { joint: jn, margin: c.margin, edge: c.edge, p };
        }
      }
      const w = worst!;
      const flag = w.margin < 0 ? '  ◀ INTRUDES' : w.margin < 0.05 ? '  ◀ marginal' : '';
      console.log(
        `  ${label}  FOV ${String(fov).padStart(2)}°   tightest: ${w.joint.padEnd(8)}` +
        ` at (${w.p.x.toFixed(3)}, ${w.p.y.toFixed(3)}, ${w.p.z.toFixed(3)})` +
        `  ${w.edge} margin ${w.margin >= 0 ? ' ' : ''}${w.margin.toFixed(3)}m${flag}`,
      );
    }
  }
  console.log('');
}

// ── REMEDY SWEEP ─────────────────────────────────────────────────────────────
// The elbow pole only decides WHERE ON THE CIRCLE the elbow sits around the
// shoulder→wrist axis. Pushing its -Y component drops the elbow without moving
// the hand, the lantern, or the arm's reach — the cheapest possible fix.
// The POLE turned out not to be the lever: dropping it lowers the elbow a
// little but also pushes it BACK, and the frustum widens with depth, so the
// margin gets worse. Sweep the shoulder anchor instead — it moves the whole
// arm without touching the hand, the lantern, or the arm's reach.
console.log('── LEFT shoulder-anchor sweep (full-momentum FOV, worst bob phase) ──');
console.log('   shoulder y   elbow (y, z)          bottom margin');
for (const shY of [-0.58, -0.64, -0.70, -0.76, -0.82, -0.88]) {
  const arm = { ...LEFT, shoulder: [LEFT.shoulder[0], shY, LEFT.shoulder[2]] as V3 };
  let worst: { margin: number; y: number; z: number } | null = null;
  for (const bobY of [-0.035, 0, +0.035]) {
    const r = solve(arm, arm.newHand, bobY);
    const c = clearance(r.elbowPos, ELBOW_R, FOV_RUN, ASPECT);
    if (!worst || c.margin < worst.margin) worst = { margin: c.margin, y: r.elbowPos.y, z: r.elbowPos.z };
  }
  // Read from the SPEC, not from a number typed here. This said "-0.58 ← current" for as long
  // as the spec said -0.80, which is the one thing a probe must never do: a tool that misreports
  // what is currently true launders a guess as a measurement.
  const cur = Math.abs(shY - LEFT.shoulder[1]) < 0.005 ? '   ← current' : '';
  console.log(
    `   ${shY.toFixed(2).padStart(6)}       (${worst!.y.toFixed(3)}, ${worst!.z.toFixed(3)})` +
    `       ${worst!.margin.toFixed(3)}m${cur}`,
  );
}
