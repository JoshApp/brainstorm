import * as THREE from 'three';
import type { WalkableRegion } from '../level/walkable';
import { damagePlayer } from '../player/health';
import { registerLight, unregisterLight } from '../scene/light-pool';
import type { DamageType } from './damage';
import type { EntityId } from '../ecs/types';

// Projectile pool. Same pattern as the light pool: a fixed budget of
// pre-allocated mesh + light slots. Spawning a projectile rents from
// the pool; expiry / hit / wall-strike returns the slot. The scene
// never sees a varying number of projectile meshes → no GC churn, no
// shader recompiles from light count changes.
//
// All projectiles share a single emissive material per ProjectileType
// (one MeshBasicMaterial per type), so material count stays flat.
//
// Used by ranged enemies (currently the acolyte spitter); future
// hooks: thrown potions, spells, traps that fire darts.

export interface ProjectileType {
  /** Registry id. */
  id: string;
  /** Sphere radius in metres. */
  radius: number;
  /** Travel speed m/s. */
  speed: number;
  /** Max lifetime in seconds before auto-retire. */
  lifetime: number;
  /** Damage type — feeds into the player's armor check. */
  damageType: DamageType;
  /** Emissive color of the projectile mesh + glow light. */
  color: number;
  /** PointLight intensity carried by the projectile. */
  lightIntensity: number;
  /** PointLight range. */
  lightRange: number;
}

const TYPES = new Map<string, ProjectileType>();
export function registerProjectileType(t: ProjectileType) {
  TYPES.set(t.id, t);
}

// Single shared sphere geometry across all projectiles — cheap, low-poly.
const SHARED_GEOM = new THREE.SphereGeometry(1, 10, 8);
// Per-type emissive material so colors stay distinct without per-instance
// material allocation.
const materialsByType = new Map<string, THREE.MeshBasicMaterial>();
function materialFor(type: ProjectileType): THREE.MeshBasicMaterial {
  const existing = materialsByType.get(type.id);
  if (existing) return existing;
  const mat = new THREE.MeshBasicMaterial({
    color: type.color,
    transparent: true,
    opacity: 0.95,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materialsByType.set(type.id, mat);
  return mat;
}

interface Slot {
  inUse: boolean;
  mesh: THREE.Mesh;
  /** Trail sprite poking behind the projectile core. Sells motion. */
  trail: THREE.Sprite;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  type: ProjectileType | null;
  damage: number;
  source: EntityId | null;
  remaining: number;
  /** Stable id for the light pool registration. */
  lightId: string;
}

const POOL_SIZE = 16;
const HIT_RADIUS = 0.4;   // generous — projectiles aren't precision tests
const HIT_RADIUS_SQ = HIT_RADIUS * HIT_RADIUS;

const pool: Slot[] = [];
let scene: THREE.Scene | null = null;
let nextSerial = 0;

/** Pre-allocate the pool. Call once at boot, after the scene exists. */
export function initProjectilePool(sc: THREE.Scene): void {
  if (pool.length > 0) return;
  scene = sc;
  for (let i = 0; i < POOL_SIZE; i++) {
    // Mesh — unit sphere scaled per-projectile via the type's radius.
    const mesh = new THREE.Mesh(SHARED_GEOM, undefined as unknown as THREE.Material);
    mesh.visible = false;
    sc.add(mesh);
    // Trail — additive sprite, scales with travel direction below.
    const trailMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      fog: false,
      depthWrite: false,
    });
    const trail = new THREE.Sprite(trailMat);
    trail.visible = false;
    sc.add(trail);
    pool.push({
      inUse: false,
      mesh,
      trail,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      type: null,
      damage: 0,
      source: null,
      remaining: 0,
      lightId: `projectile-${i}`,
    });
  }
}

export interface SpawnArgs {
  typeId: string;
  origin: THREE.Vector3;
  /** Target position — direction is computed origin → target. */
  target: THREE.Vector3;
  damage: number;
  source: EntityId | null;
}

/** Rent a slot + fire. No-op if the pool is full (rare; 16 is generous). */
export function spawnProjectile(args: SpawnArgs): void {
  const type = TYPES.get(args.typeId);
  if (!type) return;
  const slot = pool.find(p => !p.inUse);
  if (!slot) return;
  slot.inUse = true;
  slot.type = type;
  slot.damage = args.damage;
  slot.source = args.source;
  slot.remaining = type.lifetime;
  slot.position.copy(args.origin);
  // Velocity = unit (target - origin) × speed.
  slot.velocity.copy(args.target).sub(args.origin).normalize().multiplyScalar(type.speed);

  // Mesh visuals.
  slot.mesh.material = materialFor(type);
  slot.mesh.position.copy(args.origin);
  slot.mesh.scale.setScalar(type.radius);
  slot.mesh.visible = true;

  // Trail — colored match, slightly larger than the core. Stretches a
  // bit along the velocity direction for "tracer" feel.
  const trailMat = slot.trail.material as THREE.SpriteMaterial;
  trailMat.color.setHex(type.color);
  slot.trail.position.copy(args.origin);
  slot.trail.scale.set(type.radius * 4, type.radius * 4, 1);
  slot.trail.visible = true;

  // Light registration — projectile category. Position is a reference;
  // mutating each tick is enough for the pool to update.
  registerLight({
    id: slot.lightId,
    category: 'projectile',
    position: slot.position,
    color: type.color,
    intensity: type.lightIntensity,
    distance: type.lightRange,
    decay: 1.6,
  });
  // Unused — kept available for serial-debug ids if needed later.
  void nextSerial;
}

function retire(slot: Slot): void {
  slot.inUse = false;
  slot.mesh.visible = false;
  slot.trail.visible = false;
  unregisterLight(slot.lightId);
  slot.position.set(0, -1000, 0);
}

/** Tick every active projectile: integrate, hit-test player, hit-test
 *  walls. Called from the main loop per frame. */
export function tickProjectiles(
  dt: number,
  playerPos: THREE.Vector3,
  walkable: WalkableRegion,
): void {
  for (const slot of pool) {
    if (!slot.inUse || !slot.type) continue;
    // Integrate position.
    slot.position.addScaledVector(slot.velocity, dt);
    slot.mesh.position.copy(slot.position);
    slot.trail.position.copy(slot.position);
    slot.remaining -= dt;

    // Player hit — XZ distance check; vertical alignment loose so a
    // chest-height projectile still hits the player even though the
    // camera is at eye level.
    const dx = slot.position.x - playerPos.x;
    const dz = slot.position.z - playerPos.z;
    const dy = slot.position.y - playerPos.y;
    if (dx * dx + dz * dz < HIT_RADIUS_SQ && Math.abs(dy) < 1.2) {
      damagePlayer(slot.damage, slot.source, slot.type.damageType);
      retire(slot);
      continue;
    }

    // Wall hit — walkable.contains uses a small radius so a projectile
    // doesn't phase through corners.
    if (!walkable.contains(slot.position.x, slot.position.z, slot.type.radius)) {
      retire(slot);
      continue;
    }

    // Lifetime expiry.
    if (slot.remaining <= 0) retire(slot);
  }
}

export function getActiveProjectileCount(): number {
  let n = 0;
  for (const s of pool) if (s.inUse) n++;
  return n;
}

/** Retire every active projectile. Called by the level loader before a
 *  descent so in-flight shots from the previous floor don't carry into
 *  the new walkable region. */
export function clearProjectiles(): void {
  for (const slot of pool) if (slot.inUse) retire(slot);
}
