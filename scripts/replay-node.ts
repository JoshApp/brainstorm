/**
 * Headless-Node sim runner — boots the world + steps the sim with NO browser.
 * The substrate for server-side run-validation (replay a (seed, tape) and read
 * the outcome) and for browser-free balance sweeps.
 *
 * Build + run via esbuild (handles import.meta.env + Vite virtual modules):
 *   node scripts/build-replay-node.mjs && node /tmp/replay-node.mjs
 * or: npm run replay-node
 *
 * First cut: builds a procgen floor, assembles the sim systems with a stub
 * renderer (never rendered) + DOM stub, and steps the sim at a fixed 1/60s.
 * Proves the sim runs DETERMINISTICALLY in Node (same seed → same digest).
 */
import '../src/headless/dom-stub'; // MUST be first — installs the Node DOM/canvas stub
import * as THREE from 'three';
import { generateFloor } from '../src/level/procgen';
import { buildLevel, type LiveLevel } from '../src/level/builder';
import { buildMaterials } from '../src/style/materials';
import { buildSystems } from '../src/engine/systems';
import { runSystems, type TickContext } from '../src/engine/loop';
import { createFirstPersonCamera } from '../src/controls/camera';
import { createWeaponViewmodel } from '../src/player/viewmodel';
import { createCombatSystem } from '../src/combat/attack';
import { createTouchInput } from '../src/controls/input';
import { seedRng } from '../src/engine/rng';
import { setDeterministicClock, advanceGameClock } from '../src/engine/game-clock';
import { CONFIG } from '../src/config';

const FIXED_DT = 1 / 60;

// A renderer stand-in. Materials only need it to construct; render systems never
// run here, so no GL is touched.
const stubRenderer = new Proxy(
  {
    capabilities: { isWebGL2: true, maxTextures: 16, getMaxAnisotropy: () => 1 },
    getContext: () => null, setRenderTarget: () => {}, render: () => {},
    info: { render: {}, memory: {} }, extensions: { get: () => null },
    properties: { get: () => ({}) }, outputColorSpace: '',
  },
  { get: (t: Record<string, unknown>, k) => (k in t ? t[k] : () => {}) },
) as unknown as THREE.WebGLRenderer;

function digest(level: LiveLevel, camera: THREE.PerspectiveCamera): string {
  const q = (v: number) => Math.round(v * 1e4) / 1e4;
  const parts = [`cam:${q(camera.position.x)},${q(camera.position.z)}`];
  // Sort by POSITION (not entityId) so the digest is stable across runs — the
  // entity-id counter is a per-process global that doesn't reset between two
  // in-process runs; a real verifier is one run per process anyway.
  const live = level.enemies.filter((e) => e.alive).slice()
    .sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
  parts.push(`mobs:${live.length}`);
  for (const e of live) parts.push(`${e.kind}@${q(e.position.x)},${q(e.position.z)}#${q(e.hp)}`);
  return parts.join('|');
}

function runOnce(seed: number, steps: number): string {
  seedRng(seed);
  setDeterministicClock(true);

  const scene = new THREE.Scene();
  const camera = createFirstPersonCamera();
  const ambient = new THREE.AmbientLight();
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  const materials = buildMaterials(stubRenderer);
  const level = buildLevel(scene, generateFloor(1, seed), materials);

  camera.position.set(level.playerSpawn.x, CONFIG.PLAYER_HEIGHT, level.playerSpawn.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = level.playerSpawn.yaw;

  const weapon = createWeaponViewmodel(camera, { onSwingStart: () => {}, canSwing: () => true });
  const input = createTouchInput(canvas, { onTap: () => {} });
  const combat = createCombatSystem(camera, weapon, () => level.enemies);

  const systems = buildSystems({
    camera, scene, renderer: stubRenderer, ambient, canvas, input, combat, weapon,
    shakeOffset: new THREE.Vector3(), forwardScratch: new THREE.Vector3(),
    getLevel: () => level, getRoomCuller: () => null,
  });
  const sim = systems.filter((s) => s.kind === 'sim');

  const ctx: TickContext = {
    realDt: FIXED_DT, scaledDt: FIXED_DT, playerDt: FIXED_DT, fxDt: FIXED_DT,
    paused: false, mode: 'playing', playing: true,
  };
  for (let i = 0; i < steps; i++) {
    advanceGameClock(FIXED_DT);
    runSystems(sim, ctx);
  }
  return digest(level, camera);
}

const seed = Number(process.argv[2] ?? 12345);
const steps = Number(process.argv[3] ?? 300);
console.log(`Headless-Node sim — seed ${seed}, ${steps} steps\n`);
const a = runOnce(seed, steps);
const b = runOnce(seed, steps);
console.log('run A:', a);
console.log('run B:', b);
console.log(`\nNODE DETERMINISTIC: ${a === b ? 'YES — same seed → same digest' : 'NO — diverged'}`);
process.exit(a === b ? 0 : 1);
