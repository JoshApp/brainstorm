// Room adjacency graph — the floor as nodes (rooms + corridors) joined by
// doorway edges. Pure topology: rect math only, no Three.js, no game state.
//
// This is a STANDALONE, public graph (built on demand) for systems that need to
// reason about floor connectivity — e.g. the explored-map nav cue (which exits
// still lead to undone ground). It deliberately DUPLICATES two small helpers
// (sharedOpening, rectAt) from room-culling.ts rather than refactor that file:
// the culler is the per-frame, feel/perf-sensitive path with delicate
// logicalOnly/fallback logic, and a cosmetic feature shouldn't risk it.
//
// HALF OF THAT DEBT IS PAID: `rectAt` — the "which room is this point in" rule,
// and the one that keeps breaking because a polygon room is not its bounding
// box — now lives once, in level/rect-at.ts, and both files call it. It moved
// when a THIRD consumer appeared (the culler resolving which two rooms a
// doorway joins) and an audit needed to ask the shipping question rather than a
// copy of it. `sharedOpening` is still duplicated.

import { pointInPoly, type Poly } from './room-shape';
import { rectAtIn, RECT_EPS } from './rect-at';
import type { RoomSpec } from './types';

const EPS = RECT_EPS;

export interface GraphNode {
  id: string;
  cx: number; cz: number; hw: number; hd: number;   // centre + half-extents
  isCorridor: boolean;
  /** The room's real floor, when it has one. A polygon room's rect is its
   *  BOUNDING BOX and the floor sits back from it — see `overlapOpening`. */
  poly?: Poly;
}
export interface GraphEdge {
  a: string; b: string;   // node ids
  mx: number; mz: number; // doorway midpoint (the join key for archway glows)
}
export interface RoomGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** Node whose AABB contains (x,z), smallest-wins (corridor over room), or null. */
  rectAt(x: number, z: number): GraphNode | null;
  /** Adjacent node ids of `id`. */
  neighbors(id: string): string[];
}

/** Centre-of-overlap doorway between two edge-adjacent rects, or null. Mirrors
 *  room-culling.ts:sharedOpening. */
function sharedOpening(a: GraphNode, b: GraphNode): { x: number; z: number } | null {
  const ax0 = a.cx - a.hw, ax1 = a.cx + a.hw, az0 = a.cz - a.hd, az1 = a.cz + a.hd;
  const bx0 = b.cx - b.hw, bx1 = b.cx + b.hw, bz0 = b.cz - b.hd, bz1 = b.cz + b.hd;
  if (Math.abs(ax1 - bx0) < EPS || Math.abs(bx1 - ax0) < EPS) {
    const z0 = Math.max(az0, bz0), z1 = Math.min(az1, bz1);
    if (z1 - z0 > EPS) {
      const x = Math.abs(ax1 - bx0) < EPS ? ax1 : ax0;
      return { x, z: (z0 + z1) / 2 };
    }
  }
  if (Math.abs(az1 - bz0) < EPS || Math.abs(bz1 - az0) < EPS) {
    const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1);
    if (x1 - x0 > EPS) {
      const z = Math.abs(az1 - bz0) < EPS ? az1 : az0;
      return { x: (x0 + x1) / 2, z };
    }
  }
  return null;
}

/**
 * The doorway where a CORRIDOR ends INSIDE a room, rather than against it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Josh: *"the eyes above the doors, the eye navigation isn't working, they are
 * always closed."*
 *
 * The eye opens when the nav layer says this doorway leads somewhere unexplored,
 * and the nav layer reads THIS GRAPH. `sharedOpening` connects two rects whose
 * EDGES COINCIDE, which is what the vault composer's grid guarantees and what a
 * polygon floor never produces: a polygon's wall sits back from its bounding
 * box, so a corridor that MEETS THE WALL necessarily ENDS INSIDE THE BOX. The
 * two rects overlap; no edge coincides; no graph edge is made.
 *
 * Measured over 200 generated floors: 2812 nodes and FOURTEEN edges. 99% of
 * rooms had no neighbour at all. The eyes were the visible symptom; every reader
 * of this graph was getting the same empty answer.
 *
 * ── WHAT IT RETURNS, AND WHY NOT JUST THE OVERLAP CENTRE ─────────────────────
 *
 * The midpoint keys the archway lure by nearest-match within 30cm, so it has to
 * be THE DOORWAY, not the middle of the overlapped area — a corridor can
 * penetrate a notched polygon's box by metres. So walk the corridor's own axis
 * through the overlap and return the point where it crosses into the room's
 * floor. That IS the doorway, by the same definition the wall builder uses.
 *
 * Only ever corridor-to-room. Two polygon ROOMS whose bounding boxes overlap are
 * not neighbours — they are two rooms with walls between them and a box that
 * lies about it — and admitting that pair would invent doorways that no wall
 * builder ever cut.
 */
