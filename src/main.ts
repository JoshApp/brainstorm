import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { setWebGPUMode, setWebGPUReady } from './scene/renderer-mode';
import { initEmbersGPU, tickEmbersGPU } from './effects/embers-gpu';
import { DelveTiledLighting } from './scene/tiled-lighting';
import { DelveLeanLighting } from './scene/lean-lights';
import { initLampSpot, tickLampSpot } from './player/lamp-spot';
import { setLampSpotActive } from './scene/light-pool';

// Lamp spot-shadow split (?lampspot=1): cube shadow (6 passes) → single map (1).
const LAMP_SPOT = new URLSearchParams(window.location.search).get('lampspot') === '1';
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
import { warmupContent } from './content/warmup';
import { runWarmupPass, runWarmupPassWebGPU } from './content/warmup-pass';
import { warmRealRoster } from './content/warm-real-roster';
import { initStatusVfxPool } from './effects/status-vfx';
import { initNetwork, pushDisplayName } from './net/delve-net';
import { initDeathFeed } from './net/death-feed';
import { completePendingLink } from './net/account-link';
import { initRunSync } from './net/run-sync';
import { initTelemetry, track, setCrashContext, captureError, buildReport } from './telemetry/telemetry';
import { showCrashOverlay } from './ui/crash-overlay';
import { createCombatSystem, spendSwingStamina } from './combat/attack';
import { initRites, tryActivateRite } from './combat/rites';
import { isWorldPaused, shouldFreezeGameClock } from './world-paused';
import { onPlayerDeath } from './player/health';
import { triggerDeath, getTimeScale, tickDeath, isDying, initDeath, setOnDeathStart } from './player/death';
import {
  tickBulletTime, getWorldTimeScale, triggerParry, deflectOpportunityActive,
} from './combat/reactive-defense';
import {
  bindPlayerActionSources, canStartAction, enterParry, tickPlayerAction,
} from './combat/player-action';
import { tickBossSlowmo, getBossSlowmoTimeScale } from './combat/boss-slowmo';
import { setupBossCinematics } from './mobs/boss-cinematics';
import { initWeaponDrop, dropHeldItem } from './player/weapon-drop';
import { bossEncounterDebug } from './mobs/boss-encounter';
import { initFogWalkthrough, isFogWalkthroughActive } from './player/fog-walkthrough';
import { initAchievements } from './broadcast/achievements';
import { initEventLog } from './broadcast/event-log';
import { initRewardAudio } from './audio/reward-audio';
import { initPlayerProfile } from './ai/player-profile';
import { initAIRewards } from './ai/ai-rewards';
import { buildMaterials } from './style/materials';
import { initRenderPipeline, renderWithStyle, precompileFloorInLiveContext, setPS1Scale, setBloomEnabled, setCrtFilmEnabled, setSharpBilinear, setMasterBrightness, setWickLift, setOverdrawMode, getViewmodelRoots, warmViewmodelPrepass } from './style/render-target';
import { initEncounterFeedback } from './feedback/encounter-feedback';
import { initArenaLightArc } from './feedback/arena-light-arc';
import { initLux, requestLux, showLuxCard, luxTour, LUX_BANDS } from './debug/lux';
import { initSplatMap, uSplatOn, uSplatBounds, uSplatTex, stampSplat, stampSpray, emitGoreSplash, setSplatWallProbe } from './scene/splat-map';
import { setSurfaceAOStrength } from './style/surface-ao';
import { setSurfaceDetailEnabled } from './style/surface-detail';
import { installBandedLightingWebGPU, setLeanLightingWebGPU } from './style/banded-lighting-webgpu';
import {
  enterInspectMode, tickInspectFraming, isInspectActive,
  INSPECT_AMBIENT, INSPECT_REQUESTED,
} from './debug/inspect-mode';
import { createSettingsMenu, configureSettingsMenu } from './ui/settings-menu';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings, onSettingsChanged } from './settings/settings';
import { beginArrival, tickArrival, suppressArrivalCeremony } from './player/arrival';
import { initChasmPresence, tickChasmPresence } from './effects/chasm-presence';
import { setMasterVolume, setReverbEnabled, startAmbience, playWhoosh, suspendAudio, resumeAudio } from './audio/sfx';
import { startMusic, setMusicVolume, pauseMusic, resumeMusic } from './audio/music';
import { emit, on as onEvent } from './broadcast/event-bus';
import { buildLevel, type LiveLevel } from './level/builder';
import { createRoomCuller, type RoomCuller } from './level/room-culling';
import { batchStaticFixtures } from './level/static-merge';
import { initCombatDebug, tickCombatDebug } from './combat/combat-debug';
import { initGoreDebug, setGoreDebugEnabled, tickGoreDebug } from './debug/gore-debug';
import { LEVELS } from './level/specs';
import { TITLE_VIGNETTE } from './level/title-vignette';
import type { LevelSpec } from './level/types';
import type { ModelSpec } from './ecs/model-types';
import { buildStarterChamber } from './level/starter-chamber';
import { findTestChamber } from './level/test-chambers';
import { showTestChambersScreen } from './ui/test-chambers-screen';
import { initLevelLoader, loadInitialLevel, loadLevel, tickPendingLoad, getCurrentDepth } from './level/loader';
import { generateFloor } from './level/procgen';
import { generateSafeRoom } from './level/safe-room';
import { suppressNextSafeRoomTransition } from './ui/safe-room-transition';
import { suppressNextDescentTitle, setDescentProgress } from './ui/descent-fade';
import { startNewRun, adoptSave, loadSave, clearSave, getRunState } from './state/run-state';
import { applyState } from './state/save-hydration';
import { initCharacterTracking, resetCharacter } from './state/character';
import { initRunStateListeners } from './state/run-state-listeners';
import { isPlaying, getGameMode } from './state/game-mode';
import { runSystems, type GameSystem, type TickContext } from './engine/loop';
import { buildSystems } from './engine/systems';
import {
  setRenderInterpEnabled, interpStepBegin, interpStepEnd, interpApply, interpRestore,
} from './engine/render-interp';
import { initDarkAdaptReadout, setDarkAdaptReadoutVisible } from './debug/dark-adapt-readout';
import { initBossEncounterReadout, setBossEncounterReadoutVisible } from './debug/boss-encounter-readout';
import { seedRng } from './engine/rng';
import { setDeterministicClock, advanceGameClock, resetGameClock } from './engine/game-clock';
import { startRecording as startRunRecording, finishRun, peekActiveTape, recordedSteps } from './harness/run-recorder';
import { setWorldFrozen } from './debug/freeze';
import { recordRunStart, resetRunDiscoveries, getMeta, getPlayerName, setPlayerName } from './state/meta-state';
import { showStartScreen } from './ui/start-screen';
import { showNameEntry } from './ui/name-entry-screen';
import { addItemSilently } from './player/inventory';
import { get as getEntity } from './ecs/world';
import { getScenarioFromUrl, applyScenario, buildVaultPreviewLevel } from './debug/scenarios';
import { showProvingGroundsScreen } from './ui/proving-grounds-screen';
import { buildFightLevel, buildEventLevel } from './level/proving-grounds';
import { isAnyScreenOpen, msSinceLastScreenClose, onScreenStateChanged, isWorldPausedByScreen } from './ui/screen-manager';
import { spawn as spawnEntity } from './ecs/world';
import { initTriggerListener } from './ecs/triggers';
import { setupPwaAutoUpdate, maybeApplyUpdateSilently, awaitBootUpdate, setBeforeReloadHook } from './pwa-update';
import { captureDevSnapshot, applyDevSnapshot, clearDevSnapshot, hasPendingDevSnapshot } from './state/dev-snapshot';
import { createPerfOverlay, setPerfOverlayVisible, tickPerfOverlay, reportRendererInfo } from './ui/perf-overlay';
import { installPerfProbe, tickPerfProbe } from './debug/perf-probe';
import { createProfilerHud, setProfilerVisible, toggleProfiler } from './debug/profiler-hud';
import { initFrameTiming, frameBegin, frameEnd, setMarks, marksOn, setGpuProbe, gpuProbeOn, setGpuPassTiming, gpuPassTimingOn, gpuPassDiag, markWarmupComplete } from './debug/frame-timing';
import { setStreamEnabled, streamEnabled, broadcastAttr } from './debug/perf-stream';
import { startRecording, stopRecording, toggleRecording, setRollingEnabled, saveLastSeconds, setSceneAuditProvider } from './debug/perf-recorder';
import { auditScene } from './debug/scene-audit';
import { launchSpector } from './debug/spector-launch';
import { initDrawReport, captureDrawReport, drawReportData } from './debug/draw-report';
import { initGpuAttribution, runGpuAttribution, getLastAttributionReport, isAttributionRunning, onAttributionReport } from './debug/gpu-attribution';
import { setLambertPreview, isLambertPreview } from './debug/lambert-preview';
import { setProfilerToolbarVisible } from './debug/profiler-toolbar';
import { createChargeRing, tickChargeRing } from './ui/charge-ring';
import { getInRangeInteractable, getAllInteractables, resolveUsable } from './interactables/system';
import { findTapTarget } from './controls/tap-target';
import { resolveTap } from './controls/tap-resolve';
import { triggerAttack } from './controls/attack-input';
import { triggerInteract } from './controls/interact-input';
import { initPickupLightPool } from './interactables/pickup';
import { setOutlinesDisabled } from './interactables/outline';
import { setShadowMode, setEnvLightMuls, setWickFillMul, tickLightPool } from './scene/light-pool';
import { packTokenCount } from './mobs/pack';
import { setAdaptiveResolution, setAdaptiveCeiling, tickAdaptiveResolution, feedAdaptiveGpuMs } from './scene/adaptive-resolution';
import { lastWebGPUGpuMs, setWebGPULeanBloom, warmSceneCompile } from './style/render-webgpu';
import { pacerShouldDraw } from './scene/frame-pacer';
import { beginBoot, bootSucceeded } from './boot-guard';
import { installContextRecovery, isContextLost } from './scene/context-recovery';
import { isLoading } from './scene/loading-gate';
import { startWarmupStream } from './scene/warmup-stream';
import { installWebGPUCompileGuard, markWebGPUWarmupComplete, tickCompileWatch } from './debug/webgpu-compile-guard';
import { bootstrapSimWorld } from './engine/sim-bootstrap';
import { validateContent } from './content/validate';
import { initDriftingMotes } from './effects/drifting-motes';
import { initBladeTrail } from './effects/blade-trail';
import { actForDepth } from './level/acts';
import { ensureInteractLabel, setInteractLabelTapHandler } from './ui/interact-label';
import { createConsumableBar } from './controls/consumable-bar';
import { createRiteButton, tickRiteButton } from './controls/rite-button';
import { createHpBar } from './ui/hp-bar';
import { createStaminaBar } from './ui/stamina-bar';
import { createHealthHearts } from './ui/health-hearts';
import { createStaminaArc } from './ui/stamina-arc';
import { createXpSigil } from './ui/xp-sigil';
import { createBossBar, resetBossBar } from './ui/boss-bar';
import { createBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { initDotDamageNumbers } from './ui/damage-numbers';
import { maybeShowCalibrateHint } from './ui/calibrate-hint';
import { createDepthCounter, setDepth as setDepthCounter } from './ui/depth-counter';
import { createXpGoldHud } from './ui/xp-gold-hud';
import { setGodMode } from './player/health';
import { setHarnessPaused } from './harness/pause';
import { isDesktopLike } from './controls/platform';

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

// --- Renderer ---
// WEBGPU SPIKE (branch `webgpu`): ?webgpu=1 swaps in Three's unified
// WebGPURenderer (async init; auto-falls back to WebGL2). Default stays the
// classic WebGLRenderer so the game is always runnable while the pipeline is
// ported to TSL — see docs/WEBGPU-MIGRATION.md. The WebGPU path is intentionally
// "raw" for now (custom PSX pipeline + reveal shaders bypassed); renderWithStyle
// short-circuits to a direct renderAsync until those are ported.
// WebGPU is now the DEFAULT on this branch — iterate the look/feel live, finish
// the last features (reveal seam, clustered lighting, gore-splat) on the native
// path. Opt OUT with ?webgpu=0 to A/B against the classic WebGL renderer.
// ONE renderer: WebGPURenderer (node/TSL pipeline). It auto-selects a WebGL2
// backend on devices without WebGPU — same node materials, one code path — and
// ?webgpu=0 forces that WebGL2 backend as a manual escape hatch / for testing the
// fallback. The dedicated classic WebGLRenderer is gone (see render-webgpu.ts).
const FORCE_WEBGL = new URLSearchParams(window.location.search).get('webgpu') === '0';
const WEBGPU = true;   // single renderer now; kept for the existing WEBGPU-gated sites (always true)
setWebGPUMode(true);
let renderer: THREE.WebGLRenderer;
{
  // trackTimestamp: native GPU timestamp queries for the profiler + adaptive res
  // (frame-timing / gore read resolveTimestampsAsync). No-op if the adapter lacks it.
  const wgpu = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true, forceWebGL: FORCE_WEBGL });
  // Tiled (Forward+) lighting prototype (?tiled=1). Bins point lights into screen
  // tiles via a compute pass so each fragment shades at most ~8 lights regardless
  // of total count — lets the torch count climb without the per-fragment wall.
  // A/B behind the flag until proven against the custom pipeline + banded model.
  if (new URLSearchParams(window.location.search).get('tiled') === '1') {
    (wgpu as any).lighting = new DelveTiledLighting();
    if (import.meta.env.DEV) console.log('[webgpu] tiled lighting ON');
  } else if (new URLSearchParams(window.location.search).get('unrolled') !== '1') {
    // DEFAULT: custom rolled-loop lights node (scene/lean-lights.ts). Evaluates the
    // pooled point lights in ONE loop instead of N unrolled per-light nodes, with two
    // byte-identical wins: parked pool slots (intensity 0) aren't packed, and a per-
    // fragment distance cull skips lights past their cutoff (Three's attenuation is
    // exactly 0 there). ?unrolled=1 reverts to stock node lighting for A/B; ?tiled=1
    // selects the Forward+ compute path.
    (wgpu as any).lighting = new DelveLeanLighting();
    if (import.meta.env.DEV) console.log('[webgpu] lean lights (default)');
  }
  // Codebase types the renderer as WebGLRenderer; WebGPURenderer shares the surface
  // we use (render/setSize/setPixelRatio/info/…), so cast.
  renderer = wgpu as unknown as THREE.WebGLRenderer;
  wgpu.init()
    .then(() => {
      setWebGPUReady(true);
      // DEV: detect pipeline compiles (renderer.info has no .programs on WebGPU) so
      // post-warmup compiles (warm gaps) are visible. window.__compileStats().
      installWebGPUCompileGuard((wgpu.backend as unknown as { device?: unknown })?.device);
      if (import.meta.env.DEV) console.log('[webgpu] renderer initialised (backend:', wgpu.backend?.constructor?.name ?? '?', ')');
    })
    .catch((err) => console.error('[webgpu] init failed', err));
}
// DPR cap — the biggest single lever against fragment/fill cost. Desktop debug
// stays crisp at CONFIG.PIXEL_RATIO_CAP; mobile honours the live PIXEL DENSITY
// setting (see effectiveDprCap + the GRAPHICS slider). Re-applied live by
// applyVideoSettings when the slider moves.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, effectiveDprCap()));
renderer.setSize(window.innerWidth, window.innerHeight);
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
renderer.toneMapping = WEBGPU ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

