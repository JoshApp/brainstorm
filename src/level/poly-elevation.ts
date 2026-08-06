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
  let lastSpine = -1;
  for (let i = 0; i < links.length; i++) if (!links[i].spur) lastSpine = i;
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
    const overlapsBox = (rc: Box, rr: Box): boolean =>
      Math.abs(rc.x - rr.x) < (rc.w + rr.w) / 2 - 0.05
      && Math.abs(rc.z - rr.z) < (rc.d + rr.d) / 2 - 0.05;
    /** Which room, if any, this rect's ends are pinned to. A dogleg's landing
     *  is pinned to neither, so it must clear BOTH. */
    const pinnedTo = (i: number): readonly string[] =>
      link.rects.length === 1 ? [link.from, link.to]
        : i === 0 ? [link.from] : i === link.rects.length - 1 ? [link.to] : [];
    const misplaced = link.rects.some((rc, i) => {
      const allowed = pinnedTo(i);
      for (const [id, rr] of roomRect) {
        if (allowed.includes(id)) continue;
        if (overlapsBox(rc, rr)) return true;
      }
      return false;
    });

    // THE CONNECTION AXIS IS THE ROOMS' AXIS, not any rect's longer side. A
    // stubby wide leg's long side is perpendicular to travel, and a ramp built
    // along it runs across the corridor instead of down it.
    const alongX = Math.abs(a.x - b.x) >= Math.abs(a.z - b.z);
    const travel = (r: Box): number => (alongX ? r.w : r.d);
    const fromIsLo = (alongX ? a.x : a.z) <= (alongX ? b.x : b.z);

    // Which rects can carry slope: the single rect, or a dogleg's two legs.
    const legs = link.rects.length === 3 ? [0, 2] : link.rects.length === 1 ? [0] : [];
    const runs = legs.map((i) => corridorRampRun(travel(link.rects[i])));
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
    const eTo = link.spur
      ? Math.max(eFrom - drop, deepestSpine)
      : eFrom - drop;
    if (!link.spur) deepestSpine = Math.min(deepestSpine, eTo);
    room.set(link.to, eTo);

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

    if (legs.length === 1) {
      corridor.set(link.ids[0], {
        rampAlongX: alongX,
        rampLoElev: fromIsLo ? eFrom : eTo,
        rampHiElev: fromIsLo ? eTo : eFrom,
      });
      continue;
    }

    // Dogleg. The landing sits at whatever fraction of the fall the first leg
    // carried, so a long leg and a short one each get the grade they can hold
    // instead of both getting half.
    const eMid = eFrom - fall * (runs[0] / runTotal);
    corridor.set(link.ids[0], {
      rampAlongX: alongX,
      rampLoElev: fromIsLo ? eFrom : eMid,
      rampHiElev: fromIsLo ? eMid : eFrom,
    });
    corridor.set(link.ids[1], { elevation: eMid });   // the landing
    corridor.set(link.ids[2], {
      rampAlongX: alongX,
      rampLoElev: fromIsLo ? eMid : eTo,
      rampHiElev: fromIsLo ? eTo : eMid,
    });
  }

  let lowest = 0;
  for (const e of room.values()) lowest = Math.min(lowest, e);
  return { room, corridor, totalDrop: -lowest };
}
