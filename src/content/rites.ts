// RITES — the active lane. A rite is a domain-flavoured ACTIVE you slot and fire
// with HUNGER (built by fighting). It's its OWN collectible (found in the deep,
// own slot), but its power MORPHS with your domain cards — the active expression
// of the same identity your Spread passively builds. Found, not card-bound:
// usable at base with zero matching cards, escalating (grotesque) as you commit.
//
// COMPOSABLE EFFECTS (docs/BUILD-ECONOMY.md). A rite is a LIST of effect
// primitives run on activation. Each primitive REUSES a system that already
// exists — the damage pass, the health pool, the BUFF pipeline (the same one
// items/affixes/cards flow through), projectiles, hazard-fields — so a new rite
// is DATA, not executor code. Combat/rites.ts is the thin orchestrator: one
// handler per effect kind. New KINDS extend the vocabulary deliberately (that's
// the "expand as we author" seam); individual rites just compose what's there.

import type { Domain } from '../art/cards';

/** One composable step of a rite. Add kinds here (+ a handler in combat/rites.ts)
 *  to widen what rites can DO; existing rites are unaffected. */
export type RiteEffect =
  // AoE erupt around the player: damage everyone in radius, optionally take blood
  // back (healPerHit) and/or brand each caught with a buff (burn/poison/bleed…).
  | { kind: 'nova'; radius: number; damage: number; healPerHit?: number; buff?: string; buffDuration?: number }
  // Spend your own blood — the risk. Floored at 1 HP by the executor.
  | { kind: 'cost'; hp: number }
  // Heal yourself outright.
  | { kind: 'heal'; hp: number }
  // Empower yourself — apply a buff to the PLAYER. Flows through the same
  // modifier pipeline as an item, just time-boxed. e.g. 'berserk', 'ironhide'.
  | { kind: 'selfBuff'; buff: string; duration: number };

/** A morph tier (the active lane's RESONANCE): hold >= `atLeast` cards of the
 *  rite's domain and these escalations apply, cumulatively — reshaping the
 *  resolved effect list. Same "scales with your commitment" idea as card synergy. */
export interface RiteMorphTier {
  atLeast: number;
  radiusMul?: number;   // scales every nova's radius
  damageMul?: number;   // scales every nova's damage
  freeCost?: boolean;   // zeroes every 'cost' effect — the blood price is lifted
  novaBuff?: string;    // brands every nova with this buff (the grotesque turn)
  add?: RiteEffect[];   // appends effects at this tier
}

export interface RiteSpec {
  id: string;
  name: string;
  domain: Domain;
  hungerCost: number;
  /** One-line identity (broadcast register). */
  fate: string;
  /** Base effects — what it does with ZERO matching-domain cards. */
  effects: RiteEffect[];
  /** Escalations as your domain commits (the morph). */
  morph?: RiteMorphTier[];
}

export const RITES: Record<string, RiteSpec> = {
  // ── CADENCE: hungerCost IS the cooldown. Cheap rites fire OFTEN; expensive
  // ones are BIG and rare (a near-full meter). Hunger banks ~10/kill, cap 100. ──

  // FREQUENT — cheap, small, no blood price. A quick bone burst you lean on.
  gnash: {
    id: 'gnash', name: 'Gnash', domain: 'bone', hungerCost: 22,
    fate: 'The bones you are owed, collected early.',
    effects: [{ kind: 'nova', radius: 2.6, damage: 5 }],
    morph: [
      { atLeast: 2, damageMul: 1.4 },
      { atLeast: 4, radiusMul: 1.4, novaBuff: 'bleed' },
    ],
  },

  // MEDIUM — blood erupt: pay blood, take it back from everyone caught. Grows
  // grotesque — bleeds them at 2, then at 4 the price is lifted and it goes huge.
  hemorrhage: {
    id: 'hemorrhage', name: 'Hemorrhage', domain: 'blood', hungerCost: 50,
    fate: 'You burst, and the blood is yours to take back.',
    effects: [
      { kind: 'cost', hp: 6 },
      { kind: 'nova', radius: 3.5, damage: 7, healPerHit: 1 },
    ],
    morph: [
      { atLeast: 2, novaBuff: 'bleed' },
      { atLeast: 4, freeCost: true, radiusMul: 1.5, damageMul: 1.5 },
    ],
  },

  // MEDIUM — a rot cloud; no blood price, but everyone caught festers (poison).
  miasma: {
    id: 'miasma', name: 'Miasma', domain: 'rot', hungerCost: 46,
    fate: 'Breathe out the rot. Let it settle into them.',
    effects: [{ kind: 'nova', radius: 4.0, damage: 3, buff: 'poison', buffDuration: 5 }],
    morph: [
      { atLeast: 2, radiusMul: 1.3 },
      { atLeast: 4, damageMul: 1.8 },
    ],
  },

  // BIG — a long-charge ash cataclysm. Huge, heavy, ignites, a real blood price.
  immolation: {
    id: 'immolation', name: 'Immolation', domain: 'ash', hungerCost: 92,
    fate: 'Everything near becomes ash. Yourself, very nearly, among it.',
    effects: [
      { kind: 'cost', hp: 12 },
      { kind: 'nova', radius: 5.5, damage: 14, buff: 'burn', buffDuration: 4 },
    ],
    morph: [
      { atLeast: 2, damageMul: 1.4 },
      { atLeast: 4, freeCost: true, radiusMul: 1.3 },
    ],
  },

  // SHOWCASE of the composable vocabulary — a NON-nova rite. No erupt at all: you
  // go berserk and shrug off blows for a window (buffs through the item pipeline).
  // Morph ADDS effects — a heal at 2, lifesteal at 4.
  zealotry: {
    id: 'zealotry', name: 'Zealotry', domain: 'valor', hungerCost: 44,
    fate: 'For a moment you are the thing that should be feared.',
    effects: [
      { kind: 'selfBuff', buff: 'berserk', duration: 6 },
      { kind: 'selfBuff', buff: 'ironhide', duration: 6 },
    ],
    morph: [
      { atLeast: 2, add: [{ kind: 'heal', hp: 3 }] },
      { atLeast: 4, add: [{ kind: 'selfBuff', buff: 'bloodthirst', duration: 6 }] },
    ],
  },
};

export function getRiteSpec(id: string): RiteSpec | undefined {
  return RITES[id];
}

/** Resolve a rite's LIVE effect list given how many of its domain's cards you
 *  hold. Pure — applies each qualifying morph tier to a copy of the effects. */
export function resolveRite(spec: RiteSpec, domainCount: number): RiteEffect[] {
  const effects: RiteEffect[] = spec.effects.map((e) => ({ ...e }));
  for (const t of spec.morph ?? []) {
    if (domainCount < t.atLeast) continue;
    for (const e of effects) {
      if (e.kind === 'nova') {
        if (t.radiusMul) e.radius *= t.radiusMul;
        if (t.damageMul) e.damage *= t.damageMul;
        if (t.novaBuff) e.buff = t.novaBuff;
      } else if (e.kind === 'cost' && t.freeCost) {
        e.hp = 0;
      }
    }
    if (t.add) for (const e of t.add) effects.push({ ...e });
  }
  return effects;
}
