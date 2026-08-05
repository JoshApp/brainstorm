import type * as THREE from 'three';
import type { EntityId } from '../ecs/types';
import type { DamageEvent } from './damage';
import type { HitMaterial } from '../audio/sfx';
import type { Hurtbox } from './hurtbox';

// Shared contract for anything a swing can connect with. Enemies and
// destructible props both implement it, so the combat system runs ONE
// cone scan + ONE hit-resolution path over a uniform shape instead of a
// branch per target type. Both are real ECS entities (entityId resolves
// in ecs/world), so the damage pipeline + buffs + future DoT/AoE effects
// pick them up identically — a vase is just an entity with no AI and 0
// armor.

/** How heavy a hit on this target should FEEL. Drives crunch intensity
 *  (hit-pause / shake / haptic) and whether the hit fires the player's
 *  on-hit passives. Mobs are 'heavy'; clutter (vases) is 'light' — you
 *  shouldn't lifesteal off an urn. */
export type HitFeedback = 'heavy' | 'light';

export interface Damageable {
  entityId: EntityId;
  /** World-space centre. Live reference (aliases the mesh position) so the
   *  cone scan reads the current location without a copy. */
  position: THREE.Vector3;
  /** Height above position.y the swing aims at — also where the floating
   *  damage number spawns from. */
  aimHeight: number;
  alive: boolean;
  collisionRadius: number;
  /** Radius around `position` (at aimHeight) that a swing's reach extends
   *  to — so a BIG enemy is hittable at its surface, not only its exact
   *  centre point. The reach test becomes `distanceToCentre - hitRadius <=
   *  reach`. Default 0 (a point target — current behaviour for normal
   *  mobs + props, which are small enough that the centre point is fine). */
  hitRadius?: number;
  /** Locational hit volumes the swing resolver tests against — at minimum a
   *  body zone. Enemies derive body+head (+authored weak/armor); props build a
   *  single body zone. ONE hit path for everything. See src/combat/hurtbox.ts. */
  hurtbox: Hurtbox;
  /** True when a finisher should trigger on the next heavy hit — staggered or
   *  low-HP (see CONFIG.EXECUTE). Enemies implement it; props leave it unset. */
  executable?: boolean;
  hitFeedback: HitFeedback;
  /** Surface material for the per-hit sound voice — see sfx.playSurfaceHit.
   *  Optional and meaningful only on LIGHT targets (props): a vase rings as
   *  ceramic, a chest as wood. Enemies leave this unset and continue to use
   *  the fleshy playImpact thump (different audio category — bone/meat, not
   *  surface contact). Light targets without a value also fall back to
   *  playImpact so a stray destructible doesn't go silent. */
  hitMaterial?: HitMaterial;
  /** How much this target BLEEDS (gore splash scale). 1 = full flesh;
   *  0 = bloodless — REQUIRED 0 for ceramic/wood destructibles, which
   *  otherwise inherit the fleshy default and spray blood when smashed.
   *  Mirrors EnemySpec.bloodAmount for mobs. */
  bloodAmount?: number;
  /** Species blood tint for splats/splashes (see EnemySpec.bloodColor). */
  bloodColor?: number;
  /** Route a damage event through the pipeline, apply it to HP, return the
   *  amount actually applied (for the floating number). */
  takeDamage(event: DamageEvent): number;
  /** Chip this target's poise; breaking it staggers (interrupts) the
   *  target. Optional — enemies implement it, clutter (vases) doesn't,
   *  so the combat cone calls it conditionally on heavy hits. Returns true if
   *  THIS hit broke the poise (triggered the stagger) — drives the player-side
   *  "STAGGERED" feedback in attack.ts. */
  applyStaggerDamage?(amount: number): boolean;
  /** Body yaw in radians, where FORWARD is (−sin yaw, −cos yaw) — Three's −Z
   *  forward turned by the yaw. The swing resolver uses it to tell a blow to the
   *  BACK from one to the flank. Enemies implement it; a vase has no front. */
  facingYaw?: number;
  /** The target's own verdict that it cannot answer a blow from behind — it has
   *  not noticed the attacker, or its nerve is broken. Left to the target
   *  because "can I answer this" is a question only it can answer; the combat
   *  layer supplies the geometry and nothing else. See CONFIG.BACKSTAB. */
  openToBackstab?: boolean;
  /** Impose FEAR for `seconds`. Returns true if it took. Optional — only living
   *  things have nerve to break. See CONFIG.ENEMY_AI.FEAR. */
  applyFear?(seconds: number): boolean;
}
