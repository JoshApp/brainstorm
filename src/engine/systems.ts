import * as THREE from 'three';
import type { GameSystem } from './loop';
import type { LiveLevel } from '../level/builder';
import type { RoomCuller } from '../level/room-culling';
import type { createTouchInput } from '../controls/input';
import type { createCombatSystem } from '../combat/attack';
import type { createWeaponViewmodel } from '../player/viewmodel';

import { updateTorchlight } from '../scene/torchlight';
import { tickEncounters } from '../encounters/registry';
import { updateCamera } from '../controls/camera';
import { tickLamp } from '../player/handheld-lamp';
import { tickAmbientLight, applyAmbientWick, applyDaylight } from '../settings/ambient-light';
import { tickArrivalThreshold, endArrivalThreshold } from '../player/arrival';
import { tickLampArm } from '../player/lamp-arm';
import { tickOffhandViewmodel } from '../player/handheld-offhand';
import { tickFlaskDrink } from '../player/flask-drink';
import { tickFlaskViewmodel } from '../player/flask-viewmodel';
import { tickFlaskDrinkUi } from '../controls/consumable-bar';
import { setBobTarget, updateBob } from '../player/viewmodel-bob';
import { updateViewSway } from '../player/viewmodel-sway';
import { tickViewmodelPullback } from '../player/viewmodel-pullback';
import { updateLampReveal } from '../scene/lamp-reveal';
import { isDying } from '../player/death';
import { isFogWalkthroughActive, tickFogWalkthrough } from '../player/fog-walkthrough';
import { renderWithStyle, setDarkAdapt } from '../style/render-frame';
import { flushLux, luxPending } from '../debug/lux';
import { tickSurfaceSeep } from '../style/surface-detail';
import { flushSplats } from '../scene/splat-map';
import { tickGoreWebGPU } from '../scene/gore-webgpu';
import { isInspectActive, INSPECT_AMBIENT, tickInspectFraming } from '../debug/inspect-mode';
import { setTorchProximity, setAudioListenerPose } from '../audio/sfx';
import { tickAlerts } from '../mobs/alerts';
import { tickPack } from '../mobs/pack';
import { tickExploredMap } from '../level/explored-map';
import { recomputePlayerStats } from '../state/player-stats';
import { syncHudStores } from '../state/hud-stores';
import { tickDarkAdaptation, darkAdaptBrightness, sampleLitSignal } from '../scene/dark-adaptation';
import { updateDarkAdaptReadout } from '../debug/dark-adapt-readout';
import { updateBossEncounterReadout } from '../debug/boss-encounter-readout';
import { tickThresholdDrafts } from '../scene/threshold-draft';
import { isAnyScreenOpen } from '../ui/screen-manager';
import { isDescendTransition } from '../ui/descent-fade';
import { tickAllBuffs } from '../ecs/buffs';
import { tickInteractables, getInRangeInteractable, resolveUsable } from '../interactables/system';
import { consumeInteractPressed } from '../controls/interact-input';
import { isBusInstalled } from '../harness/intent';
import { consumeAttackPressed } from '../controls/attack-input';
import { consumeDash } from '../controls/dash-input';
import { setDodgeButtonAim, tickDodgeButton } from '../controls/dodge-button';
import { tickParryButton } from '../controls/parry-button';
import { captureStep } from '../harness/run-recorder';
import { tryDash, setDashOver, noteDashOverFired } from '../combat/dash';
import { consumeRiposte } from '../combat/reactive-defense';
import { updateSwingAgency } from '../combat/swing-agency';
import { canStartAction, enterDodge } from '../combat/player-action';
import { CONFIG } from '../config';
import { getCurrentWeapon } from '../player/current-weapon';
import { tickLightPool } from '../scene/light-pool';
import { tickProjectiles } from '../combat/projectile-pool';
import { tickStamina } from '../combat/stamina';
import { hpDrainAmount } from '../combat/transforms';
import { isInCombat } from '../combat/combat-state';
import { bleedPlayer, redThirstFloorHp } from '../player/health';
import { tickExhaustionHaptic } from '../combat/exhaustion-haptic';
import { tickExhaustionFeedback } from '../combat/exhaustion-feedback';
import { tickBreath } from '../effects/breath';
import { tickCameraStumble } from '../combat/camera-stumble';
import type { DelveRenderer } from '../scene/create-renderer';
import { tickHazardFields } from '../combat/hazard-field';
import { tickXpWisps } from '../effects/xp-wisps';
import { tickGoldCoins } from '../effects/gold-coins';
import { tickTutorialHints } from '../effects/tutorial-hints';
import { tickDriftingMotes } from '../effects/drifting-motes';
import { tickSlowmoPresentation } from '../effects/slowmo-presentation';
import { applyFov } from '../effects/camera-fov';
import { tickBladeTrail, setBladeTrailIntensity } from '../effects/blade-trail';
import { tickRoomMood } from '../level/room-mood';
import { tickShatterBurst } from '../effects/shatter-burst';
import { tickFlungParts } from '../effects/flung-parts';
import { tickBloodBurst } from '../effects/blood-burst';
import { tickDustPuff } from '../effects/dust-puff';
import { tickSpriteBatch } from '../scene/sprite-batch';
import { tickFlameMeshBatch } from '../scene/flame-mesh-batch';
import { tickParrySpark } from '../effects/parry-spark';
import { tickArenaLightArc } from '../feedback/arena-light-arc';
import { tickStatusVfx } from '../effects/status-vfx';
import { updateOutline, updateOutlinePxScale } from '../interactables/outline';
import { updateInteractLabel } from '../ui/interact-label';
import { tickItemPreviews } from '../ui/item-preview';
import { tickItemOverlay } from '../ui/item-overlay';
import { setFlyContext } from '../ui/fly-to-hud';
import { tickBossBar } from '../ui/boss-bar';
import { updateBuffBar } from '../ui/buff-bar';
import { updateXpGoldHud } from '../ui/xp-gold-hud';
import { tickXpSigil } from '../ui/xp-sigil';
import { updateDamageNumbers } from '../ui/damage-numbers';
import { tickLowHpPulse } from '../ui/vignette';
import { getPlayerHp, getPlayerMaxHp } from '../player/health';
import { tickShake, kickShake } from '../combat/screen-shake';

