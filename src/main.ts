import * as THREE from 'three';
import { CONFIG } from './config';
import { updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera, setCameraYaw } from './controls/camera';
import { createSword } from './player/sword';
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
import { getStyle } from './style';
import { buildMaterials } from './style/materials';
import { initRenderPipeline, renderWithStyle } from './style/render-target';
import { createSettingsMenu, configureSettingsMenu } from './ui/settings-menu';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings, onSettingsChanged } from './settings/settings';
import { setMasterVolume, startAmbience, setTorchProximity, playWhoosh } from './audio/sfx';
import { emit } from './broadcast/event-bus';
import { buildLevel, type LiveLevel } from './level/builder';
import { LEVEL_1, LEVELS } from './level/specs';
import { buildStarterChamber } from './level/starter-chamber';
import { findTestChamber } from './level/test-chambers';
import { showTestChambersScreen } from './ui/test-chambers-screen';
import { initLevelLoader, loadInitialLevel, loadLevel, tickPendingLoad, getCurrentDepth } from './level/loader';
import { tickAlerts, clearAlerts } from './mobs/alerts';
import { generateFloor } from './level/procgen';
import { generateSafeRoom } from './level/safe-room';
import { startNewRun, adoptSave, loadSave, clearSave, getRunState } from './state/run-state';
import { initCharacterTracking, resetCharacter } from './state/character';
import { initRunStateListeners } from './state/run-state-listeners';
import { isPlaying, getGameMode } from './state/game-mode';
import { runSystems, type GameSystem, type TickContext } from './engine/loop';
import { recomputePlayerStats } from './state/player-stats';
import { syncHudStores } from './state/hud-stores';
import { tickDarkAdaptation } from './scene/dark-adaptation';
import { seedRng } from './engine/rng';
import { recordRunStart, resetRunDiscoveries, getMeta } from './state/meta-state';
import { showStartScreen } from './ui/start-screen';
import { addItemSilently, clearInventory } from './player/inventory';
import { get as getEntity } from './ecs/world';
import type { EquipSlot } from './player/equipment';
import { getScenarioFromUrl, applyScenario } from './debug/scenarios';
import { isAnyScreenOpen } from './ui/screen-manager';
import { spawn as spawnEntity } from './ecs/world';
import { tickAllBuffs } from './ecs/buffs';
import { initTriggerListener } from './ecs/triggers';
import { setupPwaAutoUpdate, maybeApplyUpdateSilently } from './pwa-update';
import { tickInteractables, getInRangeInteractable, getAllInteractables } from './interactables/system';
import { findTapTarget } from './controls/tap-target';
import { triggerAttack, consumeAttackPressed } from './controls/attack-input';
import { initPickupLightPool } from './interactables/pickup';
import { initLightPool, tickLightPool } from './scene/light-pool';
import { initProjectilePool, tickProjectiles } from './combat/projectile-pool';
import { registerProjectiles } from './content/projectiles';
import { tickXpWisps, clearXpWisps } from './effects/xp-wisps';
import { tickGoldCoins, clearGoldCoins } from './effects/gold-coins';
import { tickTutorialHints, clearTutorialHints } from './effects/tutorial-hints';
import { initDriftingMotes, tickDriftingMotes } from './effects/drifting-motes';
import { tickShatterBurst } from './effects/shatter-burst';
import { tickBloodBurst } from './effects/blood-burst';
import { actForDepth } from './level/acts';
import { updateOutline } from './interactables/outline';
import { ensureInteractLabel, updateInteractLabel } from './ui/interact-label';
import { tickItemPreviews } from './ui/item-preview';
import { createConsumableBar } from './controls/consumable-bar';
import { createHpBar } from './ui/hp-bar';
import { createBuffBar, updateBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { createDepthCounter, setDepth as setDepthCounter } from './ui/depth-counter';
import { createXpGoldHud, updateXpGoldHud } from './ui/xp-gold-hud';
import { tickLowHpPulse } from './ui/vignette';
import { getPlayerHp, getPlayerMaxHp } from './player/health';
import { setHarnessPaused } from './harness/pause';

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.PIXEL_RATIO_CAP));
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

