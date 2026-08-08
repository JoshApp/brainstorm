import type { LevelSpec, RoomSpec, PropSpec, TorchSpec, EnemySpawnSpec, WalkableRect } from './types';
import {
  ARCHETYPES, ceilingFor, generateRoomShape, polyArea, polyBounds,
  type Archetype, type Poly,
} from './room-shape';
import { describeWalls, findMountableRun, clearDepth, type WallSurface } from './wall-surfaces';
import { sconcesOn } from './wall-sconces';
import { candidateSpots, clearance, hasSightline, roomCenter } from './floor-region';
import { pointInPoly } from './room-shape';
import { RoomOccupancy } from './room-occupancy';
import { pilasterVolumes } from './poly-dressing';
import { rollFloorEnemies } from './procgen';
import { nextLevelAfter, isBossDepth, actForDepth } from './acts';
import { bossById, type BossSpec } from '../content/bosses';
import { planFloor, dedicatedEntries } from './floor-plan';
import { planCentrepiece } from './centrepieces';
import { roomType, type RoomTypeId, type RoomModifier } from './room-types';
import { assignModifiers, type ModifierPlan } from './room-modifiers';
import { ROLE_CAPS, type FloorRoles, type RoomNode } from './floor-roles';
import { planInterior, type InteriorForm } from './room-interior';
import { planVoids } from './room-voids';
import { evictFromVoids } from './void-evict';
import { emitFramesForPortals } from './portal-frames';
import { planPortals } from './portals';
import { corridorTypeFor, type CorridorType, CORRIDOR_TYPES, MIN_WALKABLE_WIDTH } from './corridor-types';
import { mainline as graphMainline, faults, type FloorGraph, type GraphEdge } from './floor-graph';
import { deriveAnchors } from './anchors';
import { chooseLinkRoute } from './corridor-route';
import { ceilingForLink } from './corridor-ceiling';
import { dressCorridors } from './corridor-decor';
import { planRoomLight, type Fixture, type Mount } from './light-plan';
import { planElevation, linkRectsMisplaced, chordSkipFits } from './poly-elevation';
import { corridorRampRun } from './elevation';
import { plateExtentFor } from './corridor-trim';
import { archetypeForSpan, roomSpan } from './encounter-shape';
import { resolveSkin } from './skin';
import { activeSkin } from './skins';
import { wallFixtureKindOf, wallFixtureModel } from './lit-fixture-pool';
import { propFacts, type Claim } from './prop-taxonomy';
import { directFloor } from './floor-director';
import type { ContentSpot } from './floor-fill';
import { rollDropTable } from '../content/drop-tables';
import { decorPolyFloor, clusterSomeVases } from './poly-decor';
import { surfaceDressRoom } from './poly-surface';
import { roomWear } from './room-wear';

// ── A FLOOR MADE OF POLYGONS ─────────────────────────────────────────────────
//
// The vault composer builds a floor out of hand-drawn ASCII tilemaps and then
// spends five repair passes fixing what that placed blindly. This builds one out
// of SHAPES, and places content by ASKING THE ROOM — which is the whole point of
// wall-surfaces.ts, floor-region.ts and room-occupancy.ts existing.
//
// Not a port of the composer. The retrofit pass (polygonise.ts) tried to reach
// the same place from the other end, cutting corners off vault rooms, and it
// tops out around 17% because a tilemap has already committed to where
// everything goes. You cannot make placement smart by editing the room after
// the placement happened. So this owns both.
//
// What it does NOT do yet, deliberately: elevation, voids, bosses, and the
// PRICED modifiers (toll / gated) with the pass that sets their prices. Those
// are the next things to move, one at a time, each with the measurement that
// says it worked.
//
// The ORDER matters and is the actual design:
//
//   0. PLAN the floor        (what it OWES you, before any geometry exists)
//   1. SHAPE the rooms       (type → archetype → size → ceiling)
//   2. PLACE them            (spine + the spurs the plan demanded)
//   3. CONNECT them          (corridors, which become doorways in the walls)
//   4. RESERVE what's built  (the piers the shell will raise)
//   5. FURNISH by query      (centrepiece → clutter → sconces → spawns)
//
// Content is placed against a room that already knows its own shape, and every
// placement reserves its volume, so the next one can see it. That's the whole
// difference from "place, then repair".
//
// Step 0 and the staging in step 5 are SHARED WITH THE VAULT COMPOSER, not
// reimplemented: floor-plan.ts decides the contract, room-types.ts says what a
// type tolerates, centrepieces.ts stages the thing the room is about. The two
// generators disagree about how to build a room; they must not disagree about
// what a floor IS. What is genuinely new here is that the stager gets a better
// question answered — `free()` is the real polygon plus a 3D occupancy, where
// the composer could only offer a grid of tilemap cells.

/**
 * The shortest spine any floor is allowed: arrive, meet one thing, leave.
 *
 * Two rooms would be a corridor with a door at each end — there is nowhere to
 * put the floor's beat. Three is the real minimum and a depth-1 floor does
 * reach it (measured: 1 floor in 96, d1/s222, entrance → combat → finish, both
 * links routed). Exported so an audit asserts the generator's own floor rather
 * than a number that merely happened to hold on the sample it was written
 * against.
 */
export const MIN_SPINE = 3;

/** Rooms on the main spine, by depth. Small floors early, longer later. */
function spineLength(depth: number, rand: () => number): number {
  const base = depth <= 2 ? MIN_SPINE : depth <= 6 ? 4 : 5;
  return base + (rand() < 0.4 ? 1 : 0);
}

/**
 * SHAPE FOLLOWS FUNCTION.
 *
 * A room's outline is the first thing that says what it's for, and it says it
 * before you can read a single prop — from the doorway, in the dark, at the
 * range the lamp reaches. So the room's TYPE picks the shape, and the type
 * comes from the floor's contract (floor-plan.ts), not from whatever the
 * layout happened to grow. That inversion is the point: under the tilemap
 * composer a trove looked like a trove because a vault author drew one, and a
 * seed that grew no suitable room simply went without.
 *
 * The pairings are arguments, not decoration:
 *   trove / shop   — apse and rotunda have a BACK. A presentation needs
 *                    somewhere to be presented against.
 *   arena          — rotunda and cross: open, symmetric, no corner to kite into.
 *   trap           — hall and ell: a crossing you must make, which is the only
 *                    place a trap is a trap rather than scenery.
 *   sanctum / quiet— tomb and cavern: small and held. A fire in a hall is a
 *                    campsite; a fire in a tomb is a mercy.
 */
const TYPE_SHAPES: Record<string, readonly Archetype[]> = {
  entrance: ['chamber', 'apse', 'rotunda'],
  finish:   ['apse', 'rotunda', 'cross'],
  trove:    ['apse', 'rotunda'],
  shop:     ['apse', 'chamber', 'notched'],
  arena:    ['rotunda', 'cross', 'chamber'],
  sanctum:  ['tomb', 'cavern', 'apse'],
  trap:     ['hall', 'ell', 'notched'],
  feature:  ['chamber', 'wedge', 'notched'],
  combat:   ['chamber', 'cross', 'notched', 'cavern'],
  quiet:    ['tomb', 'cavern', 'hall'],
};

/**
 * What kind of stone a room may stand INSIDE itself, in preference order.
 *
 * An empty room is a corridor with a bigger number. Stone you have to go around
 * is what makes a room a place to fight in — cover that breaks a sightline, a
 * choke you commit through, a colonnade that turns one floor into a nave and
 * two aisles. Empty is still the common answer: a floor where every room is
 * subdivided has no room that READS as subdivided, so this only offers forms to
 * the types they suit, and room-interior.ts refuses any that breaks the room.
 *
 *   colonnade — a fight with cover and flanking. Big rooms.
 *   pinch     — a gate you commit through. A crossing, so: traps and passages.
 *   ring      — the middle approached through stone rather than seen across an
 *               empty floor. What a trove and a fire want.
 */
const TYPE_INTERIOR: Record<string, readonly InteriorForm[]> = {
  arena:   ['colonnade', 'ring'],
  combat:  ['colonnade', 'pinch'],
  trap:    ['pinch'],
  finish:  ['colonnade'],
  sanctum: ['ring'],
  // Deliberately absent: TROVE and SHOP. Both are `clean`, and clean means the
  // room is a stage — a ring of columns between you and three offerings is
  // exactly the thing that flag exists to forbid.
};

/** Floor area band per type, in metres of bounding box. A trove needs room for
 *  three plinths and the standing back to look at them; a quiet room is dread,
 *  and dread is close. */
const TYPE_SIZE: Record<string, readonly [number, number, number, number]> = {
  entrance: [10, 16, 8, 13],
  finish:   [12, 18, 10, 15],
  trove:    [12, 17, 10, 14],
  shop:     [11, 15, 9, 12],
  arena:    [14, 19, 12, 16],
  sanctum:  [8, 12, 7, 10],
  trap:     [9, 15, 7, 11],
  feature:  [10, 15, 8, 12],
  combat:   [10, 16, 8, 13],
  quiet:    [7, 11, 6, 9],
};

interface Placed {
  id: string;
  /** What this room IS, from the floor's contract. Drives shape, size, what may
   *  be staged in it, and whether anything wanders in. */
  type: RoomTypeId;
  poly: Poly;
  rect: { x: number; z: number; w: number; d: number };
  height: number;
  walls: WallSurface[];
  occupancy: RoomOccupancy;
}

type Box = { x: number; z: number; w: number; d: number };
type Dir = 'N' | 'S' | 'E' | 'W';

export const MARGIN = 1.5;          // gap between unrelated boxes, so walls never clip
/**
 * How far off its predecessor's centre line the next room may sit, metres.
 *
 * Swept against 72 floors with the reroll in place: 0 faulty floors at every
 * setting up to 2.2m, 1 at 3.0m. Off-line pairs jump to 68% by 0.8m and do not
 * climb after — the variety is bought early — so 1.5m takes it without spending
 * the reroll's patience (1.58 attempts against 1.13 on the grid).
 */
const LATERAL_FREEDOM = 1.5;
/** Metres between two spikes of a `hazard` room. Closer and it stops being a
 *  line you pick and becomes a maze you thread. */
const HAZARD_SPREAD = 3.2;
/**
 * Metres of floor around the descent that nothing may stand in.
 *
 * The stair itself is mounted off a 2.2m wall run and set back 2.9m, so its own
 * body is most of this; the rest is the standing room you need to see it and
 * turn onto it. Measured from the failure: pillars landed as close as 0.47m, and
 * 104 more sat between 1.0m and 2.2m — close enough to crowd the mouth even when
 * they were not on it.
 */
const DESCENT_CLEAR = 2.2;
/** How far a corridor pushes past a room's wall, so the opening rect straddles
 *  the wall it is meant to cut instead of stopping at it. */
const OVERLAP = 0.9;
/**
 * Per ELIGIBLE room — a plain, non-bookend room with no centrepiece.
 *
 * Looks high, and it is the roll that ISN'T the rate limiter. Eligible rooms —
 * plain, non-bookend, no centrepiece, and big enough that a rift is a feature of
 * the room rather than the room — come out at about 0.37 per floor. At 0.18 this
 * put a rift on 7% of floors, which is a feature most runs never meet.
 *
 * Tuned against the OUTPUT instead: 23% of floors, one rift each, two or three
 * in a full descent. Still the strongest thing the floor can say, and still
 * never two in one room — a floor with holes everywhere is a platforming level.
 */
const VOID_CHANCE = 0.70;
/**
 * The width the LAYOUT PASS reserves for a path it has not built yet.
 *
 * Not a corridor width — corridor-types.ts owns those now. This is the box
 * `stepFrom` keeps other rooms out of while the spine is being packed, before
 * anything knows how far apart the two rooms will end up or which section will
 * fill the gap. It stays at the old constant deliberately: it is a placement
 * heuristic, and MARGIN is what actually guarantees the clearance —
 *
 *   RESERVE_W / 2 + MARGIN  >=  widest section / 2
 *
 * which is 2.6m of kept-clear against a gallery's 1.8m half-width. That
 * inequality is the load-bearing part, so it is asserted in a test rather than
 * left as a comment that a later widening can quietly outgrow.
 */
export const RESERVE_W = 2.2;
/**
 * The gap a loop edge may span, metres, measured between the two rooms' boxes.
 *
 * Under the floor it is not a corridor, it is two rooms sharing a wall. Over
 * the ceiling it is a tunnel long enough that using it costs more than walking
 * back the way you came, which is a shortcut nobody takes.
 */
/**
 * How far apart two rooms may be, centre to centre, and still be worth looping.
 *
 * A sanity bound, not the real gate — the loop already has to skip exactly one
 * spine room, and those sit a measured p50 32m and p90 36m apart. Set at 26
 * first, from a guess, and it admitted 5 pairs across 72 floors.
 */
const LOOP_MAX_REACH = 45;

/** How often a connection bends instead of running straight. */
const DOGLEG_CHANCE = 0.45;
/** (exit lateral, entry lateral) offsets to try for a bend, nearest first. The
 *  pair must differ by enough that the kink actually blocks the sightline. */
const DOGLEG_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 3], [0, -3], [-2.5, 2.5], [2.5, -2.5], [0, 4.5], [0, -4.5],
];

/**
 * Build a complete floor out of polygon rooms.
 *
 * Deterministic for (depth, seed) — every floor in this game must regenerate
 * identically on resume, so nothing here may touch Math.random.
 */
export function generatePolyFloor(depth: number, seed: number): LevelSpec {
  return rollUntilSound(depth, seed);
}

/**
 * REJECT THE PLAN, DO NOT AUDIT THE FLOOR.
 *
 * Stage 2 of the topology-first plan. Every global property this generator has
 * ever got wrong — a room nobody can reach, a detour that stopped being one, a
 * gate on the mainline — was enforced by LOCAL greedy decisions that could not
 * see each other, and then found afterwards by an audit reporting "16 of 240
 * floors violate this". Each of those became a patched producer and a rule
 * living in one place that four other producers never read.
 *
 * On the graph they are total and cheap (level/floor-graph.ts `faults`), and a
 * floor is 7 rooms at the median, so a failed roll costs microseconds. So the
 * generator now BUILDS, CHECKS, AND ROLLS AGAIN — the property holds by
 * construction rather than by everybody remembering.
 *
 * Determinism is preserved exactly: the attempt index is folded into the seed,
 * so `(depth, seed)` still names one floor forever. And it degrades rather than
 * fails — the last attempt ships even if it is faulty, because a floor with a
 * flaw is recoverable and a floor that does not exist is not.
 */
const MAX_ATTEMPTS = 6;

