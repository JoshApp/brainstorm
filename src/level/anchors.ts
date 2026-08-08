import type { Poly } from './room-shape';
import { PILASTER } from './poly-dressing';
import { MIN_WALKABLE_WIDTH } from './corridor-types';
import { gateAdmits } from './nav-grid';
import { ENEMIES } from '../content/enemies';

/** The slice of an enemy spec this file reasons about: how wide its body is,
 *  and whether it is the sort of thing that chases you through a door. */
type EnemyLike = { id: string; collisionRadius?: number; isBoss?: boolean; miniboss?: boolean };

// ── A ROOM SAYS WHERE ITS DOORS CAN BE ───────────────────────────────────────
//
// Josh: *"a room can declare possible anchors... portal carving becomes a
// problem of the room itself, and that way we can also do way better opening
// entrance geometry."*
//
// The full model is docs/SPACES-AND-THRESHOLDS.md. This file is step 1 of it:
// a room publishes the openings its own walls can afford, BEFORE any corridor
// exists to come looking for one.
//
// ── WHY, MEASURED ────────────────────────────────────────────────────────────
//
// Today a doorway is wherever a corridor rect happened to cross a wall line,
// and the corridor has no idea what it is crossing. Over 656 doorways on 48
// floors:
//
//   35% OVERLAP A CORNER — the fifth percentile is −1.52m, a doorway wrapping a
//   metre and a half PAST the corner and around onto the next wall.
//   39% have their edge within 0.3m of one.
//
// A door straddling a corner has no flat wall to be a door in. That is the
// chamfered-corner opening that `planPortals` had to grow multi-edge `cuts`
// for; it is the frame that cannot sit flat; it is the stone door photographed
// inset into a winding passage. All one cause.
//
// A wall knows where its own corners are. Nothing else does.
//
// ── WHAT AN ANCHOR PROMISES ──────────────────────────────────────────────────
//
// A RANGE, not a number. A fixed width makes every mismatch a conflict somebody
// loses; a range makes most of them agree, because the two bands overlap and
// any width inside the overlap suits both sides. The layout intersects the two
// anchors it is joining and takes the width its corridor section wants, clamped
// into the overlap.
//
// The range is DERIVED, never typed in: the flat run left on the edge after its
// corners are respected sets the max, and MIN_WALKABLE_WIDTH sets the min. An
// edge with no room for the min publishes nothing — which is how a wall says
// "not through here" without anybody writing a special case for it.

export interface PortalAnchor {
  id: string;
  /** The space this anchor belongs to. */
  space: string;
  /** Index of the polygon edge it sits on. */
  edge: number;
  /** Midpoint of the usable run, in world metres. */
  at: readonly [number, number];
  /** Unit normal, pointing OUT of the polygon. */
  normal: readonly [number, number];
  /** The usable run as distances along the edge from its start vertex. A door
   *  may sit anywhere inside this; the layout decides where. */
  t0: number;
  t1: number;
  /** [min, max] clear width this wall can afford. */
  width: readonly [number, number];
  /** [min, max] clear height. Capped by the space's own height — an opening
   *  cannot be taller than the wall it is cut into. */
  height: readonly [number, number];
}

// ── HOW NARROW AN OPENING IS ALLOWED TO GET ──────────────────────────────────
//
// Josh: *"I love the occasional massive portal as well as a sneaky way."*
//
// The massive portal is a supply question and the supply is already there —
// measured over 323 polygon rooms, the widest run a room can offer runs p50
// 6.6m and p90 11.1m, so 77% of rooms could host a 4m opening and 54% a 6m one.
// The shapes were never the constraint; nothing was asking them.
//
// THE SNEAKY WAY IS NOT A SUPPLY QUESTION, AND IT IS NOT A SMALL DOOR — IT IS A
// DOOR THE BIG THINGS CANNOT USE. The player's collision radius is 0.3; the
// widest ROAMING enemy the roster ships is the stoneguard at 0.55. That gap is
// the whole mechanic: an opening sized into it passes you and refuses what is
// chasing you, so a crawl is an escape route, a shortcut with a cost (you
// cannot fight in it), and a place where only the small things follow.
//
// All three numbers below are solved through `gateAdmits` — the same predicate
// the nav grid uses at runtime to decide whether a body fits through a gap — so
// the claim "the stoneguard cannot follow you in here" is computed against the
// shipping rule rather than asserted against a rule of thumb.

const PLAYER_RADIUS = 0.3;   // controls/camera.ts

