import { CONFIG } from '../config';
import type { EntityId, PassiveSpec } from '../ecs/types';
import { get } from '../ecs/world';
import { getEquipment, aggregateAffixModifiers, aggregateSetModifiers } from '../player/equipment';
import { getReliquary } from '../player/reliquary';
import { BUFFS } from '../content/buffs';
import { getCharacter } from '../state/character';
import { aggregateMutationModifiers } from '../state/run-mutations';
import { getHeldCards } from '../state/run-state';
import { cardModifiers, cardSynergyModifiers, cardConditionalBundles, cardTriggerPassives } from '../content/cards';

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
  | { kind: 'max-hp';                amount: number }    // flat add to maximum HP
  | { kind: 'weapon-damage';         amount: number }    // flat add to outgoing damage
  | { kind: 'damage-multiplier';     amount: number }    // multiplicative on outgoing (1.5 = +50%)
  | { kind: 'finisher-damage-mult';  amount: number }    // multiplicative on outgoing ONLY for the finisher (last combo step)
  | { kind: 'physical-armor';        amount: number }    // flat reduction to incoming physical
  | { kind: 'magic-armor';           amount: number }    // flat reduction to incoming magic
  | { kind: 'incoming-damage-mult';  amount: number }    // multiplicative on INCOMING (sunder/vulnerable: 1.35 = +35% taken)
  | { kind: 'move-speed-mult';       amount: number }    // multiplicative on move speed (chill: 0.5 = half)
  | { kind: 'action-speed-mult';     amount: number }    // multiplicative on attack/windup speed (chill: 0.6 = 40% slower)
  // Crit additions: stack on top of the WEAPON's intrinsic crit. Each
  // 'crit-chance' amount adds linearly to the roll probability (0.10 =
  // +10%); 'crit-mult' adds linearly to the multiplier (0.25 = +0.25
  // on top of the weapon's base 2.0). Both clamp at the use-site so a
  // pile of items can't roll past 100% chance or infinite mult.
  // `stack` (relic copies only — docs/ITEM-GRAMMAR.md §4): how N copies of the
  // SAME relic combine for this modifier. Default = per-copy (additive kinds
  // sum linearly; multiplier kinds compound — the exponential curve is free by
  // kind). 'hyperbolic' = diminishing returns for chance-like 0..1 stats:
  // total = 1 − (1−amount)^N (each copy rolls independently — approaches 1,
  // never reaches it; RoR2's curve for exactly this class of stat).
  | { kind: 'crit-chance';           amount: number; stack?: 'hyperbolic' }    // additive 0..1
  | { kind: 'crit-mult';             amount: number }    // additive multiplier offset
  // Lifesteal — CHANCE to heal a flat amount ON KILL (not a per-hit
  // drain — that was far too strong). 0.20 = 20% chance per enemy killed
  // to heal CONFIG.LIFESTEAL_ON_KILL_HEAL. Stacks additively, clamped to
  // 1.0. Proc'd by the enemy:killed listener in attack.ts.
  | { kind: 'lifesteal-pct';         amount: number; stack?: 'hyperbolic' }
  // ── SUBSTRATE — status-payoff flags (docs/BUILD-ECONOMY.md). Read by the
  // death-payoff handler (combat/blood-drinker.ts), not the damage math. These
  // are the seam relics plug verbs into: presence/amount that a payoff consults.
  | { kind: 'bleed-chain';           amount: number }   // a dying bleeder re-bleeds its neighbours
  | { kind: 'bleed-feed';            amount: number }   // hearts healed per bleeding kill
;

/**
 * Walk every source of stat modifiers for the given entity and return the
 * combined flat list. Sources iterated:
 *   1. Equipment slots (player only)
 *   2. Active buffs (any entity)
 *   3. (Future) intrinsic per-entity baseline modifiers
 *   4. (Future) per-floor blessings, character-class passives, etc.
 */
/**
 * How N copies of the same relic contribute one modifier list. Default: the
 * modifier is pushed once PER COPY — additive kinds stack linearly, multiplier
 * kinds compound (×a per copy = a^N, the exponential curve, free by kind).
 * `stack: 'hyperbolic'` collapses to ONE synthesized modifier with
 * total = 1 − (1−amount)^N — each copy is an independent roll, so chance-like
 * 0..1 stats (crit-chance, lifesteal-pct) keep improving but never hit 1.
 * Exported for tests.
 */
export function stackedRelicModifiers(mods: StatModifier[] | undefined, n: number): StatModifier[] {
  if (!mods?.length || n <= 0) return [];
  const out: StatModifier[] = [];
  for (const m of mods) {
    if ((m as { stack?: string }).stack === 'hyperbolic') {
      out.push({ ...m, amount: 1 - Math.pow(1 - m.amount, n) });
    } else {
      for (let i = 0; i < n; i++) out.push(m);
    }
  }
  return out;
}