// --- Scene ---
const scene = new THREE.Scene();
// DEV-only scene handle for headless inspection (screenshot harnesses,
// hurtbox/zone counts). Stripped from prod by the import.meta.env.DEV gate.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__scene = scene;
scene.background = new THREE.Color(CONFIG.FOG_COLOR);
scene.fog = new THREE.Fog(CONFIG.FOG_COLOR, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);

// WEBGPU: halve the ambient fill. r184's units make AMBIENT_INTENSITY read much
// brighter (flat wash on the stone). Trimming the fill here — rather than via a
// low global exposure — lets exposure stay high enough that the EMISSIVE/additive
// flames stay vivid (a low exposure dimmed them to faint/transparent).
const ambient = new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY * (WEBGPU ? 0.3 : 1));
scene.add(ambient);

// GPU compute embers (WebGPU-only) — rise off the torches. Builds the storage
// buffers + Points cloud now; the init/update compute runs from the loop. No-op
// on WebGL.
initEmbersGPU(renderer, scene);

// Lamp spot-shadow: add the forward SpotLight + tell the pool to dim/de-shadow
// the omni lamp point. The split makes the lamp's shadow a single-map render.
if (LAMP_SPOT) { initLampSpot(scene); setLampSpotActive(true); }

// Per-stage GPU breakdown probe — window.__gpuBreakdown() prices bloom/shadow/grade
// by difference against the native timestamp timer. DEV-only.
if (import.meta.env.DEV) {
  (window as any).__gpuBreakdown = () => import('./debug/gpu-breakdown').then((m) => m.gpuBreakdown(renderer, scene));
  // Floor-material registry size — the pipeline-budget invariant (docs/PIPELINE-BUDGET.md):
  // this must PLATEAU as you descend, not climb per floor. Climbing = a `new Material` leaked
  // past stdMat.
  (window as any).__floorMats = () => import('./style/material-registry').then((m) => m.floorMaterialCount());
}

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
if (WEBGPU && new URLSearchParams(location.search).get('lean') === '1') setLeanLightingWebGPU(true);
// DEV: toggle banded lighting model live to A/B its per-fragment cost.
if (import.meta.env.DEV && WEBGPU) {
  (window as any).__setBanded = (on: boolean) => installBandedLightingWebGPU(on);
  // Lean lighting A/B — flips the model AND forces every node material to recompile
  // so the change is visible on the LIVE scene (not just freshly-built materials).
  (window as any).__setLean = (on: boolean) => {
    setLeanLightingWebGPU(on);
    scene.traverse((o: any) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m: any) => { if (m && m.isNodeMaterial) m.needsUpdate = true; });
    });
  };
}
const materials = buildMaterials(renderer);
// The custom PSX pipeline builds WebGLRenderTargets + GLSL ShaderMaterials —
// WebGL-only. Skipped under ?webgpu=1 (renderWithStyle short-circuits to a
// direct renderAsync there) until it's ported to TSL.
if (!WEBGPU) initRenderPipeline(renderer);
// WebGL context-loss recovery — preventDefault + rebuild the custom render
// targets on restore, so a GPU context drop (mobile memory pressure / a
// backgrounded tab) is a brief veil, not a black screen or a false crash.
installContextRecovery({ canvas, onRestore: () => initRenderPipeline(renderer) });
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
setWickLift(getSettings().wick);
setWickFillMul(Math.pow(getSettings().wick, 1.5));

