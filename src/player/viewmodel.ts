import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { getBobOffset } from './viewmodel-bob';
import { computeWeaponPose } from './weapon-animations';
import { getCurrentWeapon } from './current-weapon';
import { getChargeProgress } from '../controls/charge-input';
import { registerViewmodel } from '../style/render-target';
import type { ModelSpec } from '../ecs/model-types';
import type { ResolvedComboStep } from '../content/weapon-classes';

// First-person held weapon viewmodel.
//
// Despite its old name (this file used to be sword.ts back when the
// only weapon was a sword), it drives EVERY player weapon: sword,
// dagger, hammer, spear, crossbow, wand/staff. Geometry comes from a
// ModelSpec (data); animation state (swing phases) is procedural and
// operates on the model group.
//
// The wielded weapon can be swapped at runtime via equip(spec) —
// picking up a different weapon swaps the visible model under the
// same animation state machine.
//
// State machine:
//   idle    — at rest pose (per-weapon; sword hip-held, staff upright)
//   windup  — winding up (animated toward end-of-windup pose)
//   strike  — the swing's HIT WINDOW. combat reads isStriking to
//             gate raycasts. directional/charged moves can SKIP
//             windup and start here.
//   recover — locked-out follow-through. comboStep advances when
//             this completes.

/** Movement intent at the moment the player presses attack. Picked
 *  from the joystick magnitude + direction in combat/attack.ts and
 *  passed into startSwing — if a directional move is registered for
 *  this weapon class, it overrides the normal combo step. Strafe is
 *  split L/R so the swing follows the body's momentum direction. */
export type AttackDirection = 'forward' | 'back' | 'strafe-left' | 'strafe-right' | null;

export type SwingPhase = 'idle' | 'windup' | 'strike' | 'recover';

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
   *  just the first press. */
  onSwingStart?: () => void;
}

