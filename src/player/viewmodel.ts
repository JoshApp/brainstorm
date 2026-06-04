import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { getBobOffset } from './viewmodel-bob';
import { computeWeaponPose } from './weapon-animations';
import { getChargeProgress } from '../controls/charge-input';
import { registerViewmodel } from '../style/render-target';
import { createSwingState } from '../combat/swing-state';
import type { SwingPhase, AttackDirection } from '../combat/swing-state';
import type { ModelSpec } from '../ecs/model-types';
import type { ResolvedComboStep } from '../content/weapon-classes';

// First-person held weapon viewmodel — the VIEW half of the attack system.
//
// Despite its old name (this file used to be sword.ts back when the only
// weapon was a sword), it drives EVERY player weapon: sword, dagger, hammer,
// spear, crossbow, wand/staff. Geometry comes from a ModelSpec (data).
//
// The SIMULATION — swing phases, combo progression, input buffering,
// directional/charged overrides — lives in `combat/swing-state.ts`, a pure,
// presentation-free, unit-tested module. This file is now just a view: each
// frame it advances that sim and poses the THREE.Group from it. Combat reads
// the same sim (through this facade) for hit windows + the onSwingStart
// lifecycle event. Separating model from view is what keeps the feel-critical
// timing logic testable and keeps "did a swing happen" single-authority.
//
// The wielded weapon can be swapped at runtime via equip(spec).

// Re-exported so existing callers (combat/attack.ts) keep importing these from
// the viewmodel; the definitions now live in combat/swing-state.ts.
export type { SwingPhase, AttackDirection };

export interface WeaponViewmodel {
  /** The live THREE.Group for the wielded weapon. Updated by equip(). */
  readonly group: THREE.Group;
  /** True only during the strike phase of the current swing — use to gate raycasts. */
  isStriking: boolean;
  /** True from windup-start through recover-end — use to gate new attack inputs. */
  isSwinging: boolean;
  /** True only during the strike phase AND only when the current
   *  combo step is the finisher (last entry in the weapon's combo
   *  array). Combat reads this to apply on-finisher item modifiers
   *  to outgoing damage. */
  isFinisherStrike: boolean;
  /** The currently-active combo step (the one being animated). Read
   *  by combat to apply per-step reach/cone/maxTargets overrides.
   *  Returns null when no swing is in progress. */
  getActiveStep(): ResolvedComboStep | null;
  /** Current swing phase — read by the commitment system to scale player
   *  agency (idle = full freedom). */
  getPhase(): SwingPhase;
  /** Trigger a new swing if not already swinging. Returns whether it started one. */
  startSwing(opts?: { skipWindup?: boolean; direction?: AttackDirection }): boolean;
  update(dt: number): void;
  /** Swap the wielded weapon model. Passing null leaves the player
   *  empty-handed (used at run start before the player picks at the
   *  starter altar, and any future unequip-weapon flow). */
  equip(weaponSpec: ModelSpec | null): void;
  /** Debug-only: jump to a specific phase + phase timer. */
  setDebugPhase(phase: SwingPhase, phaseTimer: number): void;
}

export interface WeaponViewmodelOptions {
  /** Fired every time a NEW windup begins — whether from an idle
   *  press or from a queued combo chain. Combat wires playWhoosh +
   *  'attack:swing' emit here so chained combo steps make sound, not
   *  just the first press. `charged` is true only for a charged release
   *  (skipWindup) — combat uses it to bill the heavier stamina cost.
   *  This is the single per-real-swing event, so stamina is spent here
   *  (once per swing), NOT per button press. Forwarded straight to the
   *  swing-state sim, which is what actually owns the lifecycle. */
  onSwingStart?: (info: { charged: boolean }) => void;
  /** Gate forwarded to the sim: may a swing start / a combo chain continue?
   *  Combat passes the stamina check so swings can't begin (or chains continue)
   *  on an empty bar. */
  canSwing?: () => boolean;
}

