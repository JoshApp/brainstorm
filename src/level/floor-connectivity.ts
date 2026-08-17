// ── CAN YOU WALK OUT OF THIS FLOOR? ──────────────────────────────────────────
//
// Asked of the floor that SHIPS, not of the plan that produced it.
//
// `floor-graph.ts faults()` already answers this on the graph, and answers it
// well — but the graph is the plan. It says "poly-0 links to poly-1"; whether a
// corridor rect was actually emitted between them is a separate fact, decided
// later, by a router that is allowed to fail. Measured over 520 floors, 3 of
// them (0.6%) shipped with the spawn room joined to nothing at all: a sound
// graph, a built floor you cannot leave, and every existing check green. Across
// a 12-floor run that is roughly a 7% chance of a dead run, and a dead run
// looks exactly like a hard one until the player has searched every wall.
//
// This is the fifth time in this codebase that a rule held on the plan and was
// violated on the artefact (docs/DESIGN-METHOD.md: "check final-state rules
// against the final state"). So the check reads the same LevelSpec the builder
// consumes, and `poly-floor.ts` treats a failure as a craft fault — the floor is
// REROLLED rather than repaired, because a floor that cannot be crossed has
// nothing worth salvaging and rerolling is microseconds.
//
// ── IT FLOODS THE DECLARED HOLES, NOT THE BOUNDING BOXES ─────────────────────
//
// It used to flood on box overlap: two rects sharing floor AREA were walkable
// between each other. The justification written here was that this "is exactly the
// contract the polygon corridor router works to — a corridor's mouth is placed to
// overlap the room it serves" — and that contract was the 0.9m OVERLAP, a rect
// deliberately pushed through a wall so a later pass could find the hole.
//
// Which means the check could not see a wall. Two boxes overlap whether or not there
// is a doorway between them, so the gate passed floors whose pieces touched and whose
// stone did not open — a false NEGATIVE, the direction that ships. Found from the
// other side: tests/poly-floor's flood builds the real wall geometry and reported
// rooms nobody could walk to on floors this function had just called crossable.
//
// Stage 3 of docs/LINKS-V3.md gives the exact answer instead. A link DECLARES the
// hole it needs in each end's wall, so two spaces are connected when a link joins
// them and its cut is wide enough to walk through — no geometry to intersect, no
// overlap to depend on, and it keeps working once the overlap is deleted.
//
// SCOPE: polygon floors only. Rects with no link — the ASCII vault composer's grid,
// where a room ending at z=2.5 abuts its corridor starting at z=2.5 — keep the old
// overlap rule, which is why that path is covered by `tests/floor-invariants.test.ts`
// with a grid flood instead. Loosening this to count touching edges would fit both and
// check neither: two polygon rooms that merely graze past each other with a wall
// between them would start passing.

import type { LevelSpec } from './types';

interface Box { x: number; z: number; w: number; d: number }

/** Real shared area, not a shared edge — two rooms whose walls happen to abut
 *  are not connected, and a corridor that reaches its room always overlaps it. */
function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.05
      && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.05;
}

/** Generous containment — a stair or a spawn sits ON a rect's floor, and both
 *  are placed with their own standoff from the wall behind them. */
function holds(b: Box, x: number, z: number): boolean {
  return Math.abs(b.x - x) <= b.w / 2 + 0.6 && Math.abs(b.z - z) <= b.d / 2 + 0.6;
}

export interface Connectivity {
  /** Every stair is walkable from the spawn. The one that ends a run if false. */
  stairsReachable: boolean;
  /** Rooms and corridors the spawn cannot get to. Content nobody will see. */
  orphaned: number;
  /** The spawn point is not on any floor at all — a different and worse bug. */
  spawnOffFloor: boolean;
}

/**
 * What the player can actually reach from where they arrive.
 *
 * Pure, and the ONLY producer of this answer — `poly-floor`'s reroll gate and
 * the invariant suite both call it, so a floor cannot pass one and fail the
 * other (docs/DESIGN-METHOD.md: every audit tool imports the real function).
 */
