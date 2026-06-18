/**
 * Headless run replayer for the VERIFIER. Replays a (seed, tape) in Node and
 * prints the run RESULT as JSON: { depth, kills, alive, steps }. The verifier
 * (scripts/verify-runs.ts) compares this against the claimed leaderboard score.
 *
 *   tsx scripts/replay-run.ts <tape.json>      (run a tape — needs esbuild; see
 *                                               scripts/build-replay-run.mjs)
 *   DELVE_SELFTEST=60 node /tmp/replay-run.mjs  (no tape: force a descent every
 *                                               60 steps to prove the swap)
 *
 * MULTI-FLOOR: mirrors the browser's loader.tickPendingLoad swap synchronously
 * — the player descending a staircase fires onDescend(target), which queues the
 * next floor; the top of each step applies it (depth++ unless safe/tutorial,
 * resetSimState, build the floor, reposition). Floors chain via the stair
 * targets generateFloor bakes in (depth-N → depth-N+1 / safe-N). Same
 * determinism authorities as replay-node.ts (DOM stub, sim-state reset,
 * sim-bootstrap). Presentation-only swap steps (fades, title cards, arrival)
 * are skipped.
 *
 * FIDELITY NOTE: assumes the non-tutorial start path (starter → depth-1).
 * First-ever-run tapes (which pass through the tutorial floor) need the start
 * path recorded with the run; that's a small follow-up.
 */
import '../src/headless/dom-stub'; // MUST be first
import * as THREE from 'three';
import { generateFloor } from '../src/level/procgen';
import { generateSafeRoom } from '../src/level/safe-room';
import { buildStarterChamber } from '../src/level/starter-chamber';
import { nextLevelAfter } from '../src/level/acts';
import { buildLevel, type LiveLevel } from '../src/level/builder';
import { setActiveLevel } from '../src/level/active-level';
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
import { getPlayerHp, isPlayerDead } from '../src/player/health';
import { resetSimState } from '../src/engine/sim-state';
import { bootstrapSimWorld } from '../src/engine/sim-bootstrap';
import { startNewRun, getRunState } from '../src/state/run-state';
import { initRunStateListeners } from '../src/state/run-state-listeners';
import { installBus, setIntent, NEUTRAL_INTENT, type Intent } from '../src/harness/intent';
import { deserializeTape, tapeFrame, type Tape } from '../src/harness/tape';
import type { LevelSpec } from '../src/level/types';

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

function replay(tape: Tape, selftestEvery = 0): RunResult {
  clearWorld();
  seedRng(tape.seed);
  setDeterministicClock(true);
  installBus();
  initRunStateListeners(); // enemy:killed → run-state kills
  startNewRun('starter', { seed: tape.seed, depth: 0 });

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

  // ── Floor lifecycle (mirror of loader.ts) ──────────────────────────
  let currentLevel: LiveLevel = null as unknown as LiveLevel;
  let currentDepth = 0;
  let pendingLoadId: string | null = null;
  const onDescend = (target: string) => { pendingLoadId = target; };

  // The starter chamber, baked once (non-tutorial path → its stairs target depth-1).
  const starterSpec = buildStarterChamber('depth-1', tape.seed);

  function specFor(id: string, depth: number): LevelSpec {
    if (id === 'starter') return starterSpec;
    if (id.startsWith('safe-')) return generateSafeRoom(parseInt(id.slice('safe-'.length), 10) || depth - 1);
    if (id.startsWith('depth-')) return generateFloor(parseInt(id.slice('depth-'.length), 10) || depth, tape.seed);
    return generateFloor(depth, tape.seed);
  }

  function applyLoad(id: string): void {
    // loader.ts: advance depth BEFORE buildLevel; safe rooms + tutorial don't count.
    if (!id.startsWith('safe-') && id !== 'tutorial') currentDepth += 1;
    resetSimState();
    const spec = specFor(id, currentDepth);
    currentLevel = buildLevel(scene, spec, materials, onDescend);
    setActiveLevel(currentLevel);
    const r = currentLevel.walkable.resolveSpawn(currentLevel.playerSpawn.x, currentLevel.playerSpawn.z, 0.3);
    camera.position.set(r.x, CONFIG.PLAYER_HEIGHT, r.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = currentLevel.playerSpawn.yaw;
    camera.rotation.x = 0;
  }

  // First floor: starter at depth 0 (the increment in applyLoad takes -1 → 0).
  currentDepth = -1;
  applyLoad('starter');

  const weapon = createWeaponViewmodel(camera, { onSwingStart: () => {}, canSwing: () => true });
  const input = createTouchInput(canvas, { onTap: () => {} });
  const combat = createCombatSystem(camera, weapon, () => currentLevel.enemies);
  const systems = buildSystems({
    camera, scene, renderer: stubRenderer, ambient, canvas, input, combat, weapon,
    shakeOffset: new THREE.Vector3(), forwardScratch: new THREE.Vector3(),
    getLevel: () => currentLevel, getRoomCuller: () => null,
  });
  const sim = systems.filter((s) => s.kind === 'sim');
  const ctx: TickContext = {
    realDt: FIXED_DT, scaledDt: FIXED_DT, playerDt: FIXED_DT, fxDt: FIXED_DT,
    paused: false, mode: 'playing', playing: true,
  };

  const steps = selftestEvery > 0 ? selftestEvery * 8 : tape.frames.length;
  let last = steps;
  for (let i = 0; i < steps; i++) {
    if (pendingLoadId) { const id = pendingLoadId; pendingLoadId = null; applyLoad(id); }
    // Self-test: force a descent to exercise the swap without a real tape.
    if (selftestEvery > 0 && i > 0 && i % selftestEvery === 0 && !pendingLoadId) {
      pendingLoadId = `depth-${currentDepth + 1}`;
    }
    const intent: Intent = selftestEvery > 0 ? NEUTRAL_INTENT : (tapeFrame(tape, i) ?? NEUTRAL_INTENT);
    setIntent(intent);
    advanceGameClock(FIXED_DT);
    runSystems(sim, ctx);
    if (isPlayerDead() || getPlayerHp() <= 0) { last = i + 1; break; }
  }
  return { depth: currentDepth, kills: getRunState()?.kills ?? 0, alive: getPlayerHp() > 0, steps: last };
}

// ── Entry ────────────────────────────────────────────────────────────
const selftest = Number(process.env.DELVE_SELFTEST ?? 0);
if (selftest > 0) {
  const fakeTape: Tape = { seed: 12345, frames: [], label: 'selftest' };
  const res = replay(fakeTape, selftest);
  console.log('SELFTEST', JSON.stringify(res));
  // Pass if the forced descents climbed past the starter (depth advanced).
  process.exit(res.depth >= 3 ? 0 : 1);
}

const tapeFile = process.argv.find((a) => a.endsWith('.json'));
if (!tapeFile) {
  console.error('usage: tsx scripts/replay-run.ts <tape.json>  |  DELVE_SELFTEST=60 node /tmp/replay-run.mjs');
  process.exit(2);
}
const { readFileSync } = await import('node:fs');
const tape = deserializeTape(readFileSync(tapeFile, 'utf8'));
console.log(JSON.stringify(replay(tape)));
