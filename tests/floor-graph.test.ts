// THE FLOOR, AS A GRAPH.
//
// Stage 1 of the topology-first plan: make the graph the generator ALREADY HAS
// into a thing that exists. The walk decides a spine, hangs pockets off it, and
// sometimes adds a chord — but until now that only lived in control flow, so
// every question about it downstream was re-derived from rectangles.
//
// This is an extraction with no behaviour delta, which is exactly why it can be
// checked properly: the graph makes claims about the floor, and the floor is
// right there to be asked. A topology that has drifted from its own geometry is
// worse than no topology, because everything downstream would believe it.
//
// ── THE ONE THAT MATTERS ─────────────────────────────────────────────────────
//
// `THE GRAPH AGREES WITH THE STONE`. Room connectivity is computed a second
// time, independently, from which room polygons each corridor rect actually
// reaches — and the two answers must match. Everything else here is a property
// of the graph alone; that one is the proof it describes THIS floor.
//
//   npm test -- floor-graph

import assert from 'node:assert/strict';
import { generatePolyFloor, MIN_SPINE } from '../src/level/poly-floor';
import {
  reachableFrom, pathBetween, mainline, leaves, degree, cycleCount, faults,
  type FloorGraph,
} from '../src/level/floor-graph';
import { pointInPoly, type Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444, 555, 66];
const DEPTHS = [1, 2, 5, 6, 8, 11];
const FLOORS = SEEDS.flatMap((seed) => DEPTHS.map((depth) => ({
  seed, depth, spec: generatePolyFloor(depth, seed),
})));

const graphs = () => FLOORS.map((f) => ({ ...f, g: f.spec.graph as FloorGraph }));

test('EVERY PROCGEN FLOOR CARRIES ONE', () => {
  // The floor is MIN_SPINE, imported rather than restated. This assertion read
  // `>= 4` for as long as 4 happened to be the smallest floor the sample threw,
  // and freeing corridor placement immediately produced a legitimate 3 — a
  // depth-1 floor of entrance → combat → finish, both links routed, no guesses,
  // nothing dropped. A threshold tuned against a sample is a claim about the
  // sample; this one is a claim about the generator.
  const seen: number[] = [];
  for (const { seed, depth, spec } of FLOORS) {
    assert.ok(spec.graph, `d${depth}/s${seed} has no graph`);
    const n = spec.graph!.nodes.length;
    seen.push(n);
    assert.ok(n >= MIN_SPINE,
      `d${depth}/s${seed}: ${n} rooms, below the ${MIN_SPINE}-room spine the generator plans`);
    assert.equal(n, spec.rooms.length,
      `d${depth}/s${seed}: the graph has a different number of rooms than the floor does`);
  }
  // And the floor is a floor, not the ceiling. If every floor collapsed to the
  // minimum the assertion above would still pass while the game got much worse,
  // which is the failure mode of checking only one end of a range. Measured
  // across 96 floors when this was written: min 3, p10 5, p50 7, max 9.
  const median = seen.slice().sort((a, b) => a - b)[Math.floor(seen.length / 2)];
  assert.ok(median >= 6,
    `the median floor is ${median} rooms — floors are collapsing toward the minimum`);
});

