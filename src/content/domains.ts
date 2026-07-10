/**
 * DOMAINS — the abstract identities you BECOME by committing to them.
 *
 * A domain is an ABSTRACT, not a mechanic. It is defined (it means a specific
 * thing — a fantasy, a pole, a register) but it is deliberately NOT locked to
 * any number or verb. The CONTENT — relics, cards, rites — is what makes a
 * domain concrete, composed from the status substrate (see docs/STATUS-EFFECTS.md,
 * content/buffs.ts). This is the interface between layers (CLAUDE.md authoring
 * model): the design/narration/content LLM layers author against a domain's
 * `fantasy` + `register` + `affinities`, and the mechanics fall out of the
 * substrate primitives they compose — never a bespoke code path per domain.
 *
 * Two consequences the abstraction buys us:
 *   1. **LLM-authorable.** A domain hands the content layer everything it needs
 *      to write on-theme (the fantasy to express, the register for art/voice,
 *      the affinity palette of substrate hooks to compose) WITHOUT dictating the
 *      exact effect. New Blood content is "author a relic that expresses Blood
 *      using bleed/lifesteal/health-cost," not "edit the Blood mechanic."
 *   2. **Season/run-mutable.** Because mechanics live in content, not here, the
 *      content pool can rotate — a season re-authors Blood's expression, a run
 *      can twist it (a Mark, a floor card) — while the domain's IDENTITY holds.
 *      The engine never changes; the deck does.
 *
 * `affinities` is the coherence LEASH: a soft palette of substrate hooks the
 * domain leans on. It keeps authored content FEELING like the domain (and
 * roughly in-band, because it's built from balance-railed primitives) without
 * hard-coding what the domain DOES. Known hooks autocomplete; new ones are
 * allowed (the `(string & {})` tail) — defined, not locked.
 *
 * The 9 ids + the DARK→LIGHT ordering are shared with the art layer
 * (art/cards.ts re-exports `Domain` from here; art/domains.ts holds the sigil +
 * UI colour). This file is the gameplay-side source of truth for what a domain
 * IS; the concrete numbers live in the content that tags it.
 */

/** The nine domain ids. Canonical here; `Domain` in art/cards.ts aliases this. */
export type DomainId =
  // CORRUPTIONS — what the deep makes of your flesh (embrace → grotesque power)
  | 'blood' | 'bone' | 'rot' | 'ash'
  // VIRTUES — what you hold onto (the delver's defiance; stay yourself)
  | 'dawn' | 'grace' | 'valor'
  // VICES — what tempts you deeper (avarice + transgression)
  | 'greed' | 'forbidden';

/** The three poles of the corruption↔humanity spine (body / soul / will). */
export type DomainPole = 'corruption' | 'virtue' | 'vice';

/**
 * A substrate hook a domain leans on. The union names the primitives that exist
 * (or are near) in content/buffs.ts + the combat economy; the `(string & {})`
 * tail keeps it OPEN — a new season can introduce a hook without a type change.
 * This is "defined but not locked" as a type.
 */
export type Affinity =
  // status substrate (content/buffs.ts)
  | 'bleed' | 'burn' | 'poison' | 'chill' | 'sunder'
  // combat-economy hooks
  | 'lifesteal' | 'health-cost' | 'crit' | 'execute' | 'deflect' | 'poise'
  | 'stagger' | 'fear' | 'curse' | 'hunger' | 'economy' | 'mobility'
  | (string & {});

/** The stable, LLM-facing abstract for one domain. No mechanics live here. */
export interface DomainSpec {
  id: DomainId;
  /** Display name ('Blood'). */
  name: string;
  /** Which pole of the spine — how much of yourself the domain trades. */
  pole: DomainPole;
  /**
   * The combat verb this domain OWNS (from BUILD-ECONOMY §6). A HINT for
   * authoring coherence + the primary affinity, NOT a lock — content can lean
   * elsewhere in the affinity palette. Kept terse.
   */
  verb: string;
  /**
   * The fantasy in prose — the thing content expresses and narration speaks.
   * This is the LLM authoring seed AND the coherence tether: on-theme content
   * reads back to this sentence. Written in the register it evokes.
   */
  fantasy: string;
  /** Presentation tokens shared by art + narration so a domain reads coherent. */
  register: {
    /** Hex UI/accent colour (mirrors art/domains.ts DOMAIN_VISUAL). */
    color: number;
    /** The single spot-colour word woven into art prompts. */
    accent: string;
    /** Grotesque descriptor tokens — the art layer's palette for this domain. */
    artTokens: readonly string[];
  };
  /**
   * The soft palette of substrate hooks this domain leans on — the coherence
   * leash for authored content (see file header). First entry = primary.
   */
  affinities: readonly Affinity[];
}

