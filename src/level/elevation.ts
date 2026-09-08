import type { RoomSpec } from './types';
import { maxFlightRun, roundedRampProfile } from './corridor-stair';

// Ground-elevation field — THE single source of "how high is the floor
// at (x, z)" for everything that stands on it: the camera, mobs, loot,
// effects, interactables. Built once per floor from the room/corridor
// specs; sampled per frame.
//
// Model (see RoomSpec.elevation): rooms are flat plateaus at their
// elevation; corridors are ramps lerping between the elevations of the
// rooms at their two ends. Collision and pathfinding stay 2D — the
// field is presentation truth, not a movement gate. This is the
// load-bearing trick of DELVE's verticality: fights stay on one plane
// per room (doors seal on combat), so combat math, the splat map, and
// the nav grid never see a slope.
//
// Sampling rules:
//   - Inside a corridor: lerp along its long axis between end
//     elevations, with a flat apron at each end so the seam with the
//     room is exactly level where they meet.
//   - Inside a room: the room's elevation.
//   - Corridors win over rooms where rects overlap (the seam cells),
//     because their ends are pinned to the room elevations anyway.
//   - Outside everything: nearest rect's elevation (graceful for
//     effects that drift past a wall).

export interface ElevationField {
  groundY(x: number, z: number): number;
  /** True when every elevation is 0 — lets hot paths skip the lookup. */
  readonly flat: boolean;
}

/** Fraction of a corridor's length kept FLAT at each end, so the ramp
 *  doesn't start in the doorway itself. */
const APRON_FRAC = 0.18;

/** The stair-run a corridor of this length actually carries (length
 *  minus both landings). The composer divides a rolled drop by this
 *  to enforce ELEVATION_MAX_GRADE — so the grade cap and the field's
 *  ramp math can never disagree about where the slope lives.
 *
 *  Kept as this name because every caller reads it here, but the number
 *  now belongs to the STAIR SECTION (level/corridor-stair.ts): the slope
 *  lives in a flight, and how long a flight a corridor can hold is a fact
 *  about stairs rather than about elevation. */
export function corridorRampRun(longLen: number): number {
  return maxFlightRun(longLen);
}

interface CorridorRamp {
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Axis the corridor runs along. */
  alongX: boolean;
  /** Low-coordinate end of the rect along the travel axis, and its length. */
  lo: number; len: number;
  /** The RAKE's extent, as fractions of the rect — see roundedRampProfile. */
  t0: number; t1: number;
  /** Elevation at the two ends of the rect. */
  e0: number; e1: number;
}

interface Plateau {
  minX: number; maxX: number; minZ: number; maxZ: number;
  cx: number; cz: number;
  e: number;
}

function rectOf(r: RoomSpec) {
  return {
    minX: r.rect.x - r.rect.w / 2, maxX: r.rect.x + r.rect.w / 2,
    minZ: r.rect.z - r.rect.d / 2, maxZ: r.rect.z + r.rect.d / 2,
  };
}

