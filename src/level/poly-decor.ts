import type { PropSpec } from './types';
import { polyArea, pointInPoly, type Poly } from './room-shape';
import { candidateSpots, clearance } from './floor-region';
import { nearestSurface, type WallSurface } from './wall-surfaces';
import type { RoomOccupancy } from './room-occupancy';
import { roomType, type RoomTypeId } from './room-types';
import { propFacts, claimsConflict, type Claim } from './prop-taxonomy';

// ── THE SMALL FOUND THINGS ───────────────────────────────────────────────────
//
// Everything the generator places up to this point is a BEAT: the thing the
// room is about, the reward, the question, the fight. This is what goes between
// them, and a floor without it reads as a diagram of a dungeon rather than a
// place someone died in.
//
// It is the last thing the vault composer still did that the polygon generator
// did not. Polygon floors carried vases and nothing else — no bodies, no bone
// shrines, no webs across a passage, no scratched glyph you only find because
// the lamp swept it.
//
// ── WHAT MAKES THIS DIFFERENT FROM CLUTTER ───────────────────────────
//
// The rule that keeps dressing from eating the game: EVERY PIECE HERE IS EITHER
// A STORY OR A TARGET, and neither is ever a beat.
//
//   corpse       — a story. Someone got this far. RARE by design (7% a floor,
//                  matching loot-director.ts) because #70 established that a
//                  body you meet every floor is scenery, and a body you meet
//                  every few floors is a landmark that pays.
//   bone-shrine  — a story someone else arranged. One candle, one body, a
//                  patch of bone-glow.
//   cobweb       — a target that is also a small gate: it plugs a doorway and
//                  costs you one swing. The only thing here that touches
//                  circulation, which is why it goes ONLY into a dead end that
//                  is OFF the spawn→stairs path — gating a detour you chose,
//                  never the way on.
//   wall-rune    — a story you only find with the lamp. Free: it hangs on a
//                  wall and takes no floor at all.
//   vase-cluster — a target, and variety against the single vases.
//
// Everything asks the room's occupancy first, so nothing lands inside a pier,
// a lamp, a chest or the thing the room is about. A `clean` room takes NONE of
// it — that flag means the room is a stage.

/** What the pass needs to know about one room. Shape-compatible with the
 *  generator's own `Placed`, so the caller hands its rooms straight in. */
export interface DecorRoom {
  id: string;
  type: RoomTypeId;
  poly: Poly;
  walls: readonly WallSurface[];
  occupancy: RoomOccupancy;
  /** Where the player comes in — a web belongs in a mouth, a body does not. */
  mouth: { x: number; z: number } | null;
  /**
   * The room's actual DOORWAYS, straight off the portal planner.
   *
   * Not the same thing as `mouth`, and the difference shipped a bug. `mouth` is
   * the end of a corridor RECT that lands inside the polygon — and a corridor
   * rect deliberately ends inside the room, because that is the only way it can
   * reach a wall set back from its own bounding box. So the mouth is a point
   * floating in open floor, a measured median 1.63m from the doorway it names.
   *
   * A web hung there was hung at the wrong place, at the wrong ANGLE (the old
   * code passed the nearest wall's inward NORMAL where the curtain wants the
   * wall-line yaw the doorframe uses — 90° out on all 6 of 6 sampled webs), and
   * at a hard-coded 2.0m width in holes measuring 1.4m to 2.6m.
   *
   * These come from `planPortals`, the same call `portal-frames.ts` makes for
   * the stone frame. One source, so the web and the frame it hangs in cannot
   * disagree about where the doorway is.
   */
  doorways: ReadonlyArray<{ x: number; z: number; rotY: number; width: number }>;
  /** How many ways out. Exactly one means a dead end, which is the only place a
   *  web is allowed — see the fence on WEB_CHANCE below. */
  exits: number;
  /**
   * Is this room on the path from the spawn to the stairs?
   *
   * "Only a dead end" was the right instinct and the wrong test, TWICE. The
   * stair room is a dead end by topology — it is the last room on the spine —
   * and webbing its mouth put 52% and 39% of two sampled floors behind one
   * swing. That was patched with a `holdsDescent` exception, and the ENTRANCE
   * then walked into the identical hole from the other end: it also has exactly
   * one link, and that link is the way ONWARD. Measured at 35 webs across 240
   * floors, 24 of them nearer the corridor out than the spawn — a toll on the
   * mainline, on 15% of floors, in the first room the player ever sees.
   *
   * Two patches for one bug means the test was wrong, not incomplete. THE RULE
   * IS ABOUT THE MAINLINE, and always was: a web gates a detour you chose, never
   * the way through. So the caller computes the actual spawn→stairs path and the
   * fence asks that instead of counting doors.
   */
  onMainline: boolean;
  /**
   * What this room ALREADY says about itself, from everything placed in it
   * before dressing ran.
   *
   * The claim table (prop-taxonomy.ts) exists so a lit candle and a cobweb
   * cannot share a room, and clutter.ts enforces it on the vault path. This
   * pass had no idea claims existed, so it enforced nothing — and the moment
   * the light pass started standing cressets in big rooms, 3 rooms in 856 grew
   * a web around a burning pike. Small, and it is the exact failure the
   * vocabulary was built to prevent, which is the whole reason it counts.
   *
   * The caller computes this from the props already on the floor, through
   * `propFacts` — not a second copy of the table.
   */
  claims: readonly Claim[];
}

