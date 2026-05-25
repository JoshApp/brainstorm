import * as THREE from 'three';
import { CONFIG } from './config';
import { updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera, setCameraYaw } from './controls/camera';
import { createSword } from './player/sword';
import { onEquipWeapon } from './player/weapon-equip';
import { setSlot } from './player/equipment';
import { ITEMS } from './content/items';
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
import { buildLevel } from './level/builder';
import { LEVEL_1 } from './level/specs';
import { getScenarioFromUrl, applyScenario } from './debug/scenarios';
import { isWorldFrozen } from './debug/freeze';
import { spawn as spawnEntity } from './ecs/world';
import { tickAllBuffs } from './ecs/buffs';
import { initTriggerListener } from './ecs/triggers';
import { PASSIVES } from './content/passives';
import { setupPwaAutoUpdate } from './pwa-update';
import { tickInteractables, getInRangeInteractable, pressUse } from './interactables/system';
import { createUseButton, setUseButtonVisible, consumeUsePressed } from './controls/use-button';
import { createPotionButton, updatePotionButton } from './controls/potion-button';
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

// --- Level (the declarative pipeline) ---
const level = buildLevel(scene, levelSpec, materials);
camera.position.set(level.playerSpawn.x, CONFIG.PLAYER_HEIGHT, level.playerSpawn.z);
setCameraYaw(level.playerSpawn.yaw);
// Apply yaw to the camera object immediately so the first frame is correct
// (otherwise frozen scenarios show the default rotation until updateCamera runs).
camera.rotation.order = 'YXZ';
camera.rotation.y = level.playerSpawn.yaw;
camera.rotation.x = 0;

// --- Player: held sword ---
const sword = createSword(camera);
// Pickup module fires this when the player takes a weapon item — swap the
// visible viewmodel under the same swing animation.
onEquipWeapon((spec) => sword.equip(spec));
// Seed the equipment slot system with the player's starting weapon so
// stats aggregation includes it (and the future inventory UI shows it).
setSlot('weapon', ITEMS['rusted-sword']);

// --- Combat ---
const combat = createCombatSystem(camera, sword, level.enemies);

// --- Player death wiring ---
onPlayerDeath(() => triggerDeath());

// --- Broadcast / DCC tribute layer ---
initAchievements();

// --- Apply scenario overrides (post-build) ---
if (scenario) applyScenario(scenario, { level, sword, camera });

// --- Input ---
// Attack is now triggered by tapping anywhere on the right half of the
// screen (in addition to the spacebar on desktop). No more on-screen
// attack button — less intrusive UI, larger hit area.
const input = createTouchInput(canvas);
createUseButton();
createPotionButton();
createInteractPrompt();
createStyleSwitcher();

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
  const realDt = Math.min(clock.getDelta(), 0.1);

  tickDeath(realDt);
  const scaledDt = realDt * getTimeScale();

  if (isFrozen() || isWorldFrozen()) {
    // Hit-pause OR scenario freeze: skip all game updates, drain look input
    // so it doesn't snap if/when we unfreeze.
    input.lookDx = 0;
    input.lookDy = 0;
  } else {
    if (!isDying()) {
      updateCamera(camera, input, scaledDt, level.walkable);
    } else {
      input.lookDx = 0;
      input.lookDy = 0;
    }

    for (const t of level.torches) updateTorchlight(t, scaledDt);

    const attackPressed = isDying() ? false : consumeAttackPressed();
    combat.tick(attackPressed);

    sword.update(scaledDt);
    for (const enemy of level.enemies) {
      enemy.update(scaledDt, camera.position, level.walkable);
    }

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

    // HUD — poll-based; cheap and always accurate.
    updateHpBar();
    updateBuffBar();
    updatePotionButton();
  }

  tickShake(realDt, shakeOffset);
  camera.position.add(shakeOffset);

  renderWithStyle(renderer, scene, camera, style);

  camera.position.sub(shakeOffset);

  requestAnimationFrame(tick);
}

tick();
