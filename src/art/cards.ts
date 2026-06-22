/**
 * Tarot card art specs — the content-layer DATA the art pipeline consumes.
 * See docs/TAROT-CONCEPT.md for the design (the dungeon's deck, the Reversal,
 * domain = colour = meaning).
 *
 * Domains span DARK → LIGHT so the deck isn't monotonous: the dark is what the
 * PLACE does to you; the light is what the DELVER carries down against it. The
 * contrast is the point — a radiant card blazing in a deck of crimson and bone
 * is the lighting-doctrine signal that rare light MEANS something.
 *
 * `accent` is the card's single spot colour — its domain made visible. The ink
 * treatment stays constant; the accent varies. `seed` is fixed for reproducible
 * regen — reroll the seed, fork promising runs with `--from rX --tweak`.
 */

export type Domain =
  // CORRUPTIONS — what the dungeon makes of your flesh (embrace → grotesque)
  | 'blood' | 'bone' | 'rot' | 'ash'
  // VIRTUES — what you hold onto (the delver's defiance; stay human)
  | 'dawn' | 'grace' | 'valor'
  // VICES — what tempts you deeper (avarice + transgression)
  | 'greed' | 'forbidden';

export interface CardArtSpec {
  id: string;
  name: string;
  arcana: 'minor' | 'major';
  domain: Domain;
  /** The single spot colour for this card's domain (woven into the prompt). */
  accent: string;
  /** The subject fragment appended to STYLE. Describe WHAT, not the look. */
  art: string;
  seed: number;
}

export const CARD_ART: CardArtSpec[] = [
  // ── DARK ──────────────────────────────────────────────────────────────────
  {
    id: 'the-glutton', name: 'The Glutton', arcana: 'minor', domain: 'greed',
    accent: 'tarnished gold',
    art: 'a monstrous bloated glutton hunched over a heaped table, cramming fistfuls of viscera and gold into a gaping distended maw, jaw stretched wide, swollen and vast and ravenous, gluttony made flesh, a single guttering candle',
    seed: 1004,
  },
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
  {
    id: 'the-hollow-saint', name: 'The Hollow Saint', arcana: 'major', domain: 'bone',
    accent: 'cold bone white',
    art: 'a towering skeletal saint seated upon a great carved stone throne, dominating the frame, a halo of guttered candles behind the skull, hollow ribcage open like a reliquary, bone hands resting on the armrests, regal and dead and patient',
    seed: 2003,
  },
  {
    id: 'the-worm', name: 'The Worm', arcana: 'minor', domain: 'rot',
    accent: 'sickly green',
    art: 'a huge pale grave-worm erupting from the eye socket of a cracked skull and coiling thickly around it, glistening segmented body dominating the composition, the parasite feasting, patient and blind',
    seed: 5002,
  },
  {
    id: 'the-maw', name: 'The Maw', arcana: 'minor', domain: 'greed',
    accent: 'tarnished gold',
    art: 'a vast toothed maw gaping open in the black stone floor, gold coins and bones spilling down into it, the hunger that swallows everything',
    seed: 6001,
  },

  // ── LIGHT / HOPE ────────────────────────────────────────────────────────────
  {
    id: 'the-dawn', name: 'The Dawn', arcana: 'major', domain: 'dawn',
    accent: 'radiant pale gold-white',
    art: 'a lone delver far below at the bottom of an immense pit, one shaft of warm dawn-light breaking down from impossibly high above, the distant way up, hope sharp as grief',
    seed: 7101,
  },
  {
    id: 'the-hearth', name: 'The Hearth', arcana: 'minor', domain: 'grace',
    accent: 'soft warm amber',
    art: 'a hooded delver sitting hunched beside a small bonfire in a hollow of ruined black stone, hands held out to the warmth, a notched sword planted in the ground, broken walls around, refuge and rest carved from the dark',
    seed: 7202,
  },
  {
    id: 'the-star', name: 'The Star', arcana: 'major', domain: 'dawn',
    accent: 'radiant white-gold',
    art: 'a single pure radiant star burning over black still water, a kneeling figure cupping its light in both hands, quiet impossible hope',
    seed: 7301,
  },
  {
    id: 'the-oath', name: 'The Oath', arcana: 'major', domain: 'valor',
    accent: 'cold steel silver',
    art: 'a battered delver kneeling, raising a broken sword to their brow in a vow, jaw set, resolve hardening against the dark, defiance',
    seed: 7401,
  },
  {
    id: 'the-companion', name: 'The Companion', arcana: 'minor', domain: 'grace',
    accent: 'soft warm amber',
    art: 'two delvers in the dark, one standing and hauling a fallen comrade up by the arm, both figures fully visible, fellowship and rescue, the rarest mercy in the descent',
    seed: 7502,
  },
  {
    id: 'the-healer', name: 'The Healer', arcana: 'minor', domain: 'grace',
    accent: 'pale warm gold',
    art: 'a hooded figure laying glowing hands over a wounded delver, light pooling from the touch, pain leaving like smoke, tender and grave',
    seed: 7601,
  },

  // ── NUMINOUS ────────────────────────────────────────────────────────────────
  {
    id: 'the-lantern', name: 'The Lantern', arcana: 'major', domain: 'grace',
    accent: 'soft warm amber',
    art: 'a veiled figure offering a single radiant lantern out of total darkness, the light almost too kind for this place, pale hands reaching from the black toward it',
    seed: 3001,
  },
  {
    id: 'the-wanderer', name: 'The Wanderer', arcana: 'major', domain: 'forbidden',
    accent: 'arcane violet',
    art: 'a cloaked pilgrim at the lip of an endless stair, a single violet star burning above, vast and indifferent, the figure small against the dark immensity',
    seed: 4001,
  },
  // ── verb-majors (the build-out: PROC / BRINK / RESONANCE) ──────────────────
  {
    id: 'the-feast', name: 'The Feast', arcana: 'major', domain: 'blood',
    accent: 'crimson',
    art: 'a gore-drenched delver standing exultant over a heap of the slain, arms flung wide, fresh blood steaming, each corpse feeding the next, ravenous joy in the carnage',
    seed: 1103,
  },
  {
    id: 'the-pyre', name: 'The Pyre', arcana: 'major', domain: 'rot',
    accent: 'sickly green',
    art: 'a blade trailing weeping green corruption, every wound it has opened festering and smoking, a figure wreathed in rot-fume, the air itself spoiling around the edge',
    seed: 5102,
  },
  {
    id: 'the-martyr', name: 'The Martyr', arcana: 'major', domain: 'valor',
    accent: 'pale gold',
    art: 'a kneeling warrior run through by many blades, head raised in defiance, a terrible radiance bursting from the wounds, most dangerous at the moment of death',
    seed: 7402,
  },
  {
    id: 'the-tally', name: 'The Tally', arcana: 'major', domain: 'greed',
    accent: 'tarnished gold',
    art: 'a hunched figure fanning a great hoard of tarot cards like a miser counting coin, each card a sharpened edge, the pile vast and glinting, avarice as power',
    seed: 1204,
  },
];
