// Explored-map nav cue — "fog-of-war as light". Decides each archway's warm/cold
// state: an archway is WARM when going through it gets you CLOSER to somewhere
// you haven't finished, and COLD otherwise. Directional — the same corridor
// reads warm from the side that leads onward and cold from the side that only
// leads back, and on a loop it opens the short way round and shuts the long one.
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

/**
 * How far an archway may sit from its doorway's graph midpoint, in metres.
 *
 * Was 0.30, which is the right number for the vault path: there a doorway
 * midpoint is exact, because both rects are axis-aligned and their shared edge
 * IS the opening. A polygon room's wall can run at any angle, and the archway is
 * centred on the CUT SEGMENT of that slanted wall while the graph's midpoint is
 * where the corridor's centre-line crosses it. On a 45-degree wall those are
 * most of a metre apart — measured at 0.41m and 0.85m on a real floor, so five
 * of nine eyes never found their doorway and stayed shut for good.
 *
 * 3.0m is deliberately generous, and it is safe because the MATCHING is what
 * constrains it, not this number: doorways are assigned greedily under a cap of
 * two archways each (see below), so a loose radius can no longer let one door
 * swallow three eyes. The cap exists only to refuse a fitting that belongs to no
 * doorway at all rather than bind it to an unrelated one.
 */
const MATCH_TOL = 3.0;   // m — archway glow (x,z) → doorway-edge midpoint

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
// The cached nav distance fields + the `visited.size` they were built for.
// Invalidated on floor rebuild and whenever the player enters a new room.
let field: NavField | null = null;
let fieldVisited = -1;

