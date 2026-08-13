import type { Destructible } from '../level/destructibles';
import { CONFIG } from '../config';


// YOUR BODY IS ALSO A THING THAT HITS.
//
// A dodge is the only committed, high-speed move the player has, and until now
// it passed through a room of pottery without touching it — you would roll
// *between* four vases and every one stayed standing, which reads as the world
// being made of glass you can't reach rather than as clay. Josh: *"maybe we
// should also make it so dodging into vases breaks them, I think that's good."*
//
// It is, and for a reason worth writing down: it is the second thing in the game
// that says the roll has WEIGHT. The first is the leap over a body
// (player/body-path.ts). Both are the same claim — a dodge is a moving mass, not
// a teleport with i-frames — and a room that shatters as you cross it is the
// cheapest possible way to sell that.
//
// ── WHY IT GOES THROUGH takeDamage AND NOT A KILL LIST ──────────────────────
// Breaking a vase is not "remove the vase". It is a shatter burst, a surface
// sound matched to the material, a splice of the obstacle out of the walkable
// region, a gated loot roll, and the batched-geometry reclaim — all of which
// live inside Destructible.takeDamage and none of which a shortcut would run.
// The one thing that must never happen here is a second implementation of
// "destroy a prop" that quietly forgets the walkable splice, because the symptom
// of forgetting it is an INVISIBLE WALL where a pot used to be, which is a far
// worse bug than the one this feature fixes.
//
// So: the dodge deals damage, exactly like a swing does, and everything else
// follows from the code that already knows how.

/** Reach past the player's own body, metres. Generous — a roll is a body-width
 *  of motion and clipping the edge of a pot should still take it. */
const SWEEP_RADIUS = 0.75;

/**
 * Shatter breakables the player's roll passes through.
 *
 * Swept, not sampled: a dodge covers ~1.3m across a handful of frames, and a
 * point test at each end rolls straight through anything in the middle.
 *
 * Returns how many were struck, so a caller can decide whether the roll earned
 * any feedback of its own.
 */
export function shatterAlongDodge(
  fromX: number, fromZ: number,
  toX: number, toZ: number,
  destructibles: readonly Destructible[],
): number {
  if (!CONFIG.DODGE_SHATTERS_PROPS) return 0;
  const dx = toX - fromX, dz = toZ - fromZ;
  const lenSq = dx * dx + dz * dz;
  let struck = 0;
  for (const d of destructibles) {
    if (!d.alive) continue;
    const px = d.position.x - fromX, pz = d.position.z - fromZ;
    const t = lenSq > 1e-9 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / lenSq)) : 0;
    const cx = px - dx * t, cz = pz - dz * t;
    const reach = SWEEP_RADIUS + d.collisionRadius;
    if (cx * cx + cz * cz >= reach * reach) continue;
    // The real damage path — burst, sound, walkable splice, loot roll, reclaim.
    // Enough to kill a pot outright (1 hp) and nothing like enough to matter to
    // a sturdier breakable, which should still want a swing.
    d.takeDamage({
      // The player, by the same id player/health.ts registers its sink under.
      source: 'player',
      target: d.entityId,
      base: CONFIG.DODGE_SHATTER_DAMAGE,
      type: 'physical',
    });
    struck++;
  }
  return struck;
}
