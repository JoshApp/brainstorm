import * as THREE from 'three';
import { CONFIG } from './config';
import { updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera, setCameraYaw } from './controls/camera';
import { createSword } from './player/sword';
import { setSlot, onEquipmentChanged } from './player/equipment';
import { setCurrentWeapon } from './player/current-weapon';
import { ITEMS } from './content/items';
import { warmupContent } from './content/warmup';
import { createCombatSystem } from './combat/attack';
import { consumeAttackPressed } from './controls/attack-input';
import { isFrozen } from './combat/hit-pause';
import { tickShake } from './combat/screen-shake';
import { onPlayerDeath } from './player/health';
import { triggerDeath, getTimeScale, tickDeath, isDying } from './player/death';
import { initAchievements } from './broadcast/achievements';
import { getStyle } from './style';
import { buildMaterials } from './style/materials';
import { initRenderPipeline, renderWithStyle } from './style/render-target';
import { createStyleSwitcher } from './ui/style-switcher';
import { createSettingsMenu } from './ui/settings-menu';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings } from './settings/settings';
import { setMasterVolume, startAmbience, setTorchProximity } from './audio/sfx';
import { buildLevel, type LiveLevel } from './level/builder';
import { LEVEL_1, LEVELS } from './level/specs';
import { initLevelLoader, loadInitialLevel, loadLevel, tickPendingLoad } from './level/loader';
import { getScenarioFromUrl, applyScenario } from './debug/scenarios';
import { isWorldFrozen } from './debug/freeze';
import { isAnyMenuOpen, installMenuBackdrop } from './controls/input-mode';
import { spawn as spawnEntity } from './ecs/world';
import { tickAllBuffs } from './ecs/buffs';
import { initTriggerListener } from './ecs/triggers';
import { PASSIVES } from './content/passives';
import { setupPwaAutoUpdate } from './pwa-update';
import { tickInteractables, getInRangeInteractable, pressUse } from './interactables/system';
import { initPickupLightPool } from './interactables/pickup';
import { createUseButton, setUseButtonVisible, consumeUsePressed } from './controls/use-button';
import { createConsumableBar } from './controls/consumable-bar';
import { createInteractPrompt, setInteractPrompt } from './ui/interact-prompt';
import { createHpBar, updateHpBar } from './ui/hp-bar';
import { createBuffBar, updateBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { createDepthCounter } from './ui/depth-counter';

// Best-effort landscape lock (no-op on iOS Safari and other unsupported envs).
try {
  const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
  so?.lock?.('landscape').catch(() => {});
} catch {
  // ignore — orientation API not supported here
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
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
  // Reaper passive: kill an enemy → 2.7s of regen-pulse buff. Demonstrates
  // the trigger → effect → buff → buff-tick-effect chain working end-to-end.
  // Later this passive (or many like it) will come from equipped items.
  passives: [PASSIVES.reaper],
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
  },
});

// Initial level — either from a debug scenario (still uses the old direct
// build path) or the standard depth-1 entry. We respect levelSpec coming
// from a scenario by overriding the LEVELS registry entry for its id.
if (scenario?.level) {
  // Override registry entry so the same loader code path drives both.
  LEVELS[scenario.level.id] = scenario.level;
  loadInitialLevel(scenario.level.id);
} else {
  loadInitialLevel(LEVEL_1.id);
}
camera.position.set(currentLevel.playerSpawn.x, CONFIG.PLAYER_HEIGHT, currentLevel.playerSpawn.z);
camera.rotation.order = 'YXZ';
camera.rotation.y = currentLevel.playerSpawn.yaw;
camera.rotation.x = 0;

// --- Player: held sword ---
const sword = createSword(camera);

// Sword viewmodel + combat stats are now driven REACTIVELY by the equipment
// slot system. Whenever the weapon slot changes (pickup, manual equip via
// the inventory panel, etc.), this listener swaps the visible model + the
// active stats. Single source of truth: equipment.
onEquipmentChanged((eq) => {
  if (eq.weapon?.viewmodel) sword.equip(eq.weapon.viewmodel);
  if (eq.weapon?.weapon) setCurrentWeapon(eq.weapon.weapon);
});

// Seed the starting weapon — fires the listener above, which equips the
// rusted sword viewmodel + sets initial combat stats.
setSlot('weapon', ITEMS['rusted-sword']);

// --- Combat ---
// Combat queries enemies via a getter so the system follows level swaps —
// after descent the new floor's enemies become attackable without
// rewiring.
const combat = createCombatSystem(camera, sword, () => currentLevel.enemies);

