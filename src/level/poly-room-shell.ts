import * as THREE from 'three';
import type { RoomSpec } from './types';
import type { WallSegment } from './walkable';
import type { StyleMaterials } from '../style/materials';
import { groundYAt } from './elevation';
import { polyBounds, type Poly } from './room-shape';

// ── BUILDING A POLYGON ROOM ──────────────────────────────────────────────────
//
// The first place room-shape.ts's polygons become geometry you can stand in.
//
// Deliberately a SEPARATE function from `buildRoomShell`, not surgery inside it.
// That one is ~400 lines of rect-derived special cases — floor grates, ceiling
// shafts, skirting and cornice trim, braced variants, ramp handling — every one
// of which assumes four axis-aligned sides. Branching inside it would put the
// new path at risk from all of that and vice versa. This is additive: a room
// with `poly` set comes here, everything else takes the old road, and nothing
// legacy had to be touched to try the new thing.
//
// OPENINGS. Each edge is clipped against the corridor rects that cross it, and
// the covered spans become doorways. That's the rect path's `subtractRanges`
// idea moved into EDGE-LOCAL 1D coordinates, which is what makes it work on a
// diagonal wall as readily as an axis-aligned one.
//
// What this deliberately does NOT do yet: trim, grates, shafts, torch mounting
// against arbitrary edges. Those come with the generator.

/** Wall thickness in metres — matches the visual weight of the rect shell. */
const WALL_T = 0.25;

/**
 * Build floor, walls and ceiling for a polygon room.
 *
 * Emits one `WallSegment` per polygon edge. That is what actually contains the
 * player: `walkable.ts` rejects any move whose path crosses a wall segment
 * (segmentsIntersect), so an arbitrary-angle wall blocks exactly like an
 * axis-aligned one with no extra work. The room's `rect` stays as the permissive
 * bounding box for everything else that reads it.
 */
export function buildPolyRoomShell(
  root: THREE.Object3D,
  room: RoomSpec & { poly: Poly },
  materials: StyleMaterials,
  wallSegmentsOut: WallSegment[],
  /** Rects that should CUT this room's walls — the corridors meeting it. Each
   *  span where a rect crosses an edge becomes a doorway. */
  openingRects: ReadonlyArray<{ x: number; z: number; w: number; d: number }> = [],
): void {
  const poly = room.poly;
  if (poly.length < 3) return;
  const H = room.height;
  const elev = room.elevation ?? groundYAt(room.rect.x, room.rect.z);

  // ── FLOOR ──────────────────────────────────────────────────────────
  // A THREE.Shape triangulated by ShapeGeometry. The shape is authored in
  // (x, y) and then rotated −π/2 about X, which maps local +y to world −z;
  // feeding z directly would mirror the room. Negating here keeps the built
  // floor identical to the polygon the generator and the SVG sheet describe.
  const shape = new THREE.Shape();
  shape.moveTo(poly[0][0], -poly[0][1]);
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], -poly[i][1]);
  shape.closePath();

  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, elev, 0);
  const floor = new THREE.Mesh(floorGeo, materials.floor);
  floor.receiveShadow = true;
  floor.name = `polyfloor:${room.id}`;
  // Opt this floor into the wall-contact AO post-pass, which finds its subjects
  // by userData.aoRect. Without it a polygon room is the one floor in the level
  // with no darkening where it meets its walls — and the seam reads instantly.
  floor.userData.aoRect = { x: room.rect.x, z: room.rect.z, w: room.rect.w, d: room.rect.d };
  floor.userData.dbgKind = 'floor';
  floor.userData.dbgSource = `polyfloor · ${room.id}`;
  root.add(floor);

  // ── CEILING ────────────────────────────────────────────────────────
  // Same outline, flipped so it faces down.
  const ceilGeo = new THREE.ShapeGeometry(shape);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate(0, elev + H, 0);
  const ceiling = new THREE.Mesh(ceilGeo, materials.ceiling);
  ceiling.name = `polyceil:${room.id}`;
  ceiling.userData.dbgKind = 'ceiling';
  ceiling.userData.dbgSource = `polyceil · ${room.id}`;
  root.add(ceiling);

  // ── WALLS ──────────────────────────────────────────────────────────
  // One slab per edge, rotated to the edge's angle. A box is the right
  // primitive even for a diagonal: the chamfered corners leave a small notch
  // between neighbouring slabs, which at 0.25m thickness reads as a masonry
  // joint rather than a gap.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;

    // Everything the corridors cut out of this edge, then what's left of it.
    const gaps = openingRects
      .map((r) => clipEdgeToRect(a, b, r))
      .filter((g): g is [number, number] => g !== null);
    const spans = subtractSpans(gaps);
    const yaw = -Math.atan2(dz, dx);

    for (const [t0, t1] of spans) {
      const segLen = (t1 - t0) * len;
      if (segLen < 0.12) continue;             // slivers beside a doorway
      const sx = a[0] + dx * t0, sz = a[1] + dz * t0;
      const ex = a[0] + dx * t1, ez = a[1] + dz * t1;

      // Only the ENDS of a run get the corner overlap. A slab beside a doorway
      // must stop at the doorway, or the overlap closes the gap it just cut.
      const padS = t0 <= 1e-6 ? WALL_T / 2 : 0;
      const padE = t1 >= 1 - 1e-6 ? WALL_T / 2 : 0;
      const geo = new THREE.BoxGeometry(segLen + padS + padE, H, WALL_T);
      const mesh = new THREE.Mesh(geo, materials.wall);
      mesh.position.set(
        (sx + ex) / 2 + (dx / len) * (padE - padS) / 2,
        elev + H / 2,
        (sz + ez) / 2 + (dz / len) * (padE - padS) / 2,
      );
      // atan2(dz, dx) is the edge's angle in the XZ plane; Three's +Y rotation
      // turns +X toward −Z, hence the negation.
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `polywall:${room.id}:${i}`;
      mesh.userData.dbgKind = 'wall';
      mesh.userData.dbgSource = `polywall · ${room.id}`;
      root.add(mesh);

      // THE thing that makes the room solid — and the thing that makes a doorway
      // real, since a span with no segment is a span the player can cross. The
      // movement code already refuses any step that crosses a segment.
      wallSegmentsOut.push({ ax: sx, az: sz, bx: ex, bz: ez });
    }
  }
}

