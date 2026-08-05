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
// What this deliberately does NOT do yet: openings (a poly room is sealed —
// which is correct for the walk-in test scenario and wrong for a real floor),
// trim, grates, shafts. Those come when the generator replaces the composer;
// building them now would be guessing at an interface that doesn't exist.

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
  root.add(floor);

  // ── CEILING ────────────────────────────────────────────────────────
  // Same outline, flipped so it faces down.
  const ceilGeo = new THREE.ShapeGeometry(shape);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate(0, elev + H, 0);
  const ceiling = new THREE.Mesh(ceilGeo, materials.ceiling);
  ceiling.name = `polyceil:${room.id}`;
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

    const geo = new THREE.BoxGeometry(len + WALL_T, H, WALL_T);
    const mesh = new THREE.Mesh(geo, materials.wall);
    mesh.position.set((a[0] + b[0]) / 2, elev + H / 2, (a[1] + b[1]) / 2);
    // atan2(dz, dx) is the edge's angle in the XZ plane; Three's +Y rotation
    // turns +X toward −Z, hence the negation.
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `polywall:${room.id}:${i}`;
    root.add(mesh);

    // THE thing that makes the room solid. One segment per edge; the movement
    // code already refuses any step that crosses one.
    wallSegmentsOut.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1] });
  }
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
