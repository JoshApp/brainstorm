// A BOSS FLOOR IS STILL A POLYGON FLOOR.
//
// Boss depths used to fall through to the vault composer —
// `usePolyFloors() && !isBossDepth(depth)` — so a run on polygon floors changed
// GENERATOR every fifth floor. Different rooms, different corridors, different
// everything, at the one moment a floor is most trying to make an impression,
// and the last hard blocker on making poly the default.
//
// What a boss floor owes, and what each assertion here is actually protecting:
//
//   THE BOSS IS THERE. Obvious, and the thing that silently fails: the arena
//   builds fine, the fog wall hangs, and the hall is empty.
//   THE HALL IS HIS ALONE. The ordinary pack roller would fill the arena with
//   whatever the depth rolls, and you would fight the king in a crowd — which
//   is not the fight, and behind a sealed gate is not survivable either.
//   THE FOG WALL HANGS IN A REAL DOORWAY. The builder wires the cross-trigger
//   and the seal off this one prop, so a mist in the wrong place is a boss you
//   can walk away from, or a gate that closes on nothing.
//   THERE IS A WAY OUT. A boss floor's stair targets the act's safe room. No
//   stair means the run ends in that hall whatever the player does.
//
//   npm test -- poly-boss

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { isBossDepth, actForDepth, nextLevelAfter } from '../src/level/acts';
import { bossById } from '../src/content/bosses';
import { pointInPoly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [1000, 1137, 1274, 1411, 1548, 1685, 7, 4242];
/** Every depth in the sample; the boss ones are picked out by `isBossDepth`
 *  rather than hard-coded, so this cannot drift from `acts.ts`. */
const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface Floor { depth: number; seed: number; spec: ReturnType<typeof generatePolyFloor>; }
let CORPUS: Floor[] | null = null;
const bossFloors = (): Floor[] => (CORPUS ??= SEEDS.flatMap((seed) =>
  DEPTHS.filter(isBossDepth).map((depth) => ({ depth, seed, spec: generatePolyFloor(depth, seed) }))));

const bossIdAt = (depth: number) => bossById(actForDepth(depth).bossId).enemyId;

test('THE SAMPLE CONTAINS BOSS FLOORS AT ALL', () => {
  // The guard against every assertion below passing over an empty list — which
  // is what would happen if `isBossDepth` moved out of the sampled range.
  assert.ok(bossFloors().length >= 16,
    `only ${bossFloors().length} boss floors sampled — the depths tested contain no act boundary`);
});

test('THE BOSS IS IN IT', () => {
  for (const { depth, seed, spec } of bossFloors()) {
    const want = bossIdAt(depth);
    const found = (spec.spawns ?? []).filter((s) => s.enemyId === want);
    assert.equal(found.length, 1,
      `d${depth}/s${seed}: expected exactly one ${want}, found ${found.length}`);
  }
});

test('AND THE HALL IS HIS ALONE', () => {
  // A boss arena takes no pack. Asserted on the ROOM rather than on a distance,
  // because "no other enemy within Nm" is a proxy that passes the moment the
  // room is big.
  for (const { depth, seed, spec } of bossFloors()) {
    const boss = (spec.spawns ?? []).find((s) => s.enemyId === bossIdAt(depth));
    assert.ok(boss, `d${depth}/s${seed}: no boss to check the hall of`);
    const others = (spec.spawns ?? []).filter((s) => s !== boss && s.roomId === boss!.roomId);
    assert.equal(others.length, 0,
      `d${depth}/s${seed}: ${others.length} other enemies share the boss hall `
      + `(${others.map((o) => o.enemyId).join(', ')})`);
  }
});

test('THE FOG WALL HANGS IN A DOORWAY OF THAT HALL', () => {
  // Position AND width, because the builder sizes the seal from this. The vault
  // path had to derive the gate from the arena's offset and dims and fell back
  // to a guessed 3.4m; a polygon floor takes both from the same `planPortals`
  // call the archway is mounted from, so the mist and the frame it hangs in
  // cannot disagree.
  //
  // Read off `spec.openings`, not `spec.props`: the fog wall is a FITTING now
  // (`kind: 'fog-gate'`), the same door type the portcullis and the cobweb
  // curtain are, rather than a bespoke `boss-mist` prop the builder recognised
  // and translated back into exactly this.
  for (const { depth, seed, spec } of bossFloors()) {
    const mist = (spec.openings ?? []).filter((o) => o.kind === 'fog-gate');
    assert.equal(mist.length, 1, `d${depth}/s${seed}: ${mist.length} fog walls`);
    const m = mist[0];

    // Wide enough to be a way through — the player's collision diameter is
    // 0.60m, and a seal narrower than its own doorway reads as a gap beside it.
    assert.ok(m.widthM > 0.9,
      `d${depth}/s${seed}: a ${m.widthM?.toFixed?.(2)}m fog wall is not a threshold`);
    assert.ok(Number.isFinite(m.rotY), `d${depth}/s${seed}: fog wall has no rotation`);
    assert.equal(m.color, bossById(actForDepth(depth).bossId).mistColor ?? 0xffd060,
      `d${depth}/s${seed}: the fog wall is not this boss's colour`);

    // ON the boss's own room, not some other room's door. Measured against the
    // outline with a wall's worth of slack: the portal midpoint sits ON the
    // outline, so a strict containment test is one float from failing.
    const boss = (spec.spawns ?? []).find((s) => s.enemyId === bossIdAt(depth));
    const hall = spec.rooms.find((r) => r.id === boss?.roomId);
    assert.ok(hall?.poly, `d${depth}/s${seed}: the boss is not in a polygon room`);
    const inside = pointInPoly(hall!.poly!, m.x, m.z);
    const near = hall!.poly!.some(([px, pz]) => Math.hypot(px - m.x, pz - m.z) < 60);
    assert.ok(inside || near,
      `d${depth}/s${seed}: the fog wall at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) is nowhere near the boss hall`);
  }
});

test('AND THERE IS STILL A WAY OUT', () => {
  // A boss depth's stair targets the act's SAFE room rather than the next
  // depth. If the arena swallowed the stairs the run would end there whatever
  // the player did — and it would look exactly like a hard fight.
  for (const { depth, seed, spec } of bossFloors()) {
    assert.ok((spec.stairs ?? []).length >= 1, `d${depth}/s${seed}: no way off the boss floor`);
    assert.ok(nextLevelAfter(depth).startsWith('safe-'),
      `d${depth}: a boss depth should lead to its act's safe room, not ${nextLevelAfter(depth)}`);
  }
});

test('A NON-BOSS FLOOR HAS NEITHER', () => {
  // The control. Every assertion above would also pass on a generator that put
  // a fog wall and a king on every floor.
  for (const seed of SEEDS.slice(0, 4)) {
    for (const depth of DEPTHS.filter((d) => !isBossDepth(d)).slice(0, 4)) {
      const spec = generatePolyFloor(depth, seed);
      const mist = (spec.openings ?? []).filter((o) => o.kind === 'fog-gate');
      assert.equal(mist.length, 0, `d${depth}/s${seed}: a fog wall on an ordinary floor`);
      const kings = (spec.spawns ?? []).filter((s) => s.enemyId === bossIdAt(depth));
      assert.equal(kings.length, 0, `d${depth}/s${seed}: the act's boss on an ordinary floor`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
