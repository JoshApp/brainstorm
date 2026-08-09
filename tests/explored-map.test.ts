// Explored-map nav cue — the floor graph (src/level/room-graph.ts) + the
// per-archway cold decision (src/level/explored-map.ts archwayCold).
//
// An archway is COLD iff the branch BEYOND it (away from the player) is fully
// explored + cleared; WARM while there's unseen or undone ground that way.
// Directional, corridors are pass-through, cycles stay warm, undiscovered
// (secret) nodes are invisible.

import assert from 'node:assert/strict';
import { buildRoomGraph } from '../src/level/room-graph';
import { archwayCold, type ExploredState } from '../src/level/explored-map';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

const room = (id: string, x: number, z: number, w = 4, d = 4) => ({ id, rect: { x, z, w, d }, height: 3 } as never);
const corr = (id: string, x: number, z: number, w: number, d: number) => ({ id, rect: { x, z, w, d }, height: 3 } as never);

// Linear floor: A —cor1— B —cor2— C, laid along +z. Rooms 4×4 centred 6m apart,
// 2-wide corridors bridging the 2m gaps.
function linearFloor() {
  return buildRoomGraph({
    rooms: [room('A', 0, 0), room('B', 0, 6), room('C', 0, 12)],
    corridors: [corr('cor1', 0, 3, 2, 2), corr('cor2', 0, 9, 2, 2)],
  });
}

// Default: every node id used across these tests is discovered (the no-secrets
// case). Tests that exercise the secret gate pass their own `discovered`.
const st = (p: Partial<ExploredState> & { curId: string | undefined }): ExploredState => ({
  visited: new Set(), objective: new Set(),
  discovered: new Set(['A', 'B', 'C', 'cor1', 'cor2', 'H', 'X', 'Y', 'cA', 'cB']),
  ...p,
});

test('graph wires rooms↔corridors with doorway midpoints', () => {
  const g = linearFloor();
  assert.equal(g.nodes.size, 5);
  // A connects only to cor1; B to both corridors; corridors are flagged.
  assert.deepEqual(g.neighbors('A').sort(), ['cor1']);
  assert.deepEqual(g.neighbors('B').sort(), ['cor1', 'cor2']);
  assert.equal(g.nodes.get('cor1')!.isCorridor, true);
  assert.equal(g.nodes.get('A')!.isCorridor, false);
  // The A↔cor1 doorway sits at the shared edge (z = 1, between A's +z and cor1's -z).
  const e = g.edges.find((x) => (x.a === 'A' && x.b === 'cor1') || (x.a === 'cor1' && x.b === 'A'))!;
  assert.ok(Math.abs(e.mz - 2) < 0.5 && Math.abs(e.mx) < 0.01, `doorway midpoint ${e.mx},${e.mz}`);
});

test('WARM toward an unexplored room; COLD once it is ENTERED (purely exploratory)', () => {
  const g = linearFloor();
  // Player in A. B and C unvisited → the A↔cor1 archway must be WARM (stuff that way).
  assert.equal(archwayCold(g, 'A', 'cor1', st({ curId: 'A', visited: new Set(['A']) })), false);
  // Entering B and C is enough — no need to loot/clear them → COLD.
  assert.equal(archwayCold(g, 'A', 'cor1', st({ curId: 'A', visited: new Set(['A', 'B', 'C']) })), true);
});

// ── TIER A: A DOOR ONTO UNEXPLORED GROUND IS ALWAYS OPEN ─────────────────────
// Two corridors from A to the same room B, one short and one long. This is the
// case that names the whole rule.
//
//   A ═══ short ═══ B
//    ╚══ long (2 corridor hops) ══╝
// Rooms are 12 wide so two corridors can leave the same wall without touching
// each other (rects must ABUT to become graph edges — a 1m gap is no doorway,
// and two corridors sharing a boundary would wire to each other as well).
//   A ══ short ══════════════ B      (2 edges)
//    ╚═ longA ═ longB ════════╝      (3 edges)
function twinCorridorFloor() {
  return buildRoomGraph({
    rooms: [room('A', 0, 0, 12, 4), room('B', 0, 12, 12, 4)],
    corridors: [
      corr('short', 4, 6, 2, 8),
      corr('longA', -4, 4, 2, 4), corr('longB', -4, 8, 2, 4),
    ],
  });
}

/** Two SEPARATE corridors of equal length between the same pair of rooms. */
function parallelFloor() {
  return buildRoomGraph({
    rooms: [room('A', 0, 0, 12, 4), room('B', 0, 8, 12, 4)],
    corridors: [corr('p', -4, 4, 2, 4), corr('q', 4, 4, 2, 4)],
  });
}

