// ── THE HAND THAT CARRIES THE LANTERN ────────────────────────────────────────
//
// Replaces player/lamp-arm.ts, which was a two-bone IK rig with a shoulder spring, an elbow
// pole vector, a reach alarm, a runtime wrist solver and a set of bone meshes — all of it in
// service of an arm that is no longer drawn. Josh: *"can we just throw away the arms premises
// and make the system just floating hands?"*
//
// What survives from that file is the part that was doing real work: the grip solve that closes
// the fingers on the lantern's bail, and the measured offset that puts the GRIP — not the wrist
// — where the pose says. Everything else is gone. See hand-rig.ts for the rig.
//
// ── WHERE THE LANTERN COMES FROM ────────────────────────────────────────────
//
// player/handheld-lamp.ts owns the lantern: its easing between carry and stow, its pendulum, its
// flame and its light. This module does not move it. Each frame it reads where the lamp put its
// ring anchor and springs the hand's grip point onto it, so the fingers stay hooked over the
// bail through the swing. The lamp leads; the hand follows.
//
// That is the same relationship the old rig had, minus the limb — and it is deliberately NOT the
// inversion (hand leads, lantern hangs from it), because the lamp's carry/stow easing and
// pendulum are tuned and felt, and rebuilding them on the other side of the join would be a
// second change wearing the first one's clothes.

import * as THREE from 'three';
import { buildModel, type BuiltModel } from '../ecs/build-model';
import { HAND_LEFT_LANTERN, RING_FOREARM_EXIT_DESIRED } from '../content/hand-poses';
import { getLampRingAnchorWorldPosition } from './handheld-lamp';
import { registerViewmodel, applyViewmodelDepthWebGPU } from '../style/render-frame';
import { mergeRigidViewmodel } from './viewmodel-merge';
import { boneArmsWanted, buildBoneHand, onBoneHandLoaded } from '../debug/bone-hand';
import { bailBarRadius } from '../debug/bone-lantern';
import { solveGrip } from '../anim/grip-solver';
import { HOOK_GRIP } from '../content/grip-pose';
import { HandRig, type HandRest } from './hand-rig';

/**
 * How the lamp hand is held, said as anatomy.
 *
 * Authored as DIRECTIONS rather than as the roll number that won a comparison sheet, because
 * `aimHand` orthogonalises the palm against the fingers — so "palm this way" survives a later
 * change to where the fingers point, and a baked-in roll would not.
 *
 * Exported for scripts/aim-check.ts, which imports the real constants rather than restating
 * them: a report that re-declares the numbers it checks launders a guess as a measurement.
 */
// STRAIGHT OUT FROM THE CAMERA, PALM DOWN, FINGERS CURLING ONTO THE BAIL.
//
// Which is what Josh asked for at the start and has never once been rendered. The first attempt
// authored exactly this and came out wrong — `upTo` aims a model's local +Z, and HAND_LEFT is a
// mirrored spec whose +Z is the PALM, so the line meaning "back of the hand up" pointed the palm
// at the ceiling. Fixing that bug and changing the target to "across the frame" happened in the
// same commit, on my judgement that fingers-forward would read as a foreshortened stump. That
// judgement was not mine to make against a stated instruction, and it cost four rounds of
// sweeping orientations he had not asked for.
//
// So: fingers down the view axis with a little droop, palm at the floor. A hand held out in
// front of you carrying a lamp.
export const LAMP_FINGERS_TO = new THREE.Vector3(0, -0.15, -1);
export const LAMP_PALM_TO = new THREE.Vector3(0, -1, 0);

/**
 * The rest pose. `pos` is where the hand's GRIP sits when the lamp has nothing to say — it is
 * overridden every frame by the lamp's live ring anchor, and exists so the first frame has
 * somewhere sensible to be.
 */
const LAMP_REST: HandRest = {
  pos: new THREE.Vector3(-0.38, -0.09, -0.54),
  fingersTo: LAMP_FINGERS_TO,
  palmTo: LAMP_PALM_TO,
};

/**
 * Spring: firm and critically damped.
 *
 * The lamp does its OWN easing and pendulum, so a soft hand here would read as rubber — two
 * lags in series on one object. This spring exists only to take the edge off a hard cut (a
 * stow, a descent), not to add weight the lantern already has.
 */
const FREQ = 8;

let rig: HandRig | null = null;
let camera: THREE.Camera | null = null;
const _ring = new THREE.Vector3();
const _ringLocal = new THREE.Vector3();

/** Build the hand and mount it under the camera. */
export function attachLampHand(cam: THREE.Camera): void {
  if (rig) return;
  camera = cam;
  rig = new HandRig(cam, 'lamp-hand', FREQ);
  registerViewmodel(rig.anchor);
  install();
  // The scanned hand arrives asynchronously and this function never runs again, so the swap has
  // to ride the load hook or the flag silently does nothing here.
  if (import.meta.env.DEV && boneArmsWanted()) onBoneHandLoaded(install);
}

