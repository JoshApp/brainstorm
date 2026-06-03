// Player knockback impulse — small per-tick decay applied to the
// camera position. New for the king slime's leap landing: the boss
// damages you AND pushes you out of his footprint so you can't get
// pinned inside the body. Same vector + speed model the enemy
// knockback system uses (mobs/enemy.ts), just on the player side.

let kbX = 0;        // unit direction
let kbZ = 0;
let kbSpeed = 0;    // current impulse speed (m/s); decays each tick

// Time constant: 0.4s to drop to ~1% of initial speed. Short enough
// that the player isn't passively flung across the room, long enough
// that the knockback distance reads as a real impulse.
const DECAY_TAU = 0.4;

/** Replace (not stack) the active knockback. Last hit wins —
 *  prevents an unlucky pile-on from launching the player off
 *  the map. dirX/dirZ are normalised internally so callers can
 *  pass any non-zero vector. */
export function applyPlayerKnockback(dirX: number, dirZ: number, speed: number): void {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0) return;
  kbX = dirX / len;
  kbZ = dirZ / len;
  kbSpeed = speed;
}

/** Sample the impulse for this frame: returns the (dx, dz) the
 *  camera should add to its position BEFORE applying input
 *  movement (so input + impulse stack correctly through walkable
 *  collision). Also decays the stored speed. */
export function consumeKnockback(dt: number): { dx: number; dz: number } {
  if (kbSpeed <= 0) return { dx: 0, dz: 0 };
  const dx = kbX * kbSpeed * dt;
  const dz = kbZ * kbSpeed * dt;
  // Exponential decay → halves over ~0.28s, ~1% remaining at 0.4s.
  kbSpeed *= Math.pow(0.01, dt / DECAY_TAU);
  if (kbSpeed < 0.1) kbSpeed = 0;
  return { dx, dz };
}

/** Clear any active knockback. Use on level load / scenario apply. */
export function resetPlayerKnockback(): void {
  kbX = 0; kbZ = 0; kbSpeed = 0;
}