function rollUntilSound(depth: number, seed: number): LevelSpec {
  let last: LevelSpec | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const spec = buildPolyFloor(depth, seed, attempt);
    last = spec;
    if (!spec.graph) break;
    const bad = [...faults(spec.graph), ...craftFaults(spec)];
    if (!bad.length) {
      (spec as { generationAttempts?: number }).generationAttempts = attempt + 1;
      return spec;
    }
  }
  (last as { generationAttempts?: number }).generationAttempts = MAX_ATTEMPTS;
  return last!;
}

/**
 * How many links this floor's corridors were ROUTED on the walls' own anchors,
 * and how many fell through to the pre-anchor guess.
 *
 * Module-level because `connect` is a free function several passes deep, and
 * threading a counter through every one of them to report a build statistic
 * would be worse than a variable this file resets at the top of each attempt.
 * Read straight back by the reroll, which treats a floor built mostly by guess
 * as a floor worth rolling again.
 */
const linkTally = { routed: 0, guessed: 0 };

/**
 * A FLOOR MOSTLY BUILT BY GUESSWORK IS WORTH ROLLING AGAIN.
 *
 * `faults` asks whether the floor is SOUND — reachable, no orphans, detours
 * that are still detours. This asks whether it is WELL MADE, which is a
 * different question and previously had no home at all.
 *
 * Every doorway that still wraps a corner comes from the pre-anchor path: the
 * router declines where two walls cannot see each other, and the guess builds
 * something anyway. Measured before this existed, per floor: median 17% of
 * links guessed, p90 40%, worst 80%. A floor at 80% is one the layout simply
 * made badly, and it is cheaper to roll it again than to make the guess better.
 *
 * A third is the bar. Not zero — the guess is the degrade-never-fail path and a
 * floor that loses a link is worse than one imperfect corridor — but a floor
 * where most corridors could not be anchored has a placement problem the reroll
 * can just walk away from.
 */
const MAX_GUESS_SHARE = 1 / 3;

function craftFaults(spec: LevelSpec): string[] {
  const t = spec.anchoredLinks;
  if (!t) return [];
  const total = t.routed + t.guessed;
  if (total < 3) return [];   // too few links for a share to mean anything
  const share = t.guessed / total;
  return share > MAX_GUESS_SHARE
    ? [`${t.guessed} of ${total} corridors could not be anchored to a wall `
       + `(${(share * 100).toFixed(0)}%, over the ${(MAX_GUESS_SHARE * 100).toFixed(0)}% bar)`]
    : [];
}

