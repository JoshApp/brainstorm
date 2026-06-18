/**
 * Diagnostic: does a bus-driven INTERACT (a) get RECORDED into the tape and
 * (b) descend a staircase headlessly? Isolates the interact under-capture a
 * real run exposed (only 1 of ~3 descents recorded). Build + run:
 *   node scripts/build-test-harness.mjs
 *
 * FINDINGS (2026-06-18):
 *  - RECORDING IS SOUND: 4/4 bus-driven interacts captured. The recorder,
 *    tape format (9th float), and setIntent→triggerInteract path all work.
 *    So the live under-capture is in the LIVE TAP path, not here.
 *  - The descent half is INCONCLUSIVE here: getInRangeInteractable() returns
 *    NONE because this bare harness sets camera.position but doesn't drive
 *    the player ENTITY transform the interactables in-range scan reads. A
 *    faithful repro needs the full player-movement plumbing (or a real
 *    browser). Left as a starting point for that work, not a passing test.
 */
import '../src/headless/dom-stub';
import * as THREE from 'three';
import { generateFloor } from '../src/level/procgen';
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
import { resetSimState } from '../src/engine/sim-state';
import { bootstrapSimWorld } from '../src/engine/sim-bootstrap';
import { installBus, setIntent, NEUTRAL_INTENT, type Intent } from '../src/harness/intent';
import { startRecording, finishRun } from '../src/harness/run-recorder';
import { getInRangeInteractable } from '../src/interactables/system';

const FIXED_DT = 1 / 60;
const stubRenderer = new Proxy(
  { capabilities: { isWebGL2: true, maxTextures: 16, getMaxAnisotropy: () => 1 }, getContext: () => null, setRenderTarget: () => {}, render: () => {}, info: { render: {}, memory: {} }, extensions: { get: () => null }, properties: { get: () => ({}) }, outputColorSpace: '' },
  { get: (t: Record<string, unknown>, k) => (k in t ? t[k] : () => {}) },
) as unknown as THREE.WebGLRenderer;

const SEED = 3682020424;
clearWorld();
seedRng(SEED);
setDeterministicClock(true);
installBus();
startRecording(SEED);

const scene = new THREE.Scene();
const camera = createFirstPersonCamera();
const ambient = new THREE.AmbientLight();
const canvas = document.createElement('canvas') as HTMLCanvasElement;
const materials = buildMaterials(stubRenderer);
bootstrapSimWorld(scene);
spawnEntity({ id: 'player', kind: 'player', hp: { base: CONFIG.PLAYER_HP_MAX, current: CONFIG.PLAYER_HP_MAX }, buffs: [], passives: [] });
initTriggerListener('player');
resetSimState();

const spec = generateFloor(1, SEED);
const stair = spec.stairs?.[0];
console.log('stair:', stair ? `${stair.x.toFixed(1)},${stair.z.toFixed(1)} → ${stair.targetLevel}` : 'NONE');
let depth = 1;
const level: LiveLevel = buildLevel(scene, spec, materials, () => { depth += 1; });
setActiveLevel(level);

// Spawn the player ON the stair so it's in range immediately.
const sx = stair?.x ?? level.playerSpawn.x;
const sz = stair?.z ?? level.playerSpawn.z;
const r = level.walkable.resolveSpawn(sx, sz, 0.3);
camera.position.set(r.x, CONFIG.PLAYER_HEIGHT, r.z);
camera.rotation.order = 'YXZ';

const weapon = createWeaponViewmodel(camera, { onSwingStart: () => {}, canSwing: () => true });
const input = createTouchInput(canvas, { onTap: () => {} });
const combat = createCombatSystem(camera, weapon, () => level.enemies);
const systems = buildSystems({ camera, scene, renderer: stubRenderer, ambient, canvas, input, combat, weapon, shakeOffset: new THREE.Vector3(), forwardScratch: new THREE.Vector3(), getLevel: () => level, getRoomCuller: () => null });
const sim = systems.filter((s) => s.kind === 'sim');
const ctx: TickContext = { realDt: FIXED_DT, scaledDt: FIXED_DT, playerDt: FIXED_DT, fxDt: FIXED_DT, paused: false, mode: 'playing', playing: true };

// 10 neutral steps (let in-range detection settle), then 3 interact pulses.
for (let i = 0; i < 30; i++) {
  const fire = i >= 10 && i % 5 === 0;
  const intent: Intent = fire ? { ...NEUTRAL_INTENT, interact: true } : NEUTRAL_INTENT;
  setIntent(intent);
  advanceGameClock(FIXED_DT);
  runSystems(sim, ctx);
  if (fire) {
    const ir = getInRangeInteractable();
    console.log(`  step ${i}: inRange=${ir ? `${(ir as { id?: string }).id ?? '?'} promptLabel="${(ir as { promptLabel?: string }).promptLabel ?? '?'}"` : 'NONE'}`);
  }
}

const tape = finishRun();
const recorded = tape ? tape.frames.filter((f) => f.interact).length : 0;
console.log(`pulses sent: 4 | interacts RECORDED: ${recorded} | depth after: ${depth}`);
console.log(recorded > 0 && depth > 1 ? '>>> record + descend BOTH work (bus path)' : recorded === 0 ? '>>> RECORDING the interact failed' : '>>> recorded but did NOT descend');
