import * as THREE from 'three';
import { CONFIG } from './config';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, setCameraYaw } from './controls/camera';
import { createWeaponViewmodel } from './player/viewmodel';
import { attachLamp, setLampStowed } from './player/handheld-lamp';
import { attachLampArm } from './player/lamp-arm';
import { initBreath } from './effects/breath';
import { attachOffhandViewmodel, detachOffhandViewmodel } from './player/handheld-offhand';
import { setSlot, onEquipmentChanged } from './player/equipment';
import { setCurrentWeapon, FIST_STATS } from './player/current-weapon';
import { ITEMS } from './content/items';
import { warmupContent } from './content/warmup';
import { createCombatSystem, spendSwingStamina } from './combat/attack';
import { isWorldPaused } from './world-paused';
import { onPlayerDeath } from './player/health';
import { triggerDeath, getTimeScale, tickDeath, isDying, initDeath, setOnDeathStart } from './player/death';
import { tickJustDodge, getJustDodgeTimeScale } from './combat/just-dodge';
import { initWeaponDrop, dropHeldItem } from './player/weapon-drop';
import { bossEncounterDebug } from './mobs/boss-encounter';
import { initFogWalkthrough, isFogWalkthroughActive } from './player/fog-walkthrough';
import { initAchievements } from './broadcast/achievements';
import { initEventLog } from './broadcast/event-log';
import { buildMaterials } from './style/materials';
import { initRenderPipeline, renderWithStyle, setPS1Scale, setOutlineEnabled } from './style/render-target';
import { setSurfaceAOStrength } from './style/surface-ao';
import { setSurfaceDetailEnabled } from './style/surface-detail';
import { installBandedLighting, setBandedLighting } from './style/banded-lighting';
import {
  enterInspectMode, tickInspectFraming, isInspectActive,
  INSPECT_AMBIENT, INSPECT_REQUESTED,
} from './debug/inspect-mode';
import { createSettingsMenu, configureSettingsMenu } from './ui/settings-menu';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings, onSettingsChanged } from './settings/settings';
import { setMasterVolume, setReverbEnabled, startAmbience, playWhoosh, suspendAudio, resumeAudio } from './audio/sfx';
import { startMusic, setMusicVolume, pauseMusic, resumeMusic } from './audio/music';
import { emit, on as onEvent } from './broadcast/event-bus';
import { buildLevel, type LiveLevel } from './level/builder';
import { createRoomCuller, type RoomCuller } from './level/room-culling';
import { batchStaticFixtures } from './level/static-merge';
import { LEVELS } from './level/specs';
import type { LevelSpec } from './level/types';
import type { ModelSpec } from './ecs/model-types';
import { buildStarterChamber } from './level/starter-chamber';
import { findTestChamber } from './level/test-chambers';
import { showTestChambersScreen } from './ui/test-chambers-screen';
import { initLevelLoader, loadInitialLevel, loadLevel, tickPendingLoad, getCurrentDepth } from './level/loader';
import { generateFloor } from './level/procgen';
import { generateSafeRoom } from './level/safe-room';
import { suppressNextSafeRoomTransition } from './ui/safe-room-transition';
import { suppressNextDescentTitle } from './ui/descent-fade';
import { startNewRun, adoptSave, loadSave, clearSave, getRunState } from './state/run-state';
import { applyState } from './state/save-hydration';
import { initCharacterTracking, resetCharacter } from './state/character';
import { initRunStateListeners } from './state/run-state-listeners';
import { isPlaying, getGameMode } from './state/game-mode';
import { runSystems, type GameSystem, type TickContext } from './engine/loop';
import { buildSystems } from './engine/systems';
import { initDarkAdaptReadout, setDarkAdaptReadoutVisible } from './debug/dark-adapt-readout';
import { initBossEncounterReadout, setBossEncounterReadoutVisible } from './debug/boss-encounter-readout';
import { seedRng } from './engine/rng';
import { recordRunStart, resetRunDiscoveries, getMeta } from './state/meta-state';
import { showStartScreen } from './ui/start-screen';
import { addItemSilently } from './player/inventory';
import { get as getEntity } from './ecs/world';
import { getScenarioFromUrl, applyScenario, buildVaultPreviewLevel } from './debug/scenarios';
import { showProvingGroundsScreen } from './ui/proving-grounds-screen';
import { buildFightLevel, buildEventLevel } from './level/proving-grounds';
import { isAnyScreenOpen, msSinceLastScreenClose } from './ui/screen-manager';
import { spawn as spawnEntity } from './ecs/world';
import { initTriggerListener } from './ecs/triggers';
import { setupPwaAutoUpdate, maybeApplyUpdateSilently, setBeforeReloadHook } from './pwa-update';
import { captureDevSnapshot, applyDevSnapshot, clearDevSnapshot, hasPendingDevSnapshot } from './state/dev-snapshot';
import { createPerfOverlay, setPerfOverlayVisible, tickPerfOverlay, reportRendererInfo } from './ui/perf-overlay';
import { installPerfProbe, tickPerfProbe } from './debug/perf-probe';
import { createProfilerHud, setProfilerVisible, toggleProfiler } from './debug/profiler-hud';
import { initFrameTiming, frameBegin, frameEnd, setMarks, marksOn, setGpuProbe, gpuProbeOn } from './debug/frame-timing';
import { startRecording, stopRecording, toggleRecording, setRollingEnabled, saveLastSeconds } from './debug/perf-recorder';
import { launchSpector } from './debug/spector-launch';
import { initDrawReport, captureDrawReport } from './debug/draw-report';
import { setProfilerToolbarVisible } from './debug/profiler-toolbar';
import { createChargeRing, tickChargeRing } from './ui/charge-ring';
import { getInRangeInteractable, getAllInteractables, resolveUsable } from './interactables/system';
import { findTapTarget } from './controls/tap-target';
import { resolveTap } from './controls/tap-resolve';
import { triggerAttack } from './controls/attack-input';
import { initPickupLightPool } from './interactables/pickup';
import { initLightPool, setShadowMode } from './scene/light-pool';
import { setAdaptiveResolution, tickAdaptiveResolution } from './scene/adaptive-resolution';
import { initProjectilePool } from './combat/projectile-pool';
import { registerProjectiles } from './content/projectiles';
import { validateContent } from './content/validate';
import { initDriftingMotes } from './effects/drifting-motes';
import { initBladeTrail } from './effects/blade-trail';
import { actForDepth } from './level/acts';
import { ensureInteractLabel, setInteractLabelTapHandler } from './ui/interact-label';
import { createConsumableBar } from './controls/consumable-bar';
import { createHpBar } from './ui/hp-bar';
import { createStaminaBar } from './ui/stamina-bar';
import { createHealthHearts } from './ui/health-hearts';
import { createStaminaArc } from './ui/stamina-arc';
import { createXpSigil } from './ui/xp-sigil';
import { createBossBar, resetBossBar } from './ui/boss-bar';
import { createBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { createDepthCounter, setDepth as setDepthCounter } from './ui/depth-counter';
import { createXpGoldHud } from './ui/xp-gold-hud';
import { setGodMode } from './player/health';
import { setHarnessPaused } from './harness/pause';
import { isDesktopLike } from './controls/platform';

// AI-playable harness: `?harness=1` flips the world into turn-based mode
// from frame 0. The full harness module loads asynchronously below; the
// synchronous setHarnessPaused above guarantees the world is frozen
// before the first tick runs, even if the title screen / scenarios kick
// off before the dynamic import resolves.
const HARNESS_ENABLED =
  new URLSearchParams(window.location.search).get('harness') === '1';
if (HARNESS_ENABLED) setHarnessPaused(true);

// Asset viewer: `?viewer=1` opens the DEV-only browser screen for browsing +
// inspecting any mob/weapon/item live (src/debug/viewer.ts). With no scenario
// it shows the picker (in place of the title); with a scenario it mounts the
// orbit + playback control bar over the loaded subject. DEV-gated so the whole
// viewer module tree-shakes out of the production bundle.
const VIEWER_ENABLED =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('viewer') === '1';

// Debug capture tool: an on-screen CAPTURE button that grabs a rich
// snapshot during NORMAL play. Enabled by EITHER the ?debug=1 URL flag
// OR the persisted "DEBUG MODE" setting (toggled in the settings menu).
// Install the console-error ring buffer at boot when enabled so it
// catches errors thrown before the dynamic-imported debug module loads.
const DEBUG_ENABLED =
  new URLSearchParams(window.location.search).get('debug') === '1' ||
  getSettings().debugMode;
if (DEBUG_ENABLED) {
  void import('./debug/console-buffer').then((m) => m.installConsoleBuffer());
}

// Lazily-assigned hooks from the dynamic-imported harness module.
// Stay null when harness is off so the tick loop pays one branch.
let harnessLevelReady: (() => void) | null = null;
let harnessTickFn: ((realDt: number, worldRunning: boolean) => void) | null = null;

// Best-effort landscape lock (no-op on iOS Safari and other unsupported envs).
try {
  const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
  so?.lock?.('landscape').catch(() => {});
} catch {
  // ignore — orientation API not supported here
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;

// --- Renderer ---
// preserveDrawingBuffer is needed for the harness to read frames via
// canvas.toDataURL() asynchronously (after render is gone otherwise).
// Off by default — there's a measurable perf hit on some mobile GPUs.
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: HARNESS_ENABLED || DEBUG_ENABLED,
});
// DPR cap is lower on mobile (fragment-bound) than desktop debug. See
// CONFIG.PIXEL_RATIO_CAP_MOBILE — the biggest single lever against overdraw.
const dprCap = isDesktopLike() ? CONFIG.PIXEL_RATIO_CAP : CONFIG.PIXEL_RATIO_CAP_MOBILE;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The PSX pipeline renders TWICE per frame (scene → low-res target, then a
// fullscreen blit quad → screen; see style/render-target.ts). Three.js
// auto-resets renderer.info at the start of every render() call, so by
// frame-end info.render would reflect ONLY the blit quad (1 draw, 2 tris).
// Turn auto-reset off and reset once per frame inside renderWithStyle so the
// counters ACCUMULATE across both passes — i.e. report the true frame total.
renderer.info.autoReset = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.FOG_COLOR);
scene.fog = new THREE.Fog(CONFIG.FOG_COLOR, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);

