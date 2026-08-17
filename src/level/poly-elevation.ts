import { CONFIG } from '../config';
import { corridorRampRun } from './elevation';

// ── THE FLOOR GOES DOWN ──────────────────────────────────────────────────────
//
// The elevation system has been complete for a long time — `elevation.ts` builds
// the ground field, rooms are flat plateaus, corridors are ramps with level
// aprons at each end, `groundYAt` is sampled by the camera, mobs, loot and
// effects. The vault composer has used it since it landed.
//
// The POLYGON generator never set a single elevation. Every poly floor is dead
// flat, which is the one thing `ElevationField.flat` is a fast path for, so
// nothing ever complained. That is the gap this closes: not a new mechanic, the
// same one the other half of the game already ships.
//
// ── WHY IT MATTERS MORE THAN IT SOUNDS ───────────────────────────────────────
//
// Monotonic descent means depth reads as progress with no tutorial line. You
// walk DOWN into the end of a floor. The exit is the lowest ground you have
// stood on. Nobody has to be told, and it costs nothing at runtime because
// collision and pathfinding stay 2D — the field is presentation truth, and a
// fight still happens on one plane because doors seal on combat.
//
// ── WHAT IS DIFFERENT HERE FROM THE VAULT PATH ───────────────────────────────
//
// A vault corridor is one rect. A polygon link is one rect when it runs
// straight and THREE when it doglegs — and it doglegs 73% of the time, so
// "only ramp the straight ones" would have given a median of one drop per
// floor, which is a flat dungeon with extra code.
//
// A dogleg is `[legA, cross, legB]`: two legs along the connection axis with a
// lateral cross piece between them. So the drop is split across the two LEGS in
// proportion to the run each can carry, and the CROSS IS LEVEL. That is not a
// compromise, it is the better shape: you descend, you turn a corner on flat
// ground, you descend again. A stair with a landing, which is what anyone
// cutting a stair through rock would build, and it keeps the bend — the place a
// player's footing is least predictable — off the slope entirely.
//
// Pure: no THREE, no scene, no RNG of its own. Same seed in, same floor out.

export interface Box { x: number; z: number; w: number; d: number }

export interface ElevLink {
  from: string;
  to: string;
  /** The corridor rects, in order from `from` to `to`. 1 = straight, 3 = dogleg. */
  rects: readonly Box[];
  /** The RoomSpec id of each rect, index-matched to `rects`. */
  ids: readonly string[];
  /** True for a dead-end pocket hung off the spine. See the clamp below. */
  spur?: boolean;
  /**
   * True for a LOOP EDGE — a corridor joining two rooms the spine already
   * placed, so the floor stops being a tree.
   *
   * It changes this pass fundamentally: every other link DECIDES how deep its
   * far room sits, and a chord decides nothing. Both its ends are already at a
   * height somebody else chose, and all it may do is carry the difference. If
   * it re-rolled a drop and reassigned `to`, the room would move under the
   * corridor that put it there and the seam at the OTHER end would step —
   * which is the failure the seam check in poly-elevation.test.ts was written
   * for.
   *
   * The caller guarantees the fall is carryable at the signed-off grade; it
   * cannot be checked here, because by the time this runs the corridor is built
   * and there is nothing to do about a bad one. See `chordSkipFits`.
   */
  chord?: boolean;
  /**
   * PER-LEG TRAVEL, for a link whose legs do not share one axis.
   *
   * Everything the spine builds runs between two rooms that share an axis, so
   * this pass derived ONE travel direction for a whole link and measured every
   * leg along it. An L-corridor breaks that: it leaves one room going north and
   * enters the other going east, and a ramp built along the link's axis would
   * run ACROSS one of the two legs instead of down it.
   *
   * So the builder declares it, per rect, because the builder is the only thing
   * that knows. `alongX` is the leg's direction of travel; `fromIsLo` says
   * whether the `from` end of that leg sits at the LOWER world coordinate along
   * it, which is what decides whether the ramp's low end is its start or its
   * finish. Omit for the ordinary case and the old derivation applies unchanged.
   */
  legAxis?: ReadonlyArray<{ alongX: boolean; fromIsLo: boolean }>;
  /** Which rects are LANDINGS rather than legs — see DerivedRects.isLanding. A
   *  landing turns and stays LEVEL; the legs carry the fall. Absent → every rect is a
   *  leg, which is what a straight run and the vault path both are. */
  isLanding?: ReadonlyArray<boolean>;
}

