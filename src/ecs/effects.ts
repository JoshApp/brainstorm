import type { EffectSpec, EntityId } from './types';
import { get } from './world';
import { applyBuff } from './buffs';

// applyEffect — the single code path through which entity state is mutated by
// any in-game cause (sword hit, buff tick, item proc, environmental damage).
// New effect types are added here; everything else stays the same.

interface EffectContext {
  /** Default target if effect doesn't override it. */
  defaultTarget: EntityId;
  /** Optional source of the effect (used for "damage source", attribution). */
  source?: EntityId;
}

export function applyEffect(effect: EffectSpec, ctx: EffectContext): void {
  // For now all targets are 'self' (the buff owner / the explicit target).
  // 'victim' / 'attacker' resolution happens in fireTrigger() where context
  // has more info.
  const targetId = ctx.defaultTarget;
  const target = get(targetId);
  if (!target) return;

  switch (effect.type) {
    case 'damage': {
      if (!target.hp) return;
      const amt = effect.amount ?? 0;
      target.hp.current = Math.max(0, target.hp.current - amt);
      // Note: this is the LOW-LEVEL hp mutation. Trigger firing for
      // "damaged"/"died" events is handled by the caller (currently in
      // health.ts / enemy.ts wrappers that translate damage events into the
      // crunch stack + broadcast events).
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
      applyBuff(target, effect.buffId, effect.duration ?? 1);
      break;
    }
  }
}