const ambient = new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY);
scene.add(ambient);

// Inspection mode (preview snaps) lives in src/debug/inspect-mode.ts — the
// studio lighting rig, PSX bypass, backdrop, and subject auto-framing are all
// owned there. main.ts only calls enterInspectMode()/tickInspectFraming() and
// asks isInspectActive().

// --- Static surface materials (PS1) ---
// Patch the global lighting chunk FIRST so every material compiles with the
// chosen banded-lighting state. Must precede any material compile; runtime
// toggle is handled in the onSettingsChanged subscription.
installBandedLighting(getSettings().bandedLighting);
const materials = buildMaterials();
initRenderPipeline(renderer);
// Apply the persisted ink-outline preference (the pipeline defaults it on).
setOutlineEnabled(getSettings().outlines);
setSurfaceAOStrength(getSettings().aoStrength);
setSurfaceDetailEnabled(getSettings().surfaceDetail);

// --- Camera ---
const camera = createFirstPersonCamera();
scene.add(camera); // required for the sword (camera child) to render
// Blade trail mesh attaches to the world scene root (NOT the camera) so it
// reads in world space and depth-tests correctly against geometry. Persistent
// across levels — one buffer, dynamic updates.
initBladeTrail(scene);
initFogWalkthrough(camera); // soulslike fog-gate forced walk drives this camera
// Register camera with the death sequence so the death tick can
// pitch + drop it during the collapse animation.
initDeath(camera);
// Death weapon-drop spawns world-space tumbling weapons into the scene.
initWeaponDrop(scene);

// --- Scenario (URL param ?scenario=...) ---
// DEV-only. In a production build `import.meta.env.DEV` is the literal
// `false`, so this resolves to `null`, every `scenario` branch below goes
// dead, and the bundler tree-shakes the entire debug/scenarios module (and
// its fixed-seed test levels) out of the live site.
const scenario = import.meta.env.DEV ? getScenarioFromUrl() : null;
// Placeholder level used purely as a boot-time "give buildLevel
// something to mount" — the title screen covers it, then the
// first descent (startNewRun) replaces it with the real flow
// (starter chamber → tutorial → procgen depth-1). The hand-authored
// LEVEL_1 used to fill this slot; deleted along with all the other
// legacy hand-authored floor specs.
const PLACEHOLDER_LEVEL: LevelSpec = {
  id: '__placeholder__',
  depth: 1,
  startPos: { x: 0, z: 0, yaw: 0 },
  rooms: [{ id: 'p', rect: { x: 0, z: 0, w: 4, d: 4 }, height: 3 }],
  corridors: [],
  props: [],
  torches: [],
  spawns: [],
  doors: [],
  stairs: [],
};
const levelSpec = scenario?.level ?? PLACEHOLDER_LEVEL;

// --- Player entity (HP + buffs + passives live in the world) ---
// Spawn BEFORE buildLevel so enemies can already query player state during init.
spawnEntity({
  id: 'player',
  kind: 'player',
  hp: { base: CONFIG.PLAYER_HP_MAX, current: CONFIG.PLAYER_HP_MAX },
  buffs: [],
  // No intrinsic passives by default. Heal-on-kill / reaper-style
  // effects belong on EQUIPMENT (ring of bloodthirst, etc.) so the
  // baseline player has to earn their regen.
  passives: [],
});
initTriggerListener('player');

// --- Level loader ----------------------------------------------------
// The loader owns the active LiveLevel. Stairs interact handlers schedule
// a load via the loader; tickPendingLoad applies it at the top of the
// next frame. Player state (HP, inventory, equipment, buffs) persists
// across loads — only the world is rebuilt.
//
// The active-level handle lives in `currentLevel` here so the main-loop
// tick code below can read it. Updated by the onLoaded callback below.
let currentLevel: LiveLevel & { checkRoomClear?: () => void } = null as unknown as LiveLevel;

// Portal/room culling (opt-in). The culler is rebuilt whenever the active
// level changes and torn down when the setting is off. A 'room-culling' system
// (engine/systems.ts) ticks it each frame between camera-move and render.
let roomCuller: RoomCuller | null = null;
let cullerLevel: LiveLevel | null = null;
const PORTAL_CULL_FORCED =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('portalcull') === '1';
function syncRoomCuller() {
  const want = (getSettings().portalCulling || PORTAL_CULL_FORCED) && !!currentLevel;
  if (want) {
    if (cullerLevel !== currentLevel) {
      roomCuller?.dispose();
      roomCuller = createRoomCuller(currentLevel);
      cullerLevel = currentLevel;
    }
  } else if (roomCuller) {
    roomCuller.dispose();   // restores all room visibility
    roomCuller = null;
    cullerLevel = null;
  }
}

