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

// --- Camera ---
const camera = createFirstPersonCamera();
camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
// Camera must be in the scene graph for its children (the sword) to render.
scene.add(camera);

// --- Room ---
buildDungeonRoom(scene);

// --- Torchlight (mounted on north wall) ---
const torch = createTorchlight(
  scene,
  new THREE.Vector3(0, CONFIG.TORCH_HEIGHT, -CONFIG.ROOM_DEPTH / 2 + 0.4),
);

// --- Player: held sword ---
const sword = createSword(camera);

// --- Enemy ---
const [ex, ey, ez] = CONFIG.ENEMY_SPAWN;
const enemy = createEnemy(scene, new THREE.Vector3(ex, ey, ez));

// --- Combat ---
const combat = createCombatSystem(camera, sword, [enemy]);

// --- Input ---
const input = createTouchInput(canvas);
createAttackButton();

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

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);

  updateCamera(camera, input, dt);
  updateTorchlight(torch, dt);

  const attackPressed = consumeAttackPressed();
  combat.tick(attackPressed);

  sword.update(dt);
  enemy.update(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