test('two corridors to the SAME unexplored room — both eyes open', () => {
  const g = parallelFloor();
  assert.deepEqual(g.neighbors('A').sort(), ['p', 'q'], 'fixture: A has both corridors');
  const all = new Set(['A', 'B', 'p', 'q']);
  const s: ExploredState = { curId: 'A', visited: new Set(['A']), objective: new Set(), discovered: all };
  // Both lead to B, which has never been entered. Distance is irrelevant here —
  // an unexplored room is not something the architecture may hide.
  assert.equal(archwayCold(g, 'A', 'p', s), false);
  assert.equal(archwayCold(g, 'A', 'q', s), false);
  // Once B is entered neither door leads anywhere new, and with nothing left on
  // the floor at all both go dark.
  const seen: ExploredState = { ...s, visited: new Set(['A', 'B']) };
  assert.equal(archwayCold(g, 'A', 'p', seen), true);
  assert.equal(archwayCold(g, 'A', 'q', seen), true);
});

test('once the room is seen, the SHORT way stays open and the long way round shuts', () => {
  const g = twinCorridorFloor();
  const all = new Set(['A', 'B', 'short', 'longA', 'longB']);
  // B entered, and B holds the down-stairs — so there is still a reason to walk
  // there, and the two routes can be ranked.
  const s: ExploredState = {
    curId: 'A', visited: new Set(['A', 'B']), objective: new Set(['B']), discovered: all,
  };
  assert.equal(archwayCold(g, 'A', 'short', s), false, 'one hop to B → open');
  assert.equal(archwayCold(g, 'A', 'longA', s), true, 'two hops to the same place → shut');
});

test('equal-length routes to the exit BOTH stay open — a tie is a real tie', () => {
  const g = parallelFloor();
  const all = new Set(['A', 'B', 'p', 'q']);
  const s: ExploredState = {
    curId: 'A', visited: new Set(['A', 'B']), objective: new Set(['B']), discovered: all,
  };
  assert.equal(archwayCold(g, 'A', 'p', s), false);
  assert.equal(archwayCold(g, 'A', 'q', s), false);
});

test('a door onto an unexplored room stays open even when a nearer goal is elsewhere', () => {
  // Hub H: X is one hop away and unexplored; Y is THREE hops away and also
  // unexplored. A pure nearest-goal rule would light only the X door and leave
  // the Y door dark, which would be the architecture lying about Y.
  const g = buildRoomGraph({
    rooms: [room('H', 0, 0, 8, 4), room('X', 0, 6), room('Y', 12, 0)],
    corridors: [corr('cX', 0, 3, 2, 2), corr('y1', 5, 0, 2, 2), corr('y2', 7, 0, 2, 2), corr('y3', 9, 0, 2, 2)],
  });
  const all = new Set(['H', 'X', 'Y', 'cX', 'y1', 'y2', 'y3']);
  assert.deepEqual(g.neighbors('Y'), ['y3'], 'fixture: the long branch reaches Y');
  const s: ExploredState = { curId: 'H', visited: new Set(['H']), objective: new Set(), discovered: all };
  assert.equal(archwayCold(g, 'H', 'cX', s), false, 'the near unexplored room');
  assert.equal(archwayCold(g, 'H', 'y1', s), false, 'the far one is no less unexplored');
});

test('an OBJECTIVE room (the down-stairs) keeps its path WARM even when entered', () => {
  const g = linearFloor();
  // All entered, but C holds the down-stairs (an objective) → A's exit stays WARM
  // (the way down is always worth taking).
  const s = st({ curId: 'A', visited: new Set(['A', 'B', 'C']), objective: new Set(['C']) });
  assert.equal(archwayCold(g, 'A', 'cor1', s), false);
  // Without the objective, entering everything → COLD.
  assert.equal(archwayCold(g, 'A', 'cor1', st({ curId: 'A', visited: new Set(['A', 'B', 'C']) })), true);
});

test('directional — same corridor reads opposite from each end', () => {
  const g = linearFloor();
  // Player in B; A fully done, C not visited. Looking back toward A (cor1) = COLD;
  // looking on toward C (cor2) = WARM.
  const s = st({ curId: 'B', visited: new Set(['A', 'B']) });
  assert.equal(archwayCold(g, 'B', 'cor1', s), true, 'toward cleared A → cold');
  assert.equal(archwayCold(g, 'B', 'cor2', s), false, 'toward unseen C → warm');
});

test('corridors are pass-through — an unexplored room two hops away still warms the exit', () => {
  const g = linearFloor();
  // Player in A, B entered, C never. The corridor between them holds nothing, so
  // the distance to C counts THROUGH it: A's only exit steps closer to C → WARM.
  const s = st({ curId: 'A', visited: new Set(['A', 'B']) });
  assert.equal(archwayCold(g, 'A', 'cor1', s), false);
});

test('a doorway that is not the current room’s own is cold (its eye is never shown)', () => {
  const g = linearFloor();
  // cor2↔C is nowhere near A. `near` gates which eyes render at all; the cold
  // decision refuses to answer for a doorway the player is not standing at.
  const s = st({ curId: 'A', visited: new Set(['A']) });
  assert.equal(archwayCold(g, 'cor2', 'C', s), true);
});

