import * as THREE from 'three';
import { createRenderer } from './scene/create-renderer';
import { initEmbersGPU } from './effects/embers-gpu';
import { initLampSpot } from './player/lamp-spot';
import { setLampSpotActive } from './scene/light-pool';

// Lamp spot-shadow split — DEFAULT ON (2026-07-03): the omni lamp's cube shadow
// re-encoded the scene 6× per frame and was ~40% of the phone's CPU encode wall
// (13→8 passes, 3.3→2.3ms desktop encode with the split). A dim shadowless omni
// keeps the all-around reveal; the forward SpotLight carries the light + casts a
// single-map shadow that rakes the floor ahead. ?lampspot=0 restores the cube
// shadow for A/B.
const LAMP_SPOT = new URLSearchParams(window.location.search).get('lampspot') !== '0';
import { CONFIG } from './config';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, setCameraYaw, setCameraPitch } from './controls/camera';
import { createWeaponViewmodel } from './player/viewmodel';
import { attachLamp, setLampStowed, tickLamp } from './player/handheld-lamp';
import { attachLampArm } from './player/lamp-arm';
import { initBreath } from './effects/breath';
import { attachOffhandViewmodel, detachOffhandViewmodel } from './player/handheld-offhand';
import { setSlot, onEquipmentChanged } from './player/equipment';
import { setCurrentWeapon, FIST_STATS } from './player/current-weapon';
import { ITEMS } from './content/items';
import { runWarmupPassWebGPU } from './content/warmup-pass';
import { warmRealRoster } from './content/warm-real-roster';
import { canSkipRosterWarm, markRosterWarmed, noteCoveredWarmPoint } from './content/warm-cache';
import { installRenderPassCpu } from './debug/render-pass-cpu';
import { installUploadCounter } from './debug/upload-counter';
import type { DelveRenderer } from './scene/create-renderer';
import { initStatusVfxPool } from './effects/status-vfx';
import { initNetwork, pushDisplayName } from './net/delve-net';
import { initDeathFeed } from './net/death-feed';
import { completePendingLink } from './net/account-link';
import { initRunSync } from './net/run-sync';
import { initTelemetry, track, setCrashContext } from './telemetry/telemetry';
import { createCombatSystem, spendSwingStamina } from './combat/attack';
import { initRites } from './combat/rites';
import { onPlayerDeath } from './player/health';
import { triggerDeath, isDying, initDeath, setOnDeathStart } from './player/death';
import {
  triggerParry, deflectOpportunityActive,
} from './combat/reactive-defense';
import {
  bindPlayerActionSources, canStartAction, enterParry, } from './combat/player-action';
