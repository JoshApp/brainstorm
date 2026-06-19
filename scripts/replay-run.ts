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
import { createFirstPersonCamera, setCameraYaw, setCameraPitch } from '../src/controls/camera';
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
import { getSettings, updateSettings } from '../src/settings/settings';
import { deserializeTape, tapeFrame, type Tape } from '../src/harness/tape';
import { getAllInteractables, getInRangeInteractable } from '../src/interactables/system';
import { getCurrentWeapon, setCurrentWeapon, FIST_STATS } from '../src/player/current-weapon';
import { onEquipmentChanged } from '../src/player/equipment';
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
  if (process.env.DELVE_LOOK_SENS) {
    // EXPERIMENT: the tape stores raw look deltas; updateCamera scales them by
    // lookSensitivity. Override it to test whether a sensitivity mismatch is
    // why a real run's trajectory diverges in replay.
    updateSettings({ lookSensitivity: Number(process.env.DELVE_LOOK_SENS) });
  }
  if (process.env.DELVE_REPLAY_DEBUG) console.error(`[dbg] lookSensitivity=${getSettings().lookSensitivity}`);
  seedRng(tape.seed);
  setDeterministicClock(true);
  installBus();
  // SIM-relevant half of main.ts's onEquipmentChanged handler: keep
  // current-weapon in sync with the equipment slot. WITHOUT this, taking a
  // weapon at a starter altar (setSlot) never updates current-weapon, so the
  // player stays effectively unarmed (no kills) AND the starter's
  // has-equipment stair gate never opens → the run is stuck at depth 0.
  // (The viewmodel/offhand half of the real handler is presentation-only.)
  let equippedWeaponId: string | null = null;
  onEquipmentChanged((eq) => {
    setCurrentWeapon(eq.weapon?.weapon ?? FIST_STATS);
    equippedWeaponId = (eq.weapon as { id?: string } | undefined)?.id ?? null;
    if (process.env.DELVE_REPLAY_DEBUG) console.error(`[dbg] EQUIP CHANGED → weapon=${equippedWeaponId ?? 'none'} @ replayStep=${(globalThis as { __replayStep?: number }).__replayStep ?? 'setup'}\n${(new Error().stack ?? '').split('\n').slice(2, 9).join('\n')}`);
  });
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
    // Set facing through the camera MODULE (mirrors main.ts:380/409 on level
    // load), not camera.rotation directly: updateCamera() rebuilds the rotation
    // from the module's yaw/pitch every frame, so a raw camera.rotation write is
    // clobbered → the replayed player faces yaw 0 instead of the spawn yaw and
    // every camera-relative move goes the wrong way (no kills, no descent).
    setCameraYaw(currentLevel.playerSpawn.yaw);
    setCameraPitch(0);
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

  if (process.env.DELVE_REPLAY_DEBUG) {
    console.error('[dbg] starter interactables:');
    for (const it of getAllInteractables()) {
      console.error(`  - ${(it as { id?: string }).id} @ ${it.position.x.toFixed(1)},${it.position.z.toFixed(1)} label="${(it as { promptLabel?: string }).promptLabel}"`);
    }
    console.error(`[dbg] starting weapon: ${(getCurrentWeapon() as { id?: string; name?: string })?.id ?? (getCurrentWeapon() as { name?: string })?.name ?? 'NONE'}`);
  }
  const stairPositions = getAllInteractables().filter((it) => (it as { id?: string }).id?.includes('stairs')).map((it) => ({ x: it.position.x, z: it.position.z }));
  let minStairDist = Infinity;

  const steps = selftestEvery > 0 ? selftestEvery * 8 : tape.frames.length;
  let last = steps;
  for (let i = 0; i < steps; i++) {
    (globalThis as { __replayStep?: number }).__replayStep = i;
    if (pendingLoadId) { const id = pendingLoadId; pendingLoadId = null; applyLoad(id); }
    // Self-test: force a descent to exercise the swap without a real tape.
    if (selftestEvery > 0 && i > 0 && i % selftestEvery === 0 && !pendingLoadId) {
      pendingLoadId = `depth-${currentDepth + 1}`;
    }
    const intent: Intent = selftestEvery > 0 ? NEUTRAL_INTENT : (tapeFrame(tape, i) ?? NEUTRAL_INTENT);
    setIntent(intent);
    advanceGameClock(FIXED_DT);
    runSystems(sim, ctx);
    for (const s of stairPositions) { const d = Math.hypot(s.x - camera.position.x, s.z - camera.position.z); if (d < minStairDist) minStairDist = d; }
    if (process.env.DELVE_REPLAY_DEBUG && intent.interact) {
      const ir = getInRangeInteractable();
      console.error(`[dbg] INTERACT @ step ${i} pos ${camera.position.x.toFixed(1)},${camera.position.z.toFixed(1)} inRange=${ir ? `${(ir as { id?: string }).id} "${(ir as { promptLabel?: string }).promptLabel}"` : 'NONE'}`);
    }
    if (process.env.DELVE_REPLAY_DEBUG && i % 300 === 0) {
      console.error(`[dbg] step ${i} depth ${currentDepth} pos ${camera.position.x.toFixed(1)},${camera.position.z.toFixed(1)} yaw ${camera.rotation.y.toFixed(2)} move ${JSON.stringify(intent.move)} look ${JSON.stringify(intent.look)} kills ${getRunState()?.kills ?? 0}`);
    }
    if (isPlayerDead() || getPlayerHp() <= 0) { last = i + 1; break; }
  }
  if (process.env.DELVE_REPLAY_DEBUG) {
    console.error(`[dbg] closest the player EVER got to a stair: ${minStairDist.toFixed(2)}m`);
    console.error(`[dbg] final weapon: ${(getCurrentWeapon() as { id?: string; name?: string })?.id ?? (getCurrentWeapon() as { name?: string })?.name ?? 'NONE'}`);
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
