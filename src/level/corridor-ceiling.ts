// ── A CORRIDOR NEVER STANDS TALLER THAN THE ROOM IT OPENS INTO ───────────────
//
// The section vocabulary (corridor-types.ts) gives a gallery a 4.60m ceiling,
// and rooms on these floors run from 2.8m up. Measured the moment the gallery
// shipped: 32 of 609 corridors — every one of them a gallery — met a room whose
// ceiling was LOWER than their own.
//
// That is the exact geometry Josh photographed twice this session ("part of the
// corridor's top wall sticking into the room", #155/#159). A corridor rect
// deliberately ends INSIDE the room it serves, because a polygon room's real
// wall sits back from its bounding box. So a tube taller than the room punches
// its far end through the room's ceiling, and from inside the room you are
// looking at the OUTSIDE of a corridor. The plate trim (corridor-trim.ts) clips
// the floor and ceiling planes at the room boundary; it cannot fix a height the
// room has no wall to meet.
//
// Two things make this a function rather than three lines inline:
//
//   1. IT IS PER LINK, NOT PER RECT. A dogleg is three legs and only the end
//      ones touch a room; clamping each rect on its own gives a corridor that
//      steps its ceiling down halfway round the bend, which reads worse than
//      the overshoot it was fixing.
//   2. IT COUNTS EVERY ROOM THE LINK PASSES, not the two it joins. A dogleg
//      sweeps sideways through space the straight run never touches, and the
//      room it clips on the way is exactly the one you would see through.
//
// Pure and THREE-free so the test asks the shipping question instead of
// re-deriving it — a report that re-inlines the rule launders a guess as a
// measurement (docs/DESIGN-METHOD.md).

/** A rect in world metres — the shape every room and corridor spec carries. */
export interface Box { x: number; z: number; w: number; d: number }
export interface CeilingRoom { rect: Box; height: number }

/**
 * The ceiling a whole link may stand at: its section's height, lowered to the
 * shortest room any of its legs overlaps.
 *
 * Degrade, never fail — a gallery that lands between two low rooms stops being
 * a gallery vertically and keeps its width and its long straight run, which is
 * most of why it reads as somewhere.
 */
export function ceilingForLink(
  desired: number, legs: readonly Box[], rooms: readonly CeilingRoom[],
): number {
  let lowest = desired;
  for (const leg of legs) {
    for (const r of rooms) {
      if (Math.abs(leg.x - r.rect.x) > (leg.w + r.rect.w) / 2) continue;
      if (Math.abs(leg.z - r.rect.z) > (leg.d + r.rect.d) / 2) continue;
      lowest = Math.min(lowest, r.height);
    }
  }
  return lowest;
}

// ── A STAIR HALL HAS A RAKED SOFFIT, NOT A CREASED ONE ───────────────────────
//
// Josh: *"the corridor ceiling doesnt follow the stair but is straight then sudden
// drop then straight again, while the stair slopes gently"* — and, on the darkness
// band: *"it generates this irregular ceiling in the middle with a big drop kinda
// which makes it irregular in shape for the ceiling darkening."*
//
// Both are one fact, and it is in the FLOOR field, not in the ceiling code. Sampled
// down the centreline of a ramped corridor, the elevation field is FLAT, then SLOPE,
// then FLAT:
//
//   cor-1  run 7.89m  ramp 0.00 → −1.20
//   slope   ·   ·   ·  −.20 −.20 −.20 … −.20 −.20   ·   ·   ·
//
// That is correct for the floor and deliberate: each end is pinned level to the room
// it opens into, so you never start descending in a doorway. The ceiling was then
// built at `groundYAt(x, z) + H` per vertex — "headroom stays constant down the
// slope" — which faithfully copies the shelves and gives the ceiling TWO HARD
// CREASES a metre inside each mouth. On a 2.30m squeeze that fold is right in your
// eyeline, and the room-top darkness is measured against the ceiling, so the band
// creases with it.
//
// A ceiling does not need a level threshold; only the floor does. So it stops
// copying the floor and becomes what a real stair hall has: ONE RAKED PLANE, from
// the headroom at one mouth to the headroom at the other.
//
// NO BIAS TERM, on purpose. The plane could be lifted until headroom never dips
// below H anywhere, but that would raise the ceiling at the mouths above the doorway
// head — which is built at the passage's own height — and put a ledge over every
// door to buy back a few centimetres in the middle. Meeting the head exactly is
// worth more than the clearance: the dip is the shelf's own height, measured at most
// 0.17m on the sampled floors, against a body 1.7m tall in a 2.30m passage.

/**
 * The ceiling plane of a ramped corridor rect: a straight rake between the headroom
 * at its two ends.
 *
 * `alongX` is the travel axis; `floorAt` is the elevation field. Returns the ceiling
 * height at a world point — used both to displace the ceiling mesh and to tell the
 * darkness band where the ceiling is, so the two cannot drift apart.
 */
export function rakeCeiling(
  rect: Box,
  alongX: boolean,
  height: number,
  floorAt: (x: number, z: number) => number,
): (x: number, z: number) => number {
  const t0 = alongX ? rect.x - rect.w / 2 : rect.z - rect.d / 2;
  const t1 = alongX ? rect.x + rect.w / 2 : rect.z + rect.d / 2;
  const lat = alongX ? rect.z : rect.x;
  // A hair inside each end, so a field that falls back outside its own bounds is
  // never the thing that sets the rake.
  const eps = Math.min(0.01, (t1 - t0) * 0.02);
  const y0 = floorAt(alongX ? t0 + eps : lat, alongX ? lat : t0 + eps);
  const y1 = floorAt(alongX ? t1 - eps : lat, alongX ? lat : t1 - eps);
  const span = t1 - t0;
  const k = span > 1e-6 ? (y1 - y0) / span : 0;
  return (x: number, z: number): number => y0 + k * ((alongX ? x : z) - t0) + height;
}