import { setupBossCinematics } from './mobs/boss-cinematics';
import { initWeaponDrop, dropHeldItem } from './player/weapon-drop';
import { initFogWalkthrough, isFogWalkthroughActive } from './player/fog-walkthrough';
import { initAchievements } from './broadcast/achievements';
import { initEventLog } from './broadcast/event-log';
import { initRewardAudio } from './audio/reward-audio';
import { initPlayerProfile } from './ai/player-profile';
import { initAIRewards } from './ai/ai-rewards';
import { initAcquisitionBeat } from './ui/acquisition-beat';
import { buildMaterials } from './style/materials';
import { setMasterBrightness, getViewmodelRoots } from './style/render-frame';
import { initEncounterFeedback } from './feedback/encounter-feedback';
import { initArenaLightArc } from './feedback/arena-light-arc';
import { initLux } from './debug/lux';
import { setSplatWallProbe } from './scene/splat-map';
import { setSurfaceAOStrength } from './style/surface-ao';
import { setSurfaceDetailEnabled } from './style/surface-detail';
import { installBandedLightingWebGPU, setLeanLightingWebGPU } from './style/banded-lighting-webgpu';
import {
  enterInspectMode,   INSPECT_REQUESTED,
} from './debug/inspect-mode';
import { createSettingsMenu, configureSettingsMenu } from './ui/settings-menu';
import { registerFrameCapture } from './report/frame-capture';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings, onSettingsChanged } from './settings/settings';
import { beginArrival, suppressArrivalCeremony } from './player/arrival';
import { initChasmPresence } from './effects/chasm-presence';
import { setMasterVolume, setReverbEnabled, startAmbience, playWhoosh, suspendAudio, resumeAudio } from './audio/sfx';
import { startMusic, setMusicVolume, pauseMusic, resumeMusic } from './audio/music';
import { emit, on as onEvent } from './broadcast/event-bus';
import { type LiveLevel } from './level/builder';
import { createRoomCuller, type RoomCuller } from './level/room-culling';
import { batchStaticFixtures } from './level/static-merge';
import { bundleStaticLevelContent } from './scene/render-bundles';
import { setSpriteBatchScene } from './scene/sprite-batch';
import { setFlameMeshBatchScene } from './scene/flame-mesh-batch';
import { raiseFlaskForWarm } from './player/flask-viewmodel';
import { batchStaticWorld } from './scene/static-batch';
import { initCombatDebug } from './combat/combat-debug';
import { initGoreDebug, setGoreDebugEnabled } from './debug/gore-debug';
import { LEVELS } from './level/specs';
import { TITLE_VIGNETTE } from './level/title-vignette';
import type { ModelSpec } from './ecs/model-types';
import { buildStarterChamber } from './level/starter-chamber';
import { findTestChamber } from './level/test-chambers';
import { showTestChambersScreen } from './ui/test-chambers-screen';
import { initLevelLoader, loadInitialLevel, getCurrentDepth } from './level/loader';
import { generateFloor } from './level/procgen';
import { generateSafeRoom } from './level/safe-room';
import { suppressNextSafeRoomTransition } from './ui/safe-room-transition';
import { suppressNextDescentTitle, setDescentProgress, holdCover } from './ui/descent-fade';
import { startNewRun, adoptSave, loadSave, clearSave, getRunState } from './state/run-state';
import { applyState } from './state/save-hydration';
import { initCharacterTracking, resetCharacter } from './state/character';
import { initWeaponUsage, resetWeaponUsage } from './player/weapon-usage';
import { initRunStateListeners } from './state/run-state-listeners';
import { type GameSystem } from './engine/loop';
import { buildSystems } from './engine/systems';
import { initDarkAdaptReadout, setDarkAdaptReadoutVisible } from './debug/dark-adapt-readout';
import { initBossEncounterReadout, setBossEncounterReadoutVisible } from './debug/boss-encounter-readout';
import { seedRng } from './engine/rng';
import { resetGameClock } from './engine/game-clock';
import { startRecording as startRunRecording, finishRun, recordedSteps } from './harness/run-recorder';
import { setWorldFrozen } from './debug/freeze';
import { recordRunStart, resetRunDiscoveries, getMeta, getPlayerName, setPlayerName } from './state/meta-state';
import { showStartScreen } from './ui/start-screen';
import { showNameEntry } from './ui/name-entry-screen';
import { addItemSilently } from './player/inventory';
import { get as getEntity } from './ecs/world';
import { getScenarioFromUrl, applyScenario, buildVaultPreviewLevel } from './debug/scenarios';
import { initAiGizmos } from './debug/ai-gizmos';
import { showProvingGroundsScreen } from './ui/proving-grounds-screen';
import { buildFightLevel, buildEventLevel } from './level/proving-grounds';
import { isAnyScreenOpen, msSinceLastScreenClose, onScreenStateChanged, isWorldPausedByScreen } from './ui/screen-manager';
import { spawn as spawnEntity } from './ecs/world';
import { initTriggerListener } from './ecs/triggers';
import { setupPwaAutoUpdate, maybeApplyUpdateSilently, awaitBootUpdate, setBeforeReloadHook } from './pwa-update';
import { captureDevSnapshot, applyDevSnapshot, clearDevSnapshot, hasPendingDevSnapshot } from './state/dev-snapshot';
import { createPerfOverlay, setPerfOverlayVisible } from './ui/perf-overlay';
import { markWarmupComplete } from './debug/frame-timing';
import { createChargeRing } from './ui/charge-ring';
import { getInRangeInteractable, getAllInteractables, resolveUsable } from './interactables/system';
import { findTapTarget } from './controls/tap-target';
import { resolveTap } from './controls/tap-resolve';
import { triggerAttack } from './controls/attack-input';
import { triggerInteract } from './controls/interact-input';
import { initPickupLightPool } from './interactables/pickup';
import { setShadowMode, setEnvLightMuls, setWickFillMul, tickLightPool } from './scene/light-pool';
import { setAdaptiveWallClockFallback } from './scene/adaptive-resolution';
import { warmSceneCompile, waitForPresentedFrames, warmRenderWebGPU, flushWarmRenders, setWarmLowRes } from './style/render-webgpu';
import { beginBoot } from './boot-guard';
import { installContextRecovery, installDeviceLossRecovery } from './scene/context-recovery';
import { markWebGPUWarmupComplete } from './debug/webgpu-compile-guard';
import { bootstrapSimWorld } from './engine/sim-bootstrap';
import { validateContent } from './content/validate';
import { initDriftingMotes } from './effects/drifting-motes';
import { initBladeTrail } from './effects/blade-trail';
import { actForDepth } from './level/acts';
import { ensureInteractLabel, setInteractLabelTapHandler } from './ui/interact-label';
import { createConsumableBar } from './controls/consumable-bar';
import { createRiteButton } from './controls/rite-button';
import { createHpBar } from './ui/hp-bar';
import { createStaminaBar } from './ui/stamina-bar';
import { createHealthHearts } from './ui/health-hearts';
import { createStaminaArc } from './ui/stamina-arc';
import { createXpSigil } from './ui/xp-sigil';
import { createBossBar, resetBossBar } from './ui/boss-bar';
import { createBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { initOrnateSkin } from './ui/ornate-skin';
import { initDotDamageNumbers } from './ui/damage-numbers';
import { maybeShowCalibrateHint } from './ui/calibrate-hint';
import { createDepthCounter, setDepth as setDepthCounter } from './ui/depth-counter';
import { createXpGoldHud } from './ui/xp-gold-hud';
import { setGodMode } from './player/health';
import { setHarnessPaused } from './harness/pause';
import { initVideoSettings, applyVideoSettings } from './scene/video-settings';
import { setBootProgress, hideBootLoading, armBootVeilSafetyNet, bootVeilHeartbeat } from './ui/boot-veil';
import { initFrameLoop, startFrameLoop, isFixedStepLoop } from './engine/frame-loop';
import { installDevHooks } from './debug/dev-hooks';
import { mountLuxButtonIfEnabled } from './debug/lux-button';
import { initProfilerWiring, applyProfilerEnabled } from './debug/profiler-wiring';
import { applyFakeStateFlags, handleDebugScreenFlags } from './debug/boot-url-screens';

// The entry module executed — tell the stale-shell watchdog in index.html the app booted,
// so it won't self-heal (reload). If a deploy had left a stale cached shell pointing at
// dead chunk hashes, this line would never run and the watchdog would refresh us onto the
// fresh build instead of stranding on a blank screen.
(window as unknown as { __delveBooted?: boolean }).__delveBooted = true;
window.dispatchEvent(new Event('delve:booted'));

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

// Boot-loop safe mode — if the last two boots crashed before the first frame
// rendered (corrupt save, bad cached build, device init failure), show a
// recovery screen instead of re-crashing forever. Halts the rest of boot.
if (!beginBoot()) throw new Error('delve: safe mode (boot guard)');

const canvas = document.getElementById('scene') as HTMLCanvasElement;

// --- Renderer (async boot phase 1) ---
// TOP-LEVEL AWAIT: nothing below this line runs until the backend device
// exists, so the whole boot (scene, materials, warmup, the frame loop) is
// structurally after-init — no ready-flag threading. If init rejects (no
// WebGPU AND no WebGL2), the throw halts boot and the boot guard shows the
// recovery screen on the next load instead of a silent black canvas.
const renderer = await createRenderer(canvas);
resolveCrashGpu();   // adapter/context exists now — fill the crash report's GPU name
// Per-pass CPU encode buckets for the profiler/recorder ('render·shadow' /
// 'render·scene' / 'render·post' / 'render·canvas'). Ships in prod like the
// rest of the profiler chain — phone recordings are how we attribute CPU cost.
// Idle cost: one boolean per render pass.
installRenderPassCpu(renderer);
// Per-frame GPU-upload counters (writeBuffer count + KB) for the recorder's
// ub/ubKB columns — distinguishes an upload-burst "encode storm" from a GC
// pause landing mid-encode. Same prod-shipping policy as the pass buckets.
installUploadCounter(renderer);
// On the WebGL2 FALLBACK backend most mobiles have no GPU timestamps
// (EXT_disjoint_timer_query_webgl2), which would leave adaptive resolution
// with no signal at all — arm its wall-clock fallback there (valid because
// that backend submits synchronously, so rAF intervals reflect GPU load).
setAdaptiveWallClockFallback(!!(renderer.backend as unknown as { isWebGLBackend?: boolean })?.isWebGLBackend);
// DPR cap + canvas size — owned by scene/video-settings.ts (one module applies
// the render-scale/bloom/DPR settings identically at boot and on change).
initVideoSettings(renderer);
// (The WebGPU low-res fill win now comes from the RenderPipeline's PassNode
// setResolutionScale — see style/render-webgpu.ts — so no pixel-ratio stopgap.)
// WEBGPU SPIKE EXPERIMENT: point-light cube shadows redraw the scene 6× per
// (Shadows were briefly disabled under WebGPU to test a draw-call spike that
// turned out to be a stale-counter artifact, not shadows. Re-enabled — the lost
// shadow contrast was a big part of the "washed/flat" look.)
renderer.shadowMap.enabled = true;
// PCF (not PCFSoft): the point-light cube shadow is the heaviest fragment shader
// we run, and PCFSoft adds a wide multi-tap softening loop on top. On mobile that
// complex variant is the most likely to hit a slow driver path under load (the
// "shadows get worse, a recompile/idle fixes it" symptom). PCF is a simpler,
// cheaper sample — and at the 256² shadow map the softening was barely visible.
renderer.shadowMap.type = THREE.PCFShadowMap;
// The PSX pipeline renders TWICE per frame (scene → low-res target, then a
// fullscreen blit quad → screen; see style/render-target.ts). Three.js
// auto-resets renderer.info at the start of every render() call, so by
// frame-end info.render would reflect ONLY the blit quad (1 draw, 2 tris).
// Turn auto-reset off and reset once per frame inside the render path so the
// counters ACCUMULATE across all passes — i.e. report the true frame total.
// (WebGL: renderWithStyle resets. WebGPU: renderWebGPU resets before the
// RenderPipeline's multi-pass render — autoReset is unreliable under WebGPU and
// would otherwise climb without bound.)
renderer.info.autoReset = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// ACES lifts blacks + rolls highlights — a milky filmic veil ("diffusion
// screen"). The WebGPU pipeline does its own exposure + hard clip (NoToneMapping)
// for the punchy PSX look, so kill ACES on the renderer too (the node pipeline's
// default output transform reads this) — otherwise it washes the whole image.
renderer.toneMapping = THREE.NoToneMapping;   // node pipeline does its own exposure + hard clip
renderer.toneMappingExposure = 0.9;

// --- Scene ---
const scene = new THREE.Scene();
// DEV-only scene handle for headless inspection (screenshot harnesses,
// hurtbox/zone counts). Stripped from prod by the import.meta.env.DEV gate.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__scene = scene;
scene.background = new THREE.Color(CONFIG.FOG_COLOR);
scene.fog = new THREE.Fog(CONFIG.FOG_COLOR, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);
// Enable the instanced sprite batch (flames/wisps/glows in 1-2 draws) — must
// precede the first level build so torch/prop builders route their additive
// sprite parts into it. Bench/viewer tools never call this and keep Sprites.
setSpriteBatchScene(scene);
// Same for the solid emissive flame BLOBS (candle/torch spheres) — the
// instanced flame-mesh batch collapses them to one draw (?flamebatch=0 A/B).
setFlameMeshBatchScene(scene);

// WEBGPU: halve the ambient fill. r184's units make AMBIENT_INTENSITY read much
// brighter (flat wash on the stone). Trimming the fill here — rather than via a
// low global exposure — lets exposure stay high enough that the EMISSIVE/additive
// flames stay vivid (a low exposure dimmed them to faint/transparent).
const ambient = new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY * 0.3);
scene.add(ambient);

