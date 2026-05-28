import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { getSwordOffset } from './viewmodel-bob';
import { computeWeaponPose } from './weapon-animations';
import { getCurrentWeapon } from './current-weapon';
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

export interface SwordOptions {
  /** Fired every time a NEW windup begins — whether from an idle
   *  press or from a queued combo chain. Combat wires playWhoosh +
   *  'attack:swing' emit here so chained combo steps make sound, not
   *  just the first press. */
  onSwingStart?: () => void;
}

export function createSword(camera: THREE.Camera, options: SwordOptions = {}): Sword {
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

  // --- Swing state machine + combo tracking ---
  // comboStep is the index into the current weapon's combo array. It
  // advances when the player presses attack inside the combo window
  // AFTER the previous step's recover ends — OR via the one-hop press
  // buffer below.
  //
  // Press buffering, one-hop only:
  //   A press during a swing that was started by an EXPLICIT press
  //   buffers, and chains the next step at recover-end. The chained
  //   step itself cannot be further buffered. This catches the player
  //   who taps just-too-early for the window without auto-playing the
  //   whole combo from a rapid mouse-click burst.
  let phase: SwordPhase = 'idle';
  let phaseTimer = 0;
  let comboStep = 0;
  let comboWindowExpiresAt = 0;     // ms (performance.now() basis)
  let queuedPress = false;
  let currentStepIsChained = false;  // true when current swing started via buffer chain

  function nowMs(): number { return performance.now(); }

  /** Pull the resolved step for the CURRENT combo index, defensively
   *  wrapping in case the weapon was swapped to one with a shorter
   *  combo while we were mid-swing. */
  function currentStep() {
    const w = getCurrentWeapon();
    const idx = ((comboStep % w.combo.length) + w.combo.length) % w.combo.length;
    return { w, step: w.combo[idx] };
  }

  function startSwing(): boolean {
    if (phase !== 'idle') {
      // Mid-swing press: buffer ONE follow-up — but only if the
      // current swing was started by an explicit press. A swing that
      // was already chained-in via the buffer can't queue another
      // chain, so rapid taps stop after one hop instead of auto-
      // playing the whole combo.
      if (!currentStepIsChained) queuedPress = true;
      return false;
    }
    // Idle. If we're past the combo window, the previous chain is dead
    // and the next press restarts the combo from step 0. If we're
    // still inside it, comboStep was pre-advanced when the last
    // recover ended, so we just fire whatever it currently is.
    if (nowMs() >= comboWindowExpiresAt) {
      comboStep = 0;
    }
    phase = 'windup';
    phaseTimer = 0;
    currentStepIsChained = false;
    options.onSwingStart?.();
    return true;
  }

  function update(dt: number) {
    if (phase === 'idle') {
      // If the combo window has expired since we went idle, drop back
      // to step 0 so the held-pose preview (if/when we add one) and
      // any future combo-step HUD reflect the reset.
      if (comboStep !== 0 && nowMs() >= comboWindowExpiresAt) {
        comboStep = 0;
      }
      // Idle pose + walk bop. The bob system layers on top of the
      // idle baseline; the bob isn't applied to swing animations
      // because it would muddy their snap.
      const b = getSwordOffset();
      group.position.set(ix + b.x, iy + b.y, iz);
      group.rotation.set(rx, ry, rz + b.rotZ);
      return;
    }

    phaseTimer += dt;

    // Phase timings come from the CURRENT combo step. Pose curve
    // comes from the step's pose key — daggers walk through
    // stab → slash → stab-stab as the combo advances.
    const { w, step } = currentStep();
    const phaseDur =
      phase === 'windup' ? step.windupTime :
      phase === 'strike' ? step.strikeTime :
                            step.recoverTime;
    const t = Math.min(1, phaseTimer / Math.max(phaseDur, 0.001));
    const pose = computeWeaponPose(step.pose, phase, t);
    group.position.set(pose.x, pose.y, pose.z);
    group.rotation.set(pose.rotX, pose.rotY, pose.rotZ);

    if (phaseTimer >= phaseDur) {
      if (phase === 'windup') {
        phase = 'strike';
        phaseTimer = 0;
      } else if (phase === 'strike') {
        phase = 'recover';
        phaseTimer = 0;
      } else {
        // Recover ended. Pre-advance the combo step and either
        // chain straight into the next windup (if a press buffered)
        // or open the idle combo window.
        comboStep = (comboStep + 1) % w.combo.length;
        if (queuedPress) {
          queuedPress = false;
          currentStepIsChained = true;
          phase = 'windup';
          phaseTimer = 0;
          options.onSwingStart?.();
        } else {
          comboWindowExpiresAt = nowMs() + w.comboWindowMs;
          phase = 'idle';
          phaseTimer = 0;
        }
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
    // Weapon swap kills any in-flight combo state — the new weapon's
    // combo starts fresh on the next press.
    phase = 'idle';
    phaseTimer = 0;
    comboStep = 0;
    comboWindowExpiresAt = 0;
    queuedPress = false;
    currentStepIsChained = false;
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
