import type { MaterialDef } from '../ecs/model-types';

// ── JELLY — what makes a blob read as fluorescent goo and not as glass ──────
//
// "Oozes look like glass, pale — they should be fluorescent green / blue / red
// jelly." (Josh, 2026-08-11.) The fix was already in the codebase; the mooks
// just never got it.
//
// Measured across the five blob creatures in content/enemies.ts:
//
//   king-ooze      body 0x4a6a18 + emissive + rim   ← reads as jelly
//   boiling-prince body 0x4a6a18 + emissive + rim   ← reads as jelly
//   ooze           body 0x18220f, NO emissive, NO rim
//   ooze-small     body 0x18220f, NO emissive, rim
//   acid-spitter   body 0x141a26, NO emissive, rim
//
// The two BOSSES carry a saturated body colour, a self-emissive so the mass
// glows from inside, and a rim so the silhouette lights up where it curves away.
// The three mooks carry a near-black body (0x18220f is 24,34,15 — almost the
// floor) and lean entirely on a small bright core inside a translucent shell.
// That is exactly the description of glass: you see THROUGH it to a bulb,
// instead of seeing a lit substance.
//
// So the jelly is four things together, and dropping any one of them is what
// turned it pale:
//
//   1. a SATURATED body colour — not a dark neutral that torchlight has to rescue
//   2. a body EMISSIVE — the mass is lit from within, independent of the room
//   3. a RIM in the hot hue — the edge glows where the surface turns away
//   4. a hot CORE — the nucleus, and the windup tell
//
// Authoring a new jelly is picking a hue and calling jelly(). The `red` entry is
// unused today — Josh named green/blue/RED and there is no red blob yet; it is
// here so adding one is an enemy spec, not another round of colour archaeology.

/** One jelly's colour identity. Everything else is shared. */
export interface JellyHue {
  /** The mass. Saturated — this is the colour the player names it by. */
  body: number;
  /** Self-emission inside the mass. A dark version of `body`; too bright and
   *  the blob stops taking light from the room and reads as a flat sticker. */
  inner: number;
  /** The hot hue: rim + core + windup flare. Brighter and more saturated than
   *  the body, so the edge and the nucleus separate from the mass. */
  hot: number;
}

export const JELLY_HUES = {
  /** The common ooze and its split children. */
  green: { body: 0x4c7a16, inner: 0x1e3c08, hot: 0xaaff44 },
  /** Acid chemistry — the spitter. */
  blue: { body: 0x184e78, inner: 0x0a2540, hot: 0x66ccff },
  /** UNUSED — reserved so a red jelly is a spec, not a redesign. */
  red: { body: 0x7a1c1c, inner: 0x3a0808, hot: 0xff5a44 },
} as const satisfies Record<string, JellyHue>;

/**
 * The body + core materials for a jelly creature.
 *
 * `opacity` is the one knob worth varying per creature: a boss at 0.55 shows
 * its swallowed regalia, a knee-high mook at 0.68 needs to read as SUBSTANCE
 * from six metres in torchlight, where too much transparency is the pale-glass
 * failure all over again.
 *
 * `coreEmissive` scales the nucleus. It is the windup tell (the AI drives it via
 * baseEyeEmissive), so a creature whose tell must carry further asks for more.
 */
export function jelly(
  hue: JellyHue,
  opts: { opacity?: number; coreEmissive?: number; rim?: number } = {},
): { body: MaterialDef; core: MaterialDef } {
  const opacity = opts.opacity ?? 0.68;
  return {
    body: {
      color: hue.body,
      roughness: 0.4,
      emissive: hue.inner,
      emissiveIntensity: 0.9,
      flatShading: 'auto',
      transparent: true,
      opacity,
      dissolvable: true,
      // darkReactive: the rim strengthens where the room does NOT light the
      // blob, so it carries the silhouette in the dark without blowing out
      // under a torch. Same value the sump-wisp and ooze-small already use.
      rim: { color: hue.hot, power: 2, intensity: opts.rim ?? 0.7, darkReactive: 0.5 },
    },
    core: {
      color: hue.hot,
      emissive: hue.hot,
      emissiveIntensity: opts.coreEmissive ?? 2.0,
    },
  };
}
