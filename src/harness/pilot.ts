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

  // Turn-and-burn: turn to FACE the target, then walk straight in. Strafing to
  // close a lateral offset (the old approach) let the bot orbit at fixed range
  // without ever aligning — so the swing cone never landed. Here facing is the
  // job of `look`, approach is the job of forward `move`; the two don't fight.
  //
  // Proportional turn with a deadzone: enough gain to converge, capped so it
  // doesn't overshoot and oscillate. (Tuned by watching the transcript's
  // `near` hold while `atk` stayed 0 — the tell that it was circling.)
  const aligned = Math.abs(b) < 0.1;
  const lookDx = aligned ? 0 : Math.max(-0.5, Math.min(0.5, b * 0.35));

  // Advance only once roughly facing the target, else turn in place — so it
  // closes ALONG its facing instead of orbiting. −moveY is forward.
  const facingEnough = Math.abs(b) < 0.8;
  const move: [number, number] = facingEnough ? [0, -1] : [0, 0];

  // Swing when within reach and the cone will land.
  const attack = nearest.distance < 2.0 && Math.abs(b) < 0.45;

  return { move, look: [lookDx, 0], attack, dodge: null };
}