// GPU compute embers (WebGPU-only) — rise off the torches. Builds the storage
// buffers + Points cloud now; the init/update compute runs from the loop. No-op
// on WebGL.
initEmbersGPU(renderer, scene);

// Lamp spot-shadow: add the forward SpotLight + tell the pool to dim/de-shadow
// the omni lamp point. The split makes the lamp's shadow a single-map render.
if (LAMP_SPOT) { initLampSpot(scene); setLampSpotActive(true); }

// Inspection mode (preview snaps) lives in src/debug/inspect-mode.ts — the
// studio lighting rig, PSX bypass, backdrop, and subject auto-framing are all
// owned there. main.ts only calls enterInspectMode()/tickInspectFraming() and
// asks isInspectActive().

// --- Static surface materials (PS1) ---
// Patch the global lighting chunk FIRST so every material compiles with the
// chosen banded-lighting state. Must precede any material compile; runtime
// toggle is handled in the onSettingsChanged subscription. WebGPU uses a
// lighting-model patch (no shared shader chunk under the node renderer).
installBandedLightingWebGPU(getSettings().bandedLighting);
// ?lean=1 — compile the LEAN lighting model from boot (no live-recompile uncertainty)
// for a clean A/B of the per-light BRDF cost.
if (new URLSearchParams(location.search).get('lean') === '1') setLeanLightingWebGPU(true);
const materials = buildMaterials(renderer);
// GPU-loss recovery — WebGL2 context events (recoverable in place; onRestore
// is a no-op since the node renderer owns its own targets) + the WebGPU
// device.lost watch (unrecoverable in place → veil + reload offer; the save
// persists so a reload resumes the run).
installContextRecovery({ canvas, onRestore: () => {} });
installDeviceLossRecovery(renderer);
// Encounter feedback orchestrator — subscribes to gate/encounter lifecycle
// events and fires their sound + shake + dust stingers (dust attaches to the
// persistent scene root, cleared per level alongside the other effect pools).
initEncounterFeedback(scene);
// Arena light arc — subscribes to encounter activate/complete and breathes the
// room's torch brightness (dim → surge → hold → exhale → residual).
initArenaLightArc();
setSurfaceAOStrength(getSettings().aoStrength);
setSurfaceDetailEnabled(getSettings().surfaceDetail);
setMasterBrightness(getSettings().brightness);
setEnvLightMuls(getSettings().torchStrengthMul, getSettings().torchRangeMul);
setWickFillMul(Math.pow(getSettings().wick, 1.5));

// --- Camera ---
const camera = createFirstPersonCamera();
scene.add(camera); // required for the sword (camera child) to render

// Bug-report frame capture: a fresh render then a canvas read (WebGPU buffers
// aren't guaranteed to survive present), giving the report a clean game-view
// screenshot + the camera pose. Registered once; read on demand by the report UI.
registerFrameCapture(() => {
  let png: string | null = null;
  try { renderer.render(scene, camera); png = canvas.toDataURL('image/png'); } catch { /* read blocked */ }
  return {
    png,
    cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    yaw: camera.rotation.y,
  };
});
if (import.meta.env.DEV) initAiGizmos(scene);   // DEV facing gizmos (?aigizmos=1 / ai-lab)
// LUX perceived-light meter (debug/lux.ts) — measures the RENDERED
// frame. Wired early so the render system's flushLux has its refs.
initLux(camera, () => currentLevel?.spec ?? null);
// Blade trail mesh attaches to the world scene root (NOT the camera) so it
// reads in world space and depth-tests correctly against geometry. Persistent
// across levels — one buffer, dynamic updates.
initBladeTrail(scene);
initCombatDebug(scene);
initGoreDebug(scene);
setGoreDebugEnabled(getSettings().debugGoreSplats);
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
// Previous floor id — decides the wake ceremony tier (see onLoaded).
let lastLevelId: string | null = null;

// Portal/room culling (opt-in). The culler is rebuilt whenever the active
// level changes and torn down when the setting is off. A 'room-culling' system
// (engine/systems.ts) ticks it each frame between camera-move and render.
let roomCuller: RoomCuller | null = null;
let cullerLevel: LiveLevel | null = null;
// DEV: ?portalcull=1 forces it ON (over a saved 'off'), =0 forces it OFF — so a
// perf scenario can A/B the culler's contribution. Stripped from prod.
const PORTAL_CULL_FLAG = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('portalcull')
  : null;
