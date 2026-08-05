// ── WHAT A ROOM'S WALLS CAN BE ASKED ─────────────────────────────────────────
//
// The first thing anything mounted on a wall needs is a WALL, and until now the
// only way to name one was a compass letter: `{ x, z, wall: 'W' }`. That works
// exactly as long as every room is a rectangle. It fails in two ways that both
// look like content mistakes rather than model mistakes:
//
//   - It can name a wall that isn't there. The starter chamber's stair sconce
//     sat at x = −3.95 for months. When the room became an apse the west wall
//     stopped existing at that Z, and the sconce hung in the void — nothing in
//     the code could have caught it, because 'W' is just a letter.
//   - It cannot name a diagonal at all. Every polygon room the generator can
//     now build has walls no compass letter describes.
//
// So a wall is an OBJECT with a normal, a length, and ends that know whether
// they are a corner or a doorway. Placement becomes a query against it — "give
// me evenly spaced mounts", "which wall has 2.6m of clear floor in front of it"
// — instead of a coordinate somebody measured once and pasted.
//
// Pure and Three-free: derived from the polygon, so it can be asked at build
// time, in a test, or in an audit script without a renderer. It is the same
// `planWallRing` the shell builds geometry from, so a surface a placer reasons
// about and a wall the player walks into are the same wall by construction —
// not two computations that agree until one of them changes.

import { planWallRing, type OpeningRect, type Ring, type V2 } from './poly-shell-plan';
import { pointInPoly } from './room-shape';

export interface WallSurface {
  /** Index of the polygon edge this came from. */
  edge: number;
  /** Endpoints of the room-side face, world XZ. */
  a: V2;
  b: V2;
  /** Midpoint of the face. */
  mid: V2;
  /** Unit vector pointing INTO the room. */
  inward: V2;
  /**
   * rotY for a prop that should FACE INTO the room from this wall (back to the
   * stone). A prop's front is its local +Z at rotY = 0, and rotating by rotY
   * sends +Z to (sin rotY, cos rotY) — so this is atan2 of the inward normal
   * with x FIRST. Getting the argument order backwards mirrors every sconce in
   * the dungeon and still compiles, which is why it is computed once, here.
   */
  facingY: number;
  length: number;
  height: number;
  elevation: number;
  /** True when this end was cut by a doorway rather than meeting a corner. */
  jambA: boolean;
  jambB: boolean;
}

export interface DescribeOpts {
  poly: Ring;
  height: number;
  elevation?: number;
  /** Wall thickness — must match the shell's, or a surface and its geometry
   *  disagree about where a doorway starts. */
  thickness?: number;
  /** Rects that cut doorways (the corridors meeting this room). */
  openings?: ReadonlyArray<OpeningRect>;
}

/** Every mountable wall face of a room, in polygon order. */
export function describeWalls(o: DescribeOpts): WallSurface[] {
  const spans = planWallRing(o.poly, o.thickness ?? 0.25, o.openings ?? []);
  const elevation = o.elevation ?? 0;
  return spans.map((s) => {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
    const length = Math.hypot(dx, dz) || 1;
    // Inward is the edge direction turned a quarter turn toward the interior.
    // planWallRing's own outward normal is (dz, −dx) scaled by the winding sign;
    // rather than duplicate that sign logic, take the perpendicular and CHECK
    // which side is inside. One pointInPoly beats a sign convention nobody can
    // remember at the call site.
    let ix = -dz / length, iz = dx / length;
    const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
    if (!pointInPoly(o.poly, mx + ix * 0.05, mz + iz * 0.05)) { ix = -ix; iz = -iz; }
    return {
      edge: s.edge,
      a: s.a, b: s.b,
      mid: [mx, mz] as V2,
      inward: [ix, iz] as V2,
      facingY: Math.atan2(ix, iz),
      length,
      height: o.height,
      elevation,
      jambA: s.jambA, jambB: s.jambB,
    };
  });
}

export interface Mount {
  x: number;
  z: number;
  /** Metres above the room's floor. */
  y: number;
  /** rotY facing into the room. */
  rotY: number;
  surface: WallSurface;
}

export interface MountOpts {
  /** Target spacing between fixtures. The real interval is chosen inside this
   *  band so the run divides evenly — architecture reads as architecture because
   *  things REPEAT, and a leftover stub at one end is what makes a colonnade
   *  look scattered instead of built. */
  spacing: [number, number];
  /** Metres to keep clear of each end of the run. A corner or a doorway jamb is
   *  the worst place to bolt anything. */
  edgePad?: number;
  /** Height above the floor. */
  y?: number;
  /** Push out from the wall plane (positive = into the room). */
  inset?: number;
  /** Shortest wall run that can hold ONE of these — the fixture's footprint
   *  plus a little air. Not related to `spacing`, which is the gap BETWEEN
   *  fixtures on a run long enough for several. */
  minRun?: number;
}

