import type { Entity, TriggerEvent } from './types';
import { applyEffect } from './effects';
import { on as onGameEvent } from '../broadcast/event-bus';
import { get } from './world';
import { aggregatePassives } from '../combat/modifiers';
import { gameRng } from '../engine/rng';

// Trigger firing — when the in-world event bus emits something, walk every
// active passive on the relevant entity (intrinsic + equipment-granted)
// and fire any whose trigger matches the event.
//
// Bridge between the event bus (broadcast/event-bus.ts) and the effects /
// buffs / world layer. Equipment-granted passives are pulled live via
// aggregatePassives — equipping a Ring of Bloodthirst gives the player
// its on-kill effect for as long as it's worn; unequipping removes it.

function fireTriggers(entity: Entity | undefined, event: TriggerEvent) {
  if (!entity) return;
  for (const passive of aggregatePassives(entity.id)) {
    if (passive.trigger.on !== event) continue;
    const chance = passive.trigger.chance ?? 1;
    if (chance < 1 && gameRng() > chance) continue;
    for (const effect of passive.trigger.effects) {
      applyEffect(effect, { defaultTarget: entity.id });
    }
  }
}

/** Wire the existing event bus to fire passive triggers on the player entity. */
export function initTriggerListener(playerEntityId: string) {
  onGameEvent((event) => {
    const player = get(playerEntityId);
    switch (event.type) {
      case 'attack:hit':
        fireTriggers(player, 'hit');
        break;
      case 'enemy:killed':
        fireTriggers(player, 'killed');
        break;
      case 'player:damaged':
        fireTriggers(player, 'damaged');
        break;
      case 'player:killed':
        fireTriggers(player, 'died');
        break;
    }
  });
}
