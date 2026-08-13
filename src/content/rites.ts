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
import type { ContentStatus } from './content-status';

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
  | { kind: 'selfBuff'; buff: string; duration: number }
  // STOP THE WORLD. Scales the world clock — enemies, projectiles, ambient FX —
  // and never the player's, so you act at full speed through a room that has
  // forgotten how. `seconds` is REAL time; `deep` is the floor (0.12 = 12%
  // speed). Rides combat/rite-stillness.ts, which is the reactive-defense
  // bullet-time asymmetry made deliberate and paid for.
  | { kind: 'stillness'; seconds: number; deep?: number }
  // STEP THROUGH. Teleport up to `distance` metres along your facing, landing on
  // the far side of whatever is between. Uses the DODGE's own walkability probe,
  // so a blink can never put you somewhere a dodge couldn't: no through-walls,
  // no landing inside a pillar. Falls short rather than failing when the full
  // distance is blocked — the rite always does SOMETHING for its Hunger.
  | { kind: 'blink'; distance: number }
  // BREAK THEIR NERVE. Fear everything in radius — they rout, hang a skull, wear
  // DREAD and turn their backs to you. No damage of its own: this is CONTROL,
  // and it composes with the poise/backstab loop rather than duplicating it (a
  // fleeing creature is an open creature). Refused by bosses, as all fear is.
  | { kind: 'fear'; radius: number; seconds: number }
  // SHOULDER THROUGH. Rush `distance` metres along your facing, damaging and
  // SHOVING everything you pass through. The movement half reuses the blink's
  // walkability probe, so a charge can never end somewhere a dodge couldn't; the
  // contact half sweeps the path rather than testing the endpoints, so bodies in
  // the middle are hit rather than run past.
  | { kind: 'charge'; distance: number; damage: number; radius?: number; knockback?: number; buff?: string; buffDuration?: number };

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
  /** Include-flag: omit = 'release'. 'dev'/'draft' gate this out of a normal
   *  production build (see content-status.ts). */
  status?: ContentStatus;
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

  // ── THE LANE THAT ISN'T AN ERUPT ────────────────────────────────────────────
  // Every rite above ends a fight faster. These two change how it is PLAYED,
  // which is the gap the vocabulary had: five rites that were one rite at five
  // sizes. Neither of them deals a point of damage.

  // FREQUENT — the step through. Cheap enough to lean on as movement, which is
  // the point: it is a traversal verb that happens to be a defensive one, and it
  // can never put you anywhere a dodge couldn't (the same walkability probe).
  // Morph turns it from an escape into a repositioning tool and finally into a
  // way to be somewhere you should not be able to reach.
  stepthrough: {
    id: 'stepthrough', name: 'Step-Through', domain: 'grace', hungerCost: 18,
    fate: 'The distance was never as fixed as it looked.',
    effects: [{ kind: 'blink', distance: 4.0 }],
    morph: [
      { atLeast: 2, add: [{ kind: 'blink', distance: 1.5 }] },
      { atLeast: 4, add: [{ kind: 'selfBuff', buff: 'ironhide', duration: 2.5 }] },
    ],
  },

  // BIG — the held second. The room forgets how to move and you do not. Priced
  // near the top of the meter deliberately: it is the strongest thing in the
  // catalog precisely because it doesn't kill anything, it just hands you a
  // fight you were losing. Short — a Stillness you can plan inside is a
  // Stillness that trivialises the room.
  longsecond: {
    id: 'longsecond', name: 'The Long Second', domain: 'forbidden', hungerCost: 88,
    fate: 'Everything stops. You are not everything.',
    effects: [{ kind: 'stillness', seconds: 2.6, deep: 0.12 }],
    morph: [
      { atLeast: 2, add: [{ kind: 'stillness', seconds: 3.6, deep: 0.10 }] },
      { atLeast: 4, add: [{ kind: 'selfBuff', buff: 'berserk', duration: 4 }] },
    ],
  },

  // ── THE TWO JOSH ASKED FOR ──────────────────────────────────────────────────
  // "let's make rites a reality, I want an aoe fear rite and a charge rite."
  // Both are CONTROL rather than erupt, which is what the catalog was thin on:
  // of the seven above, five end a fight faster and only two change how it is
  // played. These two are about where bodies ARE — theirs and yours.

  // ROUT THE ROOM. Everything near breaks and runs, wearing DREAD, with its back
  // to you — which is the whole poise→panic→backstab loop handed to you at once
  // (mobs/enemy.ts applyFear). Cheap, because it kills nothing: what you get is
  // ten seconds where nobody is swinging at you, and what you do with that is
  // the skill. Bosses are immune, as they are to all fear, so it never trivialises
  // the set-piece.
  //
  // 'forbidden' rather than 'bone': terror is a thing you do to a mind, and the
  // vice pole is where reaching for that lives.
  dread: {
    id: 'dread', name: 'Dread', domain: 'forbidden', hungerCost: 30,
    fate: 'They remember, all at once, what is down here with them.',
    effects: [{ kind: 'fear', radius: 6.0, seconds: 5 }],
    morph: [
      // Wider, then longer, then the turn: a routed thing bleeds as it runs.
      { atLeast: 2, add: [{ kind: 'fear', radius: 9.0, seconds: 6 }] },
      { atLeast: 4, add: [{ kind: 'selfBuff', buff: 'berserk', duration: 5 }] },
    ],
  },

  // GO THROUGH THEM. A shoulder-first rush that damages and SHOVES everything on
  // the line and puts you out the far side. The one rite that closes distance
  // rather than making it — Step-Through gets you out, this gets you IN.
  //
  // Damage is deliberately modest for the cost. What you are buying is the shove
  // and the position: a shield charge that also out-damaged a nova would make
  // every other rite a worse version of it.
  onslaught: {
    id: 'onslaught', name: 'Onslaught', domain: 'valor', hungerCost: 34,
    fate: 'The shortest way through a crowd has always been through it.',
    effects: [{ kind: 'charge', distance: 5.0, damage: 4, radius: 1.1, knockback: 9 }],
    morph: [
      { atLeast: 2, add: [{ kind: 'selfBuff', buff: 'ironhide', duration: 3 }] },
      // At full commitment the impact breaks them open rather than just moving
      // them — a charge you build toward instead of a bigger number.
      { atLeast: 4, add: [{ kind: 'charge', distance: 3.0, damage: 5, radius: 1.4, knockback: 12, buff: 'sunder', buffDuration: 5 }] },
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
