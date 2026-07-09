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

/** The point on the −placeDir edge — the doorway the player comes through. null
 *  for the start room. */
export function entrancePoint(r: RoomBox): { x: number; z: number } | null {
  if (!r.placeDir) return null;
  const hw = r.w / 2, hd = r.d / 2;
  switch (r.placeDir) {
    case 'S': return { x: r.cx, z: r.cz - hd };   // player entered from the N edge
    case 'N': return { x: r.cx, z: r.cz + hd };
    case 'E': return { x: r.cx - hw, z: r.cz };
    case 'W': return { x: r.cx + hw, z: r.cz };
  }
}

/** rotY that aims a prop's FRONT (local +Z) at a target point — the CONE picks the
 *  direction (a prop off to the side leans toward the entrance), then we SNAP to
 *  the nearest 90° so furniture stays grid-aligned (no chest sitting at a jaunty
 *  diagonal). Three's Y-rotation sends local +Z → world (sinθ, cosθ). */
export function facePointRotY(px: number, pz: number, tx: number, tz: number): number {
  const raw = Math.atan2(tx - px, tz - pz);
  return Math.round(raw / (Math.PI / 2)) * (Math.PI / 2);   // snap to 0 / 90 / 180 / 270
}

/** The room a world point sits in (first box that contains it), or null. */
export function roomFor(x: number, z: number, rooms: readonly RoomBox[]): RoomBox | null {
  for (const r of rooms) {
    if (Math.abs(x - r.cx) <= r.w / 2 && Math.abs(z - r.cz) <= r.d / 2) return r;
  }
  return null;
}

/** Distances from a point to each of the room's four walls (W, E, N, S). */
function wallDists(x: number, z: number, r: RoomBox): { w: number; e: number; n: number; s: number } {
  return {
    w: Math.abs((r.cx - r.w / 2) - x), e: Math.abs((r.cx + r.w / 2) - x),
    n: Math.abs((r.cz - r.d / 2) - z), s: Math.abs((r.cz + r.d / 2) - z),
  };
}

/** Metres to the nearest wall. Small = wall-anchored, large = out in the open. */
function nearestWallDist(x: number, z: number, r: RoomBox): number {
  const d = wallDists(x, z, r);
  return Math.min(d.w, d.e, d.n, d.s);
}

/** Outward unit vector toward the nearest wall (the direction the wall lies). */
function nearestWallOutward(x: number, z: number, r: RoomBox): [number, number] {
  const d = wallDists(x, z, r);
  const m = Math.min(d.w, d.e, d.n, d.s);
  if (m === d.w) return [-1, 0];
  if (m === d.e) return [1, 0];
  if (m === d.n) return [0, -1];
  return [0, 1];
}

/** rotY that points a model's LOCAL −X axis at the nearest wall. The slumped
 *  corpse is authored with its back at −X (corpse-model.ts), so this seats its
 *  back against the actual wall. Derived from Three's Y-rotation: local −X →
 *  world (−cosθ, sinθ), so θ = atan2(outZ, −outX). */
function backToWallRotY(x: number, z: number, r: RoomBox): number {
  const [ox, oz] = nearestWallOutward(x, z, r);
  return Math.atan2(oz, -ox);
}

// A prop closer than this to a wall is treated as wall-anchored (its facing is
// dictated by the wall); further out, it's central and should face the entrance.
const WALL_ANCHORED_DIST = 1.3;
// A prop within this of the room centre is a would-be CENTREPIECE that landed a
// half-cell off (even-width rooms can't hit centre with a cell) — snap it true.
const CENTER_SNAP_DIST = 1.2;

/** STATICS pass — settle AUTHORED centrepiece props (pillar/altar/fountain) to the
 *  room's true centre. Run BEFORE the director, so it places chests around their
 *  FINAL positions (a centre-snapped altar can't then land on a chest). */
export function resolveStatics(props: PropSpec[], rooms: readonly RoomBox[]): void {
  for (const p of props) {
    if (p.kind !== 'pillar' && p.kind !== 'altar' && p.kind !== 'fountain') continue;
    const room = roomFor(p.x, p.z, rooms);
    if (!room) continue;
    if (Math.hypot(p.x - room.cx, p.z - room.cz) <= CENTER_SNAP_DIST) {
      p.x = room.cx; p.z = room.cz;
    }
  }
}

/** CONTENT pass — orient the director's pieces. Run AFTER the director. */
export function resolveContent(props: PropSpec[], rooms: readonly RoomBox[]): void {
  for (const p of props) {
    // CHESTS — a central one turns to face the arriving player (the entrance-point
    // CONE); a wall-anchored one keeps its facing (its back is already to a wall).
    if (p.kind === 'chest') {
      const room = roomFor(p.x, p.z, rooms);
      if (!room) continue;
      if (nearestWallDist(p.x, p.z, room) >= WALL_ANCHORED_DIST) {
        const ep = entrancePoint(room);
        if (ep) { p.rotY = facePointRotY(p.x, p.z, ep.x, ep.z); p.facing = undefined; }
      }
    }
    // SLUMPED CORPSE — seat its (−X) back against the nearest wall.
    else if (p.kind === 'corpse' && p.pose === 'slumped') {
      const room = roomFor(p.x, p.z, rooms);
      if (!room) continue;
      p.rotY = backToWallRotY(p.x, p.z, room);
      p.facing = undefined;
    }
  }
}

/** Combined convenience (statics then content) — used by the placement tests. */
export function resolvePlacement(props: PropSpec[], rooms: readonly RoomBox[]): void {
  resolveStatics(props, rooms);
  resolveContent(props, rooms);
}
