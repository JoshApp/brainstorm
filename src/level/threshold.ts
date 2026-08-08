import type { Poly } from './room-shape';

// ── ONE SEAM, DECLARED BEFORE THE GEOMETRY ───────────────────────────────────
//
// The full argument is docs/SPACES-AND-THRESHOLDS.md. The short version, and
// the measurement it rests on:
//
// A corridor is a rect run between two rooms that deliberately OVERSHOOTS into
// them, because a polygon room's real wall sits back from its bounding box by
// an unknown amount and overshooting is the only way to guarantee it reaches
// stone. Measured over 36 floors: 480 places where a corridor rect is inside a
// room polygon, a median 0.73m deep and up to 3.60m — and 92% of those have a
// ceiling more than 15cm off the room's, so the passage stands its slab and its
// side walls INSIDE the room and you are looking at the outside of a tunnel
// from indoors.
//
// Seven separate systems exist to undo that overshoot's consequences, and every
// geometry bug this session was two of them disagreeing. The overshoot is the
// disease; they are medication.
//
// A THRESHOLD is the cure: the seam, decided FIRST, owned by both sides. It is
// the only place the question "where does this wall actually sit" is asked, and
// both the room's wall ring and the corridor's geometry are built FROM it
// rather than reconciled to each other afterwards. A frame built from a
// threshold cannot fight the corridor behind it, because the corridor was built
// from the same numbers.
//
// This file is step 1 of that migration: the type, and the solver. It is
// emitted alongside today's geometry and consumed by nobody yet, so it can be
// checked against what the existing pipeline finds before anything depends on
// it. See the Status section of the doc for where the migration actually is.

/**
 * WHAT A DOORWAY SAYS ABOUT WHAT IS BEHIND IT.
 *
 * Josh: *"I like the archway — I think you are right that we can hint at what
 * might lay behind by the appearance of the door as well."*
 *
 * A data field on the seam rather than a branch in the frame builder, so the
 * vocabulary is a table a content layer can extend. Chosen from what is on BOTH
 * sides — the two spaces' sections and roles — never from the opening's width,
 * which is what the current two-entry archway/doorframe split reads and why a
 * plain passage keeps getting a monument.
 */
export type ThresholdKind =
  /** Worn through, unmade. No frame at all. Meant to be the common case. */
  | 'gap'
  /** Stoop or clamber — half-collapsed, or simply low. Pairs with a squeeze. */
  | 'half'
  /** Somebody built this. A made opening into a made room. */
  | 'frame'
  /** Monumental, and RARE. It should mean the room behind it matters. */
  | 'gate';

export interface Threshold {
  id: string;
  /** The two spaces it joins. Rooms and corridors alike — there is one kind of
   *  space, and a threshold does not care which is which. */
  spaces: readonly [string, string];
  /** The point, on the shared wall line. */
  at: readonly [number, number];
  /** Unit normal, out of `spaces[0]` and into `spaces[1]`. */
  normal: readonly [number, number];
  /** Clear opening width, metres. */
  width: number;
  /**
   * Clear opening height, metres — ONE number, which both sides build to.
   *
   * This is the field that retires `corridor-ceiling.ts`. That pass exists to
   * clamp a corridor that came out taller than the room it opens into; when the
   * height is declared at the seam and read by both, there is no mismatch to
   * find.
   */
  height: number;
  /**
   * The ground both sides meet at, metres.
   *
   * Same reasoning as `height`: a seam cannot step if there is only one number.
   * The elevation pass ramps a corridor BETWEEN its two thresholds instead of
   * deciding a fall and then discovering it landed somewhere else.
   */
  floorY: number;
  kind: ThresholdKind;
}

/** A space, as this module needs to see one. Rooms and corridors both. */
export interface Space {
  id: string;
  poly: Poly;
  height: number;
  elevation?: number;
}

/**
 * Where a straight run from `from` toward `to` leaves a space, or null.
 *
 * Promoted from `poly-floor.exitPoint`, which is a local helper today. This is
 * the ONE place the "where is the real wall" question is answered, and the
 * whole model rests on nobody asking it a second way — the reason the current
 * pipeline needs seven reconcilers is that six of them re-derive it.
 *
 * Marches out along the ray and returns the last point still inside, so the
 * result sits ON the boundary rather than past it.
 */
export function boundaryHit(
  poly: Poly, from: readonly [number, number], dir: readonly [number, number],
  maxDist = 60, step = 0.05,
): [number, number] | null {
  const len = Math.hypot(dir[0], dir[1]);
  if (len < 1e-6) return null;
  const ux = dir[0] / len, uy = dir[1] / len;
  if (!inside(poly, from[0], from[1])) return null;
  let last: [number, number] = [from[0], from[1]];
  for (let d = step; d <= maxDist; d += step) {
    const x = from[0] + ux * d, z = from[1] + uy * d;
    if (!inside(poly, x, z)) return last;
    last = [x, z];
  }
  return null;
}

/**
 * The threshold where a link leaves `space` toward `toward`.
 *
 * `centre` is the point inside the space the route starts from, `toward` the
 * direction it leaves in. Width and height come from the SECTION (the link's
 * corridor type), not from anything measured — that is the inversion: the
 * opening is declared, and the geometry on both sides is cut to it.
 */
export function thresholdAt(opts: {
  id: string;
  space: Space;
  other: string;
  centre: readonly [number, number];
  toward: readonly [number, number];
  width: number;
  height: number;
  kind: ThresholdKind;
}): Threshold | null {
  const hit = boundaryHit(opts.space.poly, opts.centre, opts.toward);
  if (!hit) return null;
  const len = Math.hypot(opts.toward[0], opts.toward[1]) || 1;
  return {
    id: opts.id,
    spaces: [opts.space.id, opts.other],
    at: hit,
    normal: [opts.toward[0] / len, opts.toward[1] / len],
    width: opts.width,
    // The opening can never be taller than the space it is cut into — a hole
    // above the wall top is a hole in the sky. Both sides are checked by the
    // caller; this is the half this module can guarantee alone.
    height: Math.min(opts.height, opts.space.height),
    floorY: opts.space.elevation ?? 0,
    kind: opts.kind,
  };
}

/**
 * The kind this seam should wear, from what is on BOTH sides.
 *
 * Deliberately not a function of width. The current frame chooser reads the
 * opening's width and nothing else, which is why a plain passage between two
 * ordinary rooms gets the same monumental archway as the way into a sanctum —
 * the geometry has no way to say the two are different.
 *
 * Kept as a pure lookup so the content layer can retune the register without
 * touching the builder: it is a table, not a branch.
 */
export function thresholdKind(a: {
  /** The section or role word for each side — a corridor's intent, a room's
   *  type. Whatever the space calls itself. */
  word: string;
  major: boolean;
}, b: typeof a, rand: () => number): ThresholdKind {
  // A monument is earned by what it opens onto, and it has to stay rare or it
  // stops meaning anything — the same rule the light system holds to.
  if (a.major || b.major) return 'gate';
  // A tight space gets a tight opening: a stoop into a squeeze reads as the
  // passage narrowing rather than as a door that happens to be short.
  if (a.word === 'squeeze' || b.word === 'squeeze') return rand() < 0.55 ? 'half' : 'gap';
  // Otherwise: mostly worn-through, sometimes made. The common case is a hole.
  return rand() < 0.65 ? 'gap' : 'frame';
}

function inside(poly: Poly, x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
