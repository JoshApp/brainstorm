import type { ActiveBuff, Entity, EntityId } from './types';
import { BUFFS } from '../content/buffs';
import { applyEffect } from './effects';
import { all } from './world';
import { applyDamageVia } from '../combat/damage';
import { loreAfflictionDurationMul, loreAfflictionPotencyMul } from '../state/character';

// Buff lifecycle:
// - applyBuff() adds a new ActiveBuff (or, for an already-active buff,
//   refreshes its duration and — if maxStacks > 1 — adds a stack).
// - tickAllBuffs() runs each frame; for each active buff, advances its
//   tickAccumulator and fires tickEffect when an interval elapses, then decays
//   remaining time, then removes expired buffs. DoT ticks (a 'damage'
//   tickEffect) route through the damage SINK so the death sequence
//   (drops, kill event, player death) resolves — a poison kill counts.

export function applyBuff(entity: Entity, buffId: string, duration: number, sourceId?: EntityId) {
  const spec = BUFFS[buffId];
  if (!spec) return;
  const maxStacks = spec.maxStacks ?? 1;

  // Lore SIGNATURE — the player's afflictions (DoT statuses) last
  // longer. Scoped to player-sourced damaging-tick buffs so it never
  // touches self-buffs (berserk/regen) or enemy-applied statuses.
  if (sourceId === 'player' && spec.tickEffect?.type === 'damage') {
    duration *= loreAfflictionDurationMul();
  }

  const existing = entity.buffs.find((b) => b.specId === buffId);
  if (existing) {
    // Refresh — take the longer duration so re-applying doesn't shorten it.
    if (duration > existing.remaining) existing.remaining = duration;
    // Stack up to the cap (poison/bleed ramp; refresh-only buffs cap at 1).
    if (existing.stacks < maxStacks) existing.stacks += 1;
    existing.sourceId = sourceId;   // freshest applier gets kill credit
    return;
  }

  const fresh: ActiveBuff = {
    specId: buffId,
    remaining: duration,
    tickAccumulator: 0,
    stacks: 1,
    sourceId,
  };
  entity.buffs.push(fresh);
}

export function tickAllBuffs(dt: number) {
  for (const entity of all()) {
    if (entity.buffs.length === 0) continue;
    tickEntityBuffs(entity, dt);
  }
}

function tickEntityBuffs(entity: Entity, dt: number) {
  const surviving: ActiveBuff[] = [];
  for (const buff of entity.buffs) {
    const spec = BUFFS[buff.specId];
    if (!spec) continue;

    if (spec.tickInterval && spec.tickEffect) {
      buff.tickAccumulator += dt;
      while (buff.tickAccumulator >= spec.tickInterval) {
        buff.tickAccumulator -= spec.tickInterval;
        const eff = spec.tickEffect;
        if (eff.type === 'damage') {
          // DoT — scale by stacks + route through the damage sink so a
          // kill resolves drops/credit (and a quiet path for the player).
          // Lore SIGNATURE: a player-sourced affliction ticks harder.
          let base = (eff.amount ?? 0) * buff.stacks;
          if (buff.sourceId === 'player') base *= loreAfflictionPotencyMul();
          applyDamageVia({
            source: buff.sourceId ?? null,
            target: entity.id,
            base,
            type: eff.damageType ?? 'physical',
          });
        } else {
          applyEffect(eff, { defaultTarget: entity.id });
        }
      }
    }

    buff.remaining -= dt;
    if (buff.remaining > 0) surviving.push(buff);
  }
  entity.buffs = surviving;
}