function buildPolyFloor(depth: number, seed: number, attempt: number): LevelSpec {
  linkTally.routed = 0;
  linkTally.guessed = 0;
  // The attempt index folds into the stream, so a reroll is a DIFFERENT floor
  // rather than the same one built twice. Attempt 0 must hash to exactly what
  // this generator produced before rerolling existed, or every seed in every
  // save moves.
  const rand = mulberry(attempt === 0 ? hash(depth, seed)
    : (hash(depth, seed) ^ Math.imul(attempt, 0x85ebca6b)) >>> 0);
  // DRESSING ROLLS DO NOT TOUCH THE LAYOUT STREAM.
  //
  // The skin resolver picks between a torch and a cresset, a brazier and a pike
  // — pure taste, with no bearing on where anything goes. Drawn from `rand`,
  // those picks advance the shared stream and every later decision on the floor
  // shifts with them: measured, adding the wall pool moved three sconces, one
  // standing light and one glow across 240 floors, none of which were about
  // fixtures. That coupling is invisible and it makes a theme change look like a
  // level change. A separate stream, derived from the same seed so it stays
  // deterministic, keeps "what it is made of" independent of "where things are".
  const dressRand = mulberry((hash(depth, seed) ^ 0x5ce5cafe ^ Math.imul(attempt, 0xc2b2ae35)) >>> 0);

  // ── 0. THE CONTRACT, BEFORE ANY GEOMETRY EXISTS ────────────────────
  // floor-plan.ts states what the floor OWES the player — an offer, a threat,
  // maybe a mercy — and which of those want their own dead-end spur. The layout
  // then GROWS exactly that many spurs instead of rolling for one and hoping,
  // which is the bug that header was written about: a floor's content must not
  // be a consequence of the shape a seed happened to produce.
  //
  // This is shared with the vault composer on purpose. The two generators
  // disagree about how to build a room; they must not disagree about what a
  // floor is.
  const plan = planFloor(depth, rand);
  const dedicated = dedicatedEntries(plan);
  const inline = plan.all.filter((e) => e.placement !== 'dedicated');

  // The spine has to be long enough to seat everything that wants to be ON it,
  // between the two bookends. A floor that plans three inline beats and grows
  // two middle rooms would silently drop one.
  const n = Math.max(spineLength(depth, rand), 2 + inline.length);

  // ── 1 + 2. SHAPE, THEN PLACE ───────────────────────────────────────
  // Shape first: a room's polygon is decided from its ROLE and its budget, and
  // the layout then packs the bounding boxes that result. Doing it the other way
  // — pack boxes, then fit a shape into each — is how you end up with shapes
  // that are all the same because the boxes were.
  const rooms: Placed[] = [];
  const occupiedBoxes: Box[] = [];
  let cursor: Box = { x: 0, z: 0, w: 0, d: 0 };
  let heading: Dir = 'S';
  /** roomId → the layout reservation for the path leading into it. See below. */
  const placeholder = new Map<string, Box>();

  // Which spine slot each inline beat takes. Spread across the middle rather
  // than stacked at the front: the plan's beats are the floor's landmarks, and
  // landmarks need ordinary rooms to stand against.
  const middles = n - 2;
  const inlineAt = new Map<number, RoomTypeId>();
  inline.forEach((e, i) => {
    inlineAt.set(1 + Math.floor(((i + 0.5) * middles) / Math.max(1, inline.length)), e.id);
  });

  for (let i = 0; i < n; i++) {
    const type: RoomTypeId = i === 0 ? 'entrance'
      : i === n - 1 ? 'finish'
      : inlineAt.get(i) ?? (rand() < 0.3 ? 'quiet' : 'combat');
    const room = shapeRoom(`poly-${i}`, type, depth, rand);
    if (i === 0) {
      place(room, 0, 0);
      cursor = room.rect; occupiedBoxes.push(cursor);
      rooms.push(room);
      continue;
    }
    const step = stepFrom(cursor, room.rect, heading, rand, occupiedBoxes);
    place(room, step.at.x, step.at.z);
    rooms.push(room);
    occupiedBoxes.push(room.rect, step.corridor);
    // The placeholder is a LAYOUT reservation, not a corridor: it keeps other
    // rooms out of the path between these two while boxes are being packed. The
    // real corridor is computed later and is allowed to occupy that same space —
    // so remember which pair it belongs to, or connect() will find its own
    // reservation in the way and refuse every route that isn't dead straight.
    placeholder.set(room.id, step.corridor);
    cursor = room.rect;
    heading = step.dir;
  }

  // Dead-end pockets, off a middle room. Bonus exploration, and the shapes that
  // read best small (tomb, cavern) only ever appear here.
  //
  // How many rooms the SPINE has, captured before pockets start joining `rooms`
  // — the parent pick below must not be able to choose one of them.
  const spineCount = rooms.length;
  const corridors: RoomSpec[] = [];
  // A LINK IS A LIST OF RECTS, not one. A dogleg is three, and every downstream
  // reader — wall cutting, doorway finding, the light pass — has to see all of
  // them or it will cut a doorway into the middle of a bend.
  const links: Array<{
    from: string; to: string; rects: Box[]; ids: string[];
    spur?: boolean; chord?: boolean;
    legAxis?: Array<{ alongX: boolean; fromIsLo: boolean }>;
  }> = [];
  const addLink = (
    from: string, to: string, id: string, conn: Connection,
    kind: { spur?: boolean; chord?: boolean } = {},
  ): void => {
    const { rects, type } = conn;
    // The rect ids are kept alongside the rects because the ELEVATION pass has
    // to stamp a ramp on a specific corridor RoomSpec, and re-deriving the
    // `cor-3-1` naming at the far end of the file is exactly the kind of
    // duplicated convention that drifts.
    const ids = rects.map((_, k) => (rects.length > 1 ? `${id}-${k}` : id));
    rects.forEach((rect, k) => {
      // The section's ceiling, not a constant. The frame models already take
      // `openHeight` from this and compress to it, so a squeeze gets a low door
      // and a gallery a tall one without either knowing about the other.
      // `linkId` is the CONNECTION these legs share. Recorded here because this
      // is the only place that knows it — see the note on RoomSpec.linkId, and
      // the dead doorframe it exists to prevent.
      corridors.push({ id: ids[k], rect, height: type.height, corridorType: type.id, linkId: id });
      occupiedBoxes.push(rect);
    });
    links.push({ from, to, rects, ids, legAxis: conn.legAxis, ...kind });
  };
  for (let i = 1; i < rooms.length; i++) {
    const c = connect(rooms[i - 1], rooms[i], rand,
                      occupiedBoxes.filter((o) => o !== placeholder.get(rooms[i].id)),
                      rooms);
    if (c) addLink(rooms[i - 1].id, rooms[i].id, `cor-${i}`, c);
  }
  // DEAD-END SPURS ARE OWED, NOT ROLLED. One per dedicated plan entry, plus a
  // spare when the floor asked for none — a floor with no detour at all is a
  // corridor with rooms on it.
  const spurTypes: RoomTypeId[] = dedicated.map((e) => e.id);
  /** The pockets that actually landed, with the spine room each hangs off.
   *  The loop pass below needs both; a pocket that failed to place has neither. */
  const pockets: Array<{ pocket: Placed; parent: string; forLoop: boolean }> = [];
  if (spurTypes.length === 0) spurTypes.push(rand() < 0.5 ? 'quiet' : 'combat');
  // ONE MORE THAN THE PLAN OWES, and it is the one the loop is allowed to eat.
  //
  // The loop wants a pocket — a room hung off the spine at its own angle, which
  // is the only thing on this floor another corridor can reach (see the header
  // at 2.75). But a pocket that stops being a dead end stops being a detour,
  // and floor-plan.ts asked for those by name. Measured when the loop was free
  // to take any pocket: cobwebs across 72 floors went to ZERO, because a web
  // only hangs in a room with one exit and the search took the owed pocket
  // every time. The webs were the symptom; the floor quietly losing its
  // cul-de-sac was the disease.
  //
  // So the floor grows a spare. The plan's detours stay dead ends; the spare is
  // the one that comes out somewhere.
  const LOOP_POCKET = spurTypes.length;
  spurTypes.push(rand() < 0.5 ? 'quiet' : 'combat');
  for (let p = 0; p < spurTypes.length; p++) {
    // OFF A SPINE ROOM, NOT OFF ANOTHER POCKET.
    //
    // `rooms` grows as pockets land, so picking from it let a later pocket hang
    // off an earlier one — and the moment it does, the first pocket has two ways
    // out and is not a detour any more. That is the same failure that took
    // cobwebs to zero (a web only hangs where there is one exit), arriving by a
    // different route. 3 of 60 floors.
    //
    // Found by the floor graph on its first day, from the rule "a spur leads to
    // a dead end" — which is one line there and was invisible in the walk.
    const parent = rooms[1 + Math.floor(rand() * Math.max(1, spineCount - 2))];
    const pocket = shapeRoom(`poly-pocket-${p}`, spurTypes[p], depth, rand);
    const dirs: Dir[] = shuffle(['N', 'S', 'E', 'W'], rand);
    for (const dir of dirs) {
      const g = geometryFor(parent.rect, pocket.rect, dir, 4 + rand() * 3);
      const clash = occupiedBoxes.some((o) => overlaps(o, g.at, MARGIN))
                 || occupiedBoxes.some((o) => o !== parent.rect && overlaps(o, g.corridor, MARGIN));
      if (clash) continue;
      place(pocket, g.at.x, g.at.z);
      rooms.push(pocket);
      occupiedBoxes.push(pocket.rect, g.corridor);
      placeholder.set(pocket.id, g.corridor);
      addLink(parent.id, pocket.id, `cor-p${p}`,
              connect(parent, pocket, rand,
                      occupiedBoxes.filter((o) => o !== g.corridor), rooms)
                ?? { rects: [g.corridor], type: CORRIDOR_TYPES.passage },
              { spur: true });   // the elevation pass clamps a spur to the spine's floor
      pockets.push({ pocket, parent: parent.id, forLoop: p === LOOP_POCKET });
      break;
    }
  }

  // ── 2.75. ONE LOOP, SO THE FLOOR STOPS BEING A TREE ───────────────────────
  //
  // Until here every floor is a TREE: a spine with dead-end pockets hung off
  // it. A tree has exactly one route between any two rooms, so every room you
  // clear you also walk back out of the way you came, and a fork in a corridor
  // can only ever be a detour you will have to undo. One cycle changes both —
  // you can come back a different way, and a junction becomes a real choice.
  //
  // This needed `connectL` to exist first; the header on that function has the
  // measurement, and the short version is that until it did, every corridor
  // this generator could build joined two rooms that were already joined.
  //
  // ONE. Two cycles on a six-room floor is a maze, and the point is not to make
  // the floor hard to read — it is to stop it reading as a corridor with rooms
  // on it. Nearest pair first, so the loop is a shortcut you would plausibly
  // take rather than a tunnel across the map.
  //
  // A SHORTCUT, NOT A RE-ROUTE. The mainline takes the SPINE edges only (see
  // its call below), so a loop can never pull a room off the intended route and
  // un-gate the content the floor plan put there. The spine is still the way
  // through; the loop is the other way back.
  //
  // THREE THINGS DISQUALIFY A CANDIDATE, and each is a rule that already lives
  // somewhere else in the generator:
  //
  //   1. It must SKIP something. Adjacent rooms are already linked, and a
  //      second corridor between them is a double door, not a loop.
  //   2. It must be able to CARRY THE FALL. Elevation is not computed until
  //      three hundred lines below, after the walls are described, so the
  //      question is asked in the WORST case — `chordSkipFits` in
  //      poly-elevation.ts owns that reasoning.
  //   3. Its rects must not overlap a room they are not pinned to, via the same
  //      `linkRectsMisplaced` the elevation pass uses. A chord that ends inside
  //      a third room steps at that room's doorway, and unlike a spine link
  //      there is no drop to veto — both its ends are already fixed.
  //
  // AND IT MUST NOT TOUCH A POCKET. This looked like the better loop — the dead
  // end you went into for the loot now comes out further along — and it is what
  // the first working version did. Then the cobweb count went from healthy to
  // ZERO across 72 floors, because a web only hangs in a room with exactly one
  // exit and the nearest-pair search was taking the floor's pocket every single
  // time. The webs were the symptom; the disease is that `floor-plan.ts` OWES
  // this floor a detour and the loop was quietly spending it. A pocket that is
  // no longer a cul-de-sac is not a pocket.
  const linked = new Set(links.map((l) => `${l.from}|${l.to}`));
  const roomRects = new Map(rooms.map((r) => [r.id, r.rect] as const));
  const spineOf = (id: string) => rooms.findIndex((r) => r.id === id);
  const loopType = CORRIDOR_TYPES.passage;
  const loopPocket = pockets.find((p) => p.forLoop);
  const pairs: Array<{ a: Placed; b: Placed; d: number }> = [];
  if (loopPocket) {
    const owned = new Set(pockets.map((p) => p.pocket.id));
    for (const b of rooms) {
      if (b.id === loopPocket.pocket.id || b.id === loopPocket.parent) continue;
      if (owned.has(b.id)) continue;                       // pocket to pocket is not a loop
      const a = loopPocket.pocket;
      if (linked.has(`${a.id}|${b.id}`) || linked.has(`${b.id}|${a.id}`)) continue;
      const d = Math.hypot(a.rect.x - b.rect.x, a.rect.z - b.rect.z);
      if (d > LOOP_MAX_REACH) continue;
      pairs.push({ a, b, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d);
  for (const { a, b } of pairs) {
    const conn = connectL(a, b, loopType.width, occupiedBoxes);
    if (!conn) continue;
    // The stair-run this loop offers, from the same helper the elevation pass
    // measures a ramp with. The landing carries no slope.
    const run = conn.rects.reduce((t, rc, k) => (k === 1 ? t
      : t + corridorRampRun(conn.legAxis![k].alongX ? rc.w : rc.d)), 0);
    // The pocket sits one link off its parent, so the fall this has to carry is
    // bounded by that link plus the spine span from the parent to the target.
    const span = Math.abs(spineOf(loopPocket!.parent) - spineOf(b.id)) + 1;
    if (!chordSkipFits(span, run)) continue;
    if (linkRectsMisplaced({ from: a.id, to: b.id, rects: conn.rects }, roomRects)) continue;
    // ── AND NO LEG MAY LIE INSIDE A ROOM ──────────────────────────────────
    //
    // `connectL` is the pre-anchor path and has no self-room check — the router
    // grew one (rooms are not convex, so a wall can face outward while the line
    // from it re-enters the room's own missing quadrant), but the chord builder
    // never did. On the grid it rarely mattered; with placement freed it put
    // 3.84m of corridor floor inside a room on d11/s777.
    //
    // Checked on the PLATE the builder is handed, not on the rect: the rect is
    // meant to end inside the room, and measuring it would reject every chord.
    if (conn.rects.some((rc) => plateInsideRoom(rc, rooms))) continue;
    addLink(a.id, b.id, 'cor-l0', { ...conn, type: loopType }, { chord: true });
    break;
  }

  // ── 2.5. NO CORRIDOR TALLER THAN THE ROOM IT OPENS INTO ───────────────────
  //
  // The gallery's 4.60m ceiling against rooms that start at 2.8m. The rule and
  // the reason live in corridor-ceiling.ts; applied per LINK so a dogleg does
  // not step its ceiling halfway round the bend.
  const specById = new Map(corridors.map((c) => [c.id, c]));
  for (const l of links) {
    const legs = l.ids.map((id) => specById.get(id)).filter((c): c is RoomSpec => !!c);
    if (!legs.length) continue;
    const h = ceilingForLink(legs[0].height, l.rects, rooms);
    for (const leg of legs) leg.height = h;
  }

  // ── 3. CONNECT. Corridors cut the walls; the shell does that from the same
  // rects, so a doorway in the geometry and a doorway in the plan are the same
  // doorway rather than two computations that agree until one changes.
  const openings = corridors.map((c) => c.rect);
  for (const r of rooms) {
    r.walls = describeWalls({ poly: r.poly, height: r.height, openings });
  }

  // ── 4. RESERVE what the shell will build. The piers are a pure function of
  // the polygon, so they can be known now — before a single prop is placed.
  for (const r of rooms) {
    r.occupancy.reserveAll(pilasterVolumes(r.walls, r.height, 0), 'pilaster');
  }

  // ── 5. FURNISH ─────────────────────────────────────────────────────
  const props: PropSpec[] = [];
  const torches: TorchSpec[] = [];
  const spawns: EnemySpawnSpec[] = [];
  const entrance = rooms[0];
  // Yaw is filled in below, once the floor knows which way is onward.
  const startPos = { ...roomCenter(entrance.poly), yaw: 0 };
  // THE PLAYER IS A PLACED THING TOO.
  //
  // `roomCenter` is the point furthest from any wall, so it is where the spawn
  // goes AND where a centrepiece wants to go — and furnish put a vase there, on
  // top of the player. The flood reported ONE reachable cell on two of three
  // sampled depths: not a sealed floor, a delver standing inside a pot. Reserve
  // it before anything else asks the room for space, and every later placer
  // sees it for free because they all go through the same occupancy.
  entrance.occupancy.reserve(
    { kind: 'cylinder', x: startPos.x, z: startPos.z, r: 1.3, y0: 0, y1: 2.0 }, 'spawn');

  // ── MODIFIERS — what happens TO the room, layered on what it IS ────
  //
  // A trove you have to fight for and a trove you walk into are the same room
  // with different weather. room-modifiers.ts owns which room takes which — it
  // picks the modifier FIRST and then finds a room that tolerates it, because
  // picking the room first biases every floor toward whichever type is most
  // permissive. It only wants a role lookup and each room's connection count,
  // both of which this generator already knows, so it plugs straight in.
  const connections = new Map<string, number>();
  for (const l of links) {
    connections.set(l.from, (connections.get(l.from) ?? 0) + 1);
    connections.set(l.to, (connections.get(l.to) ?? 0) + 1);
  }
  const nodes: RoomNode[] = rooms.map((r) => ({
    roomId: r.id, tags: [], slot: 'mid', connections: connections.get(r.id) ?? 1,
  }));
  const byType = new Map(rooms.map((r) => [r.id, r.type]));
  const roles: FloorRoles = {
    role: (id) => byType.get(id) ?? 'combat',
    caps: (id) => ROLE_CAPS[byType.get(id) ?? 'combat'],
    bonfireScore: () => 0,
    designate: (id, role) => { byType.set(id, role); },
    entries: () => byType,
  };
  const mods: ModifierPlan = assignModifiers(roles, nodes, { depth, rand });

  // Rooms whose centrepiece actually took the `guarded` flag. See the seal
  // below: a portcullis with nothing to reach for can never close.
  // THE DESCENT IS DECIDED BEFORE THE ROOMS ARE FURNISHED, not after.
  //
  // It used to be computed at the end, which was fine while nothing needed to
  // know about it. The light pass does: the way on always gets marked (a phone
  // player hunting for the stair in the dark is doing a chore, not feeling
  // tension), and it cannot mark something that does not exist yet.
  const last = rooms.find((x) => x.type === 'finish') ?? rooms[rooms.length - 1];
  const stairWall = findMountableRun(last.walls, last.poly, { length: 2.2, depth: 3.0, clearOfJambs: true });
  const stairs = stairWall
    ? [{
        id: 'poly-stairs',
        // Set back from the wall by the stair's own run so the body has room to
        // descend INTO the masonry rather than through it.
        x: stairWall.mid[0] + stairWall.inward[0] * 2.9,
        z: stairWall.mid[1] + stairWall.inward[1] * 2.9,
        // The stair descends along its rotY; it must point AT the wall, i.e.
        // opposite the wall's inward normal.
        rotY: Math.atan2(-stairWall.inward[0], -stairWall.inward[1]),
        targetLevel: nextLevelAfter(depth),
      }]
    : [];

  // ── 5b. RIFTS — the one thing you cannot walk through ───────────────
  //
  // The polygon path had no voids at all; the vault path has had them since the
  // carve pass. This closes that, but it does NOT port the carve pass's rule of
  // sprinkling by density — that one had to be fenced off staged rooms after it
  // put chasms through the middle of troves and shops. A hole in the floor is
  // the strongest geometry statement the game can make, so it goes only where
  // the room has nothing else to say (see level/room-voids.ts).
  //
  // Before FURNISH, so the interior stone, the staging and the decor all see it
  // and place around it. planVoids floods the room itself, so a rift can never
  // strand a doorway or the stair.
  const voids: WalkableRect[] = [];
  for (const r of rooms) {
    const def = roomType(r.type);
    if (def.centrepiece !== 'none' || def.clean) continue;         // the floor is a stage
    if (r === rooms[0] || r === last) continue;                     // never the bookends
    if (rand() >= VOID_CHANCE) continue;
    const rift = planVoids(r.poly, {
      doorways: doorwaysOf(r, links),
      mustReach: doorwaysOf(r, links),
      rand,
    });
    if (!rift) continue;
    for (const v of rift) {
      voids.push({ x: v.x, z: v.z, w: v.w, d: v.d });
      r.occupancy.reserve(
        { kind: 'box', x: v.x, z: v.z, halfW: v.w / 2, halfD: v.d / 2, rotY: 0, y0: -4, y1: 0.4 },
        'void');
    }
  }

  // ── THE ACT'S BOSS ─────────────────────────────────────────────────
  //
  // Boss depths used to fall through to the vault composer entirely
  // (`procgen.ts`: `usePolyFloors() && !isBossDepth(depth)`), so a run on
  // polygon floors changed generator every fifth floor — different rooms,
  // different corridors, different everything, at the one moment the floor is
  // most trying to make an impression.
  //
  // The hall is the FINISH room: you fight the boss and the stairs out are in
  // the same chamber, which is what `nextLevelAfter` already says about a boss
  // depth (its stair targets the act's safe room, not the next depth).
  const boss = isBossDepth(depth) ? bossById(actForDepth(depth).bossId) : null;

  const guardedRooms = new Set<string>();
  for (const r of rooms) {
    const descent = r === last && stairs.length ? { x: stairs[0].x, z: stairs[0].z } : undefined;
    if (furnish(r, mouthOf(r, links), doorwaysOf(r, links), depth, rand, dressRand,
                props, torches, spawns, mods.byRoom.get(r.id)?.kind, descent,
                boss && r === last ? boss : undefined)) guardedRooms.add(r.id);
  }

  // ── THE FOG WALL ───────────────────────────────────────────────────
  //
  // The mist across the arena's threshold: you can walk through it, and it
  // seals behind you. The builder wires the trigger and the seal off this prop
  // alone, so all this has to get right is WHERE and HOW WIDE.
  //
  // Which is the one thing the vault path had to work at — it derives the gate
  // from the arena's offset, its dims and the direction it was placed from
  // (`bossGatePlacement`), then guesses 3.4m when it cannot find the corridor.
  // A polygon floor already knows: `planPortals` returns the doorway's
  // midpoint, its rotation and the clear span of the passage behind it, and it
  // is the SAME call the frame is mounted from — so the mist and the archway it
  // hangs in cannot disagree.
  if (boss) {
    const mouth = mouthOf(last, links);
    const ports = planPortals(last.id, last.poly,
      corridors.map((c) => ({ id: c.id, rect: c.rect, link: c.linkId })));
    // The one you come in by. Nearest the mouth — a boss hall is a leaf, so
    // there is normally exactly one, and picking the nearest is only doing work
    // on the floors where the loop pass gave it a second way in.
    const gate = mouth
      ? ports.reduce<typeof ports[number] | null>((best, p) => {
        const d = Math.hypot(p.mid[0] - mouth.x, p.mid[1] - mouth.z);
        return !best || d < Math.hypot(best.mid[0] - mouth.x, best.mid[1] - mouth.z) ? p : best;
      }, null)
      : ports[0] ?? null;
    if (gate) {
      props.push({
        kind: 'boss-mist',
        x: gate.mid[0], z: gate.mid[1], rotY: gate.rotY,
        color: boss.mistColor ?? 0xffd060,
        width: gate.clearWidth,
      } as PropSpec);
    }
  }

  // ── 6. THE DIRECTOR — the floor's reward and its question ──────────
  //
  // The contract (step 0) guarantees an OFFER every floor, but on any floor that
  // is not the act's trove floor that offer is a `feature` room whose
  // centrepiece is 'bargain' — and planCentrepiece returns EMPTY for a bargain
  // on purpose, because in the vault path the FILL/DIRECTOR stage places it.
  // That stage had not moved over, so measured across 240 generated floors all
  // 180 feature rooms were empty and 15% of floors held nothing to take or use
  // at all. A dungeon you descend with nothing to want in it is the one thing
  // worse than a rectangular one.
  //
  // `directFloor` is the real thing rather than a reimplementation of it: it
  // wants a role lookup, a list of dumb content markers and what is already
  // placed, and it owns rules worth keeping — including that a fire and a deal
  // never share a room, which docs/DESIGN-METHOD.md records being violated on 16
  // floors in 240 the last time a second producer forgot it.
  //
  // `suppressFire` because the plan already staged this floor's fire as a
  // sanctum centrepiece, and two fires undo the scarcity that makes reaching one
  // matter.
  // WHERE EACH ROOM'S DOORWAYS ARE, asked once. `planPortals` is the same call
  // the frames, the webs and the spawn facing make, so every one of them means
  // the same thing by "the doorway".
  const doorwaysByRoom = new Map<string, Array<{ x: number; z: number }>>();
  for (const r of rooms) {
    // `link`, not just `rect` — a dogleg's legs are one way through, so this
    // must see the SAME doorway the frame emitter and the wall ring see. Passing
    // the RoomSpecs raw compiles (linkId is not `link`) and quietly reinstates a
    // doorway per leg here alone, which is how a standoff rule ends up measuring
    // a door nobody can walk through.
    doorwaysByRoom.set(r.id, planPortals(r.id, r.poly,
      corridors.map((c) => ({ id: c.id, rect: c.rect, link: c.linkId })))
      .map((p) => ({ x: p.mid[0], z: p.mid[1] })));
  }
  /**
   * How far a MAJOR beat must stand off a doorway, for a room of this size.
   *
   * Josh: *"I saw a choice basin and other events placed weirdly — the room is
   * big and it's placed really close to the doorway I am entering. That choice
   * feels unnatural."*
   *
   * Measured over 72 floors, 264 major events: 11% stood within 3m of a doorway
   * and the closest was 1.3m. The deals were the worst of it — the tithe basin
   * a median 3.8m out and a minimum of 1.4m — because the candidate filter only
   * ever knew about WALLS (`band: [1.2, Infinity]` is distance from the stone).
   * A doorway is not a wall. It is where you are standing when you arrive, and a
   * bargain you can touch before you are through the door is one you never chose
   * to approach.
   *
   * Scaled by the room, not fixed: three metres is most of a small chamber and
   * nothing in a hall, and the complaint was specifically about a BIG room.
   */
  const doorwayClearance = (poly: Poly): number =>
    Math.max(3.0, 0.22 * Math.sqrt(polyArea(poly)));

  const contentSpots: ContentSpot[] = [];
  for (const r of rooms) {
    const def = roomType(r.type);
    if (def.clean) continue;                       // a stage takes nothing but its own piece
    if (!def.event && !def.minorLoot) continue;
    const c = roomCenter(r.poly);
    // The focal marker is the room's open middle. The rest are off-centre, which
    // is where a SECONDARY read like a reward chest belongs — the centre is the
    // event's. Every marker goes through the occupancy, so the director can only
    // ever claim floor nothing else took.
    const allSpots = candidateSpots(r.poly, { radius: 0.8, band: [1.2, Infinity], pitch: 0.9 });
    const spread = spreadPick(allSpots, 3, mouthOf(r, links));
    const doors = doorwaysByRoom.get(r.id) ?? [];
    const offDoor = (x: number, z: number): number =>
      doors.reduce((m, d) => Math.min(m, Math.hypot(d.x - x, d.z - z)), Infinity);
    const clear = doorwayClearance(r.poly);
    const usable: ContentSpot[] = [];
    const crowded: Array<ContentSpot & { off: number }> = [];
    for (const cand of [{ x: c.x, z: c.z, focal: true },
                        ...spread.map((sp) => ({ x: sp.x, z: sp.z, focal: false }))]) {
      if (!r.occupancy.fits({ kind: 'cylinder', x: cand.x, z: cand.z, r: 0.7, y0: 0, y1: 1.6 }, 0.3)) continue;
      const spot = { x: cand.x, z: cand.z, roomId: r.id, focal: cand.focal };
      const off = offDoor(cand.x, cand.z);
      if (off >= clear) usable.push(spot); else crowded.push({ ...spot, off });
    }
    // A ROOM THAT OFFERS NOTHING GETS NOTHING, which is worse than a beat near a
    // door — so when the clearance rule refuses every offered candidate, the
    // room still gets one. But it looks HARDER first.
    //
    // The three markers above are `spreadPick`ed for variety, not for distance
    // from a doorway, so "all three were too close" does not mean the room has
    // nowhere better. It usually has: the one floor this ever fired on was a
    // 10.9m room with 82 candidate spots, the furthest 8.4m from any door, and
    // it seated an altar 1.37m from one. So fall back to the WHOLE candidate
    // set and take the furthest that fits, and only after that give back the
    // best of a bad lot — which is the honest answer in a chamber whose entire
    // floor is within three metres of its own mouth.
    if (usable.length) { contentSpots.push(...usable); continue; }
    const rescue = allSpots
      .map((sp) => ({ sp, off: offDoor(sp.x, sp.z) }))
      .sort((a, b) => b.off - a.off)
      .find(({ sp }) => r.occupancy.fits(
        { kind: 'cylinder', x: sp.x, z: sp.z, r: 0.7, y0: 0, y1: 1.6 }, 0.3));
    if (rescue) contentSpots.push({ x: rescue.sp.x, z: rescue.sp.z, roomId: r.id, focal: false });
    else if (crowded.length) {
      crowded.sort((a, b) => b.off - a.off);
      contentSpots.push({ x: crowded[0].x, z: crowded[0].z, roomId: r.id, focal: crowded[0].focal });
    }
  }
  const directed = directFloor({
    depth, rand, roles, suppressFire: true,
    fireAnchors: [], fireFallbackCells: [],
    contentSpots, bakedProps: props,
  });
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  if (directed.find) {
    props.push({
      kind: 'chest', x: directed.find.x, z: directed.find.z,
      tier: 'silver', loot: directed.find.loot, facing: { kind: 'wall-away' },
    } as PropSpec);
    roomById.get(directed.find.roomId)?.occupancy.reserve(
      { kind: 'cylinder', x: directed.find.x, z: directed.find.z, r: 0.7, y0: 0, y1: 1.2 }, 'find');
  }
  if (directed.deal) {
    props.push({ kind: directed.deal.kind, x: directed.deal.x, z: directed.deal.z } as PropSpec);
    roomById.get(directed.deal.roomId)?.occupancy.reserve(
      { kind: 'cylinder', x: directed.deal.x, z: directed.deal.z, r: 0.8, y0: 0, y1: 1.6 }, 'deal');
  }

  // THE OFFER SLOT IS GUARANTEED — floor-plan.ts says so in words, and until now
  // nothing enforced it.
  //
  // The contract states the offer is "always present"; on a non-trove floor it
  // is a bargain, which the DIRECTOR places — and the director is allowed to
  // roll no find and no question. When it declines and the floor's own plan
  // staged no trove, shop or gauntlet either, the floor keeps its promise on
  // paper and breaks it in play. Measured at 5 floors in 240: they had a fire
  // and breakables, so they were never EMPTY, but they carried nothing the
  // contract had promised.
  //
  // Backstop, not a second producer: it only fires when the floor would
  // otherwise have no staged offer at all, and it uses the same drop table the
  // director's find uses, so it cannot become a quiet extra reward stream.
  const OFFER_KINDS = new Set(['offering', 'chest', 'merchant', 'challenge-offering',
                               'tithe-basin', 'altar', 'blood-altar']);
  const hasOffer = props.some((p) => OFFER_KINDS.has((p as { kind: string }).kind));
  if (!hasOffer) {
    const spot = contentSpots.find(
      (sp) => roomById.get(sp.roomId)?.occupancy.fits(
        { kind: 'cylinder', x: sp.x, z: sp.z, r: 0.7, y0: 0, y1: 1.2 }, 0.3) ?? false);
    if (spot) {
      props.push({
        kind: 'chest', x: spot.x, z: spot.z, tier: 'silver',
        loot: rollDropTable('defining-find', depth, rand), facing: { kind: 'wall-away' },
      } as PropSpec);
      roomById.get(spot.roomId)?.occupancy.reserve(
        { kind: 'cylinder', x: spot.x, z: spot.z, r: 0.7, y0: 0, y1: 1.2 }, 'find');
    }
  }

  // ── 7. THE SMALL FOUND THINGS ──────────────────────────────────────
  //
  // Bodies, bone shrines, webs across a mouth, a glyph the lamp finds. Last,
  // because dressing must see everything the floor already committed to — and
  // it goes through the same occupancy as everything else, so it cannot land
  // inside a pier, a lamp, a chest or the thing the room is about.
  // Which rooms the player MUST walk through to reach the stairs. Anything that
  // gates — a web, and whatever else wants to cost a swing later — belongs off
  // this path, never on it.
  // ── THE FLOOR, AS A GRAPH ─────────────────────────────────────────────────
  //
  // The walk above already decided a topology — a spine, pockets hung off it,
  // sometimes a chord. Until now that only existed in control flow, so every
  // question about it downstream was re-derived from rectangles. Here it becomes
  // a thing (level/floor-graph.ts), and rides on the spec so the audits and the
  // placement rules can ask it directly.
  //
  // Nothing about the built floor changes. That is the point of doing it as a
  // refactor: an extraction with no behaviour delta can be PROVED equivalent
  // against the shipping pipeline, where a new generator could only be argued
  // for. Constraints and reroll come next, on this seam.
  const graph: FloorGraph = {
    nodes: rooms.map((r, i) => ({ id: r.id, type: r.type, index: i })),
    edges: links.map((l, i): GraphEdge => ({
      id: l.ids[0] ?? `edge-${i}`,
      from: l.from,
      to: l.to,
      kind: l.chord ? 'chord' : l.spur ? 'spur' : 'spine',
    })),
    entrance: rooms[0]?.id,
    exit: last?.id,
  };
  // THE SPINE EDGES ONLY. A chord is a shortcut, not a re-route: the mainline is
  // a shortest path, so leaving the loop edge in would let it cut the corner and
  // silently drop the room it skipped — un-gating that room's content and
  // pointing the descent spawn down the wrong corridor.
  const mainline = graphMainline({ ...graph, edges: graph.edges.filter((e) => e.kind !== 'chord') });
  // WHICH WAY THE PLAYER IS LOOKING WHEN THEY ARRIVE.
  //
  // Josh: *"when spawning down floors sometimes the player faces a wrong
  // direction, not towards the exit."* Not sometimes — always. This generator
  // never computed a facing at all; `startPos.yaw` was the literal 0 it was
  // initialised with, so every descent on every seed dropped the player looking
  // down world −Z and the way on was wherever it happened to be.
  //
  // A descent is the one moment the dungeon gets to say "that way". Face the
  // doorway that leads onward — the one whose corridor reaches a room on the
  // spawn→stairs path — so the first thing in frame is the way through.
  startPos.yaw = spawnYawToward(startPos, entrance, links, corridors, mainline);
  // WHAT EACH ROOM ALREADY SAYS ABOUT ITSELF, read off the floor as it stands.
  //
  // Through `propFacts`, never a second copy of the claim table — the first
  // audit of this rule carried its own and reported the same number before and
  // after the table changed (docs/DESIGN-METHOD.md). Wall brackets go in as
  // their models too, because a torch is a prop the moment you ask what it
  // asserts, even though the spec keeps it in a different list.
  const claimsOf = (r: Placed): Claim[] => {
    const out = new Set<Claim>();
    for (const p of props) {
      const q = p as unknown as { x: number; z: number };
      if (!pointInPoly(r.poly, q.x, q.z)) continue;
      for (const c of propFacts(p)?.claims ?? []) out.add(c);
    }
    for (const t of torches) {
      if (!pointInPoly(r.poly, t.x, t.z)) continue;
      const asProp = { kind: 'model', model: wallFixtureModel(t.fixtureKind), x: t.x, y: 0, z: t.z } as PropSpec;
      for (const c of propFacts(asProp)?.claims ?? []) out.add(c);
    }
    return [...out];
  };
  const decor = decorPolyFloor(
    rooms.map((r) => ({
      id: r.id, type: r.type, poly: r.poly, walls: r.walls, occupancy: r.occupancy,
      mouth: mouthOf(r, links),
      // THE SAME CALL THE FRAMES MAKE. A web and the stone doorway it hangs in
      // have to agree, and the only way to guarantee that is to ask once.
      doorways: planPortals(r.id, r.poly,
        corridors.map((c) => ({ id: c.id, rect: c.rect, link: c.linkId }))).map((p) => ({
        x: p.mid[0], z: p.mid[1], rotY: p.rotY, width: p.clearWidth,
      })),   // yaw + width too, which the clearance pass above does not need
      exits: links.filter((l) => l.from === r.id || l.to === r.id).length,
      onMainline: mainline.has(r.id),
      claims: claimsOf(r),
    })),
    depth, rand);
  props.push(...decor.props);


  // ── EVIDENCE IN THE CORRIDORS ──────────────────────────────────────
  //
  // Rooms stage events; corridors hold residue. Measured before this existed:
  // one prop per hundred metres of corridor, excluding the doorframes a
  // corridor owns anyway. corridor-decor.ts owns the vocabulary and the rule
  // that a section can only carry what still leaves it walkable.
  //
  // On `dressRand`, not `rand`: what a passage is strewn with must not move
  // where anything on the floor GOES. Same reason the skin resolver got its own
  // stream — see the header at the top of this function.
  props.push(...dressCorridors(
    corridors,
    // The portal midpoints, from the same call the frames are built from.
    [...doorwaysByRoom.values()].flat(),
    rooms.map((r) => r.poly),
    dressRand));
  clusterSomeVases(props, rand);

  // Placed LAST, after every producer that READS `props`. It appends to the
  // same array `clusterSomeVases` walks, so running it earlier changed how many
  // vases that pass considered and moved them — which is what `A THEME CHANGE
  // IS NOT A LEVEL CHANGE` caught. Its own stream stops it moving anything by
  // RANDOMNESS; being last stops it moving anything by ORDER.
  // ── THE GRIT ───────────────────────────────────────────────────────
  //
  // The DECORATE pass procgen.ts's note has named as missing since polygon
  // floors were switched on: *"legible and correctly staged, and still barer
  // than a vault floor between its beats."* Measured against the vault path,
  // 50 floors each: 83.8 surface props and 53.5 geometry props per floor there,
  // ZERO here. Everything else in that comparison is within a factor of two.
  //
  // On `dressRand`, not `rand`: what a floor is strewn with must never be able
  // to move a spawn or a staged beat. Same rule the corridor pass below follows,
  // and the same reason it exists.
  //
  // AFTER decor and furnishing, so it sees a full occupancy and dresses AROUND
  // the things the floor is about rather than needing them to dodge it.
  for (const r of rooms) {
    surfaceDressRoom({
      id: r.id, type: r.type, poly: r.poly, walls: r.walls,
      occupancy: r.occupancy, claims: claimsOf(r),
      // The SAME call the wall shell makes, so a room whose masonry is coming
      // down is a room with rubble on its floor.
      wear: roomWear(r.id),
    }, props);
  }

  // NOTHING STANDS OVER A HOLE — the same final-state check the vault path runs
  // (level/void-evict.ts). The rift pass fires BEFORE furnishing and reserves
  // its rect, so in principle nothing can land in one; this is here because
  // "in principle" is what the vault path also had, and 17 props were standing
  // in mid-air. A rule about the finished floor gets checked on the finished
  // floor.
  evictFromVoids(props, {
    // The rooms hand over their POLYGONS, not just their boxes — see the note
    // on EvictSurface. Corridors are rects and have nothing else to give.
    floors: [...rooms.map((r) => ({ ...r.rect, poly: r.poly })),
             ...corridors.map((c) => c.rect)],
    voids,
  });

  // ── THE FLOOR GOES DOWN ────────────────────────────────────────────
  //
  // Rooms become plateaus, corridors become ramps. See poly-elevation.ts for
  // the shape of it — the short version is that the descent is monotonic, so
  // the way out is the lowest ground you've stood on and depth reads as
  // progress without anybody being told.
  //
  // LAST, on a settled layout, and on its OWN rng stream. The layout must not
  // move because the floor learned to fall — same reason the skin rolls on
  // `dressRand`: adding a roll to `rand` shifted three sconces and a glow
  // across 240 floors the first time it was tried.
  const elevRand = mulberry((hash(depth, seed) ^ 0x0e1e7a7e) >>> 0);
  const elevation = planElevation(
    links,
    new Map(rooms.map((r) => [r.id, r.rect])),
    elevRand,
  );
  for (const c of corridors) {
    const stamp = elevation.corridor.get(c.id);
    if (stamp) Object.assign(c, stamp);
  }

  const spec: LevelSpec = {
    id: `poly-${depth}`,
    seed,
    depth,
    displayName: undefined,
    // A boss may recolour its own hall — the Marrow Sovereign's charnel red.
    // Left undefined otherwise so the act's palette applies, exactly as the
    // vault path does it (`procgen.ts` passes the same two fields).
    fogColor: boss?.arenaFogColor,
    composerManagedFires: true,
    startPos,
    graph,
    anchoredLinks: { ...linkTally },
    rooms: rooms.map((r) => {
      const m = mods.byRoom.get(r.id);
      return {
        id: r.id, rect: r.rect, height: r.height, poly: r.poly, roomType: r.type,
        // The plateau this room sits on. Rooms are internally FLAT by design —
        // a fight happens on one plane, so combat math, the splat map and the
        // nav grid never see a slope.
        elevation: elevation.room.get(r.id) ?? 0,
        // An AMBUSH slams shut on you as you cross; a CONTESTED room waits until
        // you reach for what it's guarding. Same enemies, opposite emotions —
        // which is why they are different seals and not a flag on one.
        // A CONTESTED seal only ships when the centrepiece could actually carry
        // the trigger. `guarded` exists on offerings and chests alone, so a
        // contested SANCTUM — a rest you fight for, which sounds great — has
        // nothing to reach for, and the portcullis can never close. Measured:
        // 12 of 40 contested rooms landed on a fire and were silently inert.
        // An absent modifier is honest; one that pretends is not.
        perimeterFitting: m?.kind === 'ambush' ? 'arena-trap'
          : (m?.kind === 'contested' && guardedRooms.has(r.id)) || r.type === 'arena'
            ? 'arena-portcullis'
          : undefined,
        // A room sealed by a modifier runs a SHORTER gauntlet than an arena's
        // full trial — an ambush should bite and be over.
        arenaWaves: m?.waves,
        // `dark` is a one-word override, not a lighting special case: the build
        // already knows how to render an unlit room.
        lightTier: m?.kind === 'dark' ? 'dark' : undefined,
      } as RoomSpec;
    }),
    corridors,
    props,
    torches,
    spawns,
    doors: [],
    stairs,
    voids,
  };

  // FRAMES + THE EYE, on the finished spec.
  //
  // Every doorway gets an archway or a doorframe, mounted on the PORTAL — so a
  // doorway in a chamfered wall gets a frame square to THAT wall rather than to
  // the world. The archway eye (scene/archway-eye.ts) and the threshold draft
  // both ride the frame model, which is why polygon floors had neither: they
  // were never disabled, they simply had nothing to hang on.
  emitFramesForPortals(spec);

  return spec;
}

// ── shaping ──────────────────────────────────────────────────────────────────

function shapeRoom(id: string, type: RoomTypeId, depth: number, rand: () => number): Placed {
  const pool = TYPE_SHAPES[type] ?? TYPE_SHAPES.combat;
  const kind = pool[Math.floor(rand() * pool.length)];
  const [wLo, wHi, dLo, dHi] = TYPE_SIZE[type] ?? TYPE_SIZE.combat;
  const w = wLo + rand() * (wHi - wLo) + Math.min(3, depth * 0.15);
  const d = dLo + rand() * (dHi - dLo) + Math.min(3, depth * 0.15);
  const poly = generateRoomShape(kind, { w, d, rand });
  const b = polyBounds(poly);
  const ceil = ceilingFor(kind, w, d, rand());
  return {
    id, type, poly,
    rect: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, d: b.maxZ - b.minZ },
    height: ceil.height,
    walls: [],
    occupancy: new RoomOccupancy(),
  };
}

/** Move a shaped room so its bounding box is centred at (x, z). */
function place(r: Placed, x: number, z: number): void {
  const dx = x - r.rect.x, dz = z - r.rect.z;
  r.poly = r.poly.map(([px, pz]) => [px + dx, pz + dz] as const);
  r.rect = { ...r.rect, x, z };
}

// ── layout ───────────────────────────────────────────────────────────────────

function stepFrom(
  from: Box, size: Box, heading: Dir, rand: () => number, occupied: readonly Box[],
): { at: Box; corridor: Box; dir: Dir } {
  // Straight-biased wander: try the current heading, then the two turns. Never
  // reverse — a spine that doubles back reads as a mistake rather than a route.
  const [t0, t1] = heading === 'N' || heading === 'S' ? ['E', 'W'] as const : ['N', 'S'] as const;
  const order: Dir[] = rand() < 0.55 ? [heading, t0, t1] : [heading, t1, t0];
  for (const dir of order) {
    const len = 4 + rand() * 4;
    const g = geometryFor(from, size, dir, len, (rand() * 2 - 1) * LATERAL_FREEDOM);
    const clear = !occupied.some((o) => overlaps(o, g.at, MARGIN))
      && !occupied.some((o) => o !== from && overlaps(o, g.corridor, MARGIN));
    if (clear) return { ...g, dir };
  }
  // Fallback: push straight out, lengthening until it clears. Terminates —
  // far enough away, nothing is there. Degrade, never fail.
  for (let len = 5; len < 60; len += 3) {
    const g = geometryFor(from, size, heading, len);
    if (!occupied.some((o) => overlaps(o, g.at, MARGIN) || (o !== from && overlaps(o, g.corridor, MARGIN)))) {
      return { ...g, dir: heading };
    }
  }
  return { ...geometryFor(from, size, heading, 60), dir: heading };
}

/**
 * THE GRID WAS A TAX, NOT A DECISION.
 *
 * This put every room on its predecessor's EXACT centre line, and that is why 0
 * of 183 link pairs were ever perpendicular to each other and why floors read as
 * a diagram. It was never a layout choice — it was the price the straight-
 * corridor model charged, because two rooms that did not share a centre line
 * could not be joined at all.
 *
 * `corridor-route.ts` removed that price. Simulated before freeing it, by
 * displacing every room and re-routing:
 *
 *   lateral freedom   straight-only   routed
 *   +/-0m (the grid)       83%          99%
 *   +/-3m                  81%          99%
 *   +/-5m                  69%          99%
 *
 * Routing holds flat while the straight model collapses. So `lateral` slides
 * the next room off the line, and the router absorbs it with a bend.
 *
 * The reservation box widens to cover the slide. It is a LAYOUT hold — it keeps
 * other rooms out of the ground the corridor will need — and an offset corridor
 * needs an L of ground, so a box spanning both laterals is the honest reserve.
 * Holding slightly more than the corridor finally uses is the safe error here;
 * holding a straight strip while the corridor bends around it is not.
 */
function geometryFor(
  from: Box, size: Box, dir: Dir, len: number, lateral = 0,
): { at: Box; corridor: Box } {
  const half = (b: Box, axis: 'w' | 'd') => b[axis] / 2;
  if (dir === 'N' || dir === 'S') {
    const sign = dir === 'N' ? -1 : 1;
    const z = from.z + sign * (half(from, 'd') + len + half(size, 'd'));
    const x = from.x + lateral;
    const at = { ...size, x, z };
    const corridor = {
      x: (from.x + x) / 2, w: Math.abs(lateral) + RESERVE_W, d: len,
      z: from.z + sign * (half(from, 'd') + len / 2),
    };
    return { at, corridor };
  }
  const sign = dir === 'E' ? 1 : -1;
  const x = from.x + sign * (half(from, 'w') + len + half(size, 'w'));
  const z = from.z + lateral;
  const at = { ...size, x, z };
  const corridor = {
    z: (from.z + z) / 2, d: Math.abs(lateral) + RESERVE_W, w: len,
    x: from.x + sign * (half(from, 'w') + len / 2),
  };
  return { at, corridor };
}

/**
 * A corridor that actually MEETS BOTH ROOMS' WALLS.
 *
 * The obvious version runs between the two bounding boxes' facing edges, and it
 * is wrong in a way that seals the floor silently: a room's polygon does not
 * reach its bounding box everywhere. A notch, a chamfer or an L's missing
 * quadrant sets the real wall back by metres, so the corridor ends in blank
 * space, the wall behind it is never cut, and the room has no door. Measured:
 * the reach audit's flood never left the entrance room on 2 of 3 sampled
 * depths, and every room past it was reported "never entered".
 *
 * So march from each room's centre out along the connecting axis until the
 * polygon boundary is crossed, and run the corridor between THOSE points —
 * pushed a little INTO each room so the opening rect straddles the wall it is
 * meant to cut. If the centre line misses the polygon (an ell's centre line can
 * exit through the missing quadrant), try lateral offsets before giving up.
 */
interface Connection {
  rects: Box[];
  type: CorridorType;
  /** Set when the legs do not share a travel axis (an L). Handed straight to
   *  the elevation pass, which cannot derive it — see ElevLink.legAxis. */
  legAxis?: Array<{ alongX: boolean; fromIsLo: boolean }>;
}

/**
 * A CORRIDOR BUILT TO THE WALLS' OWN ANCHORS.
 *
 * `connect` below still owns the decision — which section, whether to kink —
 * but it no longer GUESSES where the rooms' walls are. The rooms said, before
 * any corridor existed (level/anchors.ts), and the route is picked between two
 * of those answers (level/corridor-route.ts).
 *
 * Measured over 656 doorways before this: 35% overlapped a corner, the 5th
 * percentile -1.52m — a doorway wrapping a metre and a half PAST the corner and
 * round onto the next wall. That is the chamfered opening `planPortals` grew
 * multi-edge cuts for, the frame that cannot sit flat, and the stone door
 * photographed inset into a winding passage: one cause, three tickets. A wall
 * knows where its own corners are; nothing else did.
 *
 * WHAT THIS STEP DELIBERATELY DOES NOT CHANGE: the rects still reach `OVERLAP`
 * INTO both rooms. That 0.9m is not geometry, it is the lookup key —
 * `findOpenings` and `planPortals` cut a hole where a rect crosses a wall line,
 * so removing the overshoot before the walls cut at their own anchors would
 * seal every door on the floor. Position first, then the cutting mechanism,
 * then the repair passes come out. Doing all three at once is how a migration
 * becomes a rewrite.
 */
function routeConnection(
  a: Placed, b: Placed, type: CorridorType, rooms: readonly Placed[],
  occupied: readonly Box[], preferBend: boolean,
): Connection | null {
  // The mouth this step asks for is the SECTION's own width, not the generous
  // one `mouthWidth` would give. A splayed mouth needs geometry that does not
  // exist yet (a wider rect stuck on the end reads as a box, not an embrasure)
  // — and asking for 3.5m here would make every wall that can only afford 2.5m
  // decline a link it can perfectly well serve.
  const sectionMouth = (anchor: { width: readonly [number, number] }): number | null => {
    const floor = Math.max(anchor.width[0], MIN_WALKABLE_WIDTH);
    if (anchor.width[1] < floor) return null;
    return Math.max(floor, Math.min(anchor.width[1], type.width));
  };

  const A = { poly: a.poly, anchors: deriveAnchors(a.id, a.poly, a.height) };
  const B = { poly: b.poly, anchors: deriveAnchors(b.id, b.poly, b.height) };
  const obstacles = rooms.filter((r) => r !== a && r !== b)
    .map((r) => ({ id: r.id, poly: r.poly }));

  const route = chooseLinkRoute(
    A, B, { section: type.width }, sectionMouth, obstacles, preferBend,
  );
  if (!route) return null;

  const rects: Box[] = [];
  const legAxis: Array<{ alongX: boolean; fromIsLo: boolean }> = [];
  const n = route.legs.length;
  for (let i = 0; i < n; i++) {
    const leg = route.legs[i];
    const alongX = Math.abs(leg.to[0] - leg.from[0]) > Math.abs(leg.to[1] - leg.from[1]);
    let t0 = alongX ? leg.from[0] : leg.from[1];
    let t1 = alongX ? leg.to[0] : leg.to[1];
    const lat = alongX ? leg.from[1] : leg.from[0];
    const dir = Math.sign(t1 - t0) || 1;
    // Into the rooms at the two ends — the lookup key, above.
    if (i === 0) t0 -= dir * OVERLAP;
    if (i === n - 1) t1 += dir * OVERLAP;
    // ── WHO COVERS THE CORNER ─────────────────────────────────────────────────
    //
    // Only the leg LEAVING a joint extends back through it. The leg arriving
    // stops dead on the corner's centre.
    //
    // Extending both was the obvious symmetric thing and it is wrong: the
    // arriving leg's far end then lands exactly ON the departing leg's outer
    // edge, and the orphaned-end check — which asks whether a rect's end sits
    // inside another rect of the same link — is deciding a boundary case
    // ("corridor cor-2-0 ends at (-7.4, 16.4) — in nothing"). Stopping at the
    // centre puts that end half a width INSIDE its neighbour, with no epsilon
    // to argue about, and the departing leg's own half-width covers the whole
    // corner square on its own.
    if (i > 0) t0 -= dir * type.width / 2;

    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    if (hi - lo < 0.1) return null;
    rects.push(alongX
      ? { x: (lo + hi) / 2, z: lat, w: hi - lo, d: type.width }
      : { z: (lo + hi) / 2, x: lat, d: hi - lo, w: type.width });
    legAxis.push({ alongX, fromIsLo: t0 <= t1 });
  }

  // Nothing already placed may be in the way. The two rooms being joined are
  // expected to overlap their own end rect, so they are excused.
  const clash = rects.some((rc) => occupied.some((o) =>
    o !== a.rect && o !== b.rect && overlaps(o, rc, 0)));
  if (clash) return null;

  return { rects, type, legAxis: n > 1 ? legAxis : undefined };
}

function connect(
  a: Placed, b: Placed, rand: () => number, occupied: readonly Box[],
  rooms: readonly Placed[] = [],
): Connection | null {
  // ── ALIGNED, OR NOT ───────────────────────────────────────────────────────
  //
  // This guard used to REFUSE any pair not sharing a centre line, first thing.
  // It belongs to the blind paths below — they lay one rect down a shared
  // lateral and can do nothing else — but sitting at the top it also refused
  // the ROUTER, which needs no such thing.
  //
  // Freeing placement without moving it took links from 337 to 127 across 60
  // floors and drove every one to the reroll ceiling: rooms slid off the line,
  // `connect` returned null on sight, and the router was never asked a single
  // question. It now guards only what needs guarding.
  const alongZ = Math.abs(a.rect.x - b.rect.x) < 0.01;
  const aligned = alongZ || Math.abs(a.rect.z - b.rect.z) < 0.01;
  const sign = alongZ ? Math.sign(b.rect.z - a.rect.z) : Math.sign(b.rect.x - a.rect.x);
  // The lateral is ABSOLUTE and SHARED. Measuring each room's exit from its own
  // `roomCenter` and then laying the corridor down at `rect.x` is two different
  // lines: a shape's centre of open floor is not its bounding box's centre, so
  // the corridor was built beside the wall it had measured and ended in stone.
  const base = alongZ ? a.rect.x : a.rect.z;

  // ── THE SECTION IS CHOSEN BEFORE THE GEOMETRY, FROM THE RUN IT MUST COVER ──
  //
  // A corridor is a WORD first now (level/corridor-types.ts) — squeeze, passage
  // or gallery — and the word carries the width, the ceiling and the lengths it
  // suits. Estimated at the base lateral, which is available before any rect
  // exists and does not depend on the width the answer is about to set.
  //
  // ONE TYPE FOR THE WHOLE LINK, including a dogleg's three legs: a passage that
  // changes width and ceiling halfway along does not read as architecture, it
  // reads as a bug.
  //
  // Off the centre line there is no shared lateral to measure along, so the run
  // falls back to the distance between the rooms' boxes. An estimate, and it
  // always was — its only job is to pick a word.
  const eA = aligned ? exitPoint(a, alongZ, sign, base) : null;
  const eB = aligned ? exitPoint(b, alongZ, -sign, base) : null;
  const run = eA && eB
    ? Math.abs(eA.at - eB.at)
    : Math.hypot(b.rect.x - a.rect.x, b.rect.z - a.rect.z);
  const type = corridorTypeFor(run, rand);
  const width = type.width;

  // A DOGLEG FIRST, SOMETIMES.
  //
  // A straight corridor between two rooms is a telescope: you stand in the
  // doorway of one and read the whole of the next before you commit to it. That
  // is the single thing that makes a procedural floor read as a diagram. Kink it
  // and the room you are walking into is a surprise again.
  //
  // Worth noting this only became possible earlier this session: the three rects
  // OVERLAP at their corners, and until `findOpenings` learned to open a wall
  // line running through another rect's interior, the joints would have been
  // sealed and the dogleg a dead end.
  // -- THE ROUTE, ON THE WALLS' OWN ANCHORS ----------------------------------
  //
  // Tried before the blind paths below, and the kink roll is handed to it as a
  // PREFERENCE rather than being a separate geometry path: a Z route between
  // two anchors is a dogleg that also lands its doors correctly, so there is no
  // reason to keep a second way of bending.
  const wantsKink = rand() < DOGLEG_CHANCE;
  const routed = routeConnection(a, b, type, rooms, occupied, wantsKink);
  if (routed) { linkTally.routed++; return routed; }
  linkTally.guessed++;

  // -- EVERYTHING BELOW IS THE PRE-ANCHOR PATH -------------------------------
  //
  // It can only lay rects down a shared lateral, so it is unreachable for a pair
  // without one. Those links live or die by the router — which is the point of
  // freeing placement, and why the reroll's guess-share bar matters more now.
  if (!aligned) return null;

  //
  // Kept as the fallback, not deleted, because the router declines rather than
  // improvises: a link whose walls cannot agree gets no route, and a floor that
  // loses a link is worse than a floor with one guessed corridor. Degrade,
  // never fail. It fires on 24% of links today; that number is the measure of
  // how far placement still has to come, and it should be checked before this
  // path is ever deleted.
  if (wantsKink) {
    const bent = dogleg(a, b, alongZ, sign, base, width, occupied);
    if (bent) return { rects: bent, type };
  }

  // Straight. Lateral offsets in order: dead centre first, then progressively
  // further out — a room whose centre line has no wall on this side still has
  // one somewhere along it.
  for (const off of [0, 1.5, -1.5, 3, -3, 4.5, -4.5]) {
    const lat = base + off;
    const exitA = exitPoint(a, alongZ, sign, lat);
    const exitB = exitPoint(b, alongZ, -sign, lat);
    if (!exitA || !exitB) continue;
    const t0 = Math.min(exitA.at, exitB.at) - OVERLAP;
    const t1 = Math.max(exitA.at, exitB.at) + OVERLAP;
    if (t1 <= t0) continue;
    return {
      rects: [alongZ
        ? { x: lat, z: (t0 + t1) / 2, w: width, d: t1 - t0 }
        : { z: lat, x: (t0 + t1) / 2, d: width, w: t1 - t0 }],
      type,
    };
  }
  return null;
}

/**
 * AN L. Two rooms that share NO axis, joined by a corridor that turns once.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `connect()` above begins by refusing any pair of rooms that do not share an
 * axis exactly. That was never a design choice — it was written for two rooms
 * the spine had just placed next to each other, and it does not look for
 * anything in the way. But `stepFrom` puts each new room ON the axis it
 * travelled to reach it, so that alignment holds between NEIGHBOURS and
 * essentially nowhere else.
 *
 * The consequence, measured over 72 floors before this function existed: of 383
 * candidate room pairs, 82 were a pocket and its own parent, 287 shared no
 * axis, 14 were aligned across an intervening room, and ZERO were connectable.
 * Every corridor this generator could build joined two rooms that were already
 * joined. That is why a DELVE floor has always been a tree, and why no amount
 * of picking cleverer pairs was ever going to produce a loop — the geometry had
 * no way to express one.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 *
 * Out of A along one axis to a corner, then along the other axis into B. Three
 * rects, the same count a dogleg produces, so every downstream reader that
 * already understands "leg, landing, leg" understands this too — the wall
 * cutter, the trim pass, the section stamp, the elevation ramp split.
 *
 * The corner is either (A's lateral, B's lateral) or (B's, A's); both are
 * tried. The landing is a square at the turn, sized to the wider of the two
 * legs so neither runs out of floor mid-corner.
 *
 * ── WHAT IT HAS TO TELL THE ELEVATION PASS ──────────────────────────────────
 *
 * That its legs travel on DIFFERENT axes. Everything else in this generator
 * runs both legs of a link along one direction, so the elevation pass derived a
 * single travel axis per link and measured every ramp along it. Handed an L
 * without being told, it would build one of the two ramps sideways — running up
 * the corridor's width instead of its length. So the leg axes are returned with
 * the rects rather than left to be guessed.
 */
/**
 * A PIECE PINNED TO NEITHER END MUST NOT LAND INSIDE A ROOM.
 *
 * The end legs of a bend are pinned to their room's wall, so the plate trim
 * knows where to clip them and the seam is level by construction. The CORNER is
 * pinned to nothing — it is placed where the two axes cross, and nothing stops
 * that crossing from being inside one of the rooms the link joins. When it is,
 * the trim cannot rescue it (it will not cut a corridor down to nothing, and
 * correctly so), and the result is a slab of corridor floor and ceiling
 * standing several metres inside a room that has its own.
 *
 * Measured across 96 floors: 4 of 1221 built plates reached more than 0.30m
 * into a room whose ceiling differed — 3 legs and 1 landing, every one of them
 * on a bend. Rare, but it is the visible end of the overshoot, and it is the
 * case `plateExtentFor` was never able to reach.
 *
 * Checked against the POLYGONS, not the rects. The rooms this link joins are
 * excused from the ordinary clash test precisely because a leg is supposed to
 * meet their wall — so the box test cannot see this, and a polygon room is not
 * its bounding box.
 */
function landsInsideRoom(rect: Box, rooms: readonly Placed[]): boolean {
  return rooms.some((r) => pointInPoly(r.poly, rect.x, rect.z));
}

/**
 * Does the plate this rect will actually BUILD lie inside a room's floor?
 *
 * `landsInsideRoom` above asks about the rect's CENTRE, which answers a
 * different question: a leg is meant to end inside the room it serves, so its
 * centre being outside says nothing about the metres of slab behind it.
 *
 * This measures the plate the trim will hand the builder — pulled back to the
 * wall's outer face — and walks its length looking for a continuous run inside
 * a room's polygon. That is the thing the player can see: corridor floor
 * standing in a room that has its own. Via `plateExtentFor`, so it is the
 * builder's own answer rather than a second opinion about it.
 */
function plateInsideRoom(rect: Box, rooms: readonly Placed[]): boolean {
  const polys = rooms.map((r) => r.poly);
  const p = plateExtentFor(rect, polys);
  const alongX = p.w >= p.d;
  const lat = alongX ? p.z : p.x;
  const lo = (alongX ? p.x : p.z) - (alongX ? p.w : p.d) / 2;
  const len = alongX ? p.w : p.d;
  for (const poly of polys) {
    let run = 0;
    for (let i = 0; i <= 120; i++) {
      const t = lo + (len * i) / 120;
      const inside = pointInPoly(poly, alongX ? t : lat, alongX ? lat : t);
      // A CONTINUOUS run, not a count: a plate legitimately clips a chamfered
      // corner for a few centimetres, and rejecting that would refuse most
      // chords for doing their job.
      run = inside ? run + len / 120 : 0;
      if (run > 0.05) return true;
    }
  }
  return false;
}

function connectL(
  a: Placed, b: Placed, width: number, occupied: readonly Box[],
): Pick<Connection, 'rects' | 'legAxis'> | null {
  const dx = b.rect.x - a.rect.x, dz = b.rect.z - a.rect.z;
  // Needs a real offset on BOTH axes, or this is a job for connect().
  if (Math.abs(dx) < width || Math.abs(dz) < width) return null;

  // Two corners to try: leave A along Z and enter B along X, or the reverse.
  for (const aFirstAlongZ of [true, false]) {
    const cornerX = aFirstAlongZ ? a.rect.x : b.rect.x;
    const cornerZ = aFirstAlongZ ? b.rect.z : a.rect.z;

    // Leg out of A, travelling on its own axis at the corner's lateral.
    const aAlongZ = aFirstAlongZ;
    const aSign = Math.sign(aAlongZ ? cornerZ - a.rect.z : cornerX - a.rect.x);
    const exitA = exitPoint(a, aAlongZ, aSign, aAlongZ ? cornerX : cornerZ);
    // Leg into B, on the other axis.
    const bAlongZ = !aFirstAlongZ;
    const bSign = Math.sign(bAlongZ ? cornerZ - b.rect.z : cornerX - b.rect.x);
    const exitB = exitPoint(b, bAlongZ, bSign, bAlongZ ? cornerX : cornerZ);
    if (!exitA || !exitB) continue;

    // The landing, square and centred on the turn.
    const corner: Box = { x: cornerX, z: cornerZ, w: width, d: width };

    // Each leg spans from its room's wall (pushed OVERLAP inside, so the
    // opening straddles the stone) to the landing's near face.
    //
    // BOTH LEGS RUN TO THE CORNER'S CENTRE, not to its near face. Stopping half
    // a width short leaves the landing square poking out past both of them, and
    // its two far ends then sit in open space — which is exactly what the
    // orphaned-end check catches ("corridor cor-loop-1 ends at (17.1, 50.7) —
    // in nothing"). Running through means every rect's ends land inside another
    // rect of the same link, the way a dogleg's do.
    const legFor = (alongZ: boolean, at: number, toward: number, lat: number): Box => {
      const stop = toward;
      const t0 = Math.min(at, stop) - (at < stop ? OVERLAP : 0);
      const t1 = Math.max(at, stop) + (at > stop ? OVERLAP : 0);
      return alongZ
        ? { x: lat, z: (t0 + t1) / 2, w: width, d: Math.max(0.1, t1 - t0) }
        : { z: lat, x: (t0 + t1) / 2, d: width, w: Math.max(0.1, t1 - t0) };
    };
    const legA = legFor(aAlongZ, exitA.at, aAlongZ ? cornerZ : cornerX, aAlongZ ? cornerX : cornerZ);
    const legB = legFor(bAlongZ, exitB.at, bAlongZ ? cornerZ : cornerX, bAlongZ ? cornerX : cornerZ);
    // A leg shorter than the landing it meets is not a leg — the corner has
    // already swallowed it, and the "corridor" is a single square room.
    if (Math.max(legA.w, legA.d) < width || Math.max(legB.w, legB.d) < width) continue;

    // The corner is pinned to neither room, so it may not stand in one.
    if (landsInsideRoom(corner, [a, b])) continue;

    const rects = [legA, corner, legB];
    // Nothing already placed may be in the way. The two rooms this joins are
    // expected to overlap their own leg's end, so they are excused.
    const clash = rects.some((rc) => occupied.some((o) =>
      o !== a.rect && o !== b.rect && overlaps(o, rc, 0)));
    if (clash) continue;

    return {
      rects,
      legAxis: [
        // `fromIsLo`: is the A end of this leg at the lower world coordinate?
        { alongX: !aAlongZ, fromIsLo: exitA.at <= (aAlongZ ? cornerZ : cornerX) },
        { alongX: !aAlongZ, fromIsLo: true },   // the landing carries no ramp
        // Leg B runs from the landing INTO B, so its `from` end is the corner.
        { alongX: !bAlongZ, fromIsLo: (bAlongZ ? cornerZ : cornerX) <= exitB.at },
      ],
    };
  }
  return null;
}

/**
 * Three rects: a leg out of A, a cross piece, a leg into B — offset so you
 * cannot see one room from the other.
 *
 * Returns null rather than forcing it. A dogleg sweeps sideways through space a
 * straight run never touches, so it can collide with a room the layout already
 * placed; when it does, the caller falls back to straight. Degrade, never fail.
 */
function dogleg(
  a: Placed, b: Placed, alongZ: boolean, sign: number,
  base: number, width: number, occupied: readonly Box[],
): Box[] | null {
  const mk = (lat: number, t0: number, t1: number, latSpan: number): Box => alongZ
    ? { x: lat, z: (t0 + t1) / 2, w: latSpan, d: Math.abs(t1 - t0) }
    : { z: lat, x: (t0 + t1) / 2, d: latSpan, w: Math.abs(t1 - t0) };

  for (const [o1, o2] of DOGLEG_OFFSETS) {
    const lat1 = base + o1, lat2 = base + o2;
    const exitA = exitPoint(a, alongZ, sign, lat1);
    const exitB = exitPoint(b, alongZ, -sign, lat2);
    if (!exitA || !exitB) continue;
    const tA = exitA.at, tB = exitB.at;
    // The bend must have room to be a bend rather than a jog: two leg stubs and
    // the cross piece between them.
    if (Math.abs(tB - tA) < width + 3.5) continue;
    const mid = (tA + tB) / 2;

    const legA = mk(lat1, tA - sign * OVERLAP, mid + sign * (width / 2), width);
    const legB = mk(lat2, mid - sign * (width / 2), tB + sign * OVERLAP, width);
    // The cross piece runs BETWEEN the two laterals and overlaps both legs by
    // half a width at each end, so the joints are interior rather than butted.
    const cross = alongZ
      ? { x: (lat1 + lat2) / 2, z: mid, w: Math.abs(lat2 - lat1) + width, d: width }
      : { z: (lat1 + lat2) / 2, x: mid, d: Math.abs(lat2 - lat1) + width, w: width };

    // The cross piece is pinned to neither room, so it may not stand in one.
    // Same rule as the L's corner — see landsInsideRoom.
    if (landsInsideRoom(cross, [a, b])) continue;

    const parts = [legA, cross, legB];
    // Nothing the layout already placed may be in the way. The two rooms this
    // connects are excluded — the legs are SUPPOSED to reach into them.
    const clash = parts.some((p) => occupied.some((o) =>
      o !== a.rect && o !== b.rect && overlaps(o, p, 0.4)));
    if (clash) continue;
    return parts;
  }
  return null;
}

/** Where the polygon boundary is, marching out along the connecting axis on the
 *  line at absolute lateral `lat`. Null if that line never leaves the polygon
 *  (it isn't a wall on this side) or is never inside it at all. */
function exitPoint(r: Placed, alongZ: boolean, sign: number, lat: number): { at: number } | null {
  const c = roomCenter(r.poly);
  const from = alongZ ? c.z : c.x;
  const inside = (t: number) => alongZ ? pointInPoly(r.poly, lat, t) : pointInPoly(r.poly, t, lat);
  if (!inside(from)) return null;
  const span = alongZ ? r.rect.d : r.rect.w;
  for (let d = 0.2; d <= span; d += 0.2) {
    const t = from + sign * d;
    if (!inside(t)) return { at: t };
  }
  return null;
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad;
}

/**
 * Every point where a corridor breaks this room's wall.
 *
 * The corridor's CENTRE is not a doorway — it is a point in the passage, often
 * metres outside the room. The doorway is whichever end of the corridor lies
 * inside this polygon, which is the point circulation has to be judged from.
 */
function doorwaysOf(
  r: Placed, links: ReadonlyArray<{ from: string; to: string; rects: Box[] }>,
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const l of links) {
    if (l.from !== r.id && l.to !== r.id) continue;
    // Only the ends that land INSIDE this room are doorways. On a dogleg most
    // ends are joints between two corridor rects, which are not doors.
    for (const c of l.rects) {
      const ends = c.w > c.d
        ? [{ x: c.x - c.w / 2, z: c.z }, { x: c.x + c.w / 2, z: c.z }]
        : [{ x: c.x, z: c.z - c.d / 2 }, { x: c.x, z: c.z + c.d / 2 }];
      for (const e of ends) if (pointInPoly(r.poly, e.x, e.z)) out.push(e);
    }
  }
  return out;
}

/** Where the player enters this room — used for sightline and ambush logic. The
 *  DOORWAY, not the corridor's midpoint: on a dogleg the midpoint is round a
 *  bend and metres outside the room. */
function mouthOf(
  r: Placed, links: ReadonlyArray<{ from: string; to: string; rects: Box[] }>,
): { x: number; z: number } | null {
  const doors = doorwaysOf(r, links);
  if (doors.length) return doors[0];
  const l = links.find((k) => k.to === r.id) ?? links.find((k) => k.from === r.id);
  return l ? { x: l.rects[0].x, z: l.rects[0].z } : null;
}

// ── furnishing, by query ─────────────────────────────────────────────────────

function furnish(
  r: Placed, mouth: { x: number; z: number } | null,
  doorways: Array<{ x: number; z: number }>,
  depth: number, rand: () => number,
  /** The DRESSING stream — skin palette rolls only. Kept apart from `rand` so a
   *  theme's variety can never move a spawn. */
  dressRand: () => number,
  props: PropSpec[], torches: TorchSpec[], spawns: EnemySpawnSpec[],
  mod?: RoomModifier,
  /** The stair, if this room holds it. The way on always gets marked. */
  descent?: { x: number; z: number },
  /**
   * Set ONLY on the room that holds the act's boss.
   *
   * A boss hall does not get a pack. The floor's ordinary roller would fill it
   * with whatever the depth rolls and you would fight the king in a crowd —
   * which is not the fight, and on a sealed arena it is not survivable either.
   */
  boss?: BossSpec,
): boolean {
  // ── THE WAY DOWN IS CLAIMED BEFORE ANYTHING ELSE IS PLACED ─────────
  //
  // Josh: *"some pillars generate over the descent. The descent stairs are
  // essential enough that it should happen early enough in the event passes,
  // with intent, not to be overlapped by pillars etc."*
  //
  // Exactly right, and the descent was already KNOWN here — it is passed in, and
  // was used only to light the way on. Nothing told the room's occupancy about
  // it, so the interior planner laid its colonnade straight through the stair.
  //
  // Measured across 240 floors: 36 pillars standing within a metre of a stair
  // and 104 more inside 2.2m. Only pillars — nothing else on a floor does this,
  // because everything else goes through the occupancy and the pillars are
  // planned from the polygon alone.
  //
  // So it is claimed FIRST, in the same occupancy every other placer already
  // respects. Not a special case in the pillar planner: a rule that lives in one
  // producer is a rule the next producer will break (see tests/one-ring.test.ts
  // for the four times that has cost us).
  if (descent) {
    r.occupancy.reserve(
      { kind: 'cylinder', x: descent.x, z: descent.z, r: DESCENT_CLEAR, y0: 0, y1: r.height },
      'descent');
  }

  // ── THE CENTREPIECE — the one thing the room is ABOUT ──────────────
  //
  // `planCentrepiece` is the shipping stager: it lays a trove's three plinths
  // along whichever axis has room, stands a merchant behind his counter facing
  // the door, drops a fire. It is already generator-agnostic — it asks for a
  // focal point, the room's extents, a `free()` predicate and which way the
  // player comes in — so nothing here is a port. What IS new is that it gets a
  // better `free()` than the tilemap composer could give it: the real polygon
  // and the room's 3D occupancy, rather than a grid of cells.
  //
  // `roomCenter` is the focal point: the point furthest from any wall. That is
  // both the honest middle of a shaped room and exactly what a presentation
  // wants — and on an L or a cross, the bbox centre it replaces is in the wall.
  const c = roomCenter(r.poly);
  const def = roomType(r.type);
  const site = {
    roomId: r.id, x: c.x, z: c.z, w: r.rect.w, d: r.rect.d,
    free: (x: number, z: number) =>
      pointInPoly(r.poly, x, z) && clearance(r.poly, x, z) > 0.55
      && r.occupancy.fits({ kind: 'cylinder', x, z, r: 0.45, y0: 0, y1: 1.6 }, 0.1),
    // Which way the player comes in, so the presentation composes from where
    // they will be standing rather than on a world axis.
    entranceDir: mouth
      ? (() => {
          const dx = mouth.x - c.x, dz = mouth.z - c.z, m = Math.hypot(dx, dz);
          return m > 1e-3 ? { x: dx / m, z: dz / m } : undefined;
        })()
      : undefined,
  };
  const staged = planCentrepiece(r.type, site, { depth, rand });
  // CONTESTED — the centrepiece is guarded. The seal is already installed (the
  // room got a portcullis above); marking the props is what says WHICH act
  // springs it. Reaching for the reward is the trigger, and that is the whole
  // difference from an ambush, which springs on the way in.
  let guarded = false;
  if (mod === 'contested') {
    for (const p of staged.props) {
      const q = p as { kind?: string; model?: { id?: string }; guarded?: boolean };
      // Offerings and chests were always guardable. The BONFIRE is the third,
      // and it is the one room-types.ts always claimed could be contested — "a
      // rest you fight for" — while the flag it needed did not exist on a model
      // prop. Now it does, so a contested sanctum finally springs.
      const guardable = q.kind === 'offering' || q.kind === 'chest'
        || (q.kind === 'model' && q.model?.id === 'bonfire');
      if (guardable) { q.guarded = true; guarded = true; }
    }
  }
  props.push(...staged.props);
  for (const p of staged.claimed) {
    r.occupancy.reserve({ kind: 'cylinder', x: p.x, z: p.z, r: 0.6, y0: 0, y1: 1.8 }, 'centrepiece');
  }

  // A CLEAN room is a STAGE. Nothing scattered, nothing underfoot — only what
  // the centrepiece deliberately placed. That is a stronger statement than "no
  // loot", and it is the one flag every decorative pass has to read: a trove
  // whose three offerings you cannot see past is not a choice.
  //
  // The stone this room stands, kept for the LIGHT pass. A big room needs
  // something burning in the middle of it, and a light on a pier is
  // architecture where the same light in open floor is a lamp nobody placed.
  const piers: Array<{ x: number; z: number }> = [];
  if (!def.clean) {

  // ── INTERIOR STONE — the room's own architecture ────────────────────
  //
  // Proposed and then VERIFIED: room-interior.ts floods the room's floor with
  // the stone in place and refuses any form that strands a doorway, the
  // centrepiece, or a third of the floor. It cannot return a plan it hasn't
  // checked, which is the only way to add obstacles to a procedural room
  // without eventually shipping a sealed one.
  const forms = TYPE_INTERIOR[r.type];
  if (forms && doorways.length > 0 && rand() < 0.55) {
    const plan = planInterior(r.poly, {
      doorways,
      mustReach: [...staged.claimed, ...doorways],
      avoid: [
        ...r.occupancy.footprints().map((f) => ({ x: f.x, z: f.z, r: f.r })),
        ...staged.claimed.map((c) => ({ x: c.x, z: c.z, r: 0.8 })),
      ],
      rand,
    }, forms);
    if (plan) {
      for (const pier of plan.pillars) {
        props.push({ kind: 'pillar', x: pier.x, z: pier.z, size: pier.size } as PropSpec);
        r.occupancy.reserve(
          { kind: 'cylinder', x: pier.x, z: pier.z, r: pier.size * 0.42, y0: 0, y1: r.height },
          'pillar');
        piers.push({ x: pier.x, z: pier.z });
      }
    }
  }

  // Minor clutter, in the wall band. Candidates come sorted by clearance and go
  // through the occupancy, so nothing lands inside a pier, a lamp, or the thing
  // the room is about — which is the failure the old pipeline repaired
  // afterwards instead of preventing.
  if (def.minorLoot) {
    const band = candidateSpots(r.poly, { radius: 0.35, band: [0.5, 1.4], pitch: 0.6 });
    const want = Math.round(polyArea(r.poly) / 22);
    let placed = 0;
    for (let i = 0; i < band.length && placed < want; i++) {
      const s = band[Math.floor(rand() * band.length)];
      const vol = { kind: 'cylinder' as const, x: s.x, z: s.z, r: 0.5, y0: 0, y1: 1.0 };
      if (!r.occupancy.fits(vol, 0.25)) continue;
      r.occupancy.reserve(vol, 'clutter');
      props.push({ kind: 'vase', x: s.x, z: s.z } as PropSpec);
      placed++;
    }
  }

  // MODIFIER: `hazard` — the floor itself is the danger. Spikes spread THROUGH
  // the room rather than ringed around a prize (that is the trap room's
  // centrepiece, a different beat). Spread far enough apart that crossing means
  // picking a line, not threading a minefield.
  if (mod === 'hazard') {
    const spots = candidateSpots(r.poly, { radius: 0.6, band: [1.6, Infinity], pitch: 0.8 });
    const laid: Array<{ x: number; z: number }> = [];
    for (const s of spreadPick(spots, 4, null)) {
      if (laid.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < HAZARD_SPREAD)) continue;
      const vol = { kind: 'cylinder' as const, x: s.x, z: s.z, r: 0.6, y0: 0, y1: 0.3 };
      if (!r.occupancy.fits(vol, 0.2)) continue;
      r.occupancy.reserve(vol, 'hazard');
      props.push({ kind: 'spike-trap', x: s.x, z: s.z } as PropSpec);
      laid.push(s);
    }
  }

  }   // ── end of "not a clean stage" ─────────────────────────────────

  // SPAWNS. Placed against the room's shape, not scattered in its rect:
  // AMBUSH wants to be out of the entrance's sightline, so you walk in before
  // you see them. Everything else wants the open floor, spread out.
  //
  // Whether anything wanders in at all is the TYPE's call, not this pass's. You
  // never fight beside a vendor; a trove is a breath; a quiet room's whole job
  // is to be nothing.
  //
  // The ambush positions are kept: the LIGHT pass needs them, because an ambush
  // in a lit corner is not an ambush. See the shadow list below.
  const ambushSpots: Array<{ x: number; z: number }> = [];
  if (def.enemies) {
  const ambush = mod === 'ambush' || (r.type === 'combat' && rand() < 0.45);
  const open = candidateSpots(r.poly, { radius: 0.9, band: [1.2, Infinity], pitch: 0.8 });
  const pool = ambush && mouth
    ? open.filter((s) => !hasSightline(r.poly, mouth, s))
    : open;
  const picks = pool.length ? pool : open;
  const count = Math.max(1, Math.round(polyArea(r.poly) / 40));
  // Intensity rides the room's ROLE: an ambush is a hard beat, a passage is a
  // speed bump. The pack roller keeps the group coherent so a room reads as a
  // designed fight rather than a grab-bag.
  const intensity = ambush || r.type === 'arena' ? 'heavy'
    : r.type === 'trap' || r.type === 'finish' ? 'light'
    : 'medium';
  // WHAT THE ROOM IS SHAPED TO FIGHT LIKE. Its span, not its area — an archer
  // needs a straight line, and a long room has one a square of the same floor
  // area does not. encounter-shape.ts owns the rule and the reason; the short
  // version is that a hall used to be the same encounter as a chamber with more
  // bodies in it, so its space was doing nothing.
  const archetype = archetypeForSpan(roomSpan(r.poly), rand);
  // THE HALL BELONGS TO ONE THING. A boss arena takes no pack: the act's boss
  // stands in it alone, at the room's own focal point, and everything the
  // ordinary roller would have put there is simply not rolled — so the enemy
  // budget for this floor is not spent twice either.
  const ids = boss ? [] : rollFloorEnemies(depth, count, intensity, rand, archetype);
  if (boss) {
    const c = roomCenter(r.poly);
    const vol = { kind: 'cylinder' as const, x: c.x, z: c.z, r: 1.6, y0: 0, y1: 2.6 };
    r.occupancy.reserve(vol, 'boss');
    spawns.push({ enemyId: boss.enemyId, x: c.x, z: c.z, roomId: r.id });
  }
  for (const enemyId of ids) {
    if (!picks.length) break;
    const s = picks[Math.floor(rand() * picks.length)];
    const vol = { kind: 'cylinder' as const, x: s.x, z: s.z, r: 0.8, y0: 0, y1: 1.8 };
    if (!r.occupancy.fits(vol, 0.2)) continue;
    r.occupancy.reserve(vol, 'spawn');
    spawns.push({ enemyId, x: s.x, z: s.z, roomId: r.id, dormant: ambush });
    if (ambush) ambushSpots.push({ x: s.x, z: s.z });
  }
  }   // ── end of "something wanders in here" ─────────────────────────

  lightRoom(r, mouth, descent, ambushSpots, mod, staged, piers, torches, props, dressRand);
  return guarded;
}

