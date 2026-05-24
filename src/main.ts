import * as THREE from 'three';
import { CONFIG } from './config';
import { buildDungeonRoom } from './scene/dungeon';
import { createTorchlight, updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera } from './controls/camera';

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

// --- Room ---
buildDungeonRoom(scene);

// --- Torchlight (mounted on north wall for now) ---
const torch = createTorchlight(scene, new THREE.Vector3(0, CONFIG.TORCH_HEIGHT, -CONFIG.ROOM_DEPTH / 2 + 0.2));

// --- Input ---
const input = createTouchInput(canvas);

// --- Resize ---
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- Render loop ---
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);

  updateCamera(camera, input, dt);
  updateTorchlight(torch, dt);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