const PORTAL_CULL_FORCED = PORTAL_CULL_FLAG === '1';
const PORTAL_CULL_DISABLED = PORTAL_CULL_FLAG === '0';
function syncRoomCuller() {
  const want = !PORTAL_CULL_DISABLED
    && (getSettings().portalCulling || PORTAL_CULL_FORCED) && !!currentLevel;
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

// One-shot guard: the enemy-roster shader pre-compile (in the live light
// config) only needs to run once — programs stay resident after.
let rosterPrecompiled = false;

/** Yield to the browser so a just-shown cover (descent fade, boot veil, spawn screen) actually PAINTS —
 *  and its CSS transition starts animating — BEFORE we block the main thread on a heavy warm/compile. Two
 *  rAFs guarantee a paint landed; the small delay lets the transition become visible, so the freeze hides
 *  behind a moving screen instead of a frozen click. Cheap (~1-2 frames + delay), once per transition. */
function yieldToCover(delayMs = 90): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, delayMs)));
  });
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
    // Fold the whole static world into floor-wide BatchedMeshes — one render
    // object per material family, colours baked to vertex attributes, per-rect
    // visibility driven by the room culler (?batchworld=0 kill switch; see
    // scene/static-batch.ts). AFTER the fixture merge (its output batches
    // too), BEFORE the freeze + room culler.
    batchStaticWorld(currentLevel);
    // Matrix-FREEZE the static world (walls/props never move; the per-frame
    // updateMatrixWorld math measured ~6-8% of phone CPU). Also hosts the
    // DEV-parked ?bundles=1 render-bundle experiment (currently broken at the
    // Three level — see render-bundles.ts verdict). Must run BEFORE the room
    // culler reads root children.
    bundleStaticLevelContent(currentLevel);
    // PRE-WARM the floor's shaders NOW, behind the level-transition fade, while
    // every room is still visible (the portal culler hasn't run yet, so this
    // sees the whole floor). Without this, the FIRST time you turn to reveal a
    // portal-culled room, Three.js compiles that room's shell/decor programs on
    // the spot — a one-frame hitch that never repeats (resident after). boot
    // warmupContent only covers enemy/item models; this covers the procgen
    // floor. Non-fatal if it throws (older driver) — it's pure pre-pay.
    // Pre-compile the visible scene's shaders so the first reveal of a room
    // doesn't hitch. On WebGPU this is LOAD-BEARING for perf, not just hitch
    // avoidance: every material is a render PIPELINE that must be compiled before
    // it can draw, and with the warmup disabled the node renderer was compiling
    // them lazily mid-render (the ~89ms-for-25k-tris symptom). compileAsync warms
    // every pipeline up front (it awaits backend init internally).
    // PRE-WARM → `prewarm`. The loader gates the reveal on this WHOLE promise
    // (revealWhenReady): roster warm, real-roster warm, the deferred drain, the
    // per-floor compile AND the shadow-depth warm all finish behind the black.
    // The rule (2026-07-02): ALL loading behind a load screen — any warm work
    // that leaks past the reveal runs in live frames and freezes gameplay
    // (renderWebGPU skips submits while warmingUp). The cover's strand-guard is
    // a watchdog (descent-fade.ts) that holds while warm work heartbeats, so
    // gating everything can't strand the black either. We do NOT run any of it
    // on the title vignette (combat effects must never flash on the title).
    const isTitleVignette = level.spec.id === 'title-vignette';
    let prewarm: Promise<void> | undefined;
    if (new URLSearchParams(location.search).get('nowarm') === '1') {
      // ?nowarm=1 — skip ALL pipeline warming: the roster warm AND the per-floor
      // compileAsync below. Pipelines compile lazily — first-use stutter is
      // EXPECTED here; the only point is to A/B whether warming is behind the
      // 'output' texture hazard. prewarm stays undefined.
    } else if (!isTitleVignette) {
      // WebGPU real floor — warm behind the descent cover, GATED on the reveal so the floor
      // compiles before the player sees it. Two parts:
      //   1. First real floor only: the spawn-time ROSTER (enemies/effects) via the warm pass.
      //   2. EVERY floor: warmSceneCompile — compileAsync over the whole scene at the correct PSX
      //      render-target format (see render-webgpu.ts). This is the fix the deep-research +
      //      Pipelines.js read surfaced: compileAsync warms at the BOUND target's format, and our
      //      scene renders into the PSX pass target, not the canvas — so we bind it first. It
      //      traverses EVERY material (all rooms, not just the frustum), so it kills both the
      //      descent hitch AND the "chunk when moving" hitch. Fast because the bounded boot-warmed
      //      set (decor/roster/static interactables) is already compiled — descent only does the
      //      floor's residue.
      prewarm = (async () => {
        // Let the descent cover paint + its fade animate BEFORE we block on the warm — otherwise the
        // compile freezes the frame the instant DESCEND is clicked, before the transition can show.
        await yieldToCover();
        // Pump the floor's lights to PLAY-STATE before any warm renders. The compile diagnostic proved
        // the warm was compiling UNLIT (no lights collected pre-game-loop → the lean-lights node saw an
        // empty set → hasLights=false → unlit shader), so its shaders never matched the lit game render.
        // tickLamp positions the handheld lamp; tickLightPool assigns + activates the torch slots for the
        // spawn — so by the time the warm renders, the lighting node collects the real lights and compiles
        // the LIT pipeline the game draws.
        try {
          const w = (level as { walkable?: { hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean } }).walkable;
          const los = w ? (ax: number, az: number, bx: number, bz: number): boolean => w.hasLineOfSight(ax, az, bx, bz) : undefined;
          tickLamp(0.1);
          tickLightPool(camera, los);
        } catch { /* best-effort — warm still runs, just possibly unlit */ }
        if (!rosterPrecompiled) {
          rosterPrecompiled = true;
          // REPEAT OPENS SKIP THE ROSTER WARM (content/warm-cache.ts): once this
          // build+settings key has warmed fully on this device, the browser's
          // persistent pipeline cache makes first-use creations fast — the floor
          // itself is still compiled below (warmSceneCompile, every descent), and
          // a session that compiles too much in play clears the marker so the
          // next open warms fully again.
          if (canSkipRosterWarm()) {
            if (import.meta.env.DEV) console.log('[warm-cache] roster warm SKIPPED (marker hit)');
          } else {
            try { await runWarmupPassWebGPU(renderer, scene, camera, setDescentProgress); } catch { /* best-effort */ }
            // Warm through the REAL build path — one real instance of every enemy/prop/item, compiled at
            // the PSX format, so the warmed pipeline can't drift from the live spawn (kills the dummy-vs-
            // real tail). Once per build+settings key, behind the descent cover. See warm-real-roster.ts.
            try { await warmRealRoster(renderer, scene, camera, setDescentProgress); } catch { /* best-effort */ }
            markRosterWarmed();
          }
          markWarmupComplete(); markWebGPUWarmupComplete();
        }
        await warmSceneCompile(renderer, scene, camera);
        // PREPARE PASS — pipelines aren't the only first-render cost: three
        // builds each OBJECT's GPU state (bind groups, uniform buffers) the
        // first time it's encoded, and the room culler keeps most of the floor
        // hidden, so opening a door mid-fight un-hid ~80 unprepared objects at
        // once — measured 86+76ms back-to-back on the phone (2026-07-03 rec,
        // frame 420). Render the floor ONCE with culling lifted, behind the
        // cover at warm resolution: every room's objects prepare here and the
        // door-open becomes free.
        try {
          roomCuller?.setEnabled(false);
          setWarmLowRes(true);
          // Raise the flask rig into this covered frame: its pipelines must
          // compile under the PLAY lighting context (lamp shadow live) — the
          // boot warm ran on the title where no lamp exists, and the first
          // mid-fight sip paid two live compiles (2026-07-05 phone recs).
          // Also pre-builds the live rig (the ~27ms first-sip compose).
          const flaskWarm = raiseFlaskForWarm(camera);
          try {
            await warmRenderWebGPU(renderer, scene, camera, 1);
          } finally { flaskWarm.restore(); }
        } catch { /* best-effort */ } finally {
          setWarmLowRes(false);
          roomCuller?.setEnabled(true);
          try { await flushWarmRenders(renderer); } catch { /* best-effort */ }
        }
        // Covered-compile baseline for the warm cache's self-heal check — pipeline
        // growth from here until the next descent is in-play compiling.
        noteCoveredWarmPoint(renderer as unknown as DelveRenderer);
      })();
    }
    setCameraYaw(level.playerSpawn.yaw);
    // Gore-debug markers parent into the LEVEL group — runtime adds to
    // the scene root don't rasterize in this pipeline (blood-burst
    // droplets, which render fine, live under the level group too).
    initGoreDebug((level as { root?: THREE.Object3D }).root ?? scene);
    // Wall probe for blood arcs: march from the hit point along the
    // throw until the walkable grid goes solid — that's the wall.
    setSplatWallProbe((x, z, dx, dz) => {
      const w = (level as { walkable?: { contains(x: number, z: number, r: number): boolean } }).walkable;
      if (!w) return null;
      let px = x, pz = z;
      for (let t = 0.15; t <= 1.35; t += 0.15) {
        const nx = x + dx * t, nz = z + dz * t;
        if (!w.contains(nx, nz, 0.05)) {
          // Which axis did we cross into? Test each axis-step alone;
          // ambiguous corners tie-break by the march's dominant axis
          // (the old x-only test misclassified corners → stains on
          // the PERPENDICULAR wall).
          const xBlocked = !w.contains(nx, pz, 0.05);
          const zBlocked = !w.contains(px, nz, 0.05);
          const xCross = xBlocked === zBlocked ? Math.abs(dx) >= Math.abs(dz) : xBlocked;
          return xCross
            ? { axis: 'x' as const, plane: (px + nx) / 2, along: (pz + nz) / 2 }
            : { axis: 'z' as const, plane: (pz + nz) / 2, along: (px + nx) / 2 };
        }
        px = nx; pz = nz;
      }
      return null;
    });
    setCameraPitch(0);   // forget the stairs — wake looking level
    // Wake seated at the threshold bonfire. FULL ceremony (heavy blink,
    // blur-to-focus) where the fiction says you slept: the run's first
    // floor, the tutorial, and the floor after a safe-room rest.
    // Regular descents get the quick wake.
    const slept =
      lastLevelId === null || lastLevelId === 'tutorial' || lastLevelId.startsWith('safe-') ||
      level.spec.id === 'tutorial' || level.spec.id.startsWith('safe-');
    // Scenarios skip the wake — frozen/posed worlds never tick the
    // lids open (black screen), and a debug jump isn't an arrival.
    if (!import.meta.env.DEV || !getScenarioFromUrl()) beginArrival({ full: slept });
    initChasmPresence(level.spec.voids);
    lastLevelId = level.spec.id;
    setDepthCounter(getCurrentDepth(), level.spec.id.startsWith('safe-') || level.spec.id === 'tutorial');
    resetBossBar();   // new floor — clear any prior boss bar state

    // First-run nudge toward brightness calibration (it moved off the bonfire
    // into Settings). TUTORIAL-ONLY (Josh): it's a teaching beat for a
    // first-time player, not something returning players — or repro/test snaps,
    // which have no scenario so they used to trip it — should meet on every
    // floor. Still self-gates on calibrateHintSeen, and it's always in Settings.
    if (
      (!import.meta.env.DEV || !getScenarioFromUrl()) &&
      level.spec.id === 'tutorial'
    ) {
      maybeShowCalibrateHint();
    }

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
    // Hand the prewarm promise back so the loader can gate the reveal on it
    // (revealWhenReady). undefined on WebGL / already-warm floors → instant reveal.
    return prewarm;
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