initLevelLoader({
  scene,
  materials,
  camera,
  levels: LEVELS,
  onLoaded(level) {
    currentLevel = level as LiveLevel & { checkRoomClear?: () => void };
    // Batch each room's static fixture geometry (torch sconces/candles, opt-in
    // decor) into per-room merged meshes — big draw-call cut, runs once here.
    batchStaticFixtures(currentLevel);
    setCameraYaw(level.playerSpawn.yaw);
    setDepthCounter(getCurrentDepth(), level.spec.id.startsWith('safe-'));
    resetBossBar();   // new floor — clear any prior boss bar state

    // Dev-mode hot-reload restore: if a snapshot exists for THIS floor,
    // overwrite the just-applied spawn pose + reset HP/buffs with the
    // ones captured before the reload. One-shot — applyDevSnapshot
    // clears the storage so a subsequent normal level load doesn't
    // teleport the player to an old position.
    const player = getEntity('player');
    if (player) {
      applyDevSnapshot(level.spec.id, camera, player, CONFIG.PLAYER_HEIGHT);
    }
    // Drifting motes — ambient volumetric "dust in the air" tied
    // to the level's room rects. Tint takes the act's torch
    // colour so the mood reads consistent (warm motes in warm
    // acts, cold motes in cold acts). Re-init on every load so
    // the previous floor's motes get cleared first.
    const depth = getCurrentDepth();
    const tint = actForDepth(depth).torchTint;
    const rectsForMotes = [
      ...level.spec.rooms.map((r) => r.rect),
      ...level.spec.corridors.map((r) => r.rect),
    ];
    if (!INSPECT_REQUESTED) initDriftingMotes(scene, rectsForMotes, tint);
    // Notify the harness (if booted) that a level is observable. Only
    // fires once — subsequent stair-driven swaps are transparent since
    // observation reads via the same getLevel() getter.
    harnessLevelReady?.();
  },
  // Procgen fallback — invoked when the stairs target a level id that's
  // not in the hand-authored LEVELS registry.
  //
  //   'safe-N'  → safe room AFTER floor N. Generated on demand; its
  //               stairs target depth-(N+1).
  //   anything else → the next procgen dungeon floor at depth N+1.
  //
  // Floors are seeded by the run start time so resume regenerates the
  // same floors. The safe room geometry is static so it doesn't need
  // a seed.
  generate(id, depth) {
    // Proving Grounds descent — a real procgen floor, but kept under the
    // `proving-` id prefix (chained via the nextLevel override) so the whole
    // descent stays save-safe. Depth is read from the id, not the loader's
    // counter, so a direct jump to depth N works.
    if (id.startsWith('proving-depth-')) {
      const d = parseInt(id.slice('proving-depth-'.length), 10) || 1;
      const run = getRunState();
      const runSeed = run?.startedAt ?? Date.now();
      const spec = generateFloor(d, runSeed, `proving-depth-${d + 1}`);
      spec.id = id;
      return spec;
    }
    if (id.startsWith('safe-')) {
      // safe-N marks the safe room AFTER depth N (a BOSS depth). Pass
      // N along so the safe-room generator wires its exit stairs to
      // 'depth-N+1' (= the first floor of the next act).
      const prevDepth = parseInt(id.slice('safe-'.length), 10);
      return generateSafeRoom(Number.isFinite(prevDepth) ? prevDepth : depth - 1);
    }
    const run = getRunState();
    const runSeed = run?.startedAt ?? Date.now();
    // Stair target now follows the ACT rules (see src/level/acts.ts):
    // boss-depth → safe-N (the act's checkpoint); other depths go
    // straight to the next floor with no safe-room interlude. The
    // composer reads the same rules to flag boss floors.
    return generateFloor(depth, runSeed);
  },
});

// --- Player: held sword ---
// onSwingStart fires for EVERY combo step's windup (initial press +
// every chained step), so the whoosh and 'attack:swing' broadcast
// play through the whole stab → slash → stab-stab routine, not just
// the first press.
const weapon = createWeaponViewmodel(camera, {
  onSwingStart: ({ charged }) => {
    playWhoosh();
    emit({ type: 'attack:swing' });
    // Stamina is billed HERE — once per real swing — so mashing faster than
    // the animation no longer over-drains, and buffered combo steps pay too.
    spendSwingStamina(charged);
  },
  // Light swings are FREE now, so a swing (and a buffered combo chain) can
  // always start — never a dead tap, never a punishment for the natural
  // thumb-mash. Stamina only gates the POWER moves (charged / ranged / dash),
  // which respect the bar at their own spend sites with a HUD flash.
  canSwing: () => true,
});

// Weapon + offhand viewmodels are driven REACTIVELY by the equipment
// slot system. Whenever a slot changes (pickup, manual equip via the
// inventory panel, save restore), this listener swaps the visible model
// + the active stats. Single source of truth: equipment.
//
// Offhand handling — the lamp is NO LONGER an offhand item. It's baked
// into the player as a permanent worn hip-lantern (attachLamp below,
// once), so the offhand slot is free for shields / foci and the player
// can always see. Any offhand item renders through the generic
// offhand-viewmodel manager. A saved/equipped oil-lamp is a harmless
// no-op (the light is already there) — it just shows no extra model.
//
// The player's lamp is the BASELINE light everywhere (CLAUDE.md
// "Lighting as signal"). Attach it once, permanently — never detached.
attachLamp(camera);
// Left arm holding the lantern's O-ring — IK-driven, mirrors the
// right arm (which holds the weapon). Must attach AFTER attachLamp
// so the hinge it targets exists.
attachLampArm(camera);

// Visible cold-breath puff pool, parented to the camera (winded exhale).
initBreath(camera);

// The world-scale model to fling to the floor on death — tracked from the
// equipped weapon. Drop model (correct world size + depth) over the
// first-person viewmodel; null while empty-handed.
let heldWeaponDropModel: ModelSpec | null = null;
onEquipmentChanged((eq) => {
  // Pass null when no weapon equipped — the viewmodel falls back to
  // the bare hand (FIST viewmodel), and current-weapon flips to fist
  // stats so attacks resolve as punches with short reach + low damage.
  // Starter-chamber default until the player takes from an altar.
  weapon.equip(eq.weapon?.viewmodel ?? null);
  heldWeaponDropModel = eq.weapon?.dropModel ?? eq.weapon?.viewmodel ?? null;
  setCurrentWeapon(eq.weapon?.weapon ?? FIST_STATS);
  if (eq.offhand && eq.offhand.id !== 'oil-lamp') {
    // Real offhand gear (shield / focus). Drop the lantern to the hip so
    // the item takes the hand; the lamp's light is unchanged.
    setLampStowed(true);
    attachOffhandViewmodel(camera, eq.offhand.dropModel);
  } else {
    // Empty offhand, or a legacy oil-lamp (now a no-op — the lamp is
    // baked in). Raise the lantern back to the visible hand; no held
    // offhand viewmodel either way.
    setLampStowed(false);
    detachOffhandViewmodel();
  }
});

// --- Combat ---
// Combat queries enemies via a getter so the system follows level swaps —
// after descent the new floor's enemies become attackable without
// rewiring.
const combat = createCombatSystem(
  camera, weapon,
  () => currentLevel.enemies,
  () => currentLevel.destructibles ?? [],
  () => currentLevel?.walkable,
);

// --- Player death wiring ---
onPlayerDeath(() => triggerDeath());
// At the first instant of death, fling the held weapon from the hand to
// the floor (it tumbles down as the camera collapses over it). Computed
// from the flattened camera basis; the sword sits in the right hand, so
// it tosses out to the +right side.
const _dropFwd = new THREE.Vector3();
const _dropRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
setOnDeathStart(() => {
  if (!heldWeaponDropModel) return;
  camera.getWorldDirection(_dropFwd);
  _dropFwd.y = 0;
  if (_dropFwd.lengthSq() < 1e-6) _dropFwd.set(0, 0, -1);
  _dropFwd.normalize();
  _dropRight.crossVectors(_dropFwd, _worldUp).normalize();
  dropHeldItem(heldWeaponDropModel, weapon.group, _dropFwd, _dropRight, +1);
});

// --- Broadcast / DCC tribute layer ---
initAchievements();
// Append-only event log — Phase-4 (async multiplayer) foundation. Records
// bus events now; Phase 4 swaps the sink for a SpacetimeDB writer.
initEventLog();