export function floorConnectivity(spec: LevelSpec): Connectivity {
  const spaces = [
    ...spec.rooms.filter((r) => !(r as { logicalOnly?: boolean }).logicalOnly),
    ...spec.corridors,
  ];
  const boxes = spaces.map((x) => x.rect);
  const index = new Map(spaces.map((x, i) => [x.id, i]));
  const start = boxes.findIndex((b) => holds(b, spec.startPos.x, spec.startPos.z));
  if (start < 0) return { stairsReachable: false, orphaned: boxes.length, spawnOffFloor: true };

  const adj: Set<number>[] = spaces.map(() => new Set<number>());
  const join = (i: number, j: number): void => {
    if (i < 0 || j < 0 || i === j) return;
    adj[i].add(j); adj[j].add(i);
  };

  // Legs of one link are one passage. A dogleg is three rects sharing a linkId, and
  // they are joined by construction rather than by their boxes happening to overlap
  // at the corner.
  const legsOf = new Map<string, number[]>();
  for (const c of spec.corridors) {
    const at = index.get(c.id);
    if (at === undefined) continue;
    const key = c.linkId ?? c.id;
    const list = legsOf.get(key) ?? [];
    for (const other of list) join(at, other);
    list.push(at);
    legsOf.set(key, list);
  }

  const unlinked: number[] = [];
  for (const c of spec.corridors) {
    const at = index.get(c.id);
    if (at === undefined) continue;
    if (!c.link) { unlinked.push(at); continue; }
    // THE HOLE HAS TO ADMIT A BODY. A cut narrower than the player is a wall with a
    // slot in it, and counting it as a way through is the false negative this
    // rewrite exists to remove. Crawls are deliberately tight (level/anchors.ts),
    // but a crawl the PLAYER cannot enter serves nobody.
    if (cutAdmits(spec, c.link.fromRoom, c.link.aCut)) join(at, index.get(c.link.fromRoom) ?? -1);
    if (cutAdmits(spec, c.link.toRoom, c.link.bCut)) join(at, index.get(c.link.toRoom) ?? -1);
  }
  // Rects with no declared cut keep the old rule — see SCOPE in the header.
  for (const at of unlinked) {
    for (let j = 0; j < boxes.length; j++) if (overlaps(boxes[at], boxes[j])) join(at, j);
  }

  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of adj[i]) if (!seen.has(j)) { seen.add(j); queue.push(j); }
  }

  const reached = [...seen].map((i) => boxes[i]);
  const stairsReachable = (spec.stairs ?? []).every((st) => reached.some((b) => holds(b, st.x, st.z)));
  return { stairsReachable, orphaned: boxes.length - seen.size, spawnOffFloor: false };
}

/** The player's collision diameter, and nothing on top. A hole this wide is
 *  walkable; a hole narrower than this is a slot. */
const PLAYER_CLEARANCE = 0.6;

/**
 * Is this declared hole wide enough for the player to walk through?
 *
 * Measured on the room's own outline, because a cut is an edge-local SPAN and how
 * many metres that is depends on the edge it was cut in.
 */
function cutAdmits(
  spec: LevelSpec, roomId: string, cut: { edge: number; t0: number; t1: number },
): boolean {
  const poly = spec.rooms.find((r) => r.id === roomId)?.poly;
  if (!poly || poly.length < 3) return true;   // no outline to measure against
  const a = poly[cut.edge % poly.length], b = poly[(cut.edge + 1) % poly.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return (cut.t1 - cut.t0) * len >= PLAYER_CLEARANCE;
}

/** The connectivity faults, phrased for the generator's reroll log. Empty when
 *  the floor is crossable. */
export function connectivityFaults(spec: LevelSpec): string[] {
  const c = floorConnectivity(spec);
  const out: string[] = [];
  if (c.spawnOffFloor) out.push('the spawn point is not on any room or corridor');
  else if (!c.stairsReachable) out.push('the stair cannot be walked to from the spawn');
  if (c.orphaned > 0) out.push(`${c.orphaned} room/corridor rects are cut off from the spawn`);
  return out;
}
