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
import { tickLampArm } from '../player/lamp-arm';
import { tickOffhandViewmodel } from '../player/handheld-offhand';
import { setBobTarget, updateBob } from '../player/viewmodel-bob';
import { updateViewSway } from '../player/viewmodel-sway';
import { tickViewmodelPullback } from '../player/viewmodel-pullback';
import { updateLampReveal } from '../scene/lamp-reveal';
import { isDying } from '../player/death';
import { isFogWalkthroughActive, tickFogWalkthrough } from '../player/fog-walkthrough';
import { renderWithStyle, setDarkAdapt } from '../style/render-target';
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
import { tickDarkAdaptation, darkAdaptBrightness, darkAdaptAmbient, sampleLitSignal } from '../scene/dark-adaptation';
import { updateDarkAdaptReadout } from '../debug/dark-adapt-readout';
import { updateBossEncounterReadout } from '../debug/boss-encounter-readout';
import { tickThresholdDrafts } from '../scene/threshold-draft';
import { isAnyScreenOpen } from '../ui/screen-manager';
import { tickAllBuffs } from '../ecs/buffs';
import { tickInteractables, getInRangeInteractable, resolveUsable } from '../interactables/system';
import { consumeInteractPressed } from '../controls/interact-input';
import { isBusInstalled } from '../harness/intent';
import { consumeAttackPressed } from '../controls/attack-input';
import { consumeDash } from '../controls/dash-input';
import { captureStep } from '../harness/run-recorder';
import { tryDash } from '../combat/dash';
import { consumeRiposte } from '../combat/reactive-defense';
import { updateSwingAgency } from '../combat/swing-agency';
import { canStartAction, enterDodge } from '../combat/player-action';
import { CONFIG } from '../config';
import { isWebGPU } from '../scene/renderer-mode';
import { getCurrentWeapon } from '../player/current-weapon';
import { tickLightPool } from '../scene/light-pool';
import { tickProjectiles } from '../combat/projectile-pool';
import { tickStamina } from '../combat/stamina';
import { hpDrainAmount } from '../combat/transforms';
import { isInCombat } from '../combat/combat-state';
import { bleedPlayer } from '../player/health';
import { tickExhaustionHaptic } from '../combat/exhaustion-haptic';
import { tickExhaustionFeedback } from '../combat/exhaustion-feedback';
import { tickBreath } from '../effects/breath';
import { tickCameraStumble } from '../combat/camera-stumble';
import { tickHazardFields } from '../combat/hazard-field';
import { tickXpWisps } from '../effects/xp-wisps';
import { tickGoldCoins } from '../effects/gold-coins';
import { tickTutorialHints } from '../effects/tutorial-hints';
import { tickDriftingMotes } from '../effects/drifting-motes';
import { tickSlowmoPresentation } from '../effects/slowmo-presentation';
import { tickBladeTrail, setBladeTrailIntensity } from '../effects/blade-trail';
import { tickRoomMood } from '../level/room-mood';
import { tickShatterBurst } from '../effects/shatter-burst';
import { tickFlungParts } from '../effects/flung-parts';
import { tickBloodBurst } from '../effects/blood-burst';
import { tickDustPuff } from '../effects/dust-puff';
import { tickParrySpark } from '../effects/parry-spark';
import { tickArenaLightArc } from '../feedback/arena-light-arc';
import { tickStatusVfx } from '../effects/status-vfx';
import { updateOutline, updateOutlinePxScale } from '../interactables/outline';
import { updateInteractLabel } from '../ui/interact-label';
import { tickItemPreviews } from '../ui/item-preview';
import { tickBossBar } from '../ui/boss-bar';
import { updateBuffBar } from '../ui/buff-bar';
import { updateXpGoldHud } from '../ui/xp-gold-hud';
import { tickXpSigil } from '../ui/xp-sigil';
import { updateDamageNumbers } from '../ui/damage-numbers';
import { tickLowHpPulse } from '../ui/vignette';
import { getPlayerHp, getPlayerMaxHp } from '../player/health';
import { tickShake, kickShake } from '../combat/screen-shake';
import { isWorldPaused } from '../world-paused';

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
  renderer: THREE.WebGLRenderer;
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
  const _shakeBase = new THREE.Vector3();   // clean (un-shaken) camera position, captured each un-paused frame
  let _shakeBaseSet = false;
  // DEV trace: __kick(mag,dur) fires a manual shake; __shakePeek() reports the live offset + whether the
  // camera matrix actually moved (matrixWorld translation vs the un-shaken base). Lets us tell "shake not
  // applied" from "applied but render ignores it".
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    w.__kick = (mag = 0.5, dur = 1.0): void => kickShake(mag as number, dur as number);
    w.__shakePeek = (): unknown => ({
      offsetLen: +shakeOffset.length().toFixed(4),
      camPos: camera.position.toArray().map((n) => +n.toFixed(3)),
      base: _shakeBase.toArray().map((n) => +n.toFixed(3)),
      matrixTx: [camera.matrixWorld.elements[12], camera.matrixWorld.elements[13], camera.matrixWorld.elements[14]].map((n) => +n.toFixed(3)),
    });
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
      if (isFogWalkthroughActive()) {
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
      if (isDying() || isFogWalkthroughActive()) return;
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
      // On a real dodge, commit the FSM 'dodging' beat (≈ the i-frame window)
      // so it locks out attack/parry for the roll's duration.
      if (tryDash(wx, wz)) enterDodge(CONFIG.STAMINA.DASH_IFRAME_S);
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
      // WebGPU: keep the ambient CONSTANT. Its fill colour is a COOL 0x1a1e24, so
      // ramping it with dark-adaptation flooded the whole image with cool/green and
      // bloom-blur. The WebGPU dark-adapt softening lives in the grade's shader lift
      // (render-webgpu.ts) instead — warm, darkness-weighted, leaves the lit side
      // alone. WebGL keeps the ramp (its blit lift + exposure work together there).
      ambient.intensity = isInspectActive() ? INSPECT_AMBIENT
        : (isWebGPU() ? CONFIG.AMBIENT_INTENSITY : darkAdaptAmbient());
      updateDarkAdaptReadout(lit, adapt, darkAdaptBrightness());
    } },

    { name: 'combat', kind: 'sim', phase: 'unpaused', tick(ctx) {
      const attackPressed = isDying() ? false : consumeAttackPressed();
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
      if (consumeRiposte()) weapon.parryRaise();
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

    // TRANSFORM out-of-combat bleed (Red Thirst): while a held fate drains HP
    // and you're NOT fighting, you bleed (floored at 1 — pressure, not death).
    // 'unpaused' + scaledDt so it stops in menus / hit-pause like everything else.
    { name: 'transform-drain', kind: 'sim', phase: 'unpaused', tick(ctx) {
      const perSec = hpDrainAmount('out-of-combat');
      if (perSec > 0 && !isInCombat()) bleedPlayer(perSec * ctx.scaledDt);
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
    // Left arm IK — must run AFTER 'lamp' so the hinge it targets has
    // its latest position from this frame's pendulum + stowed-ease.
    { name: 'lamp-arm', phase: 'always', tick(ctx) { tickLampArm(ctx.realDt); } },

    { name: 'offhand', phase: 'unpaused', tick() { tickOffhandViewmodel(); } },

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
      updateInteractLabel(inRange, camera, canvas);
      // Item-preview labels (starter / blood altars) — world→screen projection.
      tickItemPreviews(camera, canvas);
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

    // Screen shake. The offset PERSISTS through the render and is undone at the START of the NEXT frame —
    // NOT subtracted right after render. Why: on WebGPU the render is async (renderAsync defers the actual
    // draw to a microtask via its internal await), so a same-frame 'shake-restore' ran BEFORE the deferred
    // render read the camera → the render saw the un-shaken camera and the shake never showed. Persisting
    // it fixes WebGPU and is identical on WebGL. No accumulation: when the camera was re-set this frame
    // (!paused, tickPlayerAction ran) we capture that clean base; when it wasn't (paused/hit-pause) we
    // restore the base before re-applying — so it resets cleanly every frame either way.
    { name: 'shake-apply', phase: 'always', tick(ctx) {
      if (!isWorldPaused()) { _shakeBase.copy(camera.position); _shakeBaseSet = true; }
      else if (_shakeBaseSet) camera.position.copy(_shakeBase);
      tickShake(ctx.realDt, shakeOffset);
      camera.position.add(shakeOffset);
      // Force the world matrix to reflect the shaken position NOW. On WebGL renderer.render() does this
      // for us; on WebGPU the node pass (pass(scene,camera)) reads camera.matrixWorld at render time and
      // nothing recomputes it after we move camera.position — so without this the position moved but the
      // matrix the shader samples didn't, and the shake was invisible.
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
      flushSplats(renderer);   // WebGL: drain queued gore stamps into the splat map
      tickGoreWebGPU();        // WebGPU: dry/evict + repack the per-fragment gore buffer
      renderWithStyle(renderer, scene, camera);
      // LUX readback must happen while this frame's buffer is still
      // valid (preserveDrawingBuffer is off in prod) — cheap no-op
      // unless a measurement was requested.
      if (luxPending()) flushLux(renderer);
    } },
    // (No 'shake-restore' — the shake is undone at the start of the next frame's shake-apply instead, so
    //  it survives WebGPU's async render. See shake-apply above.)
  ];
}
