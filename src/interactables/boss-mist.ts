import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { bossMistModel } from '../content/boss-mist';
import { registerInteractable } from './system';
import { engageBoss, registerFogWall } from '../ui/boss-engagement';
import { onBossEncounterComplete } from '../mobs/boss-encounter';
import { setPlayerInvulnerable } from '../player/health';
import { kickShake } from '../combat/screen-shake';
import type { WalkableRegion, Obstacle } from '../level/walkable';

// Boss-arena fog gate — soulslike threshold seal you INTERACT with.
//
//   - On build the gate BLOCKS the threshold (an obstacle in the
//     walkable), so you can't wander into the arena — you walk up to it
//     and it prompts you to enter.
//   - Interacting OPENS it (obstacle removed) + engages the boss (bar +
//     intro) + a commit shake. You step through.
//   - The instant you cross to the arena side it RE-SEALS behind you
//     (obstacle back) — locked in with the boss.
//   - When the boss ENCOUNTER completes (every body incl. the split dead —
//     the authoritative signal, not room-clear) the seal lifts so you can
//     leave. The mist panel stays as a "cleared this place" marker.

const SEAL_HALF_W = 1.7;       // half-width of the seal across the doorway
const SEAL_HALF_D = 0.35;      // thickness through the plane
const CROSS_EPSILON = 0.05;    // signed-distance flip threshold

export function spawnBossMist(
  scene: THREE.Object3D,
  walkable: WalkableRegion,
  pos: THREE.Vector3,
  rotY: number,
  color: number,
  _bossRoomId: string,
): void {
  const built = buildModel(bossMistModel(color));
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  // Plane normal pointing INTO the arena. -Z is the entering side, +Z the
  // arena side (rotated by rotY).
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, rotY, 0));

  // The seal obstacle, sized to the threshold (world-axis-aligned bbox;
  // exact rotation doesn't matter at our scale — the WALL reads).
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const halfX = Math.abs(cos) * SEAL_HALF_W + Math.abs(sin) * SEAL_HALF_D;
  const halfZ = Math.abs(sin) * SEAL_HALF_W + Math.abs(cos) * SEAL_HALF_D;
  const obstacle: Obstacle = {
    kind: 'aabb',
    minX: pos.x - halfX, maxX: pos.x + halfX,
    minZ: pos.z - halfZ, maxZ: pos.z + halfZ,
  };
  let blocking = false;
  function block() { if (!blocking) { walkable.addObstacle(obstacle); blocking = true; } }
  function unblock() { if (blocking) { walkable.removeObstacle(obstacle); blocking = false; } }

  block();   // the gate is closed on arrival — you must commit to enter

  let opened = false;
  let sealed = false;
  let prevSign = 0;

  const id = generateEntityId('boss-mist');
  registerInteractable({
    id,
    position: pos.clone(),
    radius: 2.8,
    promptLabel: 'enter the mist',
    onUse() {
      if (opened) return;
      // Commit: open the gate, raise the bar + intro, punctuate it. The
      // boss wakes as you enter (it was dormant), so grant a beat of
      // immortality to step through + orient before it can hurt you.
      opened = true;
      unblock();
      engageBoss();
      setPlayerInvulnerable(2.5);
      kickShake(0.14, 0.32);
    },
    tick(_dt: number, playerPos: THREE.Vector3) {
      if (!opened || sealed) return;
      // Watch for the player crossing to the arena side, then re-seal.
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      const d = dx * normal.x + dz * normal.z;
      const sign = d > CROSS_EPSILON ? 1 : d < -CROSS_EPSILON ? -1 : 0;
      if (prevSign === 0) { prevSign = sign; return; }
      if (prevSign < 0 && sign > 0) {
        block();            // crossed in — locked behind you
        sealed = true;
        kickShake(0.10, 0.25);
      }
      prevSign = sign;
    },
    built,
  });
  registerFogWall();

  // Release when the boss ENCOUNTER is fully done (king + all spawns) —
  // the container is the single source of truth, so the seal can't lift
  // mid-fight when one body dropped but its spawns are still up.
  onBossEncounterComplete(() => { unblock(); });
}
