import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { getSwordOffset } from './viewmodel-bob';
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
  /** Swap the wielded weapon model. Passing null leaves the player
   *  empty-handed (used at run start before the player picks at the
   *  starter altar, and any future unequip-weapon flow). */
  equip(weaponSpec: ModelSpec | null): void;
  /** Debug-only: jump to a specific phase + phase timer. */
  setDebugPhase(phase: SwordPhase, phaseTimer: number): void;
}

export function createSword(camera: THREE.Camera): Sword {
  const [ix, iy, iz] = CONFIG.SWORD_IDLE_POS;
  const [rx, ry, rz] = CONFIG.SWORD_IDLE_ROT;

  // `group` is the animated HOLDER — always exists, parented to the
  // camera, position + rotation driven by the swing state machine.
  // The wielded weapon model lives as a CHILD of group, added by
  // mount(); empty hand = no child. Starting empty (no mount at boot)
  // is the starter-chamber default — the equipment listener calls
  // equip(...) the moment the player takes a weapon at an altar.
  const group = new THREE.Group();
  group.position.set(ix, iy, iz);
  group.rotation.set(rx, ry, rz);
  camera.add(group);

  function unmount() {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
        mesh.geometry.dispose();
      });
    }
  }

  function mount(spec: ModelSpec) {
    unmount();
    const built = buildModel(spec);
    // Held weapon always renders ON TOP of scene geometry, so it never
    // clips into walls. Standard PSX-era FPS trick. We don't change the
    // ModelSpec materials (so the same model on the floor as a pickup
    // still depth-tests normally) — only the live built meshes get
    // depthTest off + a high renderOrder so they're drawn last.
    built.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          m.depthTest = false;
          m.depthWrite = false;
          // CRITICAL for the renderOrder to actually win against the
          // world's transparent sprites (fountain shine, eye halos,
          // moonbeams, etc.). Three.js renders opaque objects first,
          // then transparent — within EACH pass renderOrder controls.
          // An opaque sword with renderOrder 999 still renders BEFORE
          // any transparent sprite, so sprites paint over it. Mark
          // transparent (opacity stays 1, so visually identical) and
          // the sword sorts into the transparent phase where 999 puts
          // it last overall.
          m.transparent = true;
          m.needsUpdate = true;
        }
        mesh.renderOrder = 999;
      }
    });
    group.add(built.group);
  }

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
      // Idle pose + walk bop. Only applied during the idle phase —
      // adding bob on top of the swing animations would muddy their
      // snap. The bob system contributes both the resting idle drift
      // and the walking bop on a single read.
      const b = getSwordOffset();
      group.position.set(ix + b.x, iy + b.y, iz);
      group.rotation.set(rx, ry, rz + b.rotZ);
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

  function equip(spec: ModelSpec | null) {
    if (!spec) {
      unmount();
    } else {
      mount(spec);
    }
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