// Rite system (the active lane) — banks Hunger from combat, erupts the equipped
// rite around the player. Center = the camera (player) position; enemies live.
initRites({
  getCenter: () => camera.position,
  getEnemies: () => currentLevel?.enemies ?? [],
});

// Player-action FSM — the single AUTHORITY for combat action arbitration.
// It owns dodge/parry as committed dt-ticked states and observes the swing
// sim for attacking; the three begin-points (swing start, dash, parry) route
// through canStartAction. Parry shares the attack tap (resolveTap routes a tap
// to parry only while a deflect opportunity is open), so a tap outside the
// window always swings — never locked out. Bound to the swing sim here.
bindPlayerActionSources({
  isSwinging: () => weapon.isSwinging,
  swingPhase: () => weapon.getPhase(),
});

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
  // Finish + hold the run's tape (seed + inputs) the instant the player dies,
  // so the leaderboard submission can pick it up alongside the claimed score
  // for server-side replay-verification. No-op when not recording.
  finishRun();
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
// Reward audio — coin cascade + level-up swell off the bus (gold:absorbed / level:up).
initRewardAudio();

// --- Input ---
// Attack is now triggered by tapping anywhere on the right half of the
// screen (in addition to the spacebar on desktop). No more on-screen
// attack button — less intrusive UI, larger hit area.
const input = createTouchInput(canvas, {
  // THE tap arbiter — single place that fully resolves a tap and acts
  // (the input schemes no longer add their own attack fallback). canAttack
  // is false for the touch joystick half: a direct tap on an object is
  // still honoured, but the attack/interact fallback is suppressed there.
  onTap(clientX, clientY, canAttack, deliberate = true, interactEligible = true) {
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
      deliberate,
      mobInRange: combat.hasEnemyInRange(),
      bestInRange: getInRangeInteractable(),
      canAttack,
      interactEligible,
      deflectAvailable: deflectOpportunityActive(),
    });
    if (action.kind === 'deflect') {
      // The tap is parry's entry point: resolveTap routes here while a
      // deflectable strike is flashing. PARRY from a FREE stance (canStartAction
      // gates out your own windup/strike/recovery) and off the anti-mash
      // lockout (triggerParry); OTHERWISE fall back to a normal SWING — "a
      // failed parry is just a normal attack." The fallback is load-bearing: it
      // guarantees a tap is never wasted and that a stuck/leaked deflect
      // opportunity (e.g. a mob killed mid-flash) can NEVER deadlock light
      // attacks. Parry-spam stays gated (no parry mid-swing + the lockout), so
      // the fallback only ever yields ordinary attacks, never free parries.
      if (canStartAction('parry') && triggerParry()) enterParry(CONFIG.DEFLECT.COMMIT_S);
      else triggerAttack();
    }
    else if (action.kind === 'attack') triggerAttack();
    else if (action.kind === 'interact') { triggerInteract('tap'); resolveUsable(action.interactable, camera.position).onUse(); }
    // 'none' → deliberately do nothing (e.g. tapped a chest you're too far from).
  },
  onInteract() {
    // E key (or future gamepad confirm) — use the currently in-range
    // interactable, no screen position needed. Same gate as the tap
    // path: not during dying or open screens.
    if (isDying() || isFogWalkthroughActive() || isAnyScreenOpen()) return;
    const inRange = getInRangeInteractable();
    if (inRange) { triggerInteract('ekey'); resolveUsable(inRange, camera.position).onUse(); }
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
  // This path (tapping the floating DESCEND prompt — the most natural mobile
  // interaction) was the interact UNDER-capture: it descended without firing
  // triggerInteract, so the descent never landed in the replay tape.
  if (inRange) { triggerInteract('label'); resolveUsable(inRange, camera.position).onUse(); }
});
// Combo-break on menu resume. A screen that pauses the world (chest loot panel,
// inventory, a note) FREEZES the swing sim's clock along with everything else —
// so the combo window never lapses while you're rummaging, and the next press
// would resume a stale mid-chain step (the dagger's finisher flurry firing as a
// phantom "first" attack). When the last world-pausing screen closes, drop the
// banked combo so combat starts fresh. Edge-triggered so non-pausing overlays
// (HUD bits) don't churn it.
let _wasPausedByScreen = isWorldPausedByScreen();
onScreenStateChanged(() => {
  const pausedNow = isWorldPausedByScreen();
  if (_wasPausedByScreen && !pausedNow) weapon.breakCombo();
  _wasPausedByScreen = pausedNow;
});
createConsumableBar();
createRiteButton();
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
// Pre-build the status-VFX mote pool (64 pooled sprites) at boot — its lazy
// build on the first burn/poison proc was a measured mid-combat GC spike.
initStatusVfxPool(scene);

