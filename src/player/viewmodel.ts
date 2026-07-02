import * as THREE from 'three';
import { CONFIG } from '../config';
import { getBobOffset } from './viewmodel-bob';
import { getWeaponSway } from './viewmodel-sway';
import { getViewmodelPullback } from './viewmodel-pullback';
import { setupWhipChain, clearWhipChain, tickWhipChain } from './whip-chain';
import { computeWeaponPose, shoulderPivot, STANDARD_IDLE, type WeaponPose } from './weapon-animations';
import { getChargeProgress, isChargePerfectWindow, getChargeDirection } from '../controls/charge-input';
import { registerViewmodel, applyViewmodelDepthWebGPU } from '../style/render-frame';
import { createSwingState } from '../combat/swing-state';
import { getCurrentWeapon } from './current-weapon';
import { composeHeldWeapon } from './held-weapon-compose';
import { mergeRigidViewmodel } from './viewmodel-merge';
import { WristAim } from '../anim/wrist-solver';
import { FOREARM_EXIT_DESIRED } from '../content/hand';
import { buildModel } from '../ecs/build-model';
import { ARM_RIGHT, ARM_RIGHT_HUMERUS_LENGTH, ARM_RIGHT_FOREARM_LENGTH } from '../content/arm';
import { ArmIK } from '../anim/arm-ik';
import type { SwingPhase, AttackDirection } from '../combat/swing-state';
import type { ModelSpec } from '../ecs/model-types';
import type { ResolvedComboStep, PoseKey } from '../content/weapon-classes';
import type { HeldWeaponCompose } from './held-weapon-compose';
import { getSettings, onSettingsChanged } from '../settings/settings';
import { isDrinkingFlask } from './flask-drink';
import { getFlaskWristWorld } from './flask-viewmodel';

const HAND_AXES_LENGTH = 0.07;        // ~7cm — visible without dominating the frame
const HAND_AXES_GROUP_NAME = '__handAxesOverlay';