function install(): void {
  if (!rig) return;
  const bone = import.meta.env.DEV && boneArmsWanted() ? buildBoneHand('left', HAND_LEFT_LANTERN) : null;
  const hand: BuiltModel = bone ?? buildModel(HAND_LEFT_LANTERN);
  rig.setHand(hand, LAMP_REST);

  // ── THE FINGERS CLOSE ON THE BAIL BAR ─────────────────────────────────────
  //
  // A hook, not a fist: two fingers take the weight and the rest hang with authored slack, over
  // a 9.6mm bail against a sword's 22mm hilt. The lantern is originned ON that bar, so the point
  // the hand grips and the point the lantern hangs from are the same point — nothing to
  // reconcile, and the grip centre the solver returns is exactly where the lamp's ring anchor
  // belongs. See content/grip-pose.ts for the shape and anim/grip-solver.ts for the solve.
  const solved = bone
    ? solveGrip(hand, {
      style: 'saber',
      radius: bailBarRadius(),
      offset: [0, 0, 0],
      roll: 0,
      thumb: 'wrap',
      forearmExit: RING_FOREARM_EXIT_DESIRED,
    }, HOOK_GRIP)
    : null;
  rig.setGrip(solved?.center.clone() ?? hand.slots.get('palm_anchor')?.position.clone() ?? null);

  // ONE MESH, and the viewmodel's own depth rules. The hand is rigid — nothing below the
  // wrist moves once the grip has closed — so it collapses to a single draw. Slots survive the
  // merge, which is what the grip centre and the aim readout are measured from.
  mergeRigidViewmodel(hand.group, null);
  hand.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      m.depthTest = true;
      m.depthWrite = false;
      m.transparent = false;
      m.needsUpdate = true;
      applyViewmodelDepthWebGPU(m);   // WebGPU: write own depth (no pre-pass)
    }
    mesh.renderOrder = 998;
  });

  if (import.meta.env.DEV) {
    // WHICH HAND, by part count — 6 = the authored one, 27 = the scanned bone hand. Without it
    // the two are indistinguishable in the log, and a whole session once went by fixing one
    // while looking at the other.
    // eslint-disable-next-line no-console
    console.log(`[lamp-hand] ${hand.parts.size}p ${bone ? '(bone)' : '(authored)'}`
      + (solved ? ` · bail grip r=${(solved.radius * 1000).toFixed(1)}mm curl=${solved.curl.toFixed(2)}` : ''));
    reportAim(hand);
  }
}

export function tickLampHand(dt: number): void {
  if (!rig) return;
  // Where the lamp put its bail this frame. The lamp ticks first (see engine/systems.ts), so
  // this is current, not a frame stale.
  const ring = getLampRingAnchorWorldPosition(_ring);
  if (ring && camera) {
    camera.updateMatrixWorld(true);
    _ringLocal.copy(ring).applyMatrix4(new THREE.Matrix4().copy(camera.matrixWorld).invert());
    rig.tick(dt, _ringLocal);
    if (import.meta.env.DEV) checkGrip();
  } else {
    rig.tick(dt);
  }
}

// ── THE POSE, MEASURED IN THE GAME ───────────────────────────────────────────
//
// Josh: *"last time we positioned in the bench the real position was different ... so it might
// be your thing is right but its wrong."* scripts/aim-check.ts proves the solve standalone, but
// it uses the AUTHORED hand where the game may run the scanned one and assumes a parent rotation
// it never checks. So the same numbers are read back off the LIVE hand in the LIVE camera's
// frame at each build. If these disagree with the script, the script is what is wrong.
let aimed = false;
function reportAim(hand: BuiltModel): void {
  if (!import.meta.env.DEV || aimed || !camera || !rig) return;
  aimed = true;
  const wrist = hand.slots.get('wrist');
  const palm = hand.slots.get('palm_anchor');
  if (!wrist || !palm) return;
  camera.updateMatrixWorld(true);
  rig.anchor.updateWorldMatrix(true, true);
  const toCam = new THREE.Matrix4().copy(camera.matrixWorld).invert();
  const at = (o: THREE.Object3D): THREE.Vector3 =>
    new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(toCam);
  const K = new THREE.Vector3();
  let n = 0;
  for (const name of ['finger_index', 'finger_middle', 'finger_ring', 'finger_pinky']) {
    const slot = hand.slots.get(name);
    if (!slot) continue;
    K.add(at(slot));
    n++;
  }
  if (!n) return;
  K.divideScalar(n);
  const F = K.clone().sub(at(wrist)).normalize();
  const N = at(palm).sub(K);
  N.addScaledVector(F, -N.dot(F)).normalize();
  const want = LAMP_FINGERS_TO.clone().normalize();
  const d = (v: THREE.Vector3): string => v.toArray().map((x) => x.toFixed(2)).join(',');
  // eslint-disable-next-line no-console
  console.log(`[lamp-hand] AIM camera-space fingers=[${d(F)}] palm=[${d(N)}] · asked=[${d(want)}]`
    + ` · error=${((Math.acos(Math.min(1, F.dot(want))) * 180) / Math.PI).toFixed(1)}deg · knuckles=${n}/4`);
}

// One-shot: did the grip actually land on the bail? The rig places the anchor BEHIND the target
// by the grip offset, so these two should agree to the millimetre. They are logged rather than
// assumed because "the maths is exact" has been true and the hand wrong in the same breath.
let gripChecked = 0;
function checkGrip(): void {
  if (!rig || !camera || gripChecked > 40) return;
  gripChecked++;
  if (gripChecked !== 40) return;
  const got = rig.getGripWorld(new THREE.Vector3())
    .applyMatrix4(new THREE.Matrix4().copy(camera.matrixWorld).invert());
  const d = (v: THREE.Vector3): string => v.toArray().map((x) => x.toFixed(3)).join(',');
  // eslint-disable-next-line no-console
  console.log(`[lamp-hand] GRIP target=[${d(_ringLocal)}] got=[${d(got)}] `
    + `miss=${(got.distanceTo(_ringLocal) * 1000).toFixed(0)}mm`);
}
