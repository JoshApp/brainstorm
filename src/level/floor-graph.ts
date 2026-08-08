import type { RoomTypeId } from './room-types';

// ── THE FLOOR, AS A GRAPH ────────────────────────────────────────────────────
//
// Josh: *"isn't this a whole branch of math — having a graph with nodes and how
// to position it... step by step theoretically satisfying conditions as a plan
// and then shifting it around to create the final layout?"*
//
// Yes, and this file is the first step of it: making the graph the floor
// ALREADY HAS into a thing that exists.
//
// `generatePolyFloor` walks a spine, hangs pockets off it, and sometimes adds a
// chord. That is a graph — nodes with roles, edges with kinds — but it lives in
// control flow, so every question about it has had to be re-derived downstream
// from rectangles. `mainlineRooms` reconstructs a path by BFS over link pairs;
// the loop pass counts cycles by inspecting rects; the reach audit floods a
// walkable grid to answer "can you get there", which is a geometry question
// standing in for a topology one.
//
// ── WHY THIS IS WORTH DOING, IN THIS CODEBASE SPECIFICALLY ───────────────────
//
// Look at what keeps happening here. An audit gets written, it finds "16 of 240
// floors violate this", a producer gets patched. Fire-and-deal sharing a room.
// Claim contradictions. Webs on the mainline — patched twice, from both ends,
// because the rule was about the MAINLINE and the test was counting doors.
//
// Every one of those is a GLOBAL property enforced by LOCAL greedy decisions
// that cannot see each other. On a graph they are cheap and total: lock-before-
// key is a topological order, "every floor has a cycle" is counting edges, "the
// boss is a leaf" is a degree check, "this one-way drop does not strand you" is
// reachability. You do not audit those afterwards — you reject the graph and
// roll again.
//
// And it is tractable at this size rather than aspirational. Measured: 7 rooms
// per floor at the median, 10 at the most. Full backtracking search is free on
// ten nodes. The value is not an algorithm, it is putting the constraints
// somewhere they can all see each other.
//
// ── WHAT THIS FILE IS NOT (YET) ──────────────────────────────────────────────
//
// It does not generate anything. The walk still decides the floor, and this
// records what it decided — deliberately, because a refactor with no behaviour
// delta can be proved equivalent against the shipping pipeline, and a new
// generator cannot. Constraints and reroll come next, on this seam.

export type EdgeKind =
  /** On the path from the entrance toward the stairs. */
  | 'spine'
  /** A dead-end detour hung off the spine. */
  | 'spur'
  /** The edge that closes a cycle — a way back that is not the way you came. */
  | 'chord';

export interface GraphNode {
  id: string;
  type: RoomTypeId;
  /** Position in the spine walk. Pockets take their parent's index; it orders
   *  the floor without being a coordinate. */
  index: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface FloorGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Where the player arrives, and where they leave. Either may be absent on a
   *  degenerate floor, and every query here copes rather than assuming. */
  entrance?: string;
  exit?: string;
}

/** Adjacency, built once per query set. Cheap at this size — ten nodes. */
function adjacency(g: FloorGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b); else adj.set(a, [b]);
  };
  for (const e of g.edges) { add(e.from, e.to); add(e.to, e.from); }
  return adj;
}

export function neighbours(g: FloorGraph, id: string): string[] {
  return adjacency(g).get(id) ?? [];
}

/** How many ways out a room has. One means a dead end. */
export function degree(g: FloorGraph, id: string): number {
  return (adjacency(g).get(id) ?? []).length;
}

/** Every room reachable from `start`, following edges. */
export function reachableFrom(g: FloorGraph, start: string): Set<string> {
  const adj = adjacency(g);
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adj.get(queue[i]) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * The rooms on the shortest path from `from` to `to`, inclusive.
 *
 * Empty when either end is missing or nothing connects them. Callers that need
 * "the whole floor" as a fallback should say so themselves rather than have
 * this lie — `mainline` below is the one that wants that behaviour, and it is
 * explicit about it.
 */
export function pathBetween(g: FloorGraph, from?: string, to?: string): string[] {
  if (!from || !to) return [];
  const adj = adjacency(g);
  const parent = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  let found = from === to;
  for (let i = 0; i < queue.length && !found; i++) {
    for (const next of adj.get(queue[i]) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, queue[i]);
      if (next === to) { found = true; break; }
      queue.push(next);
    }
  }
  if (!found) return [];
  const out: string[] = [];
  for (let cur: string | null | undefined = to; cur != null; cur = parent.get(cur)) out.push(cur);
  return out.reverse();
}