/**
 * LIGHT LAST.
 *
 * Everything above has already happened, so this is the first point at which
 * the question "what should the player SEE in this room" has an answer. The
 * rules live in light-plan.ts; this is only the translation from its fixtures
 * to the props and torches the builder consumes.
 */
function lightRoom(
  r: Placed,
  mouth: { x: number; z: number } | null,
  descent: { x: number; z: number } | undefined,
  ambushSpots: ReadonlyArray<{ x: number; z: number }>,
  mod: RoomModifier | undefined,
  staged: { props: PropSpec[]; claimed: Array<{ x: number; z: number }> },
  /** The interior stone this room stands, if any — see `interiorLightAnchors`. */
  piers: ReadonlyArray<{ x: number; z: number }>,
  torches: TorchSpec[],
  props: PropSpec[],
  /** The floor's seeded RNG. The skin rolls its palette on this, so a theme's
   *  variety is deterministic per seed like everything else. */
  rand: () => number,
): void {
  // The brackets this room COULD hang something on. `sconcesOn` answers exactly
  // that and nothing more — how many it gets, and which, is decided below.
  let mounts: Mount[] = sconcesOn(r.walls, [
    { pick: (s) => s.length >= 5, spacing: [3.0, 4.6], inBays: true, height: 2.0, intensity: 0.85 },
    { pick: (s) => s.length >= 2.2, spacing: [3, 5], height: 1.9, intensity: 0.6, minWall: 2.2 },
  ]).map((t) => ({ x: t.x, z: t.z, height: t.height, rotY: t.rotY, wall: t.wall }));

  // A `dark` room keeps only the brackets by the door. Not zero — a room with no
  // light at all is indistinguishable from the end of the world, and the player
  // will stand at the threshold wondering if the floor is broken. One guttering
  // sconce BEHIND you is what makes the dark ahead read as dark.
  if (mod === 'dark' && mouth) {
    const near = mounts.filter((m) => Math.hypot(m.x - mouth.x, m.z - mouth.z) < 4.0);
    mounts = near.length ? [near[0]] : mounts.slice(0, 1);
  }

  // What the room is ABOUT — the centrepiece's own footprint, not the room's
  // geometric middle. A merchant stands behind his counter; the light belongs on
  // the counter.
  const def = roomType(r.type);
  const focusAt = staged.claimed.length
    ? {
        x: staged.claimed.reduce((t, c) => t + c.x, 0) / staged.claimed.length,
        z: staged.claimed.reduce((t, c) => t + c.z, 0) / staged.claimed.length,
      }
    : null;

  const fixtures = planRoomLight({
    focus: focusAt && def.centrepiece !== 'none'
      ? { x: focusAt.x, z: focusAt.z, kind: def.centrepiece }
      : undefined,
    descent,
    // Rule 4: an ambush in a lit corner is not an ambush.
    shadow: ambushSpots.map((a) => ({ x: a.x, z: a.z, r: 3.2 })),
    mounts,
    area: polyArea(r.poly),
    height: r.height,
    // A `dark` room is a DECISION, and it outranks the size rule the way an
    // ambush does. A hall the player cannot see the end of is a bug; a hall the
    // player cannot see the end of BECAUSE the room is marked dark is the beat.
    // Caught by the suite: without this, 1 dark room in 20 floors lit itself.
    interiorAnchors: mod === 'dark' ? undefined : interiorLightAnchors(r, piers, ambushSpots),
    fallback: fallbackLightSpot(r, mouth, ambushSpots),
  });

  // THE LIGHT PLAN SAYS SHAPE; THE SKIN SAYS MODEL. Everything above decided
  // that a standing source belongs here at this brightness in this colour — a
  // statement about the ROOM. Which object that is, is a statement about the
  // THEME, and it lives in skins.ts (see skin.ts for the split). A null answer
  // means the palette has nothing that fits the space, and the honest response
  // is an empty spot rather than a pike jammed into a crawlspace.
  const skin = activeSkin();
  for (const f of fixtures) {
    if (f.shape === 'sconce') {
      const model = resolveSkin(skin, { intent: 'light.wall', tint: f.color }, rand);
      torches.push({
        x: f.x, z: f.z, height: f.height, wall: f.wall ?? 'N', rotY: f.rotY,
        intensityMul: f.intensity,
        ...(model ? { fixtureKind: wallFixtureKindOf(model.id) } : {}),
        ...(f.color ? { colorTint: f.color } : {}),
      } as TorchSpec);
      r.occupancy.reserve(
        { kind: 'cylinder', x: f.x, z: f.z, r: 0.2, y0: f.height - 0.4, y1: f.height + 0.4 }, 'sconce');
      continue;
    }
    if (f.shape === 'pool') {
      const model = resolveSkin(skin, { intent: 'light.pool', tint: f.color }, rand);
      if (model) props.push({ kind: 'model', model, x: f.x, y: 0, z: f.z } as PropSpec);
      continue;   // a glow is light, not volume — nothing to reserve
    }
    if (f.shape === 'shaft') {
      const model = resolveSkin(skin, { intent: 'light.shaft', tint: f.color, headroom: r.height }, rand);
      if (model) props.push({ kind: 'model', model, x: f.x, y: 0, z: f.z } as PropSpec);
      continue;
    }
    // A standing source, and it DOES take floor — so the request states how much
    // there is. `free` is generous here by construction: the fallback spot the
    // light plan picked was chosen for being clear.
    const model = resolveSkin(skin,
      { intent: 'light.floor', tint: f.color, footprint: 0.5, headroom: r.height }, rand);
    if (!model) continue;
    props.push({ kind: 'model', model, x: f.x, y: 0, z: f.z } as PropSpec);
    r.occupancy.reserve({ kind: 'cylinder', x: f.x, z: f.z, r: 0.45, y0: 0, y1: 1.3 }, 'brazier');
  }
}

