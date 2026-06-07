import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import {
  ARM_LEFT, ARM_LEFT_HUMERUS_LENGTH, ARM_LEFT_FOREARM_LENGTH,
} from '../content/arm';
import { ArmIK } from '../anim/arm-ik';
import { registerViewmodel } from '../style/render-target';
import { getLampHingeWorldPosition } from './handheld-lamp';

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

const _wristWorld    = new THREE.Vector3();
const _wristArmLocal = new THREE.Vector3();
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
      // biases −X for the same "elbow flares outboard" read.
      elbowPole: [-1, -0.5, 0.2],
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

/** Solve the left arm so the wrist sits at the lantern's hinge.
 *  Called each frame from the engine systems loop. */
export function tickLampArm(dt: number): void {
  if (!armIK || !armGroup || !shoulderSlot || dt <= 0) return;
  const target = getLampHingeWorldPosition(_wristWorld);
  if (!target) return;
  armGroup.worldToLocal(_wristArmLocal.copy(target));
  const r = armIK.solve(_wristArmLocal, dt);
  poseBone(humerusMesh, r.shoulderPos, r.elbowPos);
  poseBone(radiusMesh,  r.elbowPos, r.wristPos, -0.013);
  poseBone(ulnaMesh,    r.elbowPos, r.wristPos,  0.013);
  poseBone(sinewMesh,   r.elbowPos, r.wristPos);
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