// --- Input ---
// Attack is now triggered by tapping anywhere on the right half of the
// screen (in addition to the spacebar on desktop). No more on-screen
// attack button — less intrusive UI, larger hit area.
const input = createTouchInput(canvas, {
  // THE tap arbiter — single place that fully resolves a tap and acts
  // (the input schemes no longer add their own attack fallback). canAttack
  // is false for the touch joystick half: a direct tap on an object is
  // still honoured, but the attack/interact fallback is suppressed there.
  onTap(clientX, clientY, canAttack) {
    // ── Gates: contexts where a tap is NOT a world action at all ──
    // Dying / fog-walk / a screen open → ignore. And swallow the straggler
    // tap from a JUST-dismissed screen: the click that closed a corpse
    // note / menu fires its mouseup/touchend AFTER the screen is gone, so
    // without this it would re-hit the object under it (re-open the note)
    // or swing. Gating here — not via a return value — means NOTHING
    // happens (no interact, no attack), which is what was broken before.
    if (isDying() || isFogWalkthroughActive() || isAnyScreenOpen()) return;
    if (msSinceLastScreenClose() < 250) return;
    if (!currentLevel) return;

    // Gather the inputs, then let the pure rule decide (src/controls/tap-
    // resolve.ts holds the whole priority ladder — attack vs interact vs
    // nothing — so it reads in one place and is unit-tested). This handler
    // only gathers + executes.
    const aimed = findTapTarget(
      clientX, clientY, canvas, camera,
      currentLevel.enemies,
      getAllInteractables(),
    );
    let aimedReachable = false;
    if (aimed?.kind === 'interactable') {
      const it = aimed.interactable;
      aimedReachable =
        Math.hypot(it.position.x - camera.position.x, it.position.z - camera.position.z) <= it.radius;
    }
    const action = resolveTap({
      aimed,
      aimedReachable,
      mobInRange: combat.hasEnemyInRange(),
      bestInRange: getInRangeInteractable(),
      canAttack,
    });
    if (action.kind === 'attack') triggerAttack();
    else if (action.kind === 'interact') resolveUsable(action.interactable, camera.position).onUse();
    // 'none' → deliberately do nothing (e.g. tapped a chest you're too far from).
  },
  onInteract() {
    // E key (or future gamepad confirm) — use the currently in-range
    // interactable, no screen position needed. Same gate as the tap
    // path: not during dying or open screens.
    if (isDying() || isFogWalkthroughActive() || isAnyScreenOpen()) return;
    const inRange = getInRangeInteractable();
    if (inRange) resolveUsable(inRange, camera.position).onUse();
  },
});
// Floating world-anchored interact label only — the corner USE button
// was removed. Interaction is now diegetic: tap the object directly
// (handled by tap-target raycast in the touch input handler).
ensureInteractLabel();
// Tapping the floating prompt is a second, reliable way to interact —
// same gating + blocked-loot fall-through as a tap on the object's model.
setInteractLabelTapHandler(() => {
  if (isDying() || isFogWalkthroughActive() || isAnyScreenOpen()) return;
  const inRange = getInRangeInteractable();
  if (inRange) resolveUsable(inRange, camera.position).onUse();
});
createConsumableBar();
// Backdrop and HUD-hide are now owned by the screen manager — created
// lazily when the first screen that needs them opens.
createSettingsMenu();
configureSettingsMenu({
  abandonRun() {
    // Wipe the save then reload — the boot flow will show the title
    // screen with no CONTINUE pill, ready for a fresh DESCEND.
    clearSave();
    location.reload();
  },
  quitToMenu() {
    // Save is preserved; reload kicks the boot flow which sees the
    // save and offers CONTINUE on the title screen.
    location.reload();
  },
  exitGame() {
    // window.close only works on tabs opened by script (or PWAs on
    // some platforms). Best-effort then fall back to blanking the
    // page so the player can manually close the tab / hit home.
    try { window.close(); } catch {}
    document.body.innerHTML = '<div style="position:fixed;inset:0;background:#000;color:#765;display:flex;align-items:center;justify-content:center;font:italic 14px serif;letter-spacing:0.2em;">the dark forgets you.</div>';
  },
});
createInventoryPanel();

// Sync the master volume from persisted settings so saved volume is
// applied at boot (not just when the slider next moves).
setMasterVolume(getSettings().masterVolume);
setMusicVolume(getSettings().musicVolume);
setReverbEnabled(getSettings().reverb);

// Start ambient loops (torch crackle bed + room drone) on the very first
// user gesture — AudioContext can't run before the user has touched the
// page, so we attach a one-shot listener that fires startAmbience once.
{
  const startOnce = () => {
    startAmbience();
    startMusic();
    window.removeEventListener('pointerdown', startOnce);
    window.removeEventListener('touchstart', startOnce);
    window.removeEventListener('keydown', startOnce);
  };
  window.addEventListener('pointerdown', startOnce, { once: true });
  window.addEventListener('touchstart', startOnce, { once: true });
  window.addEventListener('keydown', startOnce, { once: true });
}

// Pause audio when the tab / app is backgrounded. The browser already throttles
// the render loop when the page is hidden (and realDt is clamped, so the world
// doesn't lurch on return), but Web Audio runs on its own clock — so the
// ambient bed + music would keep playing in the background. Suspend the audio
// clock + pause the music schedulers on hide; resume on return. Suspend, not
// teardown, so it picks up exactly where it left off.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseMusic();
    suspendAudio();
  } else {
    resumeAudio();
    resumeMusic();
  }
});

// Pre-warm: build/render every drop + enemy model once at boot so the first
// kill in-game doesn't pay shader-compile / JIT cost mid-fight. Also primes
// the item-thumbnail cache so the first inventory rebuild after a pickup is
// instant. Done after the renderer + level exist; before scenarios so an
// inventory-open scenario doesn't pay the cost on first frame.
warmupContent(renderer);

// Pre-allocate the pickup light pool. Lights live in the scene forever
// (idle = intensity 0, parked off-stage); pickups borrow and return them.
// This is what actually keeps drops lag-free: Three.js recompiles every
// material shader if the scene's light count changes mid-fight, but a
// fixed-count pool sidesteps that entirely.
// Global light pool — the perf-critical pool of N PointLight slots that
// every scene PointLight runs through. See src/scene/light-pool.ts.
// Must be initialized BEFORE any spawn that registers sources (torches,
// fountains, lamp, fill, etc.).
initLightPool(scene);
// Apply the persisted dynamic-shadow quality (the light pool defaults to
// 'off' internally; this lifts it to the user's setting). Live changes are
// handled by the onSettingsChanged subscription further down.
setShadowMode(getSettings().shadows);
// Adaptive resolution runs on real phones only (desktop debug + snaps stay at
// the fixed authored scale). Re-evaluated live by the onSettingsChanged block.
setAdaptiveResolution(getSettings().adaptiveResolution && !isDesktopLike());
// DEV-only: ?ps1=0.3 forces the scene-render scale for snap/compare. Stripped
// from prod by the literal-false guard.
if (import.meta.env.DEV) {
  const ps1 = Number(new URLSearchParams(window.location.search).get('ps1'));
  if (ps1 > 0) setPS1Scale(ps1);
}
// DEV-only: ?shadows=off|hero|single|all forces a mode for snap/compare
// without touching the saved setting. Stripped from prod by the literal guard.
if (import.meta.env.DEV) {
  const sm = new URLSearchParams(window.location.search).get('shadows');
  if (sm === 'off' || sm === 'hero' || sm === 'single' || sm === 'all') setShadowMode(sm);
}
// DEV-only boss observation hook (window.__boss). Stripped from prod by the
// literal-false guard. Drive + inspect multi-phase boss fights from the
// console or a headless chrome-devtools session without grinding combat:
//   __boss.info()      → { encounter, phase: { index, count } }
//   __boss.phase(n)    → jump to phase n INSTANTLY (settled pose)
//   __boss.advance()   → trigger the NEXT phase WITH its collapse animation
// Reads the live boss lazily so it follows floor swaps.
if (import.meta.env.DEV) {
  const findBoss = () => currentLevel?.enemies.find((e) => e.isBoss && e.alive);
  const bossApi = {
    info: () => ({ encounter: bossEncounterDebug(), phase: findBoss()?.bossPhaseInfo() ?? null }),
    phase: (n: number) => { findBoss()?.setDebugBossPhase(n); return bossApi.info(); },
    advance: () => { findBoss()?.debugAdvanceBossPhase(); return bossApi.info(); },
  };
  (window as unknown as { __boss?: typeof bossApi }).__boss = bossApi;
}
initPickupLightPool(scene);
// Projectile pool — pre-allocates the meshes + trail sprites that ranged
// enemies (and future spells/traps) rent at fire-time. Registers its own
// 'projectile' category lights into the light pool above. Projectile
// types are registered into a registry; register the built-in set now.
initProjectilePool(scene);
registerProjectiles();
// Content cross-reference check — fail loudly + early if any spec points
// at a buff/item/projectile/affix/set/enemy id that doesn't exist. Runs
// after registerProjectiles() so projectile ids are known. See
// src/content/validate.ts.
validateContent();

