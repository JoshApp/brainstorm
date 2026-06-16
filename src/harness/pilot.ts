// A per-frame reactive pilot: observation in, this frame's Intent out.
//
// This is the "anew" bot shape. The legacy bot (bot.ts) emits high-level,
// multi-frame Action verbs ("move N for 0.5s") that the real-time budget model
// executes. This one decides ONE intent per fixed step and writes it to the
// bus — which is exactly what the fixed-step core consumes, and what a replay
// tape records. Pure function: same observation → same intent, so a bot run is
// as deterministic as the sim it drives.
//
// The policy is deliberately dumb (no pathfinding, no memory, no LLM): close
// with the nearest visible enemy and swing in melee. It exists to prove the
// loop — observe → decide → drive → record → replay — not to fight well. A
// smarter policy is a drop-in replacement for this one function.

import type { Observation } from './types';
import type { Intent } from './intent';
import { NEUTRAL_INTENT } from './intent';

export function decideIntent(obs: Observation): Intent {
  const enemies = obs.visible.enemies.filter((e) => e.inSight && e.hp.current > 0);
  if (enemies.length === 0) return NEUTRAL_INTENT;

  // Commit to one target: closest, but penalise off-axis foes so the bot
  // doesn't flip-flop between two equidistant flankers (which leaves both
  // alive). Score = distance + bearing penalty; lowest wins.
  let nearest = enemies[0];
  let bestScore = Infinity;
  for (const e of enemies) {
    const score = e.distance + Math.abs(e.bearing) * 1.5;
    if (score < bestScore) { bestScore = score; nearest = e; }
  }

  // bearing: 0 = dead ahead, + = to the right (radians).
  const b = nearest.bearing;

  // FACE the target, turning in real ANGULAR units. raw lookDx is a pixel-ish
  // delta — updateCamera does `yaw -= lookDx * lookSensitivity` — so a naive
  // lookDx of ~0.5 turns ~0.002 rad/frame and the bot can never rotate onto a
  // target. We pick a desired yaw turn (radians, proportional + capped +
  // deadzone) and convert via the sensitivity the observation reports.
  const sens = obs.player.lookRadiansPerUnit || 0.0035;
  const aligned = Math.abs(b) < 0.08;
  const turn = aligned ? 0 : Math.max(-0.18, Math.min(0.18, b * 0.4)); // rad this frame
  const lookDx = turn / sens;

  // REACTIVE DODGE — roll only at the actual just-dodge window: an enemy whose
  // strike is landing NOW and is in reach. Dodging on the distant WINDUP
  // telegraph (or from across the room) made the bot dodge perpetually with 3
  // foes and never commit to a swing. Tight trigger = it mostly fights and only
  // rolls the blows that would land. Exercises the just-dodge system honestly.
  const threat = enemies.find((e) => e.state === 'striking' && e.distance < 1.8);
  if (threat) {
    const strafe = threat.bearing >= 0 ? -1 : 1; // threat on the right → roll left
    return { move: [0, 0], look: [lookDx, 0], attack: false, dodge: [strafe, 0.4] };
  }

  // CHASE — close aggressively and stay in the enemy's face. Enemies kite
  // (back away), so a cautious "hold at 1.5m" lets them stay just out of reach
  // and the bot never lands a blow; pressing right in is what actually kills.
  // Keep a hair of standoff (STRIKE_RANGE) so we don't fully overlap (which
  // drops the target out of the forward cone). Survival comes from the
  // just-dodge above, not from backing off.
  const STRIKE_RANGE = 1.1;
  const facingEnough = Math.abs(b) < 0.8;
  const move: [number, number] =
    facingEnough && nearest.distance > STRIKE_RANGE ? [0, -1] : [0, 0];

  // Swing whenever the target is in reach and the cone will land.
  const attack = nearest.distance < 1.9 && Math.abs(b) < 0.5;

  return { move, look: [lookDx, 0], attack, dodge: null };
}
