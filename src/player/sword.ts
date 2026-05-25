import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { SWORD_RUSTED } from '../content/sword';
import type { ModelSpec } from '../ecs/model-types';

// First-person held sword. Geometry comes from a ModelSpec (data); animation
// state (swing phases) is procedural and operates on the model group.
//
// The wielded weapon can be swapped at runtime via equip(spec) — picking
// up a different weapon swaps the visible model under the same animation.

export type SwordPhase = 'idle' | 'windup' | 'strike' | 'recover';

export interface Sword {
  /** The live THREE.Group for the wielded weapon. Updated by equip(). */
  readonly group: THREE.Group;
  /** True only during the strike phase of the current swing — use to gate raycasts. */
  isStriking: boolean;
  /** True from windup-start through recover-end — use to gate new attack inputs. */
  isSwinging: boolean;
  /** Trigger a new swing if not already swinging. Returns whether it started one. */
  startSwing(): boolean;
  update(dt: number): void;
  /** Swap the wielded weapon model. Resets to idle pose. */
  equip(weaponSpec: ModelSpec): void;
  /** Debug-only: jump to a specific phase + phase timer. */
  setDebugPhase(phase: SwordPhase, phaseTimer: number): void;
}

export function createSword(camera: THREE.Camera): Sword {
  const [ix, iy, iz] = CONFIG.SWORD_IDLE_POS;
  const [rx, ry, rz] = CONFIG.SWORD_IDLE_ROT;

  // `group` is mutable — equip() rebuilds the model and reassigns it.
  let group: THREE.Group;

  function mount(spec: ModelSpec) {
    const built = buildModel(spec);
    group = built.group;
    group.position.set(ix, iy, iz);
    group.rotation.set(rx, ry, rz);
    camera.add(group);
  }

  mount(SWORD_RUSTED);

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
    update(0);
  }

  function equip(spec: ModelSpec) {
    if (group) camera.remove(group);
    mount(spec);
    phase = 'idle';
    phaseTimer = 0;
  }

  return {
    get group() {
      return group;
    },
    get isStriking() {
      return phase === 'strike';
    },
    get isSwinging() {
      return phase !== 'idle';
    },
    startSwing,
    update,
    equip,
    setDebugPhase,
  };
}
