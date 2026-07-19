import type { Entity, EntityId, TriggerEvent } from './types';
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

interface TriggerContext {
  /** Entity that the passive lives on (player today). */
  ownerId: EntityId;
  /** Entity that was hit BY the owner (filled for 'hit' / 'killed'). */
  victimId?: EntityId;
  /** Entity that hit the owner (filled for 'damaged' / 'died'). */
  attackerId?: EntityId;
  /** Status ids live on the victim at the event ('killed': snapshot taken at
   *  death, since the entity is destroyed before subscribers run). Gates
   *  TriggerSpec.condition.victimHasBuff — the bleeding-kill payoff shape. */
  victimBuffs?: readonly string[];
}

function fireTriggers(entity: Entity | undefined, event: TriggerEvent, ctx: Partial<TriggerContext> = {}) {
  if (!entity) return;
  const triggerCtx: TriggerContext = { ownerId: entity.id, ...ctx };
  for (const passive of aggregatePassives(entity.id)) {
    if (passive.trigger.on !== event) continue;
    // Context gate BEFORE the chance roll — an ineligible event never consumes
    // luck. victimHasBuff with no victim context simply never fires.
    const cond = passive.trigger.condition;
    if (cond?.victimHasBuff && !triggerCtx.victimBuffs?.includes(cond.victimHasBuff)) continue;
    const chance = passive.trigger.chance ?? 1;
    if (chance < 1 && gameRng() > chance) continue;
    for (const effect of passive.trigger.effects) {
      // Resolve the effect's target: 'self' (or unspecified) → owner;
      // 'attacker' → whoever hit us (for damaged/died); 'victim' →
      // whoever we hit (for hit/killed). If the requested role isn't
      // populated for this trigger event, fall back to the owner.
      let targetId = triggerCtx.ownerId;
      if (effect.target === 'attacker' && triggerCtx.attackerId) targetId = triggerCtx.attackerId;
      else if (effect.target === 'victim' && triggerCtx.victimId)   targetId = triggerCtx.victimId;
      applyEffect(effect, { defaultTarget: targetId, source: triggerCtx.ownerId });
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
        // A crit fires 'crit' IN ADDITION to 'hit' — so a card/relic can proc on
        // the big strikes specifically (the dagger build's payoff). These are
        // self-targeted (fury) procs; on-hit HEXES that land on the struck enemy
        // go through the victim-aware on-hit channel (getPlayerOnHits), not here.
        if (event.crit) fireTriggers(player, 'crit');
        break;
      case 'enemy:killed':
        fireTriggers(player, 'killed', { victimBuffs: event.victimBuffs });
        break;
      // ── Tempo lane (skill beats as item hooks) ──
      case 'player:deflected':
        fireTriggers(player, 'deflect');
        break;
      case 'player:just-dodged':
        fireTriggers(player, 'just-dodge');
        break;
      // ── Economy lane (the deep's ledger as item hooks) ──
      case 'gold:absorbed':
        fireTriggers(player, 'gold');
        break;
      case 'chest:opened':
        fireTriggers(player, 'chest');
        break;
      case 'transaction:accepted':
        fireTriggers(player, 'deal');
        break;
      case 'player:damaged':
        // The damage event carries the attacker so 'target: attacker'
        // effects (chill-on-hit, thorns) resolve correctly. Without
        // an attacker (DoT tick, environmental) the effect falls back
        // to targeting self.
        fireTriggers(player, 'damaged', { attackerId: event.attacker });
        break;
      case 'player:killed':
        fireTriggers(player, 'died');
        break;
    }
  });
}
