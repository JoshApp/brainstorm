import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { bossMistModel } from '../content/boss-mist';
import { registerInteractable } from './system';
import { engageBoss, registerFogWall } from '../ui/boss-engagement';
import { onBossEncounterComplete } from '../mobs/boss-encounter';
import { setPlayerInvulnerable } from '../player/health';
import { kickShake } from '../combat/screen-shake';
import { playWhoosh } from '../audio/sfx';
import { startFogWalkthrough } from '../player/fog-walkthrough';
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

const DEFAULT_WIDTH = 3.4;     // doorway width the curtain fills
const DEFAULT_HEIGHT = 4.6;    // doorway height the curtain fills
const SEAL_HALF_D = 0.35;      // thickness through the plane
const CROSS_EPSILON = 0.05;    // signed-distance flip threshold
const WALK_THROUGH_DIST = 3.0; // how far past the gate the forced walk ends
const WALK_SECONDS = 1.4;      // duration of the soulslike step-through

export function spawnBossMist(
  scene: THREE.Object3D,
  walkable: WalkableRegion,
  pos: THREE.Vector3,
  rotY: number,
  color: number,
  _bossRoomId: string,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
): void {
  const SEAL_HALF_W = width / 2;   // seal spans the full doorway
  const built = buildModel(bossMistModel(color, SEAL_HALF_W, height));
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  // Grab the translucent curtain materials so we can VISIBLY part the mist on
  // open and re-solidify it on seal — the gate's state has to read at a glance
  // (a silent obstacle that vanishes feels like nothing happened).
  const mistMats: THREE.Material[] = [];
  const baseOpacity = new Map<THREE.Material, number>();
  built.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && (m as THREE.Material).transparent && !baseOpacity.has(m)) {
        baseOpacity.set(m, (m as THREE.Material & { opacity: number }).opacity ?? 1);
        mistMats.push(m);
      }
    }
  });
  function setMistOpen(open: boolean) {
    for (const m of mistMats) {
      const base = baseOpacity.get(m) ?? 0.55;
      (m as THREE.Material & { opacity: number }).opacity = open ? base * 0.3 : base;
    }
  }

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

  // Commit: open the gate, engage the boss, then a soulslike forced walk
  // THROUGH the mist into the arena. Idempotent.
  //
  // Gameplay-critical actions run FIRST (unblock + engage + invuln + the
  // walk) so a cosmetic call throwing can never strand the player in a
  // half-opened gate with a boss that never woke.
  function openGate() {
    if (opened) return;
    opened = true;
    unblock();
    engageBoss();
    // Immortal across the walk + a landing beat — the boss wakes the instant
    // we engage, and we don't want it bombing the player during the cutscene.
    setPlayerInvulnerable(WALK_SECONDS + 1.2);
    // Forced step through the gate: end a few metres INTO the arena, along
    // the threshold normal. Crossing the plane mid-walk re-seals behind us.
    const through = new THREE.Vector3(
      pos.x + normal.x * WALK_THROUGH_DIST,
      0,
      pos.z + normal.z * WALK_THROUGH_DIST,
    );
    startFogWalkthrough(through, WALK_SECONDS);
    // Cosmetic.
    setMistOpen(true);   // the curtain parts — you may pass
    playWhoosh();
    kickShake(0.12, 0.30);
  }

  const id = generateEntityId('boss-mist');
  registerInteractable({
    id,
    position: pos.clone(),
    radius: 2.8,
    promptLabel: 'enter the mist',
    // Explicit interact (tap the gate / press E) is the ONLY way through —
    // a real soulslike commitment, not an auto-open you walk into. The
    // curtain now fully fills the doorway so the tap-raycast reliably hits
    // it (rather than slipping past to the dormant boss behind).
    onUse() { openGate(); },
    tick(_dt: number, playerPos: THREE.Vector3) {
      if (!opened || sealed) return;
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      // Watch for the player crossing to the arena side, then re-seal.
      const d = dx * normal.x + dz * normal.z;
      const sign = d > CROSS_EPSILON ? 1 : d < -CROSS_EPSILON ? -1 : 0;
      if (prevSign === 0) { prevSign = sign; return; }
      if (prevSign < 0 && sign > 0) {
        block();            // crossed in — locked behind you
        sealed = true;
        setMistOpen(false); // curtain re-solidifies — sealed in
        playWhoosh();
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
  onBossEncounterComplete(() => { unblock(); setMistOpen(true); });
}
