import { registerProjectileType, type ProjectileType } from '../combat/projectile-pool';

// Projectile content registry. Add a new spell/dart/spit by adding a
// ProjectileType here and exporting an id constant — ranged enemies
// reference it from their spec (`ranged.projectileId`).
//
// Tuning notes:
//   - speed:    too fast → unreadable, too slow → trivial to sidestep.
//                Acolyte spit at 6 m/s is sluggish-magic feel.
//   - lifetime: cap on travel time; combined with walkable.contains the
//                projectile dies on wall hit anyway, so generous is fine.
//   - color:    matches the caster's eye/staff cue so the player can
//                read "that one is shooting at me" at a glance.

export const ACOLYTE_SPIT: ProjectileType = {
  id: 'acolyte-spit',
  radius: 0.13,
  speed: 6.0,
  lifetime: 3.0,
  damageType: 'magic',
  color: 0x66ffaa,         // matches wraith/acolyte spectral palette
  lightIntensity: 1.2,
  lightRange: 3.0,
};

// Acid spit — slower + a touch bigger than the acolyte spit so it
// reads as "globular bolus of corrosive slime" instead of "magic
// dart." Cyan/blue glow matches the acid-spitter's core orb. Magic
// damage type so the chemistry bypasses physical armour — the
// thematic justification: acid eats through iron plate. Slower
// speed is the dodge affordance — these things are easy to
// sidestep one-on-one; danger comes from a pack across a room.
export const ACID_SPIT: ProjectileType = {
  id: 'acid-spit',
  radius: 0.16,
  speed: 5.0,
  lifetime: 3.2,
  damageType: 'magic',
  color: 0x66ccff,
  lightIntensity: 1.0,
  lightRange: 2.8,
};

// Bone shard — a hurled shard of bone. PHYSICAL (it's a thrown object,
// not a spell), fast + small so it reads as a flung splinter. Faint
// pale glow so it's visible crossing a dark room. The skeleton throws
// these as it advances, so the player is pressured at range too.
export const BONE_SHARD: ProjectileType = {
  id: 'bone-shard',
  radius: 0.11,
  speed: 8.0,
  lifetime: 2.6,
  damageType: 'physical',
  color: 0xd8cfb8,
  lightIntensity: 0.5,
  lightRange: 2.2,
};

// Crossbow bolt — the player's physical ranged shot. Fast + small +
// barely-glowing (it's a quarrel, not magic); a faint warm tracer so
// it reads crossing the dark.
export const CROSSBOW_BOLT: ProjectileType = {
  id: 'crossbow-bolt',
  radius: 0.09,
  speed: 13.0,
  lifetime: 1.6,
  damageType: 'physical',
  color: 0xffd9a0,
  lightIntensity: 0.4,
  lightRange: 1.8,
};

// Arcane bolt — the player's wand shot. Magic (bypasses physical
// armour), slower + bigger + brightly violet so the caster playstyle
// reads distinct from the crossbow.
export const ARCANE_BOLT: ProjectileType = {
  id: 'arcane-bolt',
  radius: 0.15,
  speed: 9.0,
  lifetime: 2.4,
  damageType: 'magic',
  color: 0xb060ff,
  lightIntensity: 1.4,
  lightRange: 3.2,
};

export function registerProjectiles(): void {
  registerProjectileType(ACOLYTE_SPIT);
  registerProjectileType(ACID_SPIT);
  registerProjectileType(BONE_SHARD);
  registerProjectileType(CROSSBOW_BOLT);
  registerProjectileType(ARCANE_BOLT);
}