// Link to the living dungeon: connect to the shared death table and wire the
// "death elsewhere" feed (the voice in the deep remarks when another delver
// falls). Best-effort — offline/unconfigured, both no-op. See
// docs/ALPHA-AND-BACKEND.md.
initNetwork();
initDeathFeed();
// AI/voice layer (Phase-5 PROTOTYPE) — dev-only until the prod Worker ships.
// Gated at the call site so the whole layer dead-code-eliminates from the
// static deploy (the internal AI_ENABLED gate is belt-and-suspenders). Flip
// this — and AI_ENABLED in ai-client.ts — together when /api/ai is real.
if (import.meta.env.DEV) {
  initPlayerProfile(); // the behavioral fingerprint the deep reads
  initAIRewards(); // the deep remarks on finds
}
// The living acquisition beat — item flies into the satchel, domain relics flood
// the screen + draw a word from the deep. Player-facing (not the AI prototype).
initAcquisitionBeat();
// Drain any queued run tapes (recorded offline) on every connect.
initRunSync();
// Launch telemetry — error capture + funnel events. No-op until an endpoint is
// configured (src/telemetry/telemetry.ts); honours Do-Not-Track. See the boot /
// run_start / death tracks below.
initTelemetry();
track('boot');
// Crash context — sampled lazily when a report is built, so a crash carries the
// run seed + depth + how far in + the device GPU. With the seed + the repro tape
// (attached on a fatal), the exact session replays in the stepper. The GPU name
// resolves once the backend is up (adapter.info on WebGPU; the debug-renderer-
// info extension on the WebGL2 fallback); a crash before that reads 'n/a'.
let crashGpu = 'n/a';
function resolveCrashGpu(): void {
  try {
    type AdapterInfo = { vendor?: string; architecture?: string; device?: string; description?: string };
    const backend = (renderer as unknown as { backend?: { isWebGLBackend?: boolean; adapter?: { info?: AdapterInfo }; gl?: WebGL2RenderingContext } }).backend;
    if (backend?.isWebGLBackend) {
      const gl = backend.gl ?? (renderer.getContext() as WebGL2RenderingContext);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) crashGpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    } else {
      const info = backend?.adapter?.info;
      if (info) crashGpu = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || 'n/a';
    }
  } catch { /* keep 'n/a' */ }
}
setCrashContext(() => ({
  seed: getRunSeed(),
  depth: getCurrentDepth(),
  steps: recordedSteps(),
  gpu: crashGpu,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
}));
// Finish an account link interrupted by the OAuth redirect (no-op otherwise —
// doesn't even load Clerk unless a link is mid-flight).
void completePendingLink();

// Pre-allocate the pickup light pool. Lights live in the scene forever
// (idle = intensity 0, parked off-stage); pickups borrow and return them.
// This is what actually keeps drops lag-free: Three.js recompiles every
// material shader if the scene's light count changes mid-fight, but a
// fixed-count pool sidesteps that entirely.
// Global light pool — the perf-critical pool of N PointLight slots that
// every scene PointLight runs through. See src/scene/light-pool.ts.
// Must be initialized BEFORE any spawn that registers sources (torches,
// fountains, lamp, fill, etc.).
//
// Routed through the sim-world boot authority (engine/sim-bootstrap.ts): it
// builds the light pool AND the projectile pool + type registry in dependency
// order. The headless replay runner calls the SAME authority, so a sim-damage
// subsystem can never again exist in the browser but be silently absent in a
// server-side replay. Add new sim subsystems there, not as a loose call here.
bootstrapSimWorld(scene);
// Apply the persisted dynamic-shadow quality (the light pool defaults to
// 'off' internally; this lifts it to the user's setting). Live changes are
// handled by the onSettingsChanged subscription further down.
setShadowMode(getSettings().shadows);
// Video settings (render scale / adaptive res / bloom / DPR) — apply the
// persisted values now; onSettingsChanged re-applies on change. Owned by
// scene/video-settings.ts.
applyVideoSettings();
mountLuxButtonIfEnabled();
initPickupLightPool(scene);
// (The projectile pool + type registry are built by bootstrapSimWorld above,
// alongside the light pool they depend on — so the headless replay runner gets
// them from the same authority.)
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
initWeaponUsage();
// Cinematic boss beats (music + room-mood flood on engage, slow-mo + shake +
// colour-drain on death) — subscribed once to the boss lifecycle events.
setupBossCinematics();

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
initOrnateSkin();   // ?ui=ornate → illuminated-manuscript HUD reskin (paint-only, A/B)
initDotDamageNumbers(camera);   // floats coloured bleed/poison/burn tick numbers
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

// The frame loop (cadence, fixed-step sim/present split, render interp, the
// fatal guard) lives in engine/frame-loop.ts; main wires the world objects in.
initFrameLoop({
  renderer, camera, weapon, input,
  systems: SYSTEMS,
  getLevel: () => currentLevel,
  syncRoomCuller,
  getHarnessTick: () => harnessTickFn,
  lampSpotEnabled: LAMP_SPOT,
});

