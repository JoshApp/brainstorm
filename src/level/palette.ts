// ─────────────────────────────────────────────────────────────────────
// Palette v1 — cascade types + resolver
// ─────────────────────────────────────────────────────────────────────
//
// First production cut of the intent-based vault authoring system.
// Just the cascade machinery + the bits the lighting pass needs.
// Carve / decor / encounter / event get added as their own passes
// ship (each one extends this Palette type with its own block).
//
// The shape of a Palette is intentionally tiny right now — every
// field is OPTIONAL. The cascade fills holes from layers BELOW.
// Layers, in priority order (last layer wins per leaf field):
//
//   1. Act default       (acts.ts → Act.palette)
//   2. Floor override    (acts.ts → Act.floorOverrides[depth], v2+)
//   3. Boss-floor layer  (acts.ts → Act.bossPalette, v2+)
//   4. Vault override    (vault-library.ts → Vault.palette)
//
// Hand authoring stays first-class. Any field with the value 'off'
// means "skip the procedural pass for this concern" — author placements
// (cellProps, vault.torches, vault.props) still apply. Set every
// density to 'off' to get pure hand-authored vaults, identical to
// pre-palette behaviour.

/** Lighting pass density. 'off' = no procedural torches added; the
 *  composer emits only what the author wrote in cellProps / torches. */
export type LightDensity = 'off' | 'dark' | 'sparse' | 'medium' | 'dense';

/** Decor pass style — what KIND of procedural decor the pass emits.
 *  'off' skips the pass entirely (author placements only). Other
 *  styles each pull from a different prop palette: 'pillared' lines
 *  walls with pillars, 'ruined' scatters broken debris, etc. */
export type DecorStyle = 'off' | 'sparse' | 'pillared' | 'ruined' | 'bone' | 'verdant';

/** Generic density used by decor / future encounter / event passes. */
export type Density = 'off' | 'light' | 'standard' | 'dense';

/** Carve pass style — what KIND of floor cutouts the pass emits.
 *  'off' skips the pass entirely. 'fissured' = thin scattered cracks
 *  (organic erosion). 'pit-cluster' = one-or-two larger pits the
 *  player has to walk around. 'chasm' = a single big rect that
 *  bisects the room. 'eroded' = wall-edge cells get nibbled away
 *  for an organic-cavern feel. */
export type CarveStyle = 'off' | 'fissured' | 'pit-cluster' | 'chasm' | 'eroded';

export interface PaletteV1 {
  /** Tonal defaults — colour / intensity / mood. Used by multiple
   *  passes; the lighting pass reads tone.lightTint as the per-torch
   *  tint unless overridden inside light. */
  tone?: {
    /** Default per-torch light tint (hex). Per-torch overrides win. */
    lightTint?: number;
    /** Per-torch intensity multiplier (default 1, range ~0..2). */
    lightIntensity?: number;
  };
  /** Lighting pass intent — how thickly to scatter wall torches. */
  light?: {
    density?: LightDensity;
    /** Override the per-torch tint for the procedural pass only.
     *  Useful when an act-wide tone applies broadly but a single
     *  floor wants its own red torches via the pass without
     *  touching the rest of the act palette. */
    tintOverride?: number;
  };
  /** Decor pass intent — what fills the room. style picks WHICH props
   *  (pillars vs ruins vs bone-piles), density picks HOW MANY. */
  decor?: {
    style?: DecorStyle;
    density?: Density;
  };
  /** Carve pass intent — floor cutouts. Runs FIRST in the pipeline
   *  so downstream passes see post-carve walkable cells. */
  carve?: {
    style?: CarveStyle;
    density?: Density;
  };
}

/** A palette with every field guaranteed filled — the type the
 *  passes consume. resolvePalette throws if a required field
 *  (light.density, tone.lightTint) is still undefined after all
 *  cascade layers. */
export interface ResolvedPaletteV1 {
  tone: {
    lightTint: number;
    lightIntensity: number;
  };
  light: {
    density: LightDensity;
    tintOverride?: number;
  };
  decor: {
    style: DecorStyle;
    density: Density;
  };
  carve: {
    style: CarveStyle;
    density: Density;
  };
}

/** Fallback floor for fields the cascade leaves undefined. Lets us
 *  ship the cascade before every Act + Vault has a palette — the
 *  composer falls back to defaults that approximate today's behaviour
 *  (medium density, warm-amber torches). */
const PALETTE_DEFAULTS: ResolvedPaletteV1 = {
  tone: {
    lightTint: 0xffb070,    // matches TORCH_WARM in vault-library
    lightIntensity: 0.95,
  },
  light: {
    density: 'off',         // default 'off' so adding the pass to the
                            // composer doesn't change behaviour anywhere
                            // it hasn't been opted into. Acts that want
                            // procedural torches set their own density.
  },
  decor: {
    style: 'off',           // same opt-in policy as light.
    density: 'off',
  },
  carve: {
    style: 'off',
    density: 'off',
  },
};

/**
 * Deep-merge the cascade layers, last wins per leaf. Each section
 * (tone, light) merges field-by-field so a vault overriding
 * tone.lightTint doesn't wipe the act's tone.lightIntensity. The
 * returned palette is guaranteed Required — every field is filled,
 * by the layer that supplied it or by PALETTE_DEFAULTS.
 */
export function resolvePalette(
  ...layers: Array<PaletteV1 | undefined>
): ResolvedPaletteV1 {
  // Start with defaults, then overlay each layer's fields in order.
  const out: ResolvedPaletteV1 = {
    tone: { ...PALETTE_DEFAULTS.tone },
    light: { ...PALETTE_DEFAULTS.light },
    decor: { ...PALETTE_DEFAULTS.decor },
    carve: { ...PALETTE_DEFAULTS.carve },
  };
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.tone) {
      if (layer.tone.lightTint !== undefined) out.tone.lightTint = layer.tone.lightTint;
      if (layer.tone.lightIntensity !== undefined) out.tone.lightIntensity = layer.tone.lightIntensity;
    }
    if (layer.light) {
      if (layer.light.density !== undefined) out.light.density = layer.light.density;
      if (layer.light.tintOverride !== undefined) out.light.tintOverride = layer.light.tintOverride;
    }
    if (layer.decor) {
      if (layer.decor.style !== undefined) out.decor.style = layer.decor.style;
      if (layer.decor.density !== undefined) out.decor.density = layer.decor.density;
    }
    if (layer.carve) {
      if (layer.carve.style !== undefined) out.carve.style = layer.carve.style;
      if (layer.carve.density !== undefined) out.carve.density = layer.carve.density;
    }
  }
  return out;
}
