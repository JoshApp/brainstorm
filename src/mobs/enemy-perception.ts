// Can this enemy see the player right now?
//
// Sight cone + range, hearing radius, a short peripheral radius, and line of
// sight through walls (not obstacles: a pillar doesn't block sight, it blocks
// movement). Called by the brain every frame.
//
// A subsystem of createEnemy over EnemyCtx (mobs/enemy-ctx.ts).

import { type WalkableRegion } from '../level/walkable';
import { isArrivalGrace } from '../player/arrival';
import type { EnemyCtx } from './enemy-ctx';
import * as THREE from 'three';

// Perception check. Returns true if the enemy can detect the player
// right now, via either:
//   - Hearing (proximity inside hearingRange, ignores cone + LOS)
//   - Sight (inside sightRange, inside cone, AND clear LOS to player)
// Hearing wins ties — close enough always trips, regardless of facing.
export function canSeePlayer(self: EnemyCtx, playerPos: THREE.Vector3, walkable: WalkableRegion): boolean {
  // THE THRESHOLD (player/arrival.ts): someone who just came down the stairs
  // and hasn't moved yet is not here as far as the dungeon is concerned.
  // Gating SIGHT rather than only damage is the half that matters — a pack
  // that aggros while you're still finding your thumbs is already mid-charge
  // by the time you can answer it.
  if (isArrivalGrace()) return false;
  const dx = playerPos.x - self.container.position.x;
  const dz = playerPos.z - self.container.position.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < self.hearingRangeSq) return true;
  // Peripheral sight: within peripheralRange, a clear line of sight is enough
  // — no cone. (Long-range detection past peripheralRange still needs the cone
  // below, so a distant player outside the gaze stays unseen — stealth holds.)
  if (distSq < self.peripheralRangeSq) {
    return walkable.hasLineOfSight(
      self.container.position.x, self.container.position.z, playerPos.x, playerPos.z,
    );
  }
  if (distSq > self.sightRangeSq) return false;
  // Cone check (uses current container yaw — the enemy's facing).
  // Container facing: container's "forward" is -Z in local space (per
  // the lookAt convention we set in faceTarget). Convert to world.
  const dist = Math.sqrt(distSq);
  const ndx = dx / dist;
  const ndz = dz / dist;
  const forwardX = -Math.sin(self.container.rotation.y);
  const forwardZ = -Math.cos(self.container.rotation.y);
  const dot = forwardX * ndx + forwardZ * ndz;
  if (dot < self.sightConeCos) return false;
  // LOS — straight line, blocked by walls only (not pillars/altar).
  return walkable.hasLineOfSight(
    self.container.position.x, self.container.position.z,
    playerPos.x, playerPos.z,
  );
}
