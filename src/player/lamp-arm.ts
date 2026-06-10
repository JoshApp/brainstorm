import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import {
  ARM_LEFT, ARM_LEFT_HUMERUS_LENGTH, ARM_LEFT_FOREARM_LENGTH,
} from '../content/arm';
import { HAND_LEFT_LANTERN, RING_FOREARM_EXIT_DESIRED } from '../content/hand-poses';
import { WristAim } from '../anim/wrist-solver';
import { DEV } from '../debug/dev';
import { ArmIK } from '../anim/arm-ik';
import { registerViewmodel } from '../style/render-target';
import { mergeRigidViewmodel } from './viewmodel-merge';
import { getLampRingAnchorWorldPosition } from './handheld-lamp';

// Left arm holding the lantern.
//
// Mirror of the right-arm setup in src/player/viewmodel.ts, but the
// wrist target is the lantern's HINGE WORLD POSITION (= the O-ring
// centre on the lantern body, where the fist closes around it).
//
// Independent of the held weapon — this arm doesn't read or write
// anything in the viewmodel module; it just builds its own ARM_LEFT
// rig under the camera, runs a separate ArmIK instance each frame,
// and positions its bone meshes from the IK's positional output (the
// same "bypass joint-rotation cascade" trick the right arm uses).

let armBuilt: ReturnType<typeof buildModel> | null = null;
let armGroup: THREE.Group | null = null;
let shoulderSlot: THREE.Object3D | null = null;
let armIK: ArmIK | null = null;
let humerusMesh: THREE.Mesh | undefined;
let radiusMesh: THREE.Mesh | undefined;
let ulnaMesh: THREE.Mesh | undefined;
let sinewMesh: THREE.Mesh | undefined;
let wristAnchor: THREE.Group | null = null;
// The constant offset from the wrist (= IK target) to the hand's
// palm_anchor, in arm-group-local space. Computed once at attach
// time by querying the built hand's palm_anchor slot relative to the
// wristAnchor. Used each frame so the IK wrist target = ring_anchor -
// palm_offset; the palm then lands ON the ring instead of the wrist.
const _palmOffsetInArm = new THREE.Vector3();

const _wristWorld    = new THREE.Vector3();
const _wristArmLocal = new THREE.Vector3();
// Runtime wrist solver — re-aims the hand each frame so the forearm
// exits the ring-carry wrist anatomically, wherever the IK elbow
// actually is (lamp pendulum swing, stow ease, walk bob). Replaces a
// baked orientation that could only be right for one elbow position.
const wristAim = new WristAim({ desiredExitLocal: RING_FOREARM_EXIT_DESIRED, dampHalfLife: 0.06 });
const _identityQuat = new THREE.Quaternion();
const _palmOffsetLive = new THREE.Vector3();
const _prevElbow = new THREE.Vector3();
const _prevWrist = new THREE.Vector3();
let havePrev = false;
let reachChecked = false;
const _midpoint      = new THREE.Vector3();
const _direction     = new THREE.Vector3();
const _yAxis         = new THREE.Vector3(0, 1, 0);

