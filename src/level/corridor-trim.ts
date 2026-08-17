import { pointInPoly, type Poly } from './room-shape';
import { WALL_T } from './poly-shell-plan';

// ── WHERE A CORRIDOR'S FLOOR AND CEILING SHOULD STOP ─────────────────────────
//
// Josh, on a phone: *"some corridors ceiling and floor reaches too far into a
// room and then there is a small space where I barely stand on the elongated
// floor and the room I should be in gets culled, then if I move forward just a
// little bit it reappears"* — and, in another shot, *"you see part of the
// corridors top wall sticking into the room."*
//
// ── WHY IT HAPPENS, AND WHY THE RECT IS NOT THE BUG ──────────────────────────
//
// A corridor rect ENDS INSIDE the room it serves. That is not a mistake — it is
// the only way a corridor can meet a POLYGON room's wall, because a polygon's
// wall sits back from its bounding box and a corridor stopping at the box would
// stop short of the stone. Every connection rule in the generator depends on
// that overlap: `findOpenings` cuts the doorway because the corridor crosses the
// wall line, and `room-graph` pairs the two because their rects overlap.
//
// The bug is that the corridor also BUILDS ITS FLOOR AND CEILING over the whole
// rect. So past the doorway, inside the room, there is a slab of corridor floor
// at the corridor's height and a slab of corridor ceiling at the corridor's
// height — a ledge underfoot and a soffit overhead, in a room that has its own
// floor and its own, higher, ceiling.
//
// Measured across 200 generated floors: 1978 corridor-to-room junctions, and
// 98% of them reach more than 0.35m past the wall. Mean 0.82m. Worst 4.21m.
//
// ── SO TRIM THE PLATES, NOT THE RECT ─────────────────────────────────────────
//
// The rect stays exactly as it is, and every rule built on it keeps working.
// This answers a narrower question: how big should the corridor's floor and
// ceiling PLATES be, and where should they sit? The answer is "up to the room's
// wall, plus a hand's breadth of overlap so no seam can open".
//
// The overlap is deliberate and it is why this is safe. A trim that stopped
// exactly at the polygon would be one floating-point comparison away from a
// hairline gap you can see the void through; a trim that keeps OVERLAP metres
// of corridor floor inside the room cannot gap, and 10cm of ledge is not a
// thing anyone will find with their feet.

export interface PlateExtent {
  /** Plate size and world centre. The rect's own w/d/x/z when nothing trims. */
  w: number; d: number; x: number; z: number;
  /** Metres removed from each end along the corridor's long axis. Reported so
   *  an audit can measure the fix rather than infer it. */
  trimmedLo: number; trimmedHi: number;
}

/**
 * WHERE THE PIPE STOPS: the OUTER FACE of the room's wall, less a lap.
 *
 * This was `+0.10` — ten centimetres of corridor floor left INSIDE the room's
 * floor outline, so the two plates overlapped rather than met. That reasoning
 * was right about seams and wrong about what lies between: the room's wall is
 * 0.25m of masonry standing OUTSIDE its floor outline, so a plate reaching 0.10m
 * past the outline had already driven through all of it. The corridor's slab,
 * the room's wall and the doorframe were all claiming the same strip of ground.
 *
 * Josh named it exactly: *"the corridor cleanly expands till the floor and then
 * we stick the doorframe inside the geometry ... it's the same as a pipe and
 * the pipe's connector."* A pipe stops at the socket's FACE. So the trim now
 * pulls the plate back by the wall thickness, and the frame floors the band it
 * vacates (`level/frame.ts` — the sill).
 *
 * The lap survives, on the other side of the joint: the plate stops `LAP` short
 * of the wall's outer face so it and the sill overlap by that much. A joint
 * that meets exactly is one rounding away from a hairline of void.
 */
