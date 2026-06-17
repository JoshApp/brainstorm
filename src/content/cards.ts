// The Cards — the tarot build grammar (see docs/THE-CARDS.md).
//
// A card is DATA composed from the SAME effect vocabulary as items: it produces
// `StatModifier[]` (the modifiers.ts vocabulary) plus, later, conditional
// modifiers and triggered effects (the affix `onHit` shape / the ability
// timeline). The carrier differs (a drawn card vs an equipped item), the
// payload is shared — so cards flow through the one `aggregateModifiers()`
// pipeline as just another source, never a parallel engine.
//
// V1 wires the PASSIVE half live (cardModifiers → aggregateModifiers). Triggers
// and conditionals are defined in the grammar (ready) but their live
// event-wiring + the bonfire draw UI are the next increments.

import type { StatModifier } from '../combat/modifiers';
import type { Domain } from '../art/cards';

export type Arcana = 'minor' | 'major';

/** A predicate gating conditional modifiers — mirrors modifiers.ts's own
 *  conditional-modifier shape so cards and items speak the same condition. */
export interface CardCondition {
  kind: 'below-hp-pct' | 'above-hp-pct';
  value: number;
}

/** A triggered effect: an event applies a buff (the affix `onHit` shape,
 *  generalised to more events). Shared with items; live-wired later. */
export interface CardTrigger {
  on: 'hit' | 'kill' | 'crit';
  buffId: string;
  chance: number;      // 0..1
  duration: number;    // seconds
}

/** The shared effect bundle a card contributes — same parts an item produces. */
export interface CardEffect {
  /** Passive stat modifiers (always on while the card is held). */
  modifiers?: StatModifier[];
  /** Modifiers gated by a predicate (e.g. only while below 30% HP). */
  conditional?: { condition: CardCondition; modifiers: StatModifier[] }[];
  /** Event-triggered effects. */
  triggers?: CardTrigger[];
}

export interface CardSpec {
  id: string;
  name: string;
  arcana: Arcana;
  /** Domains this card belongs to. One = single-anchor; [] = domain-less
   *  "true Arcana"; two = a bridge. (See the domain trio in THE-CARDS.md.) */
  domains: Domain[];
  /** One-line identity, broadcast-register (what you BECOME, not the numbers). */
  fate: string;
  effect: CardEffect;
}