// --- Camera ---
const camera = createFirstPersonCamera();
scene.add(camera); // required for the sword (camera child) to render
// LUX perceived-light meter (debug/lux.ts) — measures the RENDERED
// frame. Wired early so the render system's flushLux has its refs.
initLux(camera, () => currentLevel?.spec ?? null);
initSplatMap();   // the floor's gore memory (scene/splat-map.ts)
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
    // PRE-WARM → `prewarm`. The loader gates the reveal on this promise
    // (revealWhenReady). We gate ONLY the heavy combat-roster warm — it spawns
    // representative effects (blood/coins/wisps/shatter) into the scene to compile
    // them, and those would FLASH if revealed mid-compile (the "loading bleeding
    // into the game" artifact). It runs once, on the first REAL floor, behind the
    // descent black. We do NOT run it on the title vignette (combat effects must
    // never flash on the title) and we do NOT gate the per-floor compile (it only
    // causes a minor first-reveal hitch, never a flash, and gating the whole-scene
    // compile held the descent black for seconds).
    const isTitleVignette = level.spec.id === 'title-vignette';
    let prewarm: Promise<void> | undefined;
    if (!WEBGPU) {
      // WebGL: synchronous compile + (first real floor) the roster + viewmodel-prepass
      // warm. All instant (offscreen render) — the reveal needn't wait.
      // precompileFloorInLiveContext, NOT a bare renderer.compile(): compile with
      // no target bound bakes programs in the CANVAS color space (srgb) + stale
      // fog/shadow, but gameplay renders the scene into lowResTarget (srgb-LINEAR)
      // with live fog + the shadow pass. Three keys programs on those, so a bare
      // compile recompiled every prop on first reveal (the per-floor `physical`
      // churn the warmup forensics pinned). The helper binds the low-res target +
      // shadow around compile() so it mints the SAME keys the live frame asks for,
      // while still compiling the whole scene (compile ignores the frustum, so
      // rooms behind the spawn warm too). See render-target.ts.
      try { precompileFloorInLiveContext(renderer, scene, camera); } catch { /* pre-warm is best-effort */ }
      if (!rosterPrecompiled && !isTitleVignette) {
        rosterPrecompiled = true;
        try { runWarmupPass(renderer, scene, camera); } catch { /* best-effort */ }
        // Viewmodel DEPTH pre-pass renders in a 0-light scene (a different program);
        // warm that variant too or the first prepass draw stalls ~6ms in-game.
        try { warmViewmodelPrepass(renderer, camera); } catch { /* best-effort */ }
      }
    } else if (WEBGPU && new URLSearchParams(location.search).get('nowarm') === '1') {
      // ?nowarm=1 — skip ALL pipeline warming: the PSX warm AND the per-floor
      // compileAsync below. (My earlier version only skipped the PSX warm and fell
      // through to compileAsync, so it never actually stopped warming.) Pipelines now
      // compile lazily — first-use stutter is EXPECTED here; the only point is to A/B
      // whether warming is behind the 'output' texture hazard. prewarm stays undefined.
    } else if (WEBGPU && !isTitleVignette) {
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
          try { await runWarmupPassWebGPU(renderer, scene, camera, setDescentProgress); } catch { /* best-effort */ }
          // Warm through the REAL build path — one real instance of every enemy/prop/item, compiled at
          // the PSX format, so the warmed pipeline can't drift from the live spawn (kills the dummy-vs-
          // real tail). Once, behind the first descent's cover. See warm-real-roster.ts.
          try { await warmRealRoster(renderer, scene, camera, setDescentProgress); } catch { /* best-effort */ }
          startWarmupStream(scene, () => { markWarmupComplete(); markWebGPUWarmupComplete(); });
        }
        await warmSceneCompile(renderer, scene, camera);
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

    // First-run nudge toward brightness calibration (it moved off the
    // bonfire into Settings). Fires ONCE — the helper self-gates on
    // settings.calibrateHintSeen — at the first calm gameplay arrival
    // (tutorial for new players, depth-N for everyone post-update).
    // Skip debug scenarios (posed worlds aren't a real arrival).
    if (
      (!import.meta.env.DEV || !getScenarioFromUrl()) &&
      (level.spec.id === 'tutorial' || level.spec.id.startsWith('depth-') || level.spec.id.startsWith('safe-'))
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
// DEV: fire the rite from the console while the mobile button is being built.
if (import.meta.env.DEV) (window as unknown as { __rite?: () => boolean }).__rite = tryActivateRite;

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
// instant. Done after the renderer + level exist; before scenarios so an
// inventory-open scenario doesn't pay the cost on first frame.
// Renders to a target at boot to compile shaders — WebGL-only, and it'd run
// before the async WebGPU backend is ready ("render() before init"). Skip under
// WebGPU (shader warm is a WebGL-pipeline concern; the node renderer compiles
// lazily). See WEBGPU-MIGRATION.md.
if (!WEBGPU) warmupContent(renderer);

// Pre-build the status-VFX mote pool (64 pooled sprites) at boot — its lazy
// build on the first burn/poison proc was a measured mid-combat GC spike.
// The sprite shader program itself is compiled by warmupContent above.
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
// Drain any queued run tapes (recorded offline) on every connect.
initRunSync();
// Launch telemetry — error capture + funnel events. No-op until an endpoint is
// configured (src/telemetry/telemetry.ts); honours Do-Not-Track. See the boot /
// run_start / death tracks below.
initTelemetry();
track('boot');
// Crash context — sampled lazily when a report is built, so a crash carries the
// run seed + depth + how far in + the device GPU. With the seed + the repro tape
// (attached on a fatal), the exact session replays in the stepper. Read the GPU
// string once here; the rest are live getters.
const crashGpu = (() => {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'n/a';
  } catch { return 'n/a'; }
})();
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
// Video settings — render scale (the adaptive ceiling + fixed value when
// adaptive is off), adaptive resolution (phones only), bloom, and the CRT film.
// One helper so boot + the onSettingsChanged subscription apply them identically.
function applyVideoSettings(s = getSettings()): void {
  setAdaptiveCeiling(s.renderScale);
  const adaptiveOn = s.adaptiveResolution && !isDesktopLike();
  setAdaptiveResolution(adaptiveOn);
  // setAdaptiveResolution early-returns when the flag is unchanged, so set the
  // fixed scale explicitly whenever adaptive is off (desktop, or toggled off).
  if (!adaptiveOn) setPS1Scale(s.renderScale);
  setBloomEnabled(s.bloom);
  setWebGPULeanBloom(s.leanBloom);   // WebGPU-only; no-op on WebGL
  setCrtFilmEnabled(s.crtFilm);
  setSharpBilinear(s.sharpUpscale);
  scheduleDprApply();   // honour the PIXEL DENSITY slider (debounced + no-op if unchanged)
}

