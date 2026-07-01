// Built-in dumb-AI bot that plays the dungeon autonomously between my
// interventions. Designed for two use cases:
//
//   1. CLI driver (scripts/play.ts) runs episodes hands-off.
//   2. Interactive piloting: I call `await window.harness.bot.run({...})`
//      from devtools to skip the boring corridor walking, then take
//      over when the bot pauses on something interesting.
//
// The policy is intentionally simple: there is no pathfinding (yet),
// no remembered map, no LLM. The bot picks the single best action
// each turn from the current observation, leaning on the harness's
// per-turn pause to re-evaluate after every move.
//
// Yield triggers (the `until` callback) are what make this useful for
// piloting — set `until: (obs) => obs.player.hp.current < 4` and the
// bot autopilots until I'd want to take over.

import { applyAction } from './action';
import { buildObservation } from './observation';
import { createNav, type Nav } from './pathfind';
import type { HarnessContext } from './state';
import type {
  Action, ActionResult, Observation, ObservedEnemy, ObservedInteractable,
  Direction8,
} from './types';

const CARDINALS: Direction8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Module-level bot memory. Persists across step()/run() calls until
// resetMemory() is called. Tracks which interactables the bot has
// already used so it doesn't get stuck re-reading the same corpse
// or re-drinking the same fountain (these don't auto-disable in the
// underlying interactable system).
interface BotMemory {
  usedInteractableIds: Set<string>;
  /** Targets (enemy/interactable ids) that wedged us — skipped so we stop
   *  re-pathing into the same wall / unreachable boss gate / un-lootable item. */
  blacklist: Set<string>;
  /** Last observed position, to detect "issued actions but didn't move". */
  lastPos: { x: number; z: number } | null;
  /** Consecutive steps with ~no movement. */
  stuckSteps: number;
  /** Remaining forced break-out explore steps (rotating direction). */
  breakout: number;
  /** Consecutive steps a screen has held the world paused (dismiss-loop guard). */
  screenSteps: number;
}
const memory: BotMemory = { usedInteractableIds: new Set(), blacklist: new Set(), lastPos: null, stuckSteps: 0, breakout: 0, screenSteps: 0 };

/** Reset bot memory. Call between episodes. */
export function resetMemory(): void {
  memory.usedInteractableIds.clear();
  memory.blacklist.clear();
  memory.lastPos = null;
  memory.stuckSteps = 0;
  memory.breakout = 0;
  memory.screenSteps = 0;
}

/** Pick the single best action given the current observation. Reads
 *  + writes module-level bot memory (see resetMemory). */
