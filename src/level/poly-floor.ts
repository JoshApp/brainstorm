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
// What it does NOT do yet, deliberately: elevation, voids, arenas, shops,
// bosses, the floor-plan contract (trove/bargain slots). Those live in the vault
// composer and are the next things to move, one at a time, each with the
// measurement that says it worked. This is the spine — walk it first.
//
// The ORDER matters and is the actual design:
//
//   1. SHAPE the rooms      (archetype + size + ceiling, before anything else)
//   2. PLACE them            (spine + leaves, boxes that don't overlap)
//   3. CONNECT them          (corridors, which become doorways in the walls)
//   4. RESERVE what's built  (the piers the shell will raise)
//   5. FURNISH by query      (centrepiece → clutter → sconces → spawns)
//
// Content is placed against a room that already knows its own shape, and every
// placement reserves its volume, so the next one can see it. That's the whole
// difference from "place, then repair".

/** Rooms on the main spine, by depth. Small floors early, longer later. */
function spineLength(depth: number, rand: () => number): number {
  const base = depth <= 2 ? 3 : depth <= 6 ? 4 : 5;
  return base + (rand() < 0.4 ? 1 : 0);
}

/** Archetypes that suit each job. A room's SHAPE is the first thing that says
 *  what it's for — a tomb is not a hall and shouldn't be shaped like one. */
const ROLE_SHAPES: Record<string, readonly Archetype[]> = {
  entrance: ['chamber', 'apse', 'rotunda'],
  passage: ['hall', 'ell', 'notched', 'wedge'],
  chamber: ['chamber', 'cross', 'notched', 'cavern'],
  descent: ['apse', 'rotunda', 'cross'],
  pocket: ['tomb', 'cavern', 'chamber', 'wedge'],
};

type Role = keyof typeof ROLE_SHAPES;

interface Placed {
  id: string;
  role: Role;
  poly: Poly;
  rect: { x: number; z: number; w: number; d: number };
  height: number;
  walls: WallSurface[];
  occupancy: RoomOccupancy;
}

type Box = { x: number; z: number; w: number; d: number };
type Dir = 'N' | 'S' | 'E' | 'W';

const MARGIN = 1.5;          // gap between unrelated boxes, so walls never clip
const CORRIDOR_W = 2.2;

/**
 * Build a complete floor out of polygon rooms.
 *
 * Deterministic for (depth, seed) — every floor in this game must regenerate
 * identically on resume, so nothing here may touch Math.random.
 */