/**
 * How far from every wall a spot must be before a light is allowed to stand
 * there — and, in practice, the test for whether this room is a HALL.
 *
 * It is stated as clearance rather than area on purpose: a room narrow in
 * either direction is served by its walls however long it runs, and a brazier
 * down the middle of a 4m-wide gallery is a thing to walk around, not a light.
 * Only a room wide in BOTH directions has a middle its walls cannot reach.
 *
 * Measured across 240 floors: it hands a standing light to 79% of rooms over
 * 140m² and to 5% of rooms under 60m², which is the whole rule in two numbers.
 */
const HALL_CLEARANCE_M = 3.4;

/**
 * Where a light could STAND inside this room, for the rooms too big to light
 * from their walls.
 *
 * Two candidate sets, and the preference between them is the whole point:
 *
 *   BESIDE THE STONE, if this room stood any. A cresset at the foot of a pier
 *   is architecture — somebody put it there, on purpose, against the column
 *   they built. It also reads at distance, because the pier itself catches the
 *   light and gives the flame a shape to sit against.
 *
 *   OPEN FLOOR, only when there is no stone to stand beside. A brazier alone in
 *   a hundred square metres is weaker, but a hall you cannot see the far end of
 *   is weaker still.
 *
 * Every spot is checked against the room's occupancy at the standing light's
 * real footprint, so nothing here can land inside a pier, an offering or a
 * spawn — the light plan gets places a brazier genuinely fits, not places it
 * would like one. Ambush pockets are excluded here as well as in the plan;
 * belt and braces on the one rule whose failure is invisible in a screenshot.
 */
