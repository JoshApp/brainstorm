import { pointInPoly, type Poly } from './room-shape';

// ── WHICH ROOM IS THIS POINT IN? ─────────────────────────────────────────────
//
// One question, asked by three systems that must agree: the culler (what do I
// draw), the nav/room graph (what is next to what), and now the frame-boundary
// resolver (which two rooms does this doorway join). They had two copies of the
// answer, and room-graph.ts said so in a comment — *"a DRY merge is a safe,
// separate follow-up"* — which is this.
//
// ── AND A POLYGON ROOM IS NOT ITS BOUNDING BOX ───────────────────────────────
//
// The rule that makes this non-obvious, and the one that has broken four
// different systems this session. A corridor rect deliberately ends INSIDE the
// room it serves, because that is the only way it can reach a wall that sits
// back from the room's own bounding box. So at a point a metre inside a polygon
// room, TWO rects contain you: the room's box and the corridor's.
//
// Smallest-box-wins picks the corridor, and everything downstream is then about
// the wrong room. So a rect whose POLYGON contains the point beats one that
// merely has a box around it, always; among equals, the smallest box wins.
//
// Pure, THREE-free, and exported so an audit can ask the shipping question
// rather than re-implement it and launder a guess as a measurement.

/** Slack on the box test, metres. A point exactly on a shared edge belongs to
 *  both, and refusing both is worse than picking one. */
export const RECT_EPS = 0.05;

export interface RectLike {
  cx: number; cz: number; hw: number; hd: number;
  /** The real floor, when the room has one. Absent for corridors and for the
   *  rect-era rooms, whose box IS their floor. */
  poly?: Poly;
}

/**
 * The rect a world point sits in, or null.
 *
 * Generic over the node type so the culler keeps its `RectNode` and the graph
 * keeps its `GraphNode` — this owns the RULE, not their data.
 */
export function rectAtIn<T extends RectLike>(nodes: Iterable<T>, x: number, z: number): T | null {
  let best: T | null = null;
  let bestIsReal = false;
  for (const n of nodes) {
    if (x < n.cx - n.hw - RECT_EPS || x > n.cx + n.hw + RECT_EPS
      || z < n.cz - n.hd - RECT_EPS || z > n.cz + n.hd + RECT_EPS) continue;
    const real = !!n.poly && n.poly.length >= 3 && pointInPoly(n.poly, x, z);
    if (real && !bestIsReal) { best = n; bestIsReal = true; continue; }
    if (real !== bestIsReal) continue;                       // a box never beats a floor
    if (!best || n.hw * n.hd < best.hw * best.hd) best = n;
  }
  return best;
}
