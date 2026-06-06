import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { getBobOffset } from './viewmodel-bob';
import { getWeaponSway } from './viewmodel-sway';
import { computeWeaponPose, type WeaponPose } from './weapon-animations';
import { getChargeProgress, isChargePerfectWindow, getChargeDirection } from '../controls/charge-input';
import { registerViewmodel } from '../style/render-target';
import { createSwingState } from '../combat/swing-state';
import { getCurrentWeapon } from './current-weapon';
import type { SwingPhase, AttackDirection } from '../combat/swing-state';
import type { ModelSpec } from '../ecs/model-types';
import type { ResolvedComboStep, PoseKey } from '../content/weapon-classes';

/** The wind pose to TELEGRAPH for a held charge direction — the directional
 *  move's pose for the live joystick direction, or null when centered / the
 *  weapon has no directional move that way (cock toward the combo step instead). */
function telegraphPoseKey(dir: AttackDirection): PoseKey | null {
  if (!dir) return null;
  const m = getCurrentWeapon().directionalMoves;
  if (!m) return null;
  const step = dir === 'forward' ? m.forward
    : dir === 'back' ? m.back
    : dir === 'strafe-left' ? m.strafeLeft
    : m.strafeRight;
  return step?.pose ?? null;
}

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
  /** 0..1 progress through the current phase — read by the commitment system to
   *  ease agency in on windup and out on recover (idle = 0). */
  getPhaseProgress(): number;
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

  // PERFECT-RELEASE gleam — the weapon's emissive flashes white during the
  // perfect-charge window so "release NOW" reads on the weapon itself (in your
  // eyeline), not just the HUD ring. Collected per weapon at mount (built mats
  // are this viewmodel's own clones, safe to mutate); each remembers its base
  // emissive so we can restore it. Only mats with an emissive channel qualify.
  type FlashMat = { mat: THREE.MeshStandardMaterial; base: number };
  const flashMats: FlashMat[] = [];
  let gleaming = false;

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
    flashMats.length = 0;
    gleaming = false;
    heldInit = false;   // new weapon snaps to its own pose, doesn't ease from the old
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
          // Remember the base emissive so the perfect-release gleam can flash
          // white and restore. Only materials that have an emissive channel.
          const em = (m as THREE.MeshStandardMaterial).emissive;
          if (em && typeof em.getHex === 'function') {
            flashMats.push({ mat: m as THREE.MeshStandardMaterial, base: em.getHex() });
          }
        }
        mesh.renderOrder = 999;
      }
    });
    group.add(built.group);
  }

  // Smoothed held pose for the IDLE / charge-hold state, so discrete changes
  // (a directional charge switch, a combo-step change, a charge started right
  // after a swing) EASE instead of snapping. Synced to the live swing pose
  // during a swing, so the swing→idle handoff is continuous. Active swing frames
  // are written to `group` directly (crisp — never smoothed).
  const heldPose: WeaponPose = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };
  let heldInit = false;

  function setHeld(x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
    heldPose.x = x; heldPose.y = y; heldPose.z = z;
    heldPose.rotX = rx; heldPose.rotY = ry; heldPose.rotZ = rz;
    heldInit = true;
  }

  /** Pose `group` from the current swing-state — a read of the sim into a THREE
   *  transform, with held-pose smoothing on the idle/charge state. `dt` drives
   *  the smoothing rate; Infinity (a debug pose) snaps instantly. */
  function repose(dt = Infinity) {
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
      // END-OF-WINDUP pose — the weapon visibly cocks back the longer you hold.
      // That end pose IS the strike's t=0 pose, so on release (skipWindup →
      // strike) the transition is seamless, no snap.
      //
      // DIRECTIONAL TELEGRAPH: if the joystick is held in a direction that maps
      // to a directional move, cock toward THAT move's wind pose instead of the
      // combo step's — so a held heavy foretells which way it'll come from, and
      // flicking left↔right mid-charge swings the weapon over to the new side
      // (For Honor feint). The strike resolves the same direction at release.
      const charge = getChargeProgress();
      if (charge > 0) {
        const cockPose = telegraphPoseKey(getChargeDirection()) ?? step.pose;
        const cocked = computeWeaponPose(cockPose, 'windup', 1.0);
        px  = px  + (cocked.x    - px)  * charge;
        py  = py  + (cocked.y    - py)  * charge;
        pz  = pz  + (cocked.z    - pz)  * charge;
        prx = prx + (cocked.rotX - prx) * charge;
        pry = pry + (cocked.rotY - pry) * charge;
        prz = prz + (cocked.rotZ - prz) * charge;
      }
      // Ease the held pose toward this target (snap on first frame / debug).
      if (!heldInit || !isFinite(dt)) {
        setHeld(px, py, pz, prx, pry, prz);
      } else {
        const a = 1 - Math.exp(-dt * CONFIG.HELD_POSE_SMOOTH_RATE);
        setHeld(
          heldPose.x + (px - heldPose.x) * a,
          heldPose.y + (py - heldPose.y) * a,
          heldPose.z + (pz - heldPose.z) * a,
          heldPose.rotX + (prx - heldPose.rotX) * a,
          heldPose.rotY + (pry - heldPose.rotY) * a,
          heldPose.rotZ + (prz - heldPose.rotZ) * a,
        );
      }
      const sway = getWeaponSway();
      group.position.set(heldPose.x, heldPose.y, heldPose.z);
      group.rotation.set(heldPose.rotX + sway.pitch, heldPose.rotY + sway.yaw, heldPose.rotZ);
      return;
    }

    // windup / strike / recover — interpolate the step's pose curve by the
    // sim's reported progress through the current phase. Crisp (no smoothing),
    // but sync heldPose so the swing→idle handoff continues from exactly here.
    // Sway is INTENTIONALLY skipped mid-swing — the strike animation is the
    // feel-critical motion; layering sway on top muddies the snap.
    const pose = computeWeaponPose(step.pose, phase, swing.getPhaseProgress());
    group.position.set(pose.x, pose.y, pose.z);
    group.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
    setHeld(pose.x, pose.y, pose.z, pose.rotX, pose.rotY, pose.rotZ);
  }

  function update(dt: number) {
    swing.advance(dt);
    repose(dt);
    // Perfect-release gleam: flash the weapon's emissive white inside the
    // window, restore on exit. Only writes on the edge, so it's free otherwise.
    const wantGleam = isChargePerfectWindow();
    if (wantGleam !== gleaming) {
      gleaming = wantGleam;
      for (const f of flashMats) {
        if (wantGleam) f.mat.emissive.setHex(0xdfefff);
        else f.mat.emissive.setHex(f.base);
      }
    }
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
    getPhaseProgress: swing.getPhaseProgress,
    startSwing: swing.requestSwing,
    update,
    equip,
    setDebugPhase,
  };
}