function interiorLightAnchors(
  r: Placed,
  piers: ReadonlyArray<{ x: number; z: number }>,
  ambushSpots: ReadonlyArray<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  // Deep floor only. A room with nothing this far from a wall returns an empty
  // list and gets no interior light at all — which is most rooms, and is how
  // the dungeon stays dark while its halls stop lying about their size.
  const spots = candidateSpots(r.poly, { radius: 0.5, band: [HALL_CLEARANCE_M, Infinity], pitch: 0.9 })
    .filter((s) => !ambushSpots.some((a) => Math.hypot(a.x - s.x, a.z - s.z) < 3.4))
    .filter((s) => r.occupancy.fits({ kind: 'cylinder', x: s.x, z: s.z, r: 0.45, y0: 0, y1: 1.3 }, 0.2));
  if (!spots.length || !piers.length) return spots.map((s) => ({ x: s.x, z: s.z }));
  const beside = spots.filter((s) => piers.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 1.9));
  return (beside.length ? beside : spots).map((s) => ({ x: s.x, z: s.z }));
}

/**
 * A floor spot for a standing light, for the rooms no bracket will serve.
 *
 * Near the mouth, out of every ambush's shadow, on floor nothing else claimed.
 * The mouth is safe by construction — ambush positions are chosen OUT of the
 * mouth's sightline — so this can always be lit without betraying the ambush.
 */
