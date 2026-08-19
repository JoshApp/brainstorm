import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import {
  ARM_LEFT, ARM_LEFT_HUMERUS_LENGTH, ARM_LEFT_FOREARM_LENGTH,
} from '../content/arm';
import { HAND_LEFT_LANTERN, RING_FOREARM_EXIT_DESIRED } from '../content/hand-poses';
import { boneArmsWanted, buildBoneHand, buildBoneArmParts, onBoneHandLoaded }
  from '../debug/bone-hand';
import { bailBarRadius } from '../debug/bone-lantern';
import { solveGrip } from '../anim/grip-solver';
import type { BuiltModel } from '../ecs/build-model';
import { disposeGpuTree } from '../scene/gpu-dispose';
import { WristAim } from '../anim/wrist-solver';
import { DEV } from '../debug/dev';
import { ArmIK } from '../anim/arm-ik';
import { registerViewmodel, applyViewmodelDepthWebGPU } from '../style/render-frame';
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
  // ── THE BONE LEFT HAND, WHEN THE TRIAL IS ON ────────────────────────
  //
  // DEV-only and flag-gated. It wears HAND_LEFT_LANTERN's POSE — the authored ring-carry, fingers
  // hooked down through the O-ring — rather than the grip solver's fist: this hand holds a
  // lantern by a wire loop, which is a different thing from closing on a hilt. The pose is data
  // either way, so the bone hand simply reads the same rows.
  //
  // It arrives from a file, and attachLampArm runs once at boot and early-returns forever after
  // — so installing the hand is a function, called now with whatever is available and again if
  // the bone hand turns up later. Without that the flag would be on and this arm would keep the
  // authored hand for the whole run.
  // Captured so the closure keeps the non-null narrowing these module refs have right here.
  const anchor = wristAnchor;
  const arm = armGroup;
  let gripCentre: THREE.Vector3 | null = null;
  let hand!: BuiltModel;
  const installHand = (): void => {
    const bone = import.meta.env.DEV && boneArmsWanted()
      ? buildBoneHand('left', HAND_LEFT_LANTERN)
      : null;
    const next = bone ?? buildModel(HAND_LEFT_LANTERN);
    if (hand) {
      hand.group.removeFromParent();
      disposeGpuTree(hand.group);
    }
    hand = next;
    anchor.add(hand.group);
    // Map the pose's anatomy target (wrist frame) into the frame the
    // solver rotates (the wristAnchor = hand root's parent-of-record).
    const lanternWrist = hand.slots.get('wrist');
    if (lanternWrist) {
      wristAim.setDesiredFromWristFrame(RING_FOREARM_EXIT_DESIRED, lanternWrist.quaternion);
    }

    // ── THE LAMP HAND CLOSES ON THE BAIL BAR ────────────────────────
    //
    // Josh: "can you make the grip nicer for the lamp." The authored ring-carry pose was tuned
    // for the old torus — a 20mm ring in a fixed place — so against the scanned lantern's bail
    // the fingers sat beside the handle rather than over it.
    //
    // The same solver the weapon hand uses, on a much thinner cylinder: 9.6mm of bail bar
    // against a sword's 22mm hilt, so the fist closes far harder. The model is originned on that
    // bar, so the point the hand grips and the point the lantern hangs from are the same point
    // and there is nothing to reconcile.
    const solved = bone
      ? solveGrip(hand, {
        style: 'saber',
        radius: bailBarRadius(),
        offset: [0, 0, 0],
        roll: 0,
        thumb: 'wrap',
        forearmExit: RING_FOREARM_EXIT_DESIRED,
      })
      : null;
    gripCentre = solved?.center.clone() ?? null;
    if (import.meta.env.DEV && solved) {
      // eslint-disable-next-line no-console
      console.log(`[lamp-arm] bail grip centre=[${solved.center.toArray()
        .map((v) => v.toFixed(3)).join(',')}] r=${(solved.radius * 1000).toFixed(1)}mm `
        + `curl=${solved.curl.toFixed(2)}`);
    }

    finishHand();
    if (import.meta.env.DEV) {
      // Which hand, by part count — the same label the right hand carries. Two hands that are
      // indistinguishable in the log is how a whole session went by fixing one while looking at
      // the other.
      // eslint-disable-next-line no-console
      console.log(`[lamp-arm] left hand=${hand.parts.size}p${bone ? ' (bone)' : ' (authored)'}`);
    }
  };
  function finishHand(): void {
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
      applyViewmodelDepthWebGPU(m);   // WebGPU: write own depth (no pre-pass)
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
  // Where the hand actually holds the lantern. With a solved grip that is the bail bar, not
  // palm_anchor — pinning the anchor instead slides the hand off by the offset between them
  // every frame, which is exactly what it did to the weapon hand.
  // WORLD MATRICES FIRST. `localToWorld` reads matrixWorld as it stands and does NOT refresh it,
  // unlike getWorldPosition which quietly updates itself — so computing the hold point before
  // this line used the hand's matrix from before it was parented, and the offset came out wildly
  // wrong. The IK then aimed the wrist to compensate and put the hand in the camera's face.
  arm.updateMatrixWorld(true);
  const holdPoint = gripCentre
    ? hand.group.localToWorld(gripCentre.clone())
    : hand.slots.get('palm_anchor')?.getWorldPosition(new THREE.Vector3()) ?? null;
  if (holdPoint) {
    // MEASURED RELATIVE TO THE WRIST ANCHOR, not to the arm group.
    //
    // These are the same thing only while the anchor still sits at the arm's origin, which was
    // true when this ran once at build time. It runs again now when the bone hand lands, by
    // which point tickLampArm has moved the anchor out to the IK wrist — so measuring in arm
    // space folded that whole displacement into the offset: 743mm instead of 93mm, and the IK
    // dutifully drove the hand into the camera to satisfy it.
    //
    // The offset from the anchor to the held point is what the solver actually wants, and taken
    // in the anchor's own frame it does not care when it is measured.
    _palmOffsetInArm.copy(holdPoint);
    anchor.worldToLocal(_palmOffsetInArm);
    if (import.meta.env.DEV) {
      // The offset from the IK wrist target to the point the hand holds. A hand's wrist and its
      // grip are a few centimetres apart; anything larger means the measurement was taken in the
      // wrong frame, and the IK will compensate by putting the hand somewhere absurd.
      // eslint-disable-next-line no-console
      console.log(`[lamp-arm] hold offset ${(_palmOffsetInArm.length() * 1000).toFixed(0)}mm`,
        gripCentre ? '(bail grip)' : '(palm anchor)');
    }
    // _palmOffsetInArm is now palm_anchor's position in arm-group-
    // local with wristAnchor at the arm-group origin — i.e. exactly
    // the offset from wristAnchor to palm_anchor.
  }
  }

  // ── AND THE LEFT ARM'S OWN BONES ──────────────────────────────────
  //
  // The same swap the right arm gets in viewmodel.ts: the RIG is untouched — shoulder rest, IK
  // lengths, elbow bias, every tuned number — and only the three bone meshes are replaced,
  // because poseBone places them from the IK's endpoints and never cared what they looked like.
  // There is no reason for one arm of one skeleton to be bone and the other primitives.
  const installArm = (): void => {
    const bones = buildBoneArmParts('left');
    if (!bones) return;
    const swapBone = (
      old: THREE.Mesh | undefined, name: string,
    ): THREE.Mesh | undefined => {
      const next = bones.get(name);
      if (!next) return old;
      old?.removeFromParent();
      arm.add(next);
      return next;
    };
    humerusMesh = swapBone(humerusMesh, 'humerus');
    radiusMesh = swapBone(radiusMesh, 'radius');
    ulnaMesh = swapBone(ulnaMesh, 'ulna');
    // The sinew stands in for soft tissue between the forearm bones; on a skeleton it reads as a
    // third bone, so it goes — same call as the right arm.
    sinewMesh?.removeFromParent();
    sinewMesh = undefined;
      // The arm spec also builds SPHERES at the shoulder and elbow — filler that covered the
      // seams between primitive bones. A scanned humerus has its own joint ends, so they read as
      // a ball stuck to the skeleton; raising the shoulder brought the elbow one into frame,
      // which is what Josh spotted. They are unnamed parts, so they are found structurally: the
      // mesh children of the joint slots.
      for (const slotName of ['shoulder', 'elbow']) {
        const slot = armBuilt?.slots.get(slotName);
        if (!slot) continue;
        for (const c of [...slot.children]) {
          if ((c as THREE.Mesh).isMesh) { c.removeFromParent(); disposeGpuTree(c); }
        }
      }
    // eslint-disable-next-line no-console
    console.log('[lamp-arm] left arm bones swapped');
  };

  installHand();
  if (import.meta.env.DEV && boneArmsWanted()) onBoneHandLoaded(installArm);
  // The bone hand arrives asynchronously and this function never runs again, so the swap has to
  // ride the load hook or the flag silently does nothing here.
  if (import.meta.env.DEV && boneArmsWanted()) onBoneHandLoaded(installHand);

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
      applyViewmodelDepthWebGPU(m);   // WebGPU: write own depth (no pre-pass)
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
