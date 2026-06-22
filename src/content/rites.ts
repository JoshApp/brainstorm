// RITES — the active lane. A rite is a domain-flavoured ACTIVE you slot and fire
// with HUNGER (built by fighting). It's its OWN collectible (found in the deep,
// own slot), but its power MORPHS with your domain cards — the active expression
// of the same identity your Spread passively builds. Found, not card-bound:
// usable at base with zero matching cards, escalating (grotesque) as you commit.
//
// Data-driven like cards/items: a rite is DATA (a 'nova' shape + morph tiers);
// combat/rites.ts is the thin executor. New rite KINDS extend the shape later;
// for now every rite is a nova (an erupt around the player).

import type { Domain } from '../art/cards';

/** The resolved active — a nova erupting around the player. */
export interface RiteNova {
  radius: number;        // metres of the erupt
  selfHpCost: number;    // HP you spend to erupt (0 when a morph frees it)
  damage: number;        // damage to each enemy caught
  healPerHit: number;    // HP healed per enemy struck (the blood you take back)
  applyBleed: boolean;   // also inflict bleed on the caught
}

/** A morph tier (the active lane's RESONANCE): hold >= `atLeast` cards of the
 *  rite's domain and these escalations apply, cumulatively. Same "scales with
 *  your commitment" idea as card synergy — here it reshapes the active. */
export interface RiteMorphTier {
  atLeast: number;
  radiusMul?: number;
  damageMul?: number;
  freeHpCost?: boolean;
  applyBleed?: boolean;
}

export interface RiteSpec {
  id: string;
  name: string;
  domain: Domain;
  hungerCost: number;
  /** One-line identity (broadcast register). */
  fate: string;
  /** Base form — what it does with ZERO matching-domain cards. */
  base: RiteNova;
  /** Escalations as your domain commits (the morph). */
  morph?: RiteMorphTier[];
}

export const RITES: Record<string, RiteSpec> = {
  // BLOOD rite — erupt, spend your own blood, take it back from everyone you
  // catch. Morphs grotesque as the Blood claims you: bleeds them at 2, then at
  // 4 it stops costing your blood and goes huge — you bleed power freely.
  hemorrhage: {
    id: 'hemorrhage', name: 'Hemorrhage', domain: 'blood', hungerCost: 50,
    fate: 'You burst, and the blood is yours to take back.',
    base: { radius: 3.5, selfHpCost: 6, damage: 12, healPerHit: 4, applyBleed: false },
    morph: [
      { atLeast: 2, applyBleed: true },
      { atLeast: 4, freeHpCost: true, radiusMul: 1.5, damageMul: 1.5 },
    ],
  },
};

export function getRiteSpec(id: string): RiteSpec | undefined {
  return RITES[id];
}

/** Resolve a rite's LIVE form given how many of its domain's cards you hold.
 *  Pure — the morph reads domain commitment (the active lane's Resonance). */
export function resolveRite(spec: RiteSpec, domainCount: number): RiteNova {
  const out: RiteNova = { ...spec.base };
  for (const t of spec.morph ?? []) {
    if (domainCount < t.atLeast) continue;
    if (t.radiusMul) out.radius *= t.radiusMul;
    if (t.damageMul) out.damage *= t.damageMul;
    if (t.freeHpCost) out.selfHpCost = 0;
    if (t.applyBleed) out.applyBleed = true;
  }
  return out;
}
