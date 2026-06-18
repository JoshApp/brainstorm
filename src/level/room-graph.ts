// Room adjacency graph — the floor as nodes (rooms + corridors) joined by
// doorway edges. Pure topology: rect math only, no Three.js, no game state.
//
// This is a STANDALONE, public graph (built on demand) for systems that need to
// reason about floor connectivity — e.g. the explored-map nav cue (which exits
// still lead to undone ground). It deliberately DUPLICATES two small helpers
// (sharedOpening, rectAt) from room-culling.ts rather than refactor that file:
// the culler is the per-frame, feel/perf-sensitive path with delicate
// logicalOnly/fallback logic, and a cosmetic feature shouldn't risk it. A DRY
// merge (room-culling consuming this) is a safe, separate follow-up.

import type { RoomSpec } from './types';

const EPS = 0.05;

export interface GraphNode {
  id: string;
  cx: number; cz: number; hw: number; hd: number;   // centre + half-extents
  isCorridor: boolean;
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

/** Build the adjacency graph for a floor. `logicalOnly` sub-rooms are excluded
 *  (they have no geometry and would shadow their parent — same rule the culler
 *  uses), so rectAt falls through to the real rect that owns the space. */
export function buildRoomGraph(spec: { rooms: RoomSpec[]; corridors: RoomSpec[] }): RoomGraph {
  const nodes = new Map<string, GraphNode>();
  const add = (id: string, r: { x: number; z: number; w: number; d: number }, isCorridor: boolean) =>
    nodes.set(id, { id, cx: r.x, cz: r.z, hw: r.w / 2, hd: r.d / 2, isCorridor });
  for (const r of spec.rooms) if (!r.logicalOnly) add(r.id, r.rect, false);
  for (const c of spec.corridors) add(c.id, c.rect, true);

  // Adjacency: O(n²), n small. Two rects connect if a wall edge coincides and
  // overlaps — the doorway, whose midpoint keys the archway glow.
  const edges: GraphEdge[] = [];
  const arr = [...nodes.values()];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const o = sharedOpening(arr[i], arr[j]);
      if (o) edges.push({ a: arr[i].id, b: arr[j].id, mx: o.x, mz: o.z });
    }
  }

  const rectAt = (x: number, z: number): GraphNode | null => {
    let best: GraphNode | null = null;
    for (const n of nodes.values()) {
      if (x >= n.cx - n.hw - EPS && x <= n.cx + n.hw + EPS &&
          z >= n.cz - n.hd - EPS && z <= n.cz + n.hd + EPS) {
        if (!best || n.hw * n.hd < best.hw * best.hd) best = n;
      }
    }
    return best;
  };
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