/** How much wider than the player a crawl must read before it stops feeling
 *  like a wall. A taste knob, and the only one in this block — it is applied as
 *  a fatter BODY rather than as a fudge on the answer, so the width still comes
 *  out of the nav predicate. */
const CRAWL_COMFORT = 0.08;

/** Narrowest opening that admits a body of `radius`, per the nav grid. */
function narrowestAdmitting(radius: number): number {
  for (let w = 0.4; w < 4; w += 0.05) if (gateAdmits(w / 2, radius)) return round2(w);
  return 4;
}
/** Widest opening that still REFUSES a body of `radius`. */
function widestRefusing(radius: number): number {
  let best = 0;
  for (let w = 0.4; w < 4; w += 0.05) if (!gateAdmits(w / 2, radius)) best = round2(w);
  return best;
}
const round2 = (w: number) => Math.round(w * 100) / 100;

/**
 * The widest body that ACTUALLY WALKS THE FLOOR — read off the roster, not
 * typed in.
 *
 * Deliberately not `WIDEST_ROAMER_RADIUS` from corridor-types, which is padded
 * above the roster on purpose: that constant answers "how wide must a corridor
 * be so everything fits", where being generous is the safe error. This one
 * answers the opposite question — "how narrow must a hole be so something is
 * kept out" — where being generous is the WRONG error, and padding it produced
 * a crawl band that excluded nothing at all.
 *
 * Bosses and minibosses are excluded: they do not roam the floor chasing you
 * through doorways, and letting the 1.20m marrow-sovereign set this would make
 * every ordinary door a "crawl".
 */
export const WIDEST_ROAMER = Math.max(...(Object.values(ENEMIES) as EnemyLike[])
  .filter((e) => !e.isBoss && !e.miniboss)
  .map((e) => e.collisionRadius ?? 0));

/** Narrowest opening the game will cut at all. Below this the player sticks. */
export const CRAWL_MIN = narrowestAdmitting(PLAYER_RADIUS + CRAWL_COMFORT);
/** Widest opening that still turns the widest roamer away. Above this a "crawl"
 *  is just a tight door and the mechanic has quietly stopped existing. */
export const CRAWL_MAX = widestRefusing(WIDEST_ROAMER);

/**
 * STONE THAT MUST REMAIN BETWEEN A DOORWAY AND A CORNER, metres.
 *
 * Derived from the two things that actually constrain it, so it moves if either
 * does rather than being a number somebody liked:
 *
 *   - half a pilaster (`PILASTER.width / 2`) — the dressing puts an engaged
 *     pier at wall ends, and a doorway cut through where the pier stands leaves
 *     the pier floating, which is issue #154 all over again;
 *   - the wall ring's own `minSpan` (0.14) — a remainder thinner than that is
 *     dropped as z-fighting rather than built, so a door that leaves less than
 *     it has effectively eaten the corner anyway.
 *
 * 0.21 + 0.14 = 0.35m. That is the hard floor. `COMFORT` above it is a separate
 * and softer claim — a door with only the structural minimum beside it still
 * reads as jammed into the corner — and is kept separate precisely so the two
 * can be argued about independently.
 */
export const CORNER_STRUCTURAL = PILASTER.width / 2 + 0.14;
export const CORNER_COMFORT = 0.35;
export const CORNER_CLEAR = CORNER_STRUCTURAL + CORNER_COMFORT;

/**
 * The shortest edge that can host anything at all: clearance at both ends plus
 * the narrowest opening a body can pass. Anything under this publishes nothing.
 *
 * Note this is the CRAWL floor, not the door floor. A wall states what it can
 * structurally hold; a short edge that can only hold a crawl is not a defective
 * door, it is a crawl — and refusing to publish it was the thing that made the
 * sneaky way impossible to place. `MIN_DOOR_EDGE` is the separate, stricter
 * question the layout asks when it needs a link mobs can actually use.
 */
export const MIN_HOSTING_EDGE = 2 * CORNER_CLEAR + CRAWL_MIN;
/** The shortest edge the layout may hang a MAINLINE link on. */
export const MIN_DOOR_EDGE = 2 * CORNER_CLEAR + MIN_WALKABLE_WIDTH;

/**
 * Every opening this polygon's walls can afford.
 *
 * Pure and THREE-free. Derived from the shape alone — no corridors, no layout,
 * nothing that has to exist first. That is the whole point: the wall answers
 * before it is asked.
 *
 * Winding order is assumed counter-clockwise, as `room-shape.ts` produces; the
 * outward normal is taken accordingly and checked against the polygon's own
 * signed area so a clockwise ring cannot silently invert every door in the room.
 */