/** What to stamp on one corridor RoomSpec. A ramping rect gets the axis and its
 *  two end elevations; a level rect gets a flat `elevation`. */
export interface CorridorStamp {
  rampAlongX?: boolean;
  rampLoElev?: number;
  rampHiElev?: number;
  elevation?: number;
}

export interface ElevationPlan {
  /** roomId → the plateau it sits on. Every room in the link graph appears. */
  room: Map<string, number>;
  /** corridor RoomSpec id → its stamp. */
  corridor: Map<string, CorridorStamp>;
  /** Total fall from the spawn to the deepest ground on the floor, metres. */
  totalDrop: number;
}

function weightedPick<T extends { weight: number }>(pool: readonly T[], rand: () => number): T {
  let total = 0;
  for (const p of pool) total += p.weight;
  let r = rand() * total;
  for (const p of pool) { r -= p.weight; if (r <= 0) return p; }
  return pool[pool.length - 1];
}

/**
 * Assign every room a plateau and every corridor rect its ramp.
 *
 * ONE FORWARD PASS. Links arrive in construction order — the spine walks
 * `rooms[i-1] → rooms[i]`, then each spur hangs off a room already on it — so a
 * link's `from` always has an elevation by the time we reach it. A link whose
 * `from` is somehow unknown is SKIPPED rather than guessed at zero, because a
 * guess there is a room that silently floats.
 *
 * @param roomRect  roomId → its bounding rect. Only the centre is read, to work
 *                  out which end of a corridor each room is on.
 */
// ── ELEVATION IS ON, AND THE SWITCH THAT TURNED IT OFF IS GONE ───────────────
//
// There was a `flat` flag here, defaulting to TRUE, so the shipping dungeon was dead
// level. Josh, sequencing the corridor rebuild: *"how about we start by connecting rooms
// flat surface level and then tackle displacing them up and down?"* — the right order,
// because a void at a threshold could be a bad cut OR a ramp landing in the wrong place
// and there was no telling from a screenshot.
//
// It was always temporary, and its own note said what it cost: the descent-bias signal
// ("downhill is forward"), the stair corridors, the sunken rooms. It is retired because
// the thing it was waiting for landed — a link states its legs and its landings, so the
// fall is spent along the polyline instead of being inferred from a rect count, and the
// chord router no longer has to be gated to flat ground to avoid a producer that could
// not fall. `connectL`, the pre-anchor router it kept alive, is deleted.


