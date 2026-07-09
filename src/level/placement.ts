// Geometry-aware content PLACEMENT (docs/BUILD-ECONOMY.md). The cell grid places
// STRUCTURE; this pass derives a content prop's final position + rotation from its
// ROOM's continuous geometry — center, walls, and the entrance direction — so
// nothing reads as snapped-to-a-cell or facing the wrong way. Authors mark intent
// (an anchor, an event); this computes the transform.
//
// The room's `placeDir` is the way the player heads IN, so they ENTER from the
// −placeDir edge. STAIR_ROTY[dir] faces +placeDir (deeper in); the entrance is the
// opposite, so a prop that should face the arriving player uses that + π.

import type { PropSpec } from './types';

/** Cardinal direction (matches vault-compose's local Dir). */
export type Dir = 'N' | 'S' | 'E' | 'W';

/** A room as a continuous box: centre + extent + which way the player entered. */
export interface RoomBox {
  cx: number; cz: number;   // centre (world)
  w: number; d: number;     // X / Z extent
  placeDir?: Dir;           // descent direction into this room (entrance = −placeDir)
}

// rotY per direction — a prop at this rotY faces +dir (matches vault-compose STAIR_ROTY).
const DIR_ROTY: Record<Dir, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

/** rotY that faces the ENTRANCE (−placeDir) — i.e. faces the player as they walk
 *  in. null when the room has no descent direction (the start room). */
export function faceEntranceRotY(placeDir: Dir | undefined): number | null {
  if (!placeDir) return null;
  return DIR_ROTY[placeDir] + Math.PI;   // +π = face −placeDir instead of +placeDir
}

/** The room a world point sits in (first box that contains it), or null. */
export function roomFor(x: number, z: number, rooms: readonly RoomBox[]): RoomBox | null {
  for (const r of rooms) {
    if (Math.abs(x - r.cx) <= r.w / 2 && Math.abs(z - r.cz) <= r.d / 2) return r;
  }
  return null;
}

/** Metres from a point to the nearest of the room's four walls. Small = the prop
 *  is wall-anchored (keep its wall-facing); large = it's out in the open (central). */
function nearestWallDist(x: number, z: number, r: RoomBox): number {
  return Math.min(
    Math.abs((r.cx - r.w / 2) - x), Math.abs((r.cx + r.w / 2) - x),
    Math.abs((r.cz - r.d / 2) - z), Math.abs((r.cz + r.d / 2) - z),
  );
}

// A prop closer than this to a wall is treated as wall-anchored (its facing is
// dictated by the wall); further out, it's central and should face the entrance.
const WALL_ANCHORED_DIST = 1.3;

/** Resolve each content prop's transform from its room geometry. Mutates props in
 *  place. Run AFTER the loot director (so it sees the chests it placed). */
export function resolvePlacement(props: PropSpec[], rooms: readonly RoomBox[]): void {
  for (const p of props) {
    if (p.kind !== 'chest') continue;   // chests first; corpses/events extend this
    const room = roomFor(p.x, p.z, rooms);
    if (!room) continue;
    // A CENTRAL chest (out in the open) turns to face the arriving player; a
    // wall-anchored one keeps its authored facing (its back is already to a wall).
    if (nearestWallDist(p.x, p.z, room) >= WALL_ANCHORED_DIST) {
      const rot = faceEntranceRotY(room.placeDir);
      if (rot !== null) { p.rotY = rot; p.facing = undefined; }
    }
  }
}
