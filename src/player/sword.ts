import * as THREE from 'three';
import { CONFIG } from '../config';
import type { StyleMaterials } from '../style/materials';

// First-person held sword. Built from primitives, parented to the camera so it
// renders in screen-relative space (always at the bottom-right of view).
// Materials are supplied externally by the style library.

export type SwordPhase = 'idle' | 'windup' | 'strike' | 'recover';

export interface Sword {
  group: THREE.Group;
  /** True only during the strike phase of the current swing — use to gate raycasts. */
  isStriking: boolean;
  /** True from windup-start through recover-end — use to gate new attack inputs. */
  isSwinging: boolean;
  /** Trigger a new swing if not already swinging. Returns whether it started one. */
  startSwing(): boolean;
  update(dt: number): void;
  /** Debug-only: jump to a specific phase + phase timer. */
  setDebugPhase(phase: SwordPhase, phaseTimer: number): void;
}

export function createSword(camera: THREE.Camera, materials: StyleMaterials): Sword {
  const group = new THREE.Group();

  // Blade — flat box, long and narrow
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.01), materials.swordBlade);
  blade.position.y = 0.35;
  group.add(blade);

  // Cross-guard — short horizontal box
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.04), materials.swordGuard);
  guard.position.y = 0.04;
  group.add(guard);

  // Hilt grip — vertical cylinder
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), materials.swordHilt);
  hilt.position.y = -0.04;
  group.add(hilt);

  // Pommel — small sphere at the bottom
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), materials.swordPommel);
  pommel.position.y = -0.12;
  group.add(pommel);

  const [ix, iy, iz] = CONFIG.SWORD_IDLE_POS;
  const [rx, ry, rz] = CONFIG.SWORD_IDLE_ROT;

  group.position.set(ix, iy, iz);
  group.rotation.set(rx, ry, rz);

  // Parent the sword to the camera so it follows view automatically.
  // (The camera must be added to the scene for child meshes to render.)
  camera.add(group);

  // --- Swing state machine ---
  let phase: SwordPhase = 'idle';
  let phaseTimer = 0;

  function startSwing(): boolean {
    if (phase !== 'idle') return false;
    phase = 'windup';
    phaseTimer = 0;
    return true;
  }

  function update(dt: number) {
    if (phase === 'idle') {
      group.position.set(ix, iy, iz);
      group.rotation.set(rx, ry, rz);
      return;
    }

    phaseTimer += dt;

    if (phase === 'windup') {
      const t = Math.min(1, phaseTimer / CONFIG.SWORD_SWING_WINDUP);
      // Raise sword: pull back and up
      group.position.set(ix, iy + 0.15 * t, iz + 0.05 * t);
      group.rotation.set(rx - 0.9 * t, ry, rz);
      if (phaseTimer >= CONFIG.SWORD_SWING_WINDUP) {
        phase = 'strike';
        phaseTimer = 0;
      }
      return;
    }

    if (phase === 'strike') {
      const t = Math.min(1, phaseTimer / CONFIG.SWORD_SWING_STRIKE);
      // Chop down: sword arcs forward and down
      const ease = 1 - (1 - t) * (1 - t); // ease-out quad
      group.position.set(ix - 0.15 * ease, iy + 0.15 - 0.4 * ease, iz - 0.1 * ease);
      group.rotation.set(rx - 0.9 + 1.6 * ease, ry, rz + 0.3 * ease);
      if (phaseTimer >= CONFIG.SWORD_SWING_STRIKE) {
        phase = 'recover';
        phaseTimer = 0;
      }
      return;
    }

    if (phase === 'recover') {
      const t = Math.min(1, phaseTimer / CONFIG.SWORD_SWING_RECOVER);
      // Lerp back to idle position
      const e = 1 - (1 - t) * (1 - t);
      const fromPos = new THREE.Vector3(ix - 0.15, iy - 0.25, iz - 0.1);
      const toPos = new THREE.Vector3(ix, iy, iz);
      group.position.lerpVectors(fromPos, toPos, e);
      group.rotation.set(
        THREE.MathUtils.lerp(rx + 0.7, rx, e),
        ry,
        THREE.MathUtils.lerp(rz + 0.3, rz, e),
      );
      if (phaseTimer >= CONFIG.SWORD_SWING_RECOVER) {
        phase = 'idle';
        phaseTimer = 0;
      }
    }
  }

  function setDebugPhase(p: SwordPhase, t: number) {
    phase = p;
    phaseTimer = t;
    // Apply the per-phase pose immediately for freeze+screenshot
    update(0);
  }

  return {
    group,
    get isStriking() {
      return phase === 'strike';
    },
    get isSwinging() {
      return phase !== 'idle';
    },
    startSwing,
    update,
    setDebugPhase,
  };
}