export function planElevation(
  links: readonly ElevLink[],
  roomRect: ReadonlyMap<string, Box>,
  rand: () => number,
): ElevationPlan {
  const room = new Map<string, number>();
  const corridor = new Map<string, CorridorStamp>();
  // The first link's `from` is the spawn room, and it is the datum.
  if (links.length) room.set(links[0].from, 0);
  // The deepest ground the SPINE has reached. Spurs are clamped to it — see the
  // clamp below for why that is a promise and not a tidiness rule.
  let deepestSpine = 0;
  // YOU ALWAYS WALK DOWN INTO THE WAY OUT.
  //
  // The drop table is mostly flat by weight (50/35/15), and a polygon floor has
  // about six links to the vault composer's eight — so 16 floors in 240 came
  // out dead level, no descent at all, and on those the whole "downhill is
  // forward" signal simply isn't there. Rather than retune a table the vault
  // path shares, the LAST link of the spine takes the biggest drop it can
  // legally carry. It is also the most earned one: the room at the end of it
  // holds the stair.
  // A LOOP EDGE IS NOT THE SPINE. It is neither a spur nor part of the descent,
  // and it decides no elevation at all — so if the forced drop lands on one it
  // is simply discarded and the floor comes out flat. Measured when loops first
  // shipped: 17 of 20 sampled floors stopped descending.
  let lastSpine = -1;
  for (let i = 0; i < links.length; i++) if (!links[i].spur && !links[i].chord) lastSpine = i;
  const biggestDrop = CONFIG.ELEVATION_DROP_WEIGHTS
    .reduce((m, d) => Math.max(m, d.drop), 0);

  for (let li = 0; li < links.length; li++) {
    const link = links[li];
    const eFrom = room.get(link.from);
    const a = roomRect.get(link.from), b = roomRect.get(link.to);
    if (eFrom === undefined || !a || !b) continue;

    // ── A RECT MAY ONLY OVERLAP THE ROOM IT IS PINNED TO ─────────────
    //
    // The elevation field lets corridors WIN over rooms where the two overlap,
    // because a corridor's end is pinned to its room's plateau anyway and the
    // seam is therefore level by construction. That reasoning holds for the
    // room a rect's end is pinned to, and collapses for any other.
    //
    // On a polygon floor it collapses often. A dogleg's first leg is aimed at
    // the LANDING, not at the far room — but a leg runs at its own lateral
    // offset, and the far room's shape at that offset can reach past the point
    // the dogleg measured. The leg then ends inside a room a landing-height
    // below it. Measured before this check: 40 seams over 240 floors where the
    // ground stepped at a doorway, the worst by 0.61m.
    //
    // A step you can see and cannot climb is worse than a level floor, so a
    // link with any rect over the wrong room simply does not fall. Bounding
    // boxes rather than polygons, deliberately: a rect that clips the box but
    // misses the shape costs one drop and never costs a player their footing.
    const misplaced = linkRectsMisplaced(link, roomRect);

    // THE CONNECTION AXIS IS THE ROOMS' AXIS, not any rect's longer side. A
    // stubby wide leg's long side is perpendicular to travel, and a ramp built
    // along it runs across the corridor instead of down it.
    const linkAlongX = Math.abs(a.x - b.x) >= Math.abs(a.z - b.z);
    const linkFromIsLo = (linkAlongX ? a.x : a.z) <= (linkAlongX ? b.x : b.z);
    /** This leg's travel axis — declared by the builder for an L, derived from
     *  the rooms otherwise. */
    const legAlongX = (i: number): boolean => link.legAxis?.[i]?.alongX ?? linkAlongX;
    /** Whether this leg's `from` end is at the lower coordinate along its axis. */
    const legFromIsLo = (i: number): boolean => link.legAxis?.[i]?.fromIsLo ?? linkFromIsLo;
    const travel = (r: Box, i: number): number => (legAlongX(i) ? r.w : r.d);

    // ── EVERY LEG CAN CARRY SLOPE ──────────────────────────────────────────
    //
    // This read `rects.length === 3 ? [0, 2] : rects.length === 1 ? [0] : []` — "a
    // dogleg is three rects and the middle one is the landing". That describes exactly
    // one producer, `connectL`, which lays an L as leg + cross piece + leg. A ROUTED
    // link is one rect per leg of its polyline, so an L arrives as TWO rects and fell
    // into the `[]` branch: no rect could carry slope, so the link could not fall at
    // all. That is the whole reason the chord router was gated to flat floors, and the
    // reason `connectL` was still alive to serve elevated ones.
    //
    // A polyline states which of its rects are LANDINGS (level/link.ts), so the legs
    // are simply the ones that are not. This used to be
    // `rects.length === 3 ? [0, 2] : rects.length === 1 ? [0] : []` — "a dogleg is
    // three rects and the middle is the landing" — which describes the output of one
    // producer, `connectL`. A ROUTED link emitted one rect per leg, so an L arrived as
    // two rects, matched neither case, and could carry NO fall at all. That is what
    // gated the chord router to flat floors and kept connectL alive to serve the rest.
    //
    // The bend stays LEVEL, which is the architecture: it is where a player's footing
    // is least predictable, so the fall lives on the legs and the cross piece turns.
    const legs = link.rects.map((_, i) => i).filter((i) => !link.isLanding?.[i]);
    const runs = legs.map((i) => corridorRampRun(travel(link.rects[i], i)));
    const runTotal = runs.reduce((t, r) => t + r, 0);

    // A rolled drop, clamped to what this link's stair-run actually carries at
    // the signed-off grade. The clamp is per-LINK and not per-rect because the
    // fall is shared between the legs below.
    // The roll happens either way, so vetoing a link does not shift the rest of
    // the floor's elevations — a stream that skips draws is a stream whose
    // output depends on geometry, and then no two runs of this are comparable.
    // The roll is drawn either way, even for the forced link, so the stream
    // stays in step and the rest of the floor is unchanged by this rule.
    const rolled = weightedPick(CONFIG.ELEVATION_DROP_WEIGHTS, rand).drop;
    const roll = li === lastSpine ? biggestDrop : rolled;
    const drop = runTotal > 0 && !misplaced
      ? Math.min(roll, runTotal * CONFIG.ELEVATION_MAX_GRADE) : 0;
    // ── THE WAY OUT IS THE LOWEST GROUND YOU HAVE STOOD ON ───────────
    //
    // That is the whole payoff of a descending floor: nobody has to be told
    // which way is forward, because forward is downhill. A dead-end pocket that
    // dives below the exit spends the signal on a room that leads nowhere —
    // measured, it happened on 57 floors in 240 and the deepest point was a
    // cul-de-sac.
    //
    // So a spur may fall, but never past the spine's own floor. Spurs are
    // always built AFTER the spine (they hang off a room already placed), so by
    // the time one is reached the spine's depth is known and the clamp is exact
    // rather than a guess.
    // A CHORD DECIDES NOTHING. Both its ends are already placed, so it takes
    // the height it finds and carries the difference. The roll above is still
    // drawn — see the note there: a stream that skips draws is a stream whose
    // output depends on geometry.
    const known = link.chord ? room.get(link.to) : undefined;
    if (link.chord && known === undefined) continue;
    const eTo = link.chord ? known!
      : link.spur ? Math.max(eFrom - drop, deepestSpine)
        : eFrom - drop;
    if (!link.chord) {
      if (!link.spur) deepestSpine = Math.min(deepestSpine, eTo);
      room.set(link.to, eTo);
    }

    // What the link ACTUALLY falls, after the spur clamp. Ramping to the rolled
    // drop while the room sits at the clamped one is a corridor that ends in a
    // step — the exact bug the seam check above exists to catch.
    const fall = eFrom - eTo;

    if (legs.length === 0 || fall === 0) {
      // Nothing falls here, so every rect is simply level ground. Stamped
      // explicitly rather than left undefined: the field's fallback probes for
      // the nearest room by 2D distance, which is the mis-fire that put ramps
      // in mid-air on the vault path.
      for (const id of link.ids) corridor.set(id, { elevation: eFrom });
      continue;
    }

    // Walk the polyline, spending the fall leg by leg. The elevation at each corner
    // is whatever the legs before it have already fallen, so consecutive legs agree at
    // the joint by construction rather than by a shared "landing" rect.
    let eAt = eFrom;
    for (const [k, i] of legs.entries()) {
      const share = runTotal > 0 ? runs[k] / runTotal : 1 / legs.length;
      const eNext = k === legs.length - 1 ? eTo : eAt - fall * share;
      // The landing this leg arrives at sits where the leg left off.
      if (link.isLanding?.[i + 1]) corridor.set(link.ids[i + 1], { elevation: eNext });
      if (Math.abs(eNext - eAt) < 1e-9) {
        // A leg with no fall to carry is level ground — a landing, arrived at rather
        // than declared. Stamped explicitly: the field's fallback probes for the
        // nearest room by 2D distance, which is what put ramps in mid-air.
        corridor.set(link.ids[i], { elevation: eAt });
      } else {
        corridor.set(link.ids[i], {
          rampAlongX: legAlongX(i),
          rampLoElev: legFromIsLo(i) ? eAt : eNext,
          rampHiElev: legFromIsLo(i) ? eNext : eAt,
        });
      }
      eAt = eNext;
    }
  }

  let lowest = 0;
  for (const e of room.values()) lowest = Math.min(lowest, e);
  return { room, corridor, totalDrop: -lowest };
}