function fallbackLightSpot(
  r: Placed, mouth: { x: number; z: number } | null,
  ambushSpots: ReadonlyArray<{ x: number; z: number }>,
): { x: number; z: number } | undefined {
  const seed = mouth ?? roomCenter(r.poly);
  const spots = candidateSpots(r.poly, { radius: 0.5, band: [0.8, Infinity], pitch: 0.7 });
  let best: { x: number; z: number } | undefined;
  let bestD = Infinity;
  for (const s of spots) {
    if (ambushSpots.some((a) => Math.hypot(a.x - s.x, a.z - s.z) < 3.4)) continue;
    if (!r.occupancy.fits({ kind: 'cylinder', x: s.x, z: s.z, r: 0.45, y0: 0, y1: 1.3 }, 0.2)) continue;
    const d = (s.x - seed.x) ** 2 + (s.z - seed.z) ** 2;
    if (d < bestD) { bestD = d; best = { x: s.x, z: s.z }; }
  }
  return best;
}

/**
 * Pick `n` of these, as far apart as possible.
 *
 * Farthest-point sampling: start nearest `seed` (the room's mouth, so the first
 * thing you see on entering is lit), then repeatedly take whichever candidate is
 * furthest from everything already taken. The alternative — take the first n, or
 * take n at random — clusters them on the longest wall, which is what makes
 * procedural lighting read as sprinkled rather than placed.
 */
