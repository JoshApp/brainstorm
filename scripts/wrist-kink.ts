// Measures the right hand's wrist↔forearm KINK at the idle pose, and
// decomposes it into ulnar/radial deviation + flexion/extension in
// hand-local terms. The FOREARM_EXIT_MEASURED constant in
// src/content/hand.ts came from this script — re-run it (npx tsx
// scripts/wrist-kink.ts) and update that constant whenever
// SWORD_IDLE_ROT / SWORD_IDLE_POS / the right shoulder / elbow pole
// move meaningfully. Mirrors the stacked-rotation derivation from
// hand.ts on purpose: it reports on the PRE-correction pose.
import * as THREE from 'three';
import { rotateLocally } from '../src/anim/orient';

// Reproduce the current NEW_WRIST_ROT stack from hand.ts
const WRIST_PITCH_FORWARD = -0.10;
const WRIST_PLANE_INTO_SCREEN = -0.15;
const WRIST_PINKY_TO_GROUND_20 = (20 * Math.PI) / 180;
const WRIST_ROLL_BLUE_CW_30 = -(30 * Math.PI) / 180;
const WRIST_TILT_GREEN_CW_30 = (30 * Math.PI) / 180;
const BASE: [number, number, number] = [
  WRIST_PITCH_FORWARD + WRIST_PLANE_INTO_SCREEN,
  WRIST_PINKY_TO_GROUND_20,
  0,
];
const AFTER_BLUE = rotateLocally(BASE, 'z', WRIST_ROLL_BLUE_CW_30);
const AFTER_GREEN = rotateLocally(AFTER_BLUE, 'y', WRIST_TILT_GREEN_CW_30);
const NEW_WRIST_ROT = rotateLocally(AFTER_GREEN, 'z', -(15 * Math.PI) / 180);

const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...NEW_WRIST_ROT, 'XYZ'));
const Y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
const Z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
const X = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
console.log('NEW_WRIST_ROT euler:', NEW_WRIST_ROT.map((v) => v.toFixed(4)).join(', '));
console.log('hand +Y (fingers/sword):', Y.toArray().map((v) => v.toFixed(3)).join(', '));
console.log('hand +Z (back of hand):', Z.toArray().map((v) => v.toFixed(3)).join(', '));
console.log('hand +X (outboard/pinky? no: +X outboard):', X.toArray().map((v) => v.toFixed(3)).join(', '));

// Approximate forearm continuation: shoulder (0.05,-0.55,-0.10),
// idle wrist ≈ sword idle pos. Print the angle between hand -Y and
// the wrist→elbow direction for a few plausible elbow estimates.
const wrist = new THREE.Vector3(0.35, -0.40, -0.55);
const shoulder = new THREE.Vector3(0.05, -0.55, -0.10);
for (const poleBias of [0.0, 0.06, 0.12]) {
  const mid = shoulder.clone().add(wrist).multiplyScalar(0.5);
  const elbow = mid.add(new THREE.Vector3(1, -0.5, 0.2).normalize().multiplyScalar(poleBias));
  const toElbow = elbow.sub(wrist).normalize();
  const negY = Y.clone().negate();
  const deg = (negY.angleTo(toElbow) * 180) / Math.PI;
  console.log(`wrist kink vs forearm (pole bias ${poleBias}): ${deg.toFixed(1)}°  toElbow: ${toElbow.toArray().map((v) => v.toFixed(2)).join(',')}`);
}

// ── Composed: what the camera actually sees at idle ──
const IDLE: [number, number, number] = [-0.2, -0.15, 0.4];
const qIdle = new THREE.Quaternion().setFromEuler(new THREE.Euler(...IDLE, 'XYZ'));
const qComposed = qIdle.clone().multiply(q);
const Yc = new THREE.Vector3(0, 1, 0).applyQuaternion(qComposed);
const Zc = new THREE.Vector3(0, 0, 1).applyQuaternion(qComposed);
console.log('COMPOSED hand +Y (camera frame):', Yc.toArray().map((v) => v.toFixed(3)).join(', '));
console.log('COMPOSED hand +Z (camera frame):', Zc.toArray().map((v) => v.toFixed(3)).join(', '));
const negYc = Yc.clone().negate();
const mid2 = shoulder.clone().add(wrist).multiplyScalar(0.5);
const elbow2 = mid2.add(new THREE.Vector3(1, -0.5, 0.2).normalize().multiplyScalar(0.06));
const toElbow2 = elbow2.sub(wrist).normalize();
console.log('COMPOSED kink vs forearm:', ((negYc.angleTo(toElbow2) * 180) / Math.PI).toFixed(1) + '°');
console.log('toElbow:', toElbow2.toArray().map((v) => v.toFixed(3)).join(', '));

// ── Decompose the kink in HAND-LOCAL terms ──
// toElbow expressed in the composed hand frame: x = lateral exit
// (ulnar/radial deviation), z = palmar/dorsal exit (flexion/extension).
const toElbowLocal = toElbow2.clone().applyQuaternion(qComposed.clone().invert());
console.log('toElbow in hand-local:', toElbowLocal.toArray().map((v) => v.toFixed(3)).join(', '));
console.log('  (ideal forearm continuation = (0,-1,0));');
console.log('  lateral (ulnar+/radial-) deviation:', (Math.atan2(toElbowLocal.x, -toElbowLocal.y) * 180 / Math.PI).toFixed(1) + '°');
console.log('  flexion(+z)/extension(-z):', (Math.atan2(toElbowLocal.z, -toElbowLocal.y) * 180 / Math.PI).toFixed(1) + '°');