// Attach an RGB axis triad to every slot in the composed hand +
// weapon so authors can SEE which way each part's local +X (red),
// +Y (green), +Z (blue) actually points in world. Then they can
// describe rotations as "around the green axis" instead of guessing
// Euler signs. Toggled by the HAND AXES checkbox in the settings
// menu (Settings → Debug); persists across reloads via localStorage.
//
// SHIPS IN PRODUCTION — this is an AUTHOR'S TOOL but the loop
// (deploy → look on phone → describe rotation by colour → edit spec)
// NEEDS the toggle to actually work on the live build. Settings flag
// is off by default; flipping it costs ~30 line segments per equip.
//
// Render trick: AxesHelper materials are forced to depthTest:false +
// high renderOrder so the lines draw ON TOP of the hand / weapon
// meshes regardless of depth. Otherwise the slot-origin lines get
// buried inside the carpus sphere or the palm.
function setHandAxesOverlay(
  slotMaps: Array<Map<string, THREE.Object3D>>,
  on: boolean,
): void {
  // Only slots flagged with `debug: 'axes'` in their spec opt into
  // the overlay. Keeps the screen from being a wall of axis crosses
  // (every PIP/DIP/contact slot would otherwise show up); the author
  // tags the small list of slots they actually iterate against.
  const allSlots: THREE.Object3D[] = [];
  for (const map of slotMaps) for (const [, s] of map) allSlots.push(s);
  for (const slot of allSlots) {
    // Remove any previous axis helper to keep the toggle idempotent.
    for (let i = slot.children.length - 1; i >= 0; i--) {
      const c = slot.children[i];
      if (c.name === HAND_AXES_GROUP_NAME) slot.remove(c);
    }
    if (on && slot.userData.debug === 'axes') {
      const ax = new THREE.AxesHelper(HAND_AXES_LENGTH);
      ax.name = HAND_AXES_GROUP_NAME;
      ax.traverse((o) => {
        const m = (o as THREE.LineSegments).material as THREE.LineBasicMaterial | undefined;
        if (m) {
          m.depthTest = false;
          m.depthWrite = false;
          m.transparent = true;
        }
        o.renderOrder = 10_000;
      });
      slot.add(ax);
    }
  }
}

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
  /** Abort the current swing into its recover phase — used when the blade
   *  CLANKS into a wall: the strike ends short, the recoil plays. */
  interruptSwing(): void;
  /** Record the charge level (0..1) consumed for the swing about to start.
   *  Drives the blade's CHARGED-STRIKE GLOW — emissive ramps up during the
   *  upcoming strike phase in proportion to this level, fades during recover.
   *  Call IMMEDIATELY before startSwing so the glow lands on the right swing. */
  setSwingCharge(level: number): void;
  /** Current charged-strike glow brightness (0..1). The blade-trail effect
   *  reads this each frame so the trail's brightness matches the blade's. */
  getChargedStrikeGlow(): number;
  /** Write the blade tip's WORLD position into `out`, or return null if the
   *  wielded weapon has no `blade_tip` slot (wands, crossbows, fist). Used by
   *  the blade-trail effect to source ribbon positions. */
  getBladeTipWorldPos(out: THREE.Vector3): THREE.Vector3 | null;
  update(dt: number): void;
  /** Fire the deflect "catch" beat — the weapon snaps UP into a guard
   *  and settles back over ~0.2s. A transient layered over whatever pose
   *  is active (idle or mid-swing), so it never fights the swing sim. */
  parryRaise(): void;
  /** Swap the wielded weapon model. Passing null leaves the player
   *  empty-handed (used at run start before the player picks at the
   *  starter altar, and any future unequip-weapon flow). */
  equip(weaponSpec: ModelSpec | null): void;
  /** Drop a banked combo back to a fresh opener (no-op mid-swing). Called when
   *  a menu / chest / note pause breaks combat flow, so the next attack starts
   *  a clean chain instead of resuming a stale finisher. */
  breakCombo(): void;
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

  // ── ARM RIG ──────────────────────────────────────────────────────
  // Mounted as a SEPARATE child of the camera (NOT under `group`), so
  // when the swing animation translates the weapon-and-hand, the arm
  // stays anchored to the camera. The IK then bridges the fixed
  // shoulder to wherever the hand's wrist ended up. This is the
  // textbook 2-bone IK setup: external anchor + external target,
  // no circular dependency.
  const armBuilt = buildModel(ARM_RIGHT);
  const armGroup = armBuilt.group;
  camera.add(armGroup);
  registerViewmodel(armGroup);
  const armShoulderSlot = armBuilt.slots.get('shoulder');
  const armIK = armShoulderSlot
    ? new ArmIK({
        shoulderRest: [
          armShoulderSlot.position.x,
          armShoulderSlot.position.y,
          armShoulderSlot.position.z,
        ],
        shoulderSpringFreq: 1.8,
        shoulderSpringDamping: 1.0,
        shoulderHandBias: 0.10,
        humerusLength: ARM_RIGHT_HUMERUS_LENGTH,
        forearmLength: ARM_RIGHT_FOREARM_LENGTH,
        // Right arm: elbow biases DOWN-AND-OUT (camera-local +X /
        // -Y) so it never flips to the inside of the body.
        elbowPole: [1, -0.5, 0.2],
        jointDampHalfLife: 0.05,
      })
    : null;
  // We bypass the IK's joint-rotation cascade because the rotational
  // form is approximate (the elbow swings around its local X, which
  // doesn't always coincide with the swing plane after the shoulder
  // rotation). Instead we position the bone MESHES directly from the
  // IK's POSITION output each frame — guaranteed: humerus spans
  // shoulderPos→elbowPos, forearm spans elbowPos→wristPos. The mesh
  // tips touch the joints by construction.
  const armHumerusMesh = armBuilt.parts.get('humerus') as THREE.Mesh | undefined;
  const armRadiusMesh  = armBuilt.parts.get('radius')  as THREE.Mesh | undefined;
  const armUlnaMesh    = armBuilt.parts.get('ulna')    as THREE.Mesh | undefined;
  const armSinewMesh   = armBuilt.parts.get('sinew')   as THREE.Mesh | undefined;
  // Reparent the dynamic meshes to the arm group's root so we can
  // write their positions in arm-local space directly each frame
  // (without their original from-slot parent's transform mixing in).
  for (const m of [armHumerusMesh, armRadiusMesh, armUlnaMesh, armSinewMesh]) {
    if (m) armGroup.add(m);
  }
  // Reusable scratch.
  const _wristWorld    = new THREE.Vector3();
  const _wristArmLocal = new THREE.Vector3();
  const _midpoint      = new THREE.Vector3();
  const _direction     = new THREE.Vector3();
  const _yAxis         = new THREE.Vector3(0, 1, 0);
  // Cached reference to the hand's wrist slot, refreshed at each mount.
  let handWristSlot: THREE.Object3D | null = null;
  // The currently composed hand+weapon — kept so the settings-change
  // subscription below can re-apply DEV overlays (axis triads, etc.)
  // without waiting for the next equip().
  let currentComposed: HeldWeaponCompose | null = null;

  // ── RUNTIME WRIST SOLVER ─────────────────────────────────────────
  // Re-aims the HAND each frame so the forearm exits the wrist at the
  // anatomical target (anim/wrist-solver.ts), with the palm re-pinned
  // to the weapon's grip. The weapon itself never moves — it's a
  // sibling of the hand (held-weapon-compose.ts), owned by the swing
  // sim. Caches below are measured once per mount.
  const wristAim = new WristAim({ desiredExitLocal: FOREARM_EXIT_DESIRED });
  const _palmRestInGroup = new THREE.Vector3();  // palm rest point in composition-root frame (= weapon grip)
  const _palmInHandRoot = new THREE.Vector3();   // palm point in hand-root frame
  const _parentQuat = new THREE.Quaternion();
  const _aimScratch = new THREE.Vector3();
  let wristAimReady = false;
  // Settings subscription: when the HAND AXES toggle flips, attach or
  // detach the axis triads on the live rig immediately. DEV-gated at
  // setHandAxesOverlay itself, so prod builds strip the call body.
  const offSettings = onSettingsChanged((s) => {
    if (currentComposed) {
      const maps: Array<Map<string, THREE.Object3D>> = [currentComposed.hand.slots, armBuilt.slots];
      if (currentComposed.weapon) maps.push(currentComposed.weapon.slots);
      setHandAxesOverlay(maps, s.debugHandAxes);
    }
  });

  // Apply the arm's meshes to the viewmodel depth pass too so they
  // don't z-fight with world geometry behind them.
  applyViewmodelRender(armGroup, 997, false);

  // The swing/combo SIMULATION (phases, combo, buffering, overrides) lives in
  // its own pure module; this viewmodel only reads it to pose `group`.
  const swing = createSwingState({ onSwingStart: options.onSwingStart, canSwing: options.canSwing });

  // PERFECT-RELEASE gleam — the weapon's emissive flashes white during the
  // perfect-charge window so "release NOW" reads on the weapon itself (in your
  // eyeline), not just the HUD ring. Collected per weapon at mount (built mats
  // are this viewmodel's own clones, safe to mutate); each remembers its base
  // emissive so we can restore it. Only mats with an emissive channel qualify.
  // The FlashMat record also carries the BASE intensity, used by the charged-
  // strike glow further below (which scales the live intensity above base
  // during a charged strike instead of swapping the colour outright).
  type FlashMat = {
    mat: THREE.MeshStandardMaterial;
    base: number;
    baseIntensity: number;
  };
  const flashMats: FlashMat[] = [];
  let gleaming = false;

  // CHARGED-STRIKE GLOW state. setSwingCharge() records the next swing's
  // charge level; repose() drives the blade's emissiveIntensity toward
  // 1 + ramp during the strike, then back toward base during recover.
  // Pure amplitude — never touches emissive COLOUR (that lane is the
  // perfect-release gleam's, and the two would otherwise fight).
  let chargedSwingLevel = 0;     // 0..1 — captured at setSwingCharge()
  let chargedGlow = 0;            // 0..1 — live, eased toward target
  let emissiveElevated = false;   // tracks whether flashMats are above their base intensity right now
  const CHARGED_GLOW_MAX = 2.4;   // peak emissiveIntensity multiplier above 1×
  const CHARGED_GLOW_EASE = 18;   // 1/sec exponential ease toward target

  // Live blade_tip slot from the wielded weapon (null when the spec doesn't
  // declare one — wand, crossbow, fist). The blade-trail effect calls
  // getBladeTipWorldPos each frame; we just propagate the slot's world transform.
  let bladeTipSlot: THREE.Object3D | null = null;

  // True when the wielded weapon has a bead chain to ripple (the whip).
  let whippy = false;

  function unmount() {
    clearWhipChain();   // drop bead refs before the meshes are disposed
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

  // Apply the held-weapon render trick to every mesh in a subtree:
  // depthTest off (won't clip into walls — handled by a separate
  // depth-only pass in render-target.ts), transparent so it sorts into
  // the last render phase, and a high renderOrder so it draws over
  // every world sprite. `gleamCollect` controls whether each mesh's
  // emissive material is added to the perfect-release flashMats list —
  // weapons opt in, the hand opts out (it should never gleam).
  function applyViewmodelRender(root: THREE.Object3D, order: number, gleamCollect: boolean) {
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        // depthTest TRUE so viewmodel parts depth-test each other
        // (fingers can occlude weapon where they wrap around it).
        // depthWrite FALSE so the main render preserves the viewmodel
        // depth values written by render-target.ts's pre-pass.
        m.depthTest = true;
        m.depthWrite = false;
        m.transparent = false;
        m.needsUpdate = true;
        applyViewmodelDepthWebGPU(m);   // WebGPU: write own depth (no pre-pass) so parts self-occlude
        const em = (m as THREE.MeshStandardMaterial).emissive;
        if (gleamCollect && em && typeof em.getHex === 'function') {
          const mat = m as THREE.MeshStandardMaterial;
          flashMats.push({ mat, base: em.getHex(), baseIntensity: mat.emissiveIntensity ?? 1 });
        }
      }
      mesh.renderOrder = order;
    });
  }

  function mount(spec: ModelSpec | null) {
    unmount();
    flashMats.length = 0;
    gleaming = false;
    heldInit = false;   // new weapon snaps to its own pose, doesn't ease from the old

    // Shared composition: build hand + weapon, align grip → palm,
    // curl fingers to the grip's thickness. Same code path the bench
    // uses, so what we see in the iteration tool is what we get
    // in-game (minus this file's depth-test trick).
    const composed = composeHeldWeapon(spec);
    // The hand is rigid in play (finger curl baked per weapon; only the whole
    // group bobs), so collapse its ~88 bone meshes into a handful — it's drawn
    // twice a frame (depth pre-pass + main), so this is a big always-on win.
    // Slots survive (arm IK reads the wrist; weapon stays on palm_anchor); the
    // weapon subtree is excluded.
    mergeRigidViewmodel(composed.hand.group, null);   // weapon is a SIBLING now, not nested
    // Hand renders one step under the weapon so the weapon visually
    // wraps in front of the closed fist where they overlap (blade
    // emerges from the top of the fist, not behind it). Hand opts
    // out of gleamCollect — it has no emissive.
    applyViewmodelRender(composed.hand.group, 998, false);
    if (composed.weapon) {
      applyViewmodelRender(composed.weapon.group, 999, true);
      // Whip-class weapons have a named bead chain — wire its ripple
      // animator off the WEAPON's parts (not the hand's).
      whippy = setupWhipChain(composed.weapon.parts);
      bladeTipSlot = composed.weapon.slots.get('blade_tip') ?? null;
    } else {
      whippy = false;
      bladeTipSlot = null;
    }

    group.add(composed.group);
    // Capture the hand's wrist slot for the arm IK to target each
    // frame. The arm spec is mounted separately under the camera; the
    // IK reads this slot's world position to know where to point the
    // arm chain.
    handWristSlot = composed.hand.slots.get('wrist') ?? null;
    // Cache the palm's rest geometry for the wrist solver. Rest = the
    // authored compose pose, before any runtime re-aim: the weapon's
    // grip sits exactly at the palm's rest point, so re-pinning the
    // palm there keeps the fist closed on the hilt no matter how the
    // hand re-aims.
    wristAim.reset();
    wristAimReady = false;
    const palmSlot = composed.hand.slots.get('palm_anchor');
    const wristSlot = composed.hand.slots.get('wrist');
    if (palmSlot && wristSlot && composed.weapon) {
      composed.group.updateMatrixWorld(true);
      palmSlot.getWorldPosition(_palmRestInGroup);
      composed.group.worldToLocal(_palmRestInGroup);
      palmSlot.getWorldPosition(_palmInHandRoot);
      composed.hand.group.worldToLocal(_palmInHandRoot);
      // The anatomy target is authored in the WRIST frame; the solver
      // rotates the hand ROOT — map it through the wrist slot's pose.
      wristAim.setDesiredFromWristFrame(FOREARM_EXIT_DESIRED, wristSlot.quaternion);
      wristAimReady = true;
    }
    // Track the live composed so the settings-change handler can flip
    // the axes overlay on the current rig without waiting for the next
    // weapon equip.
    currentComposed = composed;
    const axesMaps: Array<Map<string, THREE.Object3D>> = [composed.hand.slots, armBuilt.slots];
    if (composed.weapon) axesMaps.push(composed.weapon.slots);
    setHandAxesOverlay(axesMaps, getSettings().debugHandAxes);
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
    // Whip ripple — secondary motion on the bead chain (no-op for other weapons).
    // In repose (not update) so a debug-posed frozen snap shows it too. Bead
    // positions are local children, independent of the group pose below.
    if (whippy) tickWhipChain(swing.getPhase(), swing.getPhaseProgress(), Number.isFinite(dt) ? dt : 0);
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
      // Pull-back: retract Z toward camera when a wall is closer than the
      // pull threshold (viewmodel-pullback.ts). Camera-local +Z = toward camera.
      const pull = getViewmodelPullback();
      group.position.set(heldPose.x, heldPose.y, heldPose.z + pull);
      group.rotation.set(heldPose.rotX + sway.pitch, heldPose.rotY + sway.yaw, heldPose.rotZ);
      return;
    }

    // windup / strike / recover — interpolate the step's pose curve by the
    // sim's reported progress through the current phase. Crisp (no smoothing),
    // but sync heldPose so the swing→idle handoff continues from exactly here.
    // Sway is INTENTIONALLY skipped mid-swing — the strike animation is the
    // feel-critical motion; layering sway on top muddies the snap.
    const pose = computeWeaponPose(step.pose, phase, swing.getPhaseProgress());
    const pull = getViewmodelPullback();
    // Narrow the lateral swing arc: pull the SIDEWAYS components (x / rotY /
    // rotZ) toward the rest pose by the weapon's swingArc so wide sweeps don't
    // wrap almost behind the player. Forward depth (z) + pitch (rotX) are left
    // intact — thrusts/reach unaffected. swingArc resolves per-CLASS with a
    // per-weapon override (weapon-classes.ts); the authored pose data + its pin
    // test are untouched.
    const k = getCurrentWeapon().swingArc ?? 1;
    const sx  = STANDARD_IDLE.x   + (pose.x   - STANDARD_IDLE.x)   * k;
    const srY = STANDARD_IDLE.rotY + (pose.rotY - STANDARD_IDLE.rotY) * k;
    const srZ = STANDARD_IDLE.rotZ + (pose.rotZ - STANDARD_IDLE.rotZ) * k;
    group.position.set(sx, pose.y, pose.z + pull);
    group.rotation.set(pose.rotX, srY, srZ);
    setHeld(sx, pose.y, pose.z, pose.rotX, srY, srZ);
  }

  // Deflect "catch" transient — snaps to 1 on parryRaise(), eases to 0.
  // Layered over the reposed pose each frame so it reads on idle OR swing.
  let parryRaiseAmt = 0;
  function parryRaise() { parryRaiseAmt = 1; }

  // DRINK STOW — eased 0→1 while the flask channel runs (flask-drink.ts).
  // The weapon hand drops out of the frame bottom-right, and the arm IK
  // below retargets onto the flask hand's wrist (flask-viewmodel.ts), so
  // the ONE right arm visibly puts the weapon away and raises the flask.
  let drinkStow = 0;
  const _flaskWristWorld = new THREE.Vector3();

  function update(dt: number) {
    swing.advance(dt);
    repose(dt);
    // Layer the deflect catch: weapon lifts + tilts up into a guard, then
    // settles. Added AFTER repose (which fully sets the pose) and BEFORE the
    // arm IK below, so the hand follows the raised blade.
    if (parryRaiseAmt > 0.001) {
      const k = parryRaiseAmt * parryRaiseAmt * (3 - 2 * parryRaiseAmt);   // smooth
      group.position.y += 0.15 * k;
      group.position.z += 0.06 * k;     // toward camera (camera-local +Z)
      group.rotation.x -= 0.55 * k;     // blade tips up — the catch
      group.rotation.z += 0.28 * k;     // canted across, a guard angle
      parryRaiseAmt = Math.max(0, parryRaiseAmt - dt * 5);   // ~0.2s settle
    }
    // Layer the drink stow: weapon sinks off frame bottom-right while the
    // flask hand rises (drinks only START from idle, and any real action
    // cancels the drink — so this never fights an active swing pose).
    {
      const stowTarget = isDrinkingFlask() ? 1 : 0;
      const effDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      drinkStow += (stowTarget - drinkStow) * (1 - Math.exp(-12 * effDt));
      if (drinkStow < 0.001) drinkStow = 0;
      if (drinkStow > 0) {
        const k = drinkStow * drinkStow * (3 - 2 * drinkStow);   // smooth
        // Sink AND pitch the blade forward-down hard — a long blade held
        // upright never clears the frame on translation alone; tipping it
        // past horizontal drops the whole silhouette below the bottom edge
        // in one motion (the natural "lower your sword" move).
        group.position.x += 0.10 * k;
        group.position.y -= 0.50 * k;
        group.position.z += 0.06 * k;   // toward camera — clears the frame edge faster
        group.rotation.x += 1.15 * k;   // blade tips down past horizontal
      }
    }
    // ── ARM IK ──────────────────────────────────────────────────────
    // Solve in arm-local (= camera-local) space, then DIRECTLY
    // position the bone meshes from the IK's shoulderPos/elbowPos/
    // wristPos. Bypassing the joint-rotation cascade guarantees the
    // bones span their endpoints exactly — no rotation-axis
    // approximation can leave a gap at the wrist.
    if (armIK && armShoulderSlot && handWristSlot && dt > 0) {
      group.updateMatrixWorld(true);
      handWristSlot.getWorldPosition(_wristWorld);
      // Drink retarget: while the flask is up, the arm follows the FLASK
      // hand's wrist (one frame stale — flask-viewmodel ticks later in the
      // frame; the IK's damping hides it, same as the lamp arm). Blended by
      // the eased stow amount so the handoff is a reach, not a snap.
      if (drinkStow > 0.001 && getFlaskWristWorld(_flaskWristWorld)) {
        const k = drinkStow * drinkStow * (3 - 2 * drinkStow);
        _wristWorld.lerp(_flaskWristWorld, k);
      }
      armGroup.worldToLocal(_wristArmLocal.copy(_wristWorld));
      const r = armIK.solve(_wristArmLocal, dt);
      // Re-aim the hand at the live forearm (camera-local frame: the
      // arm group sits at camera identity, and the hand's parent
      // chain is group → composed.group(identity) → hand root, so the
      // parent orientation is just `group`'s). Then re-pin the palm
      // to the weapon grip so the fist stays closed on the hilt.
      if (wristAimReady && currentComposed) {
        const handRoot = currentComposed.hand.group;
        _parentQuat.copy(group.quaternion);
        handRoot.quaternion.copy(wristAim.solve(_parentQuat, r.elbowPos, r.wristPos, dt));
        handRoot.position
          .copy(_palmRestInGroup)
          .sub(_aimScratch.copy(_palmInHandRoot).applyQuaternion(handRoot.quaternion));
      }
      poseBone(armHumerusMesh, r.shoulderPos, r.elbowPos);
      poseBone(armRadiusMesh,  r.elbowPos, r.wristPos, -0.013);
      poseBone(armUlnaMesh,    r.elbowPos, r.wristPos,  0.013);
      poseBone(armSinewMesh,   r.elbowPos, r.wristPos);
      // Pin the shoulder + elbow joint slots so the joint-marker
      // spheres parented to them follow the IK positions.
      armShoulderSlot.position.copy(r.shoulderPos);
      const elbowMarkerSlot = armBuilt.slots.get('elbow');
      if (elbowMarkerSlot) {
        // Elbow slot is parented to shoulder. Convert elbow world
        // (= elbow arm-local since arm-local frame is world frame
        // for the arm group when armGroup is at camera identity)
        // into shoulder-local.
        elbowMarkerSlot.parent?.worldToLocal(_midpoint.copy(r.elbowPos));
        elbowMarkerSlot.position.copy(_midpoint);
        elbowMarkerSlot.rotation.set(0, 0, 0);
      }
      armShoulderSlot.rotation.set(0, 0, 0);
    }
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
    // CHARGED-STRIKE GLOW — amplify each flashMat's emissive intensity in
    // proportion to the captured charge during STRIKE ONLY. The glow ramps
    // in smoothly so a charged release lights the blade as the strike fires,
    // then SNAPS OFF the instant the strike ends — no residual amber during
    // the recover / pull-back. The blade is hot during the stab, dark after.
    // (The blade-trail effect reads chargedGlow too, so its head also stops
    // sampling new points the moment we leave strike.)
    {
      const ph = swing.getPhase();
      const glowTarget = (chargedSwingLevel > 0 && ph === 'strike') ? chargedSwingLevel : 0;
      if (ph === 'idle') chargedSwingLevel = 0;
      if (glowTarget === 0) {
        chargedGlow = 0;
      } else {
        const effDt = dt === Infinity ? 0.016 : Math.max(0, dt);
        const k = 1 - Math.exp(-CHARGED_GLOW_EASE * effDt);
        chargedGlow += (glowTarget - chargedGlow) * k;
      }
      if (chargedGlow > 0.0005) {
        const intensityMul = 1 + chargedGlow * CHARGED_GLOW_MAX;
        for (const f of flashMats) f.mat.emissiveIntensity = f.baseIntensity * intensityMul;
        emissiveElevated = true;
      } else if (emissiveElevated) {
        for (const f of flashMats) f.mat.emissiveIntensity = f.baseIntensity;
        emissiveElevated = false;
        chargedGlow = 0;
      }
    }
  }

  // Mount the hand from frame 0 — the viewmodel is never truly empty,
  // even before the starter altar runs its first equip(). An empty
  // weapon slot reads as "fists raised", not "nothing on screen."
  mount(null);

  function setDebugPhase(p: SwingPhase, t: number) {
    swing.setDebugPhase(p, t);
    repose();
  }

  /** Position a bone-cylinder mesh to span two arm-local endpoints.
   *  Sits at the midpoint, +Y aligned with the from→to direction,
   *  height left untouched (the mesh was built at the right length).
   *  `lateral` shifts the midpoint perpendicular to the bone axis for
   *  dual-bone forearms (radius / ulna). */
  function poseBone(
    mesh: THREE.Mesh | undefined,
    from: THREE.Vector3,
    to: THREE.Vector3,
    lateral = 0,
  ): void {
    if (!mesh) return;
    _midpoint.addVectors(from, to).multiplyScalar(0.5);
    _direction.subVectors(to, from);
    const len = _direction.length();
    if (len < 1e-6) return;
    _direction.divideScalar(len);
    mesh.position.copy(_midpoint);
    if (lateral !== 0) {
      // Perpendicular shift in the arm-local X direction — for
      // radius/ulna paired bones. Small enough to read as "side-by-
      // side" without needing a frame-by-frame perpendicular basis.
      mesh.position.x += lateral;
    }
    mesh.quaternion.setFromUnitVectors(_yAxis, _direction);
  }

  function equip(spec: ModelSpec | null) {
    // Always mount — null = fists only (no weapon parented). The hand
    // is the floor of the viewmodel; there's no "empty viewmodel"
    // state in this build.
    mount(spec);
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
    interruptSwing: swing.interruptSwing,
    setSwingCharge(level: number) {
      chargedSwingLevel = Math.max(0, Math.min(1, level));
    },
    getChargedStrikeGlow() {
      return chargedGlow;
    },
    getBladeTipWorldPos(out: THREE.Vector3): THREE.Vector3 | null {
      if (!bladeTipSlot) return null;
      bladeTipSlot.getWorldPosition(out);
      return out;
    },
    update,
    parryRaise,
    equip,
    breakCombo: swing.breakCombo,
    setDebugPhase,
  };
}
