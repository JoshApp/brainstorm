// Enemy behaviour trace — the safety net for splitting createEnemy.
//
// No other test builds a real Enemy, so a refactor of mobs/enemy.ts would be
// checked by nothing. This drives every enemy spec through the same scripted
// fight (seeded RNG, walled arena with a pillar, a player that walks in,
// circles, strikes and backs off) and records what each one did, tick by tick:
// position, facing, state, hp, poise-side effects through hp, and the player
// damage it dealt. `enemy-golden.test.ts` compares the run to the recorded
// golden; a pure refactor reproduces it bit-for-bit.
//
//   npx tsx tests/enemy-trace.ts --write   # re-record after a DELIBERATE change

// Game modules are imported DYNAMICALLY: the Vite asset hooks must be
// registered before the module graph that pulls in ui/fonts.ts resolves.
import './support/vite-assets';
import '../src/headless/dom-stub';
import * as THREE from 'three';
import type { Enemy } from '../src/mobs/enemy';
import type { WalkableRegion } from '../src/level/walkable';
import type { NavGrid } from '../src/level/nav-grid';

const { createEnemy } = await import('../src/mobs/enemy');
const { ENEMIES } = await import('../src/content/enemies');
const { WalkableRegion: Walkable } = await import('../src/level/walkable');
const { NavGrid: Nav } = await import('../src/level/nav-grid');
const { seedRng } = await import('../src/engine/rng');
const { getPlayerHp } = await import('../src/player/health');
const { setDeterministicClock, resetGameClock, advanceGameClock } = await import('../src/engine/game-clock');
const { spawn: spawnEntity, clear: clearWorld } = await import('../src/ecs/world');
const { initTriggerListener } = await import('../src/ecs/triggers');
const { resetSimState } = await import('../src/engine/sim-state');
const { bootstrapSimWorld } = await import('../src/engine/sim-bootstrap');
const { tickPack, clearPack } = await import('../src/mobs/pack');
const { tickProjectiles } = await import('../src/combat/projectile-pool');
const { registerFogWall } = await import('../src/ui/boss-engagement');
const { engageBossEncounter } = await import('../src/mobs/boss-encounter');
const { triggerParry } = await import('../src/combat/reactive-defense');

/** Cosmetic randomness (gore spray, essence wisps) still reads Math.random;
 *  pin it so the trace is reproducible end to end. */
