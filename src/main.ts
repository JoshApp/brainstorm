import * as THREE from 'three';
import { CONFIG } from './config';
import { buildDungeonRoom } from './scene/dungeon';
import { createTorchlight, updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera } from './controls/camera';
import { createSword } from './player/sword';
import { createEnemy } from './mobs/enemy';
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

// Best-effort landscape lock (no-op on iOS Safari and other unsupported envs).
// Requires fullscreen mode in some browsers — wrapped in try/catch.
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

// Faint ambient — just enough that pure shadow isn't void
const ambient = new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY);
scene.add(ambient);

// --- Art style ---
const style = getStyle();
const materials = buildMaterials(style);
initRenderPipeline(renderer);

// --- Camera ---
const camera = createFirstPersonCamera();
camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
// Camera must be in the scene graph for its children (the sword) to render.
scene.add(camera);

// --- Room ---
buildDungeonRoom(scene, materials);

// --- Torchlight (mounted on north wall) ---
const torch = createTorchlight(
  scene,
  new THREE.Vector3(0, CONFIG.TORCH_HEIGHT, -CONFIG.ROOM_DEPTH / 2 + 0.4),
  materials,
);

// --- Player: held sword ---
const sword = createSword(camera, materials);

// --- Enemy ---
const [ex, ey, ez] = CONFIG.ENEMY_SPAWN;
const enemy = createEnemy(scene, new THREE.Vector3(ex, ey, ez), materials);

// --- Combat ---
const combat = createCombatSystem(camera, sword, [enemy]);

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

  // Death sequence runs on real-time dt; world updates run on scaled dt.
  tickDeath(realDt);
  const scaledDt = realDt * getTimeScale();

  if (isFrozen()) {
    // Hit-pause: skip all game updates so the world genuinely freezes.
    // Drain look input so it doesn't accumulate and snap-rotate when we resume.
    input.lookDx = 0;
    input.lookDy = 0;
  } else {
    // While dying, lock player input so the camera stays put for the epitaph.
    if (!isDying()) {
      updateCamera(camera, input, scaledDt);
    } else {
      input.lookDx = 0;
      input.lookDy = 0;
    }
    updateTorchlight(torch, scaledDt);

    // Attacks blocked while dying.
    const attackPressed = isDying() ? false : consumeAttackPressed();
    combat.tick(attackPressed);

    sword.update(scaledDt);
    enemy.update(scaledDt, camera.position);
  }

  // Screen shake ticks even during freeze so the shake reads as a sharp kick
  // rather than a delayed wobble. Apply offset, render, then revert so other
  // systems see the camera at its true position next frame.
  tickShake(realDt, shakeOffset);
  camera.position.add(shakeOffset);

  renderWithStyle(renderer, scene, camera, style);

  camera.position.sub(shakeOffset);

  requestAnimationFrame(tick);
}

tick();
