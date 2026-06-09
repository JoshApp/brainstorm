import * as THREE from 'three';
import { CONFIG } from '../config';

// Pack coordinator — makes a crowd of chasing mobs behave as a SURROUNDING ring
// instead of a pile on the player's exact point. Two forces, computed once per
// frame for the whole crowd (the one place that sees every mob at once):
//
//   1. ENCIRCLEMENT — each chaser's goal is a point at its own strike distance
//      along ITS bearing to the player, so mobs fan out around you by the angle
//      they approached from instead of all converging on one spot.
//   2. SEPARATION — chasers within SEPARATION_RADIUS push apart, so they never
//      stack (the "dumb blob" look) and a group reads as a group.
//
// Mobs register once (on spawn) with live accessors and leave on death; the
// member's `active()` gate decides who's actually in the fight this frame (so
// idle/searching/returning mobs aren't dragged into the ring). enemy.ts reads
// packMoveTarget(id, player) as its chase goal during 'chasing'.
//
// Module-level state (the codebase's pattern). The player is a single point;
// keyed per enemy id. If co-op ever lands, key the crowd by target too.
//
// Phase 2 (tokens) will layer on top: only N members may COMMIT to an attack at
// once; the rest hold the ring and circle. The hooks (active members, who's in
// band) live here so that lands without touching enemy.ts movement again.

interface Member {
  id: string;
  pos: THREE.Vector3;          // LIVE ref to the mob's world position (container.position)
  reach: number;               // ring radius for this mob (≈ its strike range)
  active: () => boolean;       // in the fight this frame (chasing/attacking)?
  sepX: number; sepZ: number;  // separation push computed each tick
}

const members = new Map<string, Member>();

const { RING_RADIUS_BONUS, SEPARATION_RADIUS, SEPARATION_FORCE } = CONFIG.ENEMY_AI.PACK;
const SEP_RADIUS_SQ = SEPARATION_RADIUS * SEPARATION_RADIUS;

/** Register a mob with the pack (call once on spawn). `pos` is held by
 *  reference — the coordinator reads the mob's live world position each frame.
 *  `reach` is the ring radius (the mob's strike range). `active` gates whether
 *  the mob is in the fight this frame. */
export function joinPack(id: string, pos: THREE.Vector3, reach: number, active: () => boolean): void {
  members.set(id, { id, pos, reach, active, sepX: 0, sepZ: 0 });
}

/** Drop a mob from the pack (call on death / level teardown). */
export function leavePack(id: string): void {
  members.delete(id);
}

/** Recompute separation for every active member. Call ONCE per frame, before
 *  the enemy update loop. Cheap: O(n²) over active chasers, which is a handful. */
export function tickPack(): void {
  // Snapshot the active members once (active() may be a closure over AI state).
  const active: Member[] = [];
  for (const m of members.values()) {
    m.sepX = 0; m.sepZ = 0;
    if (m.active()) active.push(m);
  }
  const n = active.length;
  if (n < 2) return;
  // Pairwise separation: each pair within SEPARATION_RADIUS pushes apart,
  // weighted by how far INSIDE the radius they are (closer = stronger).
  for (let i = 0; i < n; i++) {
    const a = active[i];
    for (let j = i + 1; j < n; j++) {
      const b = active[j];
      const dx = a.pos.x - b.pos.x;
      const dz = a.pos.z - b.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= SEP_RADIUS_SQ || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      // Overlap fraction 0..1 → push magnitude.
      const push = (1 - d / SEPARATION_RADIUS) * SEPARATION_FORCE;
      const ux = dx / d, uz = dz / d;
      a.sepX += ux * push; a.sepZ += uz * push;
      b.sepX -= ux * push; b.sepZ -= uz * push;
    }
  }
}

const tmp = new THREE.Vector3();

/** The world point a chasing mob should move toward: a slot on the ring at its
 *  strike distance along its own bearing to the player, plus its separation
 *  push. Returns null if the mob isn't registered (caller falls back to the
 *  player's position). Writes into `out` and returns it. */
export function packMoveTarget(id: string, player: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  const m = members.get(id);
  if (!m) return null;
  // Bearing from the player to the mob (its approach angle); ring point sits at
  // `reach` out along that bearing. If the mob is right on top of the player,
  // fall back to its separation direction so it still fans out.
  let bx = m.pos.x - player.x;
  let bz = m.pos.z - player.z;
  let bl = Math.hypot(bx, bz);
  if (bl < 1e-3) { bx = m.sepX; bz = m.sepZ; bl = Math.hypot(bx, bz) || 1; }
  const ring = m.reach + RING_RADIUS_BONUS;
  out.set(
    player.x + (bx / bl) * ring + m.sepX,
    m.pos.y,
    player.z + (bz / bl) * ring + m.sepZ,
  );
  return out;
}

/** The separation-only push for a mob (for states that shouldn't ring up but
 *  still mustn't overlap — e.g. a kiter holding range). Writes into `out`. */
export function packSeparation(id: string, out: THREE.Vector3): THREE.Vector3 {
  const m = members.get(id);
  if (m) out.set(m.sepX, 0, m.sepZ); else out.set(0, 0, 0);
  return out;
}

/** Reusable scratch the caller can borrow for packMoveTarget/packSeparation. */
export function packScratch(): THREE.Vector3 { return tmp; }

/** Clear the whole pack (level teardown). */
export function clearPack(): void { members.clear(); }