/**
 * May this room take a prop that asserts these claims?
 *
 * Refuses on contradiction rather than removing what is already there: the
 * dressing is the LAST pass and the least important thing in the room, so it
 * yields to the fire somebody lit and the body somebody left. (See the same
 * ordering rule in prop-taxonomy.ts: "never a reason to delete the merchant".)
 */
function mayAssert(r: DecorRoom, prop: PropSpec): boolean {
  const claims = propFacts(prop)?.claims ?? [];
  return !claims.some((c) => r.claims.some((have) => claimsConflict(c, have)));
}

/**
 * A fallen delver, per floor. Matches loot-director.ts exactly rather than
 * inventing a second number — two producers with two rates is how a rarity
 * decision quietly stops being one.
 */
const CORPSE_CHANCE = 0.07;
/** A bone shrine is the arranged version of the same beat, and just as rare. */
const SHRINE_CHANCE = 0.10;
/**
 * Per eligible doorway.
 *
 * High-looking, and it has to be: once the fence asks about the MAINLINE rather
 * than counting doors, an eligible doorway is a genuine off-path spur, and there
 * are only about a quarter of those per floor. At the old 0.16 that worked out
 * to a cobweb on 6% of floors — a thing in the game in the sense that the code
 * exists.
 *
 * So the roll is no longer the rate limiter, eligibility is, and this is tuned
 * against the OUTPUT instead. Measured over 240 floors: 32 webs, one every seven
 * or eight floors, so one or two in a full descent. That is the landmark rate —
 * about where the fallen delver sits — rather than the scenery rate it was on
 * its way to becoming when it was being placed in the entrance.
 */
const WEB_CHANCE = 0.55;
/** Per room with a wall long enough. The cheapest story in the game. */
const RUNE_CHANCE = 0.30;
/** A cluster instead of a single vase, per vase-sized slot. */
const CLUSTER_SHARE = 0.22;

/** A wall run has to be at least this long to carry a glyph without it
 *  wrapping a corner. */
const RUNE_MIN_WALL = 2.4;
/** Off the wall plane, so the quad doesn't z-fight the masonry. */
const RUNE_NUDGE = 0.06;

export interface DecorResult {
  props: PropSpec[];
  /** Counts by kind, for the audit. A dressing pass that silently places
   *  nothing looks exactly like a floor with nothing to dress. */
  placed: Record<string, number>;
}