export function deriveAnchors(
  spaceId: string, poly: Poly, height: number,
  opts: { minHeight?: number } = {},
): PortalAnchor[] {
  const out: PortalAnchor[] = [];
  const ccw = signedArea(poly) > 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < MIN_HOSTING_EDGE) continue;

    const t0 = CORNER_CLEAR, t1 = len - CORNER_CLEAR;
    const run = t1 - t0;
    if (run < CRAWL_MIN) continue;

    const ux = dx / len, uz = dz / len;
    const mid = (t0 + t1) / 2;
    // Outward normal: for a counter-clockwise ring the outside is to the RIGHT
    // of the travel direction.
    const nx = ccw ? uz : -uz;
    const nz = ccw ? -ux : ux;

    out.push({
      id: `${spaceId}#a${i}`,
      space: spaceId,
      edge: i,
      at: [a[0] + ux * mid, a[1] + uz * mid],
      normal: [nx, nz],
      t0,
      t1,
      // The widest this wall can hold is its whole flat run; the narrowest is
      // the narrowest hole the game cuts anywhere. The layout will almost never
      // want either end — it takes what its section asks for, clamped into the
      // overlap with the other side — but the wall's job is to state what it
      // CAN do, not to guess what will be wanted. In particular the low end is
      // NOT `MIN_WALKABLE_WIDTH`: a wall is perfectly capable of holding a hole
      // too tight for a stoneguard, and saying so is what makes a crawl
      // placeable. Needing a link mobs can use is the LAYOUT's requirement, and
      // it asks for it by band.
      width: [CRAWL_MIN, run],
      height: [opts.minHeight ?? 2.0, height],
    });
  }
  return out;
}

/** Does this anchor face the given direction, within a right angle? */
export function facesToward(
  anchor: PortalAnchor, dx: number, dz: number,
): boolean {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  return (anchor.normal[0] * dx + anchor.normal[1] * dz) / len > 0.35;
}

function signedArea(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  }
  return s / 2;
}


// ── WHAT AN OPENING IS FOR ───────────────────────────────────────────────────
//
// Three bands, and they are not three sizes — they are three different jobs.
// A `door` is circulation and the layout may rely on it. A `gate` is a
// statement, and its scarcity has to be a DECISION rather than an accident of
// geometry, because the supply is not scarce (54% of rooms could host a 6m
// one). A `crawl` is a rule about who may follow you.

/** A width band an opening can be cut at, and what it means. */
export interface PortalBand {
  id: 'crawl' | 'door' | 'gate';
  width: readonly [number, number];
}

export const PORTAL_BANDS: readonly PortalBand[] = [
  // Player-sized. Not circulation — a way OUT of a room, and out of a fight.
  { id: 'crawl', width: [CRAWL_MIN, CRAWL_MAX] },
  // The ordinary case, and the ONLY band the layout may hang a mainline on:
  // its narrow end is the width at which the whole roster still fits.
  { id: 'door', width: [MIN_WALKABLE_WIDTH, 3.2] },
  // Monumental.
  { id: 'gate', width: [4.0, 12.0] },
];

/**
 * Which enemies could follow the player through an opening this wide.
 *
 * Computed against `gateAdmits` — the runtime nav rule — rather than asserted,
 * because "the rat can follow you and the stoneguard cannot" is exactly the
 * kind of claim that quietly stops being true after a balance pass, and a
 * crawl that has stopped excluding anything looks identical to one that works.
 */
export function whoFitsThrough(width: number): string[] {
  return (Object.values(ENEMIES) as EnemyLike[])
    .filter((e) => gateAdmits(width / 2, e.collisionRadius ?? 0))
    .map((e) => e.id);
}

/**
 * Can this wall run host an opening in this band?
 *
 * Both ends, not just the wide one. A wall whose range sits entirely above a
 * band cannot be cut at it either — checking only `width[1] >= band.min` is how
 * a wall that can only hold a 5m opening gets asked for a crawl.
 */
export function canHost(anchor: PortalAnchor, band: PortalBand): boolean {
  return anchor.width[0] <= band.width[1] && anchor.width[1] >= band.width[0];
}

/** Every band this wall run could be cut at, widest job last. */
export function hostableBands(anchor: PortalAnchor): PortalBand[] {
  return PORTAL_BANDS.filter((b) => canHost(anchor, b));
}
