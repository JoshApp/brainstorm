// ── WHAT IS ALREADY THERE ────────────────────────────────────────────────────
//
// The third registry from docs/ROOM-COMPOSITION.md, and the one that makes
// "don't put things inside each other" a property rather than a hope.
//
// The reason it has to be 3D. A 2D footprint says an altar and a chandelier
// overlap when they don't — one is on the floor and the other is hanging — and
// says a floor-to-ceiling pier and a low bench DON'T overlap when they very much
// do. Every "that prop is inside that column" bug is the vertical extent being
// dropped. Rooms are ~10m across and hold a few dozen things, so an exact test
// against a list is cheap and a spatial index would be premature.
//
// The reason it has to be shared. The builder already has five REPAIR passes —
// nudgePropsOutOfPassages, clearChestsBlockingCorridors, rescueOneBlocker,
// ensureStairsReachable, elbow-room — which is one bug five times: placement is
// blind and the damage is fixed afterwards. A producer that asks `fits()` before
// it commits does not generate damage to repair.
//
// Pure and Three-free: a reservation is arithmetic, and every producer should be
// able to make one at compose time, long before any geometry exists.

export type Volume =
  | {
      kind: 'cylinder';
      x: number; z: number; r: number;
      /** Vertical extent in world Y — floor and ceiling of the thing itself. */
      y0: number; y1: number;
    }
  | {
      kind: 'box';
      x: number; z: number;
      halfW: number; halfD: number;
      /** Rotation about Y. A pier on a diagonal wall is a rotated box, and
       *  treating it as axis-aligned would reserve up to 40% more floor than it
       *  occupies — which reads as the room mysteriously refusing placements. */
      rotY: number;
      y0: number; y1: number;
    };

export interface Reservation {
  volume: Volume;
  /** Who holds it. Reported by `blocker()` so a failed placement can say WHAT
   *  was in the way instead of just refusing. */
  owner: string;
}

export class RoomOccupancy {
  private readonly items: Reservation[] = [];

  reserve(volume: Volume, owner: string): void {
    this.items.push({ volume, owner });
  }

  reserveAll(volumes: readonly Volume[], owner: string): void {
    for (const v of volumes) this.items.push({ volume: v, owner });
  }

  /** Nothing already reserved intersects this. */
  fits(v: Volume, clearance = 0): boolean {
    return this.blocker(v, clearance) === null;
  }

  /** The owner of the first thing in the way, or null. */
  blocker(v: Volume, clearance = 0): string | null {
    for (const it of this.items) {
      if (intersects(it.volume, v, clearance)) return it.owner;
    }
    return null;
  }

  list(): readonly Reservation[] { return this.items; }

  /** Flatten to the circle footprints `floor-region.candidateSpots` takes, for
   *  the placers that still reason in 2D. LOSSY on purpose — it drops the
   *  vertical extent, so a hanging thing will exclude floor under it. Prefer
   *  `fits()` where the caller knows its own height. */
  footprints(): Array<{ x: number; z: number; r: number }> {
    return this.items.map(({ volume: v }) => ({
      x: v.x,
      z: v.z,
      r: v.kind === 'cylinder' ? v.r : Math.hypot(v.halfW, v.halfD),
    }));
  }
}

/** Do two volumes overlap, given `pad` metres of required air between them? */
export function intersects(a: Volume, b: Volume, pad = 0): boolean {
  // Vertical first — it's one comparison and it rejects the hanging-vs-standing
  // case immediately, which is the whole reason this is 3D.
  if (a.y1 + pad <= b.y0 || b.y1 + pad <= a.y0) return false;
  if (a.kind === 'cylinder' && b.kind === 'cylinder') {
    return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + pad;
  }
  if (a.kind === 'box' && b.kind === 'box') return obbOverlap(a, b, pad);
  const box = (a.kind === 'box' ? a : b) as Extract<Volume, { kind: 'box' }>;
  const cyl = (a.kind === 'cylinder' ? a : b) as Extract<Volume, { kind: 'cylinder' }>;
  return boxCircleOverlap(box, cyl, pad);
}

type Box = Extract<Volume, { kind: 'box' }>;
type Cyl = Extract<Volume, { kind: 'cylinder' }>;

/** Closest-point test in the box's own frame. */
function boxCircleOverlap(b: Box, c: Cyl, pad: number): boolean {
  const cos = Math.cos(-b.rotY), sin = Math.sin(-b.rotY);
  const dx = c.x - b.x, dz = c.z - b.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const qx = Math.max(-b.halfW, Math.min(b.halfW, lx));
  const qz = Math.max(-b.halfD, Math.min(b.halfD, lz));
  return Math.hypot(lx - qx, lz - qz) < c.r + pad;
}

/**
 * Separating-axis test for two rotated rectangles.
 *
 * Four axes — each box's two edge normals. If any axis separates them they do
 * not overlap; if none does, they do. `pad` inflates both boxes, which is the
 * cheap way to require air between things rather than mere non-contact.
 */
function obbOverlap(a: Box, b: Box, pad: number): boolean {
  const axes = [a.rotY, a.rotY + Math.PI / 2, b.rotY, b.rotY + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang), az = Math.sin(ang);
    const ra = projectedRadius(a, ax, az) + pad / 2;
    const rb = projectedRadius(b, ax, az) + pad / 2;
    const d = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
    if (d >= ra + rb) return false;
  }
  return true;
}

/** Half-extent of a rotated box along a unit axis. */
function projectedRadius(b: Box, ax: number, az: number): number {
  const ux = Math.cos(b.rotY), uz = Math.sin(b.rotY);          // local +X in world
  const vx = -uz, vz = ux;                                      // local +Z in world
  return Math.abs(ux * ax + uz * az) * b.halfW + Math.abs(vx * ax + vz * az) * b.halfD;
}