// DEV console hooks + URL overrides (?ps1/?shadows/?nooutline/?god, the
// window.__* forensics handles, the fixed-step sim stepper) — one install;
// the whole module tree-shakes from the production bundle.
if (import.meta.env.DEV) {
  installDevHooks({
    renderer, scene, camera, weapon,
    systems: SYSTEMS,
    getLevel: () => currentLevel,
    getRunSeed,
  });
}


// ── Run start ──────────────────────────────────────────────────────────
// All the systems above are wired; we just don't have an active level
// (or a render loop) yet. The start screen owns the next step: either
// DESCEND (fresh run on depth-1) or CONTINUE (resume the saved floor).
//
// Scenario URLs (debug) bypass the title and jump straight into the
// requested level.


// The single resolved run seed. Resolution order, uniform across EVERY boot
// path (descend, scenario, vault): explicit ?seed=N → the run's startedAt →
// wall clock (fresh-run entropy). Whatever wins is recorded so even a
// wall-clock run can be replayed by reading back the seed it actually used.
// This is the one knob that makes "same seed → same run" hold — it must be
// applied BEFORE any spawn, because spawn-time AI draws (e.g. pack orbit
// schedules) consume gameRng immediately.
let lastRunSeed = 0;
function resolveRunSeed(): number {
  const sp = new URLSearchParams(window.location.search).get('seed');
  const fromUrl =
    sp != null && sp !== '' && Number.isFinite(Number(sp)) ? Number(sp) >>> 0 : undefined;
  lastRunSeed = (fromUrl ?? getRunState()?.startedAt ?? Date.now()) >>> 0;
  return lastRunSeed;
}
/** The seed the current run was started with. DEV/harness reads this to record
 *  or reproduce a run. */
export function getRunSeed(): number {
  return lastRunSeed;
}

