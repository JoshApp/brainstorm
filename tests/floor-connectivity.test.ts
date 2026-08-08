// YOU CAN WALK OUT OF EVERY FLOOR.
//
// The one invariant whose failure ends a run rather than spoiling one, and the
// last thing standing between polygon floors and the default.
//
// `floor-graph.ts faults()` already checked this and checked it correctly — on
// the GRAPH. But the graph is the plan. It says "poly-0 links to poly-1"; the
// corridor router decides later whether a rect actually gets built between them,
// and it is allowed to fail. Measured over 520 floors, 3 of them (0.6%) shipped
// with the spawn room joined to nothing: sound graph, dead run, every check
// green. Over a 12-floor descent that is roughly a 7% chance of a run that ends
// against a wall, and it looks exactly like a hard floor until the player has
// searched every corner for the door.
//
// Two things were wrong and both are fixed in level/poly-floor.ts:
//   - the reroll never asked the BUILT floor whether it could be crossed, and
//   - when every attempt was faulty it shipped the LAST one rather than the best,
//     so a crossable floor with a cosmetic anchoring complaint lost to an
//     uncrossable floor generated after it.
//
// This suite asserts the property on the finished spec, through the same
// `floorConnectivity` the generator's own gate calls — so the gate and the test
// cannot disagree about what "crossable" means (docs/DESIGN-METHOD.md: every
// audit tool imports the real function).
//
//   npm test -- floor-connectivity

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { floorConnectivity } from '../src/level/floor-connectivity';
import type { LevelSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Disjoint from the seeds the fix was developed against, on purpose — a rule
 *  verified only on the sample that produced it is a claim about that sample. */
const SEEDS = Array.from({ length: 30 }, (_, i) => 90001 + i * 7717);
const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

interface Floor { depth: number; seed: number; spec: LevelSpec }
let CORPUS: Floor[] | null = null;
const corpus = (): Floor[] => (CORPUS ??= SEEDS.flatMap((seed) =>
  DEPTHS.map((depth) => ({ depth, seed, spec: generatePolyFloor(depth, seed) }))));

test('THE SAMPLE IS BIG ENOUGH TO CATCH A 0.6% FAULT', () => {
  // The bug ran at 3 in 520. A sample of 50 would have passed with it present,
  // which is how it survived this long — so the size is the assertion.
  assert.ok(corpus().length >= 350,
    `only ${corpus().length} floors — too few to catch a sub-1% connectivity fault`);
});

test('THE STAIR CAN BE WALKED TO FROM THE SPAWN', () => {
  const dead = corpus()
    .filter((f) => !floorConnectivity(f.spec).stairsReachable)
    .map((f) => `d${f.depth}/s${f.seed}`);
  assert.equal(dead.length, 0,
    `${dead.length} of ${corpus().length} floors cannot be finished: ${dead.slice(0, 8).join(', ')}`);
});

test('AND THE SPAWN IS ON THE FLOOR AT ALL', () => {
  // A different and worse failure than an unreachable stair — the player arrives
  // inside stone. Cheap to check and it would otherwise hide inside the above.
  const adrift = corpus()
    .filter((f) => floorConnectivity(f.spec).spawnOffFloor)
    .map((f) => `d${f.depth}/s${f.seed}`);
  assert.equal(adrift.length, 0, `spawn is not on any room or corridor: ${adrift.slice(0, 8).join(', ')}`);
});

test('AND NOTHING IS BUILT THAT NOBODY CAN REACH', () => {
  // Weaker consequence, same cause: a room the router stranded is content the
  // player paid generation time for and will never see. Held at zero rather than
  // at a share, because every instance measured so far has been the same missing
  // corridor that also strands the stair.
  const orphans = corpus()
    .map((f) => ({ f, n: floorConnectivity(f.spec).orphaned }))
    .filter((x) => x.n > 0)
    .map((x) => `d${x.f.depth}/s${x.f.seed} (${x.n})`);
  assert.equal(orphans.length, 0,
    `${orphans.length} floors strand rooms or corridors: ${orphans.slice(0, 8).join(', ')}`);
});

test('THE CHECK CAN ACTUALLY FAIL', () => {
  // The control, and the one that matters most here: every assertion above
  // passes trivially if `floorConnectivity` returns "fine" for anything handed
  // to it. Take a real floor and cut its corridors out — what is left is rooms
  // that do not touch, and the check has to say so.
  const spec = corpus()[0].spec;
  const severed = { ...spec, corridors: [] } as LevelSpec;
  const c = floorConnectivity(severed);
  assert.ok(!c.stairsReachable || c.orphaned > 0,
    'a floor with every corridor removed was reported as fully connected — the check is vacuous');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
