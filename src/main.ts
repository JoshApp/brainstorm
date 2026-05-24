import * as THREE from 'three';
import { CONFIG } from './config';
import { updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera, setCameraYaw } from './controls/camera';
import { createSword } from './player/sword';
import { createCombatSystem } from './combat/attack';
import { createAttackButton, consumeAttackPressed } from './controls/attack-button';
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

// --- Level (the new declarative pipeline) ---
const level = buildLevel(scene, LEVEL_1, materials);
camera.position.set(level.playerSpawn.x, CONFIG.PLAYER_HEIGHT, level.playerSpawn.z);
setCameraYaw(level.playerSpawn.yaw);

// --- Player: held sword ---
const sword = createSword(camera, materials);

// --- Combat ---
const combat = createCombatSystem(camera, sword, level.enemies);

// --- Player death wiring ---
onPlayerDeath(() => triggerDeath());

// --- Broadcast / DCC tribute layer ---
initAchievements();

// --- Input ---
const input = createTouchInput(canvas);
createAttackButton();
createStyleSwitcher();

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

function tick() {
  const realDt = Math.min(clock.getDelta(), 0.1);

  tickDeath(realDt);
  const scaledDt = realDt * getTimeScale();

  if (isFrozen()) {
    // Hit-pause: skip all game updates, drain look input so it doesn't snap.
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
  }

  tickShake(realDt, shakeOffset);
  camera.position.add(shakeOffset);

  renderWithStyle(renderer, scene, camera, style);

  camera.position.sub(shakeOffset);

  requestAnimationFrame(tick);
}

tick();