export function generatePolyFloor(depth: number, seed: number): LevelSpec {
  const rand = mulberry(hash(depth, seed));
  const n = spineLength(depth, rand);

  // ── 1 + 2. SHAPE, THEN PLACE ───────────────────────────────────────
  // Shape first: a room's polygon is decided from its ROLE and its budget, and
  // the layout then packs the bounding boxes that result. Doing it the other way
  // — pack boxes, then fit a shape into each — is how you end up with shapes
  // that are all the same because the boxes were.
  const rooms: Placed[] = [];
  const occupiedBoxes: Box[] = [];
  let cursor: Box = { x: 0, z: 0, w: 0, d: 0 };
  let heading: Dir = 'S';

  for (let i = 0; i < n; i++) {
    const role: Role = i === 0 ? 'entrance' : i === n - 1 ? 'descent' : (rand() < 0.45 ? 'passage' : 'chamber');
    const room = shapeRoom(`poly-${i}`, role, depth, rand);
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
  const pockets = depth <= 2 ? 1 : rand() < 0.6 ? 2 : 1;
  for (let p = 0; p < pockets; p++) {
    const parent = rooms[1 + Math.floor(rand() * Math.max(1, rooms.length - 2))];
    const pocket = shapeRoom(`poly-pocket-${p}`, 'pocket', depth, rand);
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

  for (const r of rooms) {
    const mouth = mouthOf(r, links);
    furnish(r, mouth, depth, rand, props, torches, spawns);
  }

  // The descent, on a wall chosen for being able to hold it.
  const last = rooms.find((x) => x.role === 'descent') ?? rooms[rooms.length - 1];
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
    rooms: rooms.map((r) => ({
      id: r.id, rect: r.rect, height: r.height, poly: r.poly,
    } as RoomSpec)),
    corridors,
    props,
    torches,
    spawns,
    doors: [],
    stairs,
  };
}

// ── shaping ──────────────────────────────────────────────────────────────────

function shapeRoom(id: string, role: Role, depth: number, rand: () => number): Placed {
  const pool = ROLE_SHAPES[role];
  const kind = pool[Math.floor(rand() * pool.length)];
  // Size band by role. A descent chamber earns more room than a passage; a
  // pocket is small on purpose, because a small room is a different EXPERIENCE
  // and not merely a cheaper one.
  const [wLo, wHi, dLo, dHi] = role === 'pocket' ? [7, 11, 6, 9]
    : role === 'passage' ? [9, 15, 7, 11]
    : role === 'descent' ? [12, 18, 10, 15]
    : [10, 16, 8, 13];
  const w = wLo + rand() * (wHi - wLo) + Math.min(3, depth * 0.15);
  const d = dLo + rand() * (dHi - dLo) + Math.min(3, depth * 0.15);
  const poly = generateRoomShape(kind, { w, d, rand });
  const b = polyBounds(poly);
  const ceil = ceilingFor(kind, w, d, rand());
  return {
    id, role, poly,
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
): void {
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
  const budget = Math.max(1, Math.min(5, Math.round(polyArea(r.poly) / 26)));
  for (const t of spreadPick(lampCandidates, budget, mouth)) {
    torches.push(t);
    r.occupancy.reserve(
      { kind: 'cylinder', x: t.x, z: t.z, r: 0.2, y0: t.height - 0.4, y1: t.height + 0.4 }, 'sconce');
  }

  // CENTREPIECE. `roomCenter` is the point furthest from any wall — which is
  // both the honest middle of a shaped room and exactly what a centrepiece
  // wants. The bbox centre it replaces can be in the wall on an L.
  const c = roomCenter(r.poly);
  const centre = { kind: 'cylinder' as const, x: c.x, z: c.z, r: 0.7, y0: 0, y1: 1.4 };
  if (r.role !== 'passage' && clearance(r.poly, c.x, c.z) > 2.0
      && r.occupancy.fits(centre, 0.2) && rand() < 0.7) {
    props.push({ kind: 'vase', x: c.x, z: c.z } as PropSpec);
    r.occupancy.reserve(centre, 'centrepiece');
  }

  // CLUTTER, in the wall band. Candidates come sorted by clearance and are
  // filtered through the occupancy, so nothing lands inside a pier or a lamp —
  // which is the failure the old pipeline repaired afterwards instead.
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

  // SPAWNS. Placed against the room's shape, not scattered in its rect:
  // AMBUSH wants to be out of the entrance's sightline, so you walk in before
  // you see them. Everything else wants the open floor, spread out.
  if (r.role === 'entrance') return;
  const ambush = r.role === 'chamber' && rand() < 0.45;
  const open = candidateSpots(r.poly, { radius: 0.9, band: [1.2, Infinity], pitch: 0.8 });
  const pool = ambush && mouth
    ? open.filter((s) => !hasSightline(r.poly, mouth, s))
    : open;
  const picks = pool.length ? pool : open;
  const count = Math.max(1, Math.round(polyArea(r.poly) / 40));
  // Intensity rides the room's ROLE: an ambush is a hard beat, a passage is a
  // speed bump. The pack roller keeps the group coherent so a room reads as a
  // designed fight rather than a grab-bag.
  const ids = rollFloorEnemies(depth, count, ambush ? 'heavy' : r.role === 'passage' ? 'light' : 'medium', rand);
  for (const enemyId of ids) {
    if (!picks.length) break;
    const s = picks[Math.floor(rand() * picks.length)];
    const vol = { kind: 'cylinder' as const, x: s.x, z: s.z, r: 0.8, y0: 0, y1: 1.8 };
    if (!r.occupancy.fits(vol, 0.2)) continue;
    r.occupancy.reserve(vol, 'spawn');
    spawns.push({ enemyId, x: s.x, z: s.z, roomId: r.id, dormant: ambush });
  }
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
