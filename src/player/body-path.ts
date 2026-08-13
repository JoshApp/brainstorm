// A LIVING BODY IS NOT SCENERY.
//
// The walk-vault and the dodge both ask the level the same question — "is there
// something in the way, and is there floor past it" — and the level answers
// about STONE only. `WalkableRegion.canDashOver` tests the landing, the walls
// and the static obstacle grid, and never once looks at a mob. Enemies exist to
// the movement code in exactly one place (camera.ts's enemy slide), which the
// vault path does not go through.
//
// That blind spot is a bug for one move and the point of the other:
//
//   The WALK-VAULT must NOT clear an enemy. Walking into a mob blocks the step
//   the same way a fallen pillar does, so the vault's honest trigger fired and
//   you strolled over the thing trying to kill you — free, at walking pace, with
//   no cost and no timing. Reported from the phone, twice: "the walk vault never
//   ceases to work and works on enemies".
//
//   The DODGE must. Rolling into something and dying inside it is the worst
//   outcome a defensive move can have. A dodge aimed at a body should carry you
//   OVER it and land behind — which is the escape and the backstab in one.
//
// So the question lives here, pure and shared: what body does this line cross,
// and where is the far side of it. Circles, not meshes — enemy collision is a
// disc everywhere else in the codebase (`collisionRadius`), and the two callers
// need the same answer or the rule above only half holds.

import type { Enemy } from '../mobs/enemy';

/** A mover-blocking disc on the floor plan. An enemy, reduced to what matters. */
export interface BodyCircle {
  x: number;
  z: number;
  radius: number;
}

export interface BodyOnPath {
  body: BodyCircle;
  /** Metres from the path's start to the closest approach. 0 when the mover
   *  already overlaps the body — which is a hit, not a miss. */
  along: number;
}

/**
 * The nearest body the swept mover crosses on its way from → to, or null.
 *
 * Swept, not sampled: a dodge covers ~1.3m in a handful of frames and a point
 * test at each end would step straight through a mob standing in the middle.
 */
export function firstBodyOnPath(
  fromX: number, fromZ: number,
  toX: number, toZ: number,
  moverRadius: number,
  bodies: readonly BodyCircle[],
): BodyOnPath | null {
  const dx = toX - fromX, dz = toZ - fromZ;
  const lenSq = dx * dx + dz * dz;
  let best: BodyOnPath | null = null;
  for (const b of bodies) {
    const px = b.x - fromX, pz = b.z - fromZ;
    // Closest approach, clamped to the segment — a body past the landing is not
    // in the way of this move.
    const t = lenSq > 1e-9 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / lenSq)) : 0;
    const cx = px - dx * t, cz = pz - dz * t;
    const reach = b.radius + moverRadius;
    if (cx * cx + cz * cz >= reach * reach) continue;
    const along = t * Math.sqrt(lenSq);
    if (!best || along < best.along) best = { body: b, along };
  }
  return best;
}

/** Is the mover standing inside any of these bodies at (x,z)? */
export function anyBodyOverlaps(
  x: number, z: number, moverRadius: number, bodies: readonly BodyCircle[],
): boolean {
  for (const b of bodies) {
    const dx = x - b.x, dz = z - b.z;
    const reach = b.radius + moverRadius;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

/**
 * The live mobs that BLOCK A MOVER, as discs, written into a caller-owned array.
 *
 * Skips the dead and anything flagged `noPlayerCollision` (rats, ooze spawn),
 * because the player already walks straight through those — a vault refused by a
 * scurrying critter you can't even bump into would be a worse bug than the one
 * this closes, and a leap over one would be a dodge spent on nothing.
 *
 * The caller owns the array so two per-frame consumers can't share a scratch and
 * silently overwrite each other. Slots are reused; only growth allocates.
 */
export function livingBodies(enemies: readonly Enemy[], out: BodyCircle[]): readonly BodyCircle[] {
  let n = 0;
  for (const e of enemies) {
    if (!e.alive || e.noPlayerCollision) continue;
    const slot = out[n] ?? (out[n] = { x: 0, z: 0, radius: 0 });
    slot.x = e.group.position.x;
    slot.z = e.group.position.z;
    slot.radius = e.collisionRadius;
    n++;
  }
  out.length = n;
  return out;
}

/**
 * The point on the far side of `body`, measured along the travel direction —
 * where a leap over it should come down.
 *
 * Derived from the body rather than from a fixed carry distance, because a rat
 * and a knight are not the same jump and a constant would either fall short of
 * the big one or overshoot the small one into the next room. `clearance` is the
 * gap past touching, so the landing is BEHIND the thing and not against it.
 *
 * (dirX, dirZ) must be normalised.
 */
export function landingBeyond(
  fromX: number, fromZ: number,
  dirX: number, dirZ: number,
  body: BodyCircle,
  moverRadius: number,
  clearance: number,
): { x: number; z: number } {
  const along = (body.x - fromX) * dirX + (body.z - fromZ) * dirZ;
  const carry = along + body.radius + moverRadius + clearance;
  return { x: fromX + dirX * carry, z: fromZ + dirZ * carry };
}
