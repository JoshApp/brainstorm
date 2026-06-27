import * as THREE from 'three';
import type { WalkableRegion } from '../level/walkable';
import { groundYAt } from '../level/elevation';
import { damagePlayer } from '../player/health';
import { tryJustDodge } from './just-dodge';
import { applyDamageVia, type DamageType } from './damage';
import type { Damageable } from './damageable';
import { queryHurtbox, type Hurtbox } from './hurtbox';
import { spawnDamageNumber } from '../ui/damage-numbers';
import type { EntityId } from '../ecs/types';
import { applyBuff } from '../ecs/buffs';
import { get as getEntity } from '../ecs/world';
import { gameRngChance } from '../engine/rng';
import { registerWarmup } from '../content/warmup-registry';
import { CONFIG } from '../config';

// Scratch vector for the projectile impact point (zone resolution). Module-level
// so the hot tick loop allocates nothing.
const _hitPt = new THREE.Vector3();

/** On-hit status carried by a friendly projectile (player's weapon /
 *  affix / set on-hits). Rolled per enemy hit. */
type ProjectileOnHit = { buffId: string; chance: number; duration: number };

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
  /** Optional custom mesh geometry — authored at real-world size.
   *  Bones, arrows, etc. When set, mesh.scale is forced to 1
   *  (otherwise the type's radius doubles as visual scale of the
   *  default sphere). */
  geometry?: () => THREE.BufferGeometry;
  /** When true, the mesh is rotated each frame so its local -Z
   *  faces the direction of travel. Use with arrow / bone /
   *  spear-like geometries authored with the tip at local -Z. */
  orientToVelocity?: boolean;
}

const TYPES = new Map<string, ProjectileType>();
export function registerProjectileType(t: ProjectileType) {
  TYPES.set(t.id, t);
}

/** Whether a projectile id has been registered. Used by the content
 *  validator to catch typo'd `ranged.projectileId` references. Call
 *  after registerProjectiles() has run. */
export function isProjectileRegistered(id: string): boolean {
  return TYPES.has(id);
}

// Default shared sphere geometry — cheap, low-poly, used by spell bolts
// + spits where shape isn't important.
const SHARED_GEOM = new THREE.SphereGeometry(1, 10, 8);

// Soft radial glow texture for the trail sprite. Without a map a
// SpriteMaterial renders as a hard SQUARE quad — under additive blending
// that reads as an ugly bright box around every projectile (and clips
// visibly into god-ray planes). A white→transparent radial gradient turns
// the quad into a soft round halo: the dark edges add nothing under
// additive blend, so only the round core glows. Built once, shared.
let glowTexture: THREE.Texture | null = null;
function softGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

// Per-type geometry cache. Types that declare a geometry() factory get
// their own pre-built BufferGeometry (built lazily on first use) so
// arrows look like arrows and bones look like bones without paying per-
// instance allocation. Geometries are authored at INTENDED REAL-WORLD
// SIZE — when a type has its own geometry, the pool sets mesh.scale to
// 1 instead of scaling by type.radius (which only matters for hit-test
// then).
const geometriesByType = new Map<string, THREE.BufferGeometry>();
function geometryFor(type: ProjectileType): THREE.BufferGeometry {
  if (!type.geometry) return SHARED_GEOM;
  let g = geometriesByType.get(type.id);
  if (!g) {
    g = type.geometry();
    geometriesByType.set(type.id, g);
  }
  return g;
}

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
  /** FRIENDLY = fired by the player; hit-tests ENEMIES. Otherwise an
   *  enemy projectile that hit-tests the player. */
  friendly: boolean;
  /** On-hit statuses to roll when this (friendly) projectile strikes an
   *  enemy. Null for enemy projectiles / shots with no on-hit. */
  onHits: ReadonlyArray<ProjectileOnHit> | null;
  /** Crit roll for friendly shots — carried from the firing weapon so a bolt
   *  can crit (and a HEADSHOT adds the head zone's critBonus on top). 0 / 1
   *  for enemy shots (they never crit the player here). */
  critChance: number;
  critMultiplier: number;
  /** Stable id for the light pool registration. */
  lightId: string;
}