export const WALL_SEAT = WALL_T;
export const LAP = 0.05;
/** Signed, and negative: how far past the room's floor outline the plate may
 *  reach. Kept exported under the old name because tests and audits measure
 *  against it, but it is no longer an overlap — it is a SETBACK. */
export const OVERLAP = -(WALL_SEAT - LAP);
/** Never trim a corridor down to nothing: a short link between two rooms can be
 *  almost entirely inside them, and a plate has to remain to stand on. */
const MIN_REMAINING = 0.8;

/**
 * The floor/ceiling plate a corridor should build, given the rooms it runs into.
 *
 * Pure. Takes the polygons rather than the RoomSpecs so it can be tested with
 * three lines of setup, and so it cannot accidentally reach for anything else
 * about a room.
 */
export function plateExtentFor(
  rect: { x: number; z: number; w: number; d: number },
  roomPolys: ReadonlyArray<Poly>,
  overlap = OVERLAP,
  /**
   * Which way the corridor RUNS, when the caller knows (RoomSpec.alongX).
   *
   * Inferred from `w >= d` otherwise, and that inference is the travel axis only while
   * the leg is longer than it is wide. The middle leg of a Z routinely is not —
   * measured on d6/s4242, cor-p0-2 is 1.55m wide and 1.38m long — and trimming such a
   * leg along the wrong axis walks its WIDTH looking for the room, finds the room at
   * both ends, and hands back a plate cut down the middle of a passage.
   */
  alongXHint?: boolean,
): PlateExtent {
  const untrimmed: PlateExtent = { w: rect.w, d: rect.d, x: rect.x, z: rect.z, trimmedLo: 0, trimmedHi: 0 };
  if (roomPolys.length === 0) return untrimmed;

  const alongX = alongXHint ?? rect.w >= rect.d;
  const lat = alongX ? rect.z : rect.x;
  const len = alongX ? rect.w : rect.d;
  const lo = (alongX ? rect.x : rect.z) - len / 2;
  const inside = (t: number) => {
    const px = alongX ? t : lat, pz = alongX ? lat : t;
    return roomPolys.some((p) => pointInPoly(p, px, pz));
  };

  // Walk in from each end and find where the corridor LEAVES the room. Sampled
  // rather than solved: the corridor's centre-line can cross a polygon at any
  // angle, and 5cm steps are an order of magnitude finer than the thing being
  // measured.
  const STEP = 0.05;
  const steps = Math.max(2, Math.ceil(len / STEP));
  let cutLo = 0, cutHi = 0;
  for (let i = 0; i <= steps; i++) {
    if (!inside(lo + (len * i) / steps)) break;
    cutLo = (len * i) / steps;
  }
  for (let i = 0; i <= steps; i++) {
    if (!inside(lo + len - (len * i) / steps)) break;
    cutHi = (len * i) / steps;
  }
  // Pull back to the wall's outer face (see OVERLAP — it is negative now, so
  // this SUBTRACTS a negative and cuts further than the polygon boundary).
  cutLo = Math.max(0, cutLo - overlap);
  cutHi = Math.max(0, cutHi - overlap);
  // A corridor buried in rooms at BOTH ends trims to nothing and leaves a hole
  // in the world. Give back whatever is needed to keep a plate.
  const excess = cutLo + cutHi - (len - MIN_REMAINING);
  if (excess > 0) {
    const total = cutLo + cutHi;
    if (total <= 0) return untrimmed;
    cutLo -= (excess * cutLo) / total;
    cutHi -= (excess * cutHi) / total;
  }
  if (cutLo < 0.02 && cutHi < 0.02) return untrimmed;

  const newLen = len - cutLo - cutHi;
  const newMid = lo + cutLo + newLen / 2;
  return alongX
    ? { w: newLen, d: rect.d, x: newMid, z: rect.z, trimmedLo: cutLo, trimmedHi: cutHi }
    : { w: rect.w, d: newLen, x: rect.x, z: newMid, trimmedLo: cutLo, trimmedHi: cutHi };
}