export const DOMAINS: Record<DomainId, DomainSpec> = {
  // ── CORRUPTIONS (your body) ──────────────────────────────────────────────
  blood: {
    id: 'blood',
    name: 'Blood',
    pole: 'corruption',
    verb: 'lifesteal-on-violence + bleed',
    fantasy:
      'Aggression is currency; life is ammunition. You do not survive fights — you feed on them. ' +
      'Commit far enough and you become a gore-soaked thing that leaves a trail and erupts, healed only ' +
      'by the wound you open in someone else.',
    register: {
      color: 0xc5402f,
      accent: 'crimson',
      artTokens: ['gorged', 'wet', 'arterial', 'glistening', 'blood-slick', 'drained-grey'],
    },
    affinities: ['bleed', 'lifesteal', 'health-cost'],
  },
  bone: {
    id: 'bone',
    name: 'Bone',
    pole: 'corruption',
    verb: 'poise / stagger + guard',
    fantasy:
      'You stop flinching. The dead do not. You become the unyielding thing in the dark — ' +
      'poise that will not break, a guard that grinds the living down, a patience older than pain.',
    register: {
      color: 0xe6ddca,
      accent: 'bone white',
      artTokens: ['calcified', 'yellowed', 'fused-bone', 'sinew-dry', 'reliquary', 'ossified'],
    },
    affinities: ['poise', 'stagger', 'sunder'],
  },
  rot: {
    id: 'rot',
    name: 'Rot',
    pole: 'corruption',
    verb: 'damage-over-time + anti-heal',
    fantasy:
      'You become the plague the deep breeds. Nothing you touch stays whole; wounds fester, healing ' +
      'curdles, and time itself is a weapon you wield against anything still trying to live.',
    register: {
      color: 0x86b33f,
      accent: 'sickly green',
      artTokens: ['festering', 'weeping', 'blistered', 'maggot-riddled', 'slick-with-pus', 'grave-mould'],
    },
    affinities: ['poison', 'curse', 'health-cost'],
  },
  ash: {
    id: 'ash',
    name: 'Ash',
    pole: 'corruption',
    verb: 'fire / burn / crowd-AoE',
    fantasy:
      'You carry the fire the deep fears. A living cinder — you burn, you spread, you leave ash where ' +
      'a pack stood. What you touch remembers heat long after you have gone.',
    register: {
      color: 0xd9772e,
      accent: 'ember orange',
      artTokens: ['charred', 'smouldering', 'cinder-flecked', 'heat-warped', 'ember-lit', 'ash-caked'],
    },
    affinities: ['burn', 'fear'],
  },
  // ── VIRTUES (your soul) ──────────────────────────────────────────────────
  dawn: {
    id: 'dawn',
    name: 'Dawn',
    pole: 'virtue',
    verb: 'crit / execute',
    fantasy:
      'You keep the killing light. Not power — precision: the one clean strike that ends a thing before ' +
      'it can become worse. You stay a person by being merciful the only way the deep understands — quickly.',
    register: {
      color: 0xf2d57e,
      accent: 'pale gold-white',
      artTokens: ['radiant', 'gilded', 'clean-edged', 'sun-struck', 'unblemished', 'searing-white'],
    },
    affinities: ['crit', 'execute'],
  },
  grace: {
    id: 'grace',
    name: 'Grace',
    pole: 'virtue',
    verb: 'deflect / parry + the only true heal',
    fantasy:
      'You endure by mastery, not by monstrousness. The perfect deflect, the turned blade, the mercy that ' +
      'mends — the one lane where healing is still clean, bought with skill instead of someone else’s blood.',
    register: {
      color: 0xe0a860,
      accent: 'warm amber',
      artTokens: ['warm-lit', 'candle-gilt', 'serene', 'unbroken', 'haloed', 'steadfast'],
    },
    affinities: ['deflect', 'lifesteal'],
  },
  valor: {
    id: 'valor',
    name: 'Valor',
    pole: 'virtue',
    verb: 'charge / finisher / brink',
    fantasy:
      'You answer the dark by walking into it. Power that wakes when you are dying, a finisher that lands ' +
      'hardest at the edge — the desperate hero who is most dangerous the moment before the end.',
    register: {
      color: 0xbcc6cd,
      accent: 'steel silver',
      artTokens: ['battle-worn', 'steel-bright', 'scarred', 'defiant', 'blood-flecked-steel', 'unbowed'],
    },
    affinities: ['execute', 'stagger'],
  },
  // ── VICES (your will) ────────────────────────────────────────────────────
  greed: {
    id: 'greed',
    name: 'Greed',
    pole: 'vice',
    verb: 'economy (gold / cards / hunger) + gambling',
    fantasy:
      'You want more, and the deep is happy to deal. Gold, cards, Hunger — every system bends toward the ' +
      'collector who will risk what they have for what they might get. Avarice as a build.',
    register: {
      color: 0xc9a23c,
      accent: 'gold',
      artTokens: ['gilded', 'hoarded', 'coin-crusted', 'avaricious', 'tarnished-gold', 'over-adorned'],
    },
    affinities: ['economy', 'hunger'],
  },
  forbidden: {
    id: 'forbidden',
    name: 'Forbidden',
    pole: 'vice',
    verb: 'just-dodge / mobility + rule-breaking',
    fantasy:
      'You go where you should not and take what is not offered. The trespasser — mobility, the just-dodge, ' +
      'and the quiet breaking of the deep’s own rules. Every step deeper is a transgression that pays.',
    register: {
      color: 0xa86ef0,
      accent: 'violet',
      artTokens: ['sigil-branded', 'wrapped', 'sealed', 'occult', 'forbidden-marked', 'unlight'],
    },
    affinities: ['mobility', 'curse'],
  },
};

/** Every domain id, in the canonical DARK→LIGHT order. */
export const DOMAIN_IDS = Object.keys(DOMAINS) as DomainId[];

/** Look up a domain abstract by id. */
export function getDomain(id: DomainId): DomainSpec {
  return DOMAINS[id];
}

/** All domains on a given pole (body / soul / will). */
export function domainsByPole(pole: DomainPole): DomainSpec[] {
  return DOMAIN_IDS.map((id) => DOMAINS[id]).filter((d) => d.pole === pole);
}

/** True when a domain lists `hook` in its affinity palette (coherence check for
 *  content authoring / Resonance tooling). */
export function domainHasAffinity(id: DomainId, hook: Affinity): boolean {
  return DOMAINS[id].affinities.includes(hook);
}