function rebuild(level: LiveLevel): void {
  graph = buildRoomGraph(level.spec);
  visited.clear();
  discovered.clear();
  objective.clear();
  field = null;
  fieldVisited = -1;
  for (const id of graph.nodes.keys()) discovered.add(id);
  // The down-stairs room is always an objective — its path never goes cold.
  for (const s of level.spec.stairs ?? []) {
    const n = graph.rectAt(s.x, s.z);
    if (n) objective.add(n.id);
  }
  // MATCH EACH ARCHWAY TO ITS DOORWAY — ASSIGNED UNDER A CAPACITY, not picked
  // independently.
  //
  // Nearest-wins on its own let three archways bind to one doorway (measured on
  // a real floor) while a door two rooms over went unclaimed — because each
  // lure asked its own question and none of them knew a doorway has exactly TWO
  // faces. Sorting every (lure, doorway) pair by distance and filling greedily
  // under that cap costs nothing at this size and makes the mis-pair
  // unrepresentable rather than unlikely.
  //
  // A lure that matches nothing within MATCH_TOL, or whose doorways are all
  // taken by nearer archways, gets no link → never kindled → stays dark. That
  // is the safe default and the right answer for a perimeter fitting that is
  // not a doorway at all.
  links = [];
  const lures = getArchwayLures();
  const pairs: Array<{ li: number; e: GraphEdge; d: number }> = [];
  for (let li = 0; li < lures.length; li++) {
    for (const e of graph.edges) {
      const d = Math.hypot(e.mx - lures[li].x, e.mz - lures[li].z);
      if (d < MATCH_TOL) pairs.push({ li, e, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d);
  const takenLure = new Set<number>();
  const faces = new Map<GraphEdge, number>();
  for (const p of pairs) {
    if (takenLure.has(p.li)) continue;
    const used = faces.get(p.e) ?? 0;
    if (used >= 2) continue;
    faces.set(p.e, used + 1);
    takenLure.add(p.li);
    links.push({ lure: lures[p.li], a: p.e.a, b: p.e.b });
  }
  activeLevel = level;

  // DEV: matching-health probe — confirms archway glows actually bound to graph
  // edges on a real floor (the one thing the unit tests can't cover). Stripped
  // from prod by the DEV gate.
  if (DEV) {
    // MATCHED vs LURES, once per floor, in the log. The eyes went dead for
    // months and nothing said so: every piece worked in isolation and the graph
    // they all read had fourteen edges across two hundred floors. One line here
    // makes "the nav layer sees nothing" visible in any headless snap.
    const misses: string[] = [];
    for (const lure of getArchwayLures()) {
      let d = Infinity;
      for (const e of graph.edges) d = Math.min(d, Math.hypot(e.mx - lure.x, e.mz - lure.z));
      if (d >= MATCH_TOL) misses.push(d.toFixed(2));
    }
    // A doorway has two faces, so two lures. Three means the matcher bound an
    // archway to a door it does not belong to, which is the only way raising
    // MATCH_TOL could hurt — so it is reported rather than assumed away.
    const perEdge = new Map<string, number>();
    for (const l of links) perEdge.set(`${l.a}|${l.b}`, (perEdge.get(`${l.a}|${l.b}`) ?? 0) + 1);
    const crowded = [...perEdge.entries()].filter(([, n]) => n > 2);
    console.log(`[exploredMap] ${graph.nodes.size} nodes, ${graph.edges.length} edges · ${links.length}/${getArchwayLures().length} archway lures matched to a doorway${misses.length ? ` · missed by ${misses.join('m, ')}m` : ''}${crowded.length ? ` · OVERCLAIMED ${crowded.map(([k, n]) => `${k}×${n}`).join(', ')}` : ''}`);
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

/** Rooms the player has not yet entered. Corridors hold nothing, so they are
 *  never a destination — only something you pass through. */
function unseenRooms(graph: RoomGraph, s: ExploredState): string[] {
  const out: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.isCorridor || !s.discovered.has(id) || s.visited.has(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * ── WHY THIS IS A DISTANCE QUESTION AND NOT A CONNECTIVITY ONE ───────────────
 *
 * This used to cut the doorway and ask whether the component beyond it was
 * fully done. That is a TREE algorithm, and it silently stopped meaning
 * anything the moment floors grew cycles: cut an edge on a loop and nothing
 * separates, both sides still reach the player, and the fall-through said WARM.
 * Measured over 240 floors — 89% of which contain a cycle — 85% of all eyes were
 * open, and in 35% of room visits EVERY door in the room was open. A cue that is
 * on five-sixths of the time is not a weak cue, it is furniture.
 *
 * The question that stays well-defined on any graph is DIRECTIONAL DISTANCE:
 * does stepping through this doorway get me STRICTLY CLOSER to something I
 * haven't finished? On a tree that reproduces the old answer exactly. On a loop
 * it opens the short way round and shuts the long one, which is the read a
 * player wants and the old model could not express.
 *
 * ── NEAREST GOAL, NOT EVERY GOAL ────────────────────────────────────────────
 *
 * The first version of this lit a door if ANY unfinished room was closer that
 * way, on the argument that a door onto new ground is worth taking even when
 * there is nearer new ground elsewhere. Measured across a walk of 1632 rooms
 * that is still not a cue: in a three-exit room it lit two exits 291 times out
 * of 382, and in a four-exit room it lit three of them half the time. Aiming at
 * the SINGLE nearest goal lights exactly one exit in 284 of those 384 rooms,
 * which is the difference between a hint and a wall of open eyes.
 *
 * ── THE STAIRS ARE A GOAL OF LAST RESORT ────────────────────────────────────
 *
 * The old model made the down-stairs room "never done" so the way out stayed
 * lit. Under a nearest-goal rule that is actively harmful: if the stairs happen
 * to be the closest unfinished thing on arrival, the eye walks a new player
 * straight past the floor and down. So the objective is a SECOND TIER — it
 * becomes a goal only once every room has been entered. The eye leads you
 * around the floor, and when the floor is spent, it leads you out.
 */
export interface NavField {
  /** Steps from each discovered node to the nearest goal. Absent = no route. */
  readonly toGoal: ReadonlyMap<string, number>;
}

/** Multi-source BFS over DISCOVERED nodes. Undiscovered (secret) nodes are not
 *  traversed and get no entry, so a passage leading only to one never lights and
 *  never betrays it. */
function distancesTo(graph: RoomGraph, sources: readonly string[], s: ExploredState): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const id of sources) {
    if (!s.discovered.has(id) || dist.has(id)) continue;
    dist.set(id, 0);
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    const du = dist.get(u)!;
    for (const v of graph.neighbors(u)) {
      if (dist.has(v) || !s.discovered.has(v)) continue;
      dist.set(v, du + 1);
      queue.push(v);
    }
  }
  return dist;
}

/** The distance field the cold decision reads. Recompute when `visited` changes;
 *  it is constant between room entries. */
export function navField(graph: RoomGraph, s: ExploredState): NavField {
  const unseen = unseenRooms(graph, s);
  // Tier 1: rooms you have not entered. Tier 2 (only once the floor is spent):
  // the way down. See the comment above — promoting the stairs to a first-class
  // goal would point a lost player at the exit instead of at the dungeon.
  const goals = unseen.length > 0 ? unseen : [...s.objective];
  return { toGoal: distancesTo(graph, goals, s) };
}

/**
 * Cold decision for one archway edge (a,b), from where the player is standing.
 * WARM iff some unfinished room is STRICTLY closer through this doorway than it
 * is from the room the player occupies. Cold otherwise — including when the
 * doorway is not one of the current room's own (those eyes are never shown; see
 * `near` in threshold-draft.ts) and when nothing unfinished remains at all.
 *
 * Pass `field` to reuse one build across every doorway on the floor; omit it and
 * one is built for this call.
 */
export function archwayCold(
  graph: RoomGraph, a: string, b: string, s: ExploredState, field?: NavField,
): boolean {
  const cur = s.curId;
  if (cur === undefined) return true;                       // player nowhere — nothing to point at
  const far = cur === a ? b : cur === b ? a : undefined;
  if (far === undefined) return true;                       // not a doorway of this room
  const f = field ?? navField(graph, s);
  const here = f.toGoal.get(cur);
  const there = f.toGoal.get(far);
  if (here === undefined || there === undefined) return true;   // no route to anything unfinished
  return !(there < here);                                       // steps closer → WARM
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
  // The distance fields only change when the set of unfinished rooms does — i.e.
  // when the player ENTERS a new room. Rebuilding them every frame would be a
  // BFS per unfinished room per frame for no new answer.
  if (visited.size !== fieldVisited) {
    field = navField(graph, state);
    fieldVisited = visited.size;
  }
  for (const link of links) {
    link.lure.cold = archwayCold(graph, link.a, link.b, state, field ?? undefined);
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
  field = null;
  fieldVisited = -1;
}
