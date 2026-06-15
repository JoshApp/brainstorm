// WALL-MARKS — messages the lost scratched into the stone. The lamp reveals
// them (scene/lamp-reveal.ts); the text surfaces as a whisper as you pass.
//
// Tone: IN-WORLD grim register (Tone Bible) — terse, archaic, cruel or
// despairing or simply indifferent. NOT the broadcast snark. Some LIE — a dead
// hand is not a trustworthy one, and a dungeon full of helpful signage isn't
// grimdark. This is authored DATA: a narration/content layer (or, later, real
// players' messages) writes against this shape, not the spawn code.

export type RuneGlyph = 'rune-scrawl' | 'rune-sigil';

export interface WallMark {
  /** The line that whispers up when you're close + lamp-lit. */
  text: string;
  /** Which glyph blooms on the wall. Default 'rune-scrawl'. */
  glyph?: RuneGlyph;
  /** Glow tint. Default cold bone-blue. Red = warning, green = sickness/decay. */
  tint?: number;
  /** Earliest floor this can appear on. Default 1. */
  minDepth?: number;
}

// Color legend (see VISUAL-LANGUAGE / dread-light), GRIMDARK-toned: these read
// as scratched-in carvings the lamp catches, NOT neon signage — so the tints are
// DESATURATED + dim (the additive reveal still blooms them under the lamp). Cold
// ash-grey = a ghost's hand, the default; dried-blood = a warning written in
// fear; dim moss/rot = sickness, the basin.
export const RUNE_TINT = {
  bone: 0x7a8893,   // cold ashen grey (was a brighter pale blue)
  warn: 0x8a3b2c,   // dried blood (was a near-neon orange-red)
  sick: 0x5f7355,   // dim mossy rot (was a bright sick green)
} as const;

export const WALL_MARKS: WallMark[] = [
  // — Floor one onward: despair, the first lessons, the lies. —
  { text: 'turn back' },
  { text: 'no way out but down', tint: RUNE_TINT.warn },
  { text: 'i carved this, so i was here' },
  { text: 'the light is the only honest thing' },
  { text: 'count the dead, not the doors' },
  { text: 'we were so many' },
  { text: 'do not kneel at the basin', glyph: 'rune-sigil', tint: RUNE_TINT.sick },
  { text: 'it wakes when the light moves', tint: RUNE_TINT.warn },
  { text: 'pray to nothing. nothing answers.', glyph: 'rune-sigil' },
  { text: 'the door lies', tint: RUNE_TINT.warn },

  // — Deeper: the dark has taken more of them. —
  { text: 'i should have stopped at three', minDepth: 3 },
  { text: 'they took my name first', minDepth: 3, glyph: 'rune-sigil' },
  { text: 'something follows the light', minDepth: 3, tint: RUNE_TINT.warn },
  { text: 'deeper is not the way out', minDepth: 4 },
  { text: 'do not read the next one', minDepth: 4, tint: RUNE_TINT.warn },
  { text: 'it is patient. it is below.', minDepth: 5, glyph: 'rune-sigil', tint: RUNE_TINT.warn },
];

/** Pick a wall-mark allowed at this depth. Deterministic given `rand`. */
export function pickWallMark(depth: number, rand: () => number): WallMark {
  const pool = WALL_MARKS.filter((m) => (m.minDepth ?? 1) <= depth);
  const src = pool.length ? pool : WALL_MARKS;
  return src[Math.floor(rand() * src.length) % src.length];
}
