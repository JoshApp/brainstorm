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

  let nearest = enemies[0];
  for (const e of enemies) if (e.distance < nearest.distance) nearest = e;

  // bearing: 0 = dead ahead, + = to the right (radians).
  const b = nearest.bearing;

  // Turn toward the target — look delta proportional to how far off-axis it is.
  const lookDx = Math.max(-1, Math.min(1, b * 0.6));

  // Approach in CAMERA-RELATIVE space: −moveY is forward, +moveX is right.
  // Walk straight in when it's ahead; strafe to close lateral offset.
  const move: [number, number] = [Math.sin(b) * 0.4, -Math.cos(b)];

  // Swing when it's within reach and roughly in front (the cone will land).
  const attack = nearest.distance < 2.2 && Math.abs(b) < 0.5;

  return { move, look: [lookDx, 0], attack, dodge: null };
}