/**
 * Dress a floor's rooms with the small found things.
 *
 * Deterministic given `rand`. Returns props; reserves what it places in each
 * room's occupancy so anything downstream sees it.
 */
export function decorPolyFloor(
  rooms: readonly DecorRoom[], depth: number, rand: () => number,
): DecorResult {
  const props: PropSpec[] = [];
  const placed: Record<string, number> = {};
  const note = (k: string) => { placed[k] = (placed[k] ?? 0) + 1; };

  // The FLOOR's one body, not one per room. Rarity is a floor-level decision;
  // rolling it per room multiplies it by the room count and turns "every few
  // floors" into "most floors" without anybody choosing that.
  const bodyRooms = rooms.filter((r) => !roomType(r.type).clean && roomType(r.type).minorLoot);
  if (bodyRooms.length > 0 && rand() < CORPSE_CHANCE) {
    const r = bodyRooms[Math.floor(rand() * bodyRooms.length)];
    const spot = openSpot(r, rand, 0.6);
    if (spot) {
      // Against a wall reads as "crawled here and stopped"; open floor reads as
      // "dropped where they stood". The pose hint is the difference, and the
      // room already knows which is true.
      const wall = nearestSurface(r.walls, spot.x, spot.z);
      const nearWall = wall ? clearance(r.poly, spot.x, spot.z) < 1.4 : false;
      props.push({
        kind: 'corpse', x: spot.x, z: spot.z,
        facing: { kind: 'wall-away' },
        pose: nearWall ? 'slumped' : 'curled',
      } as PropSpec);
      r.occupancy.reserve({ kind: 'cylinder', x: spot.x, z: spot.z, r: 0.6, y0: 0, y1: 0.6 }, 'corpse');
      note('corpse');
    }
  }

  // A bone shrine — the same beat, arranged by somebody. Also once a floor.
  if (bodyRooms.length > 0 && rand() < SHRINE_CHANCE) {
    const r = bodyRooms[Math.floor(rand() * bodyRooms.length)];
    const spot = openSpot(r, rand, 1.1);
    if (spot) {
      props.push({ kind: 'group', groupId: 'bone-shrine', x: spot.x, z: spot.z, rotY: rand() * Math.PI * 2 } as PropSpec);
      r.occupancy.reserve({ kind: 'cylinder', x: spot.x, z: spot.z, r: 1.1, y0: 0, y1: 1.0 }, 'shrine');
      note('bone-shrine');
    }
  }

  for (const r of rooms) {
    const def = roomType(r.type);
    if (def.clean) continue;

    // A GLYPH ON THE WALL. Free — it takes no floor, so it never competes with
    // anything, which is why it is the one piece here that is common.
    const runeWall = [...r.walls]
      .filter((s) => s.length >= RUNE_MIN_WALL && !s.jambA && !s.jambB)
      .sort((a, b) => b.length - a.length)[0];
    if (runeWall && rand() < RUNE_CHANCE) {
      // Off-centre, because mid-wall is where a doorway usually is and where
      // the eye already goes.
      const t = 0.3 + rand() * 0.4;
      // NUDGED off the wall plane. Placed exactly ON the outline the quad
      // z-fights the masonry, and every "is this inside the room" check in the
      // codebase reads a boundary point as outside — which is correct of them
      // and wrong for a thing whose home IS the wall. Same 6cm the vault path's
      // rune scatter uses.
      // ...and CHECKED, not assumed. 6cm is enough on almost every wall and was
      // not on one in 133: a wall whose inward normal runs along a chamfer
      // leaves a boundary point still reading as outside. Rather than growing
      // the constant until the sample stops complaining — guessing with extra
      // steps — push until the polygon agrees, and decline if it never does.
      const bx = runeWall.a[0] + (runeWall.b[0] - runeWall.a[0]) * t;
      const bz = runeWall.a[1] + (runeWall.b[1] - runeWall.a[1]) * t;
      let x = 0, z = 0, seated = false;
      for (const nudge of [RUNE_NUDGE, RUNE_NUDGE * 2, RUNE_NUDGE * 4]) {
        x = bx + runeWall.inward[0] * nudge;
        z = bz + runeWall.inward[1] * nudge;
        if (pointInPoly(r.poly, x, z)) { seated = true; break; }
      }
      if (seated) {
        props.push({ kind: 'wall-rune', x, z, rotY: runeWall.facingY, height: 1.3 + rand() * 0.4 } as PropSpec);
        note('wall-rune');
      }
    }

    // A WEB ACROSS A MOUTH, AND ONLY INTO A DEAD END.
    //
    // This is the one piece that touches circulation, so it gets the hardest
    // fence in the file. The first version put webs on THROUGH rooms — rooms
    // with two or more ways out — reasoning that the room could still be left.
    // That was the wrong question. Measured on the strict flood, a single web on
    // a mid-spine mouth put 85% of the floor behind it: the room had another
    // exit, the FLOOR did not, and a "small found thing" had become a mainline
    // toll.
    //
    // A dead end is where it belongs and where it reads best anyway — a side
    // passage nobody has walked in years. It gates a detour you chose, costs one
    // swing, and can never stand between the player and the stairs.
    if (r.doorways.length && r.exits === 1 && !r.onMainline && def.minorLoot && rand() < WEB_CHANCE) {
      // The doorway nearest the mouth, so a room with two holes still webs the
      // one the player arrives through. Position, yaw and width all come off
      // the portal — see the note on DecorRoom.doorways for what happened when
      // they were each guessed separately.
      const door = r.mouth
        ? [...r.doorways].sort((a, b) =>
            Math.hypot(a.x - r.mouth!.x, a.z - r.mouth!.z)
            - Math.hypot(b.x - r.mouth!.x, b.z - r.mouth!.z))[0]
        : r.doorways[0];
      const web = {
        kind: 'cobweb', x: door.x, z: door.z, rotY: door.rotY, widthM: door.width,
      } as PropSpec;
      // NOBODY HAS BEEN HERE FOR YEARS is a claim, and a room with a burning
      // cresset standing in it has already made the opposite one. The roll is
      // spent either way, so a refused web does not reshuffle the rest of the
      // floor's dressing.
      if (mayAssert(r, web)) { props.push(web); note('cobweb'); }
      else note('cobweb-refused');
    }
  }

  return { props, placed };
}