export function createWeaponViewmodel(
  camera: THREE.Camera,
  options: WeaponViewmodelOptions = {},
): WeaponViewmodel {
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
  // Register for the renderer's viewmodel depth-only pass — see the note in
  // render-target.ts. Without it the distance-crush / fog-inscatter post
  // passes read the background depth behind the blade and paint it on.
  registerViewmodel(group);

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

  // --- Swing state machine + combo tracking ---
  // comboStep is the index into the current weapon's combo array. It
  // advances when the player presses attack inside the combo window
  // AFTER the previous step's recover ends — OR via the press buffer
  // below.
  //
  // Press buffering:
  //   A press during ANY non-finisher step buffers and chains the
  //   next step at recover-end. This lets the player press
  //   step 0 → during it press for step 1 → during step 1 press for
  //   step 2, walking through the full combo. The FINISHER (the last
  //   step) does NOT accept a buffer — otherwise a spam-burst on the
  //   last step would wrap the combo back to step 0 and start over.
  let phase: SwingPhase = 'idle';
  let phaseTimer = 0;
  let comboStep = 0;
  let comboWindowExpiresAt = 0;     // ms (performance.now() basis)
  let queuedPress = false;
  // Directional move override — set at startSwing when the player's
  // joystick was held in a direction at press time. Used in place of
  // the combo step until cleared on idle.
  let activeDirectionalStep: ResolvedComboStep | null = null;

  function nowMs(): number { return performance.now(); }

  /** Pull the resolved step for the CURRENT combo index, defensively
   *  wrapping in case the weapon was swapped to one with a shorter
   *  combo while we were mid-swing. */
  function currentStep() {
    const w = getCurrentWeapon();
    // Directional override beats the combo. Cleared on idle so the
    // next neutral press resumes the standard combo sequence.
    if (activeDirectionalStep) return { w, step: activeDirectionalStep };
    const idx = ((comboStep % w.combo.length) + w.combo.length) % w.combo.length;
    return { w, step: w.combo[idx] };
  }

  function startSwing(opts?: { skipWindup?: boolean; direction?: AttackDirection }): boolean {
    if (phase !== 'idle') {
      // Mid-swing press: buffer the next combo step UNLESS the
      // current step is the finisher (last in the array). A spam
      // burst on the finisher would otherwise wrap the combo and
      // start step 0 of a fresh chain automatically.
      const w = getCurrentWeapon();
      const isFinisher = comboStep >= w.combo.length - 1;
      if (!isFinisher) queuedPress = true;
      return false;
    }
    // Pick the active step.
    //
    // Lookup order (highest priority first):
    //   1. CHARGED + direction → chargedMoves[direction] (specials —
    //      back-ward, strafe-spin, forward-plunge; today only ward).
    //   2. direction → directionalMoves[direction] (lunge / sweeps /
    //      retreat). Charge modifiers (+30% reach / +40% cone / +80%
    //      damage) still stack on top in attack.ts.
    //   3. neither → normal combo step. Charge modifiers stack too.
    //
    // Firing a directional or charged-special override RESETS the
    // combo to step 0 so the next neutral press starts a fresh 1-2-3.
    const w = getCurrentWeapon();
    activeDirectionalStep = null;
    const dir = opts?.direction;
    const isCharged = !!opts?.skipWindup;
    if (dir) {
      // Map strafe-left / strafe-right onto a single 'strafe' key for
      // chargedMoves lookup (the spin is rotationally symmetric).
      const chargeKey: 'forward' | 'back' | 'strafe' =
        dir === 'forward' ? 'forward' :
        dir === 'back'    ? 'back' :
                            'strafe';
      const dirKey =
        dir === 'forward'      ? 'forward' :
        dir === 'back'         ? 'back' :
        dir === 'strafe-left'  ? 'strafeLeft' :
                                  'strafeRight';
      const chargedMove = isCharged && w.chargedMoves ? w.chargedMoves[chargeKey] : undefined;
      const directional = w.directionalMoves ? w.directionalMoves[dirKey] : undefined;
      activeDirectionalStep = chargedMove ?? directional ?? null;
      if (activeDirectionalStep) comboStep = 0;
    }
    // No override: if we're past the combo window the previous chain
    // is dead and the next press restarts from step 0. If we're still
    // inside it, comboStep was pre-advanced when the last recover
    // ended, so we just fire whatever it currently is.
    if (!activeDirectionalStep && nowMs() >= comboWindowExpiresAt) {
      comboStep = 0;
    }
    // Charged release skips the windup phase — the player ALREADY
    // paid for it by holding. The cocked-back idle pose blends seam-
    // lessly into the strike's t=0 pose (which IS the end-of-windup
    // pose for the same combo step), so the visual transition is
    // continuous: held back → swings forward.
    phase = opts?.skipWindup ? 'strike' : 'windup';
    phaseTimer = 0;
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
      // Idle pose + walk bop. Per-weapon idle (the wand is held
      // upright like a staff; sword/dagger/etc. stay hip-held) is
      // resolved through computeWeaponPose so each weapon class
      // gets its native carry stance. The bob system layers on top
      // of the baseline; the bob isn't applied to swing animations
      // because it would muddy their snap.
      const b = getBobOffset();
      const { step } = currentStep();
      const idle = computeWeaponPose(step.pose, 'idle', 0);
      let px = idle.x + b.x, py = idle.y + b.y, pz = idle.z;
      let prx = idle.rotX, pry = idle.rotY, prz = idle.rotZ + b.rotZ;
      // CHARGED HOLD blend: if the player is mid-charge, lerp the
      // resting pose toward the END-OF-WINDUP pose of the current
      // combo step. Weapon visibly cocks back the longer they hold.
      // The end-of-windup pose is the same one a strike starts from,
      // so when the player releases (skipWindup → phase='strike')
      // the visual transition is seamless — no snap.
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
          // Buffered chain advances the COMBO — directional moves
          // are one-off, so a buffered press always falls back to
          // the next combo step regardless of what we just fired.
          activeDirectionalStep = null;
          phase = 'windup';
          phaseTimer = 0;
          options.onSwingStart?.();
        } else {
          // Recover ended without a buffered chain — return to idle
          // and clear the directional override so the next press
          // (if not directional) starts a fresh combo at step 0.
          activeDirectionalStep = null;
          comboWindowExpiresAt = nowMs() + w.comboWindowMs;
          phase = 'idle';
          phaseTimer = 0;
        }
      }
    }
  }

  function setDebugPhase(p: SwingPhase, t: number) {
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
    activeDirectionalStep = null;
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
    get isFinisherStrike() {
      if (phase !== 'strike') return false;
      const w = getCurrentWeapon();
      return comboStep === w.combo.length - 1;
    },
    getActiveStep(): ResolvedComboStep | null {
      if (phase === 'idle') return null;
      return currentStep().step;
    },
    startSwing,
    update,
    equip,
    setDebugPhase,
  };
}
