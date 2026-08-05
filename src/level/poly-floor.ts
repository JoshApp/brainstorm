import type { LevelSpec, RoomSpec, PropSpec, TorchSpec, EnemySpawnSpec } from './types';
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
import { nextLevelAfter } from './acts';
import { planFloor, dedicatedEntries } from './floor-plan';
import { planCentrepiece } from './centrepieces';
import { roomType, type RoomTypeId, type RoomModifier } from './room-types';
import { assignModifiers, type ModifierPlan } from './room-modifiers';
import { ROLE_CAPS, type FloorRoles, type RoomNode } from './floor-roles';

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

/** Rooms on the main spine, by depth. Small floors early, longer later. */
function spineLength(depth: number, rand: () => number): number {
  const base = depth <= 2 ? 3 : depth <= 6 ? 4 : 5;
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

const MARGIN = 1.5;          // gap between unrelated boxes, so walls never clip
/** Metres between two spikes of a `hazard` room. Closer and it stops being a
 *  line you pick and becomes a maze you thread. */
const HAZARD_SPREAD = 3.2;
const CORRIDOR_W = 2.2;

/**
 * Build a complete floor out of polygon rooms.
 *
 * Deterministic for (depth, seed) — every floor in this game must regenerate
 * identically on resume, so nothing here may touch Math.random.
 */
export function generatePolyFloor(depth: number, seed: number): LevelSpec {
  const rand = mulberry(hash(depth, seed));

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
    cursor = room.rect;
    heading = step.dir;
  }

  // Dead-end pockets, off a middle room. Bonus exploration, and the shapes that
  // read best small (tomb, cavern) only ever appear here.
  const corridors: RoomSpec[] = [];
  const links: Array<{ from: string; to: string; rect: Box }> = [];
  for (let i = 1; i < rooms.length; i++) {
    const c = connect(rooms[i - 1], rooms[i]);
    if (c) { corridors.push({ id: `cor-${i}`, rect: c, height: 3.0 });
             links.push({ from: rooms[i - 1].id, to: rooms[i].id, rect: c }); }
  }
  // DEAD-END SPURS ARE OWED, NOT ROLLED. One per dedicated plan entry, plus a
  // spare when the floor asked for none — a floor with no detour at all is a
  // corridor with rooms on it.
  const spurTypes: RoomTypeId[] = dedicated.map((e) => e.id);
  if (spurTypes.length === 0) spurTypes.push(rand() < 0.5 ? 'quiet' : 'combat');
  for (let p = 0; p < spurTypes.length; p++) {
    const parent = rooms[1 + Math.floor(rand() * Math.max(1, rooms.length - 2))];
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
      const cp = connect(parent, pocket) ?? g.corridor;
      corridors.push({ id: `cor-p${p}`, rect: cp, height: 3.0 });
      links.push({ from: parent.id, to: pocket.id, rect: cp });
      break;
    }
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
  const guardedRooms = new Set<string>();
  for (const r of rooms) {
    if (furnish(r, mouthOf(r, links), depth, rand, props, torches, spawns,
                mods.byRoom.get(r.id)?.kind)) guardedRooms.add(r.id);
  }

  // The descent, on a wall chosen for being able to hold it.
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

  return {
    id: `poly-${depth}`,
    seed,
    depth,
    displayName: undefined,
    composerManagedFires: true,
    startPos,
    rooms: rooms.map((r) => {
      const m = mods.byRoom.get(r.id);
      return {
        id: r.id, rect: r.rect, height: r.height, poly: r.poly, roomType: r.type,
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
  };
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
    const g = geometryFor(from, size, dir, len);
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

function geometryFor(from: Box, size: Box, dir: Dir, len: number): { at: Box; corridor: Box } {
  const half = (b: Box, axis: 'w' | 'd') => b[axis] / 2;
  if (dir === 'N' || dir === 'S') {
    const sign = dir === 'N' ? -1 : 1;
    const z = from.z + sign * (half(from, 'd') + len + half(size, 'd'));
    const at = { ...size, x: from.x, z };
    const corridor = {
      x: from.x, w: CORRIDOR_W, d: len,
      z: from.z + sign * (half(from, 'd') + len / 2),
    };
    return { at, corridor };
  }
  const sign = dir === 'E' ? 1 : -1;
  const x = from.x + sign * (half(from, 'w') + len + half(size, 'w'));
  const at = { ...size, x, z: from.z };
  const corridor = {
    z: from.z, d: CORRIDOR_W, w: len,
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
function connect(a: Placed, b: Placed): Box | null {
  const alongZ = Math.abs(a.rect.x - b.rect.x) < 0.01;
  if (!alongZ && Math.abs(a.rect.z - b.rect.z) >= 0.01) return null;
  const sign = alongZ ? Math.sign(b.rect.z - a.rect.z) : Math.sign(b.rect.x - a.rect.x);
  // Lateral offsets to try, in order: dead centre first, then progressively
  // further out. A room whose centre line has no wall on this side still has
  // one somewhere along it.
  // The lateral is ABSOLUTE and SHARED. Measuring each room's exit from its own
  // `roomCenter` and then laying the corridor down at `rect.x` is two different
  // lines: a shape's centre of open floor is not its bounding box's centre, so
  // the corridor was built beside the wall it had measured and ended in stone.
  const base = alongZ ? a.rect.x : a.rect.z;
  for (const off of [0, 1.5, -1.5, 3, -3, 4.5, -4.5]) {
    const lat = base + off;
    const exitA = exitPoint(a, alongZ, sign, lat);
    const exitB = exitPoint(b, alongZ, -sign, lat);
    if (!exitA || !exitB) continue;
    const OVERLAP = 0.9;                     // push into each room past its wall
    const t0 = Math.min(exitA.at, exitB.at) - OVERLAP;
    const t1 = Math.max(exitA.at, exitB.at) + OVERLAP;
    if (t1 <= t0) continue;
    return alongZ
      ? { x: lat, z: (t0 + t1) / 2, w: CORRIDOR_W, d: t1 - t0 }
      : { z: lat, x: (t0 + t1) / 2, d: CORRIDOR_W, w: t1 - t0 };
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

/** Where the player enters this room — used for sightline and ambush logic. */
function mouthOf(r: Placed, links: ReadonlyArray<{ from: string; to: string; rect: Box }>): { x: number; z: number } | null {
  const l = links.find((k) => k.to === r.id) ?? links.find((k) => k.from === r.id);
  return l ? { x: l.rect.x, z: l.rect.z } : null;
}

// ── furnishing, by query ─────────────────────────────────────────────────────

function furnish(
  r: Placed, mouth: { x: number; z: number } | null, depth: number, rand: () => number,
  props: PropSpec[], torches: TorchSpec[], spawns: EnemySpawnSpec[],
  mod?: RoomModifier,
): boolean {
  // SCONCES — CANDIDATES, THEN A BUDGET.
  //
  // Taking every mount a wall offers gave 52 sconces per floor, about 8 a room:
  // one light per 11m² against the builder's own fill budget of one per 45m².
  // That isn't a tuning miss, it's a category error — `mountPoints` answers
  // "where COULD one go", and something has to answer "how many does this room
  // get". Darkness is the baseline in this game (CLAUDE.md), so the answer is
  // "few, and spread".
  //
  // Chosen by farthest-point sampling from the candidate set, seeded at the
  // room's mouth: you should see flame where you walk in, and the rest should
  // pull your eye across the room rather than pile onto whichever wall happened
  // to be longest.
  const lampCandidates = sconcesOn(r.walls, [
    { pick: (s) => s.length >= 5, spacing: [3.0, 4.6], inBays: true, height: 2.0, intensity: 0.85 },
    { pick: (s) => s.length >= 2.2, spacing: [3, 5], height: 1.9, intensity: 0.6, minWall: 2.2 },
  ]);
  // ONE is a legitimate answer. A floor of two lit a 21m² pocket at one lamp
  // per 11m² — the same over-lighting as taking every mount, just applied to
  // the rooms too small for the ratio to hide it. A closet with a single
  // guttering sconce is the room this game is made of.
  //
  // A `dark` room keeps ONE, at the mouth. Zero would be a bug you cannot see —
  // the player would walk into a black rectangle with no way to tell it from
  // the end of the world. One sconce behind you is what makes the dark ahead
  // read as dark rather than as broken.
  const budget = mod === 'dark' ? 1 : Math.max(1, Math.min(5, Math.round(polyArea(r.poly) / 26)));
  for (const t of spreadPick(lampCandidates, budget, mouth)) {
    torches.push(t);
    r.occupancy.reserve(
      { kind: 'cylinder', x: t.x, z: t.z, r: 0.2, y0: t.height - 0.4, y1: t.height + 0.4 }, 'sconce');
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
      const k = (p as { kind?: string }).kind;
      if (k === 'offering' || k === 'chest') { (p as { guarded?: boolean }).guarded = true; guarded = true; }
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
  if (def.clean) return guarded;

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

  // SPAWNS. Placed against the room's shape, not scattered in its rect:
  // AMBUSH wants to be out of the entrance's sightline, so you walk in before
  // you see them. Everything else wants the open floor, spread out.
  //
  // Whether anything wanders in at all is the TYPE's call, not this pass's. You
  // never fight beside a vendor; a trove is a breath; a quiet room's whole job
  // is to be nothing.
  if (!def.enemies) return guarded;
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
  const ids = rollFloorEnemies(depth, count, intensity, rand);
  for (const enemyId of ids) {
    if (!picks.length) break;
    const s = picks[Math.floor(rand() * picks.length)];
    const vol = { kind: 'cylinder' as const, x: s.x, z: s.z, r: 0.8, y0: 0, y1: 1.8 };
    if (!r.occupancy.fits(vol, 0.2)) continue;
    r.occupancy.reserve(vol, 'spawn');
    spawns.push({ enemyId, x: s.x, z: s.z, roomId: r.id, dormant: ambush });
  }
  return guarded;
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