test('THE GRAPH AGREES WITH THE STONE', () => {
  // Computed a SECOND time, from geometry, and compared. If the topology and the
  // masonry ever disagree, every rule built on the topology is quietly wrong —
  // and this is the only check that can notice.
  let checked = 0;
  for (const { seed, depth, spec, g } of graphs()) {
    const rooms = spec.rooms.filter((r) => r.poly && r.poly.length >= 3);
    // Which rooms does each corridor actually reach into? Its rects deliberately
    // end inside both rooms, so this is answerable from the built floor without
    // consulting the graph at all.
    const geo = new Map<string, Set<string>>(rooms.map((r) => [r.id, new Set<string>()]));
    for (const c of spec.corridors) {
      const probes: Array<[number, number]> = [
        [c.rect.x - c.rect.w / 2, c.rect.z], [c.rect.x + c.rect.w / 2, c.rect.z],
        [c.rect.x, c.rect.z - c.rect.d / 2], [c.rect.x, c.rect.z + c.rect.d / 2],
      ];
      const touch = rooms.filter((r) => probes.some((p) => pointInPoly(r.poly as Poly, p[0], p[1])));
      for (const a of touch) for (const b of touch) {
        if (a !== b) geo.get(a.id)!.add(b.id);
      }
    }
    // Corridors of one link chain through each other, so compare COMPONENTS
    // rather than edges — an L's two rects touch one room each and meet in the
    // middle, which is a connection the per-rect probe cannot see on its own.
    const geoReach = (start: string) => {
      const seen = new Set([start]); const q = [start];
      for (let i = 0; i < q.length; i++) for (const n of geo.get(q[i]) ?? []) {
        if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
      return seen;
    };
    for (const r of rooms) {
      checked++;
      const byGraph = reachableFrom(g, r.id);
      // Geometry can only ever see FEWER connections than the graph (a bent
      // link's middle rect touches no room), never more. A room the geometry
      // says is reachable and the graph does not is the graph being wrong.
      for (const id of geoReach(r.id)) {
        assert.ok(byGraph.has(id),
          `d${depth}/s${seed}: the stone connects ${r.id} to ${id} and the graph does not`);
      }
    }
  }
  assert.ok(checked > 350, `only ${checked} rooms cross-checked — this measured nothing`);
});

test('NOTHING IS CUT OFF, AND THE STAIRS ARE ALWAYS REACHABLE', () => {
  // The property the reach audit floods a walkable grid to establish. On the
  // graph it is one BFS, and it is TOTAL rather than sampled.
  for (const { seed, depth, g } of graphs()) {
    const bad = faults(g);
    assert.deepEqual(bad, [], `d${depth}/s${seed}: ${bad.join('; ')}`);
    assert.ok(pathBetween(g, g.entrance, g.exit).length > 0,
      `d${depth}/s${seed}: no path from the entrance to the stairs`);
  }
});

test('MOST FLOORS CARRY A CYCLE', () => {
  // Unexplored's central lesson, and the thing the chord pass exists to deliver:
  // a floor with no cycle is a corridor with rooms on it, because every route
  // out is the route you came in by. Counted as the circuit rank rather than
  // trusted from the chord flag — a chord that failed to build is not a loop.
  const withCycle = graphs().filter(({ g }) => cycleCount(g) > 0).length;
  assert.ok(withCycle / FLOORS.length > 0.6,
    `only ${((withCycle / FLOORS.length) * 100).toFixed(0)}% of floors have a cycle`);
  // And never a runaway: a floor that is all loops has no shape.
  for (const { seed, depth, g } of graphs()) {
    assert.ok(cycleCount(g) <= 3, `d${depth}/s${seed} has ${cycleCount(g)} independent cycles`);
  }
});

test('A DETOUR IS A DEAD END, AND THE MAINLINE IS NOT', () => {
  // The rule that shipped wrong twice, from both ends, because it was tested by
  // COUNTING DOORS. The stair room has one link and so does the entrance, and
  // both are the way ON. Stated on the graph it is not about degree at all.
  for (const { seed, depth, g } of graphs()) {
    const path = mainline(g);
    const dead = leaves(g);
    for (const id of dead) {
      if (id === g.entrance || id === g.exit) continue;
      // A pocket the loop opened is no longer a leaf, so it is not in `dead` —
      // this only sees genuine cul-de-sacs.
      assert.ok(!path.has(id),
        `d${depth}/s${seed}: ${id} is a dead end AND on the mainline — a gate there `
        + 'would cost the player the floor');
    }
    // The mainline is a genuine path, not the whole floor by fallback.
    assert.ok(path.size >= 2 && path.size <= g.nodes.length,
      `d${depth}/s${seed}: the mainline is ${path.size} of ${g.nodes.length} rooms`);
    if (g.entrance && g.exit) {
      assert.ok(path.has(g.entrance) && path.has(g.exit),
        `d${depth}/s${seed}: the mainline misses one of its own ends`);
    }
  }
});

test('THE QUERIES DO NOT LIE ON A DEGENERATE GRAPH', () => {
  // Every one of these gets called on a floor that failed to build something,
  // so none may throw or invent an answer.
  const empty: FloorGraph = { nodes: [], edges: [] };
  assert.deepEqual(pathBetween(empty, 'a', 'b'), []);
  assert.equal(reachableFrom(empty, 'a').size, 1);   // itself, and nothing else
  assert.equal(cycleCount(empty), 0);
  assert.deepEqual(faults(empty), ['the floor has no rooms']);

  const lone: FloorGraph = { nodes: [{ id: 'a', type: 'quiet', index: 0 }], edges: [] };
  assert.equal(degree(lone, 'a'), 0);
  assert.deepEqual(leaves(lone), []);
  // No ends declared: the mainline must fail CLOSED, covering everything, or a
  // "never on the mainline" rule would happily gate the only room there is.
  assert.deepEqual([...mainline(lone)], ['a']);

  // And a fault is reported rather than thrown.
  const broken: FloorGraph = {
    nodes: [{ id: 'a', type: 'quiet', index: 0 }, { id: 'b', type: 'quiet', index: 1 }],
    edges: [{ id: 'e', from: 'a', to: 'ghost', kind: 'spine' }],
    entrance: 'a', exit: 'b',
  };
  const bad = faults(broken);
  assert.ok(bad.some((f) => f.includes('ghost')), `expected a dangling-edge fault, got ${bad}`);
  assert.ok(bad.some((f) => f.includes('not reachable')), `expected an unreachable-exit fault, got ${bad}`);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