function seedMathRandom(seed: number): void {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60;
const TICKS = 60 * 15;          // 15 s of fight per spec (the last 3.5 s is the death)
const SAMPLE_EVERY = 6;         // record 10 samples a second

function arena(): { walkable: WalkableRegion; nav: NavGrid } {
  const W = 16, D = 16;
  const walls = [
    { ax: -W / 2, az: -D / 2, bx: W / 2, bz: -D / 2 },
    { ax: W / 2, az: -D / 2, bx: W / 2, bz: D / 2 },
    { ax: W / 2, az: D / 2, bx: -W / 2, bz: D / 2 },
    { ax: -W / 2, az: D / 2, bx: -W / 2, bz: -D / 2 },
  ];
  const walkable = new Walkable(
    [{ x: 0, z: 0, w: W, d: D }],
    [{ kind: 'circle', x: 2.5, z: -1.5, r: 0.6 } as never],
    walls as never,
  );
  const nav = new Nav(walkable, { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 });
  return { walkable, nav };
}

/** Camera height — enemies get camera.position, i.e. the player's EYE. */
const EYE = 1.6;

/** The scripted player: approach, circle, back off, return. Deterministic in t. */
function playerAt(t: number, out: THREE.Vector3): THREE.Vector3 {
  if (t < 3) return out.set(0, EYE, 6 - t * 1.2);              // walk in from the south
  if (t < 9) {                                               // circle the spawn
    const a = (t - 3) * 0.9;
    return out.set(Math.sin(a) * 2.6, EYE, Math.cos(a) * 2.6);
  }
  if (t < 11) return out.set(0, EYE, 2.6 + (t - 9) * 2);       // back off
  return out.set(0, EYE, 6.6 - (t - 11) * 1.5);                // come back in
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Presentation digest: every node under the enemy (body pose, death topple,
 *  telegraph, eyes) folded into a few numbers, plus how many things the fight
 *  has put into the scene (gore, wisps, flung parts). Catches a refactor that
 *  keeps the AI right but moves a bone or forgets an effect. */
function poseDigest(root: THREE.Object3D, scene: THREE.Object3D): string {
  let p = 0, r = 0, sc = 0, vis = 0, n = 0;
  root.traverse((o) => {
    n++;
    p += o.position.x * 1.3 + o.position.y * 1.7 + o.position.z * 1.9;
    r += o.rotation.x * 2.3 + o.rotation.y * 2.9 + o.rotation.z * 3.1;
    sc += o.scale.x + o.scale.y * 1.1 + o.scale.z * 1.2;
    if (o.visible) vis++;
  });
  return `${n}/${vis} ${r3(p)} ${r3(r)} ${r3(sc)} s${scene.children.length}`;
}

export function traceSpec(id: string): string[] {
  // The same world setup scripts/replay-node.ts uses, which mirrors main.ts:
  // fresh ECS, the player entity (its HP is what enemies damage), the sim
  // bootstrap (projectile pool), then the sim-state reset.
  clearWorld();
  clearPack();
  seedRng(0x5eed + id.length * 7919);
  seedMathRandom(0xc0ffee);
  setDeterministicClock(true);
  resetGameClock();
  const scene = new THREE.Scene();
  bootstrapSimWorld(scene);
  spawnEntity({
    id: 'player', kind: 'player',
    hp: { base: 10_000, current: 10_000 },   // never dies: the trace wants the whole fight
    buffs: [], passives: [],
  });
  initTriggerListener('player');
  resetSimState();
  const { walkable, nav } = arena();
  const spec = ENEMIES[id];
  // A boss that waits for the fog gate gets one, and the player crosses it at
  // 1.5 s (the dormant -> engage-grace path).
  if (spec.dormantUntilEngaged) registerFogWall();
  // Summoned adds are real enemies, ticked alongside their summoner.
  const adds: Enemy[] = [];
  const e: Enemy = createEnemy(scene, new THREE.Vector3(0, 0, -2), spec, undefined, {
    onSummon: (gate, at) => {
      const spawned: Enemy[] = [];
      for (let k = 0; k < gate.count; k++) {
        const a = (k / gate.count) * Math.PI * 2;
        const pos = new THREE.Vector3(at.x + Math.cos(a) * gate.radius, 0, at.z + Math.sin(a) * gate.radius);
        spawned.push(createEnemy(scene, pos, ENEMIES[gate.enemyId]));
      }
      adds.push(...spawned);
      return spawned;
    },
  });
  const p = new THREE.Vector3();
  const camera = new THREE.PerspectiveCamera();
  const lines: string[] = [];
  let hp0 = getPlayerHp();
  let lastState = '';
  for (let i = 0; i < TICKS; i++) {
    const t = i * DT;
    advanceGameClock(DT);
    playerAt(t, p);
    if (i === 90) engageBossEncounter();
    // engine/systems.ts order: pack coordinator, then enemies, then projectiles.
    tickPack(DT, p);
    e.update(DT, p, walkable, nav);
    for (const a of adds) if (a.alive || a.dying) a.update(DT, p, walkable, nav);
    tickProjectiles(DT, p, walkable, camera);

    const st = e.aiDebug().state;
    // 4-7 s: the player parries each windup as it starts (deflect / riposte path).
    if (t >= 4 && t < 7 && st === 'winding' && lastState !== 'winding') triggerParry();
    lastState = st;
    if (e.alive) {
      if (i === 450) e.applyStaggerDamage(1000);                              // 7.5 s: poise break
      if (i === 480) e.takeDamage({ source: null, target: e.entityId, base: 1, type: 'magic', dot: true, tint: 0xff0000 });
      if (i === 630) e.applyKnockback(0, -1, 4);                              // 10.5 s
      if (i === 660) e.applyFear(1.5);                                        // 11 s
      // 11.5 s: whatever is still standing dies, so every death style
      // (collapse / crumble / fade, severs, essence) plays out in the trace.
      if (i === 690) e.takeDamage({ source: 'player', target: e.entityId, base: 100_000, type: 'physical', hitZoneId: 'head', severSide: 'L' });
    }
    // From 8 s the player strikes every 0.8 s while in reach, for a sixth of
    // the enemy's pool (phases, splits, death, gore).
    if (t >= 8 && i % 48 === 24 && e.alive && Math.hypot(e.position.x - p.x, e.position.z - p.z) < 2.6) {
      e.takeDamage({ source: 'player', target: e.entityId, base: Math.max(1, Math.ceil(e.maxHp / 6)), type: 'physical' });
    }
    if (i % SAMPLE_EVERY === 0) {
      const hp = getPlayerHp();
      const d = e.aiDebug();
      lines.push([
        i, d.state, d.intent, d.moveMode, d.release ? 1 : 0,
        r3(e.position.x), r3(e.position.y), r3(e.position.z), r3(e.group.rotation.y),
        r3(e.hp), r3(d.poise), r3(d.aggression), e.alive ? 1 : 0, e.dying ? 1 : 0, r3(hp0 - hp),
        poseDigest(e.group, scene), `a${adds.filter((a) => a.alive).length}`,
      ].join(' '));
      hp0 = hp;
    }
  }
  return lines;
}

export function traceAll(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of Object.keys(ENEMIES).sort()) out[id] = traceSpec(id);
  return out;
}

export const GOLDEN = new URL('./golden/enemy-trace.txt', import.meta.url);

/** Golden file format: `## <spec id>` then that spec's sample lines. */
export function formatGolden(all: Record<string, string[]>): string {
  return Object.entries(all).map(([id, lines]) => `## ${id}\n${lines.join('\n')}\n`).join('');
}

export function parseGolden(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let cur: string[] | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) out[line.slice(3)] = cur = [];
    else if (line && cur) cur.push(line);
  }
  return out;
}

if (process.argv[1]?.endsWith('enemy-trace.ts') && process.argv.includes('--write')) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(new URL('./golden/', import.meta.url), { recursive: true });
  writeFileSync(GOLDEN, formatGolden(traceAll()));
  console.log('wrote', GOLDEN.pathname);
} else if (process.argv[1]?.endsWith('enemy-trace.ts')) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const id of only.length ? only : Object.keys(ENEMIES).sort()) {
    const t0 = performance.now();
    const lines = traceSpec(id);
    console.log(id, `${Math.round(performance.now() - t0)}ms`, lines[lines.length - 1]);
    if (process.argv.includes('--dump')) for (const l of lines) console.log('  ' + l);
  }
}
