import { on as onEvent } from '../broadcast/event-bus';
import type { GameEvent } from '../broadcast/event-bus';
import { ITEMS } from '../content/items';
import { CONFIG } from '../config';

// Character state — per-run "who is this delver becoming."
//
// HARDCORE VARIANT: every value resets to baseline on a fresh run.
// Nothing persists across deaths. When/if we promote specific numbers
// to meta-progression later, this is the module that gains save / load
// + a survives-death flag — until then, the dungeon strips it from you.
//
// Two layers:
//
//   Attributes  — Might / Finesse / Lore / Grit (the WC3-style set;
//                 see docs/HARBOR-AND-PROGRESSION.md). Each scales ONE
//                 weapon/gear family + carries a signature, and Might/
//                 Lore add a small universal damage floor so no point
//                 is ever dead. Slow, deliberate growth: you earn
//                 UNSPENT POINTS by levelling (one per level reached),
//                 then spend them at safe rooms — the Dark-Souls-
//                 bonfire moment. Nothing else raises an attribute.
//                 Auto-grants would cheapen the choice; safe-room
//                 spending makes who-you-become a real decision tied to
//                 the act-clear pacing.
//
//                   Might   — heavy weapons (hammer/scythe/sword/spear),
//                             stagger, +1% all dmg/pt
//                   Finesse — light & ranged (dagger/whip/crossbow/
//                             knives), +crit/pt
//                   Lore    — arcane (wand), affliction potency,
//                             +1% all dmg/pt
//                   Grit    — armor scaling, +max HP/pt
//
//   Proficiencies — Ten of them, see ProficiencyKind. Activity
//                   counters: each ticks up as you DO the relevant
//                   thing. Per the V1 plan, only the WEAPON CLASS
//                   proficiencies feed combat math (via
//                   resolveWeaponStats). The rest are tracked for the
//                   character screen + the Phase 5 LLM signal vector —
//                   mechanical effects roll in as we tune each one.

export type AttributeKind = 'might' | 'finesse' | 'lore' | 'grit';

export type ProficiencyKind =
  // Weapon classes — combat math hookup lives in resolveWeaponStats.
  | 'fist'
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
    attributes: { might: 0, finesse: 0, lore: 0, grit: 0 },
    proficiencies: {
      fist: 0,
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

// ── Save / restore ────────────────────────────────────────────────
// The run save persists character progression so a RELOAD/resume keeps
// your spent attributes + earned proficiencies (death still wipes — the
// save is cleared on death). Without this, resuming reset the character
// to baseline ("stats don't reapply"). Committed at floor entry alongside
// hp/inventory (see run-state.commitFloorEntry); restored in
// save-hydration.applyState.

export interface CharacterSave {
  attributes: Record<AttributeKind, number>;
  proficiencies: Record<ProficiencyKind, number>;
  unspentPoints: number;
  greedRemainder: number;
}

export function serializeCharacter(): CharacterSave {
  return {
    attributes: { ...state.attributes },
    proficiencies: { ...state.proficiencies },
    unspentPoints: state.unspentPoints,
    greedRemainder: state.greedRemainder,
  };
}

/** Restore character from a save. Merges over baseline so a save written
 *  before a new attribute/proficiency existed still loads (missing keys
 *  default to 0). No-op for a null/absent save (fresh run). */
export function hydrateCharacter(data: CharacterSave | null | undefined): void {
  if (!data) return;
  const base = baseline();
  state = {
    attributes: { ...base.attributes, ...data.attributes },
    proficiencies: { ...base.proficiencies, ...data.proficiencies },
    unspentPoints: data.unspentPoints ?? 0,
    greedRemainder: data.greedRemainder ?? 0,
  };
  notify();
}

// ── Proficiency tiers ─────────────────────────────────────────────
// Named milestones over the smooth per-point curve. They give the
// "Sword — Adept" recognition beat (a broadcast pop later) and the
// tier line + progress bar shown on a weapon's item card.

export interface ProficiencyTier {
  /** Tier name for the current value. */
  name: string;
  /** 0-based tier index (0 = the lowest tier). */
  index: number;
  /** Points threshold where the current tier began. */
  floor: number;
  /** Points threshold of the NEXT tier, or null if at the top. */
  nextAt: number | null;
  /** Progress 0..1 through the current tier toward the next (1 at max). */
  progress: number;
}

const PROF_TIER_THRESHOLDS: ReadonlyArray<{ name: string; at: number }> = [
  { name: 'Untrained', at: 0 },
  { name: 'Novice',    at: 10 },
  { name: 'Adept',     at: 30 },
  { name: 'Master',    at: 60 },
];

/** Resolve a proficiency point total into its tier + progress to next. */
export function proficiencyTier(value: number): ProficiencyTier {
  let i = 0;
  for (let t = PROF_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (value >= PROF_TIER_THRESHOLDS[t].at) { i = t; break; }
  }
  const floor = PROF_TIER_THRESHOLDS[i].at;
  const next = PROF_TIER_THRESHOLDS[i + 1] ?? null;
  const nextAt = next ? next.at : null;
  const progress = nextAt === null ? 1 : (value - floor) / (nextAt - floor);
  return { name: PROF_TIER_THRESHOLDS[i].name, index: i, floor, nextAt, progress };
}

// ── Lore signature: affliction scaling ───────────────────────────
// The player's damage-over-time statuses last longer + tick harder
// with Lore. Read live (cheap) at the buff apply + tick sites — Lore
// only changes at the harbor, so no snapshotting needed.

/** Duration multiplier for a player-applied affliction (1.0 at 0 Lore). */
export function loreAfflictionDurationMul(): number {
  return 1 + state.attributes.lore * CONFIG.ATTR.LORE_AFFLICT_DURATION_PER_POINT;
}

/** DoT tick-damage multiplier for a player-sourced affliction. */
export function loreAfflictionPotencyMul(): number {
  return 1 + state.attributes.lore * CONFIG.ATTR.LORE_AFFLICT_POTENCY_PER_POINT;
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
        // Stat distribution is CUT — the tarot Spread is the build now (see
        // docs/THE-DUNGEON-NOTICES.md). Levelling no longer grants attribute
        // points to spend; the attribute fields remain only as inert hidden math
        // (all 0 unless lore ticks from note-reads). A future pass routes XP into
        // an auto survivability curve + meta-unlocks. No grant, no notify.
        break;
      }
    }
  });
}
