// Bot navigation adapter over the game's real NavGrid (level/nav-grid.ts).
//
// This used to be a hand-rolled BFS — which reinvented (worse) the A* grid the
// ENEMIES already use, and lacked its two crucial features: gate/archway FUNNELLING
// (steer through a framed opening's centre instead of grazing the columns) and
// TIGHT-doorway tiers. That's why the bot wedged on pillars at corridor mouths. Now
// we just wrap level.nav so the bot routes with the exact same obstacle-, gate- and
// void-aware pathing as mobs — one source of truth, no drift.

import type { NavGrid } from '../level/nav-grid';
import type { Direction8 } from './types';

interface Vec2 { x: number; z: number }

const PLAYER_RADIUS = 0.3;   // controls/camera PLAYER_RADIUS
const EIGHTH = Math.PI / 8;

/** Delta → 8-compass (matches observation.ts compassFor: 0 = N, +π/2 = E). */
function dir8(dx: number, dz: number): Direction8 {
  const a = Math.atan2(dx, -dz);
  if (a >= -EIGHTH && a < EIGHTH) return 'N';
  if (a >= EIGHTH && a < 3 * EIGHTH) return 'NE';
  if (a >= 3 * EIGHTH && a < 5 * EIGHTH) return 'E';
  if (a >= 5 * EIGHTH && a < 7 * EIGHTH) return 'SE';
  if (a >= 7 * EIGHTH || a < -7 * EIGHTH) return 'S';
  if (a >= -7 * EIGHTH && a < -5 * EIGHTH) return 'SW';
  if (a >= -5 * EIGHTH && a < -3 * EIGHTH) return 'W';
  return 'NW';
}

export interface Nav {
  /** Compass toward the next path waypoint from `from` toward `to` (8-way, for the
   *  greedy fallback). null if no route. Prefer waypoint() for smooth steering. */
  dirToward(from: Vec2, to: Vec2): Direction8 | null;
  /** The next path WAYPOINT (world point) to steer at from `from` toward `to` —
   *  routes around walls/pillars, through framed-opening centres, on a smoothed
   *  (string-pulled) path. Steer at this continuously instead of quantizing to 8
   *  directions. null if no route. */
  waypoint(from: Vec2, to: Vec2): Vec2 | null;
  /** DEV forensics: the raw waypoints of the last query (world coords). */
  _debugPath?: readonly Vec2[];
}

// The most recent path the bot queried — published for the DEV nav overlay so it
// can draw the bot's route alongside the enemies'. Not gameplay state.
let latestBotPath: readonly Vec2[] = [];
export function getLatestBotPath(): readonly Vec2[] { return latestBotPath; }

/** Wrap the level's NavGrid as a bot-steering helper. */
export function makeNav(grid: NavGrid): Nav {
  let lastPath: Vec2[] = [];
  // The next waypoint to aim at from `from` toward `to`, or null if no route.
  // radius = player, so the grid excludes gaps the player can't fit and admits gate
  // bands it can; the path is string-pulled + funnelled through archway centres.
  const pick = (from: Vec2, to: Vec2): Vec2 | null => {
    const path = grid.findPath(from.x, from.z, to.x, to.z, { radius: PLAYER_RADIUS });
    lastPath = path;
    latestBotPath = path;
    if (!path.length) return null;
    // Aim at the first waypoint we haven't reached (~a step ahead) so the heading
    // tracks the route's local turns rather than a distant point.
    let target = path[path.length - 1];
    for (const wp of path) {
      if ((wp.x - from.x) ** 2 + (wp.z - from.z) ** 2 > 0.4 * 0.4) { target = wp; break; }
    }
    return target;
  };
  return {
    waypoint(from: Vec2, to: Vec2): Vec2 | null { return pick(from, to); },
    dirToward(from: Vec2, to: Vec2): Direction8 | null {
      const wp = pick(from, to);
      return wp ? dir8(wp.x - from.x, wp.z - from.z) : null;
    },
    get _debugPath() { return lastPath; },
  };
}