/**
 * The rooms the player must pass through to finish the floor.
 *
 * Falls back to EVERY room when the ends are unknown, which is the behaviour
 * the placement rules want: a rule of the form "never on the mainline" must
 * fail closed. Gating a detour you chose is fine; gating the way on is the bug
 * that shipped twice (see poly-decor's `onMainline`).
 */
export function mainline(g: FloorGraph): Set<string> {
  const path = pathBetween(g, g.entrance, g.exit);
  return path.length ? new Set(path) : new Set(g.nodes.map((n) => n.id));
}

/** Rooms with exactly one way out. */
export function leaves(g: FloorGraph): string[] {
  const adj = adjacency(g);
  return g.nodes.filter((n) => (adj.get(n.id) ?? []).length === 1).map((n) => n.id);
}

/**
 * How many independent cycles the floor has — the circuit rank, |E| - |V| + C.
 *
 * This is the number Unexplored's whole design rests on and the one this
 * generator retrofits with `chord` edges. Zero means a tree: every route out is
 * the route back, and the floor reads as a corridor with rooms on it.
 */
export function cycleCount(g: FloorGraph): number {
  const seen = new Set<string>();
  let components = 0;
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue;
    components++;
    for (const r of reachableFrom(g, n.id)) seen.add(r);
  }
  return g.edges.length - g.nodes.length + components;
}

/**
 * Everything wrong with this floor's topology, as sentences.
 *
 * Returns an empty array for a sound floor. Nothing consumes it yet — the point
 * of stating the rules where they can all see each other is that the next step
 * can REJECT a plan instead of auditing a built floor, and this is the function
 * that reroll will call.
 */
export function faults(g: FloorGraph): string[] {
  const out: string[] = [];
  if (g.nodes.length === 0) return ['the floor has no rooms'];

  if (g.entrance && g.exit) {
    if (!reachableFrom(g, g.entrance).has(g.exit)) {
      out.push(`the exit ${g.exit} is not reachable from the entrance ${g.entrance}`);
    }
  }
  const orphans = g.entrance
    ? g.nodes.filter((n) => !reachableFrom(g, g.entrance!).has(n.id))
    : [];
  if (orphans.length) out.push(`${orphans.length} rooms are cut off: ${orphans.map((n) => n.id).join(', ')}`);

  for (const e of g.edges) {
    if (e.from === e.to) out.push(`edge ${e.id} joins ${e.from} to itself`);
    if (!g.nodes.some((n) => n.id === e.from)) out.push(`edge ${e.id} starts at unknown room ${e.from}`);
    if (!g.nodes.some((n) => n.id === e.to)) out.push(`edge ${e.id} ends at unknown room ${e.to}`);
  }

  // ── A DETOUR IS A DEAD END, UNLESS A CHORD DELIBERATELY OPENED IT ──────────
  //
  // A spur is a promise: it is somewhere you CHOSE to go, so its far room must
  // have one way out. When a pocket quietly stops being a cul-de-sac the floor
  // loses the thing detours are for — measured, cobwebs went to zero across 72
  // floors, because a web only hangs in a room with a single exit.
  //
  // But exactly one pocket per floor is MEANT to open: the loop pass grows a
  // spare pocket beyond what the plan owes and runs its chord to that one. So
  // the rule is not about degree, it is about which EDGES the degree is made of
  // — spine and spur edges must not multiply, chords may. Stating it on the
  // graph makes that one line; in prose it took three paragraphs and still
  // shipped as "count the doors" twice.
  const adj = adjacency(g);
  const nonChord = new Map<string, number>();
  for (const e of g.edges) {
    if (e.kind === 'chord') continue;
    nonChord.set(e.from, (nonChord.get(e.from) ?? 0) + 1);
    nonChord.set(e.to, (nonChord.get(e.to) ?? 0) + 1);
  }
  for (const e of g.edges) {
    if (e.kind !== 'spur') continue;
    const solid = nonChord.get(e.to) ?? 0;
    if (solid > 1) {
      out.push(`spur ${e.id} leads to ${e.to}, which has ${solid} ways out that are not `
        + `shortcuts (${adj.get(e.to)?.length ?? 0} total) — it is not a detour`);
    }
  }
  return out;
}