export function attachLampArm(camera: THREE.Camera): void {
  if (armBuilt) return;
  armBuilt = buildModel(ARM_LEFT);
  armGroup = armBuilt.group;
  camera.add(armGroup);
  registerViewmodel(armGroup);

  shoulderSlot = armBuilt.slots.get('shoulder') ?? null;
  if (shoulderSlot) {
    armIK = new ArmIK({
      shoulderRest: [
        shoulderSlot.position.x,
        shoulderSlot.position.y,
        shoulderSlot.position.z,
      ],
      shoulderSpringFreq: 1.8,
      shoulderSpringDamping: 1.0,
      shoulderHandBias: 0.10,
      humerusLength: ARM_LEFT_HUMERUS_LENGTH,
      forearmLength: ARM_LEFT_FOREARM_LENGTH,
      // Mirrored: the right arm biases +X for outboard; the left arm
      // biases −X for the same "elbow flares outboard" read. The Z
      // component biases AWAY from the camera (−Z): with the forward
      // ring-carry grip the wrist target sits closer to the camera,
      // and a camera-ward (+Z) pole swung the forearm across the
      // near-frustum — a giant lamp-lit slab over the whole bottom of
      // the frame. Elbow behind-below-outboard = arm enters from the
      // lower-left edge like a real arm.
      elbowPole: [-1, -0.6, -0.3],
      jointDampHalfLife: 0.05,
    });
  }

  // Cache bone meshes — same direct-positioning approach as the right
  // arm. Reparent to the arm group root so we can write arm-local
  // positions directly each frame.
  humerusMesh = armBuilt.parts.get('humerus') as THREE.Mesh | undefined;
  radiusMesh  = armBuilt.parts.get('radius')  as THREE.Mesh | undefined;
  ulnaMesh    = armBuilt.parts.get('ulna')    as THREE.Mesh | undefined;
  sinewMesh   = armBuilt.parts.get('sinew')   as THREE.Mesh | undefined;
  for (const m of [humerusMesh, radiusMesh, ulnaMesh, sinewMesh]) {
    if (m) armGroup.add(m);
  }

  // Attach the actual hand spec to a wrist anchor — its position is
  // updated each frame from the IK's wrist output, so the hand
  // follows the lantern hinge as it swings. (The arm spec's wrist
  // slot is at a STATIC elbow-local offset; can't use it for this.)
  wristAnchor = new THREE.Group();
  armGroup.add(wristAnchor);
  // The LEFT hand in its RING-CARRY pose (hand-poses.ts): mirrored
  // geometry + a grip authored FOR the lantern — fingers hooked down
  // through the O-ring, thumb at rest, wrist near neutral. Replaces
  // the old stopgap of mounting the RIGHT hand's saber grip here
  // (a raw mirror of the saber pose read as "bent outward").
  const hand = buildModel(HAND_LEFT_LANTERN);
  wristAnchor.add(hand.group);
  // Map the pose's anatomy target (wrist frame) into the frame the
  // solver rotates (the wristAnchor = hand root's parent-of-record).
  const lanternWrist = hand.slots.get('wrist');
  if (lanternWrist) wristAim.setDesiredFromWristFrame(RING_FOREARM_EXIT_DESIRED, lanternWrist.quaternion);
  // The lantern hand is rigid (it just grips the ring); collapse its ~39 bone
  // meshes into one. Slots (palm_anchor, read below for the offset) survive.
  mergeRigidViewmodel(hand.group, null);
  // Same viewmodel render settings as the arm bones so the hand
  // depth-tests right against the lantern + the other arm.
  hand.group.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.depthTest = true;
      m.depthWrite = false;
      m.transparent = false;
      m.needsUpdate = true;
    }
    mesh.renderOrder = 998;
  });

  // Compute palm_anchor's offset from the wristAnchor (= the IK
  // wrist target) so we can subtract it from the ring anchor each
  // frame and put the PALM at the ring instead of the wrist.
  //
  // The chain: wristAnchor → hand.group (identity) → wrist slot (with
  // NEW_WRIST_ROT) → palm_anchor (offset (0, 0.092, -0.011) in wrist-
  // local). The composed offset in arm-group-local depends on
  // NEW_WRIST_ROT, but it's CONSTANT (doesn't change at runtime), so
  // we just measure it once via Three's matrix utilities.
  const palmAnchorSlot = hand.slots.get('palm_anchor');
  if (palmAnchorSlot) {
    armGroup.updateMatrixWorld(true);
    palmAnchorSlot.getWorldPosition(_palmOffsetInArm);
    armGroup.worldToLocal(_palmOffsetInArm);
    // _palmOffsetInArm is now palm_anchor's position in arm-group-
    // local with wristAnchor at the arm-group origin — i.e. exactly
    // the offset from wristAnchor to palm_anchor.
  }

  // Viewmodel render settings — match the rest of the viewmodel
  // layer (depth-test enabled, depth-write off, opaque) so the arm
  // depth-tests correctly against the lantern and the right arm.
  armGroup.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.depthTest = true;
      m.depthWrite = false;
      m.transparent = false;
      m.needsUpdate = true;
    }
    mesh.renderOrder = 997;
  });
}

