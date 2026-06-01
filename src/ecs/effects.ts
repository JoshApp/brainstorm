import type { EffectSpec, EntityId } from './types';
import { get } from './world';
import { applyBuff } from './buffs';
import { applyDamageVia } from '../combat/damage';

// applyEffect — the single code path through which entity state is mutated by
// any in-game cause (sword hit, buff tick, item proc, environmental damage).
// New effect types are added here; everything else stays the same.
//
// Target resolution lives ABOVE this layer (see ecs/triggers.ts): the trigger
// system reads each effect's `target` field ('self' | 'victim' | 'attacker'),
// resolves it against the trigger context, and passes the resolved id as
// ctx.defaultTarget. This module just acts on whatever id it's given.

interface EffectContext {
  /** Default target if effect doesn't override it. */
  defaultTarget: EntityId;
  /** Optional source of the effect — for damage attribution + kill credit.
   *  When an item's on-damaged retaliation hurts the attacker, the SOURCE
   *  is the player (you get credit for the kill, not the attacker for
   *  killing itself). */
  source?: EntityId;
}

export function applyEffect(effect: EffectSpec, ctx: EffectContext): void {
  const targetId = ctx.defaultTarget;
  const target = get(targetId);
  if (!target) return;

  switch (effect.type) {
    case 'damage': {
      if (!target.hp) return;
      const amt = effect.amount ?? 0;
      // Route through the damage SINK so armor / on-hit hooks / death
      // resolve correctly (drops, kill event, etc). Without this an
      // item proc that "deals 1 damage" would bypass enemy armor +
      // skip the kill pipeline. Damage type defaults to 'physical'
      // when the effect spec doesn't carry one.
      applyDamageVia({
        source: ctx.source ?? null,
        target: targetId,
        base: amt,
        type: 'physical',
      });
      break;
    }
    case 'heal': {
      if (!target.hp) return;
      const amt = effect.amount ?? 0;
      target.hp.current = Math.min(target.hp.base, target.hp.current + amt);
      break;
    }
    case 'apply-buff': {
      if (!effect.buffId) return;
      applyBuff(target, effect.buffId, effect.duration ?? 1, ctx.source);
      break;
    }
  }
}