// --- Player death wiring ---
onPlayerDeath(() => triggerDeath());

// --- Broadcast / DCC tribute layer ---
initAchievements();

// --- Input ---
// Attack is now triggered by tapping anywhere on the right half of the
// screen (in addition to the spacebar on desktop). No more on-screen
// attack button — less intrusive UI, larger hit area.
const input = createTouchInput(canvas);
createUseButton();
createConsumableBar();
createInteractPrompt();
createStyleSwitcher();
// Shared modal backdrop — input-mode handles its own visibility based on
// what menus are open. Must exist before any menu opens.
installMenuBackdrop();
createSettingsMenu();
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
initPickupLightPool(scene);

// --- Apply scenario overrides (post-build, AFTER UI is created so
// scenarios that open panels / give items work correctly).
if (scenario) applyScenario(scenario, { level: currentLevel, sword, camera });

// PWA: poll for SW updates + auto-reload when a new SW takes over.
// Means a `git push` lands on Josh's installed home-screen app within a
// minute or two without him having to close and reopen it.
setupPwaAutoUpdate();

// --- HUD ---
createHpBar();
createBuffBar();
createPickupNotification();
createDepthCounter(1);  // hardcoded until floors system lands

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

function tick() {
  // Apply any pending level swap BEFORE any per-frame reads on the level.
  // Stairs interactables call loadLevel() during the previous frame's
  // interactables tick; the swap lands here at the top of the next frame.
  tickPendingLoad();

  const realDt = Math.min(clock.getDelta(), 0.1);

  tickDeath(realDt);
  const scaledDt = realDt * getTimeScale();

  if (isFrozen() || isWorldFrozen() || isAnyMenuOpen()) {
    // Hit-pause OR scenario freeze OR any menu open: skip all game updates,
    // drain look input so it doesn't snap if/when we unfreeze.
    input.lookDx = 0;
    input.lookDy = 0;
  } else {
    if (!isDying()) {
      input.tickInput(scaledDt);   // hybrid-look continuous rotation, if enabled
      updateCamera(camera, input, scaledDt, currentLevel.walkable, currentLevel.enemies);
    } else {
      input.lookDx = 0;
      input.lookDy = 0;
    }

    for (const t of currentLevel.torches) updateTorchlight(t, scaledDt);

    // Ambient torch crackle volume — sum of (1 - dist/range) across all
    // torches in earshot.
    let prox = 0;
    const earRange = 6;
    for (const t of currentLevel.torches) {
      const dx = t.light.position.x - camera.position.x;
      const dz = t.light.position.z - camera.position.z;
      const d = Math.hypot(dx, dz);
      if (d < earRange) prox += 1 - d / earRange;
    }
    setTorchProximity(prox);

    const attackPressed = isDying() ? false : consumeAttackPressed();
    combat.tick(attackPressed);

    sword.update(scaledDt);
    for (const enemy of currentLevel.enemies) {
      enemy.update(scaledDt, camera.position, currentLevel.walkable);
    }

    // Room-clear detection — fires room:cleared events when a tracked
    // room's alive count hits zero. Doors listen for this to flip from
    // SEALED to OPEN. Cheap: handful of enemies per level.
    currentLevel.checkRoomClear?.();

    // Tick active buffs on all entities (heal-over-time, future DoTs, etc.)
    tickAllBuffs(scaledDt);

    // Interactables: tick per-instance animation (chest opening, pickup
    // bob), recompute "what's in range AND in the player's forward cone,"
    // fire onUse on use press.
    camera.getWorldDirection(forwardScratch);
    tickInteractables(scaledDt, camera.position, forwardScratch);
    const inRange = isDying() ? null : getInRangeInteractable();
    setInteractPrompt(inRange ? inRange.promptLabel : null);
    setUseButtonVisible(!!inRange);
    if (!isDying() && consumeUsePressed()) pressUse();

  }

  // HUD — poll-based; cheap and always accurate. Runs even when the
  // world is paused so the player can see HP / buff state in menus
  // and during hit-pause flashes. The consumable bar rebuilds itself
  // on inventory changes (event-driven), so no per-frame tick.
  updateHpBar();
  updateBuffBar();

  tickShake(realDt, shakeOffset);
  camera.position.add(shakeOffset);

  renderWithStyle(renderer, scene, camera, style);

  camera.position.sub(shakeOffset);

  requestAnimationFrame(tick);
}

tick();