/** Solve the left arm so the HAND'S PALM (not its wrist) sits at the
 *  lantern's ring anchor. Called each frame from the engine systems
 *  loop. */
export function tickLampArm(dt: number): void {
  if (!armIK || !armGroup || !shoulderSlot || dt <= 0) return;
  const target = getLampRingAnchorWorldPosition(_wristWorld);
  if (!target) return;
  // Convert the ring world position to arm-group-local, then SUBTRACT
  // the precomputed palm offset. The IK targets the wrist at this
  // shifted position; the hand's palm_anchor (still offset by the
  // same vector) then lands EXACTLY at the ring.
  armGroup.worldToLocal(_wristArmLocal.copy(_wristWorld));
  // Re-aim the hand at the live forearm (previous frame's IK joints —
  // the solve below needs the target, which needs the hand's
  // orientation; one frame of damped lag is invisible). The palm
  // offset rotates with the hand, so the IK target keeps landing the
  // PALM on the ring whatever the wrist orientation is.
  if (havePrev && wristAnchor) {
    wristAnchor.quaternion.copy(wristAim.solve(_identityQuat, _prevElbow, _prevWrist, dt));
  }
  _palmOffsetLive.copy(_palmOffsetInArm);
  if (wristAnchor) _palmOffsetLive.applyQuaternion(wristAnchor.quaternion);
  _wristArmLocal.sub(_palmOffsetLive);
  const r = armIK.solve(_wristArmLocal, dt);
  _prevElbow.copy(r.elbowPos);
  _prevWrist.copy(r.wristPos);
  havePrev = true;
  if (DEV && !reachChecked) {
    reachChecked = true;
    // Coupled-constants drift alarm: if the lamp or the shoulder move
    // apart again, say so the first frame instead of weeks later.
    const reach = ARM_LEFT_HUMERUS_LENGTH + ARM_LEFT_FOREARM_LENGTH;
    const need = _wristArmLocal.distanceTo(shoulderSlot!.position);
    if (need > reach * 0.92) {
      console.warn(
        `[lamp-arm] IK target at ${(100 * need / reach).toFixed(0)}% of max reach ` +
        `(${need.toFixed(3)}m of ${reach.toFixed(3)}m) — the arm is nearly locked straight. ` +
        `LAMP_RAISED and the ARM_LEFT shoulder have probably drifted apart (arm.ts).`,
      );
    }
  }
  poseBone(humerusMesh, r.shoulderPos, r.elbowPos);
  poseBone(radiusMesh,  r.elbowPos, r.wristPos, -0.013);
  poseBone(ulnaMesh,    r.elbowPos, r.wristPos,  0.013);
  poseBone(sinewMesh,   r.elbowPos, r.wristPos);
  // Pin the hand at the IK wrist position (arm-local).
  if (wristAnchor) wristAnchor.position.copy(r.wristPos);
}

/** Position a bone mesh to span two arm-local endpoints — same
 *  helper signature as the right arm's poseBone in viewmodel.ts. */
function poseBone(
  mesh: THREE.Mesh | undefined,
  from: THREE.Vector3,
  to: THREE.Vector3,
  lateral = 0,
): void {
  if (!mesh) return;
  _midpoint.addVectors(from, to).multiplyScalar(0.5);
  _direction.subVectors(to, from);
  const len = _direction.length();
  if (len < 1e-6) return;
  _direction.divideScalar(len);
  mesh.position.copy(_midpoint);
  if (lateral !== 0) mesh.position.x += lateral;
  mesh.quaternion.setFromUnitVectors(_yAxis, _direction);
}