// The per-frame system list, extracted from main.ts. The frame is an ordered
// list of systems (engine/loop.ts); each declares a phase ('unpaused' skips
// while the world is paused, 'always' runs every frame) so freeze behaviour is
// data, not nested control flow. Order = execution order.
//
// main.ts used to close these over module-global `camera`/`input`/`currentLevel`
// etc. directly. buildSystems makes that coupling EXPLICIT: the frame loop's
// entire dependency surface is the SystemDeps interface below — one place to
// see everything a frame touches. `getLevel()` (not a captured value) because
// the active level handle is reassigned on every floor load.

export type LiveLevelHandle = LiveLevel & { checkRoomClear?: () => void };

export interface SystemDeps {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  renderer: DelveRenderer;
  ambient: THREE.AmbientLight;
  canvas: HTMLCanvasElement;
  input: ReturnType<typeof createTouchInput>;
  combat: ReturnType<typeof createCombatSystem>;
  weapon: ReturnType<typeof createWeaponViewmodel>;
  /** Reused scratch vectors, owned by main so shake/render share one. */
  shakeOffset: THREE.Vector3;
  forwardScratch: THREE.Vector3;
  /** The active level handle — read fresh each frame (reassigned on load). */
  getLevel: () => LiveLevelHandle;
  /** The active room culler, or null when culling is off. */
  getRoomCuller: () => RoomCuller | null;
}

// Red Thirst rest-bleed cadence: seconds of out-of-combat time banked toward
// the next heart lost. Module-level so it survives across the per-frame system
// rebuild-free tick; reset to 0 the moment you're in combat or the rule is off.
let thirstBleedAccum = 0;