// Run-state listeners — kill counter, items-found set, autosave on
// floor:loaded events. Wired before any level load so the initial
// floor entry is captured.
initRunStateListeners();
initCharacterTracking();

// PWA: poll for SW updates + auto-reload when a new SW takes over.
// Means a `git push` lands on Josh's installed home-screen app within a
// minute or two without him having to close and reopen it.
setupPwaAutoUpdate();

// Dev hot-reload snapshot: before any update-triggered reload, persist
// the player's pose + HP + buffs so the next boot can restore them on
// the same floor. Only meaningful when DEV AUTO-UPDATE is on (live
// updates take during level transitions, which already land at a
// freshly-built floor). Clears itself on player:killed or when the
// next floor's id differs from the snapshot.
setBeforeReloadHook(() => {
  // Only capture when DEV AUTO-UPDATE is on. Live auto-update reloads
  // happen during a level transition fade, so the player is already
  // at the new floor's spawn — the snapshot would be a no-op
  // restoration that just leaves a stale localStorage entry hanging
  // around until the next non-matching level load cleans it up.
  if (!getSettings().devAutoUpdate) return;
  const player = getEntity('player');
  if (!player || !currentLevel) return;
  captureDevSnapshot(currentLevel.spec.id, camera, player);
});
onEvent((e) => {
  if (e.type === 'player:killed') clearDevSnapshot();
});

// --- HUD ---
createHpBar();
createStaminaBar();
createHealthHearts();
createStaminaArc();
createXpSigil();
createBossBar();
createBuffBar();
createChargeRing();
createPickupNotification();
createDepthCounter(getCurrentDepth());
createXpGoldHud();

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// --- Render loop ---
const clock = new THREE.Clock();
const shakeOffset = new THREE.Vector3();
const forwardScratch = new THREE.Vector3();

// ── Per-frame systems ───────────────────────────────────────────────────
// The frame is an ordered list of systems (engine/loop.ts), defined in
// engine/systems.ts. buildSystems takes the world objects a frame touches as
// an EXPLICIT dependency set (SystemDeps) rather than reaching into module
// globals; getLevel reads the active level fresh each frame (reassigned on
// every floor load).
const SYSTEMS: GameSystem[] = buildSystems({
  camera, scene, renderer, ambient, canvas,
  input, combat, weapon, shakeOffset, forwardScratch,
  getLevel: () => currentLevel,
  getRoomCuller: () => roomCuller,
});

function tick() {
  // Apply any pending level swap BEFORE any per-frame reads on the level.
  // Stairs interactables call loadLevel() during the previous frame's
  // interactables tick; the swap lands here at the top of the next frame.
  tickPendingLoad();
  // Build/tear-down the room culler to match the active level + setting.
  syncRoomCuller();

  const realDt = Math.min(clock.getDelta(), 0.1);

  // Harness: drain any in-flight tick budget and advance game-time clock.
  // Cheap when off. Called BEFORE the pause snapshot below so a budget that
  // ends this frame re-pauses the world for the same frame's update gate.
  harnessTickFn?.(realDt, !isWorldPaused());

  tickDeath(realDt);
  tickJustDodge(realDt);   // real-time so the slow-mo dip isn't slowed by itself
  const scaledDt = realDt * getTimeScale() * getJustDodgeTimeScale();
  // Snapshot pause state AFTER the harness so a just-ended budget gates this
  // frame's unpaused systems.
  const paused = isWorldPaused();

  // While paused, drain look input so it doesn't snap when we unfreeze.
  // (The input-camera system is gated off by the pause, so it won't.)
  if (paused) {
    input.lookDx = 0;
    input.lookDy = 0;
  }

  const ctx: TickContext = {
    realDt,
    scaledDt,
    paused,
    mode: getGameMode(),
    playing: isPlaying(),
  };
  // Profiling brackets the system pass: begin opens the GPU timer + marks the
  // CPU start, end closes them and fans the frame sample out to the HUD +
  // recorder. Both early-return immediately unless something is listening (HUD
  // visible, recording, or marks on), so this is free for players who never
  // enable the PROFILER TOOLS setting — just two no-op calls per frame.
  frameBegin();
  runSystems(SYSTEMS, ctx);
  frameEnd();

  // Charge-ring HUD — early-outs on no-progress so it's free when no
  // hold is in flight. Always ticked; the visual itself opts in.
  tickChargeRing();

  // Perf overlay (toggle in Settings → PERF METER). Internally early-
  // outs when hidden so it's free when off. reportRendererInfo reads
  // renderer.info AFTER the render system has run this frame, so the
  // tris/draws numbers reflect what was actually drawn.
  reportRendererInfo(renderer);
  tickPerfOverlay(performance.now());
  // Adaptive resolution — self-gates (no-op unless enabled on a real phone).
  tickAdaptiveResolution(performance.now());
  // Programmatic perf probe (window.__perf for the headless perf runner).
  // DEV-only — the literal-false guard dead-code-eliminates it from prod
  // (and tickPerfProbe is itself a no-op in prod, belt-and-suspenders).
  if (import.meta.env.DEV) tickPerfProbe(performance.now());

  requestAnimationFrame(tick);
}

// ── Run start ──────────────────────────────────────────────────────────
// All the systems above are wired; we just don't have an active level
// (or a render loop) yet. The start screen owns the next step: either
// DESCEND (fresh run on depth-1) or CONTINUE (resume the saved floor).
//
// Scenario URLs (debug) bypass the title and jump straight into the
// requested level.