function overlapOpening(cor: GraphNode, room: GraphNode): { x: number; z: number } | null {
  const ox0 = Math.max(cor.cx - cor.hw, room.cx - room.hw);
  const ox1 = Math.min(cor.cx + cor.hw, room.cx + room.hw);
  const oz0 = Math.max(cor.cz - cor.hd, room.cz - room.hd);
  const oz1 = Math.min(cor.cz + cor.hd, room.cz + room.hd);
  if (ox1 - ox0 < EPS || oz1 - oz0 < EPS) return null;
  // No polygon: the box IS the floor, so the overlap centre is the best answer.
  if (!room.poly || room.poly.length < 3) return { x: (ox0 + ox1) / 2, z: (oz0 + oz1) / 2 };

  // Along the corridor's LONG AXIS, over ITS WHOLE LENGTH — not just the part
  // that overlaps the room's box.
  //
  // The box is exactly the thing that is lying here. Where a corridor pushes
  // well past the box edge, the box edge is already on the room's floor, and
  // returning it puts the "doorway" up to a metre inside the room — measured at
  // 0.45m and 0.87m on a real floor, against a 0.30m match tolerance, which is
  // five archway eyes that never found their doorway. Walking the corridor
  // itself finds where its centre-line CROSSES THE WALL, which is the doorway
  // by the same definition the wall builder uses, and needs no box at all.
  const alongX = cor.hw >= cor.hd;
  const lateral = alongX ? cor.cz : cor.cx;
  const c = alongX ? cor.cx : cor.cz, h = alongX ? cor.hw : cor.hd;
  const roomC = alongX ? room.cx : room.cz;
  // Start at the corridor end FURTHEST from the room and walk toward it, so the
  // first point inside is the outermost — the threshold you stand in.
  const inward = roomC >= c ? 1 : -1;
  const from = c - inward * h, to = c + inward * h;
  const steps = Math.max(4, Math.ceil(Math.abs(to - from) / 0.08));
  for (let i = 0; i <= steps; i++) {
    // Walk from the END OF THE CORRIDOR toward the room's middle, so the FIRST
    // point found inside is the outermost one — the threshold you stand in.
    const t = from + ((to - from) * i) / steps;
    const px = alongX ? t : lateral;
    const pz = alongX ? lateral : t;
    // FIRST INSIDE, not first TRANSITION. Requiring a crossing looked more
    // careful and silently dropped the commonest case: where the corridor
    // penetrates far enough that its whole overlap with the box is already on
    // the room's floor, there is nothing to cross, and the threshold is simply
    // the outermost sampled point. That mistake orphaned 8% of rooms.
    if (pointInPoly(room.poly, px, pz)) return { x: px, z: pz };
  }
  // The corridor's centre-line never met the room's floor. That is not a
  // doorway, whatever the boxes say.
  return null;
}

/**
 * The doorway a LINK declares between these two nodes, if there is one.
 *
 * ONLY corridor ↔ room. The link names the room and states the cut it enters by, so
 * the doorway's midpoint is read off the room's own outline rather than off where two
 * boxes happen to overlap.
 *
 * Room ↔ room is never an edge — there is always stone between two rooms. And
 * corridor ↔ corridor is a DOGLEG JOINT, which is a corner two legs share by
 * construction rather than a hole in anything: `sharedOpening` takes the centre of
 * their real overlap, which is the joint, where naming the two legs and averaging
 * their centres gives a point diagonally off it and outside both rects.
 */