// --- Art style ---
const style = getStyle();
const materials = buildMaterials(style);
initRenderPipeline(renderer);

// --- Camera ---
const camera = createFirstPersonCamera();
scene.add(camera); // required for the sword (camera child) to render
// Register camera with the death sequence so the death tick can
// pitch + drop it during the collapse animation.
initDeath(camera);

// --- Scenario (URL param ?scenario=...) ---
const scenario = getScenarioFromUrl();
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
const sword = createSword(camera, {
  onSwingStart: () => {
    playWhoosh();
    emit({ type: 'attack:swing' });
  },
});

// Sword + offhand viewmodels are driven REACTIVELY by the equipment
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
  sword.equip(eq.weapon?.viewmodel ?? null);
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
  camera, sword,
  () => currentLevel.enemies,
  () => currentLevel.destructibles ?? [],
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

// Start ambient loops (torch crackle bed + room drone) on the very first
// user gesture — AudioContext can't run before the user has touched the
// page, so we attach a one-shot listener that fires startAmbience once.
{
  const startOnce = () => {
    startAmbience();
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

// Run-state listeners — kill counter, items-found set, autosave on
// floor:loaded events. Wired before any level load so the initial
// floor entry is captured.
initRunStateListeners();
initCharacterTracking();

// PWA: poll for SW updates + auto-reload when a new SW takes over.
// Means a `git push` lands on Josh's installed home-screen app within a
// minute or two without him having to close and reopen it.
setupPwaAutoUpdate();

// --- HUD ---
createHpBar();
createBuffBar();
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
  } },

  // Ambient torch crackle volume — sum of (1 - dist/range) across torches
  // in earshot.
  { name: 'torch-audio', phase: 'unpaused', tick(ctx) {
    let prox = 0;
    const earRange = 6;
    for (const t of currentLevel.torches) {
      const dx = t.position.x - camera.position.x;
      const dz = t.position.z - camera.position.z;
      const d = Math.hypot(dx, dz);
      if (d < earRange) prox += 1 - d / earRange;
    }
    setTorchProximity(prox);
    // Eye dark-adaptation: lift the ambient floor when the player is away
    // from torchlight so torchless corridors stay navigable. realDt so the
    // adjustment runs at real-time, not the death slow-mo.
    ambient.intensity = tickDarkAdaptation(prox, ctx.realDt);
  } },

  { name: 'combat', phase: 'unpaused', tick() {
    const attackPressed = isDying() ? false : consumeAttackPressed();
    combat.tick(attackPressed);
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

  { name: 'sword', phase: 'unpaused', tick(ctx) { sword.update(ctx.scaledDt); } },

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

  { name: 'render', phase: 'always', tick() { renderWithStyle(renderer, scene, camera, style); } },

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
      scene, camera, renderer, canvas, input, sword,
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
// React to the settings-menu toggle live (no reload needed to show/hide
// the button). The URL flag forces it on regardless of the setting.
onSettingsChanged((s) => {
  const urlForced = new URLSearchParams(window.location.search).get('debug') === '1';
  setDebugButton(urlForced || s.debugMode);
});

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
} else if (scenario) {
  // Debug scenario — bypass title. Scenario may override the level
  // spec or use the default LEVEL_1.
  const floorId = scenario.level?.id ?? LEVEL_1.id;
  if (scenario.level) LEVELS[scenario.level.id] = scenario.level;
  setSlot('weapon', ITEMS['rusted-sword']);
  startRun(floorId);
  // Scenarios may want to mutate enemies / give items / open panels.
  // Runs AFTER startRun so currentLevel is populated.
  applyScenario(scenario, { level: currentLevel, sword, camera });
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
