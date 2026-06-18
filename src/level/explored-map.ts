// Explored-map nav cue — "fog-of-war as light". Decides each archway's warm/cold
// state: an archway is COLD when everything reachable BEYOND it (away from the
// player's current room) is fully explored + cleared, WARM while there's unseen
// or undone ground that way. Directional — the same corridor reads warm from the
// side that still leads somewhere and cold from the side that only leads back.
//
// Presentation-only: this is an UNTAGGED system (excluded from the sim digest /
// headless replay). It reads camera position + the live level, and writes the
// `cold` flag on archway glow handles (scene/threshold-draft.ts renders them).
// No RNG, no clock, no entity mutation. Per-floor; rebuilds when the level swaps.

import * as THREE from 'three';
import type { LiveLevel } from './builder';
import { buildRoomGraph, type RoomGraph, type GraphEdge } from './room-graph';
import { getArchwayLures, type Lure } from '../scene/threshold-draft';
import { DEV } from '../debug/dev';

const MATCH_TOL = 0.3;   // m — archway glow (x,z) → doorway-edge midpoint

interface ArchwayLink { lure: Lure; a: string; b: string; }

let graph: RoomGraph | null = null;
let activeLevel: LiveLevel | null = null;
let links: ArchwayLink[] = [];
const visited = new Set<string>();
// `discovered` is the secret-room gate: the reachability traverses discovered
// nodes only. Today every node is discovered at build (no secret content yet);
// when secret rooms land they stay undiscovered until found, so a corridor
// leading only to one reads COLD and never betrays it.
const discovered = new Set<string>();
// `objective` rooms are NEVER done — the way to them stays lit no matter what.
// Today that's the room with the down-stairs: the descent is always worth
// finding, so its path never goes cold. Computed once per floor on rebuild.
const objective = new Set<string>();

function rebuild(level: LiveLevel): void {
  graph = buildRoomGraph(level.spec);
  visited.clear();
  discovered.clear();
  objective.clear();
  for (const id of graph.nodes.keys()) discovered.add(id);
  // The down-stairs room is always an objective — its path never goes cold.
  for (const s of level.spec.stairs ?? []) {
    const n = graph.rectAt(s.x, s.z);
    if (n) objective.add(n.id);
  }
  // Match each archway lure to its doorway edge by nearest midpoint. A lure that
  // matches no edge (a perimeter opening to nowhere, a logical seam) gets no link
  // → never kindled → stays dark (the safe default).
  links = [];
  for (const lure of getArchwayLures()) {
    let best: GraphEdge | null = null;
    let bestD = Infinity;
    for (const e of graph.edges) {
      const d = Math.hypot(e.mx - lure.x, e.mz - lure.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best && bestD < MATCH_TOL) links.push({ lure, a: best.a, b: best.b });
  }
  activeLevel = level;

  // DEV: matching-health probe — confirms archway glows actually bound to graph
  // edges on a real floor (the one thing the unit tests can't cover). Stripped
  // from prod by the DEV gate.
  if (DEV) {
    (globalThis as Record<string, unknown>).__exploredMap = () => ({
      nodes: [...graph!.nodes.keys()],
      corridors: [...graph!.nodes.values()].filter((n) => n.isCorridor).map((n) => n.id),
      objective: [...objective],
      visited: [...visited],
      matched: links.length,
      lures: getArchwayLures().length,
      links: links.map((l) => ({ a: l.a, b: l.b, cold: l.lure.cold, near: l.lure.near })),
    });
  }
}

/** Snapshot the nav state the cold decision reads. */
export interface ExploredState {
  curId: string | undefined;
  visited: ReadonlySet<string>;     // rooms the player has ENTERED (exploration is the only gate)
  objective: ReadonlySet<string>;   // rooms that are never done (the down-stairs) — path stays lit
  discovered: ReadonlySet<string>;  // nodes visible to the graph (secret-room gate)
}

/** Pure cold decision for one archway edge (a,b): COLD iff the far side (the
 *  component NOT holding the player, when this doorway is cut) is entirely done.
 *  A corridor node is always done (pass-through); a ROOM is done once ENTERED
 *  (purely exploratory — loot/enemies/interactables don't gate it), EXCEPT an
 *  objective room (the down-stairs) which is never done. Undiscovered nodes are
 *  invisible. Player on both sides (a cycle) or neither (outside) → WARM. */
export function archwayCold(graph: RoomGraph, a: string, b: string, s: ExploredState): boolean {
  // BFS from `start` over DISCOVERED nodes, never crossing the cut doorway (a,b).
  const reach = (start: string): Set<string> => {
    const seen = new Set<string>();
    if (!s.discovered.has(start)) return seen;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of graph.neighbors(u)) {
        if (seen.has(v) || !s.discovered.has(v)) continue;
        if ((u === a && v === b) || (u === b && v === a)) continue;   // the cut doorway
        seen.add(v);
        stack.push(v);
      }
    }
    return seen;
  };
  const done = (id: string): boolean => {
    const node = graph.nodes.get(id);
    if (!node) return true;
    if (node.isCorridor) return true;             // corridors hold nothing — pass-through
    if (s.objective.has(id)) return false;        // the down-stairs — never done
    return s.visited.has(id);                     // entered = explored (purely exploratory)
  };
  const allDone = (set: Set<string>): boolean => {
    for (const id of set) if (!done(id)) return false;
    return true;
  };
  const compA = reach(a);
  const compB = reach(b);
  const inA = s.curId !== undefined && compA.has(s.curId);
  const inB = s.curId !== undefined && compB.has(s.curId);
  if (inA && !inB) return allDone(compB);
  if (inB && !inA) return allDone(compA);
  return false;   // cycle (both) or player outside (neither) → WARM
}

export function tickExploredMap(camera: THREE.Camera, level: LiveLevel | null | undefined): void {
  if (!level) return;
  if (level !== activeLevel) rebuild(level);
  if (!graph || links.length === 0) return;

  const cur = graph.rectAt(camera.position.x, camera.position.z);
  if (cur) { visited.add(cur.id); discovered.add(cur.id); }
  const curId = cur?.id;
  // NEAR is gated to ROOMS, not corridors: a glyph shows on the wall of the room
  // you're standing in (the entrance you're looking at), never at a corridor's
  // ends. So walking through a corridor doesn't light both its archways.
  const inRoom = !!cur && !cur.isCorridor;

  const state: ExploredState = { curId, visited, objective, discovered };
  for (const link of links) {
    link.lure.cold = archwayCold(graph, link.a, link.b, state);
    link.lure.near = inRoom && (link.a === curId || link.b === curId);
  }
}

/** Drop per-floor state (the next new level rebuilds anyway; explicit for teardown). */
export function resetExploredMap(): void {
  graph = null;
  activeLevel = null;
  links = [];
  visited.clear();
  discovered.clear();
  objective.clear();
}