function startRun(floorId: string, startDepth: number = 1) {
  // Seed the gameplay RNG stream from the run seed (startedAt) so a seeded
  // run's crit/loot rolls are reproducible — the Phase-4 replay foundation.
  seedRng(getRunState()?.startedAt ?? Date.now());
  loadInitialLevel(floorId, startDepth);
  // Resolve the spawn so an authored or procgen position that
  // happens to overlap an obstacle (most commonly the stair
  // footprint) gets nudged to the nearest free cell.
  const resolved = currentLevel.walkable.resolveSpawn(
    currentLevel.playerSpawn.x,
    currentLevel.playerSpawn.z,
    0.30,
  );
  camera.position.set(resolved.x, CONFIG.PLAYER_HEIGHT, resolved.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = currentLevel.playerSpawn.yaw;
  camera.rotation.x = 0;
  tick();
}

/**
 * Autostart: ?autostart=1 / ?autostart=descend / ?autostart=continue
 * bypass the title screen. Combine with ?seed=N for deterministic runs.
 *
 * `?autostart=continue` resumes the saved run if one exists, else
 * returns false so the title can fall through to a fresh start.
 *
 * `?autostart=1` (or `descend`) starts a fresh run. Optional:
 *   - `?seed=N` overrides the run's startedAt (= procgen seed). Two
 *     boots with the same seed produce byte-identical floors.
 *   - `?depth=N` jumps directly to depth N, skipping the starter
 *     chamber. Gated behind ?harness=1 or ?dev=1 so players can't
 *     trivially level-skip via URL.
 */
function handleAutostart(): boolean {
  const url = new URLSearchParams(window.location.search);
  const auto = url.get('autostart');
  if (!auto) return false;

  if (auto === 'continue') {
    const s = loadSave();
    if (!s) return false;  // no save → fall through to title for fresh start
    adoptSave(s);
    applyState(s);
    startRun(s.floorId, s.depth);
    return true;
  }

  // VAULT preview entry — `?vault=<id>` loads a single authored vault
  // (unfrozen, harness-controllable) so the pilot driver can walk exactly
  // the room I just built. DEV-only + gated behind harness/dev like ?depth.
  const vaultId = url.get('vault');
  if (import.meta.env.DEV && vaultId && (HARNESS_ENABLED || url.get('dev') === '1')) {
    const spec = buildVaultPreviewLevel(vaultId);
    if (spec) {
      clearSave();
      LEVELS[spec.id] = spec;
      startNewRun(spec.id, { depth: 5 });
      recordRunStart();
      resetRunDiscoveries();
      applyState(null);
      setSlot('weapon', ITEMS['rusted-sword']);
      startRun(spec.id, 5);
      return true;
    }
    console.warn(`?vault=${vaultId} not found in the vault library`);
  }

  // DESCEND path. Accept ?seed=N and (gated) ?depth=N.
  const seedParam = url.get('seed');
  const seed = seedParam != null && seedParam !== '' ? Number(seedParam) : undefined;
  if (seed !== undefined && !Number.isFinite(seed)) {
    console.warn(`?seed=${seedParam} is not a number, ignoring`);
  }
  const depthParam = url.get('depth');
  let depth = depthParam != null ? Number(depthParam) : 1;
  if (!Number.isFinite(depth) || depth < 1) depth = 1;
  const allowJump = HARNESS_ENABLED || url.get('dev') === '1';
  if (depth > 1 && !allowJump) {
    console.warn(`?depth=${depth} requires ?harness=1 or ?dev=1; starting at depth 1`);
    depth = 1;
  }

  clearSave();
  if (depth === 1) {
    const starterSeed = Number.isFinite(seed as number) ? (seed as number) : undefined;
    LEVELS['starter'] = buildStarterChamber('depth-1', starterSeed);
    startNewRun('starter', { seed: starterSeed });
    recordRunStart();
    resetRunDiscoveries();
    applyState(null);
    startRun('starter', 0);
  } else {
    // Seeded jump — skip starter, equip a starter loadout, land
    // directly on depth-N. floorId 'depth-N' is the procgen convention.
    const floorId = `depth-${depth}`;
    startNewRun(floorId, {
      seed: Number.isFinite(seed as number) ? seed : undefined,
      depth,
    });
    recordRunStart();
    resetRunDiscoveries();
    applyState(null);
    setSlot('weapon', ITEMS['rusted-sword']);
    startRun(floorId, depth);
  }
  return true;
}

// AI-playable harness — dynamic-import so player builds (no ?harness=1)
// don't pay the module's bundle cost. The pause hook is already set
// at the top of this file (synchronous); this wires the rest.
if (HARNESS_ENABLED) {
  void import('./harness').then((mod) => {
    mod.bootHarness({
      scene, camera, renderer, canvas, input, weapon,
      getLevel: () => currentLevel,
    });
    harnessLevelReady = mod.notifyLevelReady;
    harnessTickFn = mod.tickHarness;
    // If a level loaded before the dynamic import resolved (scenario
    // boot is fast), notify immediately.
    if (currentLevel) mod.notifyLevelReady();
  });
}

// Debug capture button — dynamic-import so player builds skip the whole
// debug + harness-observation graph. Enabled at boot by ?debug=1 or the
// persisted DEBUG MODE setting; also toggled live from the settings menu
// (the onSettingsChanged subscription below mounts/unmounts on demand).
//
// NOTE: the annotated screenshot needs preserveDrawingBuffer, which is
// fixed at renderer-creation time from DEBUG_ENABLED (URL flag OR the
// setting AS PERSISTED AT BOOT). So toggling debug ON mid-session gives
// you the text report + console + look-at immediately; full screenshots
// kick in after the next reload (when the buffer flag is re-evaluated).
function setDebugButton(on: boolean) {
  void import('./debug/debug-button').then((mod) => {
    if (on) {
      void import('./debug/console-buffer').then((m) => m.installConsoleBuffer());
      mod.mountDebugButton({
        scene, camera, renderer, canvas,
        getLevel: () => currentLevel,
      });
    } else {
      mod.unmountDebugButton();
    }
  });
}
if (DEBUG_ENABLED) setDebugButton(true);
// Diagnostic readouts are always MOUNTED (cheap hidden DOM) and driven by
// their own DEBUG-tab toggles — independent of DEBUG MODE, like the perf
// overlay. tickers early-out while hidden.
initDarkAdaptReadout();
initBossEncounterReadout();
setDarkAdaptReadoutVisible(getSettings().debugEyeAdapt);
setBossEncounterReadoutVisible(getSettings().debugBossReadout);
// React to the settings-menu toggle live (no reload needed to show/hide
// the button). The URL flag forces it on regardless of the setting.
onSettingsChanged((s) => {
  const urlForced = new URLSearchParams(window.location.search).get('debug') === '1';
  setDebugButton(urlForced || s.debugMode);
  setPerfOverlayVisible(s.perfMeter);
  setDarkAdaptReadoutVisible(s.debugEyeAdapt);
  setBossEncounterReadoutVisible(s.debugBossReadout);
  // Profiler tools — mount/unmount the on-screen toolbar (and tear the suite
  // down) live when the toggle flips. Defined below; hoisted.
  applyProfilerEnabled();
  setShadowMode(s.shadows);
  setAdaptiveResolution(s.adaptiveResolution && !isDesktopLike());
  setOutlineEnabled(s.outlines);
  setSurfaceAOStrength(s.aoStrength);
  setSurfaceDetailEnabled(s.surfaceDetail);
  // Banded lighting toggle: swap the global lighting chunk, then force every
  // visible material to RECOMPILE so it re-reads the new chunk. Just setting
  // needsUpdate isn't enough — Three.js's program cache keys off material
  // params, not chunk content, so it'd reuse the old program. Flipping a
  // (harmless, unused) define changes the cache key → guaranteed recompile.
  if (setBandedLighting(s.bandedLighting)) {
    const band = s.bandedLighting ? 1 : 0;
    const seen = new Set<THREE.Material>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        (mat as THREE.Material & { defines?: Record<string, unknown> }).defines = {
          ...((mat as THREE.Material & { defines?: Record<string, unknown> }).defines ?? {}),
          DELVE_BAND: band,
        };
        mat.needsUpdate = true;
      }
    });
  }
});

// Perf overlay (FPS / frame time / draw calls). Hidden until the PERF
// METER setting flips on — tickPerfOverlay early-outs when hidden so
// the per-frame cost is a single style read.
createPerfOverlay();
setPerfOverlayVisible(getSettings().perfMeter);
// Install window.__perf for the headless perf runner (scripts/perf.ts).
// DEV-only — the literal-false guard strips the call, and installPerfProbe
// itself early-returns unless DEV, so window.__perf can never be set live.
if (import.meta.env.DEV) installPerfProbe(renderer);