/**
 * CANDIDATE mounts along one wall face — evenly spaced, or a single centred one
 * on a run too short for a rhythm, or none at all on a run too short for the
 * fixture.
 *
 * Candidates, not decisions: this answers "where COULD one of these go", and a
 * placer picks from the result under whatever budget it owns (one focal per
 * room, a lighting allowance, a claim). Measured across every archetype it
 * offers 12–18 per room, which is deliberately more than any room should
 * actually receive — per docs/LEVEL-ARCHITECTURE.md, seeding more candidates
 * than you fill is what makes placement look chosen rather than regular.
 */
export function mountPoints(s: WallSurface, o: MountOpts): Mount[] {
  // Scale the end padding to the wall. A fixed 0.6m clearance is right on a 10m
  // nave and absurd on a 2m alcove face, where it reserves more than half the
  // run and returns nothing — which is how a `cross` room came out with ZERO
  // mountable points in the whole room, i.e. a room that cannot be lit. Measured
  // across every archetype: median wall length is 1.2–3.4m, so short faces are
  // the common case, not the exception.
  const pad = Math.min(o.edgePad ?? 0.6, s.length * 0.22);
  const usable = s.length - pad * 2;
  const [minSp, maxSp] = o.spacing;
  // Whether a wall can hold ONE fixture is a question about the FIXTURE'S
  // FOOTPRINT, not about the gap between fixtures. Gating on `minSpacing / 2`
  // conflated the two and made a 2m alcove face unmountable because sconces are
  // usually 3m apart — which is how an entire `cross` room ended up with zero
  // mountable points, i.e. a room the player could never see.
  if (s.length < (o.minRun ?? 0.9)) return [];

  // How many gaps fit, at a spacing inside the requested band?
  let count = Math.max(1, Math.round(usable / ((minSp + maxSp) / 2)) + 1);
  let step = count > 1 ? usable / (count - 1) : 0;
  while (count > 1 && step > maxSp) { count++; step = usable / (count - 1); }
  while (count > 2 && step < minSp) { count--; step = usable / (count - 1); }

  const dx = (s.b[0] - s.a[0]) / s.length, dz = (s.b[1] - s.a[1]) / s.length;
  const inset = o.inset ?? 0.05;
  const out: Mount[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? s.length / 2 : pad + step * i;
    out.push({
      x: s.a[0] + dx * t + s.inward[0] * inset,
      z: s.a[1] + dz * t + s.inward[1] * inset,
      y: o.y ?? 2.0,
      rotY: s.facingY,
      surface: s,
    });
  }
  return out;
}

/**
 * How much open floor is in front of this wall, measured at its midpoint.
 *
 * Marches inward until it leaves the polygon or hits `max`. This is the
 * question a stair actually needs answered — a stairwell descends INTO the wall
 * and needs its whole run clear in front — and it is the question a rectangle
 * could never answer, because a rectangle only ever knew four numbers.
 */
export function clearDepth(s: WallSurface, poly: Ring, max = 6, step = 0.15): number {
  for (let d = step; d <= max; d += step) {
    if (!pointInPoly(poly, s.mid[0] + s.inward[0] * d, s.mid[1] + s.inward[1] * d)) return d - step;
  }
  return max;
}

/**
 * The wall face closest to a point.
 *
 * What "put your back against the wall" has to mean once a room stops being a
 * rectangle. The rect answer was one of four compass letters, which quantises
 * every prop's rotation to a right angle and has no answer at all for a
 * chamfer or a diagonal — a chest against a 45° wall ended up facing 45° wrong.
 */
export function nearestSurface(
  surfaces: readonly WallSurface[], x: number, z: number,
): WallSurface | null {
  let best: WallSurface | null = null;
  let bestD = Infinity;
  for (const s of surfaces) {
    const d = distPointSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export interface RunNeed {
  /** Minimum wall length the fixture occupies. */
  length: number;
  /** Minimum open floor required in front of it. */
  depth: number;
  /** Reject walls whose ends are doorways within this distance of the centre. */
  clearOfJambs?: boolean;
}

/**
 * The best wall for something that needs LENGTH and CLEAR FLOOR — a stair, a
 * shrine, a merchant's stall.
 *
 * "Best" is widest-then-deepest: among the walls that satisfy the need, prefer
 * the one with the most room in front, so a feature lands in the part of the
 * room that can actually show it off. Returns null rather than a bad wall —
 * placement should DEGRADE (the caller puts the feature somewhere else) rather
 * than jam a stair into a 1.2m alcove.
 */
export function findMountableRun(
  surfaces: readonly WallSurface[], poly: Ring, need: RunNeed,
): WallSurface | null {
  let best: WallSurface | null = null;
  let bestScore = -Infinity;
  for (const s of surfaces) {
    if (s.length < need.length) continue;
    if (need.clearOfJambs && (s.jambA || s.jambB)) continue;
    const d = clearDepth(s, poly, need.depth + 2);
    if (d < need.depth) continue;
    const score = d * 2 + s.length;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}