export function createWeaponViewmodel(
  camera: THREE.Camera,
  options: WeaponViewmodelOptions = {},
): WeaponViewmodel {
  const [ix, iy, iz] = CONFIG.SWORD_IDLE_POS;
  const [rx, ry, rz] = CONFIG.SWORD_IDLE_ROT;

  // `group` is the animated HOLDER — always exists, parented to the
  // camera, position + rotation driven (by repose) from the swing sim.
  // The wielded weapon model lives as a CHILD of group, added by mount();
  // empty hand = no child. Starting empty (no mount at boot) is the
  // starter-chamber default — the equipment listener calls equip(...) the
  // moment the player takes a weapon at an altar.
  const group = new THREE.Group();
  group.position.set(ix, iy, iz);
  group.rotation.set(rx, ry, rz);
  camera.add(group);
  // Register for the renderer's viewmodel depth-only pass — see the note in
  // render-target.ts. Without it the distance-crush / fog-inscatter post
  // passes read the background depth behind the blade and paint it on.
  registerViewmodel(group);

  // The swing/combo SIMULATION (phases, combo, buffering, overrides) lives in
  // its own pure module; this viewmodel only reads it to pose `group`.
  const swing = createSwingState({ onSwingStart: options.onSwingStart, canSwing: options.canSwing });

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
          // depthTest:false → always on top of walls (no clip). It can't
          // write depth (GL skips depth writes when the test is off), so the
          // renderer does a separate depth-only pass for the viewmodel to put
          // its near depth in the buffer (see render-target.ts). depthWrite
          // here is moot for colour; the depth pass toggles it.
          m.depthTest = false;
          m.depthWrite = false;
          // CRITICAL for the renderOrder to actually win against the
          // world's transparent sprites (fountain shine, eye halos,
          // moonbeams, etc.). Three.js renders opaque objects first,
          // then transparent — within EACH pass renderOrder controls.
          // An opaque weapon with renderOrder 999 still renders BEFORE
          // any transparent sprite, so sprites paint over it. Mark
          // transparent (opacity stays 1, so visually identical) and
          // the viewmodel sorts into the transparent phase where 999
          // puts it last overall.
          m.transparent = true;
          m.needsUpdate = true;
        }
        mesh.renderOrder = 999;
      }
    });
    group.add(built.group);
  }

  /** Pose `group` from the current swing-state — a pure read of the sim into a
   *  THREE transform. Called every frame after the sim advances, and on a
   *  debug pose. */
  function repose() {
    const phase = swing.getPhase();
    // Always-resolved step (the sim returns the rest step when idle too) — the
    // pose curve comes from the step, so daggers walk stab→slash→stab as the
    // combo advances and the wand carries upright.
    const step = swing.getCurrentStep();

    if (phase === 'idle') {
      // Idle pose + walk bob. The bob layers on the baseline; it isn't applied
      // to swing animations because it would muddy their snap.
      const b = getBobOffset();
      const idle = computeWeaponPose(step.pose, 'idle', 0);
      let px = idle.x + b.x, py = idle.y + b.y, pz = idle.z;
      let prx = idle.rotX, pry = idle.rotY, prz = idle.rotZ + b.rotZ;
      // CHARGED HOLD blend: mid-charge, lerp the resting pose toward the
      // END-OF-WINDUP pose of the current step — the weapon visibly cocks back
      // the longer you hold. That end pose IS the strike's t=0 pose, so on
      // release (skipWindup → strike) the transition is seamless, no snap.
      const charge = getChargeProgress();
      if (charge > 0) {
        const cocked = computeWeaponPose(step.pose, 'windup', 1.0);
        px  = px  + (cocked.x    - px)  * charge;
        py  = py  + (cocked.y    - py)  * charge;
        pz  = pz  + (cocked.z    - pz)  * charge;
        prx = prx + (cocked.rotX - prx) * charge;
        pry = pry + (cocked.rotY - pry) * charge;
        prz = prz + (cocked.rotZ - prz) * charge;
      }
      group.position.set(px, py, pz);
      group.rotation.set(prx, pry, prz);
      return;
    }

    // windup / strike / recover — interpolate the step's pose curve by the
    // sim's reported progress through the current phase.
    const pose = computeWeaponPose(step.pose, phase, swing.getPhaseProgress());
    group.position.set(pose.x, pose.y, pose.z);
    group.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
  }

  function update(dt: number) {
    swing.advance(dt);
    repose();
  }

  function setDebugPhase(p: SwingPhase, t: number) {
    swing.setDebugPhase(p, t);
    repose();
  }

  function equip(spec: ModelSpec | null) {
    if (!spec) {
      unmount();
    } else {
      mount(spec);
    }
    // Weapon swap kills any in-flight combo state — the new weapon's combo
    // starts fresh on the next press.
    swing.reset();
  }

  return {
    get group() {
      return group;
    },
    get isStriking() {
      return swing.isStriking();
    },
    get isSwinging() {
      return swing.isSwinging();
    },
    get isFinisherStrike() {
      return swing.isFinisherStrike();
    },
    getActiveStep(): ResolvedComboStep | null {
      return swing.getActiveStep();
    },
    getPhase: swing.getPhase,
    startSwing: swing.requestSwing,
    update,
    equip,
    setDebugPhase,
  };
}