// Profiling suite — per-system CPU/GPU profiler HUD, session recorder, spector
// draw-call capture. A SAFE diagnostic (no gameplay effect), so it SHIPS in the
// production build behind the PROFILER TOOLS setting — the same "diagnostics are
// the exception" carve-out the perf meter uses. NOT import.meta.env.DEV gated:
// the whole point is to run it on the live build, on the phone, where the drops
// are. Zero footprint until enabled — the timing core + HUD are lazily created
// the first time the toggle (or a ?profiler / ?profile / ?record session flag)
// turns it on.
//
// Drive it from the on-screen toolbar (phone) or, on desktop, the hotkeys:
//   F2 HUD · F3 record · F4 DevTools marks · F5 GPU probe · F6 draw report. URL: ?profile/record/marks=1.
//   Console: window.__profiler / __perfRec.{...} / __marks / __gpuProbe / __draws / __spector (desktop).
const profilerSessionFlag = ['profiler', 'profile', 'record', 'marks']
  .some((k) => new URLSearchParams(window.location.search).get(k) === '1');
function profilingEnabled(): boolean {
  return getSettings().profilerTools || profilerSessionFlag;
}
let profilingInited = false;
function ensureProfilingInited(): void {
  if (profilingInited) return;
  profilingInited = true;
  initFrameTiming(renderer);
  initDrawReport(scene, renderer, () => currentLevel);
  createProfilerHud();
}
function applyProfilerEnabled(): void {
  const on = profilingEnabled();
  if (on) ensureProfilingInited();
  setRollingEnabled(on);          // dashcam ring fills only while enabled
  setProfilerToolbarVisible(on);
  if (!on) {
    setProfilerVisible(false);
    setMarks(false);
    setGpuProbe(false);
  }
}
applyProfilerEnabled();
// Honour the specific URL flags once the suite is active for this session.
if (profilingEnabled()) {
  const q = new URLSearchParams(window.location.search);
  if (q.get('profile') === '1') setProfilerVisible(true);
  if (q.get('marks') === '1') setMarks(true);
  if (q.get('record') === '1') startRecording('auto');
}
window.addEventListener('keydown', (e) => {
  if (!profilingEnabled()) return;
  if (e.code === 'F2') { e.preventDefault(); toggleProfiler(); }
  else if (e.code === 'F3') { e.preventDefault(); toggleRecording(); }
  else if (e.code === 'F4') { e.preventDefault(); setMarks(!marksOn()); }
  else if (e.code === 'F5') { e.preventDefault(); setGpuProbe(!gpuProbeOn()); }
  else if (e.code === 'F6') { e.preventDefault(); void captureDrawReport(); }
}, true);
const profWin = window as unknown as {
  __profiler: () => void;
  __perfRec: { start: (l?: string) => void; stop: () => void; toggle: () => void; saveLast: (secs?: number) => void };
  __marks: () => void;
  __gpuProbe: () => void;
  __draws: () => void;
  __spector: () => void;
};
profWin.__profiler = () => { ensureProfilingInited(); toggleProfiler(); };
profWin.__perfRec = {
  start: (l) => { ensureProfilingInited(); startRecording(l); },
  stop: stopRecording,
  toggle: () => { ensureProfilingInited(); toggleRecording(); },
  saveLast: (secs) => void saveLastSeconds(secs),
};
profWin.__marks = () => { ensureProfilingInited(); setMarks(!marksOn()); };
profWin.__gpuProbe = () => { ensureProfilingInited(); setGpuProbe(!gpuProbeOn()); };
profWin.__draws = () => { ensureProfilingInited(); void captureDrawReport(); };
profWin.__spector = () => void launchSpector();   // desktop only — heavy UI