// Effective DPR cap: desktop debug stays crisp at the CONFIG cap; mobile (the
// fill-bound target) honours the live PIXEL DENSITY setting.
function effectiveDprCap(): number {
  return isDesktopLike() ? CONFIG.PIXEL_RATIO_CAP : getSettings().pixelRatioCap;
}
// Apply the DPR cap to the renderer + resync the buffers. Re-creating the
// drawing buffer + render targets is exactly what a window resize does, so we
// reuse that path: set the ratio + size (so domElement.width is fresh BEFORE
// any resize listener reads it — order-independent), then dispatch 'resize' to
// resync the low-res target + bloom + post uniforms (render-target.ts) and the
// camera aspect (main.ts resize handler).
function applyDprNow(): void {
  const target = Math.min(window.devicePixelRatio, effectiveDprCap());
  if (Math.abs(renderer.getPixelRatio() - target) < 0.001) return;   // unchanged → skip
  renderer.setPixelRatio(target);
  renderer.setSize(window.innerWidth, window.innerHeight);
  window.dispatchEvent(new Event('resize'));
}
// Debounce: the slider streams 'input' while dragging — coalesce so we rebuild
// buffers once when the drag settles, not dozens of times per second.
let dprApplyTimer: number | undefined;
function scheduleDprApply(): void {
  if (dprApplyTimer !== undefined) clearTimeout(dprApplyTimer);
  dprApplyTimer = window.setTimeout(() => { dprApplyTimer = undefined; applyDprNow(); }, 120);
}
applyVideoSettings();
// DEV-only: ?ps1=0.3 forces the scene-render scale for snap/compare. Stripped
// from prod by the literal-false guard.
if (import.meta.env.DEV) {
  const ps1 = Number(new URLSearchParams(window.location.search).get('ps1'));
  if (ps1 > 0) setPS1Scale(ps1);
}
// DEV-only: ?crt=1 forces the CRT dirty-signal film on for snap/compare,
// without touching the saved setting. Stripped from prod by the literal guard.
if (import.meta.env.DEV) {
  const crt = new URLSearchParams(window.location.search).get('crt');
  if (crt === '1') setCrtFilmEnabled(true);
  else if (crt === '0') setCrtFilmEnabled(false);
}
// DEV-only: ?sharp=1|0 forces the sharp-bilinear upscale for snap/compare
// without touching the saved setting. Stripped from prod by the literal guard.
if (import.meta.env.DEV) {
  const sharp = new URLSearchParams(window.location.search).get('sharp');
  if (sharp === '1') setSharpBilinear(true);
  else if (sharp === '0') setSharpBilinear(false);
}
// DEV-only: ?shadows=off|hero|single|all forces a mode for snap/compare
// without touching the saved setting. Stripped from prod by the literal guard.
if (import.meta.env.DEV) {
  const sm = new URLSearchParams(window.location.search).get('shadows');
  if (sm === 'off' || sm === 'hero' || sm === 'single' || sm === 'all') setShadowMode(sm);
}
// DEV-only: ?nooutline=1 disables the interaction-outline system so a perf
// scenario can isolate the rest of the frame from its inverted-hull overdraw.
if (import.meta.env.DEV) {
  if (new URLSearchParams(window.location.search).get('nooutline') === '1') setOutlinesDisabled(true);
}
// DEV: headless floor-transition repro hook — __descend() walks the run
// one floor down through the SAME loadLevel path the stairs use, and
// __sceneScan(x,z,r) names every mesh near a world point (parent chain
// included) so a mystery object in a screenshot can be interrogated.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__descend = () => {
    const next = currentLevel?.spec.stairs?.[0]?.targetLevel;
    if (next) loadLevel(next);
    return next ?? null;
  };
  (window as unknown as Record<string, unknown>).__scene = scene;   // DEV: raw scene access for live debugging
  (window as unknown as Record<string, unknown>).__renderer = renderer;   // DEV: program-cache forensics
  // DEV: shader-warmup forensics. __progDiff() seeds a baseline of the CURRENT
  // program cache on first call (call it once warmup is done — after the first
  // level loads), then on every later call returns the cacheKeys that compiled
  // SINCE the seed — i.e. exactly the shaders warmup MISSED. Pass true to
  // reseed. Pair with ?autobot=1: seed, let the bot play a few floors, call
  // again → the list is the precise warmup gap, decode the flipped define.
  {
    let baseline: Set<string> | null = null;
    const keysNow = () => (renderer.info.programs ?? []).map((p) => (p as { cacheKey?: string }).cacheKey ?? '');
    (window as unknown as Record<string, unknown>).__progDiff = (reseed = false) => {
      const now = keysNow();
      if (!baseline || reseed) {
        baseline = new Set(now);
        return { seeded: baseline.size };
      }
      const gap = now.filter((k) => !baseline!.has(k));
      const byType: Record<string, number> = {};
      for (const k of gap) { const t = k.split(',')[0]; byType[t] = (byType[t] ?? 0) + 1; }
      return { baseline: baseline.size, now: now.length, compiledSinceSeed: gap.length, byType, keys: gap };
    };
  }
  (window as unknown as Record<string, unknown>).__stamp = (r = 1.2, a = 1.0, spray = false) => {
    if (spray) {
      const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);
      stampSpray(camera.position.x + fx * 1.5, camera.position.z + fz * 1.5, r, 0x8a1812, a, fx, fz);
    } else {
      stampSplat(camera.position.x, camera.position.z, r, 0x8a1812, a);
    }
    return [camera.position.x.toFixed(1), camera.position.z.toFixed(1)];
  };
  (window as unknown as Record<string, unknown>).__splatBg = (on: boolean) => {
    (scene as unknown as { background: unknown }).background = on ? uSplatTex.value : null;
    return on;
  };
  (window as unknown as Record<string, unknown>).__goreDebug = (on = true) => { setGoreDebugEnabled(on); return on; };
  // __gore(e): full impact splash 1.2m ahead, thrown along the view.
  (window as unknown as Record<string, unknown>).__gore = (e = 1.0) => {
    const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);
    emitGoreSplash(camera.position.x + fx * 1.2, camera.position.z + fz * 1.2, 1.0, fx, fz, e, 0x8a1812);
    return 'splashed';
  };
  (window as unknown as Record<string, unknown>).__splatState = () => ({
    on: uSplatOn.value,
    bounds: uSplatBounds.value.toArray(),
    texSet: uSplatTex.value !== null,
    texUuid: (uSplatTex.value as { uuid?: string } | null)?.uuid ?? null,
  });
  // __teleport(x, z, yaw?): move the player camera. Headless repro aid.
  (window as unknown as Record<string, unknown>).__teleport = (x: number, z: number, yaw = 0) => {
    camera.position.set(x, CONFIG.PLAYER_HEIGHT, z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = 0;
  };
  // __smite(r): lethal damage to every enemy within r metres of the
  // camera, through the REAL damage pipeline — death/dissolve/corpse
  // paths run exactly as in combat. Headless corpse-bug repro.
  (window as unknown as Record<string, unknown>).__smite = (r = 6) => {
    const killed: string[] = [];   // kind@x,z of each kill
    for (const e of currentLevel?.enemies ?? []) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - camera.position.x, e.position.z - camera.position.z);
      if (d > r) continue;
      e.takeDamage({ source: null, target: e.entityId, base: 99999, type: 'physical' });
      killed.push(`${e.kind}@${e.position.x.toFixed(1)},${e.position.z.toFixed(1)}`);
    }
    return killed;
  };
  (window as unknown as Record<string, unknown>).__sceneScan = (x: number, z: number, r = 1.5) => {
    const found: Array<{ name: string; type: string; center: number[]; radius: number; visible: boolean; chain: string }> = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      // Bounding sphere in WORLD space — world-baked merged meshes sit
      // at transform origin with their geometry elsewhere; the bounds
      // are where the pixels actually are.
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere!;
      const c = bs.center.clone().applyMatrix4(m.matrixWorld);
      const scale = m.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
      const wr = bs.radius * scale;
      if (Math.hypot(c.x - x, c.z - z) - Math.min(wr, 3) > r) return;
      if (wr > 8) return;   // room-scale merges: not a "body"
      const chain: string[] = [];
      let n: THREE.Object3D | null = m;
      while (n && chain.length < 6) { chain.push(n.name || n.type); n = n.parent; }
      found.push({
        name: m.name || '(unnamed)', type: m.type,
        center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
        radius: +wr.toFixed(2), visible: m.visible,
        chain: chain.join(' < '),
      });
    });
    return found;
  };
}
// LUX button — `?lux=1` on ANY build (it's a safe read-only diagnostic:
// measures pixels, changes nothing), always present in DEV. One tap →
// overlay card with the numbers + room context; a phone screenshot of
// that card is a complete bug report for light tuning.
// STICKY: ?lux=1 persists to localStorage (and ?lux=0 clears it) so
// the button survives the PWA's start_url launch, which carries no
// query params. The service worker's cache cycle still applies — a
// fresh deploy needs one open/close before the new bundle serves.
{
  const luxParam = new URLSearchParams(window.location.search).get('lux');
  if (luxParam === '1') localStorage.setItem('delve-lux', '1');
  if (luxParam === '0') localStorage.removeItem('delve-lux');
}
if (import.meta.env.DEV || localStorage.getItem('delve-lux') === '1') {
  const btn = document.createElement('button');
  btn.textContent = 'LUX';
  Object.assign(btn.style, {
    position: 'fixed', top: '40%', right: '8px', zIndex: '9998',
    background: 'rgba(10,12,18,0.8)', color: '#9fb2cc',
    font: '10px ui-monospace, monospace', padding: '7px 9px',
    border: '1px solid #2a3242', borderRadius: '5px', opacity: '0.6',
  } as Partial<CSSStyleDeclaration>);
  btn.onclick = () => { requestLux().then(showLuxCard); };
  document.body.appendChild(btn);
}
// Headless lux API (DEV; scripts/lux-scan.ts drives it via playwright).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__lux = {
    measure: () => requestLux().then((r) => { showLuxCard(r); return r; }),
    tour: () => luxTour(),
    bands: LUX_BANDS,
  };
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
  // Pack/AI observation: per-enemy distance + bearing to the player + AI state.
  // Lets a headless probe confirm a crowd RINGS (bearings spread, dist ≈ strike
  // range) vs PILES (dist ≈ 0, bearings clustered). Drives pack tuning.
  (window as unknown as { __mobPack?: () => unknown }).__mobPack = () => {
    const lvl = currentLevel; if (!lvl) return null;
    const px = camera.position.x, pz = camera.position.z;
    const mobs = lvl.enemies.filter((e) => e.alive).map((e) => {
      const dx = e.position.x - px, dz = e.position.z - pz;
      const dist = Math.hypot(dx, dz) || 1;
      // Facing error: angle between the model's forward (-Z → (-sinθ,-cosθ))
      // and the unit vector TOWARD the player. 0° = looking at you, 180° = back
      // turned. This is the "half face away" measurement.
      const yaw = (e as unknown as { yaw: number }).yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const tox = -dx / dist, toz = -dz / dist;
      const faceErr = Math.round(Math.acos(Math.max(-1, Math.min(1, fx * tox + fz * toz))) * 180 / Math.PI);
      return {
        kind: e.kind, state: e.aiState,
        dist: Math.round(dist * 100) / 100,
        faceErr,   // degrees off from looking at the player
      };
    });
    return { tokens: packTokenCount(), mobs };
  };
}
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
const clock = new THREE.Timer();   // THREE.Clock is deprecated; Timer.update()+getDelta() each frame
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