async function startRun(floorId: string, startDepth: number = 1): Promise<void> {
  // Raise the black and let it PAINT before the heavy synchronous level build
  // (procgen + buildLevel + CSG props). Without this, DESCEND/CONTINUE froze
  // the still-visible menu for the whole build and the loading screen only
  // appeared afterward. revealWhenReady/fadeIn drop the cover at reveal.
  holdCover();
  await yieldToCover(30);
  // Seed the gameplay RNG stream BEFORE any spawn so a seeded run's rolls AND
  // its spawn-time AI draws (pack orbit schedules, etc.) are reproducible —
  // the Phase-4 replay foundation. resolveRunSeed honours ?seed=N on every
  // boot path, including scenarios (which carry no run state).
  const seed = resolveRunSeed();
  seedRng(seed);
  resetGameClock(); // each run starts at gameNow()=0 so its timers replay
  // Record the run for replay/validation — but ONLY in the deterministic
  // (fixed-step) loop, since a variable-dt tape can't be reproduced. Captured
  // allocation-free; finished + held on death for the leaderboard to submit.
  if (isFixedStepLoop()) startRunRecording(seed);
  if (import.meta.env.DEV) console.info(`[run] seed = ${seed}`);
  track('run_start', { depth: startDepth });
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
  // FP viewmodels (weapon / lamp / hand) are hidden for the title vignette — it's
  // a posed scene behind the menu, not the player standing in it. Any real floor
  // shows them again.
  for (const r of getViewmodelRoots()) r.visible = floorId !== 'title-vignette';
  // ?simfreeze=1 (DEV): hand the clock to window.__sim from t=0 — freeze the
  // world the instant it spawns, BEFORE the live variable-dt loop advances it.
  // Without this, the nondeterministic number of real frames between boot and
  // a manual freeze() moves the world by a variable amount, so even a seeded
  // run diverges. The fixed-step stepper then drives from the true spawn state.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('simfreeze') === '1') {
    setWorldFrozen(true);
  }
  startFrameLoop();
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
      void startRun(spec.id, 5);
      return true;
    }
    console.warn(`?vault=${vaultId} not found in the vault library`);
  }

  // SAFE-ROOM preview entry — `?saferoom=N` loads the act-N checkpoint safe room
  // directly (as if you'd just beaten the depth-N boss), so it can be inspected
  // without a 3-minute boss fight. DEV-only, gated like ?depth.
  const safeParam = url.get('saferoom');
  if (import.meta.env.DEV && safeParam && (HARNESS_ENABLED || url.get('dev') === '1')) {
    const prevDepth = Number(safeParam) || 3;
    const spec = generateSafeRoom(prevDepth);
    clearSave();
    LEVELS[spec.id] = spec;
    startNewRun(spec.id, { depth: prevDepth });
    recordRunStart();
    resetRunDiscoveries();
    applyState(null);
    setSlot('weapon', ITEMS['rusted-sword']);
    void startRun(spec.id, prevDepth);
    return true;
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

// DEV AUTO-PILOT — `?autobot=1` (implies `?harness=1`) drives the built-in bot
// in a perpetual loop so the game plays ITSELF hands-off: walk, fight, descend,
// forever. Purpose-built for shader-warmup forensics — instead of manually
// steering combat to provoke first-use shader compiles, let this run a few
// floors while you diff the program cache (window.__progDiff — see below) to
// see EXACTLY what compiled after warmup. Godmode is forced on so a death can't
// end the run; it just keeps descending into new content. DEV-only, so the
// whole block dead-code-strips from the production bundle.
if (import.meta.env.DEV && HARNESS_ENABLED
    && new URLSearchParams(window.location.search).get('autobot') === '1') {
  setGodMode(true);
  void (async () => {
    // bootHarness sets window.harness inside its own dynamic-import .then(), so
    // it may not exist yet when this IIFE first runs — poll until it appears.
    type H = { ready: Promise<void>; bot: { run(o?: unknown): Promise<{ stopReason: string }> } };
    let h: H | undefined;
    for (let i = 0; i < 200 && !h; i++) {
      h = (window as unknown as { harness?: H }).harness;
      if (!h) await new Promise((r) => setTimeout(r, 50));
    }
    if (!h) { console.warn('[autobot] window.harness never appeared'); return; }
    await h.ready;
    console.info('[autobot] harness ready — auto-piloting');
    // bot.run stops on max-turns / stuck / no-level; just restart it so the
    // session never idles. A short breath between runs lets any in-flight
    // level swap settle before the next observation.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try { await h.bot.run({ maxTurns: 400 }); }
      catch { /* transient — e.g. a race during a floor swap; loop and retry */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
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
  setGoreDebugEnabled(s.debugGoreSplats);
  setBossEncounterReadoutVisible(s.debugBossReadout);
  // Profiler tools — mount/unmount the on-screen toolbar (and tear the suite
  // down) live when the toggle flips. Defined below; hoisted.
  applyProfilerEnabled();
  setShadowMode(s.shadows);
  applyVideoSettings(s);   // render scale + adaptive resolution + bloom + CRT film
  setSurfaceAOStrength(s.aoStrength);
  setSurfaceDetailEnabled(s.surfaceDetail);
  setMasterBrightness(s.brightness);
  setEnvLightMuls(s.torchStrengthMul, s.torchRangeMul);
  setWickFillMul(Math.pow(s.wick, 1.5));
  // Banded lighting toggle — re-patch the node lighting model (WebGPU).
  installBandedLightingWebGPU(s.bandedLighting);
});

// Perf overlay (FPS / frame time / draw calls). Hidden until the PERF
// METER setting flips on — tickPerfOverlay early-outs when hidden so
// the per-frame cost is a single style read.
createPerfOverlay();
setPerfOverlayVisible(getSettings().perfMeter);

// Profiling suite wiring (HUD / recorder / draw report / GPU attribution /
// hotkeys / window.__* handles) — debug/profiler-wiring.ts. Ships in prod
// behind the PROFILER TOOLS setting; zero footprint until enabled.
initProfilerWiring({ renderer, scene, getLevel: () => currentLevel });

// Fake persisted state for snaps (?fakemeta=1 / ?fakesave=1) — debug/boot-url-screens.ts.
applyFakeStateFlags();
// Boot veil (index.html #boot-loading) — ui/boot-veil.ts owns the progress bar
// + teardown; the safety net guarantees it never strands if a boot path
// forgets to clear it.
armBootVeilSafetyNet();
// Debug ?show* screen previews (end screen / codex / stash / patchlog /
// safe-transition card) — debug/boot-url-screens.ts. When one fires it owns
// the boot; the game never starts.
if (handleDebugScreenFlags()) {
  // A debug screen owns this boot.
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
  // No wake ceremony in scenarios — the eyelid blink covered every
  // headless snap (and the geometry the scenario exists to show).
  suppressArrivalCeremony();
  suppressNextDescentTitle();   // a debug jump isn't a descent — no title card
  await startRun(floorId);
  hideBootLoading();   // scenarios bypass the title — clear the veil right away
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
      const beginDescent = () => {
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
        resetWeaponUsage();
        applyState(null);
        startRun('starter', 0);
      };
      // Before the first descent ever, the dark asks for a name. Once set
      // it's never asked again — returning delvers drop straight in. The
      // name persists in meta-state and (Phase 4+) attaches to leaderboard
      // + trace submissions. See docs/ALPHA-AND-BACKEND.md.
      if (!getPlayerName()) {
        showNameEntry((name) => {
          setPlayerName(name);
          pushDisplayName(name);   // sync onto the canonical player row
          beginDescent();
        });
        return;
      }
      beginDescent();
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

  // FIRST boot: hold the loading veil until we've checked for a fresh build.
  // If one's downloading, awaitBootUpdate applies it (a reload happens behind
  // the veil) and resolves true — we keep the veil up through the reload. If
  // there's nothing new, drop the veil and reveal the title. (Title re-opens
  // from sub-screen BACK call openTitle() directly — they're already past boot,
  // so they're not gated.)
  // Mount the live title vignette (a bonfire in the dark) behind the menu, so the
  // render loop runs and the fire is alive. The title's pausesWorld freezes the
  // world; the flame's own clock keeps flickering. DESCEND/CONTINUE rebuild over
  // it. Only mount when we're actually showing the title (not reloading for an
  // update); the BACK-to-title path reuses whatever scene is already up.
  async function mountTitleScene() {
    bootVeilHeartbeat();
    LEVELS['title-vignette'] = TITLE_VIGNETTE;
    suppressArrivalCeremony();
    suppressNextDescentTitle();
    await startRun('title-vignette');
    // Look DOWN a touch — the fire sits low on the floor close ahead, so a level
    // gaze clips it at the bottom; this lifts it into frame. (The title pauses the
    // world, so input never overwrites this pitch.)
    camera.rotation.x = -0.22;
  }
  // Wait until pipeline compiling has SETTLED (the scene rendered everything it's going to)
  // or maxMs elapses. DEV uses the compile guard's total (precise); prod has no counter, so
  // a fixed ~1.5s budget gives the title time to render. requestAnimationFrame-paced.
  async function settleCompiles(maxMs: number): Promise<void> {
    const stats = (window as unknown as { __compileStats?: () => { total: number } }).__compileStats;
    const start = performance.now();
    let last = -1, stable = 0;
    const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    while (performance.now() - start < maxMs) {
      await raf();
      // Frames ticking while we wait for compiles = the boot is alive, not
      // stranded — keep the veil watchdog from tearing down mid-warm.
      bootVeilHeartbeat();
      if (stats) {
        const t = stats().total;
        if (t === last) { if (++stable >= 12) return; } else { stable = 0; last = t; }
      } else if (performance.now() - start > 1500) return;
    }
  }

  // Compile the whole roster at BOOT, behind the loading veil — against the title
  // vignette (a real fogged dungeon scene with the live PSX pipeline), so the pipelines
  // match the in-game render state. Held here so the menu only appears once warm: the
  // first DESCEND is then instant (the floor warmup's `done` guard makes it a no-op).
  async function bootWarm(): Promise<void> {
    // Let the title vignette (a real fogged dungeon floor) BUILD + RENDER + fully COMPILE its
    // floor / wall / decor pipelines behind the veil — the descend floor + in-game safe rooms
    // reuse them. The title loads async + its decor compiles over several frames, so wait until
    // the compile count SETTLES (DEV: the guard's total stable; prod: a fixed ~1.5s budget),
    // capped at 4s. Without this the title compiles when the MENU appears (a menu hitch).
    await settleCompiles(4000);
    // Let the boot veil + loading bar paint before the warm blocks the thread (else boot looks frozen).
    await yieldToCover();
    const _t0 = performance.now();
    // ?nowarm=1 skips the boot roster warm too (it's the slow part under the
    // headless swiftshader fallback — ~44s — which stalled menu/title snaps past
    // the reveal timeout). Pipelines compile lazily instead; only used for
    // headless self-verify snaps, never a normal boot.
    const skipWarm = new URLSearchParams(location.search).get('nowarm') === '1';
    if (!skipWarm) {
      try { await runWarmupPassWebGPU(renderer, scene, camera, setBootProgress); } catch { /* best-effort */ }
    }
    if (import.meta.env.DEV) console.log(`[bootWarm] roster warm took ${Math.round(performance.now() - _t0)}ms (high+same every reload = NOT cached; drops on 2nd = cached)`);
    // CLEAN FRAME before the veil drops — two layers, because the artifact
    // (warm leftovers / half-compiled title visible through the fading veil)
    // is worse than an extra beat of black:
    //  1. Wait for the pipeline-compile count to go QUIET again (the title's
    //     own late compiles land in the first live frames after the warm; in
    //     prod, where there's no counter, this is a short fixed budget).
    //  2. Then wait for two REAL presented frames (rAF ticks alone don't
    //     prove a submit under the frame cap) so the canvas provably shows
    //     the settled title, never the last warm frame.
    await waitForPresentedFrames(2, 1500);
    await settleCompiles(2000);
    await waitForPresentedFrames(2, 1000);
  }

  awaitBootUpdate()
    .then(async (updating) => { if (!updating) { await mountTitleScene(); await bootWarm(); hideBootLoading(); openTitle(); } })
    .catch(() => { void mountTitleScene().then(() => { hideBootLoading(); openTitle(); }); });
}
