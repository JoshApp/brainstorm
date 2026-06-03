import * as THREE from 'three';
import type { Enemy } from '../mobs/enemy';
import type { WalkableRegion } from './walkable';
import { spawnSummonTelegraph, type SummonTelegraph } from '../effects/summon-telegraph';
import { markArenaComplete } from './arena-state';
import { gameRng } from '../engine/rng';

// Arena wave controller — the engine behind both arena kinds (the trap gate
// and, later, the challenge offering). On start() it runs a sequence of
// waves: each wave TELEGRAPHS its spawns (a summon sigil + smoke boils up at
// each point for ~1.2s — the "something's coming HERE" tell), then drops the
// mobs through the smoke. The next wave only telegraphs once the current one
// is dead. When the last wave is cleared it marks the arena complete, which is
// what lets the gate finally rise. Standalone (no enemy-ability coupling) so
// it doesn't collide with the boss/phase work.

export interface WaveSpec {
  spawns: Array<{ enemyId: string; count: number }>;
}

export interface ArenaControllerOpts {
  roomId: string;
  scene: THREE.Object3D;
  /** Arena room footprint — spawn points are scattered inside it. */
  rect: { x: number; z: number; w: number; d: number };
  waves: WaveSpec[];
  /** Drop a live mob at a world point; returns the Enemy (or null if the
   *  spec id is unknown). Builder supplies this, closing over spawnInto. */
  spawn: (enemyId: string, pos: THREE.Vector3) => Enemy | null;
  walkable: WalkableRegion;
  /** Tint for the summon sigil (match the room's torch mood). */
  tint?: number;
  /** Fired once when the final wave is cleared (e.g. shatter the chains on a
   *  challenge offering, fire a broadcast pop). */
  onComplete?: () => void;
}

export interface ArenaController {
  start(): void;
  tick(dt: number, playerPos: THREE.Vector3): void;
  isComplete(): boolean;
}

const TELEGRAPH_S = 1.2;   // summon windup before a mob materialises
const PRE_DELAY_S = 0.5;   // beat after the slam before the first wave
const LULL_S = 1.1;        // breather between cleared waves
const MIN_SPAWN_DIST = 2.5; // keep summons off the player's face

export function createArenaController(opts: ArenaControllerOpts): ArenaController {
  type Phase = 'idle' | 'lull' | 'telegraph' | 'fighting' | 'done';
  let phase: Phase = 'idle';
  let waveIndex = -1;
  let timer = 0;
  let telegraphs: SummonTelegraph[] = [];
  let pending: Array<{ enemyId: string; pos: THREE.Vector3 }> = [];
  let waveEnemies: Enemy[] = [];

  function pickSpawnPoint(playerPos: THREE.Vector3): THREE.Vector3 {
    const hw = opts.rect.w / 2 - 0.8;
    const hd = opts.rect.d / 2 - 0.8;
    let best = new THREE.Vector3(opts.rect.x, 0, opts.rect.z);
    for (let tries = 0; tries < 12; tries++) {
      const x = opts.rect.x + (gameRng() * 2 - 1) * hw;
      const z = opts.rect.z + (gameRng() * 2 - 1) * hd;
      if (!opts.walkable.contains(x, z, 0.4)) continue;
      const dx = x - playerPos.x;
      const dz = z - playerPos.z;
      if (dx * dx + dz * dz < MIN_SPAWN_DIST * MIN_SPAWN_DIST) continue;
      const r = opts.walkable.resolveSpawn(x, z, 0.4);
      return new THREE.Vector3(r.x, 0, r.z);
    }
    // Fallback: room centre, nudged onto walkable.
    const r = opts.walkable.resolveSpawn(best.x, best.z, 0.4);
    best.set(r.x, 0, r.z);
    return best;
  }

  function beginWave(playerPos: THREE.Vector3) {
    waveIndex++;
    if (waveIndex >= opts.waves.length) {
      phase = 'done';
      markArenaComplete(opts.roomId);
      opts.onComplete?.();
      return;
    }
    pending = [];
    telegraphs = [];
    const wave = opts.waves[waveIndex];
    for (const grp of wave.spawns) {
      for (let i = 0; i < grp.count; i++) {
        const pos = pickSpawnPoint(playerPos);
        pending.push({ enemyId: grp.enemyId, pos });
        telegraphs.push(spawnSummonTelegraph(opts.scene, pos.x, pos.z, opts.tint ?? 0xc01818));
      }
    }
    phase = 'telegraph';
    timer = 0;
  }

  function materialise() {
    waveEnemies = [];
    for (let i = 0; i < pending.length; i++) {
      telegraphs[i]?.burst();
      const e = opts.spawn(pending[i].enemyId, pending[i].pos);
      if (e) waveEnemies.push(e);
    }
    for (const t of telegraphs) t.dispose();
    telegraphs = [];
    pending = [];
    phase = 'fighting';
  }

  return {
    start() {
      if (phase !== 'idle') return;
      phase = 'lull';
      timer = PRE_DELAY_S;
      waveIndex = -1;
    },
    tick(dt: number, playerPos: THREE.Vector3) {
      switch (phase) {
        case 'lull': {
          timer -= dt;
          if (timer <= 0) beginWave(playerPos);
          break;
        }
        case 'telegraph': {
          timer += dt;
          const t = Math.min(1, timer / TELEGRAPH_S);
          for (const tg of telegraphs) tg.setProgress(t);
          if (timer >= TELEGRAPH_S) materialise();
          break;
        }
        case 'fighting': {
          // Wave clears when every mob it spawned is dead. Require >0 spawned
          // so a (bug) empty wave can't instantly "clear" and blow through the
          // whole gauntlet in a few frames — that would recreate the very
          // gate-reopens-immediately bug this system exists to fix.
          if (waveEnemies.length > 0 && waveEnemies.every((e) => !e.alive)) {
            phase = 'lull';
            timer = LULL_S;
          }
          break;
        }
        default:
          break;
      }
    },
    isComplete() {
      return phase === 'done';
    },
  };
}
