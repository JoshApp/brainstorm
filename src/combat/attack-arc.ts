// The forward attack wedge — pure, no Three.js, no scene, so it can be tested
// headlessly and reasoned about on its own.
//
// WHY THIS EXISTS. Until 2026-08-12 an enemy melee strike was a flat XZ distance
// test with no facing check at all, so a mob could hit you while you stood
// behind it. Because facing is LOCKED through strike and recover, that is
// precisely the moment you would have dodged around it — so dodging AWAY was the
// only answer that worked and dodging AROUND did nothing. That's half the dodge
// vocabulary of every soulslike removed by a missing if-statement, and it is the
// single biggest source of "that felt unfair" in the game.
//
// The aim-lock in faceTarget has always PROMISED this behaviour in its comment
// ("circle out of the arc to whiff it"). This is the arc it was promising.

/** Half-angle (radians) at or above which an attack is omnidirectional. */
export const OMNI_ARC = Math.PI;

/**
 * Is the target inside the attacker's forward wedge?
 *
 * `yaw` is a Three.js Y-rotation where the attacker's forward is local -Z — the
 * convention `faceTarget` writes and `canSeePlayer`'s sight cone already reads,
 * so forward = (-sin yaw, -cos yaw).
 *
 * `halfAngle` is measured from the facing direction to one edge, so the total
 * wedge is twice it. >= PI is omnidirectional (a spin attack). A target standing
 * exactly on the attacker returns true — there is no meaningful direction to a
 * point at zero distance, and "it's inside me" should not be a miss.
 */
export function withinForwardArc(
  fromX: number, fromZ: number, yaw: number,
  targetX: number, targetZ: number,
  halfAngle: number,
): boolean {
  if (halfAngle >= OMNI_ARC) return true;
  if (halfAngle <= 0) return false;
  const dx = targetX - fromX;
  const dz = targetZ - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return (fx * dx + fz * dz) / len >= Math.cos(halfAngle);
}