// Debug: `?fakemeta=1` seeds meta progress so title shows records +
// the CODEX/STASH buttons without requiring real playthrough.
if (new URLSearchParams(window.location.search).get('fakemeta') === '1') {
  localStorage.setItem('delve:meta', JSON.stringify({
    version: 2,
    runsAttempted: 7, runsDied: 6, deepestDepth: 4, totalKills: 31,
    totalPlayMs: 4 * 60 * 1000,
    enemiesSlain: ['rat', 'skirmisher', 'ghoul'],
    itemsFound: ['rusted-sword', 'scimitar', 'healing-potion', 'leather-gloves',
                 'worn-boots', 'ring-of-vigor', 'iron-coif'],
    notesRead: [
      'I came for the blade. I should have come for the door.',
      'They told us it was one floor. They counted wrong.',
    ],
    achievementsUnlocked: ['first-blood', 'untouched', 'depth-3-reached'],
    stash: [
      { id: 'a1', tier: 'uncommon', source: 'Untouched' },
      { id: 'a2', tier: 'rare', source: 'The Dungeon Notices' },
      { id: 'a3', tier: 'fabled', source: 'Magic Bypass' },
    ],
  }));
}
// Debug: `?god=1` makes the player invulnerable — for posing combat states,
// driving enemies, and screenshotting without dying. DEV-only: the whole
// block is dropped from the production bundle (and setGodMode would refuse
// anyway), so it can't be used on the live site.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('god') === '1') {
  setGodMode(true);
}
// Debug: `?fakesave=1` seeds a save so the title shows CONTINUE for snaps.
if (new URLSearchParams(window.location.search).get('fakesave') === '1') {
  localStorage.setItem('delve:save', JSON.stringify({
    version: 1, floorId: 'depth-2', depth: 2, hp: 4,
    inventory: { 'healing-potion': 2 },
    equipment: { weapon: 'scimitar' },
    startedAt: Date.now() - 240000, kills: 7, itemsFound: ['scimitar', 'healing-potion'],
  }));
}
// Debug hook for snapping the end screen — `?showEnd=1` skips game
// entirely, shows the end-screen with mocked stats.
if (new URLSearchParams(window.location.search).get('showEnd') === '1') {
  import('./ui/end-screen').then(({ showEndScreen }) => {
    showEndScreen(
      {
        depth: 2, kills: 7, itemsFound: 5, elapsed: '4:12',
        epitaph: 'she was unmade in the first dark.',
        discoveries: {
          enemies: ['wraith'],
          items: ['heartburn', 'bone-amulet'],
          notes: 2,
          newDepthRecord: true,
        },
      },
      () => window.location.reload(),
    );
  });
} else if (new URLSearchParams(window.location.search).get('showCodex') === '1') {
  import('./ui/codex-screen').then(({ showCodex }) => showCodex());
} else if (new URLSearchParams(window.location.search).get('showStash') === '1') {
  import('./ui/stash-screen').then(({ showStash }) => showStash());
} else if (new URLSearchParams(window.location.search).get('showPatchlog') === '1') {
  import('./ui/patchlog-screen').then(({ showPatchlog }) => showPatchlog());
} else if (new URLSearchParams(window.location.search).get('showSafeTransition') === '1') {
  // Debug hook — preview the safe-room transition card with mocked stats.
  import('./ui/safe-room-transition').then(({ showSafeRoomTransition }) => {
    showSafeRoomTransition({
      actName: 'The Old Refectory',
      depth: 3,
      kills: 14,
      xp: 247,
    });
  });
} else if (scenario) {
  // Debug scenario — bypass title. Scenario may override the level
  // spec or use the procgen depth-1 fallback.
  const floorId = scenario.level?.id ?? 'depth-1';
  if (scenario.level) LEVELS[scenario.level.id] = scenario.level;
  setSlot('weapon', ITEMS['rusted-sword']);
  // Don't pop the safe-room transition card when a scenario drops the
  // player directly into a safe-N level — the card would cover the
  // very geometry the scenario exists to show. Real gameplay descents
  // still trigger it normally.
  if (floorId.startsWith('safe-')) suppressNextSafeRoomTransition();
  // Inspection previews: skip the title card (it covers the geometry) BEFORE
  // the load fires it, and flood bright flat light + push fog out so the whole
  // room reads. Set after applyScenario below so nothing resets them.
  if (scenario.inspect) suppressNextDescentTitle();
  startRun(floorId);
  // Scenarios may want to mutate enemies / give items / open panels.
  // Runs AFTER startRun so currentLevel is populated.
  applyScenario(scenario, { level: currentLevel, weapon, camera });
  if (scenario.inspect) {
    // All the studio-preview presentation (PSX bypass, lighting rig, backdrop,
    // subject auto-framing) lives in src/debug/inspect-mode.ts. getLevelRoot is
    // a getter because the level loads async — the framing pass reads it later.
    enterInspectMode({
      scene, camera, renderer, ambient,
      subjectOnly: !!scenario.inspectSubjectOnly,
      getLevelRoot: () => currentLevel?.root ?? null,
    });
  }
  // HUD-ONLY mode — the inverse of inspect. Hide the 3D canvas
  // entirely and put a flat backdrop behind whichever HUD widgets
  // the scenario opted to leave visible. For previewing the
  // inventory panel, HP bar, hotbar, broadcast pop, etc. without
  // the dungeon scene fighting them.
  if (scenario.hudOnly) {
    document.body.classList.add('hud-only');
  }
  // Asset-viewer control bar — orbit + play/pause + weapon-phase scrub over the
  // just-loaded subject. The scenario already froze the world (preview default),
  // so orbit owns the camera from frame one.
  if (VIEWER_ENABLED) {
    const scenarioName = new URLSearchParams(window.location.search).get('scenario')!;
    void import('./debug/viewer').then((m) =>
      m.mountViewerControls({ camera, weapon, scenarioName }));
  }
} else if (VIEWER_ENABLED) {
  // ?viewer=1 with no scenario → the picker, in place of the title screen.
  void import('./debug/viewer').then((m) => m.mountViewerLauncher());
} else if (hasPendingDevSnapshot() && loadSave()) {
  // Dev hot-reload returning from DEV AUTO-UPDATE: a pending pose/HP/buffs
  // snapshot means the page just reloaded mid-floor. Skip the title and
  // continue the saved run — the snapshot will restore the player's pose
  // when onLoaded fires for the resumed floor. If there's no save (fresh
  // boot somehow), fall through; the snapshot expires on its 30-min TTL.
  const s = loadSave()!;
  adoptSave(s);
  applyState(s);
  startRun(s.floorId, s.depth);
} else if (handleAutostart()) {
  // Autostart flow ran (DESCEND / CONTINUE / seeded jump). Title is bypassed.
} else {
  // Normal boot — title screen, then DESCEND or CONTINUE. Wrapped in
  // a function so sub-screens (like the test chambers picker) can
  // re-open the title on BACK.
  function openTitle() {
    // Title is the safest moment to apply a pending PWA update — no
    // in-progress run state, save (if any) is on disk. If an update
    // is pending AND the player has Auto Update on (default), take
    // it now; the page navigates and this title invocation becomes
    // a no-op. With Auto Update off they have to install via the
    // settings menu's UPDATE NOW button instead.
    if (getSettings().autoUpdate) void maybeApplyUpdateSilently();
    const save = loadSave();
    showStartScreen({
    hasSave: !!save,
    saveDepth: save?.depth,
    onDescend() {
      clearSave();
      // First-ever run gets the tutorial chamber; everyone else lands
      // straight in procgen depth-1. "Ever attempted a run" is tracked
      // in meta-state and survives across saves/deaths.
      //
      // Dev: ?tutorial=1 forces the tutorial path regardless of
      // meta-state, so you can iterate on the tutorial chamber
      // without clearing localStorage each time. URL example:
      //     https://...brainstorm/?tutorial=1
      const forceTutorial = new URLSearchParams(window.location.search).get('tutorial') === '1';
      const isFirstRun = getMeta().runsAttempted === 0;
      const wantTutorial = forceTutorial || isFirstRun;
      // Every fresh run now starts in the starter chamber — three
      // altars, one weapon each. The chamber's stair-target depends
      // on whether this is also the player's first-ever run (then
      // tutorial after picking; otherwise straight to depth-1).
      const nextAfterStarter = wantTutorial ? 'tutorial' : 'depth-1';
      LEVELS['starter'] = buildStarterChamber(nextAfterStarter);
      startNewRun('starter');
      recordRunStart();
      resetRunDiscoveries();
      resetCharacter();
      applyState(null);
      startRun('starter', 0);
    },
    onTutorial() {
      // Explicit replay path — always routes through the starter
      // chamber THEN the tutorial, mirroring a first-time-ever run.
      clearSave();
      LEVELS['starter'] = buildStarterChamber('tutorial');
      startNewRun('starter');
      recordRunStart();
      resetRunDiscoveries();
      resetCharacter();
      applyState(null);
      startRun('starter', 0);
    },
    onTestChambers() {
      // Open the chamber picker. Picking a card loads its hand-
      // authored small level into a fresh test run. Test chambers
      // never write to localStorage (see run-state-listeners) so
      // any in-progress real save stays untouched. On BACK from the
      // picker, re-open the title.
      showTestChambersScreen(
        (chamberId) => {
          const chamber = findTestChamber(chamberId);
          if (!chamber) {
            // eslint-disable-next-line no-console
            console.warn(`Unknown test chamber: ${chamberId}`);
            return;
          }
          const spec = chamber.build();
          LEVELS[spec.id] = spec;
          // Fresh test run — give the player the chamber's stated
          // loadout (or rusted sword + lamp by default) so they're
          // not unarmed in front of the feature.
          startNewRun(spec.id);
          recordRunStart();
          resetRunDiscoveries();
          applyState(null);
          const lo = chamber.loadout ?? { weapon: 'rusted-sword' };
          if (lo.weapon && ITEMS[lo.weapon]) setSlot('weapon', ITEMS[lo.weapon]);
          if (lo.offhand && ITEMS[lo.offhand]) setSlot('offhand', ITEMS[lo.offhand]);
          // Consumables → bag (auto-fills the hotbar). Used by the
          // boss-test chamber so the player isn't starting with no
          // potions in front of a boss.
          if (lo.consumables) {
            for (const id of lo.consumables) {
              if (ITEMS[id]) addItemSilently(id);
            }
          }
          startRun(spec.id, 0);
        },
        () => openTitle(),   // BACK — re-show the title
      );
    },
    onProvingGrounds() {
      showProvingGroundsScreen(
        (launch) => {
          let floorId: string;
          let depth = 0;
          if (launch.mode === 'descent') {
            depth = parseInt(launch.target, 10) || 1;
            floorId = `proving-depth-${depth}`;
          } else {
            const spec = launch.mode === 'fight'
              ? buildFightLevel(launch.target)
              : buildEventLevel(launch.target);
            if (!spec) { openTitle(); return; }
            LEVELS[spec.id] = spec;
            floorId = spec.id;
          }
          // Save-safe: NO clearSave (the real on-disk save is untouched —
          // proving- floors are never persisted) and NO recordRunStart (don't
          // inflate meta). startNewRun only swaps the in-memory run.
          startNewRun(floorId, depth ? { depth } : undefined);
          resetRunDiscoveries();
          applyState(null);
          if (ITEMS[launch.weaponId]) setSlot('weapon', ITEMS[launch.weaponId]);
          startRun(floorId, depth);
        },
        () => openTitle(),
      );
    },
    onContinue() {
      const s = loadSave();
      if (!s) {
        // Save vanished between title render + click. Fall back to fresh.
        clearSave();
        startNewRun('depth-1');
        recordRunStart();
        resetRunDiscoveries();
        applyState(null);
        startRun('depth-1', 1);
        return;
      }
      adoptSave(s);
      // CONTINUE doesn't reset discoveries — it picks up where the
      // mid-run discovery tracking left off. (resetRunDiscoveries is
      // also implicitly fresh on first load since the module-level
      // discoveries object starts empty.)
      applyState(s);
      startRun(s.floorId, s.depth);
    },
    });
  }
  openTitle();
}