/**
 * Does any of this link's rects overlap a room it is NOT pinned to?
 *
 * The elevation field lets corridors WIN over rooms where the two overlap,
 * because a corridor's end is pinned to its room's plateau and the seam is
 * therefore level by construction. That reasoning holds for the room a rect's
 * end is pinned to and collapses for any other — the rect then ends inside a
 * room at a different height, and the ground steps in a doorway.
 *
 * Exported because the loop-edge selector has to ask the same question BEFORE
 * it builds a chord, and asking it with a second copy of the rule is how the
 * two drift apart.
 *
 * Bounding boxes rather than polygons, deliberately: a rect that clips the box
 * but misses the shape costs one drop and never costs a player their footing.
 */
export function linkRectsMisplaced(
  link: Pick<ElevLink, 'from' | 'to' | 'rects'>,
  roomRect: ReadonlyMap<string, Box>,
): boolean {
  const overlapsBox = (rc: Box, rr: Box): boolean =>
    Math.abs(rc.x - rr.x) < (rc.w + rr.w) / 2 - 0.05
    && Math.abs(rc.z - rr.z) < (rc.d + rr.d) / 2 - 0.05;
  /** Which room, if any, this rect's ends are pinned to. A dogleg's landing is
   *  pinned to neither, so it must clear BOTH. */
  const pinnedTo = (i: number): readonly string[] =>
    link.rects.length === 1 ? [link.from, link.to]
      : i === 0 ? [link.from] : i === link.rects.length - 1 ? [link.to] : [];
  return link.rects.some((rc, i) => {
    const allowed = pinnedTo(i);
    for (const [id, rr] of roomRect) {
      if (allowed.includes(id)) continue;
      if (overlapsBox(rc, rr)) return true;
    }
    return false;
  });
}