// Enemy list provider for friendly (player) projectile hit-tests. Set
// once (createCombatSystem) so tickProjectiles needn't take an extra
// arg — keeps the main-loop call site unchanged.
let enemyProvider: (() => readonly EnemyHittable[]) | null = null;
/** A target a friendly projectile can hit — the Enemy shape subset we need. */
export interface EnemyHittable {
  entityId: EntityId;
  position: THREE.Vector3;
  alive: boolean;
  aimHeight: number;
  /** Hurt zones (body/head/weak/armor) so a bolt resolves WHERE it hit and
   *  applies the same locational damage as a melee swing. */
  hurtbox: Hurtbox;
}
export function setProjectileEnemyProvider(fn: () => readonly EnemyHittable[]): void {
  enemyProvider = fn;
}

// Destructible (vase / crate / urn) provider — friendly projectiles smash
// them like a melee hit. Mirrors the enemy provider; set once in
// createCombatSystem. A Destructible IS a Damageable.
let destructibleProvider: (() => readonly Damageable[]) | null = null;
export function setProjectileDestructibleProvider(fn: () => readonly Damageable[]): void {
  destructibleProvider = fn;
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
      map: softGlowTexture(),
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
      friendly: false,
      onHits: null,
      critChance: 0,
      critMultiplier: 1,
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
  /** True = player projectile (hits enemies). Default false (enemy → player). */
  friendly?: boolean;
  /** On-hit statuses to roll on the struck enemy (friendly shots). */
  onHits?: ReadonlyArray<ProjectileOnHit>;
  /** Crit roll from the firing weapon (friendly shots). Default 0 / 1. */
  critChance?: number;
  critMultiplier?: number;
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
  slot.friendly = args.friendly ?? false;
  slot.onHits = args.onHits ?? null;
  slot.critChance = args.critChance ?? 0;
  slot.critMultiplier = args.critMultiplier ?? 1;
  slot.remaining = type.lifetime;
  slot.position.copy(args.origin);
  // Velocity = unit (target - origin) × speed.
  slot.velocity.copy(args.target).sub(args.origin).normalize().multiplyScalar(type.speed);

  // Mesh visuals. Custom geometries are authored at real-world size
  // so they get scale=1; the default sphere is unit-radius and uses
  // type.radius as a uniform scale.
  slot.mesh.material = materialFor(type);
  slot.mesh.geometry = geometryFor(type);
  slot.mesh.position.copy(args.origin);
  slot.mesh.scale.setScalar(type.geometry ? 1 : type.radius);
  slot.mesh.visible = true;

  // Trail — colored match, slightly larger than the core. Stretches a
  // bit along the velocity direction for "tracer" feel.
  const trailMat = slot.trail.material as THREE.SpriteMaterial;
  trailMat.color.setHex(type.color);
  slot.trail.position.copy(args.origin);
  slot.trail.scale.set(type.radius * 4, type.radius * 4, 1);
  slot.trail.visible = true;

  // Projectiles do NOT register a scene light — the emissive mesh + trail already
  // read as "glowing", and pooling a light per in-flight projectile churned the light
  // pool (6 parked 'projectile-*' slots co-located at the park point) for no visual
  // gain. (The lit-environment glow was noise against the dread-light grammar anyway.)
  void nextSerial;
}

function retire(slot: Slot): void {
  slot.inUse = false;
  slot.mesh.visible = false;
  slot.trail.visible = false;
  slot.onHits = null;
  slot.position.set(0, -1000, 0);
}

/** Tick every active projectile: integrate, hit-test player, hit-test
 *  walls. Called from the main loop per frame. */
