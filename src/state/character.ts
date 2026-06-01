import { on as onEvent } from '../broadcast/event-bus';
import type { GameEvent } from '../broadcast/event-bus';
import { ITEMS } from '../content/items';

// Character state — per-run "who is this delver becoming."
//
// HARDCORE VARIANT: every value resets to baseline on a fresh run.
// Nothing persists across deaths. When/if we promote specific numbers
// to meta-progression later, this is the module that gains save / load
// + a survives-death flag — until then, the dungeon strips it from you.
//
// Two layers:
//
//   Attributes  — Vigor / Resolve / Acuity / Lore. Slow, deliberate
//                 growth: you earn UNSPENT POINTS by levelling (one
//                 point per level reached), then spend them at safe
//                 rooms — the Dark-Souls-bonfire moment. Nothing else
//                 raises an attribute. Auto-grants would cheapen the
//                 choice; safe-room spending makes who-you-become a
//                 real decision tied to the act-clear pacing.
//
//   Proficiencies — Ten of them, see ProficiencyKind. Activity
//                   counters: each ticks up as you DO the relevant
//                   thing. Per the V1 plan, only the WEAPON CLASS
//                   proficiencies feed combat math (via
//                   resolveWeaponStats). The rest are tracked for the
//                   character screen + the Phase 5 LLM signal vector —
//                   mechanical effects roll in as we tune each one.

export type AttributeKind = 'vigor' | 'resolve' | 'acuity' | 'lore';

export type ProficiencyKind =
  // Weapon classes — combat math hookup lives in resolveWeaponStats.
  | 'sword' | 'dagger' | 'hammer' | 'spear' | 'crossbow' | 'wand'
  | 'scythe' | 'whip' | 'throwing-knives'
  // Defensive — block (shield-equipped + hit taken) / toughness
  // (damage absorbed, including from traps; absorbs the would-be
  // 'trap-sense' proficiency so the player isn't punished twice for
  // the same hit).
  | 'block' | 'toughness'
  // Utility — alchemy (potions) / tinkering (chests) / greed (gold)
  // / profanity (cursed equips) / survival (HP recovered).
  | 'alchemy' | 'tinkering' | 'greed' | 'profanity' | 'survival'
  // Meta — descent (floors crossed).
  | 'descent';

export interface CharacterState {
  attributes: Record<AttributeKind, number>;
  proficiencies: Record<ProficiencyKind, number>;
  /** Earned-but-unspent attribute points. Filled by level-ups, spent
   *  at safe-room rest pillars. */
  unspentPoints: number;
  /** Greed ticks once per 10g; the remainder lives here so a stream of
   *  small coin pickups still adds up correctly. */
  greedRemainder: number;
}

function baseline(): CharacterState {
  return {
    attributes: { vigor: 0, resolve: 0, acuity: 0, lore: 0 },
    proficiencies: {
      sword: 0, dagger: 0, hammer: 0, spear: 0, crossbow: 0, wand: 0,
      scythe: 0, whip: 0, 'throwing-knives': 0,
      block: 0, toughness: 0,
      alchemy: 0, tinkering: 0, greed: 0, profanity: 0, survival: 0,
      descent: 0,
    },
    unspentPoints: 0,
    greedRemainder: 0,
  };
}

let state: CharacterState = baseline();
type Listener = (s: Readonly<CharacterState>) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(state);
}

export function getCharacter(): Readonly<CharacterState> {
  return state;
}

/** Subscribe to any character-state change. Returns unsubscribe. */
export function onCharacterChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wipe character back to baseline. Called by startNewRun — hardcore
 *  variant has nothing to preserve. */
export function resetCharacter(): void {
  state = baseline();
  notify();
}

export function gainProficiency(kind: ProficiencyKind, delta = 1): void {
  if (delta <= 0) return;
  state.proficiencies[kind] += delta;
  notify();
}