function spreadPick<T extends { x: number; z: number }>(
  items: readonly T[], n: number, seed: { x: number; z: number } | null,
): T[] {
  if (items.length <= n) return [...items];
  const pool = [...items];
  const out: T[] = [];
  const first = seed
    ? pool.reduce((best, it) => (dist2(it, seed) < dist2(best, seed) ? it : best), pool[0])
    : pool[0];
  out.push(first);
  pool.splice(pool.indexOf(first), 1);
  while (out.length < n && pool.length) {
    let bestIdx = 0, bestD = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let nearest = Infinity;
      for (const o of out) nearest = Math.min(nearest, dist2(pool[i], o));
      if (nearest > bestD) { bestD = nearest; bestIdx = i; }
    }
    out.push(pool.splice(bestIdx, 1)[0]);
  }
  return out;
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * Every room on the path from the spawn to the stairs, inclusive.
 *
 * BFS from the spawn room and walk the parent chain back from the stair room —
 * shortest path, which on this generator's spine-and-spurs topology IS the route
 * the player takes. Rooms not in the returned set are genuine detours: reaching
 * them is a decision, so gating them costs the player nothing they did not
 * choose.
 *
 * Returns EVERY room when the endpoints are missing or unreachable, which is the
 * safe direction — "all mainline" means nothing gets gated, and a floor with no
 * cobwebs is a much smaller problem than a floor with a web across its only way
 * on.
 */
/**
 * The yaw that puts the way ONWARD in front of the player.
 *
 * Doorways come from `planPortals` — the same call the frames and the webs make
 * — so this looks at the hole in the wall, not at the corridor rect's end,
 * which lands metres inside the room and would aim the camera at the floor
 * beside the door.
 *
 * Three's cameras look down their local −Z, so a yaw of θ gazes at
 * (−sin θ, −cos θ); aiming it at a delta is `atan2(−dx, −dz)`. (Prop facings in
 * this codebase are `atan2(dx, dz)` — a model's front is its local +Z. Same
 * rotation, opposite axis, and mixing them up is a 180° error, which is exactly
 * the "faces a wrong direction" this fixes.)
 */
function spawnYawToward(
  at: { x: number; z: number },
  entrance: Placed,
  links: ReadonlyArray<{ from: string; to: string; ids: string[]; spur?: boolean }>,
  corridors: ReadonlyArray<{ id: string; rect: Box }>,
  mainline: ReadonlySet<string>,
): number {
  const portals = planPortals(entrance.id, entrance.poly, corridors);
  // A ROOM CAN HAVE NO PORTAL. Measured: 18 of 411 poly rooms, 4 of 72
  // entrances. `planPortals` refuses a span under 1.2m as a corridor grazing a
  // corner, but the wall ring cuts its opening from the rects directly — so
  // those rooms have a way out that the portal planner does not name. (That
  // disagreement is its own bug and its own ticket; here it just must not send
  // the player back to staring at a wall.) Aim at the corridor instead.
  if (!portals.length) {
    const near = corridors
      .filter((c) => pointInPoly(entrance.poly, c.rect.x, c.rect.z)
        || Math.hypot(c.rect.x - at.x, c.rect.z - at.z) < 40)
      .sort((a, b) => Math.hypot(a.rect.x - at.x, a.rect.z - at.z)
        - Math.hypot(b.rect.x - at.x, b.rect.z - at.z))[0];
    return near ? Math.atan2(-(near.rect.x - at.x), -(near.rect.z - at.z)) : 0;
  }
  const onward = portals.filter((p) => {
    const link = links.find((l) => l.ids.includes(p.corridorId));
    if (!link || link.spur) return false;
    const other = link.from === entrance.id ? link.to : link.from;
    return mainline.has(other);
  });
  // Fall back to ANY doorway rather than to zero: a room with one hole in it
  // still has an obvious way on, and "look at a wall" is the bug being fixed.
  const pick = (onward.length ? onward : portals)
    .sort((a, b) => Math.hypot(a.mid[0] - at.x, a.mid[1] - at.z)
      - Math.hypot(b.mid[0] - at.x, b.mid[1] - at.z))[0];
  return Math.atan2(-(pick.mid[0] - at.x), -(pick.mid[1] - at.z));
}


// ── seeded rng ───────────────────────────────────────────────────────────────

function hash(depth: number, seed: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ depth, 16777619);
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Exported for the audit script: how much of a room a placer could use. */
export function roomOpenness(poly: Poly): number {
  const b = polyBounds(poly);
  return polyArea(poly) / Math.max(1e-6, (b.maxX - b.minX) * (b.maxZ - b.minZ));
}

export { clearDepth };
