// The Cards — the tarot build grammar (see docs/THE-CARDS.md).
//
// A card is DATA composed from the SAME effect vocabulary as items: it produces
// `StatModifier[]` (the modifiers.ts vocabulary) plus conditional modifiers,
// triggered effects, and synergies. The carrier differs (a drawn card vs an
// equipped item), the payload is shared — so cards flow through the one
// `aggregateModifiers()` pipeline as just another source, never a parallel
// engine. The dormant halves are now LIVE: conditionals + synergy fold into
// aggregateModifiers; on-kill/on-crit procs ride the trigger path; on-hit hexes
// ride the victim-aware on-hit channel (getPlayerOnHits).
//
// The four verb-types a MAJOR can be:
//   PACT      — a boon with a cost (passive modifiers, often a tradeoff).
//   BRINK     — power that wakes when you're dying (conditional, HP-gated).
//   PROC      — a power that fires in battle (trigger → buff).
//   RESONANCE — scales with the kin in your Spread (synergy). The combo engine.

import type { StatModifier } from '../combat/modifiers';
import type { Domain } from '../art/cards';
import type { PassiveSpec, TriggerEvent, EffectSpec } from '../ecs/types';
import type { Transform } from '../combat/transforms';

export type Arcana = 'minor' | 'major';

/** A predicate gating conditional modifiers — mirrors modifiers.ts's own
 *  conditional-modifier shape so cards and items speak the same condition. */
export interface CardCondition {
  kind: 'below-hp-pct' | 'above-hp-pct';
  value: number;
}

/** A triggered effect (a PROC): an event fires an effect. The effect is the
 *  ENGINE's `EffectSpec` — the EXACT vocabulary item passives speak (apply-buff /
 *  heal / damage, with a `target`) — so the proc verb is ONE shape across cards
 *  and items, never a parallel engine. The card-friendly `on` ('kill' → engine
 *  'killed') and the routing (self/kill/crit → trigger path; on-hit+victim → the
 *  victim-aware on-hit channel) are resolved downstream. */
export interface CardTrigger {
  on: 'hit' | 'kill' | 'crit';
  chance: number;        // 0..1
  effect: EffectSpec;    // apply-buff / heal / damage (+ target). Same as items.
}

/** A SYNERGY (Resonance): a bonus that SCALES with how many related cards you
 *  hold — the combo engine. The modifiers are added once PER counted card, so a
 *  card grows stronger the more its kin fill your Spread. Count is over the held
 *  cards matching `per` (a domain's cards / all majors / all minors / every
 *  fate), capped at `max`. This is what makes a "weak" card a keystone. */
export interface CardSynergy {
  per: 'domain' | 'major' | 'minor' | 'card';
  domain?: Domain;             // required when per === 'domain'
  modifiers: StatModifier[];   // added once per counted card
  max?: number;                // cap the count (default 99)
  includeSelf?: boolean;       // count the card itself? default true
}

