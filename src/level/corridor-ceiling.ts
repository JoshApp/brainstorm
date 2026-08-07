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