export function tickProjectiles(
  dt: number,
  playerPos: THREE.Vector3,
  walkable: WalkableRegion,
  camera: THREE.Camera,
): void {
  for (const slot of pool) {
    if (!slot.inUse || !slot.type) continue;
    // Integrate position.
    slot.position.addScaledVector(slot.velocity, dt);
    slot.mesh.position.copy(slot.position);
    slot.trail.position.copy(slot.position);
    // Orient elongated geometries (arrow / bone) along the velocity
    // direction so they read as flying tip-first instead of always
    // pointing world-forward.
    if (slot.type.orientToVelocity) {
      slot.mesh.lookAt(
        slot.position.x + slot.velocity.x,
        slot.position.y + slot.velocity.y,
        slot.position.z + slot.velocity.z,
      );
    }
    slot.remaining -= dt;

    if (slot.friendly) {
      // Player projectile — hit-test ENEMIES (nearest within radius).
      // Routes through applyDamageVia so the enemy's death (drops, kill
      // credit) resolves like a melee hit.
      const enemies = enemyProvider?.() ?? [];
      let hit = false;
      for (const e of enemies) {
        if (!e.alive) continue;
        const ex = slot.position.x - e.position.x;
        const ez = slot.position.z - e.position.z;
        const ey = slot.position.y - (e.position.y + e.aimHeight);
        if (ex * ex + ez * ez < HIT_RADIUS_SQ && Math.abs(ey) < 1.4) {
          // Resolve WHICH hurt-zone the bolt struck (head / weak / armor /
          // body) and apply the same locational rules as a melee swing:
          // damage ×zoneMul, head/weak can crit (head adds its critBonus to
          // the roll, a weak point forces it). Before this, projectiles
          // ignored zones entirely — ranged headshots did flat body damage.
          _hitPt.copy(slot.position);
          const zh = queryHurtbox(e.hurtbox, _hitPt, _hitPt, slot.type.radius);
          const zoneMul = zh?.damageMul ?? 1;
          const crit = (zh?.crit ?? false) || gameRngChance(slot.critChance + (zh?.critBonus ?? 0));
          const base = slot.damage * zoneMul * (crit ? slot.critMultiplier : 1);
          const applied = applyDamageVia({ source: slot.source, target: e.entityId, base, type: slot.type.damageType });
          // Floating number so ranged hits READ — head/weak land as crits
          // (bigger, gold), making the headshot a visible, rewarding feature.
          if (applied > 0) spawnDamageNumber(camera, _hitPt, applied, crit);
          // Roll the bolt's on-hit statuses against the struck enemy —
          // same rules as a melee landed hit (wand chill, on-hit affixes,
          // set on-hits). Applied before retire() (which clears onHits).
          if (slot.onHits) {
            const ent = getEntity(e.entityId);
            if (ent) {
              for (const oh of slot.onHits) {
                if (gameRngChance(oh.chance)) applyBuff(ent, oh.buffId, oh.duration, 'player');
              }
            }
          }
          retire(slot);
          hit = true;
          break;
        }
      }
      // Smash vases / crates the bolt flies INTO — but HEIGHT-GATED so a
      // chest-height shot still sails OVER a low prop to the enemy behind
      // it (the over-fly fix). Only a bolt down at the prop's low body
      // breaks it. The destructible's own takeDamage handles shatter+drops.
      if (!hit && destructibleProvider) {
        for (const d of destructibleProvider()) {
          if (!d.alive) continue;
          const dx = slot.position.x - d.position.x;
          const dz = slot.position.z - d.position.z;
          const rr = (d.hitRadius ?? 0.4) + slot.type.radius;
          // Height gate is the bolt's rise ABOVE THE PROP'S BASE (d.position.y
          // ground-follows), not world Y — else on a sunken floor the bolt's
          // negative world Y always passed and over-smashed low props.
          if (dx * dx + dz * dz < rr * rr && slot.position.y - d.position.y <= d.aimHeight * 2 + 0.25) {
            d.takeDamage({ source: slot.source, target: d.entityId, base: slot.damage, type: slot.type.damageType });
            retire(slot);
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
    } else {
      // Enemy projectile — hit-test the player as a 3D CAPSULE on the body,
      // not the old flat cylinder × wide vertical band. Closest point on the
      // body axis (vertical segment at the player's xz, from capsule bottom to
      // top) to the projectile, then a true 3D distance. A shot sailing over
      // the head or skimming the floor now MISSES; chest/torso shots connect.
      // The capsule constants are heights ABOVE THE PLAYER'S FEET, not
      // world Y — offset by the ground under the player so a shot connects
      // on a sunken floor. Without this the window stayed pinned to world
      // [0.45, 1.75] while the player stood at e.g. -2m, and every enemy
      // bolt missed (ranged foes went harmless wherever the floor dropped).
      const feetY = groundYAt(playerPos.x, playerPos.z);
      const cy = Math.max(
        feetY + CONFIG.PLAYER_HIT_CAPSULE_BOTTOM_Y,
        Math.min(feetY + CONFIG.PLAYER_HIT_CAPSULE_TOP_Y, slot.position.y),
      );
      const dx = slot.position.x - playerPos.x;
      const dy = slot.position.y - cy;
      const dz = slot.position.z - playerPos.z;
      const r = CONFIG.PLAYER_HIT_CAPSULE_RADIUS + slot.type.radius;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < r * r) {
        // PERFECT DODGE vs a bolt — the ranged answer, mirroring melee. A
        // precisely-timed roll (within the perfect window of this hit) i-frames
        // the shot AND pays the just-dodge reward: it passes through you as you
        // roll. A merely-early roll still negates via i-frames in damagePlayer
        // (survives, no bonus).
        if (tryJustDodge()) { retire(slot); continue; }
        damagePlayer(slot.damage, slot.source, slot.type.damageType);
        retire(slot);
        continue;
      }
      // NEAR-MISS perfect dodge — a bolt that whizzed JUST past during a precise
      // roll still reads as a dodge (without this, rolling clear of the line
      // means the reward almost never fires). Reward once (tryJustDodge consumes
      // the roll); the shot genuinely missed, so let it fly on.
      const near = r + CONFIG.JUST_DODGE.PROJECTILE_GRACE;
      if (distSq < near * near) tryJustDodge();
    }

    // Wall hit — HEIGHT-AWARE: containsProjectile lets a shot fly OVER a
    // low prop (vase, altar, chest — anything with an obstacle `height`)
    // at the bolt's current y, while full-height blockers (walls, pillars,
    // height-less obstacles) still stop it. (Was the 2D contains(), which
    // killed every shot on a waist-high vase's footprint — the playtest
    // "shot eaten by a small vase" bug.) The fog-gate curtain is a
    // separate projectile-only barrier (blocks even while open for
    // walking), so a shot can't cross the mist either way.
    if (
      !walkable.containsProjectile(slot.position.x, slot.position.z, slot.type.radius, slot.position.y) ||
      walkable.projectileBlocked(slot.position.x, slot.position.z, slot.type.radius)
    ) {
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

// Warm every registered projectile type's material at load: spawn one of each
// just in front of the warmup camera so the render compiles it. Without this the
// FIRST shot in combat (a skeleton's bone-throw, an acolyte's spit) compiles the
// projectile shader in-frame — a ~290ms freeze seen in a combat recording. Safe:
// spawn() only sets pool slot fields (no providers/ticks), and clear() retires.
const _warmO = new THREE.Vector3();
registerWarmup({
  label: 'projectiles',
  spawn: (scene) => {
    scene.getWorldPosition(_warmO);
    for (const id of TYPES.keys()) {
      spawnProjectile({
        typeId: id,
        origin: _warmO.clone().add(new THREE.Vector3(0, 0, -1)),
        target: _warmO.clone().add(new THREE.Vector3(0, 0, -3)),
        damage: 0, source: null,
      });
    }
  },
  clear: clearProjectiles,
});
