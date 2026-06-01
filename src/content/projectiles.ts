import * as THREE from 'three';
import { registerProjectileType, type ProjectileType } from '../combat/projectile-pool';

// ── Custom projectile geometries ─────────────────────────────────
// Authored at REAL-WORLD SIZE (the pool sets mesh.scale=1 when a
// type provides geometry). Each is oriented so the tip / forward
// end sits at LOCAL -Z — the pool's orientToVelocity tick aligns
// local -Z with the velocity direction so they fly tip-first.

/** Long thin cone — an arrow / bolt shape. Used by the player's
 *  crossbow. The tip is at -Z, the base at +Z. Trail sprite carries
 *  the visible glow; the cone itself reads as a slim metallic dart. */
function arrowGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.030, 0.36, 6);
  // ConeGeometry's apex sits at +Y by default; rotate so apex → -Z.
  g.rotateX(-Math.PI / 2);
  // Shift so the apex is forward of the projectile centre by ~0.20m;
  // the back of the shaft trails at +Z.
  g.translate(0, 0, -0.10);
  return g;
}

/** Short stout cylinder — a flung bone. Sphere caps would be nicer
 *  but a single cylinder reads as "bone" at projectile scale; the
 *  pale tint sells the rest. */
function boneGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.038, 0.038, 0.22, 6);
  // Cylinder is +Y by default; rotate so its long axis aligns with -Z.
  g.rotateX(Math.PI / 2);
  // Centre on (0, 0, 0).
  g.translate(0, 0, -0.05);
  return g;
}

/** Elongated octahedron — an arcane bolt with sharp facets that
 *  read as crystalline / magical, not just "ball". The emissive
 *  material does the heavy lifting; the octahedron's silhouette
 *  catches per-face shading so it looks alive in flight. */
function arcaneBoltGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.14, 0);
  // Stretch along travel direction (-Z) so it reads as a streaking
  // shard rather than a static gem.
  g.scale(1.0, 1.0, 1.7);
  return g;
}

/** Wave-slash — a flat horizontal crescent that streaks forward. The
 *  signature projectile of charged sword releases. Wide + thin reads
 *  as "the swing kept going past the blade" rather than a discrete
 *  bolt. Bright orange/red emissive sells the rage theme. */
function waveSlashGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Horizontal crescent in the XZ plane (we'll extrude tiny in Y).
  // Wider outer arc + thinner inner makes the silhouette read as a
  // sword stroke trailing through air.
  shape.moveTo(-0.35, -0.02);
  shape.lineTo(-0.20, -0.18);
  shape.lineTo( 0.20, -0.18);
  shape.lineTo( 0.35, -0.02);
  shape.lineTo( 0.32,  0.02);
  shape.lineTo( 0.10, -0.06);
  shape.lineTo(-0.10, -0.06);
  shape.lineTo(-0.32,  0.02);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  // ExtrudeGeometry extrudes along +Z by default; we want the crescent
  // FACING the camera (+Z up in the world) so it reads from above.
  g.translate(0, 0, -0.0125);
  g.rotateX(-Math.PI / 2);   // lay flat with crescent in XZ
  return g;
}

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
  geometry: boneGeometry,
  orientToVelocity: true,
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
  geometry: arrowGeometry,
  orientToVelocity: true,
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
  geometry: arcaneBoltGeometry,
  orientToVelocity: true,
};

// Wave-slash — signature charged-sword release. Fast, big, bright
// orange-red — it announces itself across the room. Physical (this
// is the swing's force extending past the blade, not a spell).
export const WAVE_SLASH: ProjectileType = {
  id: 'wave-slash',
  radius: 0.30,
  speed: 14.0,
  lifetime: 1.4,
  damageType: 'physical',
  color: 0xff5a20,
  lightIntensity: 2.2,
  lightRange: 4.0,
  geometry: waveSlashGeometry,
  orientToVelocity: true,
};

export function registerProjectiles(): void {
  registerProjectileType(ACOLYTE_SPIT);
  registerProjectileType(ACID_SPIT);
  registerProjectileType(BONE_SHARD);
  registerProjectileType(CROSSBOW_BOLT);
  registerProjectileType(ARCANE_BOLT);
  registerProjectileType(WAVE_SLASH);
}
