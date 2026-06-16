/**
 * The style surface — the data the design/narration layer tunes to lock
 * DELVE's 2D art register. A card's prompt = a STYLE's `prompt` + the card's
 * subject fragment (cards.ts). Swapping the active style restyles the whole
 * deck without touching a single card spec.
 *
 * DECISION 1 — illustration, not framed card. We generate the ILLUSTRATION; the
 * game composites a shared FRAME asset around it and renders the title as DOM
 * text. No baked text/border (FLUX text is unreliable; a baked frame can't be
 * unified or themed). See FRAME below + src/art/viewer.ts.
 *
 * DECISION 2 — stylized, not photoreal. Tarot art is illustration: graphic,
 * decorative, hand-made. The touchstones are already in our docs — Darkest
 * Dungeon (painterly-graphic) and Mörk Borg (harsh ink/woodcut). Every style
 * here pushes HARD away from photorealism (see SHARED_NEGATIVE).
 */

export interface StyleDef {
  label: string;
  /** Prepended to the card's subject fragment — the look, not the subject. */
  prompt: string;
  /** Negative prompt — what to keep out. SHARED_NEGATIVE is appended. */
  negative: string;
}

/** Applied to every style — the realism + chrome we never want. */
const SHARED_NEGATIVE = [
  'photorealistic, photograph, hyperrealistic, realistic skin, 3d render, octane, cgi',
  'text, letters, words, title, numerals, watermark, signature',
  'border, frame, ornate edge, card back',
  'bright, neon, saturated, cheerful, cute, chibi, anime, cartoon, comic',
  'modern, sci-fi, clean, glossy, multiple panels, collage, grid',
].join(', ');

export const STYLES = {
  // Painterly-graphic — bold brush, strong silhouettes, decorative. The
  // Darkest Dungeon register: stylized illustration, not a rendered photo.
  painted: {
    label: 'painted (Darkest Dungeon)',
    prompt: [
      'a stylized grimdark dark-fantasy tarot illustration',
      'bold hand-painted illustration in the style of Darkest Dungeon concept art',
      'confident expressive brushwork, strong graphic silhouettes, slightly exaggerated proportions',
      'flat decorative shapes over rendered detail, illustrative not photographic',
      'restrained desaturated palette: bone white, ash grey, dried-blood crimson, rust, tarnished gold',
      'dramatic chiaroscuro, single subject filling the frame, edges falling into deep black',
      'cruel, ancient, indifferent mood',
    ].join(', '),
    negative: SHARED_NEGATIVE,
  },

  // Ink / woodcut — high-contrast black linework, crosshatch, spot crimson.
  // The Mörk Borg register: harsh, graphic, medieval print.
  ink: {
    label: 'ink (Mörk Borg / woodcut)',
    prompt: [
      'a stylized grimdark dark-fantasy tarot illustration',
      'bold woodcut and ink engraving, heavy black linework and crosshatching',
      'high-contrast graphic shapes, flat and decorative, medieval print and Mörk Borg aesthetic',
      'limited palette: bone white, ink black, a single dried-blood crimson spot colour',
      'stark, harsh, hand-printed texture, single subject filling the frame, edges into black',
      'cruel, ancient, indifferent mood',
    ].join(', '),
    negative: SHARED_NEGATIVE + ', soft shading, smooth gradients, painterly',
  },
} as const satisfies Record<string, StyleDef>;

export type StyleId = keyof typeof STYLES;
export const DEFAULT_STYLE: StyleId = 'ink';

/**
 * Shared FRAME candidates — generated to public/art/frames/<key>.png so we can
 * pick the strongest, then promote the winner to public/art/frame.png (the one
 * the deck composites against). Every frame is opaque, symmetrical, with an
 * empty dark centre window the artwork insets into. FRAME_NEGATIVE is shared.
 */
const FRAME_BASE = 'perfectly symmetrical, centred, a large empty flat solid-black rectangular window in the centre for inset artwork, on a pure black background';
export const FRAME_NEGATIVE = 'text, letters, numerals, watermark, signature, illustration or scene inside the window, asymmetrical, photograph, person, creature';

export const FRAMES = {
  carved: {
    label: 'carved stone + gold',
    prompt: `an ornate gothic tarot card border frame, carved dark stone and tarnished gold filigree, intricate weathered corners, ${FRAME_BASE}`,
  },
  bone: {
    label: 'bone + black iron',
    prompt: `a grim tarot card border frame of fused yellowed bone and black wrought iron, ossuary motifs, small skulls at the corners, ${FRAME_BASE}`,
  },
  gothic: {
    label: 'gothic tracery',
    prompt: `an ornate gothic cathedral tracery tarot border frame, pointed-arch stonework, tarnished silver and deep shadow, austere and tall, ${FRAME_BASE}`,
  },
  etched: {
    label: 'etched woodcut (Mörk Borg)',
    prompt: `a stark woodcut tarot card border frame, heavy black ink linework and crosshatching, flat graphic medieval engraving, a single dried-blood crimson accent, Mörk Borg aesthetic, ${FRAME_BASE}`,
  },
} as const satisfies Record<string, { label: string; prompt: string }>;

export type FrameId = keyof typeof FRAMES;

/** Illustration size — portrait ~3:4, multiples of 64. */
export const ILLUSTRATION_SIZE = { width: 896, height: 1152 } as const;
/** Frame size — portrait card proportions (~2:3 tarot). */
export const FRAME_SIZE = { width: 832, height: 1216 } as const;