export function buildElevationField(rooms: RoomSpec[], corridors: RoomSpec[]): ElevationField {
  const plateaus: Plateau[] = rooms.map((r) => ({
    ...rectOf(r), cx: r.rect.x, cz: r.rect.z, e: r.elevation ?? 0,
  }));

  // Elevation of the room nearest a point — used to pin corridor ends
  // and as the out-of-bounds fallback.
  const roomElevationNear = (x: number, z: number): number => {
    let best = 0, bestD = Infinity;
    for (const p of plateaus) {
      const dx = Math.max(p.minX - x, 0, x - p.maxX);
      const dz = Math.max(p.minZ - z, 0, z - p.maxZ);
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p.e; }
    }
    return best;
  };

  const ramps: CorridorRamp[] = corridors.map((c) => {
    const r = rectOf(c);
    // Composer-stamped connection axis wins; fall back to the rect's
    // longer side for hand-authored corridors that don't stamp it.
    const alongX = c.rampAlongX ?? (c.rect.w >= c.rect.d);
    const lo = alongX ? r.minX : r.minZ;
    const hi = alongX ? r.maxX : r.maxZ;
    // WHERE THE SLOPE LIVES. A corridor that carries a stair says so, and the flight's
    // own extent is the ramp; the rest of the run is landing. Corridors with no stair
    // declared — hand-authored levels, the vault path — keep the old fixed apron, so
    // nothing that never met the section changes shape.
    const len = hi - lo;
    const flight = c.stair;
    const apron = flight ? 0 : Math.min(len * APRON_FRAC, 1.0);
    // PREFER the composer's explicit endpoints (rampLoElev/rampHiElev) —
    // it knows which rooms this corridor bridges. Fall back to spatial
    // probing only for hand-authored corridors that don't stamp them
    // (probing picks the nearest room by 2D distance and mis-fires in
    // dense layouts, which is the depth-7+ mid-air-ramp bug). A flat
    // explicit `elevation` still wins over both (level corridors).
    const e0 = c.elevation !== undefined ? c.elevation
      : c.rampLoElev !== undefined ? c.rampLoElev
      : alongX ? roomElevationNear(lo - 0.6, c.rect.z)
               : roomElevationNear(c.rect.x, lo - 0.6);
    const e1 = c.elevation !== undefined ? c.elevation
      : c.rampHiElev !== undefined ? c.rampHiElev
      : alongX ? roomElevationNear(hi + 0.6, c.rect.z)
               : roomElevationNear(c.rect.x, hi + 0.6);
    return {
      ...r, alongX, e0, e1, lo, len,
      // The rake's extent as FRACTIONS of the rect, because the knee rounding below reaches
      // a little outside it and so cannot be expressed by clamping at two world coordinates.
      t0: flight ? flight.t0 : (len > 1e-6 ? apron / len : 0),
      t1: flight ? flight.t1 : (len > 1e-6 ? 1 - apron / len : 1),
    };
  });

  const flat = plateaus.every((p) => p.e === 0) && ramps.every((rp) => rp.e0 === 0 && rp.e1 === 0);

  const groundY = (x: number, z: number): number => {
    if (flat) return 0;
    // Corridors first — they own the seams.
    for (const rp of ramps) {
      if (x < rp.minX || x > rp.maxX || z < rp.minZ || z > rp.maxZ) continue;
      // LINEAR down the rake, with the two KNEES ROUNDED.
      //
      // Smoothstep across the WHOLE run was tried first and read as a sagging
      // curve from inside the corridor (and made the mid-slope 1.5× the average
      // grade — the "way too steep" verdict from the phone). A straight line
      // between the landings is what a cut stair run is, and this keeps it: the
      // rake's own slope is untouched, so the grade budget is untouched.
      //
      // What is eased is only the two CORNERS where level ground meets the rake.
      // They are real angles in the FLOOR, and anything built at `floor + H`
      // inherits them — which is exactly the ceiling crease Josh photographed
      // (level/corridor-stair.ts, "the crease was never a ceiling problem").
      const a = rp.alongX ? x : z;
      const t = rp.len > 1e-6 ? (a - rp.lo) / rp.len : 0;
      return rp.e0 + (rp.e1 - rp.e0) * roundedRampProfile(t, rp.t0, rp.t1, rp.len);
    }
    for (const p of plateaus) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return p.e;
    }
    return roomElevationNear(x, z);
  };

  return { groundY, flat };
}

// ── Current-floor accessor ───────────────────────────────────────────
// Set on level load; sampled by the camera, mobs, and effects. Defaults
// to dead flat so every caller is safe before the first floor builds.

const FLAT: ElevationField = { groundY: () => 0, flat: true };
let current: ElevationField = FLAT;

export function setElevationField(f: ElevationField | null): void {
  current = f ?? FLAT;
}

/** Ground height at (x, z) on the current floor. The ONE function every
 *  "standing on the floor" consumer samples. */
export function groundYAt(x: number, z: number): number {
  return current.groundY(x, z);
}

/** True when the current floor has no elevation anywhere (hot paths may
 *  skip work). */
export function isFlatFloor(): boolean {
  return current.flat;
}