// DEV-only fixed-step sim stepper (window.__sim). Runs ONLY the kind:'sim'
// systems by hand at a fixed timestep — the headless / deterministic-replay
// substrate, distinct from the real-time ?harness path. Behind the DEV gate so
// it dead-code-eliminates from the live build (window.__sim can't exist there).
if (import.meta.env.DEV) {
  void import('./debug/sim-stepper').then((m) =>
    m.installSimStepper({
      systems: SYSTEMS,
      getLevel: () => currentLevel,
      getCamera: () => camera,
      getSeed: getRunSeed,
      getSwing: () => ({
        phase: weapon.getPhase(),
        striking: weapon.isStriking,
        swinging: weapon.isSwinging,
      }),
    }),
  );
}

// ── Fixed-step sim loop (opt-in) ─────────────────────────────────────────────
// The LIVE loop is variable-dt: the sim advances by whatever the last frame
// took, so play is fps-dependent and NOT reproducible. ?fixedstep=1 switches to
// a fixed-timestep loop — the SIM advances in fixed 1/60s quanta (count driven
// by accumulated wall-clock), and PRESENT (render/HUD/VFX) runs once per frame.
// That makes a run fps-INDEPENDENT and replayable from (seed, per-step intents)
// — the prerequisite for leaderboard run-validation, and it makes the headless
// balance sweeps faithful to real play.
//
// DEFAULT OFF: with the flag absent, tick() runs the original interleaved pass
// unchanged (byte-identical feel). The flag-on path reorders into sim-pass then
// present-pass (the inherent shape of fixed-step) — feel-test before defaulting.
const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 6; // realDt is capped at 0.1s, so ≤6 fixed steps/frame
const SIM_SYSTEMS = SYSTEMS.filter((s) => s.kind === 'sim');
const PRESENT_SYSTEMS = SYSTEMS.filter((s) => s.kind !== 'sim');
// Fixed-step is now the DEFAULT: a 60Hz deterministic sim, decoupled from the
// draw rate (which the FRAME RATE cap matches to it). This makes gameplay
// frame-rate-independent + fair across devices, and — critically — records a
// replay tape for EVERY run (the leaderboard verifier needs it). The FPS cap
// keeps it smooth without interpolation. Escape hatch for an A/B or a feel
// regression: ?varstep=1 forces the legacy variable-dt loop.
const USE_FIXED_STEP =
  new URLSearchParams(location.search).get('varstep') !== '1';
