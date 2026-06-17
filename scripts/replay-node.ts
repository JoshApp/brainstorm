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
import { spawn as spawnEntity, clear as clearWorld } from '../src/ecs/world';
import { initTriggerListener } from '../src/ecs/triggers';
import { getPlayerHp } from '../src/player/health';
import { installBus, setIntent, NEUTRAL_INTENT, type Intent } from '../src/harness/intent';
import { deserializeTape, tapeFrame, type Tape } from '../src/harness/tape';

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
  // Full-run digest: player HP (the player entity is now spawned) + camera +
  // enemies — matches the browser's __sim.snap shape (hp | cam | enemies).
  const parts = [`hp:${q(getPlayerHp())}`, `cam:${q(camera.position.x)},${q(camera.position.z)}`];
  // Sort by POSITION (not entityId) so the digest is stable across runs — the
  // entity-id counter is a per-process global that doesn't reset between two
  // in-process runs; a real verifier is one run per process anyway.
  const live = level.enemies.filter((e) => e.alive).slice()
    .sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
  parts.push(`mobs:${live.length}`);
  for (const e of live) parts.push(`${e.kind}@${q(e.position.x)},${q(e.position.z)}#${q(e.hp)}`);
  return parts.join('|');
}

// Exact replica of buildThreatScenario's level (src/debug/scenarios.ts) so the
// browser (?scenario=threat&enemy=X) and Node build the IDENTICAL world — the
// parity test's shared ground.
function threatSpec(enemy: string): ReturnType<typeof generateFloor> {
  return {
    id: 'dbg-threat', depth: 3, displayName: 'THREAT PROBE', fogColor: 0x0c0c12,
    startPos: { x: 0, z: 0, yaw: Math.PI },
    rooms: [{ id: 'threat', rect: { x: 0, z: 0, w: 14, d: 14 }, height: 4.5 }],
    corridors: [], props: [],
    torches: [
      { x: -6.8, z: 0, height: 2.6, wall: 'W', colorTint: 0xffb066, intensityMul: 1.3 },
      { x: 6.8, z: 0, height: 2.6, wall: 'E', colorTint: 0xffb066, intensityMul: 1.3 },
      { x: 0, z: -6.8, height: 2.6, wall: 'N', colorTint: 0xffb066, intensityMul: 1.3 },
      { x: 0, z: 6.8, height: 2.6, wall: 'S', colorTint: 0xffb066, intensityMul: 1.3 },
    ],
    spawns: [{ enemyId: enemy, x: 0, z: -3.2, roomId: 'threat' }],
    doors: [], stairs: [],
  } as ReturnType<typeof generateFloor>;
}

function runOnce(seed: number, steps: number, tape?: Tape, threatEnemy?: string): string {
  clearWorld(); // fresh ECS state per run (the browser gets this from a fresh page)
  seedRng(seed);
  setDeterministicClock(true);
  installBus(); // route the tape's intents through the same input seam the game uses

  const scene = new THREE.Scene();
  const camera = createFirstPersonCamera();
  const ambient = new THREE.AmbientLight();
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  const materials = buildMaterials(stubRenderer);

  // The player entity (HP lives here) — spawned BEFORE buildLevel so enemies can
  // query player state during init, exactly as main.ts does.
  spawnEntity({
    id: 'player', kind: 'player',
    hp: { base: CONFIG.PLAYER_HP_MAX, current: CONFIG.PLAYER_HP_MAX },
    buffs: [], passives: [],
  });
  initTriggerListener('player');

  const spec = threatEnemy ? threatSpec(threatEnemy) : generateFloor(1, seed);
  const level = buildLevel(scene, spec, materials);

  // Match the browser's startRun spawn-resolve so enemy AI (which reads player
  // position) evolves identically.
  const resolved = level.walkable.resolveSpawn(level.playerSpawn.x, level.playerSpawn.z, 0.3);
  camera.position.set(resolved.x, CONFIG.PLAYER_HEIGHT, resolved.z);
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

  // Mirror the STEPPER (sim-stepper driveSteps), which is what the browser's
  // __sim uses — a flat FIXED_DT ctx, no time-scale drivers. (The live loop's
  // advanceSimStep DOES tick those, but the verifier compares against __sim, so
  // we match the stepper.)
  const ctx: TickContext = {
    realDt: FIXED_DT, scaledDt: FIXED_DT, playerDt: FIXED_DT, fxDt: FIXED_DT,
    paused: false, mode: 'playing', playing: true,
  };
  for (let i = 0; i < steps; i++) {
    const intent: Intent = tape ? (tapeFrame(tape, i) ?? NEUTRAL_INTENT) : NEUTRAL_INTENT;
    setIntent(intent); // drive-by-wire: feed this step's intent before the systems read it
    advanceGameClock(FIXED_DT);
    runSystems(sim, ctx);
  }
  return digest(level, camera);
}

// Build a synthetic "walk forward" tape so the run is non-trivial (the player
// moves, enemies react) — proves tape-feeding + determinism without needing a
// browser-recorded tape. Real tapes come from window.__sim / live recording.
function syntheticTape(seed: number, n: number): Tape {
  const frames: Intent[] = Array.from({ length: n }, () => ({
    move: [0, -1], look: [0, 0], attack: false, dodge: null,
  }));
  return { seed, frames, label: 'synthetic-walk' };
}

// Args: [seed] [steps] [tapeFile]. With a tapeFile, replays that real tape
// (seed + frames from the file); otherwise replays a synthetic walk-forward tape.
const threatEnemy = process.argv.find((a) => a.startsWith('--threat='))?.split('=')[1];
if (threatEnemy) {
  // Parity mode: build the threat world + step neutral, print the digest to
  // compare against the browser (?scenario=threat&enemy=X stepped the same).
  const s = Number(process.argv[2] ?? 1);
  const n = Number(process.argv[3] ?? 200);
  console.log(`Headless-Node PARITY — threat:${threatEnemy}, seed ${s}, ${n} neutral steps\n`);
  console.log('node digest:', runOnce(s, n, undefined, threatEnemy));
  process.exit(0);
}

const seed = Number(process.argv[2] ?? 12345);
const steps = Number(process.argv[3] ?? 300);
const tapeFile = process.argv.find((a) => a.endsWith('.json'));

let tape: Tape;
if (tapeFile) {
  const { readFileSync } = await import('node:fs');
  tape = deserializeTape(readFileSync(tapeFile, 'utf8'));
  console.log(`Headless-Node REPLAY — tape ${tapeFile} (seed ${tape.seed}, ${tape.frames.length} frames)\n`);
  const a = runOnce(tape.seed, tape.frames.length, tape);
  const b = runOnce(tape.seed, tape.frames.length, tape);
  console.log('replay A:', a);
  console.log('replay B:', b);
  console.log(`\nTAPE REPLAYS DETERMINISTICALLY IN NODE: ${a === b ? 'YES' : 'NO — diverged'}`);
  process.exit(a === b ? 0 : 1);
} else {
  tape = syntheticTape(seed, steps);
  console.log(`Headless-Node sim — seed ${seed}, ${steps} steps (synthetic walk-forward tape)\n`);
  const a = runOnce(seed, steps, tape);
  const b = runOnce(seed, steps, tape);
  console.log('run A:', a);
  console.log('run B:', b);
  console.log(`\nNODE DETERMINISTIC (tape-driven): ${a === b ? 'YES — same seed+tape → same digest' : 'NO — diverged'}`);
  process.exit(a === b ? 0 : 1);
}