/** The shared effect bundle a card contributes — same parts an item produces. */
export interface CardEffect {
  /** Passive stat modifiers (always on while the card is held) — PACT. */
  modifiers?: StatModifier[];
  /** Modifiers gated by a predicate (e.g. only while below 30% HP) — BRINK. */
  conditional?: { condition: CardCondition; modifiers: StatModifier[] }[];
  /** Event-triggered effects — PROC. */
  triggers?: CardTrigger[];
  /** Scales-with-your-Spread bonuses — RESONANCE. */
  synergy?: CardSynergy[];
  /** Rule-overrides — TRANSFORM (the grotesque verb). Carrier-agnostic; see
   *  combat/transforms.ts. "You can't heal the normal way," "you bleed at rest." */
  transform?: Transform[];
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

export const CARDS: Record<string, CardSpec> = {
  // ── MINORS — the accumulating breadth. Small, numeric, FOUND often. They feed
  // the majors' Resonance: each one is a domain card a synergy can count. ──────
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
  'the-hearth': {
    id: 'the-hearth', name: 'The Hearth', arcana: 'minor', domains: ['grace'],
    fate: 'You keep a little warmth.',
    effect: { modifiers: [{ kind: 'physical-armor', amount: 2 }] },
  },
  'the-companion': {
    id: 'the-companion', name: 'The Companion', arcana: 'minor', domains: ['grace'],
    fate: 'You are not alone down here.',
    effect: { modifiers: [{ kind: 'max-hp', amount: 2 }] },   // +1 heart (8-HP economy)
  },
  'the-healer': {
    id: 'the-healer', name: 'The Healer', arcana: 'minor', domains: ['grace'],
    fate: 'Your wounds close, a little.',
    effect: { modifiers: [{ kind: 'lifesteal-pct', amount: 0.12 }] },
  },

  // ── MAJORS — each a VERB, a pact you live by. ───────────────────────────────

  // TRANSFORM — you heal ONLY by striking, and bleed when you rest. The rule
  // that makes survival relentless aggression (no more sliders).
  'red-thirst': {
    id: 'red-thirst', name: 'Red Thirst', arcana: 'major', domains: ['blood'],
    fate: 'You heal only by striking, and bleed when you rest.',
    effect: {
      transform: [
        { rule: 'suppress-passive-heal' },            // fires/fountains/potions do nothing
        { rule: 'hp-drain', per: 'out-of-combat', amount: 2 },   // HP/sec while out of combat
      ],
      // ...but every blow you land drinks a little (the only way you mend now).
      triggers: [{ on: 'hit', chance: 1, effect: { type: 'heal', amount: 2, target: 'self' } }],
    },
  },
  // PACT — unkillable but ponderous. Endure as the dead endure.
  'the-hollow-saint': {
    id: 'the-hollow-saint', name: 'The Hollow Saint', arcana: 'major', domains: ['bone'],
    fate: 'You endure as the dead endure — slow, and past caring.',
    effect: { modifiers: [{ kind: 'max-hp', amount: 4 }, { kind: 'action-speed-mult', amount: 0.90 }] },   // +2 hearts — the tank pact, still the biggest maxHP source
  },
  // PROC — each death feeds the next. On kill, a short fury (self).
  'the-feast': {
    id: 'the-feast', name: 'The Feast', arcana: 'major', domains: ['blood'],
    fate: 'Each death feeds the next.',
    effect: { triggers: [{ on: 'kill', chance: 1, effect: { type: 'apply-buff', buffId: 'berserk', duration: 3, target: 'self' } }] },
  },
  // PROC — your blows fester. On hit, a chance to inflict bleed on the struck.
  'the-pyre': {
    id: 'the-pyre', name: 'The Pyre', arcana: 'major', domains: ['rot'],
    fate: 'Your blows fester and weep.',
    effect: { triggers: [{ on: 'hit', chance: 0.35, effect: { type: 'apply-buff', buffId: 'bleed', duration: 4, target: 'victim' } }] },
  },
  // BRINK — cornered, you become ruin. Huge damage below a third HP, but you
  // take more too: the dungeon's cruel bargain with the desperate.
  'the-martyr': {
    id: 'the-martyr', name: 'The Martyr', arcana: 'major', domains: ['valor', 'blood'],
    fate: 'Cornered, you are most terrible.',
    effect: {
      conditional: [{
        condition: { kind: 'below-hp-pct', value: 0.30 },
        modifiers: [{ kind: 'damage-multiplier', amount: 1.6 }, { kind: 'incoming-damage-mult', amount: 1.25 }],
      }],
    },
  },
  // BRINK — the last blow of the cornered is heaviest. Finisher always hits
  // harder; below half HP, far harder.
  'the-oath': {
    id: 'the-oath', name: 'The Oath', arcana: 'major', domains: ['valor'],
    fate: 'Your last blow is the heaviest — heavier still when it is your last.',
    effect: {
      modifiers: [{ kind: 'finisher-damage-mult', amount: 0.5 }],
      conditional: [{
        condition: { kind: 'below-hp-pct', value: 0.5 },
        modifiers: [{ kind: 'finisher-damage-mult', amount: 1.0 }],
      }],
    },
  },
  // RESONANCE — every fate you hoard sharpens the blade. Scales with the WHOLE
  // Spread, so it rewards a deep collection (the greed domain's promise).
  'the-tally': {
    id: 'the-tally', name: 'The Tally', arcana: 'major', domains: ['greed'],
    fate: 'Every fate you hoard whets the edge.',
    effect: { synergy: [{ per: 'card', modifiers: [{ kind: 'weapon-damage', amount: 1 }], max: 12 }] },
  },
  // RESONANCE — the light gathers. Each grace card you hold thickens the ward.
  'the-lantern': {
    id: 'the-lantern', name: 'The Lantern', arcana: 'major', domains: ['grace'],
    fate: 'The kind light gathers, and wards.',
    effect: {
      modifiers: [{ kind: 'magic-armor', amount: 3 }],
      synergy: [{ per: 'domain', domain: 'grace', modifiers: [{ kind: 'physical-armor', amount: 1 }], max: 6 }],
    },
  },
  // RESONANCE — you strike true by starlight; the more of the dawn you carry,
  // the surer the killing blow.
  'the-star': {
    id: 'the-star', name: 'The Star', arcana: 'major', domains: ['dawn'],
    fate: 'You strike true by its light.',
    effect: {
      modifiers: [{ kind: 'crit-mult', amount: 0.5 }],
      synergy: [{ per: 'domain', domain: 'dawn', modifiers: [{ kind: 'crit-chance', amount: 0.04 }], max: 6 }],
    },
  },
  // PACT — light you carry down. A clean, gentle boon (the rare no-cost fate).
  'the-dawn': {
    id: 'the-dawn', name: 'The Dawn', arcana: 'major', domains: ['dawn'],
    fate: 'You carry the light down.',
    effect: { modifiers: [{ kind: 'max-hp', amount: 3 }, { kind: 'physical-armor', amount: 2 }] },
  },
  // PACT — fast and forbidden. Mobility + edge, no real cost; the wanderer's gift.
  'the-wanderer': {
    id: 'the-wanderer', name: 'The Wanderer', arcana: 'major', domains: ['forbidden'],
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
 * Unknown ids are skipped.
 */
export function cardModifiers(heldCardIds: readonly string[]): StatModifier[] {
  const out: StatModifier[] = [];
  for (const id of heldCardIds) {
    const card = CARDS[id];
    if (card?.effect.modifiers) out.push(...card.effect.modifiers);
  }
  return out;
}

/** RESONANCE: resolve synergy bonuses into flat StatModifiers, scaled by how
 *  many kin you hold. Pure — counts over the held set, no entity needed — so it
 *  folds into aggregateModifiers exactly like cardModifiers. Held ids are
 *  distinct (grantCard dedupes), so a count is "distinct held cards matching". */
export function cardSynergyModifiers(heldCardIds: readonly string[]): StatModifier[] {
  const held = heldCardIds.map((id) => CARDS[id]).filter(Boolean) as CardSpec[];
  const out: StatModifier[] = [];
  for (const card of held) {
    for (const syn of card.effect.synergy ?? []) {
      let count = 0;
      for (const c of held) {
        if (syn.includeSelf === false && c.id === card.id) continue;
        const match =
          syn.per === 'card' ? true
          : syn.per === 'major' ? c.arcana === 'major'
          : syn.per === 'minor' ? c.arcana === 'minor'
          : !!syn.domain && c.domains.includes(syn.domain);
        if (match) count++;
      }
      const n = Math.min(count, syn.max ?? 99);
      for (let i = 0; i < n; i++) out.push(...syn.modifiers);
    }
  }
  return out;
}

/** How many held cards belong to a domain — the count both card synergy and
 *  RITE morph read (the active lane's Resonance). Pure. */
export function heldDomainCount(heldCardIds: readonly string[], domain: Domain): number {
  let n = 0;
  for (const id of heldCardIds) if (CARDS[id]?.domains.includes(domain)) n++;
  return n;
}

/** TRANSFORM: the rule-overrides from held cards. Folded into activeTransforms()
 *  (combat/transforms.ts) alongside any item transforms — pure, like the others. */
export function cardTransforms(heldCardIds: readonly string[]): Transform[] {
  const out: Transform[] = [];
  for (const id of heldCardIds) {
    const card = CARDS[id];
    if (card?.effect.transform) out.push(...card.effect.transform);
  }
  return out;
}

/** BRINK: the conditional modifier bundles from held cards. Returned unevaluated
 *  — the stat pipeline (modifiers.ts) owns the live HP check (evaluateModifier-
 *  Condition), so cards reuse the exact same gate items use. */
export function cardConditionalBundles(
  heldCardIds: readonly string[],
): { condition: CardCondition; modifiers: StatModifier[] }[] {
  const out: { condition: CardCondition; modifiers: StatModifier[] }[] = [];
  for (const id of heldCardIds) {
    const card = CARDS[id];
    if (card?.effect.conditional) out.push(...card.effect.conditional);
  }
  return out;
}

/** PROC (self): synthesize PassiveSpecs for ON-KILL / ON-CRIT triggers — the
 *  "fury" procs that buff YOU. These ride the ONE trigger path (ecs/triggers.ts
 *  fireTriggers) alongside item passives — no parallel engine. ON-HIT hexes go
 *  through cardOnHitVictim instead (that path knows which enemy was struck). */
export function cardTriggerPassives(heldCardIds: readonly string[]): PassiveSpec[] {
  const out: PassiveSpec[] = [];
  for (const id of heldCardIds) {
    const card = CARDS[id];
    if (!card?.effect.triggers) continue;
    card.effect.triggers.forEach((t, i) => {
      // ON-HIT + victim (a hex on whatever you struck) routes through the
      // victim-aware on-hit channel instead — it knows the struck enemy. Self-
      // targeted on-hit (e.g. heal-on-hit) and all kill/crit procs ride here.
      if (isVictimOnHit(t)) return;
      const on: TriggerEvent = t.on === 'kill' ? 'killed' : t.on === 'crit' ? 'crit' : 'hit';
      out.push({
        id: `card:${card.id}:${i}`,
        trigger: { on, chance: t.chance, effects: [t.effect] },
      });
    });
  }
  return out;
}

/** Is this an on-hit hex meant for the struck enemy? On-hit defaults to the
 *  victim (a hit applies TO what you hit); only an explicit target:'self' opts
 *  out (e.g. heal-on-hit, which goes through the trigger path instead). */
function isVictimOnHit(t: CardTrigger): boolean {
  return t.on === 'hit' && (t.effect.target ?? 'victim') === 'victim';
}

/** PROC (victim): the ON-HIT hexes a held card inflicts on whatever you strike —
 *  same shape the weapon/affix on-hit system uses, so combat applies them to the
 *  struck enemy in the SAME loop (attack.ts), with the victim in hand. A card
 *  that "festers" your blows is just another on-hit source, like a serrated edge.
 *  (The victim on-hit channel is buff-only today, so non-buff victim effects are
 *  skipped here — widen getPlayerOnHits to EffectSpec if a card ever needs one.) */
export function cardOnHitVictim(
  heldCardIds: readonly string[],
): { buffId: string; chance: number; duration: number }[] {
  const out: { buffId: string; chance: number; duration: number }[] = [];
  for (const id of heldCardIds) {
    const card = CARDS[id];
    for (const t of card?.effect.triggers ?? []) {
      if (isVictimOnHit(t) && t.effect.type === 'apply-buff' && t.effect.buffId) {
        out.push({ buffId: t.effect.buffId, chance: t.chance, duration: t.effect.duration ?? 0 });
      }
    }
  }
  return out;
}