export function buildSystems(deps: SystemDeps): GameSystem[] {
  const {
    camera, scene, renderer, ambient, canvas,
    input, combat, weapon, shakeOffset, forwardScratch, getLevel, getRoomCuller,
  } = deps;
  // Scratch vectors for the blade-trail tick — held here so we don't allocate
  // per frame inside the system closure.
  const _trailTipScratch = new THREE.Vector3();
  const _trailCamScratch = new THREE.Vector3();
  const _lampFwd = new THREE.Vector3();
  // DEV: __kick(mag,dur) fires a manual screen shake from the console for feel-tuning.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    w.__kick = (mag = 0.5, dur = 1.0): void => kickShake(mag as number, dur as number);
  }

  return [
    // Publish this frame's attack COMMITMENT (move/turn agency + dash-lock) from
    // the live swing phase + progress + equipped weapon's weight, BEFORE
    // input-camera and dash read it. Progress shapes the arc (ease in on windup,
    // ease out on recover). One frame of latency vs the sim's advance (later in
    // the frame) is imperceptible for feel.
    { name: 'swing-agency', kind: 'sim', phase: 'unpaused', tick() {
      updateSwingAgency(weapon.getPhase(), getCurrentWeapon().commitment, weapon.getPhaseProgress());
    } },
    // Look/move input + camera. While dying, control input is dropped so
    // nothing downstream (camera, bob) reads stale joystick values.
    { name: 'input-camera', kind: 'sim', phase: 'unpaused', tick(ctx) {
      if (isDescendTransition()) {
        // Loading / descent transition (the screen is black): drop ALL player
        // input so you can't move or turn behind the load veil.
        input.lookDx = 0;
        input.lookDy = 0;
        input.moveX = 0;
        input.moveY = 0;
      } else if (isFogWalkthroughActive()) {
        // Soulslike fog-gate entry has the camera — drop player input and let
        // the forced walk drive position. realDt so the step is steady and
        // never freezes on a hit-pause.
        input.lookDx = 0;
        input.lookDy = 0;
        input.moveX = 0;
        input.moveY = 0;
        tickFogWalkthrough(ctx.realDt);
      } else if (!isDying()) {
        input.tickInput(ctx.playerDt);   // PLAYER clock — full speed in bullet-time
        // Run recorder: capture this step's resolved intent (move/look + peeked
        // attack/dodge) BEFORE updateCamera consumes the look delta. No-op
        // branch when not recording — zero cost on the default path.
        const level = getLevel();
        // Enemy centroid for the run recorder's checkpoints (combat-divergence
        // debugging — does a fight diverge with the enemies or the player?).
        let ne = 0, ecx = 0, ecz = 0;
        for (const en of level.enemies) { if (en.alive) { ne++; ecx += en.position.x; ecz += en.position.z; } }
        captureStep(input, camera.position.x, camera.position.z, ne, ne ? ecx / ne : 0, ne ? ecz / ne : 0);
        updateCamera(camera, input, ctx.playerDt, level.walkable, level.enemies);
      } else {
        input.lookDx = 0;
        input.lookDy = 0;
        input.moveX = 0;
        input.moveY = 0;
      }
    } },

    // Dash / dodge. Resolves the pending double-tap (touch) / Shift (desktop)
    // into a world-space lunge. Camera-relative direction (dx strafe, dy
    // forward-sign like the joystick) → world via the camera's facing; (0,0)
    // backsteps. Runs in 'unpaused' so it stops with the world, and after
    // input-camera so it reads this frame's facing.
    { name: 'dash', kind: 'sim', phase: 'unpaused', tick() {
      // The dodge BUTTON dodges the way the stick is ALREADY pointing, which is
      // the whole reason it doesn't take the steering thumb. Feed it this
      // frame's move vector before anything consumes the dash, and tick its
      // hold→sprint promotion here so both live in the same place as the dodge
      // they belong to.
      setDodgeButtonAim(input.moveX, input.moveY);
      tickDodgeButton();
      // Brightens while a deflectable strike is live — the timing cue rides the
      // button, so the thumb already knows where to be.
      tickParryButton();
      if (isDying() || isFogWalkthroughActive() || isDescendTransition()) return;
      // The action FSM arbitrates: no roll out of a swing's committed frames
      // or during a parry beat. Checked BEFORE consuming, so the input stays
      // pending and fires the instant the lock clears (roll-cancel buffer).
      if (!canStartAction('dodge')) return;
      const d = consumeDash();
      if (!d) return;
      camera.getWorldDirection(forwardScratch);
      const flen = Math.hypot(forwardScratch.x, forwardScratch.z) || 1;
      const fX = forwardScratch.x / flen, fZ = forwardScratch.z / flen;
      // right = forward rotated -90° about Y (matches updateCamera's basis).
      const rX = -fZ, rZ = fX;
      let wx: number, wz: number;
      if (d.dx === 0 && d.dy === 0) {
        wx = -fX; wz = -fZ;                         // neutral → backstep
      } else {
        wx = rX * d.dx + fX * (-d.dy);              // strafe + forward(−dy)
        wz = rZ * d.dx + fZ * (-d.dy);
      }
      // LANDING CHECK (dash-over): this roll vaults DASHABLE obstacles/gaps only
      // if it would clear onto valid floor within reach — else they block it like
      // a wall (stop at the edge, never inside). Decided up-front, before the dash.
      const walkable = getLevel()?.walkable ?? null;
      const dlen = Math.hypot(wx, wz) || 1;
      const reach = CONFIG.STAMINA.DASH_OVER_REACH;
      const over = !!walkable && walkable.canDashOver(
        camera.position.x, camera.position.z,
        camera.position.x + (wx / dlen) * reach, camera.position.z + (wz / dlen) * reach,
        0.3,   // matches camera's PLAYER_RADIUS
      );
      // On a real dodge, commit the FSM 'dodging' beat (≈ the i-frame window)
      // so it locks out attack/parry for the roll's duration. Only arm the vault
      // when the dash actually fires — a cooldown-blocked tap shouldn't leave the
      // flag hot for the next frame.
      if (tryDash(wx, wz)) {
        setDashOver(over);
        if (over) noteDashOverFired(wx, wz);
        enterDodge(CONFIG.STAMINA.DASH_IFRAME_S);
      }
    } },

    { name: 'torchlight', phase: 'unpaused', tick(ctx) {
      const cam = camera.position;
      for (const t of getLevel().torches) {
        const dx = t.position.x - cam.x, dz = t.position.z - cam.z;
        updateTorchlight(t, ctx.scaledDt, Math.hypot(dx, dz));
      }
      // Threshold dust + proximity haze. realDt so the drift doesn't stutter in
      // slow-mo; haze blooms by player proximity.
      tickThresholdDrafts(ctx.realDt, camera.position);
    } },

    // Effective torchlight at the player — torches within earshot AND with a
    // clear line of sight (one behind a wall neither lights nor sounds here).
    // Drives both the ambient crackle volume and the eye dark-adaptation signal.
    { name: 'torch-audio', phase: 'unpaused', tick(ctx) {
      // Earshot for the torch crackle audio — kept tight so distant
      // wall torches don't bleed into the player's earpiece. Visual
      // lit-signal below uses a much wider range so dark-adapt
      // doesn't over-adapt in actually-torchlit halls.
      const earRange = 6;
      const walkable = getLevel().walkable;
      const cx = camera.position.x;
      const cz = camera.position.z;

      // Torch crackle volume — LOS torch proximity at the player's position.
      let prox = 0;
      for (const t of getLevel().torches) {
        const dx = t.position.x - cx;
        const dz = t.position.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= earRange) continue;
        if (walkable && !walkable.hasLineOfSight(cx, cz, t.position.x, t.position.z)) continue;
        prox += 1 - d / earRange;
      }
      setTorchProximity(prox);

      // Update the Web Audio listener pose so positional sounds (enemy
      // growls, impacts, loot landing) pan + attenuate relative to the
      // camera. forwardScratch is filled by the dark-adapt step below;
      // here we use the camera's world direction directly so this tick
      // doesn't depend on which block runs first.
      camera.getWorldDirection(forwardScratch);
      setAudioListenerPose(
        camera.position.x, camera.position.y, camera.position.z,
        forwardScratch.x, forwardScratch.y, forwardScratch.z,
      );

      // Eye dark-adaptation keys off an analytic estimate of the light reaching
      // the eye (no GPU readback). The sampling math lives in dark-adaptation.ts;
      // forwardScratch was filled with the camera direction above. realDt so it
      // adjusts at real-time, not the death slow-mo.
      const fl = Math.hypot(forwardScratch.x, forwardScratch.z) || 1;
      const fx = forwardScratch.x / fl;
      const fz = forwardScratch.z / fl;
      const lit = sampleLitSignal(cx, cz, fx, fz, getLevel().torches, walkable);

      const adapt = tickDarkAdaptation(lit, ctx.realDt);
      // PS1 path ignores renderer tone mapping (render-to-target), so the dark
      // lift lives in the blit shader (additive shadow-raise). Ambient is a
      // secondary fill (applied during the scene render, so it works there).
      setDarkAdapt(adapt);
      // Keep the ambient CONSTANT. Its fill colour is a COOL 0x1a1e24, so ramping
      // it with dark-adaptation flooded the whole image with cool/green and
      // bloom-blur. The dark-adapt softening lives in the grade's shader lift
      // (render-webgpu.ts) instead — warm, darkness-weighted, leaves the lit side
      // alone.
      ambient.intensity = isInspectActive() ? INSPECT_AMBIENT
        : CONFIG.AMBIENT_INTENSITY;
      updateDarkAdaptReadout(lit, adapt, darkAdaptBrightness());
    } },

    { name: 'combat', kind: 'sim', phase: 'unpaused', tick(ctx) {
      // Consume the press either way (so it can't buffer and fire on landing), but
      // only ACT on it when not dying / behind the load veil.
      const pressed = isDying() ? false : consumeAttackPressed();
      // Swinging counts as starting to play, even from a standstill — a tap on
      // the attack button leaves no stick or look delta for the threshold
      // system to notice (see player/arrival.ts).
      if (pressed) endArrivalThreshold();
      const attackPressed = isDescendTransition() ? false : pressed;
      combat.tick(attackPressed, input.moveX, input.moveY, ctx.playerDt);
    } },

    // Walk bob — sword + lamp + offhand viewmodels all read the same shared
    // bob. realDt so the sway keeps a steady rhythm through slow-mo. Target
    // intensity = joystick magnitude (zeroed when not in control so the
    // viewmodel settles during death).
    { name: 'viewmodel-bob', phase: 'unpaused', tick(ctx) {
      const playing = ctx.playing;
      setBobTarget(playing ? Math.hypot(input.moveX, input.moveY) : 0);
      updateBob(ctx.realDt, playing);
    } },

    // View-sway — held viewmodels lag behind the camera when you turn,
    // then settle. realDt so the inertia reads steady through slow-mo.
    // Must precede 'weapon' / 'lamp' / 'offhand' so they all read this
    // frame's value.
    { name: 'view-sway', phase: 'unpaused', tick(ctx) {
      updateViewSway(ctx.realDt, camera);
    } },

    // Viewmodel pull-back — retract held weapon + lamp + arms toward
    // the camera when a wall is closer than the pull threshold. MUST
    // run BEFORE 'weapon' and 'lamp' so they read this frame's value.
    { name: 'viewmodel-pullback', phase: 'unpaused', tick(ctx) {
      tickViewmodelPullback(ctx.realDt, camera, getLevel()?.walkable ?? null);
    } },

    { name: 'weapon', kind: 'sim', phase: 'unpaused', tick(ctx) {
      // A clean deflect this frame → the weapon snaps up into the catch beat.
      if (consumeRiposte() && !isDescendTransition()) weapon.parryRaise();
      weapon.update(ctx.playerDt);
    } },

    // Blade trail — sampled from the wielded weapon's blade_tip in WORLD
    // space (scene-local), brightness driven by the viewmodel's charged-
    // strike glow. Runs AFTER 'weapon' so the just-updated tip position
    // and live glow are this-frame fresh. realDt so the trail's fade
    // cadence is real-time even through hit-pause.
    { name: 'blade-trail', phase: 'unpaused', tick(ctx) {
      setBladeTrailIntensity(weapon.getChargedStrikeGlow());
      const tip = weapon.getBladeTipWorldPos(_trailTipScratch);
      camera.getWorldPosition(_trailCamScratch);
      tickBladeTrail(ctx.realDt, tip, _trailCamScratch);
    } },

    // Stamina regen. 'unpaused' so it pauses with the world (menus,
    // hit-pause); scaledDt so a charged hit's freeze doesn't refill you.
    { name: 'stamina', kind: 'sim', phase: 'unpaused', tick(ctx) { tickStamina(ctx.scaledDt); } },

    // The flask drink channel (raise→sip→lower). playerDt: freezes with
    // hit-pause but is NOT slowed by reactive-defense bullet-time — the slow
    // world after a clean dodge is exactly the moment the drink is for.
    { name: 'flask-drink', kind: 'sim', phase: 'unpaused', tick(ctx) { tickFlaskDrink(ctx.playerDt); } },

    // TRANSFORM out-of-combat bleed (Red Thirst): while a held fate drains HP
    // and you're NOT fighting, you bleed — but in discrete HEART increments on a
    // slow cadence, and only DOWN TO A FLOOR (half health). Resting weakens you;
    // it never drags you to the near-death "floating" state the old smooth 2 HP/s
    // drain did. 'unpaused' + scaledDt so it stops in menus / hit-pause.
    { name: 'transform-drain', kind: 'sim', phase: 'unpaused', tick(ctx) {
      const perTick = hpDrainAmount('out-of-combat');   // HP per heart-tick (0 = rule off)
      if (perTick <= 0 || isInCombat()) { thirstBleedAccum = 0; return; }
      thirstBleedAccum += ctx.scaledDt;
      if (thirstBleedAccum < CONFIG.RED_THIRST.DRAIN_INTERVAL_S) return;
      thirstBleedAccum = 0;
      bleedPlayer(perTick, redThirstFloorHp());
    } },

    // Gassed = felt: a heartbeat haptic while exhausted. realDt so the cadence
    // is steady through slow-mo / hit-pause; 'unpaused' so it stops in menus.
    { name: 'exhaustion-haptic', phase: 'unpaused', tick(ctx) { tickExhaustionHaptic(ctx.realDt); } },

    // Felt-stamina: breathing audio + camera chest-heave that ramp as you tire.
    // realDt for a steady breath cadence; 'unpaused' so it quiets in menus.
    { name: 'exhaustion-feedback', phase: 'unpaused', tick(ctx) { tickExhaustionFeedback(ctx.realDt); tickBreath(ctx.realDt); } },

    // Stumble lurch decay — realDt so the off-balance recover is steady.
    { name: 'camera-stumble', phase: 'unpaused', tick(ctx) { tickCameraStumble(ctx.realDt); } },

    // Handheld lamp flicker + bob. realDt — flicker shouldn't slow during
    // slow-mo (a frozen lamp looks broken). Phase 'always': in FROZEN
    // debug scenarios an unpaused-only lamp/arm never posed, so every
    // frozen-scenario screenshot showed the arm meshes parked UNPOSED
    // at the camera — a giant lamp-lit slab across the frame. The lamp
    // is presentation, not simulation; pose it in every rendered frame.
    { name: 'lamp', phase: 'always', tick(ctx) { tickLamp(ctx.realDt); } },
    // THE THRESHOLD ends the moment the player does anything (player/arrival.ts).
    // Read from the same input the movement system reads, so "did they act?" is
    // one question asked in one place rather than a hook on every control.
    {
      name: 'arrival-threshold', phase: 'unpaused',
      tick(ctx) {
        tickArrivalThreshold(ctx.realDt);
        const moved = Math.abs(input.moveX) > 0.08 || Math.abs(input.moveY) > 0.08;
        const looked = Math.abs(input.lookDx) > 1.5 || Math.abs(input.lookDy) > 1.5;
        if (moved || looked) endArrivalThreshold();
      },
    },
    // The ROOM YOU ARE ACTUALLY IN — eases the ambient-light sensor's reading and
    // re-targets the wick when it has moved (settings/ambient-light.ts). realDt +
    // 'always': the sun does not pause when you open a menu, and coming back to a
    // brightly-lit screen after pausing indoors is exactly when you'd notice. A
    // no-op on every device without a readable sensor, which is most of them.
    { name: 'ambient-light', phase: 'always', tick(ctx) { tickAmbientLight(ctx.realDt); applyAmbientWick(); applyDaylight(); } },
    // Left arm IK — must run AFTER 'lamp' so the hinge it targets has
    // its latest position from this frame's pendulum + stowed-ease.
    { name: 'lamp-arm', phase: 'always', tick(ctx) { tickLampArm(ctx.realDt); } },

    { name: 'offhand', phase: 'unpaused', tick() { tickOffhandViewmodel(); } },

    // The drink's first-person pose + gold glow — presentation over the
    // flask-drink sim channel. realDt so the raise stays smooth through
    // slow-mo; 'unpaused' so a menu freezes the flask mid-raise.
    { name: 'flask-viewmodel', phase: 'unpaused', tick(ctx) { tickFlaskViewmodel(camera, ctx.realDt); } },
    // The flask button's drink-progress ring — early-outs to one boolean when
    // no drink is in flight.
    { name: 'flask-hud', phase: 'always', tick() { tickFlaskDrinkUi(); } },

    // Enemy sleep: skip update() for enemies far from the player — they can't
    // influence gameplay outside perception range. Threshold 25m, past the
    // deepest sight (wraith 12m). Damage path is unaffected (takeDamage
    // doesn't go through update()).
    { name: 'enemies', kind: 'sim', phase: 'unpaused', tick(ctx) {
      const level = getLevel();
      const playerX = camera.position.x;
      const playerZ = camera.position.z;
      const sleepDist2 = 25 * 25;
      // Pack coordinator: recompute encirclement/separation/tokens for the crowd
      // once, before the per-enemy update reads its ring target + asks to attack
      // (src/mobs/pack.ts).
      tickPack(ctx.scaledDt, camera.position);
      // Backward walk so we can SPLICE expired corpses in place. Splicing (not
      // reassigning) is required: builder's split-spawn closures push to this
      // exact array, so a new array would orphan future spawns.
      const arr = level.enemies;
      for (let i = arr.length - 1; i >= 0; i--) {
        const enemy = arr[i];
        // EXPIRED — dead AND the death animation has finished (tickDying removed
        // the container + disposed its geometry). Drop it from the array so dead
        // mobs don't accumulate forever (the gore-arena's endless splits leaked
        // hundreds of inert Enemy closures otherwise — they were skipped here but
        // never removed). With the array entry gone and the ECS entity already
        // destroyed on death, the whole closure is finally GC-able.
        if (!enemy.alive && !enemy.dying) { arr.splice(i, 1); continue; }
        // A DYING mob always ticks (its death anim must finish + clean itself up,
        // even if it died out past the sleep range); a LIVING mob sleeps when far.
        if (enemy.alive) {
          const dx = enemy.group.position.x - playerX;
          const dz = enemy.group.position.z - playerZ;
          if (dx * dx + dz * dz > sleepDist2) continue;
        }
        // Phasing mobs (ghosts) use the obstacle-free nav grid.
        const nav = enemy.phasing ? level.navPhasing : level.nav;
        enemy.update(ctx.scaledDt, camera.position, level.walkable, nav);
      }
      // Boss bar — a view of the boss-encounter container (membership +
      // authoritative "done"); it ticks the container internally.
      tickBossBar(ctx.scaledDt);
      updateBossEncounterReadout();   // DEV: no-op unless debug readout mounted
    } },

    // Decay active combat alerts so old broadcasts stop pulling mobs in long
    // after the player has left.
    { name: 'alerts', kind: 'sim', phase: 'unpaused', tick(ctx) { tickAlerts(ctx.scaledDt); } },

    // Lamp-reveal — feed the player/lamp world position into the shared uniform
    // every reveal material reads (wall-runes, corpse glints bloom near the
    // lamp). 'always' so it tracks the lamp even while frozen (viewer/pose/snap)
    // and a paused look-around still reveals. One write per frame, all materials.
    { name: 'lamp-reveal', phase: 'always', tick() { updateLampReveal(camera.position, camera.getWorldDirection(_lampFwd)); } },

    // XP wisps / gold coins — home in on the player and absorb on contact.
    // Live outside the enemy loop so they survive past their spawner.
    { name: 'xp-wisps', phase: 'unpaused', tick(ctx) { tickXpWisps(ctx.scaledDt, camera.position); } },
    { name: 'gold-coins', phase: 'unpaused', tick(ctx) {
      tickGoldCoins(ctx.scaledDt, camera.position, getLevel().walkable);
    } },

    // Projectiles — integrate, hit-test player + walls, retire. Outside the
    // enemy loop so a shot survives the shooter's death.
    { name: 'projectiles', kind: 'sim', phase: 'unpaused', tick(ctx) {
      tickProjectiles(ctx.scaledDt, camera.position, getLevel().walkable, camera);
    } },

    // Persistent ground hazard fields (the `field` ability action — e.g. the
    // king's acid puddle). They outlive the cast that spawned them, so they
    // tick here rather than in any enemy's update.
    { name: 'hazard-fields', kind: 'sim', phase: 'unpaused', tick(ctx) { tickHazardFields(ctx.scaledDt, camera.position); } },

    // Room-clear detection — fires room:cleared so doors flip SEALED→OPEN.
    { name: 'room-clear', kind: 'sim', phase: 'unpaused', tick() { getLevel().checkRoomClear?.(); } },
    // Encounter layer — ticks every ACTIVE encounter (arena gauntlets today;
    // boss/ritual later). Telegraph + wave advance happen inside the encounter.
    { name: 'encounters', kind: 'sim', phase: 'unpaused', tick(ctx) { tickEncounters(ctx.scaledDt, camera.position); } },

    // Active buffs on all entities (heal-over-time, DoTs, etc.).
    { name: 'buffs', kind: 'sim', phase: 'unpaused', tick(ctx) { tickAllBuffs(ctx.scaledDt); } },

    // Status VFX — colored motes off anything carrying a buff with `vfx`
    // (burn embers, poison/bleed drips). Runs after buffs so it reflects
    // the current affliction.
    { name: 'status-vfx', phase: 'unpaused', tick(ctx) {
      tickStatusVfx(scene, getLevel().enemies, camera.position, ctx.scaledDt);
    } },

    // Instanced sprite batch — folds every batched flame/wisp/glow (torch
    // wisps, candle stacks, prop glows, status motes + auras) into per-texture
    // instance buffers. Must run AFTER every system that writes a batched
    // handle this frame — torchlight (wisp colour/scale), threshold drafts,
    // and status-vfx (mote/aura position + opacity) — because the fold reads
    // their state rather than being read by them. Ticking it earlier costs a
    // frame of positional lag on anything attached to a moving mob.
    // phase 'always' so flames keep rendering (and wobbling — Date.now
    // flicker, like the old onBeforeRender) across pauses; the status pool
    // simply holds its last positions while status-vfx is gated off.
    { name: 'sprite-batch', phase: 'always', tick() { tickSpriteBatch(); tickFlameMeshBatch(); } },

    // ── always-on (run through pause/death so the screen stays live) ──

    // Drifting motes — ambient dust keeps falling through hit-pauses, death,
    // and menus (fxDt = real-time there). But during a perfect-dodge dip fxDt
    // carries the bullet-time slow, so the dust HANGS in the air with the
    // world — the "frozen air" cue.
    { name: 'motes', phase: 'always', tick(ctx) { tickDriftingMotes(ctx.fxDt, camera); } },

    // Per-room mood — smoothly blend torches + bound lights toward the room's
    // current override colour. realDt so the ease is real-time even through
    // hit-pause. Cheap: idle rooms early-out.
    { name: 'room-mood', phase: 'always', tick(ctx) { tickRoomMood(ctx.realDt); } },
    // Arena light arc — the room's brightness envelope around an encounter.
    // realDt (like room-mood): a steady real-time ease, unaffected by the
    // just-dodge slow-mo dip so the ambience doesn't crawl with it.
    { name: 'arena-light-arc', phase: 'always', tick(ctx) { tickArenaLightArc(ctx.realDt); } },
    // Shatter / blood bursts — scaled dt so shards slow-mo with the
    // hit-pause / death sequence (reads as crunchier).
    { name: 'shatter', phase: 'always', tick(ctx) { tickShatterBurst(ctx.scaledDt); tickFlungParts(ctx.scaledDt); } },
    { name: 'blood', phase: 'always', tick(ctx) { tickBloodBurst(ctx.scaledDt); } },
    { name: 'dust', phase: 'always', tick(ctx) { tickDustPuff(ctx.scaledDt); } },
    { name: 'parry-spark', phase: 'always', tick(ctx) { tickParrySpark(ctx.scaledDt); } },

    // Interact tick + world-anchored UI run OUTSIDE the freeze gate so
    // in-range detection persists through hit-pauses. dt=0 when frozen so
    // animations (chest lid, pickup bob) don't advance — only the "what's in
    // range" pass refreshes.
    { name: 'world-ui', kind: 'sim', phase: 'always', tick(ctx) {
      camera.getWorldDirection(forwardScratch);
      const interactDt = ctx.paused ? 0 : ctx.scaledDt;
      tickInteractables(interactDt, camera.position, forwardScratch);
      // Hidden while dying or any screen is open so the label doesn't poke
      // through a panel's backdrop.
      const inRange = (isDying() || isAnyScreenOpen()) ? null : getInRangeInteractable();
      // Tutorial hints — only the tutorial level spawns these; elsewhere this
      // early-returns instantly.
      tickTutorialHints(ctx.realDt, camera, canvas, camera.position);
      // Publish the live camera+canvas so pickup listeners (fly-to-hud) can
      // project a world position to screen without threading the camera through
      // the event bus.
      setFlyContext(camera, canvas);
      updateInteractLabel(inRange, camera, canvas);
      // Item-preview labels (starter / blood altars) — world→screen projection.
      tickItemPreviews(camera, canvas);
      // The see-before-you-take overlay: full item card for the focused pickup/reward.
      tickItemOverlay(camera, canvas);
      // Outline pulse on the in-range interactable. realDt so it animates at
      // real-time even during hit-pause.
      updateOutlinePxScale(camera as THREE.PerspectiveCamera, renderer.domElement.height);
      updateOutline(inRange, ctx.realDt, camera.position);
    } },

    // Interact (REPLAY / bot only) — LIVE play performs the interaction
    // directly in the input handler (the E key, the prompt tap, a tap on the
    // object). Under the intent bus (a replay or the bot), those handlers
    // aren't firing, so the recorded interact intent is consumed HERE to use
    // the in-range interactable — descend a stair, open a chest, take loot.
    // Without it a replayed run never leaves floor 1. The consume runs in live
    // too (to clear the flag), but the isBusInstalled gate makes it a no-op
    // there, so there's no double-interaction.
    { name: 'interact', kind: 'sim', phase: 'unpaused', tick() {
      if (!consumeInteractPressed()) return;
      endArrivalThreshold();   // reaching for something is playing too
      if (!isBusInstalled()) return;
      if (isDying() || isFogWalkthroughActive() || isAnyScreenOpen()) return;
      const inRange = getInRangeInteractable();
      if (inRange) resolveUsable(inRange, camera.position).onUse();
    } },

    // Player stats snapshot — recompute the single reactive PlayerSnapshot
    // once per frame. Runs in 'always' so equipment/attribute changes made
    // while a menu is open still update the snapshot (and its subscribers,
    // e.g. the inventory stat column) live. Subscribers fire only on real
    // change. Ordered before 'hud' so HUD readouts read this frame's values.
    { name: 'player-stats', kind: 'sim', phase: 'always', tick() {
      recomputePlayerStats();
      syncHudStores();
    } },

    // HUD — the buff bar diffs the live buff list; the xp/gold bar polls +
    // animates its pulses. (HP bar + depth are store-bound, updated above.)
    { name: 'hud', phase: 'always', tick(ctx) {
      updateBuffBar();
      updateXpGoldHud(ctx.realDt);
      tickXpSigil(ctx.realDt);
      // World-anchored damage numbers — reproject + rise + fade each frame so
      // they stick to the struck point as the camera turns. realDt so they keep
      // moving at wall-clock during hit-pause / slow-mo.
      updateDamageNumbers(camera, ctx.realDt);
    } },

    // Low-HP breathing vignette — peripheral red at <30% HP. realDt so it
    // keeps breathing during scaled time.
    { name: 'low-hp-vignette', phase: 'always', tick(ctx) {
      const maxHp = getPlayerMaxHp();
      tickLowHpPulse(ctx.realDt, maxHp > 0 ? getPlayerHp() / maxHp : 0);
    } },

    // Bullet-time presentation — cold vignette + FOV pop + audio muffle,
    // tracking the perfect-dodge dip. realDt so the cues themselves run at full
    // speed (they READ the dip; they don't ride it). BEFORE shake so the FOV
    // kick + shake compose cleanly.
    { name: 'slowmo-fx', phase: 'always', tick(ctx) { tickSlowmoPresentation(camera, ctx.realDt); } },

    // FOV — the single write. Every contributor (slow-mo's kick, momentum's
    // opening view) declares a NAMED OFFSET and this sums them onto the base
    // exactly once, here, after they have all had their say. Two systems
    // assigning camera.fov directly is how a camera ends up stranded at
    // somebody else's number when one of them stops caring.
    { name: 'camera-fov', phase: 'always', tick() { applyFov(camera); } },

    // Screen shake. Add the offset; it PERSISTS through the render (incl. WebGPU's async deferred read)
    // and is undone at the START of the next frame by the camera reset — interpRestore (fixed-step) or
    // tickPlayerAction's absolute camera-set (variable). No same-frame restore (that wiped it before the
    // async render read it). updateMatrixWorld(true) so the node pass samples the shaken matrix, not the
    // pre-shake one (WebGL's renderer.render does this implicitly; the node pass doesn't).
    { name: 'shake-apply', phase: 'always', tick(ctx) {
      tickShake(ctx.realDt, shakeOffset);
      camera.position.add(shakeOffset);
      camera.updateMatrixWorld(true);
    } },

    // Portal/room culling — hide rooms not visible through doorways (no-op
    // unless enabled). Runs AFTER camera movement, BEFORE light-pool + render
    // so the frustum it tests is this frame's.
    { name: 'room-culling', phase: 'always', tick() { getRoomCuller()?.tick(camera); } },

    // Explored-map nav cue — set each archway warm/cold by whether the branch
    // beyond it is fully explored + cleared. AFTER enemies + interactables (so
    // this frame's done-state is current). Presentation-only (untagged →
    // excluded from the sim digest). See src/level/explored-map.ts.
    { name: 'explored-map', phase: 'always', tick() { tickExploredMap(camera, getLevel()); } },

    // Bind the N nearest registered lights to the pool's PointLight slots.
    // Runs every frame so lighting updates with camera movement even when
    // frozen. LOS culls through-wall sources from the ranking.
    { name: 'light-pool', phase: 'always', tick() {
      const walkable = getLevel()?.walkable;
      const los = walkable
        ? (ax: number, az: number, bx: number, bz: number) =>
            walkable.hasLineOfSight(ax, az, bx, bz)
        : undefined;
      tickLightPool(camera, los);
    } },

    // Deferred subject-preview framing — see src/debug/inspect-mode.ts. No-op in
    // normal play (cheap early-return); only does work while an inspect snap is
    // waiting for its subject mesh to spawn.
    { name: 'inspect-frame', phase: 'always', tick() { tickInspectFraming(); } },

    { name: 'render', phase: 'always', tick() {
      tickSurfaceSeep(performance.now() / 1000);
      flushSplats(renderer);   // drain due bleed-out pulses into the gore buffer
      tickGoreWebGPU();        // dry/evict + repack the per-fragment gore buffer
      renderWithStyle(renderer, scene, camera);
      // LUX measurement — async render-to-target capture through the real
      // pipeline. Cheap no-op unless a measurement was requested.
      if (luxPending()) flushLux(renderer, scene, camera);
    } },
    // (No 'shake-restore' — the shake is undone at the start of the next frame's shake-apply instead, so
    //  it survives WebGPU's async render. See shake-apply above.)
  ];
}
