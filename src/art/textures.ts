/**
 * The surfaces lane — materials the menus / HUD sit ON, authored as DATA the
 * same way cards (cards.ts) and frames (style.ts) are. AI generation is the right
 * tool for these: unique organic surfaces that recede BEHIND content and tolerate
 * per-generation variation. (Functional icons + stateful chrome stay code/SVG —
 * see docs/UI-CHARTER.md. The routing rule: organic surface behind content → AI;
 * small repeated tintable mark → draw it.)
 *
 * Author each surface EVENLY LIT and MUTED so it can be tinted/darkened in-engine
 * (multiply over the palette). Edges, vignettes, and torn silhouettes are added in
 * CSS, NOT baked into the texture — that keeps one surface reusable across panels.
 *
 * Generate + explore (forkable, atelier-visible) like any other art subject:
 *   delve art texture parchment --n 3
 *   delve art texture parchment --from r12 --tweak "warmer, more foxing"
 *   delve art promote r14            (marks the chosen surface)
 */
export const TEXTURE_SIZE = { width: 1216, height: 832 } as const;

export interface TextureSpec {
  id: string;
  label: string;
  prompt: string;
  negative: string;
  seed: number;
}

// What a surface must NOT be: anything with its own content, framing, or baked
// lighting that would fight the menu drawn on top of it.
// Surfaces must FILL the frame (the texture is the whole image, edge to edge) and
// carry no content/framing/baked lighting that would fight the menu on top. The
// "sheet of paper on a background" failure mode is why the parchment v1 had a pale
// margin we had to crop — so we forbid it here and ask for a macro fill instead.
const TEX_NEGATIVE =
  'text, letters, words, writing, calligraphy, illustration, drawing, picture, border, frame, ornament, people, objects, sheet of paper, single page, paper on a table, page corner, white background, drop shadow, dramatic lighting, deep shadows, spotlight, vignette, dark edges, saturated colors, 3d render, glossy, reflection, watermark';

export const TEXTURES: Record<string, TextureSpec> = {
  parchment: {
    id: 'parchment', label: 'damaged parchment',
    prompt:
      'a seamless tileable material texture swatch of aged vellum parchment, weathered cream animal-skin surface, evenly mottled tone with faint pale-brown foxing speckles and subtle soft stains, fine grain, flat even overhead studio lighting, shot perfectly flat top-down, the material fills the entire frame uniformly corner to corner like a fabric swatch, one continuous surface',
    negative: `${TEX_NEGATIVE}, page, sheet, document, scroll, burnt edges, torn edges, curled corners, rolled`, seed: 4220,
  },
  stone: {
    id: 'stone', label: 'worn dungeon stone',
    prompt:
      'a slab of worn dark dungeon stone, damp cracked granite masonry, evenly lit, uneven mottled grey tone, fine grain and pitting, flat overhead lighting, muted cold grey tones, empty surface, seamless material',
    negative: TEX_NEGATIVE, seed: 4300,
  },
  leather: {
    id: 'leather', label: 'old black leather',
    prompt:
      'a panel of old worn black leather, cracked aged hide, evenly lit, subtle grain and creases, flat overhead lighting, muted near-black charcoal tones, empty surface, seamless material',
    negative: TEX_NEGATIVE, seed: 4400,
  },
};
