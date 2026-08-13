// THE BOSS FLOOR, AS ASSEMBLED.
//
// Four separate failures reached the phone as one report — "the boss room under
// poly floors is a bit bugged ... the stair is before the mist and the mist
// leads to nowhere ... the boss is active before I traverse the mist" — and
// each of them is checkable from the generated spec alone, so each gets a case
// here rather than another round trip to a real run.
//
//   1. The boss is DORMANT. Awake, it hunts and swings from behind its own fog
//      wall while the arena is culled, which reaches the player as damage out of
//      nothing. Every other producer of a boss spawn set this flag; the polygon
//      generator was written after them and never carried it.
//   2. The mist exists and sits on the arena's ENTRANCE.
//   3. The stair is INSIDE the arena and BEYOND the boss, so the hall is a room
//      you cross rather than a doorway you glance into.
//   4. The hall is BIG. It used to be shaped as an ordinary finish room, which
//      lands ~11×11 for a creature two of whose body-lengths span it.
//
//   npm test -- poly-boss-hall

import assert from 'node:assert/strict';
import { generateFloor } from '../src/level/procgen';
import { isBossDepth } from '../src/level/acts';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

interface Floor {
  rooms: Array<{ id: string; rect: { x: number; z: number; w: number; d: number }; roomType?: string }>;
  spawns: Array<{ enemyId: string; x: number; z: number; roomId?: string; dormant?: boolean }>;
  corridors: Array<{ id: string; rect: { x: number; z: number; w: number; d: number } }>;
  stairs: Array<{ x: number; z: number }>;
  openings?: Array<{ kind: string; x: number; z: number }>;
}

const DEPTHS: number[] = [];
for (let d = 1; d <= 30; d++) if (isBossDepth(d)) DEPTHS.push(d);

/** Every boss floor across a spread of seeds — the sample the audit script ran. */
function bossFloors(): Array<{ depth: number; seed: number; f: Floor }> {
  const out: Array<{ depth: number; seed: number; f: Floor }> = [];
  for (const depth of DEPTHS) {
    for (let i = 0; i < 4; i++) {
      const seed = 5000 + i * 3571;
      out.push({ depth, seed, f: generateFloor(depth, seed) as unknown as Floor });
    }
  }
  return out;
}
const FLOORS = bossFloors();

function arena(f: Floor) {
  // The EMITTED spec calls it `roomType`; the generator's internal room object
  // calls it `type`. Reading the wrong one is how the first version of this
  // check picked a pocket room and "found" 72 bugs that were not there.
  return f.rooms.find((r) => r.roomType === 'finish') ?? f.rooms[f.rooms.length - 1];
}
function bossOf(f: Floor) {
  const a = arena(f);
  return f.spawns.find((s) => s.roomId === a.id);
}
function fogOf(f: Floor) {
  return (f.openings ?? []).find((o) => o.kind === 'fog-gate');
}

test('FIXTURE: there are boss depths and they generate', () => {
  assert.ok(DEPTHS.length >= 3, `only ${DEPTHS.length} boss depths — the sweep tests almost nothing`);
  assert.ok(FLOORS.length >= 12);
});

test('THE BOSS IS DORMANT — it does not fight you through its own fog wall', () => {
  for (const { depth, seed, f } of FLOORS) {
    const boss = bossOf(f);
    assert.ok(boss, `d${depth} seed ${seed}: nothing spawned in the arena`);
    assert.equal(boss.dormant, true,
      `d${depth} seed ${seed}: ${boss.enemyId} is awake at floor load — it hunts from behind the mist`);
  }
});

test('THE MIST EXISTS, and sits where the corridor arrives', () => {
  // NOT "on the bounding box edge" — that was the first version of this case and
  // it failed against correct geometry. These rooms are POLYGONS: a cross or a
  // rotunda has real wall well inside its bbox, so a doorway on a re-entrant
  // face is nowhere near the box. What the complaint ("the mist leads to
  // nowhere") is actually about is whether the mist is at the WAY IN, so that is
  // what gets measured — distance to the nearest corridor.
  for (const { depth, seed, f } of FLOORS) {
    const fog = fogOf(f);
    assert.ok(fog, `d${depth} seed ${seed}: no fog gate at all`);
    let nearest = Infinity;
    for (const c of f.corridors) {
      const dx = Math.max(0, Math.abs(fog.x - c.rect.x) - c.rect.w / 2);
      const dz = Math.max(0, Math.abs(fog.z - c.rect.z) - c.rect.d / 2);
      nearest = Math.min(nearest, Math.hypot(dx, dz));
    }
    assert.ok(nearest <= 2.0,
      `d${depth} seed ${seed}: fog at (${fog.x.toFixed(1)}, ${fog.z.toFixed(1)}) is ${nearest.toFixed(1)}m `
      + 'from the nearest corridor — it is hanging on a wall nobody walks through');
  }
});

test('THE STAIR IS PAST THE BOSS — the arena is crossed, not glanced into', () => {
  for (const { depth, seed, f } of FLOORS) {
    const a = arena(f), fog = fogOf(f)!, boss = bossOf(f)!, stair = f.stairs[0];
    assert.ok(stair, `d${depth} seed ${seed}: no stair`);
    // Inside the arena.
    assert.ok(Math.abs(stair.x - a.rect.x) <= a.rect.w / 2 + 0.01
      && Math.abs(stair.z - a.rect.z) <= a.rect.d / 2 + 0.01,
      `d${depth} seed ${seed}: the stair is outside the arena`);
    // And further from the gate than the boss is, so you cannot walk past him.
    const toStair = Math.hypot(stair.x - fog.x, stair.z - fog.z);
    const toBoss = Math.hypot(boss.x - fog.x, boss.z - fog.z);
    assert.ok(toStair > toBoss,
      `d${depth} seed ${seed}: the way out (${toStair.toFixed(1)}m from the mist) is nearer than the boss `
      + `(${toBoss.toFixed(1)}m) — the fight is optional`);
  }
});

test('THE HALL IS A HALL — not a finish room with a boss in it', () => {
  // It used to be shaped from TYPE_SIZE.finish (12–18 × 10–15) and measured out
  // at 11×11 on real seeds. A boss hall has to outrank an arena (14–19 × 12–16).
  for (const { depth, seed, f } of FLOORS) {
    const a = arena(f);
    const small = Math.min(a.rect.w, a.rect.d);
    assert.ok(small >= 17,
      `d${depth} seed ${seed}: arena is ${a.rect.w.toFixed(1)}×${a.rect.d.toFixed(1)} — `
      + 'no room to circle a boss in');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
