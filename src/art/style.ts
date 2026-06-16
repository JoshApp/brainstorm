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
  'neon, cute, chibi, anime, cartoon, comic',
  'modern, sci-fi, clean, glossy, multiple panels, collage, grid',
].join(', ');

// Opt-in restraint: the desaturation bans most styles want — but NOT the
// colour-forward ones (stained glass needs jewel saturation to read as light).
const RESTRAINT_NEG = 'bright, saturated, cheerful, colourful, garish, vibrant';

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
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}`,
  },

  // Ink / woodcut — high-contrast black linework, crosshatch, spot crimson.
  // The Mörk Borg register: harsh, graphic, medieval print.
  ink: {
    label: 'ink (Mörk Borg / woodcut)',
    prompt: [
      'a stylized grimdark dark-fantasy tarot illustration',
      'bold woodcut and ink engraving, heavy black linework and crosshatching',
      'high-contrast graphic shapes, flat and decorative, medieval print and Mörk Borg aesthetic',
      // The TREATMENT is fixed (this is what makes the deck read as one object);
      // the SPOT COLOUR is left to the card's `accent` (domain = colour = meaning),
      // so the deck varies in hue without fracturing its hand.
      'palette of bone white and ink black with a single spot colour',
      'stark, harsh, hand-printed texture, single subject filling the frame, edges into black',
      'cruel, ancient, indifferent mood',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, soft shading, smooth gradients, painterly`,
  },

  // Scratchboard — white scratched out of solid black. The purest match to
  // DELVE's grammar: form REVEALED out of darkness. Accent glows.
  scratch: {
    label: 'scratchboard (white out of black)',
    prompt: [
      'a stylized grimdark dark-fantasy tarot illustration',
      'scratchboard / scraperboard art, fine white lines scratched out of solid black',
      'the image emerging from total darkness, high-contrast engraved white hatching on black',
      'a single spot colour glowing faintly out of the dark',
      'dramatic, single subject filling the frame, cruel ancient mood',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, black lines on white background, woodcut, painterly, soft, photographic`,
  },

  // Dark stained glass — jewel light through black leadwork. Makes colour read
  // as LIGHT; the one style that WANTS saturation (no restraint negative).
  glass: {
    label: 'dark stained glass',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a gothic stained-glass window',
      'bold black leadwork cames, fragments of deep jewel-coloured glass glowing out of black',
      'the colour reads as light shining through glass, sombre cathedral window',
      'single subject filling the frame, sacred and cruel and ancient',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, photographic, painterly, pastel, washed out, daylight`,
  },

  // Copperplate etching — fine antique engraving, the grimoire/Doré register.
  // A delicate, occult cousin of the woodcut.
  etching: {
    label: 'etching (Doré / grimoire)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a fine antique copperplate engraving and etching',
      'dense delicate cross-hatched linework, the look of a Gustave Doré plate or an alchemical grimoire',
      'aged ink on bone parchment, a single restrained spot colour',
      'dramatic chiaroscuro, single subject filling the frame, edges into black, cruel ancient mood',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, thick blocky woodcut, painterly, soft, smooth gradients`,
  },

  // Charcoal & chalk on black — raw smudged chiaroscuro, hand-drawn and tactile.
  charcoal: {
    label: 'charcoal & chalk on black',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in raw charcoal and white chalk on black ground',
      'smudged expressive marks, soft chiaroscuro, the figure emerging from darkness',
      'a single muted spot colour in soft pastel, tactile hand-drawn',
      'single subject filling the frame, cruel ancient mood',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, clean vector lines, woodcut, photographic, glossy`,
  },

  // ── Wide exploration batch — sampling the possibility space ──────────────

  // Byzantine icon — gilded sacred flatness. A "holy light" register (gold,
  // not glass). Colour-forward: no restraint negative.
  icon: {
    label: 'Byzantine icon (gold ground)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a Byzantine Orthodox icon',
      'flat sacred figure on a cracked gold-leaf ground, austere stylised features, halo',
      'egg tempera, aged and tarnished gilding, solemn and ancient',
      'single subject filling the frame, sacred and cruel',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, photographic, realistic perspective, modern, painterly impressionism`,
  },

  // Mezzotint — velvety tonal engraving worked from black to light. Ghostly
  // forms emerging from deep dark; the smooth cousin of scratchboard.
  mezzotint: {
    label: 'mezzotint (black to light)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a mezzotint engraving',
      'velvety continuous tone worked from solid black up to light, deep rich blacks',
      'a ghostly form emerging from darkness, fine grain, no hard outlines',
      'a single restrained spot colour, single subject filling the frame, cruel ancient mood',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, hard outlines, flat woodcut, line art, painterly brushstrokes`,
  },

  // Beksiński — dystopian surreal decay, oppressive dread. Desaturated rust/bone.
  beksinski: {
    label: 'Beksiński dread',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in the style of Zdzisław Beksiński',
      'dystopian surrealism, monumental decayed forms, bone and rust and ash',
      'oppressive dreamlike horror, atmospheric haze, desaturated earthy palette',
      'single subject filling the frame, vast indifferent dread',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, line art, woodcut, cheerful, clean`,
  },

  // Tintype — ghostly wet-plate memento mori photograph. Ties to the game's
  // traces-of-the-dead. Monochrome silver/sepia.
  tintype: {
    label: 'tintype (memento mori)',
    prompt: [
      'a grimdark dark-fantasy tarot subject as an antique wet-plate collodion tintype photograph',
      'ghostly silver monochrome, Victorian memento mori, scratched and damaged emulsion',
      'shallow eerie focus, vignetted into black, a faint single spot colour tone',
      'single subject filling the frame, funereal and uncanny',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, modern photo, digital, sharp clean, colour photograph, illustration, line art`,
  },

  // Illuminated manuscript — cursed medieval codex, gold initials, charred vellum.
  illumination: {
    label: 'illuminated manuscript',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a medieval illuminated manuscript painting',
      'flat gothic figures, gold-leaf details, egg tempera, grotesque marginalia',
      'on smoke-darkened charred vellum, aged and water-stained',
      'single subject filling the frame, sacred dread and decay',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, photographic, realistic shading, modern, pristine clean white vellum, bright`,
  },

  // Expressionist linocut — brutal Kollwitz/Munch blockprint. Rawer than Mörk Borg.
  linocut: {
    label: 'expressionist linocut',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a crude hand-carved Expressionist reduction linocut',
      'bold flat areas of solid black against cream-white, visible gouged carving marks, rough hand-printed ink, hard graphic edges',
      'in the spirit of Käthe Kollwitz and Edvard Munch, anguished and grim',
      'strict limited palette — black, cream white and one or two bold spot colours, NO grey, NO shading, NO gradients, flat 2D print not rendered',
      'the image is FULL BLEED, the artwork fills the entire frame edge to edge with no white paper border and no margin',
      'single subject centred with a little headroom, cruel and grief-stricken',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, smooth shading, rendered, photorealistic, 3d render, grey, midtones, soft gradient, muddy, cute, fine delicate detail, painterly, grain, halftone, white border, paper margin, matte border, vignette, framed`,
  },

  // Cyanotype — spectral Prussian-blue photogram. Cold, strange, monochrome.
  cyanotype: {
    label: 'cyanotype (spectral blue)',
    prompt: [
      'a grimdark dark-fantasy tarot subject as a cyanotype photogram',
      'spectral Prussian-blue and white monochrome, ghostly exposed silhouette',
      'antique blueprint texture, faded and chemical-stained, cold and eerie',
      'single subject filling the frame, funereal and otherworldly',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, warm tones, multicolour, red, green, yellow, modern, line art, woodcut`,
  },

  // Dark oil — Goya black-paintings tenebrism. Loose dread, distinct from the
  // Darkest Dungeon graphic look.
  oil: {
    label: 'dark oil (Goya)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration as a tenebrist dark oil painting',
      'in the spirit of Goya black paintings, loose smeared impasto, overwhelming darkness',
      'a figure half-swallowed by black, sombre desaturated earth palette, candle-lit',
      'single subject filling the frame, mad and cruel and ancient',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, line art, woodcut, flat graphic, clean, photographic`,
  },

  // ── Research batch — named macabre illustrators (FLUX knows these hands) ──

  // Harry Clarke — intricate Art-Nouveau pen-ink + stained-glass sensibility.
  // Sinewy figures against solid black; jewel spot colour. Bridges ink+glass.
  clarke: {
    label: 'Harry Clarke (ink + glass)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in the style of Harry Clarke',
      'intricate Art-Nouveau pen-and-ink, sinewy elongated figures and spectral detail against solid voids of black',
      'decadent French-Symbolist macabre, jewel-like spot colour as if stained glass',
      'ornate and hypnotic, single subject filling the frame, cruel ancient mood',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, photographic, painterly, thick woodcut, sparse, simple, 3d render`,
  },

  // Stephen Gammell — Scary Stories nightmare: bleeding splattered ink wash.
  gammell: {
    label: 'Stephen Gammell (ink-wash horror)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in the style of Stephen Gammell Scary Stories',
      'nightmarish splattered ink wash, bleeding dripping blots and tendrils, ragged decayed forms emerging from grime',
      'monochrome ink with a single bleeding spot colour, deeply unsettling',
      'single subject filling the frame, grotesque and grim',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, clean lines, flat graphic, woodcut, smooth, photographic`,
  },

  // Aubrey Beardsley — stark decadent B/W art-nouveau ink, flat black masses.
  beardsley: {
    label: 'Aubrey Beardsley (decadent B/W)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in the style of Aubrey Beardsley',
      'stark black and white Art-Nouveau pen and ink, bold flat masses of solid black against white',
      'sinuous decadent line, Japanese-woodblock influence, grotesque and elegant',
      'a single restrained spot colour, single subject filling the frame, decadent and cruel',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, painterly, soft shading, gradients, photographic, 3d render`,
  },

  // Alfred Kubin — spidery nervous ink + wash, proto-surreal dread.
  kubin: {
    label: 'Alfred Kubin (spidery dread)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in the style of Alfred Kubin',
      'spidery nervous pen-and-ink and grey wash, nightmarish proto-surreal dread',
      'crumbling spectral forms, gloomy fine hatching, monochrome with a faint spot colour',
      'oppressive and uncanny, single subject filling the frame',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, clean flat graphic, woodcut, bright, photographic`,
  },

  // Santiago Caruso — dark-symbolist scraperboard + decalcomania (refined scratch).
  caruso: {
    label: 'Santiago Caruso (scraperboard)',
    prompt: [
      'a grimdark dark-fantasy tarot illustration in the style of Santiago Caruso',
      'scraperboard and ink with mottled decalcomania texture, dark symbolist dreamlike horror',
      'fine white lines scratched out of solid black, organic mottled grain, a single spot colour glowing',
      'single subject filling the frame, occult and cruel',
    ].join(', '),
    negative: `${SHARED_NEGATIVE}, ${RESTRAINT_NEG}, flat woodcut, clean vector lines, photographic, painterly`,
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
const FRAME_BASE = 'perfectly symmetrical, centred, only a THIN narrow border at the very edge, a very large empty flat solid-black rectangular window filling most of the card for inset artwork, on a pure black background';
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
  linocut: {
    label: 'expressionist linocut',
    prompt: `a tarot card border frame in bold German Expressionist linocut, a SLIM delicate gouged-line border hugging the very edge of the card, a single dried-blood crimson accent, ${FRAME_BASE}`,
  },
  icon: {
    label: 'Byzantine icon (gold)',
    prompt: `a Byzantine icon tarot card border frame, embossed gold-leaf arch and tarnished gilding, sacred geometric ornament and halo motifs, ancient and weathered, ${FRAME_BASE}`,
  },
  clarke: {
    label: 'Harry Clarke (ink + jewel)',
    prompt: `an ornate Harry Clarke Art-Nouveau tarot card border frame, intricate sinuous pen-and-ink ornament with jewel-toned stained-glass accents, gold and deep teal and crimson glints, decadent and hypnotic, ${FRAME_BASE}`,
  },
} as const satisfies Record<string, { label: string; prompt: string }>;

export type FrameId = keyof typeof FRAMES;

// Standard tarot card is 70 × 120 mm — a 7:12 (~0.583) portrait, taller than a
// playing card. Frame uses true tarot proportions; the illustration is a hair
// squarer so it cover-fits the inner window with a little bleed for the frame
// to overlap. Both FLUX-friendly (multiples of 32/64).
/** Illustration size — taller than wide (~tarot window ratio) so the inlay
 *  crop lands clean and vertical subjects keep their headroom. */
export const ILLUSTRATION_SIZE = { width: 704, height: 1216 } as const;
/** Frame size — standard tarot 70×120mm ≈ 7:12. */
export const FRAME_SIZE = { width: 768, height: 1312 } as const;
