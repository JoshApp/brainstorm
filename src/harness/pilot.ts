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

  // Turn-and-burn: turn to FACE the target, then walk straight in. Strafing to
  // close a lateral offset (the old approach) let the bot orbit at fixed range
  // without ever aligning — so the swing cone never landed. Here facing is the
  // job of `look`, approach is the job of forward `move`; the two don't fight.
  //
  // CRITICAL scale fix: raw lookDx is a pixel-ish delta — updateCamera does
  // `yaw -= lookDx * lookSensitivity`. A naive lookDx of ~0.5 turns the camera
  // ~0.002 rad/frame, so the bot could never rotate to face anything. Instead
  // we choose a desired yaw turn IN RADIANS (proportional + capped + deadzone)
  // and convert to look units via the sensitivity the observation reports.
  const sens = obs.player.lookRadiansPerUnit || 0.0035;
  const aligned = Math.abs(b) < 0.08;
  const turn = aligned ? 0 : Math.max(-0.18, Math.min(0.18, b * 0.4)); // rad this frame
  const lookDx = turn / sens;

  // Advance only once roughly facing the target, and only until STRIKE_RANGE —
  // then HOLD. Bulldozing to distance 0 overlaps the enemy, where bearing goes
  // erratic and the swing cone (an arc in front) no longer catches it. Holding
  // at reach keeps the target cleanly in the cone so swings land. −moveY = fwd.
  const STRIKE_RANGE = 1.5;
  const facingEnough = Math.abs(b) < 0.8;
  const move: [number, number] =
    facingEnough && nearest.distance > STRIKE_RANGE ? [0, -1] : [0, 0];

  // Swing when within reach and the cone will land.
  const attack = nearest.distance < 1.9 && Math.abs(b) < 0.45;

  return { move, look: [lookDx, 0], attack, dodge: null };
}