/**
 * CAN A LOOP EDGE SKIPPING `spineSteps` ROOMS CARRY THE FALL IT MIGHT FIND?
 *
 * The awkward ordering this answers: chords are chosen while the floor is being
 * laid out, and elevations are not computed until three hundred lines later,
 * after the walls are already described. By the time the fall is knowable there
 * is nothing to be done about a chord that cannot hold it.
 *
 * So the question is asked in the WORST CASE instead of the actual one. Each
 * spine link the chord skips past can drop at most the biggest entry in the
 * drop table, so a chord over n links faces at most `n * biggestDrop`, and it
 * can hold that if its stair-run carries it at the signed-off grade.
 *
 * Conservative on purpose. Measured over 72 floors, the real delta across
 * candidate pairs was a median of ZERO and a maximum of 0.30 grade against a
 * limit of 0.40 — so an actual-value test would have admitted everything and
 * looked identical to this one, right up until the drop table was retuned.
 * "It happens to hold today" is the shape of the bug, not the check.
 */
export function chordSkipFits(spineSteps: number, rampRun: number): boolean {
  const biggestDrop = CONFIG.ELEVATION_DROP_WEIGHTS
    .reduce((m, d) => Math.max(m, d.drop), 0);
  return spineSteps * biggestDrop <= rampRun * CONFIG.ELEVATION_MAX_GRADE;
}