/**
 * Where does the axis-aligned rect `r` cover the edge a→b? Returns the covered
 * span as [t0, t1] in edge-local 0..1, or null if it never touches.
 *
 * Liang–Barsky slab clipping, which handles a diagonal edge as naturally as an
 * axis-aligned one — the entire reason openings work on a polygon at all.
 * The rect is inflated by half the wall thickness so a corridor that stops
 * exactly on the wall plane still cuts through it rather than kissing it.
 */
function clipEdgeToRect(
  a: readonly [number, number], b: readonly [number, number],
  r: { x: number; z: number; w: number; d: number },
): [number, number] | null {
  const pad = WALL_T;
  const minX = r.x - r.w / 2 - pad, maxX = r.x + r.w / 2 + pad;
  const minZ = r.z - r.d / 2 - pad, maxZ = r.z + r.d / 2 + pad;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;      // parallel: inside iff q >= 0
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!clip(-dx, a[0] - minX)) return null;
  if (!clip(dx, maxX - a[0])) return null;
  if (!clip(-dz, a[1] - minZ)) return null;
  if (!clip(dz, maxZ - a[1])) return null;
  return t1 > t0 ? [t0, t1] : null;
}

/** The parts of 0..1 NOT covered by any of `gaps`. */
function subtractSpans(gaps: Array<[number, number]>): Array<[number, number]> {
  if (!gaps.length) return [[0, 1]];
  const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (const [g0, g1] of sorted) {
    if (g0 > cursor) out.push([cursor, Math.min(1, g0)]);
    cursor = Math.max(cursor, g1);
    if (cursor >= 1) break;
  }
  if (cursor < 1) out.push([cursor, 1]);
  return out.filter(([p, q]) => q - p > 1e-6);
}

/** The bounding rect a polygon room should advertise, so everything that still
 *  thinks in rects (elevation, nav bbox, the walkable union) keeps working. */
export function polyRoomRect(poly: Poly): { x: number; z: number; w: number; d: number } {
  const b = polyBounds(poly);
  return {
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    w: b.maxX - b.minX,
    d: b.maxZ - b.minZ,
  };
}
