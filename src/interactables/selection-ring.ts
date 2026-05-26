import * as THREE from 'three';
import type { Interactable } from './types';

// Selection ring — a billboarded glow on the floor under the currently
// in-range interactable. Tells the player at a glance "this thing is
// the one you'd touch right now" without forcing them to read the
// interact-button label.
//
// Single shared mesh; the main loop positions it under the active
// interactable each frame. Pulses gently so the eye finds it even
// in busy scenes.

const RING_INNER = 0.45;
const RING_OUTER = 0.62;
const PULSE_PERIOD = 0.9;       // seconds for one breathe cycle
const PULSE_AMOUNT = 0.12;      // ±scale factor

const COLOR_NORMAL = new THREE.Color(0xffd6a0);   // warm amber — armed
const COLOR_SEALED = new THREE.Color(0x9090a0);   // muted gray — sealed/locked

let ringMesh: THREE.Mesh | null = null;
let ringMat: THREE.MeshBasicMaterial | null = null;
let pulseT = 0;

export function initSelectionRing(scene: THREE.Object3D) {
  if (ringMesh) return;
  const geom = new THREE.RingGeometry(RING_INNER, RING_OUTER, 36);
  ringMat = new THREE.MeshBasicMaterial({
    color: COLOR_NORMAL,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  ringMesh = new THREE.Mesh(geom, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.025;
  ringMesh.visible = false;
  // Render after most geometry so transparency composites cleanly.
  ringMesh.renderOrder = 5;
  scene.add(ringMesh);
}

/** Per-frame update. Call after the interactables-system has computed
 *  the current in-range. Pass null when nothing is in range. */
export function updateSelectionRing(target: Interactable | null, dt: number) {
  if (!ringMesh || !ringMat) return;
  if (!target) {
    ringMesh.visible = false;
    pulseT = 0;
    return;
  }
  ringMesh.visible = true;
  ringMesh.position.x = target.position.x;
  ringMesh.position.z = target.position.z;

  // Pulse 1.0 ↔ 1.0+PULSE_AMOUNT.
  pulseT += dt;
  const s = 1 + PULSE_AMOUNT * (0.5 + 0.5 * Math.sin(pulseT * Math.PI * 2 / PULSE_PERIOD));
  ringMesh.scale.set(s, s, 1);

  // Sealed (locked door) state — gray, dimmer, no pulse vibrancy. The
  // promptLabel 'SEALED' is the door's locked signal in the existing
  // architecture; everything else is armed.
  if (target.promptLabel === 'SEALED') {
    ringMat.color.copy(COLOR_SEALED);
    ringMat.opacity = 0.45;
  } else {
    ringMat.color.copy(COLOR_NORMAL);
    ringMat.opacity = 0.85;
  }
}