export function step(obs: Observation, nav?: Nav): Action {
  // 0. A UI screen (corpse note, loot card, …) pauses the world. DISMISS it so the
  //    bot can keep going — searching a corpse pops a note screen, and without a
  //    close verb the bot used to freeze here. Guard against an undismissable screen:
  //    after a few tries still paused, fall back to wait (operator can take over).
  if (obs.pausedReason === 'screen') {
    memory.screenSteps++;
    if (memory.screenSteps <= 4) return { kind: 'dismiss' };
    return { kind: 'wait', seconds: 0.1 };
  }
  memory.screenSteps = 0;

  // ANTI-STALL. The bot issues an action every step, but some situations produce
  // actions that don't advance us: an enemy behind a boss gate (unreachable → nav
  // null), an item we can't pick up, a wall the coarse nav grid thinks is passable.
  // Detect "acted but didn't move" over several steps, then BLACKLIST whatever we're
  // chasing and force a short rotating explore to escape. Keeps long autopilot runs
  // (compile measurement, floor clears) from freezing.
  const pos = obs.player.pos;
  if (memory.lastPos) {
    const moved = Math.hypot(pos.x - memory.lastPos.x, pos.z - memory.lastPos.z);
    if (moved < 0.12) memory.stuckSteps++; else memory.stuckSteps = 0;
  }
  memory.lastPos = { x: pos.x, z: pos.z };
  if (memory.stuckSteps >= 6 && memory.breakout === 0) {
    // Blacklist the likely culprit — the nearest live enemy and the nearest useful
    // interactable — so we stop re-pursuing the thing we can't reach/use.
    const stuckE = obs.visible.enemies.find((e) => !isDeadOrDying(e) && !memory.blacklist.has(e.id));
    if (stuckE) memory.blacklist.add(stuckE.id);
    const stuckI = obs.visible.interactables.find(
      (i) => isUsefulInteractable(i) && !memory.blacklist.has(i.id),
    );
    if (stuckI) memory.blacklist.add(stuckI.id);
    memory.breakout = 8;
    memory.stuckSteps = 0;
  }
  if (memory.breakout > 0) {
    return exploreMove(obs.geometry.walls8, memory.breakout--);
  }

  // 1. AT STRIKE REACH → swing. A foe this close is inside the wide strike cone
  //    regardless of its exact bearing, AND its horizontal bearing goes NOISY at
  //    point-blank — distance/bearing are horizontal (hypot(dx,dz)/atan2), so a rat
  //    circling at your feet sweeps bearing ±π frame to frame. The old code tried to
  //    re-`face` that jitter (snap-turn to a swinging angle) → the endless pivot, then
  //    fell through to `move` → walked straight through it. Fix: within reach, just
  //    attack; only turn if the foe is genuinely BEHIND (a real turn, not point-blank
  //    noise), never for one that's already ahead/beside.
  const STRIKE_REACH = 1.7;
  const inReach = obs.visible.enemies.find((e) =>
    e.inSight && e.distance < STRIKE_REACH && !isDeadOrDying(e),
  );
  if (inReach) {
    // |bearing| < ~2.2 rad (~125°) = ahead or beside → the cone covers it, swing.
    // Only a foe clearly behind you warrants a turn.
    if (Math.abs(inReach.bearing) < 2.2) return { kind: 'attack' };
    return { kind: 'face', target: { id: inReach.id } };
  }

  // 2. Engaged at mid range + roughly facing → swing.
  const meleeTarget = obs.visible.enemies.find((e) =>
    e.inSight && e.distance < 2.4 && Math.abs(e.bearing) < Math.PI / 4 && !isDeadOrDying(e),
  );
  if (meleeTarget) return { kind: 'attack' };

  // 3. Hostile out of reach → APPROACH. With a nav path, MOVE along it (routes
  //    around walls/corners); don't `face` here — the target's bearing stays
  //    off-axis while the route bends, and facing-every-step would stall in place.
  //    Final alignment is handled at reach (rule 1). Without nav, fall back to
  //    face-then-greedy-move.
  const nearHostile = obs.visible.enemies.find((e) =>
    e.distance < 10 && !isDeadOrDying(e) && !memory.blacklist.has(e.id),
  );
  if (nearHostile && nearHostile.distance > STRIKE_REACH) {
    const dir = nav?.dirToward(obs.player.pos, nearHostile.pos);
    if (dir) return { kind: 'move', dir, seconds: 0.3 };
    // Greedy fallback (no nav / no route): face if off-axis, else step forward.
    if (nearHostile.inSight && Math.abs(nearHostile.bearing) > Math.PI / 6) {
      return { kind: 'face', target: { id: nearHostile.id } };
    }
    if (nearHostile.inSight) return { kind: 'move', dir: nearHostile.compass, seconds: 0.3 };
  }

  // 4. LOOT FIRST — chest / pickup / corpse / fountain in range → face + interact.
  //    Prioritised ABOVE the stairs so the bot clears a floor's loot before
  //    descending. Mark the id used the MOMENT we interact — whether or not the
  //    pickup lands (a full inventory / non-stackable dupe just fails silently) —
  //    so an item we can't take never traps us in an interact loop. Skip used +
  //    blacklisted ids.
  const inRangeUseful = obs.visible.interactables.find(
    (i) => i.inRange && isUsefulInteractable(i)
      && !memory.usedInteractableIds.has(i.id) && !memory.blacklist.has(i.id),
  );
  if (inRangeUseful) {
    if (Math.abs(inRangeUseful.bearing) > Math.PI / 6) {
      return { kind: 'face', target: { id: inRangeUseful.id } };
    }
    memory.usedInteractableIds.add(inRangeUseful.id);
    return { kind: 'interact' };
  }

  // 5. Loot visible but out of range → route toward it (nav path; greedy fallback).
  const sightedUseful = obs.visible.interactables.find(
    (i) => i.inSight && isUsefulInteractable(i)
      && !memory.usedInteractableIds.has(i.id) && !memory.blacklist.has(i.id),
  );
  if (sightedUseful) {
    const dir = nav?.dirToward(obs.player.pos, sightedUseful.pos) ?? sightedUseful.compass;
    return { kind: 'move', dir, seconds: 0.4 };
  }

  // 6. Nothing left to loot → head for the stairs. In range → face + descend.
  //    interactables.system needs the stair in the forward cone (not just radius),
  //    so face first; inRange in the obs is distance-only.
  const stairs = obs.visible.interactables.find((i) => i.kind === 'stairs' && i.inRange);
  if (stairs) {
    if (Math.abs(stairs.bearing) > Math.PI / 6) {
      return { kind: 'face', target: { id: stairs.id } };
    }
    return { kind: 'interact' };
  }

  // 7. Any stairs anywhere → route to them (nav path around walls/pillars; greedy
  //    wall-avoidance only as a fallback when no route is found).
  const anyStairs = obs.visible.interactables.find((i) => i.kind === 'stairs');
  if (anyStairs) {
    const dir = nav?.dirToward(obs.player.pos, anyStairs.pos) ?? avoidWalls(anyStairs.compass, obs.geometry.walls8);
    return { kind: 'move', dir, seconds: 0.4 };
  }

  // 8. Explore: walk in the most open direction.
  return exploreMove(obs.geometry.walls8, 0);
}

function isDeadOrDying(e: ObservedEnemy): boolean {
  return e.state === 'dead' || e.state === 'dying';
}

