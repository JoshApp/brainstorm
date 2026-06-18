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
  visited: new Set(), hasWork: new Set(),
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

test('WARM toward an unexplored room; COLD once it is visited + clear', () => {
  const g = linearFloor();
  // Player in A. B and C unvisited → the A↔cor1 archway must be WARM (stuff that way).
  assert.equal(archwayCold(g, 'A', 'cor1', st({ curId: 'A', visited: new Set(['A']) })), false);
  // Now everything beyond is visited + clear → COLD.
  assert.equal(archwayCold(g, 'A', 'cor1', st({ curId: 'A', visited: new Set(['A', 'B', 'C']) })), true);
});

test('WARM while the far room still has live work (enemy/loot)', () => {
  const g = linearFloor();
  // All visited, but C still holds work → A's exit stays WARM (cold must not lie).
  const s = st({ curId: 'A', visited: new Set(['A', 'B', 'C']), hasWork: new Set(['C']) });
  assert.equal(archwayCold(g, 'A', 'cor1', s), false);
  // Clear C → COLD.
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

test('corridors are pass-through — cold flows through them to the real room', () => {
  const g = linearFloor();
  // Player in A; B+C done. The FAR archway (cor2↔C, not adjacent to A) reads C's
  // state via the edge-cut, so it is COLD even though A isn't next to it.
  const s = st({ curId: 'A', visited: new Set(['A', 'B', 'C']) });
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
  // Player in H. Branch X cleared (visited, no work); branch Y never entered.
  const s = st({ curId: 'H', visited: new Set(['H', 'X']) });
  assert.equal(archwayCold(g, 'H', 'cA', s), true, 'exit toward the cleared dead-end X → cold');
  assert.equal(archwayCold(g, 'H', 'cB', s), false, 'exit toward the unexplored dead-end Y → warm');
  // Leftover work in a cleared-but-not-empty dead-end keeps its exit warm.
  const s2 = st({ curId: 'H', visited: new Set(['H', 'X', 'Y']), hasWork: new Set(['Y']) });
  assert.equal(archwayCold(g, 'H', 'cB', s2), false, 'dead-end with loot still warm');
  assert.equal(archwayCold(g, 'H', 'cA', s2), true, 'the empty cleared dead-end stays cold');
});

test('an archway on a CYCLE stays warm (not a dead-end branch)', () => {
  // Square loop: A-B-C-D-A via short corridors. Cutting any one doorway still
  // leaves the player able to reach both sides → warm.
  const g = buildRoomGraph({
    rooms: [room('A', 0, 0), room('B', 6, 0), room('C', 6, 6), room('D', 0, 6)],
    corridors: [
      corr('ab', 3, 0, 2, 2), corr('bc', 6, 3, 2, 2),
      corr('cd', 3, 6, 2, 2), corr('da', 0, 3, 2, 2),
    ],
  });
  const all = new Set(['A', 'B', 'C', 'D', 'ab', 'bc', 'cd', 'da']);
  const s: ExploredState = { curId: 'A', visited: new Set(['A', 'B', 'C', 'D']), hasWork: new Set(), discovered: all };
  // Even with everything visited, a cycle archway is warm (player reaches both sides).
  assert.equal(archwayCold(g, 'A', 'ab', s), false);
});

test('undiscovered (secret) nodes are invisible — a corridor to only a secret reads COLD', () => {
  // A —cor1— B, plus a SECRET room S behind cor2 off B. S undiscovered.
  const g = buildRoomGraph({
    rooms: [room('A', 0, 0), room('B', 0, 6), room('S', 0, 12)],
    corridors: [corr('cor1', 0, 3, 2, 2), corr('cor2', 0, 9, 2, 2)],
  });
  // S NOT discovered (the secret gate). Player in B, A+B done.
  const discovered = new Set(['A', 'B', 'cor1', 'cor2']);   // S excluded
  const s: ExploredState = { curId: 'B', visited: new Set(['A', 'B']), hasWork: new Set(), discovered };
  // The cor2 archway leads only toward the undiscovered S → far side is empty of
  // discovered work → COLD (never betrays the secret).
  assert.equal(archwayCold(g, 'B', 'cor2', s), true);
  // Once S is discovered but unvisited, that archway goes WARM.
  const s2: ExploredState = { ...s, discovered: new Set([...discovered, 'S']) };
  assert.equal(archwayCold(g, 'B', 'cor2', s2), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
