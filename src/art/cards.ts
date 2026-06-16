/**
 * Tarot card art specs — the content-layer DATA the art pipeline consumes.
 * One entry per card; `art` is the per-card subject fragment that follows the
 * shared STYLE. See docs/TAROT-CONCEPT.md for the design (the dungeon's deck,
 * the Reversal, light-as-exposure, domain=colour).
 *
 * `accent` is the card's single spot colour — its DOMAIN made visible. The ink
 * treatment stays constant across the deck; the accent is what varies, so the
 * deck reads as one hand while a glance tells you a card's allegiance.
 * `seed` is fixed so a regeneration is reproducible — reroll the seed, not the
 * model, and fork promising runs with `delve art card <id> --from rX --tweak`.
 */

export type Domain = 'blood' | 'bone' | 'greed' | 'rot' | 'mercy' | 'arcane';

export interface CardArtSpec {
  id: string;
  name: string;
  arcana: 'minor' | 'major';
  /** Which face of fate this card belongs to (weights the deck via the Mark). */
  domain: Domain;
  /** The single spot colour for this card's domain (woven into the prompt). */
  accent: string;
  /** The subject fragment appended to STYLE. Describe WHAT, not the look. */
  art: string;
  seed: number;
}

export const CARD_ART: CardArtSpec[] = [
  // ── Greed — tarnished gold ──────────────────────────────────────────────
  {
    id: 'the-glutton', name: 'The Glutton', arcana: 'minor', domain: 'greed',
    accent: 'tarnished gold',
    art: 'a bloated robed figure gorging in the dark over a heaped table of viscera and bones, swollen hands, greed made flesh, a single guttering candle',
    seed: 1001,
  },
  // ── Blood / Wrath — crimson ─────────────────────────────────────────────
  {
    id: 'the-hound', name: 'The Hound', arcana: 'minor', domain: 'blood',
    accent: 'dried-blood crimson',
    art: 'a gaunt black hunting hound mid-lunge, ribs showing, jaws open, eyes catching the light, chain trailing from a broken collar',
    seed: 1002,
  },
  {
    id: 'red-thirst', name: 'Red Thirst', arcana: 'major', domain: 'blood',
    accent: 'crimson',
    art: 'a kneeling armoured delver drinking from cupped hands brimming with blood, crimson running down the wrists, ecstatic and ruined, faint glow from below',
    seed: 1003,
  },
  // ── Bone / Death — cold bone-white (near-colourless: absence is the accent)
  {
    id: 'the-hollow-saint', name: 'The Hollow Saint', arcana: 'major', domain: 'bone',
    accent: 'cold bone white',
    art: 'a towering skeletal saint enthroned, a halo of guttered candles, hollow ribcage open like a reliquary, hands raised in a blessing that is also a verdict, ossuary behind',
    seed: 2001,
  },
  // ── Mercy / Light — pale moonlight (the lure: beautiful, ominous) ────────
  {
    id: 'the-lantern', name: 'The Lantern', arcana: 'major', domain: 'mercy',
    accent: 'pale moonlight blue',
    art: 'a veiled figure offering a single radiant lantern out of total darkness, the light too kind for this place, moths and pale hands reaching from the black toward it',
    seed: 3001,
  },
  // ── Arcane / Wonder — the reserved violet ────────────────────────────────
  {
    id: 'the-wanderer', name: 'The Wanderer', arcana: 'major', domain: 'arcane',
    accent: 'arcane violet',
    art: 'a cloaked pilgrim at the lip of an endless stair, a single violet star burning above, vast and indifferent, the figure small against the dark immensity',
    seed: 4001,
  },
  // ── Rot / Decay — sickly green ───────────────────────────────────────────
  {
    id: 'the-worm', name: 'The Worm', arcana: 'minor', domain: 'rot',
    accent: 'sickly green',
    art: 'a fat pale grave-worm coiled through a cracked skull, feasting, patient and blind, threads of decay, simple iconographic composition',
    seed: 5001,
  },
];