/** Spend ONE attribute point on `kind`. Returns whether it landed
 *  (false if there are no unspent points available). Called by the
 *  safe-room character screen — nothing else should raise an
 *  attribute. */
export function spendAttributePoint(kind: AttributeKind): boolean {
  if (state.unspentPoints <= 0) return false;
  state.unspentPoints -= 1;
  state.attributes[kind] += 1;
  notify();
  return true;
}

// ── Side-channel hooks ────────────────────────────────────────────
// These are called explicitly from systems where the event-bus
// doesn't carry the info we need (HP delta, damage absorbed, etc.).

/** Called after a consumable is used. */
export function recordConsumableUse(): void {
  gainProficiency('alchemy');
}

/** Called after HP is restored — fountain or potion. The HP delta
 *  becomes survival proficiency at 1:1 so a 4-HP heal = +4 survival. */
export function recordHpRecovered(amount: number): void {
  if (amount <= 0) return;
  gainProficiency('survival', amount);
}

/** Called after the player takes damage. The damage taken becomes
 *  toughness at 1:1; absorbs the would-be trap-sense proficiency so
 *  damage from any source (trap, mob, blood altar) feeds the same
 *  "get-tougher-by-getting-hit" loop. */
export function recordDamageTaken(amount: number): void {
  if (amount <= 0) return;
  gainProficiency('toughness', amount);
}

/** Called when a shield-equipped player takes damage. Block ticks per
 *  hit (independent of toughness). Currently shields are passive
 *  armour, so EVERY hit while wearing one counts; once active blocking
 *  lands, this hook narrows to actual blocks. */
export function recordShieldedHit(): void {
  gainProficiency('block');
}

/** Called when a chest is opened. */
export function recordChestOpened(): void {
  gainProficiency('tinkering');
}

// ── Event-bus integration ────────────────────────────────────────
// Cleaner hooks for things that ALREADY flow through the bus.

let initialized = false;

export function initCharacterTracking(): void {
  if (initialized) return;
  initialized = true;
  onEvent((event: GameEvent) => {
    switch (event.type) {
      case 'attack:hit': {
        // Weapon-class proficiency ticks per landed hit. The class
        // comes through the event payload so this module doesn't have
        // to import current-weapon (which would create a cycle once
        // current-weapon reads BACK from character for proficiency
        // bonuses).
        if (event.cls) gainProficiency(event.cls);
        break;
      }
      case 'gold:absorbed': {
        // Greed ticks per 10g. The bus signal doesn't carry the coin
        // value, so we estimate ~5g per coin (matches MAX_GOLD_PER_COIN
        // / 2 typical) and carry the remainder forward.
        state.greedRemainder += 5;
        while (state.greedRemainder >= 10) {
          state.greedRemainder -= 10;
          gainProficiency('greed');
        }
        break;
      }
      case 'item:picked-up': {
        // Cursed item pickups bump profanity.
        const spec = ITEMS[event.itemId];
        if (spec && spec.rarity === 'cursed') gainProficiency('profanity');
        break;
      }
      case 'note:read': {
        // Note reading still ticks the LORE attribute directly —
        // the only attribute V1 grants outside of level-up points.
        // It's slow and tied to story content; spending a point would
        // feel weird ("I'm declaring myself well-read"). The other
        // three attributes ALWAYS come from level-up + safe-room
        // spend, by design.
        state.attributes.lore += 1;
        notify();
        break;
      }
      case 'level:loaded': {
        // Descent ticks once per floor crossed (counts the starter
        // chamber + tutorial + safe rooms — they're all "you stepped
        // somewhere new"). The starter / test chambers are pre-run
        // setup and shouldn't count; gate by levelId prefix.
        const id = event.levelId;
        if (id === 'starter' || id.startsWith('test-')) break;
        gainProficiency('descent');
        break;
      }
      case 'level:up': {
        // Every level reached grants one UNSPENT attribute point.
        // Player commits the build at a safe room.
        state.unspentPoints += 1;
        notify();
        break;
      }
    }
  });
}
