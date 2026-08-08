import { pointInPoly, type Poly } from './room-shape';

// ── WHERE THE DOOR YOU CAME THROUGH GOES ─────────────────────────────────────
//
// The origin arch is the pair of doors on the wall BEHIND the spawn: at the
// bottom of the last floor's stairwell they stood ajar with firelight through
// the crack (interactables/stairs.ts, "THE DOORS"), you passed through, and they
// shut at your back. It is the one piece of continuity between floors.
//
// Its placement lived inline in builder.ts and cast backward from the spawn to
// the containing room's RECT — the bounding box. That is this codebase's oldest
// bug, for the fifth time: **a polygon room is not its bounding box.** A poly
// room's wall sits back from its box by up to metres on a chamfer or a notch, so
// the doors were mounted at the box edge — past the real wall, floating outside
// the room, or buried in masonry.
//
// Pure, and separate from the builder, so it can be checked against real
// generated floors in a node test rather than by walking to the spawn of every
// seed.

export interface ArchSite {
  /** World position for the arch, ON the room's outline. */
  x: number;
  z: number;
  /** Yaw for a model whose +Z points out of the wall into the room. */
  rotY: number;
  /** How far the arch stands from the spawn. Reported so an audit can tell a
   *  door across the room from one you are standing in. */
  distance: number;
}

export interface ArchRoom {
  rect: { x: number; z: number; w: number; d: number };
  poly?: Poly;
  logicalOnly?: boolean;
}

/** Nothing is mounted closer to the spawn than this — the doors would be in
 *  your face on arrival, and the bonfire in front of you needs the room. */
const MIN_REACH = 0.8;
/** Nor further. Past this the wall behind you is not "behind you", it is the
 *  other side of a hall, and a sealed door there reads as scenery. */
const MAX_REACH = 14;
/** How far past the wall to look for open floor. Closed doors standing beside a
 *  passage that is open would lie about where you came from. */
const PASSAGE_PROBE = 0.7;

/**
 * The wall point directly behind the spawn, on the room's real outline.
 *
 * Walks backward from the spawn along −facing and returns the first crossing of
 * the room's boundary. Sampled rather than solved: the outline is an arbitrary
 * polygon, the step is finer than the wall is thick, and a closed-form segment
 * intersection would need every edge tested and the nearest kept — more code for
 * an answer this cannot use more precisely than a centimetre.
 */
function backWallHit(poly: Poly, sx: number, sz: number, ux: number, uz: number):
{ x: number; z: number; t: number } | null {
  const STEP = 0.05;
  if (!pointInPoly(poly, sx, sz)) return null;
  for (let t = STEP; t <= MAX_REACH; t += STEP) {
    const px = sx + ux * t, pz = sz + uz * t;
    if (pointInPoly(poly, px, pz)) continue;
    // Step back to the last inside point — the boundary is between the two, and
    // the arch wants to sit ON the outline, not a step past it.
    return { x: sx + ux * (t - STEP), z: sz + uz * (t - STEP), t: t - STEP };
  }
  return null;
}

/**
 * The outward normal of the outline at a point on it.
 *
 * Taken from the NEAREST EDGE rather than from the direction we walked in: on a
 * chamfer those differ by up to 45°, and the doors have to be square to the wall
 * they are set in or they read as a decal pasted across the stone. This is the
 * same reason portals carry a normal instead of a cardinal direction.
 */
function outwardNormalAt(poly: Poly, x: number, z: number): [number, number] {
  let best = Infinity, nx = 0, nz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d >= best) continue;
    best = d;
    const L = Math.hypot(dx, dz) || 1;
    // Perpendicular, then oriented outward by testing which side is inside.
    let px = -dz / L, pz = dx / L;
    if (pointInPoly(poly, x + px * 0.05, z + pz * 0.05)) { px = -px; pz = -pz; }
    nx = px; nz = pz;
  }
  return [nx, nz];
}

/**
 * Where to stand the origin arch, or null when this floor should not have one.
 *
 * Null is a real answer and the caller must honour it: a floor whose spawn wall
 * is a doorway gets NO sealed doors, because a barred way-you-came standing next
 * to an open passage is a worse lie than no marker at all.
 */
export function originArchSite(
  startPos: { x: number; z: number; yaw?: number },
  rooms: ReadonlyArray<ArchRoom>,
  corridors: ReadonlyArray<{ rect: { x: number; z: number; w: number; d: number } }> = [],
): ArchSite | null {
  const yaw = startPos.yaw ?? 0;
  // Facing is (−sin, −cos); "behind" is the opposite of that.
  const ux = Math.sin(yaw), uz = Math.cos(yaw);
  const sx = startPos.x, sz = startPos.z;

  // The room the player is actually standing in. Polygon first — the box test is
  // the fallback for rect-era rooms, which have no outline to ask.
  const room = rooms.find((r) => !r.logicalOnly && r.poly && r.poly.length >= 3
    && pointInPoly(r.poly, sx, sz))
    ?? rooms.find((r) => !r.logicalOnly
      && Math.abs(sx - r.rect.x) <= r.rect.w / 2 && Math.abs(sz - r.rect.z) <= r.rect.d / 2);
  if (!room) return null;

  let hit: { x: number; z: number; t: number } | null;
  let normal: [number, number];
  if (room.poly && room.poly.length >= 3) {
    hit = backWallHit(room.poly, sx, sz, ux, uz);
    if (!hit) return null;
    normal = outwardNormalAt(room.poly, hit.x, hit.z);
  } else {
    // Rect room: the wall IS the box, and the normal is the cardinal face it
    // crossed. Unchanged from the original arithmetic, so vault floors get
    // exactly the arch they had.
    const hw = room.rect.w / 2, hd = room.rect.d / 2;
    const tx = ux > 1e-6 ? (room.rect.x + hw - sx) / ux
      : ux < -1e-6 ? (room.rect.x - hw - sx) / ux : Infinity;
    const tz = uz > 1e-6 ? (room.rect.z + hd - sz) / uz
      : uz < -1e-6 ? (room.rect.z - hd - sz) / uz : Infinity;
    const t = Math.min(tx, tz);
    if (!isFinite(t)) return null;
    hit = { x: sx + ux * t, z: sz + uz * t, t };
    normal = tx < tz ? [Math.sign(ux), 0] : [0, Math.sign(uz)];
  }

  if (hit.t < MIN_REACH || hit.t > MAX_REACH) return null;

  // A PASSAGE JUST BEYOND MEANS THIS IS NOT A WALL. Probed along the wall's own
  // normal rather than along the walk direction — on a chamfer the two differ,
  // and probing the wrong way is how you end up bolting doors across a doorway.
  const px = hit.x + normal[0] * PASSAGE_PROBE;
  const pz = hit.z + normal[1] * PASSAGE_PROBE;
  const open = corridors.some((c) =>
    Math.abs(px - c.rect.x) <= c.rect.w / 2 && Math.abs(pz - c.rect.z) <= c.rect.d / 2)
    || rooms.some((r) => r !== room && !r.logicalOnly && (r.poly && r.poly.length >= 3
      ? pointInPoly(r.poly, px, pz)
      : Math.abs(px - r.rect.x) <= r.rect.w / 2 && Math.abs(pz - r.rect.z) <= r.rect.d / 2));
  if (open) return null;

  // The model is authored with +Z out of the wall toward the room, so the yaw
  // that points +Z along the INWARD normal is atan2 of its negation.
  return {
    x: hit.x, z: hit.z,
    rotY: Math.atan2(-normal[0], -normal[1]),
    distance: hit.t,
  };
}