/**
 * Upgrade some single vases to clusters, in place.
 *
 * Runs over what the generator already placed rather than placing more: the
 * count was budgeted against the room's area and re-rolling it here would be a
 * second producer arguing with the first. This only changes WHAT is standing in
 * a slot the floor already decided to fill.
 */
export function clusterSomeVases(props: PropSpec[], rand: () => number): number {
  let n = 0;
  for (const p of props) {
    const q = p as { kind: string };
    if (q.kind !== 'vase') continue;
    if (rand() >= CLUSTER_SHARE) continue;
    q.kind = 'vase-cluster';
    n++;
  }
  return n;
}

/** An open spot in this room that nothing has claimed, preferring the middle
 *  band — a body pressed into a corner is hard to see and easy to walk past. */
function openSpot(
  r: DecorRoom, rand: () => number, radius: number,
): { x: number; z: number } | null {
  const spots = candidateSpots(r.poly, { radius, band: [0.9, Infinity], pitch: 0.7 })
    .filter((s) => pointInPoly(r.poly, s.x, s.z)
      && r.occupancy.fits({ kind: 'cylinder', x: s.x, z: s.z, r: radius, y0: 0, y1: 1.0 }, 0.25));
  if (spots.length === 0) return null;
  return spots[Math.floor(rand() * spots.length)];
}

/** Exported for the audit: how much floor a room is carrying, so "dressing"
 *  can be shown to have stayed dressing. */
export function decorDensity(poly: Poly, count: number): number {
  return count === 0 ? Infinity : polyArea(poly) / count;
}
