import type { Entity, TriggerEvent } from './types';
import { applyEffect } from './effects';
import { on as onGameEvent } from '../broadcast/event-bus';
import { get } from './world';

// Trigger firing — when the in-world event bus emits something, walk all
// passives on the relevant entity (currently the player) and fire any whose
// trigger matches the event.
//
// This is the bridge between the existing event bus (broadcast/event-bus.ts,
// already used by achievements) and the new effects/buffs/world layer.

function fireTriggers(entity: Entity | undefined, event: TriggerEvent) {
  if (!entity) return;
  for (const passive of entity.passives) {
    if (passive.trigger.on !== event) continue;
    const chance = passive.trigger.chance ?? 1;
    if (chance < 1 && Math.random() > chance) continue;
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
