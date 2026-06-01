import * as THREE from 'three';
import { CONFIG } from './config';
import { updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera, setCameraYaw } from './controls/camera';
import { createWeaponViewmodel } from './player/viewmodel';
import { attachLamp, detachLamp, tickLamp } from './player/handheld-lamp';
import { attachOffhandViewmodel, detachOffhandViewmodel, tickOffhandViewmodel } from './player/handheld-offhand';
import { setBobTarget, updateBob } from './player/viewmodel-bob';
import { setSlot, onEquipmentChanged } from './player/equipment';
import { setCurrentWeapon } from './player/current-weapon';
import { ITEMS } from './content/items';
import { warmupContent } from './content/warmup';
import { createCombatSystem } from './combat/attack';
import { isWorldPaused } from './world-paused';
import { tickShake } from './combat/screen-shake';
import { onPlayerDeath } from './player/health';
import { triggerDeath, getTimeScale, tickDeath, isDying, initDeath } from './player/death';
import { initAchievements } from './broadcast/achievements';
import { initEventLog } from './broadcast/event-log';
import { buildMaterials } from './style/materials';
import { initRenderPipeline, renderWithStyle, setDarkAdapt } from './style/render-target';
import { createSettingsMenu, configureSettingsMenu } from './ui/settings-menu';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings, onSettingsChanged } from './settings/settings';
import { setMasterVolume, setReverbEnabled, startAmbience, setTorchProximity, setAudioListenerPose, playWhoosh } from './audio/sfx';
import { startMusic, setMusicVolume } from './audio/music';
import { emit, on as onEvent } from './broadcast/event-bus';
import { buildLevel, type LiveLevel } from './level/builder';
import { LEVEL_1, LEVELS } from './level/specs';
import { buildStarterChamber } from './level/starter-chamber';
import { findTestChamber } from './level/test-chambers';
import { showTestChambersScreen } from './ui/test-chambers-screen';
import { initLevelLoader, loadInitialLevel, loadLevel, tickPendingLoad, getCurrentDepth } from './level/loader';
import { tickAlerts, clearAlerts } from './mobs/alerts';
import { generateFloor } from './level/procgen';
import { generateSafeRoom } from './level/safe-room';
import { suppressNextSafeRoomTransition } from './ui/safe-room-transition';
import { suppressNextDescentTitle } from './ui/descent-fade';
import { startNewRun, adoptSave, loadSave, clearSave, getRunState } from './state/run-state';
import { initCharacterTracking, resetCharacter } from './state/character';
import { initRunStateListeners } from './state/run-state-listeners';
import { isPlaying, getGameMode } from './state/game-mode';
import { runSystems, type GameSystem, type TickContext } from './engine/loop';
import { recomputePlayerStats } from './state/player-stats';
import { syncHudStores } from './state/hud-stores';
import { tickDarkAdaptation, darkAdaptBrightness, darkAdaptAmbient, sampleLitSignal } from './scene/dark-adaptation';
import { initDarkAdaptReadout, updateDarkAdaptReadout } from './debug/dark-adapt-readout';
import { tickThresholdDrafts } from './scene/threshold-draft';
import { seedRng } from './engine/rng';
import { recordRunStart, resetRunDiscoveries, getMeta } from './state/meta-state';
import { showStartScreen } from './ui/start-screen';
import { addItemSilently, clearInventory } from './player/inventory';
import { get as getEntity } from './ecs/world';
import type { EquipSlot } from './player/equipment';
import { getScenarioFromUrl, applyScenario, buildVaultPreviewLevel } from './debug/scenarios';
import { isAnyScreenOpen } from './ui/screen-manager';
import { spawn as spawnEntity } from './ecs/world';
import { tickAllBuffs } from './ecs/buffs';
import { initTriggerListener } from './ecs/triggers';
import { setupPwaAutoUpdate, maybeApplyUpdateSilently, setBeforeReloadHook } from './pwa-update';
import { captureDevSnapshot, applyDevSnapshot, clearDevSnapshot, hasPendingDevSnapshot } from './state/dev-snapshot';
import { createPerfOverlay, setPerfOverlayVisible, tickPerfOverlay, reportRendererInfo } from './ui/perf-overlay';
import { createChargeRing, tickChargeRing } from './ui/charge-ring';
import { tickInteractables, getInRangeInteractable, getAllInteractables } from './interactables/system';
import { findTapTarget } from './controls/tap-target';
import { triggerAttack, consumeAttackPressed } from './controls/attack-input';
import { initPickupLightPool } from './interactables/pickup';
import { initLightPool, tickLightPool } from './scene/light-pool';
import { initProjectilePool, tickProjectiles } from './combat/projectile-pool';
import { registerProjectiles } from './content/projectiles';
import { validateContent } from './content/validate';
import { tickXpWisps, clearXpWisps } from './effects/xp-wisps';
import { tickGoldCoins, clearGoldCoins } from './effects/gold-coins';
import { tickTutorialHints, clearTutorialHints } from './effects/tutorial-hints';
import { initDriftingMotes, tickDriftingMotes } from './effects/drifting-motes';
import { tickShatterBurst } from './effects/shatter-burst';
import { tickBloodBurst } from './effects/blood-burst';
import { tickStatusVfx } from './effects/status-vfx';
import { actForDepth } from './level/acts';
import { updateOutline } from './interactables/outline';
import { ensureInteractLabel, updateInteractLabel } from './ui/interact-label';
import { tickItemPreviews } from './ui/item-preview';
import { createConsumableBar } from './controls/consumable-bar';
import { createHpBar } from './ui/hp-bar';
import { createBossBar, tickBossBar, resetBossBar } from './ui/boss-bar';
import { createBuffBar, updateBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { createDepthCounter, setDepth as setDepthCounter } from './ui/depth-counter';
import { createXpGoldHud, updateXpGoldHud } from './ui/xp-gold-hud';
import { tickLowHpPulse } from './ui/vignette';
import { getPlayerHp, getPlayerMaxHp, setGodMode } from './player/health';
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
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.FOG_COLOR);
scene.fog = new THREE.Fog(CONFIG.FOG_COLOR, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);

