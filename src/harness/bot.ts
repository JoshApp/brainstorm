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
}
const memory: BotMemory = { usedInteractableIds: new Set() };

/** Reset bot memory. Call between episodes. */
export function resetMemory(): void {
  memory.usedInteractableIds.clear();
}

/** Pick the single best action given the current observation. Reads
 *  + writes module-level bot memory (see resetMemory). */
export function step(obs: Observation): Action {
  // 0. If a UI screen is paused the world (note read, inventory, etc.),
  //    we can't progress until it closes. There's no harness verb for
  //    'close screen' yet, so flag this so the caller can take over.
  if (obs.pausedReason === 'screen') {
    // Best effort: still attempt to walk — the screen-manager may
    // dismiss on the next input. If that doesn't work, the operator
    // will see paused:screen in observations and intervene.
    return { kind: 'wait', seconds: 0.1 };
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

  // 3. Hostile visible, off-axis, and NOT yet at reach → face before approaching.
  const nearHostile = obs.visible.enemies.find((e) =>
    e.inSight && e.distance < 8 && !isDeadOrDying(e),
  );
  if (nearHostile && nearHostile.distance > STRIKE_REACH && Math.abs(nearHostile.bearing) > Math.PI / 6) {
    return { kind: 'face', target: { id: nearHostile.id } };
  }

  // 4. Hostile ahead but out of reach → walk forward (never when already at reach).
  if (nearHostile && nearHostile.distance > STRIKE_REACH && nearHostile.distance < 8) {
    return { kind: 'move', dir: nearHostile.compass, seconds: 0.3 };
  }

  // 4. Stairs in range → face them then descend. interactables.system
  //    requires the target to be in the player's forward cone, not
  //    just within radius. inRange in the obs is distance-only, so we
  //    face explicitly before the interact verb fires.
  const stairs = obs.visible.interactables.find((i) => i.kind === 'stairs' && i.inRange);
  if (stairs) {
    if (Math.abs(stairs.bearing) > Math.PI / 6) {
      return { kind: 'face', target: { id: stairs.id } };
    }
    return { kind: 'interact' };
  }

  // 5. Any stairs anywhere on this floor → walk toward them, with
  //    wall avoidance. Stairs are a strong deterministic goal; even
  //    when LOS reports them as occluded (a wall / pillar between
  //    camera and the stair pivot), they're worth pursuing.
  const anyStairs = obs.visible.interactables.find((i) => i.kind === 'stairs');
  if (anyStairs) {
    const dir = avoidWalls(anyStairs.compass, obs.geometry.walls8);
    return { kind: 'move', dir, seconds: 0.4 };
  }

  // 6. Chest / fountain / corpse in range → face + interact (loot, lore).
  //    Same cone-facing requirement as stairs. Skip ids we've already
  //    used so we don't bash the same corpse forever.
  const inRangeUseful = obs.visible.interactables.find(
    (i) => i.inRange && isUsefulInteractable(i) && !memory.usedInteractableIds.has(i.id),
  );
  if (inRangeUseful) {
    if (Math.abs(inRangeUseful.bearing) > Math.PI / 6) {
      return { kind: 'face', target: { id: inRangeUseful.id } };
    }
    memory.usedInteractableIds.add(inRangeUseful.id);
    return { kind: 'interact' };
  }

  // 7. Useful interactable visible → walk toward it (also skip used).
  const sightedUseful = obs.visible.interactables.find(
    (i) => i.inSight && isUsefulInteractable(i) && !memory.usedInteractableIds.has(i.id),
  );
  if (sightedUseful) {
    return { kind: 'move', dir: sightedUseful.compass, seconds: 0.4 };
  }

  // 8. Explore: walk in the most open direction (longest wall distance).
  const walls = obs.geometry.walls8;
  let bestDir: Direction8 = 'N';
  let bestDist = -Infinity;
  for (const d of CARDINALS) {
    const v = walls[d];
    const dist = Number.isFinite(v) ? v : 99;
    if (dist > bestDist) {
      bestDist = dist;
      bestDir = d;
    }
  }
  return { kind: 'move', dir: bestDir, seconds: 0.4 };
}

function isDeadOrDying(e: ObservedEnemy): boolean {
  return e.state === 'dead' || e.state === 'dying';
}

function isUsefulInteractable(i: ObservedInteractable): boolean {
  // Doors don't auto-interact (might be sealed by the room-clear gate).
  // Spike traps don't either. Everything else with a prompt is fair game.
  if (i.kind === 'door' || i.kind === 'spike-trap') return false;
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

  for (let t = 0; t < maxTurns; t++) {
    const level = ctx.getLevel();
    if (!level) { stopReason = 'no-level'; break; }
    const obs = buildObservation(ctx.camera, level);
    const action = step(obs);
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
