import type { Vec3 } from '../ecs/model-types';
import type { DamageType } from '../combat/damage';
import type { EnemySpec } from './enemies';

// Enemy abilities — the data spine for "what an enemy does when it gets
// in range." Generalises the old hardcoded windup→strike→recover (which
// could only do "melee or, via an if-branch, a projectile") into a
// uniform runner: an Ability is a telegraphed phase sequence carrying
// one or more Effects. New behaviour = compose existing effects, or add
// ONE effect handler in enemy.ts — never a new branch in the AI tick.
//
// Phases (run by enemy.ts):
//   windup  — telegraph; the player's reaction window. Melee abilities
//             may CREEP toward the player here so a stationary target
//             still gets clipped.
//   strike  — effects fire. Instantaneous effects (melee hit, projectile
//             spawn) fire once; continuous effects (dash) run for the
//             whole strike duration.
//   recover — locked-out follow-through; cooldown starts at its end.
//
// Effects are a tagged union — same house style as StatModifier /
// PropCollision / PropFacing. Implemented today: melee, projectile,
// dash. Next to add (one handler each): aoe (zone denial), spawn
// (in-combat summon). Split-on-death stays a death trigger in the
// builder, not an ability.

export type AbilityEffect =
  // Melee — single contact hit at strike start if the player is within
  // `reach`. reach < the ability's maxRange makes the strike escapable
  // (back out during windup and it whiffs).
  | { kind: 'melee'; reach: number; damageType?: DamageType }
  // Projectile — spawn one bolt from `muzzle` (container-local) toward
  // the player at strike start. damageType comes from the ProjectileType.
  | { kind: 'projectile'; projectileId: string; muzzle: Vec3 }
  // Dash — MOVE the enemy for the whole strike phase, toward or away
  // from the player, dealing one contact hit when within `contactReach`.
  // This is how "attacks that move the enemy" (charge / lunge / leap)
  // are expressed: a long-ish strike phase + a dash effect.
  | { kind: 'dash'; speed: number; toward: 'player' | 'away'; contactReach: number; damageType?: DamageType }
  // AoE — a telegraphed ground zone. A ring marker appears during the
  // WINDUP at the locked target (the player's feet for 'player', the
  // enemy's own feet for 'self'); at strike, anyone still inside the
  // radius takes the hit. Teaches "don't stand there" — move off the
  // marker before it resolves. 'player' = a stomp where-you-were
  // (move out to dodge); 'self' = a radial slam (don't be adjacent).
  | { kind: 'aoe'; radius: number; targetMode: 'player' | 'self'; damageType?: DamageType };

export interface Ability {
  /** Unique within the enemy — keys the cooldown timer. */
  id: string;
  /** Distance band the AI will trigger this in. Below minRange or above
   *  maxRange the ability is not selected. Default minRange 0. */
  minRange?: number;
  maxRange: number;
  // Phase durations (seconds).
  windup: number;
  strike: number;
  recover: number;
  /** Lockout after the ability finishes before it can fire again.
   *  Default 0 (basic attacks chain freely). */
  cooldown?: number;
  /** Damage applied by melee/dash contact, or carried by the projectile. */
  damage: number;
  /** What happens during the strike phase. Usually one entry. */
  effects: AbilityEffect[];
  /** Drives the windup/strike pose flavour (see applyTelegraph in
   *  enemy.ts). swing = lean-back→slam, cast = subtle→hold, charge =
   *  coil-back→lunge. Default 'swing'. */
  telegraph?: 'swing' | 'cast' | 'charge';
  /** Melee abilities creep toward the player during windup so a
   *  stationary player still gets hit. Charges don't (the dash IS the
   *  approach). Default: true when any effect is melee, else false. */
  creep?: boolean;
}

/** The reach of the first melee effect, for windup-creep targeting.
 *  null if the ability has no melee effect. */
export function meleeReachOf(ability: Ability): number | null {
  for (const e of ability.effects) if (e.kind === 'melee') return e.reach;
  return null;
}

/** The first aoe effect on an ability, or null. The runner spawns its
 *  ground telegraph at windup start and resolves it at strike. */
export function aoeEffectOf(ability: Ability): Extract<AbilityEffect, { kind: 'aoe' }> | null {
  for (const e of ability.effects) if (e.kind === 'aoe') return e;
  return null;
}

/** Synthesize the default ability from an enemy's legacy flat fields.
 *  The legacy windupTime/strikeTime/recoverTime/attackRange/ranged
 *  fields are now SUGAR that compiles to one ability — so every enemy
 *  that doesn't declare `abilities` keeps working unchanged while the
 *  engine is fully ability-driven. */
export function defaultAbility(spec: EnemySpec): Ability {
  if (spec.ranged) {
    return {
      id: 'cast',
      minRange: 0,
      maxRange: spec.attackRange,
      windup: spec.windupTime,
      strike: spec.strikeTime,
      recover: spec.recoverTime,
      damage: spec.attackDamage,
      telegraph: 'cast',
      effects: [{ kind: 'projectile', projectileId: spec.ranged.projectileId, muzzle: spec.ranged.muzzleOffset }],
    };
  }
  return {
    id: 'strike',
    minRange: 0,
    maxRange: spec.attackRange,
    windup: spec.windupTime,
    strike: spec.strikeTime,
    recover: spec.recoverTime,
    damage: spec.attackDamage,
    telegraph: 'swing',
    creep: true,
    effects: [{ kind: 'melee', reach: spec.strikeRange, damageType: spec.damageType }],
  };
}

/** The enemy's abilities, highest-priority first. Explicit `spec.abilities`
 *  win; otherwise the legacy fields synthesize a single default. */
export function resolveAbilities(spec: EnemySpec): Ability[] {
  if (spec.abilities && spec.abilities.length > 0) return spec.abilities;
  return [defaultAbility(spec)];
}
