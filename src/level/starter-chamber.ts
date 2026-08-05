import type { LevelSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';
import { rollStarterWeapons } from '../content/starter-weapons';
import { ceilingFor, generateRoomShape } from './room-shape';
import { polyRoomRect } from './poly-room-shell';
import { describeWalls } from './wall-surfaces';
import { sconcesOn } from './wall-sconces';
import { pilasterVolumes } from './poly-dressing';
import { RoomOccupancy } from './room-occupancy';

// Starter chamber — the first room of EVERY fresh run. Three altars,
// one weapon each. The player picks one (which auto-equips and
// dismisses the other two offers) and only then can the stairs at
// the back be descended.
//
// The three offered weapons are ROLLED from the starter pool (seeded by
// the run), not a static triad — see content/starter-weapons.ts. The
// chamber is built once per run and cached, so the offering is stable if
// you wander back to it before choosing.
//
// Layout note (matters for stair body): the stair descends INTO the
// back wall over STAIRWELL_TOTAL_DEPTH (~2.56m) along its rotY
// direction. The stair TOP must sit at least that far in front of
// the back wall or the body buries into the wall mesh. The hand-
// authored placement below leaves ~0.9m clearance.

const STARTER_FLOOR_GLOW = floorGlow(0x6c5c40);

// ── THE FIRST POLYGON ROOM IN THE GAME ────────────────────────────────────────
//
// The room-shape v2 generator (level/room-shape.ts) wired into content, not a
// debug scenario — scenarios are DEV-gated and stripped from the live build, so
// the only way to WALK a generated shape is for one to be real. The starter
// chamber is the right first subject: every fresh run opens here, its contents
// are hand-placed (so the fit is verifiable rather than hoped for), and 'apse'
// is what this room already was in spirit — a nave you walk up, narrowing into a
// sanctuary that holds the way down.
//
// The seed is FIXED, not rolled. This is the one room in the game that is the
// same every run; it's a ceremony, not a floor. 88 was chosen off a search for
// the symmetric draws that clear every altar, candle, hint, sconce and the whole
// stair body — see tests/starter-chamber.test.ts, which re-checks that fit
// against the real polygon so a change to the grammar can't quietly wall
// something in.
const STARTER_SHAPE_SEED = 88;
const STARTER_W = 8, STARTER_D = 14;

function fixedRand(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The chamber's floor outline. World coords — the room is centred on the origin. */
export const STARTER_POLY = generateRoomShape('apse', {
  w: STARTER_W, d: STARTER_D, rand: fixedRand(STARTER_SHAPE_SEED),
});
/** Height comes from the archetype too: an apse is tall for its span, so the
 *  chamber goes from a flat 2.8m lid to something you look UP in. */
const STARTER_CEILING = ceilingFor('apse', STARTER_W, STARTER_D, 0.5);
/** The chamber's wall faces. Computed once — the shape is fixed, so these are
 *  as constant as the polygon is, and everything mounted on a wall reads them
 *  instead of a coordinate somebody measured. */
const STARTER_WALLS = describeWalls({ poly: STARTER_POLY, height: STARTER_CEILING.height });
/** The chamber's own architecture, reserved, so nothing mounted on a wall ends
 *  up inside a pier. The shell builds the same piers from the same plan — this
 *  is the plan, not a second guess at it. */
const STARTER_OCCUPANCY = new RoomOccupancy();
STARTER_OCCUPANCY.reserveAll(
  pilasterVolumes(STARTER_WALLS, STARTER_CEILING.height, 0), 'pilaster');

export function buildStarterChamber(nextLevelId: string, seed?: number): LevelSpec {
  // Roll three distinct base weapons for the altars (left → centre →
  // right). Seeded for reproducibility (?seed=N); an undefined seed picks
  // a fresh roll, stable for the run because this spec is cached.
  const rollSeed = seed ?? Math.floor(Math.random() * 0xffffffff);
  const offered = rollStarterWeapons(rollSeed, 3);
  const ALTAR_X = [-2.4, 0.0, 2.4];

  return {
    id: 'starter',
    depth: 0,
    displayName: 'choose the thing you will die with',
    fogColor: 0x14100a,

    // Player enters at the south end facing north (-Z) toward the
    // three altars. Room is 8 × 14m so the stair body has room to
    // extend without burying into the back wall.
    startPos: { x: 0, z: 5.5, yaw: 0 },
    // Suppress the builder's auto wake-beside-fire threshold bonfire: the
    // weapon-select chamber is a choice, not a rest — no fate fire here. The
    // origin arch (placed independently of the fire) is unaffected.
    composerManagedFires: true,

    rooms: [
      {
        id: 'antechamber',
        // rect stays the polygon's BOUNDING BOX — elevation, the nav bbox and the
        // walkable union all still read it. The polygon's wall segments are what
        // actually contain the player, so the cut corners are unreachable.
        rect: polyRoomRect(STARTER_POLY),
        height: STARTER_CEILING.height,
        poly: STARTER_POLY,
      },
    ],
    corridors: [],

    props: [
      // ── THREE STARTER ALTARS ──────────────────────────────────────
      // Rolled from the starter pool (left → centre → right).
      ...offered.map((weaponId, i) => ({
        kind: 'starter-altar' as const, x: ALTAR_X[i], z: 0.0, rotY: 0, weaponId,
      })),

      // Floor candles in FRONT of each altar (player's approach side) —
      // warm halo per offering.
      { kind: 'model', model: FLOOR_CANDLE, x: -2.4, y: 0, z: 1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x:  0.0, y: 0, z: 1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x:  2.4, y: 0, z: 1.0 },

      // Mid-chamber floor glow near the stairs but offset so it doesn't
      // sit under the stair body / parapet.
      { kind: 'model', model: STARTER_FLOOR_GLOW, x: 0, y: 0, z: -2.0 },

      // ── DIEGETIC HINTS ───────────────────────────────────────────
      {
        kind: 'hint',
        x: 0, z: 4.0,
        text: 'pick. the dark is patient. you are not.',
        triggerRadius: 3.0,
        lingerMs: 5000,
      },
      {
        kind: 'hint',
        x: 0, z: -2.5,
        text: 'the way down will not open empty-handed.',
        triggerRadius: 2.4,
        lingerMs: 4000,
      },
    ],

    // ── LIGHT, ASKED OF THE WALLS ────────────────────────────────────
    // These used to be six hand-measured coordinates, and one of them —
    // `{ x: -3.95, z: -3.5, wall: 'W' }` — hung in the void the moment the
    // room became an apse, because the west wall stops existing at that Z.
    // Fixing it by hand fixed one sconce and none of the ones that would do
    // the same thing next time the shape moved.
    //
    // The art direction is unchanged and now says what it MEANS: the sanctuary
    // burns cold, the nave burns warm and cools as you walk up it toward the
    // altars. Both are predicates over walls, so the chamber re-lights itself
    // correctly if the polygon is ever regenerated.
    torches: sconcesOn(STARTER_WALLS, [
      {
        // THE APSE — the short walls behind the altars, where the stair is.
        // Moonlight blue, mounted low so it doesn't fight the stair's own halo.
        pick: (s) => s.mid[1] < -3,
        spacing: [2.4, 4], height: 1.8, minWall: 1.8,
        tint: 0x88aaff, intensity: 0.75,
      },
      {
        // THE NAVE — the two long side walls. Warm at the entrance where you
        // arrive, cooling toward the altars, so walking up the room is a
        // temperature change rather than a brightness one.
        // Same spacing band as the piers plus `inBays`, so the flames land in
        // the bays BETWEEN them instead of fighting them for the same stone.
        pick: (s) => s.length > 6,
        spacing: [3.0, 4.6], inBays: true, height: 2.0,
        tint: (m) => (m.z > 2 ? 0xffaa55 : 0xc8c0e0),
        intensity: (m) => (m.z > 2 ? 0.9 : 0.7),
      },
    ], STARTER_OCCUPANCY),

    // No mobs. The starter chamber is the choice, not the test.
    spawns: [],

    doors: [],

    stairs: [
      {
        id: 'starter-stairs',
        // Stair top z=-3.5; rotY=Math.PI descends INTO -Z (north wall).
        // Body extends STAIRWELL_TOTAL_DEPTH (~2.56m) from the top to
        // z=-6.06, leaving ~0.9m clearance to the back wall at z=-7.
        x: 0, z: -3.5,
        rotY: Math.PI,
        targetLevel: nextLevelId,
        // SEALED until the player equips a weapon at one of the
        // altars. stairs.ts re-checks the predicate every tick.
        unlock: { kind: 'has-equipment', slot: 'weapon' },
      },
    ],
  };
}
