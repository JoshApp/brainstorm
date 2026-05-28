import { CONFIG } from '../config';
import type { EntityId, PassiveSpec } from '../ecs/types';
import { get } from '../ecs/world';
import { getEquipment, aggregateAffixModifiers } from '../player/equipment';
import { BUFFS } from '../content/buffs';
import { getCharacter } from '../state/character';

// Central stat-modifier abstraction.
//
// Anything that wants to change an entity's stats — equipped items, active
// buffs, future floor blessings, character-level passives, you name it —
// produces ONE thing: a list of StatModifier records. There's exactly one
// aggregator (this module) that walks every source and sums them into the
// structured stats that the damage pipeline / HP code consumes.
//
// Why: adding a new source of effects (a Berserk buff, a Bloodthirst proc,
// a "while-below-50%-HP" passive) is a new producer of StatModifier records
// — never a fork in the math. Removing a buff or unequipping an item makes
// its modifiers vanish next time computeStats() is called. No bookkeeping,
// no "subtract this when the buff expires" — the stat IS whatever the
// current sources say it is.

export type StatModifier =
  | { kind: 'max-hp';            amount: number }    // flat add to maximum HP
  | { kind: 'weapon-damage';     amount: number }    // flat add to outgoing damage
  | { kind: 'damage-multiplier'; amount: number }    // multiplicative on outgoing (1.5 = +50%)
  | { kind: 'physical-armor';    amount: number }    // flat reduction to incoming physical
  | { kind: 'magic-armor';       amount: number }    // flat reduction to incoming magic
;

/**
 * Walk every source of stat modifiers for the given entity and return the
 * combined flat list. Sources iterated:
 *   1. Equipment slots (player only)
 *   2. Active buffs (any entity)
 *   3. (Future) intrinsic per-entity baseline modifiers
 *   4. (Future) per-floor blessings, character-class passives, etc.
 */
export function aggregateModifiers(entityId: EntityId): StatModifier[] {
  const out: StatModifier[] = [];

  // 1. Equipment slots — currently player-only.
  if (entityId === 'player') {
    for (const slot of Object.values(getEquipment())) {
      if (slot?.modifiers) out.push(...slot.modifiers);
    }
    // Rolled affix modifiers from each equipped slot. Sidecar storage
    // — see src/player/equipment.ts — so the base spec stays shared
    // while each pickup can carry its own rolled tweaks.
    out.push(...aggregateAffixModifiers());
  }

  // 2. Active buffs ticking on this entity.
  const entity = get(entityId);
  if (entity) {
    for (const buff of entity.buffs) {
      const spec = BUFFS[buff.specId];
      if (spec?.modifiers) out.push(...spec.modifiers);
    }
  }

  return out;
}

// Combined-and-structured player stats. Returned by computePlayerStats().
// Damage pipeline uses the subset relevant to combat; HP code uses maxHp.
export interface PlayerStats {
  maxHp: number;
  weaponDamageBonus: number;
  damageMultiplier: number;
  physicalArmor: number;
  magicArmor: number;
}

/**
 * Player stats — aggregated from base (CONFIG) + every modifier source.
 * Cheap; called by damagePlayer, the HP-bar, and the inventory panel
 * once per relevant event. No caching needed at this scale.
 */
export function computePlayerStats(): PlayerStats {
  let maxHp = CONFIG.PLAYER_HP_MAX;
  let weaponDamageBonus = 0;
  let damageMultiplier = 1;
  let physicalArmor = 0;
  let magicArmor = 0;

  for (const m of aggregateModifiers('player')) {
    switch (m.kind) {
      case 'max-hp':            maxHp += m.amount; break;
      case 'weapon-damage':     weaponDamageBonus += m.amount; break;
      case 'damage-multiplier': damageMultiplier *= m.amount; break;
      case 'physical-armor':    physicalArmor += m.amount; break;
      case 'magic-armor':       magicArmor += m.amount; break;
    }
  }
  // Character attributes — spent at safe rooms. Vigor → max HP,
  // Resolve → +0.5 armour to BOTH kinds. Acuity feeds crit chance in
  // the weapon-resolve path (not this function). Lore has no
  // mechanical effect yet — it's the narrator/LLM signal.
  const { vigor, resolve } = getCharacter().attributes;
  maxHp += vigor;
  physicalArmor += resolve * 0.5;
  magicArmor    += resolve * 0.5;
  return { maxHp, weaponDamageBonus, damageMultiplier, physicalArmor, magicArmor };
}

/**
 * Walk every source of TRIGGERED PASSIVES for an entity. Sister to
 * aggregateModifiers — same idea, different shape:
 *   - Modifiers       = static stat changes (max HP, damage bonus, armor)
 *   - Passives        = trigger + effects pairs (on kill -> apply buff)
 *
 * Used by the trigger system (src/ecs/triggers.ts) so equipment-granted
 * passives fire on game events without mutating the entity's
 * intrinsic passive list when items are equipped/unequipped.
 */
export function aggregatePassives(entityId: EntityId): PassiveSpec[] {
  const out: PassiveSpec[] = [];

  // Intrinsic passives on the entity (player baseline, reaper, etc.).
  const entity = get(entityId);
  if (entity) out.push(...entity.passives);

  // Equipment-granted passives — player only.
  if (entityId === 'player') {
    for (const slot of Object.values(getEquipment())) {
      if (slot?.passives) out.push(...slot.passives);
    }
  }

  return out;
}