export function aggregateModifiers(entityId: EntityId): StatModifier[] {
  const out: StatModifier[] = [];

  // 1. Equipment slots — currently player-only.
  if (entityId === 'player') {
    for (const slot of Object.values(getEquipment())) {
      if (slot?.modifiers) out.push(...slot.modifiers);
      // Conditional modifiers — only contribute while their condition
      // holds. Lets items express state-aware effects ("when below
      // 30% HP, +1 weapon damage") without needing a trigger event.
      // Cheap to check per-frame; the player's equipped item count
      // is small and the conditions are simple comparisons.
      if (slot?.conditionalModifiers) {
        for (const c of slot.conditionalModifiers) {
          if (evaluateModifierCondition(c.condition, entityId)) {
            out.push(...c.modifiers);
          }
        }
      }
    }
    // RELIQUARY (docs/BUILD-ECONOMY.md) — every collected relic's own modifiers
    // apply, UNCAPPED, alongside the 3 gear slots. No slot management: you accrete
    // these. Same shape as a slot (base + conditional modifiers).
    //
    // STACK CURVES (docs/ITEM-GRAMMAR.md §4): copies of the same relic group
    // first, then each modifier's `stack` decides how N copies combine —
    // default per-copy (additive kinds linear, multiplier kinds compound),
    // 'hyperbolic' collapses to one synthesized modifier with diminishing
    // returns. See stackedRelicModifiers below (exported for tests).
    const relicEntries = getReliquary();
    const copies = new Map<string, { spec: (typeof relicEntries)[number]['spec']; n: number }>();
    for (const r of relicEntries) {
      const g = copies.get(r.spec.id);
      if (g) g.n++; else copies.set(r.spec.id, { spec: r.spec, n: 1 });
    }
    for (const { spec, n } of copies.values()) {
      out.push(...stackedRelicModifiers(spec.modifiers, n));
      if (spec.conditionalModifiers) {
        for (const c of spec.conditionalModifiers) {
          if (evaluateModifierCondition(c.condition, entityId)) {
            out.push(...stackedRelicModifiers(c.modifiers, n));
          }
        }
      }
    }
    // Rolled affix modifiers from each equipped slot. Sidecar storage
    // — see src/player/equipment.ts — so the base spec stays shared
    // while each pickup can carry its own rolled tweaks.
    out.push(...aggregateAffixModifiers());
    // Active set-bonus modifiers (enough matched pieces equipped).
    out.push(...aggregateSetModifiers());
    // Run-lifetime tainted-fountain mutations — permanent for the rest of
    // the run, gone on death. Composes through this pipeline identically
    // to anything else.
    out.push(...aggregateMutationModifiers());
    // Fate cards held this run (the Spread) — the tarot build. A card is
    // just another source of StatModifiers, exactly like an affix or a
    // mutation. See content/cards.ts + docs/THE-CARDS.md.
    //   - passive: always-on modifiers (PACT).
    //   - synergy (RESONANCE): bonuses scaled by the kin in your Spread.
    //   - conditional (BRINK): gated by the SAME HP evaluator items use.
    const held = getHeldCards();
    out.push(...cardModifiers(held));
    out.push(...cardSynergyModifiers(held));
    for (const c of cardConditionalBundles(held)) {
      if (evaluateModifierCondition(c.condition, entityId)) out.push(...c.modifiers);
    }
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

/** Evaluate a conditional-modifier predicate for the given entity. */
function evaluateModifierCondition(
  cond: { kind: 'below-hp-pct' | 'above-hp-pct'; value: number },
  entityId: EntityId,
): boolean {
  const entity = get(entityId);
  if (!entity?.hp || entity.hp.base <= 0) return false;
  const pct = entity.hp.current / entity.hp.base;
  return cond.kind === 'below-hp-pct' ? pct < cond.value : pct >= cond.value;
}

// Combined-and-structured player stats. Returned by computePlayerStats().
// Damage pipeline uses the subset relevant to combat; HP code uses maxHp.
export interface PlayerStats {
  maxHp: number;
  weaponDamageBonus: number;
  damageMultiplier: number;
  /** Multiplier applied to outgoing damage ONLY when the strike is
   *  the finisher (last step of the current weapon's combo). 1.0 =
   *  no bonus. Items with on-finisher effects compose here. */
  finisherDamageMultiplier: number;
  physicalArmor: number;
  magicArmor: number;
  /** Multiplier on INCOMING damage (sunder/vulnerable). 1.0 = normal. */
  vulnerability: number;
  /** Additive bonus on the weapon's intrinsic crit chance (0..1).
   *  Stacks across items + buffs. Clamped at 1.0 when rolled. */
  critChanceBonus: number;
  /** Additive bonus on the weapon's intrinsic crit multiplier
   *  (e.g. +0.50 on a base 2.0 → effective ×2.5 on crit). */
  critMultBonus: number;
  /** Percentage of damage dealt that heals the player (0..1, clamped). */
  lifestealPct: number;
  /** SUBSTRATE — a dying BLEEDING enemy re-bleeds nearby enemies (the pack chain). */
  bleedChain: boolean;
  /** SUBSTRATE — hearts healed when a BLEEDING enemy dies (build-granted lifesteal). */
  bleedFeed: number;
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
  let finisherDamageMultiplier = 1;
  let physicalArmor = 0;
  let magicArmor = 0;
  let vulnerability = 1;
  let critChanceBonus = 0;
  let critMultBonus = 0;
  let lifestealPct = 0;
  let bleedChain = false;
  let bleedFeed = 0;

  for (const m of aggregateModifiers('player')) {
    switch (m.kind) {
      case 'max-hp':               maxHp += m.amount; break;
      case 'weapon-damage':        weaponDamageBonus += m.amount; break;
      case 'damage-multiplier':    damageMultiplier *= m.amount; break;
      case 'finisher-damage-mult': finisherDamageMultiplier *= m.amount; break;
      case 'physical-armor':       physicalArmor += m.amount; break;
      case 'magic-armor':          magicArmor += m.amount; break;
      case 'incoming-damage-mult': vulnerability *= m.amount; break;
      case 'crit-chance':          critChanceBonus += m.amount; break;
      case 'crit-mult':            critMultBonus += m.amount; break;
      case 'lifesteal-pct':        lifestealPct += m.amount; break;
      case 'bleed-chain':          bleedChain = true; break;
      case 'bleed-feed':           bleedFeed += m.amount; break;
      // move/action-speed are handled by aggregateSpeed (movement +
      // attack timing), not the damage-stat path.
      case 'move-speed-mult':
      case 'action-speed-mult':    break;
    }
  }
  // Character attributes — spent at safe rooms (ATTRIBUTES = power).
  // GRIT is the survival stat: +max HP per point (its universal floor)
  // AND it SCALES equipped armour — both physical + magic counts for
  // more, the way Might scales a heavy weapon. So the same plate on a
  // high-Grit delver is meaningfully tougher. (Finesse → crit and
  // Might/Lore → weapon damage are applied in the weapon-resolve path,
  // not here; Lore's affliction signature lives in the buff pipeline.)
  const { grit } = getCharacter().attributes;
  maxHp += grit * CONFIG.ATTR.GRIT_HP_PER_POINT;
  const gritArmorMul = 1 + grit * CONFIG.ATTR.GRIT_ARMOR_SCALE_PER_POINT;
  physicalArmor *= gritArmorMul;
  magicArmor    *= gritArmorMul;
  return {
    maxHp, weaponDamageBonus, damageMultiplier, finisherDamageMultiplier,
    physicalArmor, magicArmor, vulnerability,
    // Clamp at use-site too, but cap chance at 1.0 here so the UI /
    // tooltips don't show "115% crit chance"; a single pile of items
    // shouldn't roll past every swing always critting.
    critChanceBonus: Math.min(1, Math.max(0, critChanceBonus)),
    critMultBonus,
    lifestealPct: Math.min(1, Math.max(0, lifestealPct)),
    bleedChain,
    bleedFeed,
  };
}

/**
 * Movement + action speed multipliers for an entity, from active buffs
 * (chill slows both). Products of all move-speed-mult / action-speed-mult
 * modifiers; 1.0 each when unaffected. Read by the enemy AI for movement
 * pace and attack-phase timing.
 */
export function aggregateSpeed(entityId: EntityId): { move: number; action: number } {
  let move = 1;
  let action = 1;
  for (const m of aggregateModifiers(entityId)) {
    if (m.kind === 'move-speed-mult') move *= m.amount;
    else if (m.kind === 'action-speed-mult') action *= m.amount;
  }
  return { move, action };
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
    // Reliquary — every collected relic's passives, uncapped.
    for (const r of getReliquary()) if (r.spec.passives) out.push(...r.spec.passives);
    // Fate-card PROCS (on kill/crit) — synthesized as passives so they fire
    // through the ONE trigger path (ecs/triggers.ts) alongside equipment, never
    // a fork. On-hit hexes ride getPlayerOnHits instead (victim-aware).
    out.push(...cardTriggerPassives(getHeldCards()));
  }

  return out;
}
