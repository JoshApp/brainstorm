/**
 * Where does the lamp hand actually END UP?
 *
 * Three guesses at this rotation have now been wrong, each of them plausible in the source and
 * each only falsifiable by squinting at a 40-pixel hand in a screenshot. So it is measured
 * instead: build the arm and the hand exactly as lamp-arm.ts does, run the real `aimHand`, and
 * report the hand's finger direction and palm normal IN CAMERA SPACE — the frame the player's
 * eye is in and the only one the answer is right or wrong in.
 *
 *   npx tsx scripts/aim-check.ts
 */
import * as THREE from 'three';
import { buildModel } from '../src/ecs/build-model';
import { ARM_LEFT } from '../src/content/arm';
import { HAND_LEFT_LANTERN } from '../src/content/hand-poses';
import { aimHand } from '../src/player/floating-hands';
// The REAL constants, imported rather than restated — a report that re-declares the numbers
// it is checking launders a guess as a measurement (docs/DESIGN-METHOD.md).
import { LAMP_FINGERS_TO, LAMP_PALM_TO } from '../src/player/lamp-hand';

const r = (v: THREE.Vector3): string =>
  `[${v.toArray().map((n) => n.toFixed(3)).join(', ')}]`;

const camera = new THREE.PerspectiveCamera();
const arm = buildModel(ARM_LEFT);
camera.add(arm.group);

const anchor = new THREE.Group();
arm.group.add(anchor);

const hand = buildModel(HAND_LEFT_LANTERN);
anchor.add(hand.group);
camera.updateMatrixWorld(true);

console.log('arm group quaternion', r(new THREE.Vector3(
  arm.group.quaternion.x, arm.group.quaternion.y, arm.group.quaternion.z,
)), 'w', arm.group.quaternion.w.toFixed(3));
console.log('hand root quaternion', r(new THREE.Vector3(
  hand.group.quaternion.x, hand.group.quaternion.y, hand.group.quaternion.z,
)), 'w', hand.group.quaternion.w.toFixed(3));

const FINGERS_TO = LAMP_FINGERS_TO;
const PALM_TO = LAMP_PALM_TO;
const q = aimHand(hand, anchor, FINGERS_TO, PALM_TO);
if (!q) throw new Error('aimHand returned null — the hand is missing landmarks');
anchor.quaternion.copy(q);
camera.updateMatrixWorld(true);

/** The hand's own frame, read back off the posed model in CAMERA space. */
const toCam = new THREE.Matrix4().copy(camera.matrixWorld).invert();
const at = (name: string): THREE.Vector3 => {
  const slot = hand.slots.get(name);
  if (!slot) throw new Error(`no slot ${name}`);
  return new THREE.Vector3().setFromMatrixPosition(slot.matrixWorld).applyMatrix4(toCam);
};
const W = at('wrist');
const K = new THREE.Vector3();
for (const n of ['finger_index', 'finger_middle', 'finger_ring', 'finger_pinky']) K.add(at(n));
K.divideScalar(4);
const P = at('palm_anchor');

const F = K.clone().sub(W).normalize();
const N = P.clone().sub(K);
N.addScaledVector(F, -N.dot(F)).normalize();

console.log('');
console.log('asked  fingers ->', r(FINGERS_TO.clone().normalize()), ' palm ->', r(PALM_TO));
console.log('got    fingers ->', r(F), ' palm ->', r(N));
console.log('');
const wantF = FINGERS_TO.clone().normalize();
const wantN = PALM_TO.clone();
wantN.addScaledVector(wantF, -wantN.dot(wantF)).normalize();
console.log('finger error', (Math.acos(Math.min(1, F.dot(wantF))) * 180 / Math.PI).toFixed(2), 'deg');
console.log('palm   error', (Math.acos(Math.min(1, N.dot(wantN))) * 180 / Math.PI).toFixed(2), 'deg');
