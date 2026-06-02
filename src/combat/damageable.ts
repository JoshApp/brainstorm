import type * as THREE from 'three';
import type { EntityId } from '../ecs/types';
import type { DamageEvent } from './damage';

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
  hitFeedback: HitFeedback;
  /** Route a damage event through the pipeline, apply it to HP, return the
   *  amount actually applied (for the floating number). */
  takeDamage(event: DamageEvent): number;
}
