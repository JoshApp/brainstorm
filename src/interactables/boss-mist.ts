import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { bossMistModel } from '../content/boss-mist';
import { registerInteractable } from './system';
import { engageBoss, registerFogWall } from '../ui/boss-engagement';
import { kickShake } from '../combat/screen-shake';
import type { WalkableRegion, Obstacle } from '../level/walkable';
import { on as onEvent } from '../broadcast/event-bus';

// Boss-arena fog wall — soulslike threshold seal.
//
// On level build:
//   - The visual (a tinted vertical mist panel) is added to the scene.
//   - A cross-trigger interactable is registered with NO promptLabel
//     (it never solicits a press; it just ticks and watches the player).
//   - registerFogWall() flags this level as "fog-walled" so the boss
//     bar knows to wait for the cross trigger before engaging.
//
// On cross:
//   - The signed distance from the player to the plane changes sign
//     (entering side → arena side).
//   - We push an obstacle into the WalkableRegion at the plane's
//     position — the player can no longer walk back through.
//   - engageBoss() fires → boss bar appears, intro card plays.
//   - A modest screen-shake punctuates the moment of commitment.
//
// On boss room cleared:
//   - The room:cleared event fires; we remove the obstacle so the
//     player can leave the arena. The visual stays (a tinted
//     marker for "I cleared this place").

const SEAL_HALF_W = 1.6;       // half-width of the seal obstacle along the plane
const SEAL_HALF_D = 0.30;      // thickness through the plane
const CROSS_EPSILON = 0.05;    // signed-distance flip threshold

export function spawnBossMist(
  scene: THREE.Object3D,
  walkable: WalkableRegion,
  pos: THREE.Vector3,
  rotY: number,
  color: number,
  bossRoomId: string,
): void {
  const built = buildModel(bossMistModel(color));
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  // Plane normal pointing INTO the arena (the side the player must
  // commit to). For rotY=0 the panel faces +/-Z; we choose -Z as
  // the entering side, +Z as the arena side. Rotating rotY rotates
  // the normal with it.
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, rotY, 0));

  // Signed distance from a point P to the plane (point, normal):
  //   d = (P - pos) · normal
  // Sign positive = arena side; sign negative = entering side.
  let prevSign = 0;     // 0 = unknown (first tick latches without firing)
  let sealed = false;
  let obstacle: Obstacle | null = null;

  const id = generateEntityId('boss-mist');

  registerInteractable({
    id,
    position: pos.clone(),
    radius: 3.0,
    promptLabel: '',         // no prompt — passive trigger
    onUse() { /* passive — no interaction */ },
    tick(_dt: number, playerPos: THREE.Vector3) {
      if (sealed) return;
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      const d = dx * normal.x + dz * normal.z;
      const sign = d > CROSS_EPSILON ? 1 : d < -CROSS_EPSILON ? -1 : 0;
      if (prevSign === 0) {
        prevSign = sign;
        return;
      }
      if (prevSign < 0 && sign > 0) {
        // Player just crossed from entering-side to arena-side.
        // Solidify the seal: drop an axis-aligned-bbox obstacle at
        // the plane. Rotation isn't supported on aabb obstacles, so
        // for non-cardinal rotY a tighter bbox aligned to world axes
        // is OK at our scale — the player notices the WALL is there,
        // not its exact orientation.
        const cos = Math.cos(rotY);
        const sin = Math.sin(rotY);
        // Half-extents in world space (after rotation):
        //  along-plane half = SEAL_HALF_W
        //  through-plane half = SEAL_HALF_D
        const halfX = Math.abs(cos) * SEAL_HALF_W + Math.abs(sin) * SEAL_HALF_D;
        const halfZ = Math.abs(sin) * SEAL_HALF_W + Math.abs(cos) * SEAL_HALF_D;
        obstacle = {
          kind: 'aabb',
          minX: pos.x - halfX,
          maxX: pos.x + halfX,
          minZ: pos.z - halfZ,
          maxZ: pos.z + halfZ,
        };
        walkable.addObstacle(obstacle);
        sealed = true;
        engageBoss();
        kickShake(0.12, 0.30);
      }
      prevSign = sign;
    },
    built,
  });
  registerFogWall();

  // Release on boss-room cleared: drop the obstacle so the player
  // can leave. Visual stays as a cleared-marker.
  const off = onEvent((ev) => {
    if (ev.type !== 'room:cleared') return;
    if (ev.roomId !== bossRoomId) return;
    if (obstacle) {
      walkable.removeObstacle(obstacle);
      obstacle = null;
    }
    off();   // one-shot subscription
  });
}
