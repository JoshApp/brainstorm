/**
 * Tarot card art specs — the content-layer DATA the art pipeline consumes.
 * One entry per card; `art` is the per-card subject fragment that follows the
 * shared STYLE. A card is a SPEC, the pipeline is the system, the style is
 * locked by style.ts — same data-driven seam as the rest of DELVE's content.
 *
 * Card design (names, arcana, mechanics) lives in docs/THE-DUNGEON-NOTICES.md;
 * these are the first illustrations to prove the look. `seed` is fixed so a
 * regeneration is reproducible — change the seed to reroll a card, not the model.
 */

export interface CardArtSpec {
  /** Stable id — also the output filename (public/art/cards/<id>.png). */
  id: string;
  /** Player-facing name (rendered by the UI frame, never baked into the art). */
  name: string;
  /** 'minor' = frequent/modular, 'major' = rare/build-defining (the Spread). */
  arcana: 'minor' | 'major';
  /** The subject fragment appended to STYLE. Describe WHAT, not the look. */
  art: string;
  /** Fixed seed for reproducible regen. */
  seed: number;
}

export const CARD_ART: CardArtSpec[] = [
  {
    id: 'the-glutton',
    name: 'The Glutton',
    arcana: 'minor',
    art: 'a bloated robed figure gorging in the dark over a heaped table of viscera and bones, swollen hands, greed made flesh, a single guttering candle',
    seed: 1001,
  },
  {
    id: 'the-hound',
    name: 'The Hound',
    arcana: 'minor',
    art: 'a gaunt black hunting hound mid-lunge, ribs showing, jaws open, eyes catching the torchlight, chain trailing from a broken collar',
    seed: 1002,
  },
  {
    id: 'red-thirst',
    name: 'Red Thirst',
    arcana: 'major',
    art: 'a kneeling armoured delver drinking from cupped hands brimming with blood, crimson running down the wrists, ecstatic and ruined, faint red glow from below',
    seed: 1003,
  },
];