const ambient = new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY);
scene.add(ambient);

// Inspection mode (vault-preview snaps) — flat bright fill so authored
// geometry reads regardless of torchlight; overrides dark-adaptation.
let inspectMode = false;

// --- Static surface materials (PS1) ---
const materials = buildMaterials();
initRenderPipeline(renderer);

// --- Camera ---
const camera = createFirstPersonCamera();
scene.add(camera); // required for the sword (camera child) to render
// Register camera with the death sequence so the death tick can
// pitch + drop it during the collapse animation.
initDeath(camera);

// --- Scenario (URL param ?scenario=...) ---
// DEV-only. In a production build `import.meta.env.DEV` is the literal
// `false`, so this resolves to `null`, every `scenario` branch below goes
// dead, and the bundler tree-shakes the entire debug/scenarios module (and
// its fixed-seed test levels) out of the live site.
const scenario = import.meta.env.DEV ? getScenarioFromUrl() : null;
const levelSpec = scenario?.level ?? LEVEL_1;

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

initLevelLoader({
  scene,
  materials,
  camera,
  levels: LEVELS,
  onLoaded(level) {
    currentLevel = level as LiveLevel & { checkRoomClear?: () => void };
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
    initDriftingMotes(scene, rectsForMotes, tint);
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
  onSwingStart: () => {
    playWhoosh();
    emit({ type: 'attack:swing' });
  },
});

// Weapon + offhand viewmodels are driven REACTIVELY by the equipment
// slot system. Whenever a slot changes (pickup, manual equip via the
// inventory panel, save restore), this listener swaps the visible model
// + the active stats. Single source of truth: equipment.
//
// Offhand handling — the lamp is a special offhand item that owns its
// own viewmodel + a registered PointLight (handheld-lamp.ts). Any other
// offhand item (shield, future spell focus, etc.) renders through the
// generic offhand-viewmodel manager. Equipping a shield silently
// removes the lamp's light — that's the design tradeoff: visibility
// vs defence.
onEquipmentChanged((eq) => {
  // Pass null when no weapon equipped — the sword viewmodel
  // clears and the player walks empty-handed. This is the
  // starter-chamber default until they take from an altar.
  weapon.equip(eq.weapon?.viewmodel ?? null);
  if (eq.weapon?.weapon) setCurrentWeapon(eq.weapon.weapon);
  if (eq.offhand?.id === 'oil-lamp') {
    detachOffhandViewmodel();
    attachLamp(camera);
  } else if (eq.offhand) {
    detachLamp();
    attachOffhandViewmodel(camera, eq.offhand.dropModel);
  } else {
    detachLamp();
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
  onTap(clientX, clientY) {
    // Don't tap-target anything during dying or while screens are open.
    if (isDying() || isAnyScreenOpen()) return false;
    if (!currentLevel) return false;
    const hit = findTapTarget(
      clientX, clientY, canvas, camera,
      currentLevel.enemies,
      getAllInteractables(),
    );
    if (!hit) return false;
    if (hit.kind === 'enemy') {
      // Tapped an enemy anywhere on screen → fire an attack. Combat's
      // cone check handles whether the swing actually lands; tap just
      // signals intent.
      triggerAttack();
      return true;
    }
    // Interactable: only if it's in range AND has an active prompt.
    // Range is owned by the interactables system via getInRangeInteractable;
    // anything else would let the player use a chest from across the room.
    const inRange = getInRangeInteractable();
    if (inRange && inRange.id === hit.interactable.id) {
      hit.interactable.onUse();
      return true;
    }
    // Out of range — let the tap fall through (right-side becomes a swing,
    // left-side does nothing). Some feedback "too far" would help here
    // later; ignoring is fine for V1.
    return false;
  },
  onInteract() {
    // E key (or future gamepad confirm) — use the currently in-range
    // interactable, no screen position needed. Same gate as the tap
    // path: not during dying or open screens.
    if (isDying() || isAnyScreenOpen()) return;
    const inRange = getInRangeInteractable();
    if (inRange) inRange.onUse();
  },
});
// Floating world-anchored interact label only — the corner USE button
// was removed. Interaction is now diegetic: tap the object directly
// (handled by tap-target raycast in the touch input handler).
ensureInteractLabel();
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
// The frame is an ordered list of systems (engine/loop.ts). Each declares a
// phase ('unpaused' skips while the world is paused; 'always' runs every
// frame) so freeze behaviour is data, not nested control flow. Order below =
// execution order. dt/pause/lifecycle come off the ctx; everything else is
// closed over from the module scope above.
const SYSTEMS: GameSystem[] = [
  // Look/move input + camera. While dying, control input is dropped so
  // nothing downstream (camera, bob) reads stale joystick values.
  { name: 'input-camera', phase: 'unpaused', tick(ctx) {
    if (!isDying()) {
      input.tickInput(ctx.scaledDt);   // hybrid-look continuous rotation, if enabled
      updateCamera(camera, input, ctx.scaledDt, currentLevel.walkable, currentLevel.enemies);
    } else {
      input.lookDx = 0;
      input.lookDy = 0;
      input.moveX = 0;
      input.moveY = 0;
    }
  } },

  { name: 'torchlight', phase: 'unpaused', tick(ctx) {
    for (const t of currentLevel.torches) updateTorchlight(t, ctx.scaledDt);
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
    const walkable = currentLevel.walkable;
    const cx = camera.position.x;
    const cz = camera.position.z;

    // Torch crackle volume — LOS torch proximity at the player's position.
    let prox = 0;
    for (const t of currentLevel.torches) {
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
    const lit = sampleLitSignal(cx, cz, fx, fz, currentLevel.torches, walkable);

    const adapt = tickDarkAdaptation(lit, ctx.realDt);
    // PS1 path ignores renderer tone mapping (render-to-target), so the dark
    // lift lives in the blit shader (additive shadow-raise). Ambient is a
    // secondary fill (applied during the scene render, so it works there).
    setDarkAdapt(adapt);
    ambient.intensity = inspectMode ? 1.6 : darkAdaptAmbient();
    updateDarkAdaptReadout(lit, adapt, darkAdaptBrightness());
  } },

  { name: 'combat', phase: 'unpaused', tick(ctx) {
    const attackPressed = isDying() ? false : consumeAttackPressed();
    combat.tick(attackPressed, input.moveX, input.moveY, ctx.scaledDt);
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

  { name: 'weapon', phase: 'unpaused', tick(ctx) { weapon.update(ctx.scaledDt); } },

  // Handheld lamp flicker + bob. realDt — flicker shouldn't slow during
  // slow-mo (a frozen lamp looks broken).
  { name: 'lamp', phase: 'unpaused', tick(ctx) { tickLamp(ctx.realDt); } },

  { name: 'offhand', phase: 'unpaused', tick() { tickOffhandViewmodel(); } },

  // Enemy sleep: skip update() for enemies far from the player — they can't
  // influence gameplay outside perception range. Threshold 25m, past the
  // deepest sight (wraith 12m). Damage path is unaffected (takeDamage
  // doesn't go through update()).
  { name: 'enemies', phase: 'unpaused', tick(ctx) {
    const playerX = camera.position.x;
    const playerZ = camera.position.z;
    const sleepDist2 = 25 * 25;
    for (const enemy of currentLevel.enemies) {
      // Dying enemies still tick (death animation drives the dissolve).
      if (!enemy.alive && !enemy.dying) continue;
      const dx = enemy.group.position.x - playerX;
      const dz = enemy.group.position.z - playerZ;
      if (dx * dx + dz * dz > sleepDist2) continue;
      // Phasing mobs (ghosts) use the obstacle-free nav grid.
      const nav = enemy.phasing ? currentLevel.navPhasing : currentLevel.nav;
      enemy.update(ctx.scaledDt, camera.position, currentLevel.walkable, nav);
    }
    // Boss bar — show/drain/fade based on the live boss enemy.
    tickBossBar(currentLevel.enemies, ctx.scaledDt);
  } },

  // Decay active combat alerts so old broadcasts stop pulling mobs in long
  // after the player has left.
  { name: 'alerts', phase: 'unpaused', tick(ctx) { tickAlerts(ctx.scaledDt); } },

  // XP wisps / gold coins — home in on the player and absorb on contact.
  // Live outside the enemy loop so they survive past their spawner.
  { name: 'xp-wisps', phase: 'unpaused', tick(ctx) { tickXpWisps(ctx.scaledDt, camera.position); } },
  { name: 'gold-coins', phase: 'unpaused', tick(ctx) {
    tickGoldCoins(ctx.scaledDt, camera.position, currentLevel.walkable);
  } },

  // Projectiles — integrate, hit-test player + walls, retire. Outside the
  // enemy loop so a shot survives the shooter's death.
  { name: 'projectiles', phase: 'unpaused', tick(ctx) {
    tickProjectiles(ctx.scaledDt, camera.position, currentLevel.walkable);
  } },

  // Room-clear detection — fires room:cleared so doors flip SEALED→OPEN.
  { name: 'room-clear', phase: 'unpaused', tick() { currentLevel.checkRoomClear?.(); } },

  // Active buffs on all entities (heal-over-time, DoTs, etc.).
  { name: 'buffs', phase: 'unpaused', tick(ctx) { tickAllBuffs(ctx.scaledDt); } },

  // Status VFX — colored motes off anything carrying a buff with `vfx`
  // (burn embers, poison/bleed drips). Runs after buffs so it reflects
  // the current affliction.
  { name: 'status-vfx', phase: 'unpaused', tick(ctx) {
    tickStatusVfx(scene, currentLevel.enemies, camera.position, ctx.scaledDt);
  } },

  // ── always-on (run through pause/death so the screen stays live) ──

  // Drifting motes — ambient dust keeps falling through hit-pauses, death,
  // and menus. Real dt.
  { name: 'motes', phase: 'always', tick(ctx) { tickDriftingMotes(ctx.realDt); } },
  // Shatter / blood bursts — scaled dt so shards slow-mo with the
  // hit-pause / death sequence (reads as crunchier).
  { name: 'shatter', phase: 'always', tick(ctx) { tickShatterBurst(ctx.scaledDt); } },
  { name: 'blood', phase: 'always', tick(ctx) { tickBloodBurst(ctx.scaledDt); } },

  // Interact tick + world-anchored UI run OUTSIDE the freeze gate so
  // in-range detection persists through hit-pauses. dt=0 when frozen so
  // animations (chest lid, pickup bob) don't advance — only the "what's in
  // range" pass refreshes.
  { name: 'world-ui', phase: 'always', tick(ctx) {
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
    updateOutline(inRange, ctx.realDt, camera.position);
  } },

  // Player stats snapshot — recompute the single reactive PlayerSnapshot
  // once per frame. Runs in 'always' so equipment/attribute changes made
  // while a menu is open still update the snapshot (and its subscribers,
  // e.g. the inventory stat column) live. Subscribers fire only on real
  // change. Ordered before 'hud' so HUD readouts read this frame's values.
  // Recompute the player snapshot, then push live values (HP) into the HUD
  // stores. Order matters: snapshot first so hpStore's max reflects this
  // frame's equipment/buffs. Bound HUD widgets (hp-bar, depth) re-render
  // from here only when a value actually changes.
  { name: 'player-stats', phase: 'always', tick() {
    recomputePlayerStats();
    syncHudStores();
  } },

  // HUD — the buff bar diffs the live buff list; the xp/gold bar polls +
  // animates its pulses. (HP bar + depth are store-bound, updated above.)
  { name: 'hud', phase: 'always', tick(ctx) {
    updateBuffBar();
    updateXpGoldHud(ctx.realDt);
  } },

  // Low-HP breathing vignette — peripheral red at <30% HP. realDt so it
  // keeps breathing during scaled time.
  { name: 'low-hp-vignette', phase: 'always', tick(ctx) {
    const maxHp = getPlayerMaxHp();
    tickLowHpPulse(ctx.realDt, maxHp > 0 ? getPlayerHp() / maxHp : 0);
  } },

  // Screen shake offset is applied to the camera before light-pool + render,
  // then removed after, so it never accumulates. Three ordered systems.
  { name: 'shake-apply', phase: 'always', tick(ctx) {
    tickShake(ctx.realDt, shakeOffset);
    camera.position.add(shakeOffset);
  } },

  // Bind the N nearest registered lights to the pool's PointLight slots.
  // Runs every frame so lighting updates with camera movement even when
  // frozen. LOS culls through-wall sources from the ranking.
  { name: 'light-pool', phase: 'always', tick() {
    const walkable = currentLevel?.walkable;
    const los = walkable
      ? (ax: number, az: number, bx: number, bz: number) =>
          walkable.hasLineOfSight(ax, az, bx, bz)
      : undefined;
    tickLightPool(camera, los);
  } },

  { name: 'render', phase: 'always', tick() { renderWithStyle(renderer, scene, camera); } },

  { name: 'shake-restore', phase: 'always', tick() { camera.position.sub(shakeOffset); } },
];

function tick() {
  // Apply any pending level swap BEFORE any per-frame reads on the level.
  // Stairs interactables call loadLevel() during the previous frame's
  // interactables tick; the swap lands here at the top of the next frame.
  tickPendingLoad();

  const realDt = Math.min(clock.getDelta(), 0.1);

  // Harness: drain any in-flight tick budget and advance game-time clock.
  // Cheap when off. Called BEFORE the pause snapshot below so a budget that
  // ends this frame re-pauses the world for the same frame's update gate.
  harnessTickFn?.(realDt, !isWorldPaused());

  tickDeath(realDt);
  const scaledDt = realDt * getTimeScale();
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
  runSystems(SYSTEMS, ctx);

  // Charge-ring HUD — early-outs on no-progress so it's free when no
  // hold is in flight. Always ticked; the visual itself opts in.
  tickChargeRing();

  // Perf overlay (toggle in Settings → PERF METER). Internally early-
  // outs when hidden so it's free when off. reportRendererInfo reads
  // renderer.info AFTER the render system has run this frame, so the
  // tris/draws numbers reflect what was actually drawn.
  reportRendererInfo(renderer);
  tickPerfOverlay(performance.now());

  requestAnimationFrame(tick);
}

// ── Run start ──────────────────────────────────────────────────────────
// All the systems above are wired; we just don't have an active level
// (or a render loop) yet. The start screen owns the next step: either
// DESCEND (fresh run on depth-1) or CONTINUE (resume the saved floor).
//
// Scenario URLs (debug) bypass the title and jump straight into the
// requested level.

function applyState(saveData: ReturnType<typeof loadSave>) {
  // Reset inventory.
  clearInventory();
  // Hydrate inventory from save (or empty for new run).
  if (saveData) {
    for (const [id, count] of Object.entries(saveData.inventory)) {
      for (let i = 0; i < count; i++) addItemSilently(id);
    }
  }
  // Equipment — set saved slots, OR defaults for new runs.
  // Fresh runs deliberately START WITHOUT a weapon — the player picks
  // one at an altar in the starter chamber (the first room of every
  // run). Offhand defaults to the lamp regardless.
  if (saveData) {
    for (const [slot, itemId] of Object.entries(saveData.equipment)) {
      if (itemId && ITEMS[itemId]) setSlot(slot as EquipSlot, ITEMS[itemId]);
    }
    // Safety: legacy saves predating the starter chamber may have no
    // weapon recorded; give them a rusted sword so they're not stuck
    // unarmed mid-dungeon on resume.
    if (!saveData.equipment.weapon) setSlot('weapon', ITEMS['rusted-sword']);
    // Same safety for offhand — pre-offhand-slot saves won't have one.
    if (!saveData.equipment.offhand) setSlot('offhand', ITEMS['oil-lamp']);
  } else {
    setSlot('offhand', ITEMS['oil-lamp']);
  }
  // HP — restore to saved value, or full for new run.
  const player = getEntity('player');
  if (player?.hp) {
    player.hp.current = saveData ? saveData.hp : player.hp.base;
  }
}

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
      setSlot('offhand', ITEMS['oil-lamp']);
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
    LEVELS['starter'] = buildStarterChamber(LEVEL_1.id);
    startNewRun('starter', { seed: Number.isFinite(seed as number) ? seed : undefined });
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
    setSlot('offhand', ITEMS['oil-lamp']);
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
if (DEBUG_ENABLED) initDarkAdaptReadout();
// React to the settings-menu toggle live (no reload needed to show/hide
// the button). The URL flag forces it on regardless of the setting.
onSettingsChanged((s) => {
  const urlForced = new URLSearchParams(window.location.search).get('debug') === '1';
  setDebugButton(urlForced || s.debugMode);
  setPerfOverlayVisible(s.perfMeter);
});

// Perf overlay (FPS / frame time / draw calls). Hidden until the PERF
// METER setting flips on — tickPerfOverlay early-outs when hidden so
// the per-frame cost is a single style read.
createPerfOverlay();
setPerfOverlayVisible(getSettings().perfMeter);

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
  // spec or use the default LEVEL_1.
  const floorId = scenario.level?.id ?? LEVEL_1.id;
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
    inspectMode = true;
    ambient.intensity = 1.6;
    const fog = scene.fog as THREE.Fog | null;
    if (fog) { fog.near = 30; fog.far = 90; }
  }
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
      // straight in LEVEL_1. "Ever attempted a run" is tracked in
      // meta-state and survives across saves/deaths.
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
      const nextAfterStarter = wantTutorial ? 'tutorial' : LEVEL_1.id;
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
          const lo = chamber.loadout ?? { weapon: 'rusted-sword', offhand: 'oil-lamp' };
          if (lo.weapon && ITEMS[lo.weapon]) setSlot('weapon', ITEMS[lo.weapon]);
          if (lo.offhand && ITEMS[lo.offhand]) setSlot('offhand', ITEMS[lo.offhand]);
          startRun(spec.id, 0);
        },
        () => openTitle(),   // BACK — re-show the title
      );
    },
    onContinue() {
      const s = loadSave();
      if (!s) {
        // Save vanished between title render + click. Fall back to fresh.
        clearSave();
        startNewRun(LEVEL_1.id);
        recordRunStart();
        resetRunDiscoveries();
        applyState(null);
        startRun(LEVEL_1.id, 1);
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