// Render interpolation (fixed-step only): DRAW a pose interpolated between the
// two most-recent sim snapshots by the leftover-accumulator fraction, so the
// 60Hz sim doesn't beat against the display clock into visible judder at a
// locked 60fps (see engine/render-interp.ts). Presentation-only — the sim + the
// replay tape are untouched. Escape hatch for an A/B or a feel regression:
// ?nointerp=1 draws the raw latest sim pose (the legacy fixed-step behaviour).
// Three loops are now A/B-able on the phone: default (fixed+interp),
// ?nointerp=1 (fixed, no interp), ?varstep=1 (legacy variable-dt).
const USE_INTERP =
  USE_FIXED_STEP && new URLSearchParams(location.search).get('nointerp') !== '1';
setRenderInterpEnabled(USE_INTERP);
// In fixed-step, run the game clock deterministically (gameNow() = accumulated
// sim time). In default play it stays on performance.now() — feel unchanged.
setDeterministicClock(USE_FIXED_STEP);
let simAccumulator = 0;
// Reused scratch for the interpolation target list (camera + live enemies),
// refilled in place each step so the loop never allocates.
const interpTargets: THREE.Object3D[] = [];
function fillInterpTargets(): void {
  interpTargets.length = 0;
  interpTargets.push(camera);
  // First-person weapon: its swing + held pose live on the root group, authored
  // ABSOLUTELY each fixed sim step ('weapon' is kind:'sim'), so on a non-60Hz
  // display the swing samples in 1/60 jumps and judders against the camera. The
  // group is camera-local, so interp lerps its local pose — bringing the sword
  // in line with the lamp/offhand viewmodels (those tick at present-rate and are
  // already smooth). The arm IK under it is solved from this pose and rides
  // along rigidly; its sub-pose is ≤1 step stale during a fast swing, masked by
  // the swing speed. weapon.update sets the group absolutely, so the lerped draw
  // pose can never feed back into the sim — no drift even before interpRestore.
  interpTargets.push(weapon.group);
  const enemies = currentLevel?.enemies;
  if (enemies) {
    for (const e of enemies) {
      if (e.alive || e.dying) interpTargets.push(e.group);
    }
  }
}

/** Advance the SIM by one fixed step: the time-scale drivers + player FSM +
 *  sim systems, all on the fixed clock (so the world is deterministic). */
function advanceSimStep(dt: number): void {
  // Advance the deterministic game clock by the real-time quantum — so the
  // time-based gameplay timers (skill windows, hit-pause/bullet-time durations)
  // that read gameNow() are reproducible. Advances during hit-pause so the
  // freeze ends, but FREEZES during a menu / harness / debug pause: otherwise a
  // pause burns in-flight skill windows and leaks real wall-clock time into the
  // recorded tape, breaking replay determinism for any run that opened a menu.
  if (!shouldFreezeGameClock()) advanceGameClock(dt);
  // Time-scale drivers on the FIXED clock (deterministic hit-pause / bullet-
  // time / death slow-mo), then the same two-clock split the variable path uses.
  tickDeath(dt);
  tickBulletTime(dt);
  tickBossSlowmo(dt);
  const baseScale = getTimeScale() * getBossSlowmoTimeScale();
  const scaledDt = dt * baseScale * getWorldTimeScale();
  const playerDt = dt * baseScale;
  const fxDt = dt * getWorldTimeScale();
  if (!isWorldPaused()) tickPlayerAction(playerDt);
  const paused = isWorldPaused();
  if (paused) { input.lookDx = 0; input.lookDy = 0; }
  runSystems(SIM_SYSTEMS, {
    realDt: dt, scaledDt, playerDt, fxDt, paused,
    mode: getGameMode(), playing: isPlaying(),
  });
}

/** Run the PRESENT (render/HUD/VFX/camera) systems once per frame, with the
 *  real frame dt + the live time-scales — so visuals stay smooth and VFX
 *  slow-mo (which rides scaledDt) reads exactly as it does today. */
function presentPass(realDt: number): void {
  tickArrival(camera, realDt);
  if (!isWorldPaused()) tickChasmPresence(camera, realDt);
  const baseScale = getTimeScale() * getBossSlowmoTimeScale();
  runSystems(PRESENT_SYSTEMS, {
    realDt,
    scaledDt: realDt * baseScale * getWorldTimeScale(),
    playerDt: realDt * baseScale,
    fxDt: realDt * getWorldTimeScale(),
    paused: isWorldPaused(),
    mode: getGameMode(),
    playing: isPlaying(),
  });
}

