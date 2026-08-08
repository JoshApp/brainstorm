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
// The walkability model is deliberately the coarsest one that is still sound:
// two boxes that share actual floor AREA are walkable between each other. That
// is exactly the contract the polygon corridor router works to — a corridor's
// mouth is placed to overlap the room it serves — so it produces no false
// alarms there, and anything it flags is a floor whose pieces never touch.
//
// SCOPE: polygon floors only. The ASCII vault composer lays its rooms and
// corridors on a tile grid where they ABUT exactly (a room ending at z=2.5 and
// its corridor starting at z=2.5) rather than overlap, so every vault floor
// reads as disconnected here. That is this model not fitting that generator, not
// a fault in it — `tests/floor-invariants.test.ts` covers the vault path with a
// grid flood, which is the right shape for a grid. Loosening this to count
// touching edges would fit both and check neither: two polygon rooms that merely
// graze past each other with a wall between would start passing.

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
  const boxes: Box[] = [
    ...spec.rooms.filter((r) => !(r as { logicalOnly?: boolean }).logicalOnly).map((r) => r.rect),
    ...spec.corridors.map((c) => c.rect),
  ];
  const start = boxes.findIndex((b) => holds(b, spec.startPos.x, spec.startPos.z));
  if (start < 0) return { stairsReachable: false, orphaned: boxes.length, spawnOffFloor: true };

  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < boxes.length; j++) {
      if (!seen.has(j) && overlaps(boxes[i], boxes[j])) { seen.add(j); queue.push(j); }
    }
  }

  const reached = [...seen].map((i) => boxes[i]);
  const stairsReachable = (spec.stairs ?? []).every((s) => reached.some((b) => holds(b, s.x, s.z)));
  return { stairsReachable, orphaned: boxes.length - seen.size, spawnOffFloor: false };
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
