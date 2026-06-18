/**
 * Headless run replayer for the VERIFIER. Replays a (seed, tape) in Node and
 * prints the run RESULT as JSON: { depth, kills, alive, steps }. The verifier
 * (scripts/verify-runs.ts) compares this against the claimed leaderboard score.
 *
 *   tsx scripts/replay-run.ts <tape.json>
 *
 * Built on the same proven machinery as replay-node.ts (DOM stub, stub
 * renderer, the three determinism authorities). LIMITATION: this replays a
 * SINGLE floor — headless floor-transitions are the determinism track's
 * remaining piece, so `depth` is the floor reached within one level (1 for
 * now). `kills` = enemies killed on that floor. The verifier treats depth>1
 * claims as not-yet-verifiable rather than rejecting them.
 */
import '../src/headless/dom-stub'; // MUST be first
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
import { resetSimState } from '../src/engine/sim-state';
import { bootstrapSimWorld } from '../src/engine/sim-bootstrap';
import { installBus, setIntent, NEUTRAL_INTENT, type Intent } from '../src/harness/intent';
import { deserializeTape, tapeFrame, type Tape } from '../src/harness/tape';

const FIXED_DT = 1 / 60;

const stubRenderer = new Proxy(
  {
    capabilities: { isWebGL2: true, maxTextures: 16, getMaxAnisotropy: () => 1 },
    getContext: () => null, setRenderTarget: () => {}, render: () => {},
    info: { render: {}, memory: {} }, extensions: { get: () => null },
    properties: { get: () => ({}) }, outputColorSpace: '',
  },
  { get: (t: Record<string, unknown>, k) => (k in t ? t[k] : () => {}) },
) as unknown as THREE.WebGLRenderer;

export interface RunResult {
  depth: number;
  kills: number;
  alive: boolean;
  steps: number;
}

function replay(tape: Tape): RunResult {
  clearWorld();
  seedRng(tape.seed);
  setDeterministicClock(true);
  installBus();

  const scene = new THREE.Scene();
  const camera = createFirstPersonCamera();
  const ambient = new THREE.AmbientLight();
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  const materials = buildMaterials(stubRenderer);

  bootstrapSimWorld(scene);
  spawnEntity({
    id: 'player', kind: 'player',
    hp: { base: CONFIG.PLAYER_HP_MAX, current: CONFIG.PLAYER_HP_MAX },
    buffs: [], passives: [],
  });
  initTriggerListener('player');
  resetSimState();

  const spec = generateFloor(1, tape.seed);
  const level: LiveLevel = buildLevel(scene, spec, materials);

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

  const ctx: TickContext = {
    realDt: FIXED_DT, scaledDt: FIXED_DT, playerDt: FIXED_DT, fxDt: FIXED_DT,
    paused: false, mode: 'playing', playing: true,
  };

  const steps = tape.frames.length;
  for (let i = 0; i < steps; i++) {
    const intent: Intent = tapeFrame(tape, i) ?? NEUTRAL_INTENT;
    setIntent(intent);
    advanceGameClock(FIXED_DT);
    runSystems(sim, ctx);
    if (getPlayerHp() <= 0) {
      // Player died — the run is over; further steps wouldn't change the result.
      return { depth: 1, kills: level.enemies.filter((e) => !e.alive).length, alive: false, steps: i + 1 };
    }
  }
  return { depth: 1, kills: level.enemies.filter((e) => !e.alive).length, alive: getPlayerHp() > 0, steps };
}

const tapeFile = process.argv.find((a) => a.endsWith('.json'));
if (!tapeFile) {
  console.error('usage: tsx scripts/replay-run.ts <tape.json>');
  process.exit(2);
}
const { readFileSync } = await import('node:fs');
const tape = deserializeTape(readFileSync(tapeFile, 'utf8'));
// Single machine-readable line for the verifier to parse.
console.log(JSON.stringify(replay(tape)));