// The bot pursues LOOT only: chests, floor pickups, lootable corpses, healing
// fountains. Deliberately NOT bonfires / stashes / tomes / notes — those open a
// blocking MENU (obs.pausedReason='screen') and there's no harness verb to close
// it, so the bot would freeze. Also not blood/tithe altars (HP-cost transactions),
// doors/spike-traps, or the boss trigger. Keeps autopilot runs unattended-safe.
const BOT_LOOT_KINDS = new Set(['chest', 'pickup', 'corpse', 'fountain']);
function isUsefulInteractable(i: ObservedInteractable): boolean {
  if (!BOT_LOOT_KINDS.has(i.kind)) return false;
  if (i.state === 'inert' || i.state === '') return false;
  return true;
}

/** Return a movement direction close to `goal` but with at least 1.5m
 *  of clearance ahead. Tries the goal first, then the two adjacent
 *  compass dirs, then the next pair, etc. If nothing has clearance,
 *  returns the original goal (we'll be stuck but report it honestly). */
function avoidWalls(goal: Direction8, walls: Record<Direction8, number>): Direction8 {
  const MIN_CLEARANCE = 1.5;
  const goalIdx = CARDINALS.indexOf(goal);
  // Try goal, then ±1, ±2, ±3 from goal — 8 dirs total.
  const order: Direction8[] = [];
  order.push(goal);
  for (let off = 1; off <= 3; off++) {
    order.push(CARDINALS[(goalIdx + off + 8) % 8]);
    order.push(CARDINALS[(goalIdx - off + 8) % 8]);
  }
  for (const d of order) {
    const w = walls[d];
    if (!Number.isFinite(w) || (w ?? 0) >= MIN_CLEARANCE) return d;
  }
  return goal;
}

/** Walk toward open space. `rot` rotates the choice among the most-open directions
 *  so a break-out (called repeatedly with a changing rot) tries VARIED escapes
 *  instead of re-picking the same wall. rot=0 → the single most-open direction. */
function exploreMove(walls: Record<Direction8, number>, rot: number): Action {
  const ranked = [...CARDINALS].sort((a, b) => {
    const wa = Number.isFinite(walls[a]) ? walls[a] : 99;
    const wb = Number.isFinite(walls[b]) ? walls[b] : 99;
    return wb - wa;
  });
  const dir = ranked[rot % Math.min(4, ranked.length)];
  return { kind: 'move', dir, seconds: 0.4 };
}

export interface RunOpts {
  /** Hard cap on actions issued. Default 100. */
  maxTurns?: number;
  /** Yield trigger — return truthy to stop and surrender control. If a
   *  string is returned it's used as the stopReason. Called AFTER each
   *  action's observation lands. */
  until?: (obs: Observation, result: ActionResult, turn: number) => boolean | string;
  /** Per-turn callback. Useful for the CLI driver to dump transcript /
   *  capture screenshots / print live progress. */
  onStep?: (obs: Observation, result: ActionResult, turn: number) => void | Promise<void>;
}

export interface RunResult {
  turns: number;
  stopReason: string;
  /** Sequence of ActionResults the bot produced. Observation snapshots
   *  are on each result.observation. */
  transcript: ActionResult[];
}

/** Run the bot until a stop condition fires. Stop reasons:
 *    'until'      — caller's `until` returned truthy
 *    'died'       — player HP hit zero
 *    'max-turns'  — exhausted maxTurns
 *    'no-level'   — level became unavailable (rare; race during load)
 *    'error:<msg>'— uncaught exception during dispatch */
export async function run(
  ctx: HarnessContext,
  opts: RunOpts = {},
): Promise<RunResult> {
  resetMemory();
  const maxTurns = opts.maxTurns ?? 100;
  const transcript: ActionResult[] = [];
  let stopReason = 'max-turns';

  // Pathfinding grid, rebuilt when the level changes (descent). createNav is cheap
  // (bounds + refs); the BFS runs lazily inside dirToward, cached per target cell.
  let nav: Nav | undefined;
  let navLevel: unknown;

  for (let t = 0; t < maxTurns; t++) {
    const level = ctx.getLevel();
    if (!level) { stopReason = 'no-level'; break; }
    if (level !== navLevel) { nav = createNav(level as Parameters<typeof createNav>[0]); navLevel = level; }
    const obs = buildObservation(ctx.camera, level);
    const action = step(obs, nav);
    let result: ActionResult;
    try {
      result = await applyAction(ctx, action);
    } catch (err) {
      stopReason = 'error:' + ((err as Error).message ?? 'unknown');
      break;
    }
    transcript.push(result);
    if (opts.onStep) {
      try { await opts.onStep(result.observation, result, t); } catch { /* ignore */ }
    }
    if (result.observation.player.hp.current <= 0) { stopReason = 'died'; break; }
    if (opts.until) {
      const stop = opts.until(result.observation, result, t);
      if (stop) {
        stopReason = typeof stop === 'string' ? stop : 'until';
        break;
      }
    }
  }
  return { turns: transcript.length, stopReason, transcript };
}