// ── The deck (starter effects, drawn from the existing modifier vocabulary) ──
// Numbers are deliberately small/placeholder — the point here is the GRAMMAR,
// not balance. Minors lean numeric; majors lean toward stronger/defining mods.
export const CARDS: Record<string, CardSpec> = {
  // ── DARK ──────────────────────────────────────────────────────────────────
  'the-glutton': {
    id: 'the-glutton', name: 'The Glutton', arcana: 'minor', domains: ['greed'],
    fate: 'You feed on the fallen.',
    effect: { modifiers: [{ kind: 'lifesteal-pct', amount: 0.10 }] },
  },
  'the-hound': {
    id: 'the-hound', name: 'The Hound', arcana: 'minor', domains: ['blood'],
    fate: 'You run the prey down.',
    effect: { modifiers: [{ kind: 'move-speed-mult', amount: 1.10 }, { kind: 'action-speed-mult', amount: 1.08 }] },
  },
  'red-thirst': {
    id: 'red-thirst', name: 'Red Thirst', arcana: 'major', domains: ['blood'],
    fate: 'You drink, and pay for it.',
    effect: { modifiers: [{ kind: 'lifesteal-pct', amount: 0.25 }, { kind: 'incoming-damage-mult', amount: 1.12 }] },
  },
  'the-hollow-saint': {
    id: 'the-hollow-saint', name: 'The Hollow Saint', arcana: 'major', domains: ['bone'],
    fate: 'You endure as the dead endure.',
    effect: { modifiers: [{ kind: 'max-hp', amount: 25 }, { kind: 'action-speed-mult', amount: 0.94 }] },
  },
  'the-worm': {
    id: 'the-worm', name: 'The Worm', arcana: 'minor', domains: ['rot'],
    fate: 'You gnaw what cannot heal.',
    effect: { modifiers: [{ kind: 'weapon-damage', amount: 2 }] },
  },
  'the-maw': {
    id: 'the-maw', name: 'The Maw', arcana: 'minor', domains: ['greed'],
    fate: 'You strike for the soft places.',
    effect: { modifiers: [{ kind: 'crit-chance', amount: 0.08 }] },
  },

  // ── LIGHT / HOPE ────────────────────────────────────────────────────────────
  'the-dawn': {
    id: 'the-dawn', name: 'The Dawn', arcana: 'major', domains: ['dawn'],
    fate: 'You carry the light down.',
    effect: { modifiers: [{ kind: 'max-hp', amount: 15 }, { kind: 'physical-armor', amount: 2 }] },
  },
  'the-hearth': {
    id: 'the-hearth', name: 'The Hearth', arcana: 'minor', domains: ['grace'],
    fate: 'You keep a little warmth.',
    effect: { modifiers: [{ kind: 'physical-armor', amount: 2 }] },
  },
  'the-star': {
    id: 'the-star', name: 'The Star', arcana: 'major', domains: ['dawn'],
    fate: 'You strike true by its light.',
    effect: { modifiers: [{ kind: 'crit-mult', amount: 0.5 }] },
  },
  'the-oath': {
    id: 'the-oath', name: 'The Oath', arcana: 'major', domains: ['valor'],
    fate: 'Your last blow is the heaviest.',
    effect: { modifiers: [{ kind: 'finisher-damage-mult', amount: 0.6 }, { kind: 'weapon-damage', amount: 2 }] },
  },
  'the-companion': {
    id: 'the-companion', name: 'The Companion', arcana: 'minor', domains: ['grace'],
    fate: 'You are not alone down here.',
    effect: { modifiers: [{ kind: 'max-hp', amount: 10 }] },
  },
  'the-healer': {
    id: 'the-healer', name: 'The Healer', arcana: 'minor', domains: ['grace'],
    fate: 'Your wounds close, a little.',
    effect: { modifiers: [{ kind: 'lifesteal-pct', amount: 0.12 }] },
  },

  // ── NUMINOUS ────────────────────────────────────────────────────────────────
  'the-lantern': {
    id: 'the-lantern', name: 'The Lantern', arcana: 'major', domains: ['grace'],
    fate: 'The kind light wards you.',
    effect: { modifiers: [{ kind: 'magic-armor', amount: 3 }, { kind: 'physical-armor', amount: 2 }] },
  },
  'the-wanderer': {
    id: 'the-wanderer', name: 'The Wanderer', arcana: 'major', domains: ['wonder'],
    fate: 'You walk the forbidden stair.',
    effect: { modifiers: [{ kind: 'move-speed-mult', amount: 1.12 }, { kind: 'action-speed-mult', amount: 1.06 }, { kind: 'crit-chance', amount: 0.05 }] },
  },
};

export function getCard(id: string): CardSpec | undefined {
  return CARDS[id];
}

/**
 * Deal `n` DISTINCT cards (a fate hand) — the "fate deals the hand" half of
 * dealt-N-pick-1. Filters by arcana (minors for the bonfire drip), optionally
 * excludes ids, shuffles, takes n. Pure: pass `rng` for determinism (the run
 * seed); defaults to Math.random. (Minors may repeat what you already hold —
 * they stack — so we don't exclude the held Spread by default.)
 */
export function dealCards(
  n: number,
  opts: { arcana?: Arcana; exclude?: readonly string[]; rng?: () => number } = {},
): string[] {
  const { arcana, exclude = [], rng = Math.random } = opts;
  const ex = new Set(exclude);
  const pool = Object.values(CARDS)
    .filter((c) => (!arcana || c.arcana === arcana) && !ex.has(c.id))
    .map((c) => c.id);
  for (let i = pool.length - 1; i > 0; i--) {  // Fisher–Yates
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, n));
}

/**
 * Resolve the PASSIVE stat modifiers contributed by a set of held cards —
 * the card "source" that aggregateModifiers() folds into the one pipeline.
 * Unknown ids are skipped. (Conditional + triggered effects resolve elsewhere
 * once live-wired.)
 */
export function cardModifiers(heldCardIds: readonly string[]): StatModifier[] {
  const out: StatModifier[] = [];
  for (const id of heldCardIds) {
    const card = CARDS[id];
    if (card?.effect.modifiers) out.push(...card.effect.modifiers);
  }
  return out;
}