function declaredOpening(
  a: GraphNode, b: GraphNode,
  spec: { rooms: RoomSpec[]; corridors: RoomSpec[] },
): { x: number; z: number } | null {
  if (a.isCorridor === b.isCorridor) return null;
  const cor = a.isCorridor ? a : b, room = a.isCorridor ? b : a;
  const spec_c = spec.corridors.find((c) => c.id === cor.id);
  const link = spec_c?.link;
  if (!link) return null;
  const cut = link.fromRoom === room.id ? link.aCut
    : link.toRoom === room.id ? link.bCut
    : null;
  if (!cut) return null;
  const poly = spec.rooms.find((r) => r.id === room.id)?.poly;
  if (!poly || poly.length < 3) return null;
  const p = poly[cut.edge % poly.length], q = poly[(cut.edge + 1) % poly.length];
  const t = (cut.t0 + cut.t1) / 2;
  return { x: p[0] + (q[0] - p[0]) * t, z: p[1] + (q[1] - p[1]) * t };
}

/** Build the adjacency graph for a floor. `logicalOnly` sub-rooms are excluded
 *  (they have no geometry and would shadow their parent — same rule the culler
 *  uses), so rectAt falls through to the real rect that owns the space. */
export function buildRoomGraph(spec: { rooms: RoomSpec[]; corridors: RoomSpec[] }): RoomGraph {
  const nodes = new Map<string, GraphNode>();
  const add = (id: string, r: { x: number; z: number; w: number; d: number }, isCorridor: boolean, poly?: Poly) =>
    nodes.set(id, { id, cx: r.x, cz: r.z, hw: r.w / 2, hd: r.d / 2, isCorridor, poly });
  for (const r of spec.rooms) if (!r.logicalOnly) add(r.id, r.rect, false, r.poly);
  for (const c of spec.corridors) add(c.id, c.rect, true, c.poly);

  // Adjacency: O(n²), n small. Two rects connect if a wall edge coincides and
  // overlaps — the doorway, whose midpoint keys the archway glow. FAILING THAT,
  // a corridor that ends inside a room's box connects too (overlapOpening) —
  // the polygon case, and the one this graph was blind to.
  const edges: GraphEdge[] = [];
  const arr = [...nodes.values()];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      // ── A DECLARED DOORWAY IS AN EDGE, AND IT DOES NOT NEED THE BOXES ──────
      //
      // Stage 3 of docs/LINKS-V3.md. Everything below this was rect geometry: a
      // shared wall line, or failing that a corridor whose box ends inside a room's.
      // That second rule only worked because a corridor rect was deliberately pushed
      // 0.9m THROUGH the wall so it would overlap — and the moment the overlap was
      // dropped the graph fell to ZERO edges for seven rooms, taking every loop, the
      // wall-eye navigation and the cul-de-sac accounting with it.
      //
      // The link states which rooms it joins and where it enters each. Asked first,
      // so the boxes are only consulted for the pairs that have no link to ask.
      let o = declaredOpening(a, b, spec);
      if (!o) o = sharedOpening(a, b);
      // ROOM-TO-ROOM IS THE ONLY PAIR THAT MAY NOT OVERLAP-CONNECT. Two polygon
      // rooms whose bounding boxes overlap are two rooms with walls between
      // them and a box that lies about it. Corridor-to-room is the polygon
      // doorway; corridor-to-corridor is a DOGLEG JOINT, where the cross piece
      // is laid ACROSS the end of a leg and the two overlap by design — that
      // pair was also missing, which orphaned whole branches past a bend.
      if (!o && (a.isCorridor || b.isCorridor)) {
        const cor = a.isCorridor ? a : b, room = a.isCorridor ? b : a;
        o = overlapOpening(cor, room);
      }
      if (o) edges.push({ a: a.id, b: b.id, mx: o.x, mz: o.z });
    }
  }

  // WHICH ROOM AM I STANDING IN. Smallest containing rect, EXCEPT that a node
  // whose polygon actually contains the point beats one that merely has it in
  // its box.
  //
  // On a polygon floor the corridor rects overlap the room rects by
  // construction, and a corridor is the smaller box — so standing well inside a
  // room, in the part its entry corridor's box happens to reach, answered "you
  // are in a corridor". The nav layer only shows door eyes to a player who is in
  // a ROOM, so that alone would keep them shut in exactly the places they matter.
  const rectAt = (x: number, z: number): GraphNode | null => rectAtIn(nodes.values(), x, z);
  const neighbors = (id: string): string[] => {
    const out: string[] = [];
    for (const e of edges) {
      if (e.a === id) out.push(e.b);
      else if (e.b === id) out.push(e.a);
    }
    return out;
  };

  return { nodes, edges, rectAt, neighbors };
}
