import type { ActiveBuff, Entity } from './types';
import { BUFFS } from '../content/buffs';
import { applyEffect } from './effects';
import { all } from './world';

// Buff lifecycle:
// - applyBuff() adds a new ActiveBuff to an entity (or refreshes an existing one
//   if already active — refresh takes the longer of remaining vs new duration).
// - tickAllBuffs() runs each frame; for each active buff, advances its
//   tickAccumulator and fires tickEffect when an interval elapses, then decays
//   remaining time, then removes expired buffs.

export function applyBuff(entity: Entity, buffId: string, duration: number) {
  const spec = BUFFS[buffId];
  if (!spec) return;

  const existing = entity.buffs.find((b) => b.specId === buffId);
  if (existing) {
    // Refresh — take the longer duration so re-applying doesn't shorten a buff.
    if (duration > existing.remaining) existing.remaining = duration;
    return;
  }

  const fresh: ActiveBuff = {
    specId: buffId,
    remaining: duration,
    tickAccumulator: 0,
    stacks: 1,
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
        applyEffect(spec.tickEffect, { defaultTarget: entity.id });
      }
    }

    buff.remaining -= dt;
    if (buff.remaining > 0) surviving.push(buff);
  }
  entity.buffs = surviving;
}