function tickInner() {
  // FRAME RATE cap: skip DRAWING this frame if we're ahead of the chosen fps.
  // A drift-free time accumulator (scene/frame-pacer.ts) — never above the cap,
  // jitter-immune (no creep down to 55), even on any panel, graceful under load.
  // The sim isn't lost on a skip — clock.getDelta() accumulates the skipped time,
  // so the next drawn frame advances the sim by the full elapsed time.
  const frameCap = Number(getSettings().frameCap);
  if (!pacerShouldDraw(frameCap, performance.now())) { requestAnimationFrame(tick); return; }
  // Apply any pending level swap BEFORE any per-frame reads on the level.
  // Stairs interactables call loadLevel() during the previous frame's
  // interactables tick; the swap lands here at the top of the next frame.
  tickPendingLoad();
  // Build/tear-down the room culler to match the active level + setting.
  syncRoomCuller();

  clock.update();   // Timer computes its delta at update(); getDelta() then returns this frame's
  const realDt = Math.min(clock.getDelta(), 0.1);

  // Harness: drain any in-flight tick budget and advance game-time clock.
  // Cheap when off. Called BEFORE the pause snapshot below so a budget that
  // ends this frame re-pauses the world for the same frame's update gate.
  harnessTickFn?.(realDt, !isWorldPaused());

  // Advance the GPU compute embers once per drawn frame, BEFORE either render
  // path (fixed-step presentPass or variable runSystems) reads the buffer.
  tickEmbersGPU();
  if (LAMP_SPOT) tickLampSpot(camera);   // place + aim the lamp's shadow spotlight

  if (USE_FIXED_STEP) {
    // FIXED-STEP path (?fixedstep=1): advance the SIM in fixed 1/60s quanta
    // (count = accumulated wall-clock), then PRESENT once. fps-independent +
    // replayable; reorders into sim-pass-then-present-pass (feel-test before
    // making default).
    // Restore last frame's authoritative camera pose HERE (frame start), not right after present. The
    // drawn pose carries the screen-shake offset, and on WebGPU the render is async — `void renderAsync`
    // reads the camera in a microtask AFTER present returns. Restoring right after present wiped the shake
    // (and the interp pose) before that deferred read, so neither rendered. Restoring at the NEXT frame's
    // start lets the drawn pose + shake survive the async render, while still being clean before this
    // frame's sim integrates.
    if (USE_INTERP) interpRestore(interpTargets);
    simAccumulator += realDt;
    let steps = 0;
    while (simAccumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      if (USE_INTERP) { fillInterpTargets(); interpStepBegin(interpTargets); }
      advanceSimStep(FIXED_DT);
      if (USE_INTERP) { fillInterpTargets(); interpStepEnd(interpTargets); }
      simAccumulator -= FIXED_DT;
      steps++;
    }
    if (simAccumulator > FIXED_DT) simAccumulator = FIXED_DT; // drop the backlog
    // Interpolate the drawn pose between the last two sim snapshots by the
    // leftover fraction; on a 0-step frame this still advances the view toward
    // `curr` instead of freezing (the judder fix). Restored after present so the
    // next sim step integrates from authoritative state, not the draw pose.
    if (USE_INTERP) { fillInterpTargets(); interpApply(simAccumulator / FIXED_DT, interpTargets); }
    frameBegin();
    presentPass(realDt);
    frameEnd();
    // (interpRestore MOVED to the top of this block — so the drawn pose + shake persist through WebGPU's
    //  async render instead of being wiped before the deferred read. See the note above.)
  } else {
    // VARIABLE-dt path (default) — the original interleaved pass, unchanged.
    tickArrival(camera, realDt);
    tickDeath(realDt);
    tickBulletTime(realDt);  // real-time so the reactive-defense dip isn't slowed by itself
    tickBossSlowmo(realDt);  // ditto — the boss-death dip advances in real time
    // TWO clocks. base = hit-pause × boss-death slow-mo (these freeze EVERYONE,
    // player included). worldScale = the reactive-defense bullet-time, which
    // slows ONLY the world (enemies + projectiles) — so on a clean deflect/dodge
    // they crawl while the player keeps acting at full speed (the asymmetric
    // payoff). scaledDt drives the world; playerDt drives camera/move/attack.
    const baseScale = getTimeScale() * getBossSlowmoTimeScale();
    const scaledDt = realDt * baseScale * getWorldTimeScale();
    const playerDt = realDt * baseScale;
    // Ambient-FX clock — real-time EXCEPT it carries the bullet-time slow, so
    // dust hangs with the world during a perfect-dodge dip but never stutters on
    // a hit-pause/death freeze (those aren't in getWorldTimeScale).
    const fxDt = realDt * getWorldTimeScale();
    // Advance the player-action FSM on the PLAYER clock, BEFORE input is
    // processed below, so a committed dodge/parry that expires this frame frees
    // the next action immediately.
    if (!isWorldPaused()) tickPlayerAction(playerDt);
    // Snapshot pause state AFTER the harness so a just-ended budget gates this
    // frame's unpaused systems.
    const paused = isWorldPaused();

    // The deep breathes only while the world runs — a pause menu full of
    // chasm whispers would give the trick away.
    if (!paused) tickChasmPresence(camera, realDt);

    // While paused, drain look input so it doesn't snap when we unfreeze.
    // (The input-camera system is gated off by the pause, so it won't.)
    if (paused) {
      input.lookDx = 0;
      input.lookDy = 0;
    }

    const ctx: TickContext = {
      realDt,
      scaledDt,
      playerDt,
      fxDt,
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
  }

  // Charge-ring HUD — early-outs on no-progress so it's free when no
  // hold is in flight. Always ticked; the visual itself opts in.
  tickChargeRing();
  tickRiteButton();

  // Perf overlay (toggle in Settings → PERF METER). Internally early-
  // outs when hidden so it's free when off. reportRendererInfo reads
  // renderer.info AFTER the render system has run this frame, so the
  // tris/draws numbers reflect what was actually drawn.
  reportRendererInfo(renderer);
  tickPerfOverlay(performance.now());
  // Adaptive resolution — self-gates (no-op unless enabled on a real phone). On
  // WebGPU the rAF interval can't see GPU load (skip-pacing pins it to vsync), so
  // feed the real GPU-timestamp ms; tickAdaptiveResolution drives the WebGL path.
  tickAdaptiveResolution(performance.now());
  if (WEBGPU) feedAdaptiveGpuMs(lastWebGPUGpuMs());
  tickCombatDebug(realDt, currentLevel?.enemies ?? []);
  tickGoreDebug();
  // Programmatic perf probe (window.__perf for the headless perf runner).
  // DEV-only — the literal-false guard dead-code-eliminates it from prod
  // (and tickPerfProbe is itself a no-op in prod, belt-and-suspenders).
  if (import.meta.env.DEV) tickPerfProbe(performance.now());

  // DEV: flash a banner on any in-play pipeline compile (a warm gap) or lag frame, so
  // hitches are impossible to miss as content is added. No-op in prod.
  tickCompileWatch();

  // First fully-rendered frame proves boot is good — clear the boot-loop flag.
  if (!bootConfirmed) { bootConfirmed = true; bootSucceeded(); }

  requestAnimationFrame(tick);
}

let bootConfirmed = false;
// Fatal-error guard around the loop. If a frame throws, the loop would otherwise
// die silently into a frozen screen. Catch it: capture (with the repro tape +
// context), show the in-character crash overlay, and stop rescheduling — one
// fault, handled, with a report path, instead of a black void.
let fatalHandled = false;
function tick() {
  // While the GPU context is lost, idle the loop (no sim, no render — rendering
  // would throw) until 'webglcontextrestored' clears the flag.
  if (isContextLost()) { requestAnimationFrame(tick); return; }
  // While the first-floor warmup owns the frame, SKIP the whole game frame — no
  // sim, no audio, no render. Otherwise the warmup's rAF yields let the game loop
  // run underneath: it ticked the sim (sound/activity before the player could act)
  // and rendered the warmup's roster subjects (artifacts). Only the warmup + the
  // DOM loading cover run; the game resumes the instant warmup tears down.
  if (isLoading()) { requestAnimationFrame(tick); return; }
  try {
    tickInner();
  } catch (err) {
    if (fatalHandled) return;
    fatalHandled = true;
    const e = err instanceof Error ? err : new Error(String(err));
    if (import.meta.env.DEV) console.error('[fatal] game loop threw:', e);
    let repro: unknown = null;
    try { repro = peekActiveTape(); } catch { /* recorder unavailable */ }
    captureError(e, true, repro); // routes to Sentry (with the tape attached) or the beacon
    showCrashOverlay(buildReport(e, { repro }), e.message);
  }
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

function startRun(floorId: string, startDepth: number = 1) {
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
  if (USE_FIXED_STEP) startRunRecording(seed);
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
setOverdrawMode(getSettings().debugOverdraw);
// React to the settings-menu toggle live (no reload needed to show/hide
// the button). The URL flag forces it on regardless of the setting.
onSettingsChanged((s) => {
  const urlForced = new URLSearchParams(window.location.search).get('debug') === '1';
  setDebugButton(urlForced || s.debugMode);
  setPerfOverlayVisible(s.perfMeter);
  setDarkAdaptReadoutVisible(s.debugEyeAdapt);
  setOverdrawMode(s.debugOverdraw);
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
  setWickLift(s.wick);
  setWickFillMul(Math.pow(s.wick, 1.5));
  // Banded lighting toggle — re-patch the node lighting model (WebGPU).
  installBandedLightingWebGPU(s.bandedLighting);
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
//   F2 HUD · F3 record · F4 DevTools marks · F5 GPU probe · F6 draw report · F9 detached stream. URL: ?profile/record/marks/stream=1.
//   Console: window.__profiler / __perfRec.{...} / __marks / __gpuProbe / __draws / __perfStream / __spector (desktop).
const profilerSessionFlag = ['profiler', 'profile', 'record', 'marks', 'stream']
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
  initGpuAttribution(scene, renderer);
  // A completed GPU-attribution sweep is forwarded to the detached cockpit (it
  // shows the ranking beside the timeline). broadcastAttr is a no-op unless the
  // stream is on, so this is free otherwise.
  onAttributionReport((d) => broadcastAttr(d));
  createProfilerHud();
}
function applyProfilerEnabled(): void {
  const on = profilingEnabled();
  if (on) { ensureProfilingInited(); setSceneAuditProvider(() => auditScene(scene)); }
  setRollingEnabled(on);          // dashcam ring fills only while enabled
  setProfilerToolbarVisible(on);
  if (!on) {
    setProfilerVisible(false);
    setMarks(false);
    setGpuProbe(false);
    setGpuPassTiming(false);
    setStreamEnabled(false);
  }
}
applyProfilerEnabled();
// Honour the specific URL flags once the suite is active for this session.
if (profilingEnabled()) {
  const q = new URLSearchParams(window.location.search);
  if (q.get('profile') === '1') setProfilerVisible(true);
  if (q.get('marks') === '1') setMarks(true);
  if (q.get('stream') === '1') setStreamEnabled(true);
  if (q.get('record') === '1') startRecording('auto');
}
window.addEventListener('keydown', (e) => {
  if (!profilingEnabled()) return;
  if (e.code === 'F2') { e.preventDefault(); toggleProfiler(); }
  else if (e.code === 'F3') { e.preventDefault(); toggleRecording(); }
  else if (e.code === 'F4') { e.preventDefault(); setMarks(!marksOn()); }
  else if (e.code === 'F5') { e.preventDefault(); setGpuProbe(!gpuProbeOn()); }
  else if (e.code === 'F6') { e.preventDefault(); void captureDrawReport(); }
  else if (e.code === 'F7') { e.preventDefault(); void runGpuAttribution(); }
  else if (e.code === 'F8') { e.preventDefault(); setGpuPassTiming(!gpuPassTimingOn()); }
  else if (e.code === 'F9') { e.preventDefault(); ensureProfilingInited(); setStreamEnabled(!streamEnabled()); }
}, true);
const profWin = window as unknown as {
  __profiler: () => void;
  __perfRec: { start: (l?: string) => void; stop: () => void; toggle: () => void; saveLast: (secs?: number) => void };
  __marks: () => void;
  __perfStream: () => void;
  __gpuProbe: () => void;
  __draws: () => void;
  __drawData: () => ReturnType<typeof drawReportData>;
  __gpuAttr: () => void;
  __gpuAttrReport: () => { running: boolean; report: string | null };
  __gpuPass: () => void;
  __gpuPassDiag: () => Record<string, unknown>;
  __lambert: (on?: boolean) => boolean;
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
profWin.__perfStream = () => { ensureProfilingInited(); setStreamEnabled(!streamEnabled()); };
profWin.__gpuProbe = () => { ensureProfilingInited(); setGpuProbe(!gpuProbeOn()); };
profWin.__draws = () => { ensureProfilingInited(); void captureDrawReport(); };
profWin.__drawData = () => { ensureProfilingInited(); return drawReportData(); };
profWin.__gpuAttr = () => { ensureProfilingInited(); void runGpuAttribution(); };
profWin.__gpuAttrReport = () => ({ running: isAttributionRunning(), report: getLastAttributionReport() });
profWin.__gpuPass = () => { ensureProfilingInited(); setGpuPassTiming(!gpuPassTimingOn()); };
profWin.__gpuPassDiag = () => gpuPassDiag();
// Lambert-class shading preview — A/B the PBR tax visually. __lambert() toggles,
// __lambert(true/false) sets. Profiler-suite tool, not a player setting.
profWin.__lambert = (on?: boolean) => { setLambertPreview(scene, on ?? !isLambertPreview()); return isLambertPreview(); };
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
// Drop the boot loading veil (index.html) — fade out, then remove. Module-scope
// so EVERY boot path can clear it (title, scenario, the debug ?show* hooks),
// not just the title. The title path holds it across a PWA-update reload (see
// the gated call below); a safety timer guarantees it never strands if some
// path forgets to clear it.
// Drive the boot veil's warmup progress bar (index.html #boot-loading .boot-bar),
// 0..1 — fed by runWarmupPassWebGPU's onProgress while the roster compiles. Reveals the
// bar on first call so fast/cached boots never flash it.
function setBootProgress(t: number): void {
  const bar = document.querySelector('#boot-loading .boot-bar') as HTMLElement | null;
  const fill = document.querySelector('#boot-loading .boot-bar-fill') as HTMLElement | null;
  if (!bar || !fill) return;
  bar.classList.add('on');
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, t))})`;
}
function hideBootLoading() {
  const el = document.getElementById('boot-loading');
  if (!el || el.classList.contains('boot-hide')) return;
  el.classList.add('boot-hide');
  window.setTimeout(() => el.remove(), 500);
}
// Safety net — just past awaitBootUpdate's own 6s cap, so a legit update gate
// resolves first; this only fires if a boot path never cleared the veil.
window.setTimeout(hideBootLoading, 7000);

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
  // No wake ceremony in scenarios — the eyelid blink covered every
  // headless snap (and the geometry the scenario exists to show).
  suppressArrivalCeremony();
  suppressNextDescentTitle();   // a debug jump isn't a descent — no title card
  startRun(floorId);
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
  function mountTitleScene() {
    LEVELS['title-vignette'] = TITLE_VIGNETTE;
    suppressArrivalCeremony();
    suppressNextDescentTitle();
    startRun('title-vignette');
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
    if (!WEBGPU) return;
    // Let the title vignette (a real fogged dungeon floor) BUILD + RENDER + fully COMPILE its
    // floor / wall / decor pipelines behind the veil — the descend floor + in-game safe rooms
    // reuse them. The title loads async + its decor compiles over several frames, so wait until
    // the compile count SETTLES (DEV: the guard's total stable; prod: a fixed ~1.5s budget),
    // capped at 4s. Without this the title compiles when the MENU appears (a menu hitch).
    await settleCompiles(4000);
    // Let the boot veil + loading bar paint before the warm blocks the thread (else boot looks frozen).
    await yieldToCover();
    const _t0 = performance.now();
    try { await runWarmupPassWebGPU(renderer, scene, camera, setBootProgress); } catch { /* best-effort */ }
    if (import.meta.env.DEV) console.log(`[bootWarm] roster warm took ${Math.round(performance.now() - _t0)}ms (high+same every reload = NOT cached; drops on 2nd = cached)`);
    startWarmupStream(scene, () => { markWarmupComplete(); markWebGPUWarmupComplete(); });
  }

  awaitBootUpdate()
    .then(async (updating) => { if (!updating) { mountTitleScene(); await bootWarm(); hideBootLoading(); openTitle(); } })
    .catch(() => { mountTitleScene(); hideBootLoading(); openTitle(); });
}
