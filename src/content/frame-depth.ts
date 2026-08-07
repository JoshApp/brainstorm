// ── HOW DEEP IS A DOORWAY? ───────────────────────────────────────────────────
//
// Josh, on a phone: *"doorways z fight with the corridor, they are halfways
// embedded"* — and, in a later shot of a winding corridor, *"the massive stone
// door is kinda inset into it, so we have some geometry building issue."*
//
// Both are one number. The archway and the doorframe each carried a private
// `FILL_DEPTH = 1.10`, on the belief that a doorway sits in a wall a full grid
// cell thick. No wall in this game is anywhere near that:
//
//   - a POLYGON room's wall is `WALL_T`, 0.25m of extruded ring;
//   - a RECT room's wall is a single jittered PLANE with no thickness at all —
//     two rooms that share an edge bake one plane each, coincident.
//
// Measured across 64 generated polygon floors, 625 framed doorways: every one
// of them stood 0.425m proud of its wall on the fill and 0.545m on the
// keystone. A doorway was four times deeper than the stone it was set into, so
// half of every frame hung out in the corridor — through the corridor's own
// side-wall planes, which is the z-fight, and past its mouth, which is the
// "half embedded" read.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
//
// A frame's reveal is a FRACTION OF THE WALL IT SITS IN, not a constant.
// (docs/DESIGN-METHOD.md: "a cost denominated in another system's units is a
// FRACTION, not a number" — the blood altar charged four fifths of your health
// for the same reason.) It covers the wall from both faces and stands a fixed
// hand's breadth proud of each, so it reads as dressed masonry APPLIED to the
// wall rather than as a slab driven through it.
//
// The floor exists because the arch still has to read as an arch: below about
// half a metre the ring has no depth for a lamp to rake across and the gate
// flattens into a decal. The ceiling is the old constant — a metre is the most
// stone anyone can believe is standing over a doorway.

/** How far the surround stands out of each face of its wall. */
export const FRAME_PROUD = 0.16;
/** Shallower than this and the arch ring reads as a painted-on decal. */
export const MIN_REVEAL = 0.52;
/** Deeper than this and you are walking through a tunnel, not a threshold. */
export const MAX_REVEAL = 1.10;

/** Reveals are quantised so frames REPEAT — see the memo + CSG cache note in
 *  archway.ts. A continuous depth would give every doorway a unique spec. */
const REVEAL_STEP = 0.02;

/**
 * The depth of stone a frame should occupy, given the wall it is set into.
 *
 * `wallDepth` is the wall's real thickness in metres — `WALL_T` for a polygon
 * room, 0 for a rect room's plane. Pure, exported, and imported by BOTH frame
 * models and by the test, so the two thresholds can never disagree about how
 * deep a doorway is again.
 */
export function revealDepthFor(wallDepth: number): number {
  const raw = Math.max(0, wallDepth) + 2 * FRAME_PROUD;
  const clamped = Math.min(MAX_REVEAL, Math.max(MIN_REVEAL, raw));
  return Math.round(clamped / REVEAL_STEP) * REVEAL_STEP;
}

/** The default when a caller does not say — a thin dungeon wall. */
export const DEFAULT_WALL_DEPTH = 0.25;