test('hub with dead-end branches — each exit reflects ITS branch independently', () => {
  // A hub H with two dead-end branches: H —cA— X (north), H —cB— Y (east).
  // Mirrors procgen-3 (a hub vault + leaf branch rooms).
  const g = buildRoomGraph({
    rooms: [room('H', 0, 0), room('X', 0, 6), room('Y', 6, 0)],
    corridors: [corr('cA', 0, 3, 2, 2), corr('cB', 3, 0, 2, 2)],
  });
  // Confirm the topology: X and Y are dead-ends (one edge each).
  assert.deepEqual(g.neighbors('X'), ['cA']);
  assert.deepEqual(g.neighbors('Y'), ['cB']);
  // Player in H. Branch X entered; branch Y never entered.
  const s = st({ curId: 'H', visited: new Set(['H', 'X']) });
  assert.equal(archwayCold(g, 'H', 'cA', s), true, 'exit toward the entered dead-end X → cold');
  assert.equal(archwayCold(g, 'H', 'cB', s), false, 'exit toward the unexplored dead-end Y → warm');
  // A dead-end that's an objective (down-stairs) keeps its exit warm even entered.
  const s2 = st({ curId: 'H', visited: new Set(['H', 'X', 'Y']), objective: new Set(['Y']) });
  assert.equal(archwayCold(g, 'H', 'cB', s2), false, 'exit toward the down-stairs stays warm');
  assert.equal(archwayCold(g, 'H', 'cA', s2), true, 'the plain entered dead-end stays cold');
});

// ── THE CYCLE CASE ───────────────────────────────────────────────────────────
// This file used to assert the OPPOSITE of the two tests below: that an archway
// on a cycle "stays warm", because cutting it never separated the graph and the
// old edge-cut model fell through to warm. That was the bug written down as
// intent. With 89% of floors carrying a cycle it left 85% of all eyes open, and
// every door in the room open in a third of visits. Distance answers what
// connectivity could not.
const loopFloor = () => buildRoomGraph({
  rooms: [room('A', 0, 0), room('B', 6, 0), room('C', 6, 6), room('D', 0, 6)],
  corridors: [
    corr('ab', 3, 0, 2, 2), corr('bc', 6, 3, 2, 2),
    corr('cd', 3, 6, 2, 2), corr('da', 0, 3, 2, 2),
  ],
});
const LOOP_NODES = new Set(['A', 'B', 'C', 'D', 'ab', 'bc', 'cd', 'da']);

test('on a fully-explored CYCLE every archway goes cold', () => {
  const g = loopFloor();
  const s: ExploredState = {
    curId: 'A', visited: new Set(['A', 'B', 'C', 'D']), objective: new Set(), discovered: LOOP_NODES,
  };
  assert.equal(archwayCold(g, 'A', 'ab', s), true, 'nothing left that way');
  assert.equal(archwayCold(g, 'A', 'da', s), true, 'nor the other way round');
});

test('on a CYCLE the eye opens the SHORT way round and shuts the long one', () => {
  const g = loopFloor();
  // Player in A; B and D entered, C is not. Round the loop C is two hops via B
  // (A→ab→B→bc→C) and two via D — symmetric, so make it asymmetric by entering
  // only B: from A, C is 4 edges clockwise through B and 4 anticlockwise through
  // D. Use the objective instead to pin a single goal one side of the loop.
  const s: ExploredState = {
    curId: 'B', visited: new Set(['A', 'B', 'C', 'D']), objective: new Set(['C']), discovered: LOOP_NODES,
  };
  // From B the down-stairs room C is 2 edges via bc, and 6 the long way via A→D.
  assert.equal(archwayCold(g, 'B', 'bc', s), false, 'the short way to the stairs is lit');
  assert.equal(archwayCold(g, 'B', 'ab', s), true, 'the long way round is not');
});

test('undiscovered (secret) nodes are invisible — a corridor to only a secret reads COLD', () => {
  // A —cor1— B, plus a SECRET room S behind cor2 off B. S undiscovered.
  const g = buildRoomGraph({
    rooms: [room('A', 0, 0), room('B', 0, 6), room('S', 0, 12)],
    corridors: [corr('cor1', 0, 3, 2, 2), corr('cor2', 0, 9, 2, 2)],
  });
  // S NOT discovered (the secret gate). Player in B, A+B done.
  const discovered = new Set(['A', 'B', 'cor1', 'cor2']);   // S excluded
  const s: ExploredState = { curId: 'B', visited: new Set(['A', 'B']), objective: new Set(), discovered };
  // The cor2 archway leads only toward the undiscovered S → far side is empty of
  // discovered work → COLD (never betrays the secret).
  assert.equal(archwayCold(g, 'B', 'cor2', s), true);
  // Once S is discovered but unvisited, that archway goes WARM.
  const s2: ExploredState = { ...s, discovered: new Set([...discovered, 'S']) };
  assert.equal(archwayCold(g, 'B', 'cor2', s2), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
