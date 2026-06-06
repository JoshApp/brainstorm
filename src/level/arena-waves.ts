import * as THREE from 'three';
import type { Enemy } from '../mobs/enemy';
import type { WalkableRegion } from './walkable';
import { spawnSummonTelegraph, type SummonTelegraph } from '../effects/summon-telegraph';
import { gameRng } from '../engine/rng';

/** Stable encounter id for a room's arena gauntlet. The gate and the builder
 *  both derive it from the roomId so they agree without sharing state. */
export function arenaEncounterId(roomId: string): string {
  return `arena:${roomId}`;
}

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

const TELEGRAPH_S = 2.0;   // summon windup before a mob materialises (longer = more read time)
const PRE_DELAY_S = 0.5;   // beat after the slam before the first wave
const LULL_S = 1.1;        // breather between cleared waves
const MIN_SPAWN_DIST = 2.5; // keep summons off the player's face
// Anti-softlock: a wave used to clear ONLY when every spawned mob was
// dead, so one unreachable mob (fell in a carved floor hole, slipped an
// unsealed entrance, wedged behind a prop) froze the gate down forever.
// Now a mob also counts as "resolved" if it has left the arena bounds,
// and a hard timeout force-clears a wave as a last resort.
const ARENA_ESCAPE_MARGIN = 2.0; // m outside the rect = escaped/fell, not fightable
const FIGHT_TIMEOUT_S = 75;      // backstop: a 2–4 mob wave never legitimately takes this long

export function createArenaController(opts: ArenaControllerOpts): ArenaController {
  type Phase = 'idle' | 'lull' | 'telegraph' | 'fighting' | 'done';
  let phase: Phase = 'idle';
  let waveIndex = -1;
  let timer = 0;
  let telegraphs: SummonTelegraph[] = [];
  let pending: Array<{ enemyId: string; pos: THREE.Vector3 }> = [];
  let waveEnemies: Enemy[] = [];
  let fightTimer = 0;   // time the current wave has been in 'fighting'

  // Is a position still inside the arena (with slop)? A mob well outside
  // has escaped/fallen and can't be fought — it must not block the gate.
  function inArena(p: THREE.Vector3): boolean {
    return Math.abs(p.x - opts.rect.x) <= opts.rect.w / 2 + ARENA_ESCAPE_MARGIN
        && Math.abs(p.z - opts.rect.z) <= opts.rect.d / 2 + ARENA_ESCAPE_MARGIN;
  }

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
      opts.onComplete?.();   // resolves the encounter → the gate rises
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
    fightTimer = 0;
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
          fightTimer += dt;
          // Wave clears when every spawned mob is RESOLVED — dead OR escaped
          // the arena bounds (fell in a hole / slipped an entrance), so an
          // unreachable straggler can't freeze the gate. Require >0 spawned
          // so a (bug) empty wave can't instantly "clear". A hard timeout
          // force-clears as a last-resort anti-softlock.
          const allResolved = waveEnemies.every((e) => !e.alive || !inArena(e.position));
          if (waveEnemies.length > 0 && (allResolved || fightTimer >= FIGHT_TIMEOUT_S)) {
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
