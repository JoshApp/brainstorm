import type { ModelSpec } from '../ecs/model-types';

// Visual models for non-weapon items (potions, rings, armor).
// All use fog:false on their materials since they're held / displayed
// at close-up distances (pickup bobbing in mid-air, or in the inventory
// panel) where fog would inappropriately fade them.

// Healing potion — glass flask with a glowing red elixir + a cork.
export const HEALING_POTION: ModelSpec = {
  id: 'healing-potion',
  materials: {
    glass: {
      color: 0x161814,
      roughness: 0.25,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
    elixir: {
      // Black base + bright red emissive so the potion glows from within
      // — visible at a glance amid clutter.
      color: 0x000000,
      emissive: 0xff2233,
      emissiveIntensity: 1.8,
      roughness: 0.4,
      fog: false,
    },
    cork: {
      color: 0x4a3a26,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Body — wider cylinder for the bulk of the flask
    { kind: 'cylinder', pos: [0, 0.06, 0], radius: 0.05, height: 0.10, segments: 10, mat: 'glass' },
    // Glowing red elixir filling most of the body
    { kind: 'cylinder', pos: [0, 0.055, 0], radius: 0.042, height: 0.08, segments: 10, mat: 'elixir' },
    // Neck — narrower cylinder going up
    { kind: 'cylinder', pos: [0, 0.135, 0], radius: 0.022, height: 0.05, segments: 8, mat: 'glass' },
    // Cork — small box on top
    { kind: 'cylinder', pos: [0, 0.175, 0], radius: 0.020, height: 0.025, segments: 8, mat: 'cork' },
  ],
};

// ── The Estus flask — the player's healing flask, GOLD light in dark glass.
// Elden Ring register: the liquid is warm light, not medicine. Used as the
// drink viewmodel (player/flask-viewmodel.ts) and by flask-economy drops.
// The `elixir` material is looked up by id at runtime (glow pulses at the sip),
// so keep the material key stable.
export const ESTUS_FLASK: ModelSpec = {
  id: 'estus-flask',
  materials: {
    glass: {
      color: 0x1b1a15,
      roughness: 0.22,
      metalness: 0.12,
      fog: false,
      flatShading: 'auto',
    },
    elixir: {
      // Black base + amber-gold emissive — liquid sunlight in a dark bulb.
      color: 0x000000,
      emissive: 0xffb43c,
      emissiveIntensity: 2.0,
      roughness: 0.3,
      fog: false,
    },
    iron: {
      color: 0x2c2823,
      roughness: 0.55,
      metalness: 0.8,
      fog: false,
      flatShading: 'auto',
    },
    cork: {
      color: 0x4a3a26,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Round-bottomed bulb — the apothecary silhouette the HUD icon echoes.
    { kind: 'sphere', name: 'bulb', pos: [0, 0.07, 0], radius: 0.062, segments: [14, 12], mat: 'glass' },
    // The light inside — slightly smaller sphere so glass rims it.
    { kind: 'sphere', name: 'elixir', pos: [0, 0.066, 0], radius: 0.052, segments: [12, 10], mat: 'elixir' },
    // Iron collar where neck meets bulb (the HUD icon's band).
    { kind: 'cylinder', name: 'collar', pos: [0, 0.126, 0], radius: 0.027, height: 0.02, segments: 10, mat: 'iron' },
    // Neck + cork.
    { kind: 'cylinder', name: 'neck', pos: [0, 0.152, 0], radius: 0.019, height: 0.05, segments: 10, mat: 'glass' },
    { kind: 'cylinder', name: 'cork', pos: [0, 0.188, 0], radius: 0.017, height: 0.024, segments: 8, mat: 'cork' },
  ],
};

// Refill draught — a stoppered measure of the same gold light, smaller and
// meaner. Poured into the flask on use (+1 charge), never drunk directly.
export const FLASK_DRAUGHT: ModelSpec = {
  id: 'flask-draught',
  materials: {
    glass: { color: 0x1b1a15, roughness: 0.25, metalness: 0.1, fog: false, flatShading: 'auto' },
    elixir: { color: 0x000000, emissive: 0xffb43c, emissiveIntensity: 1.6, roughness: 0.4, fog: false },
    cork: { color: 0x4a3a26, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
  },
  parts: [
    { kind: 'cylinder', pos: [0, 0.055, 0], radius: 0.038, height: 0.09, segments: 10, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.05, 0], radius: 0.031, height: 0.07, segments: 10, mat: 'elixir' },
    { kind: 'cylinder', pos: [0, 0.12, 0], radius: 0.017, height: 0.04, segments: 8, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.15, 0], radius: 0.016, height: 0.02, segments: 8, mat: 'cork' },
  ],
};

// Flask shard — a curve of golden glass that remembers the vessel it was.
// Fused into the flask on use (+1 capacity).
export const FLASK_SHARD: ModelSpec = {
  id: 'flask-shard',
  materials: {
    shard: { color: 0x201c12, roughness: 0.2, metalness: 0.15, fog: false, flatShading: 'auto' },
    gleam: { color: 0x000000, emissive: 0xffc860, emissiveIntensity: 1.4, roughness: 0.3, fog: false },
  },
  parts: [
    // A broken curve of bulb-glass — three thin plates fanned along an arc
    // read as one curved fragment at pickup distance.
    { kind: 'box', pos: [-0.03, 0.045, 0], rot: [0.15, 0.0, 0.55], size: [0.045, 0.008, 0.035], mat: 'shard' },
    { kind: 'box', pos: [0, 0.06, 0], rot: [0.1, 0.3, 0.0], size: [0.05, 0.008, 0.038], mat: 'shard' },
    { kind: 'box', pos: [0.03, 0.045, 0.005], rot: [0.12, 0.6, -0.55], size: [0.045, 0.008, 0.035], mat: 'shard' },
    // A gleam of the old light caught along the break.
    { kind: 'sphere', pos: [0.005, 0.058, 0.008], radius: 0.014, segments: [8, 6], mat: 'gleam' },
  ],
};

// Ring of vigor — green-stoned torus ring.
function ringModel(id: string, jewelColor: number, jewelEmissive: number): ModelSpec {
  return {
    id,
    materials: {
      band: {
        color: 0xb09060,
        roughness: 0.45,
        metalness: 0.7,
        fog: false,
        flatShading: 'auto',
      },
      jewel: {
        color: 0x000000,
        emissive: jewelColor,
        emissiveIntensity: jewelEmissive,
        roughness: 0.35,
        fog: false,
      },
    },
    parts: [
      // The band — torus laid flat (so the hole's axis is vertical).
      // Three.js TorusGeometry default has axis along Z; we rotate so hole
      // is up (axis along Y) — visually reads as a ring sitting on a table.
      { kind: 'torus', pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0], radius: 0.045, tube: 0.011, segments: [14, 8], mat: 'band' },
      // The jewel — small glowing sphere set in the top of the band.
      { kind: 'sphere', pos: [0, 0.035, 0], radius: 0.018, segments: [10, 8], mat: 'jewel' },
    ],
  };
}

export const RING_OF_VIGOR = ringModel('ring-vigor', 0x66dd55, 2.0);       // green: life
export const RING_OF_PREDATION = ringModel('ring-predation', 0xff4422, 2.0); // red: aggression
export const RING_OF_BLOODTHIRST = ringModel('ring-bloodthirst', 0xaa1133, 3.0); // dark crimson: on-kill rage
export const RING_OF_FRENZY = ringModel('ring-frenzy', 0xc05bd6, 2.4);    // violet: cursed rage

// --- Helmet — iron coif (skullcap with a small forehead band) ---
export const IRON_COIF: ModelSpec = {
  id: 'iron-coif',
  materials: {
    iron: { color: 0x44423e, roughness: 0.55, metalness: 0.7, fog: false, flatShading: 'auto' },
    band: { color: 0x2a2622, roughness: 0.7, metalness: 0.5, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Dome — upper hemisphere of a sphere (scaled flat). PartSpec doesn't
    // directly express hemispheres; we use a sphere positioned so its
    // bottom is at the band level, then place a flat plate below to hide.
    { kind: 'sphere', pos: [0, 0.05, 0], radius: 0.085, segments: [12, 8], mat: 'iron' },
    // Forehead band (slightly wider torus around the base).
    { kind: 'torus', pos: [0, 0.005, 0], rot: [Math.PI / 2, 0, 0], radius: 0.087, tube: 0.012, segments: [16, 8], mat: 'band' },
  ],
};

// --- Amulet — single skull-shaped pendant hanging from a thin chain loop ---
export const BONE_AMULET: ModelSpec = {
  id: 'bone-amulet',
  materials: {
    chain: { color: 0x2a2622, roughness: 0.6, metalness: 0.7, fog: false, flatShading: 'auto' },
    bone:  { color: 0xc8b896, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    eye:   { color: 0x000000, emissive: 0xff4400, emissiveIntensity: 1.6, roughness: 1.0, fog: false },
  },
  parts: [
    // Chain — wide thin torus at top.
    { kind: 'torus', pos: [0, 0.16, 0], rot: [Math.PI / 2, 0, 0], radius: 0.06, tube: 0.005, segments: [16, 6], mat: 'chain' },
    // Pendant body — slightly oblate sphere for a skull-ish shape.
    { kind: 'sphere', pos: [0, 0.06, 0], scale: [1.0, 1.1, 0.8], radius: 0.04, segments: [10, 8], mat: 'bone' },
    // Two tiny glowing eye sockets so the amulet visually reads as a skull.
    { kind: 'sphere', pos: [-0.018, 0.07, -0.032], radius: 0.008, segments: [6, 6], mat: 'eye' },
    { kind: 'sphere', pos: [ 0.018, 0.07, -0.032], radius: 0.008, segments: [6, 6], mat: 'eye' },
  ],
};

// --- Acid Tongue — pendant cut from the Boiling King's core orb.
// Sickly green stone slung from a tarnished chain, still wet. The
// "tongue" shape (elongated teardrop) sells the visual; emissive
// pulse keeps it alive in low light.
export const ACID_TONGUE_AMULET: ModelSpec = {
  id: 'acid-tongue-amulet',
  materials: {
    chain: { color: 0x1c2010, roughness: 0.7, metalness: 0.7, fog: false, flatShading: 'auto' },
    stone: {
      // Black-green base with bright acid emissive — the stone glows.
      color: 0x0a1408,
      emissive: 0x88ff44,
      emissiveIntensity: 1.4,
      roughness: 0.35,
      metalness: 0.2,
      fog: false,
    },
    drip: { color: 0x000000, emissive: 0xa8ff44, emissiveIntensity: 2.2, roughness: 1.0, fog: false },
  },
  parts: [
    // Chain — thin torus loop at top.
    { kind: 'torus', pos: [0, 0.16, 0], rot: [Math.PI / 2, 0, 0], radius: 0.06, tube: 0.005, segments: [16, 6], mat: 'chain' },
    // Pendant — elongated teardrop shape via stretched sphere.
    { kind: 'sphere', pos: [0, 0.06, 0], scale: [0.9, 1.3, 0.7], radius: 0.04, segments: [10, 8], mat: 'stone' },
    // Bright core spot — additional smaller emissive sphere inside.
    { kind: 'sphere', pos: [0, 0.07, -0.01], radius: 0.014, segments: [8, 8], mat: 'drip' },
  ],
};

// --- Gloves — single grouped representation (one glove shape) ---
export const LEATHER_GLOVES: ModelSpec = {
  id: 'leather-gloves',
  materials: {
    leather: { color: 0x3a2a1c, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    binding: { color: 0x161208, roughness: 1.0, metalness: 0.0, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Hand box — slightly tall, narrow.
    { kind: 'box', pos: [0, 0.08, 0], size: [0.08, 0.12, 0.04], mat: 'leather' },
    // Cuff — thin band at the wrist.
    { kind: 'box', pos: [0, 0.02, 0], size: [0.09, 0.025, 0.05], mat: 'binding' },
    // Thumb — small box on the side.
    { kind: 'box', pos: [0.045, 0.07, 0], size: [0.03, 0.05, 0.035], mat: 'leather' },
  ],
};

// --- Boots — simple L-shape (foot + ankle cylinder) ---
export const WORN_BOOTS: ModelSpec = {
  id: 'worn-boots',
  materials: {
    leather: { color: 0x2a1f14, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    sole:    { color: 0x12100a, roughness: 1.0, metalness: 0.0, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Ankle column.
    { kind: 'cylinder', pos: [0, 0.10, 0], radius: 0.038, height: 0.12, segments: 10, mat: 'leather' },
    // Foot — flat box sticking forward.
    { kind: 'box', pos: [0, 0.025, -0.045], size: [0.075, 0.04, 0.12], mat: 'leather' },
    // Sole — thin darker box under the foot.
    { kind: 'box', pos: [0, 0.005, -0.045], size: [0.078, 0.013, 0.125], mat: 'sole' },
  ],
};

// --- Shield — round wooden shield with metal rim ---
// Oil lamp — small iron-cage lantern with a glowing flame inside.
// Used as both the dropModel for the starter offhand item AND the
// visible icon in inventory. The actual handheld viewmodel still
// lives inline in handheld-lamp.ts because it owns a registered
// light source + flicker (this model is just a static silhouette).
export const OIL_LAMP_MODEL: ModelSpec = {
  id: 'oil-lamp',
  materials: {
    iron: { color: 0x1a1410, metalness: 0.7, roughness: 0.45, emissive: 0x2a1a08, emissiveIntensity: 0.4, fog: false, flatShading: 'auto' },
    flame: { color: 0x000000, emissive: 0xffc488, emissiveIntensity: 2.4, roughness: 0.4, fog: false },
  },
  parts: [
    // Top + bottom plates of the cage.
    { kind: 'cylinder', pos: [0, 0.07, 0], radius: 0.06, radiusTop: 0.05, height: 0.02, segments: 8, mat: 'iron' },
    { kind: 'cylinder', pos: [0, -0.07, 0], radius: 0.055, radiusTop: 0.06, height: 0.02, segments: 8, mat: 'iron' },
    // Four cage bars connecting top and bottom.
    { kind: 'box', pos: [0.045, 0, 0.045], size: [0.012, 0.12, 0.012], mat: 'iron' },
    { kind: 'box', pos: [-0.045, 0, 0.045], size: [0.012, 0.12, 0.012], mat: 'iron' },
    { kind: 'box', pos: [0.045, 0, -0.045], size: [0.012, 0.12, 0.012], mat: 'iron' },
    { kind: 'box', pos: [-0.045, 0, -0.045], size: [0.012, 0.12, 0.012], mat: 'iron' },
    // The flame at the heart.
    { kind: 'sphere', pos: [0, 0, 0], radius: 0.028, segments: [10, 8], mat: 'flame' },
    // Top handle ring.
    { kind: 'torus', pos: [0, 0.105, 0], radius: 0.022, tube: 0.005, segments: [10, 6], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
  ],
};

export const WOODEN_SHIELD: ModelSpec = {
  id: 'wooden-shield',
  materials: {
    wood: { color: 0x3a2418, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    iron: { color: 0x32302c, roughness: 0.55, metalness: 0.7, fog: false, flatShading: 'auto' },
    boss: { color: 0x44423e, roughness: 0.5, metalness: 0.75, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Shield face — short flat cylinder (a disc).
    { kind: 'cylinder', pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], radius: 0.14, height: 0.015, segments: 18, mat: 'wood' },
    // Iron rim — torus around the edge.
    { kind: 'torus', pos: [0, 0, 0], radius: 0.140, tube: 0.008, segments: [22, 6], mat: 'iron' },
    // Central boss — small dome.
    { kind: 'sphere', pos: [0, 0, 0.015], radius: 0.030, segments: [10, 6], mat: 'boss' },
  ],
};

// Berserk potion — same flask geometry as the healing potion but with a
// bright orange-red elixir (vs healing's red) so the player can tell them
// apart on the floor without reading the name.
export const BERSERK_POTION: ModelSpec = {
  id: 'berserk-potion',
  materials: {
    glass: {
      color: 0x161814,
      roughness: 0.25,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
    elixir: {
      color: 0x000000,
      emissive: 0xff7722,        // bright orange (distinct from healing's red)
      emissiveIntensity: 2.4,
      roughness: 0.4,
      fog: false,
    },
    cork: {
      color: 0x4a3a26,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    { kind: 'cylinder', pos: [0, 0.06, 0], radius: 0.05, height: 0.10, segments: 10, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.055, 0], radius: 0.042, height: 0.08, segments: 10, mat: 'elixir' },
    { kind: 'cylinder', pos: [0, 0.135, 0], radius: 0.022, height: 0.05, segments: 8, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.175, 0], radius: 0.020, height: 0.025, segments: 8, mat: 'cork' },
  ],
};

// Tattered cloak — flat extruded silhouette of a cloak. Doesn't simulate
// actual cloth (PSX-era games used flat shapes for cloth too). Stands
// vertical as a pickup; reads as "garment" rather than a specific shape.
export const TATTERED_CLOAK: ModelSpec = {
  id: 'tattered-cloak',
  materials: {
    fabric: {
      color: 0x2a1f18,
      roughness: 1.0,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    {
      kind: 'extrude',
      pos: [0, 0, 0],
      // Cloak silhouette — trapezoid, narrow at top (shoulders) and wider
      // at the bottom (hem), with a small ragged notch at the bottom-center.
      shape: [
        // Counter-clockwise: top-left, down-left, hem-left, jagged hem...
        [-0.08, 0.30],
        [-0.10, 0.20],
        [-0.14, 0.10],
        [-0.16, 0.00],
        [-0.10, -0.02],
        [-0.04, -0.01],
        [ 0.00, -0.03],   // ragged notch
        [ 0.04, -0.01],
        [ 0.10, -0.02],
        [ 0.16, 0.00],
        [ 0.14, 0.10],
        [ 0.10, 0.20],
        [ 0.08, 0.30],
      ],
      depth: 0.015,
      mat: 'fabric',
    },
  ],
};

// ── Expansion: Armor / Helmet / Gloves / Boots / Offhand / Amulet ─────
// New visual specs for the content expansion. Where a similar piece
// already exists we vary materials + scale rather than authoring from
// scratch; the few that need a fresh silhouette get one.

/** Penitent's Robe — variant of the tattered cloak, lighter tone +
 *  longer drop. Reads as "ritual garment" vs. the cloak's "rag." */
export const PENITENTS_ROBE: ModelSpec = {
  id: 'penitents-robe',
  materials: {
    fabric: { color: 0x6a4030, roughness: 0.95, metalness: 0.0, flatShading: 'auto' },
  },
  parts: [
    { kind: 'extrude', pos: [0, 0.18, 0], shape: [
      [-0.10, 0.36], [-0.12, 0.22], [-0.16, 0.10], [-0.18, -0.02],
      [-0.12, -0.04], [-0.06, -0.02], [ 0.00, -0.04],
      [ 0.06, -0.02], [ 0.12, -0.04], [ 0.18, -0.02],
      [ 0.16, 0.10], [ 0.12, 0.22], [ 0.10, 0.36],
    ], depth: 0.018, mat: 'fabric' },
  ],
};

/** Cuirass of Ash — boxy heavy chestplate. Reads "armoured" rather
 *  than "clothed" by virtue of being a stout box with a chevron
 *  notch on the front. Charred dark grey. */
export const CUIRASS_OF_ASH: ModelSpec = {
  id: 'cuirass-of-ash',
  materials: {
    plate: { color: 0x1e1a18, roughness: 0.55, metalness: 0.75, flatShading: 'auto' },
    strap: { color: 0x180c08, roughness: 1.0, flatShading: 'auto' },
  },
  parts: [
    // Main chestplate — slightly tapered toward the bottom.
    { kind: 'box', pos: [0, 0.14, 0], size: [0.26, 0.30, 0.10], mat: 'plate' },
    // Pauldron — small box on each shoulder edge.
    { kind: 'box', pos: [-0.16, 0.24, 0], size: [0.08, 0.10, 0.10], mat: 'plate' },
    { kind: 'box', pos: [ 0.16, 0.24, 0], size: [0.08, 0.10, 0.10], mat: 'plate' },
    // Lower strap band.
    { kind: 'box', pos: [0, 0.04, 0.045], size: [0.27, 0.04, 0.02], mat: 'strap' },
  ],
};

/** Heretic's Hood — pointed cone hood reads as "cowled cultist."
 *  Black-purple tinted fabric. */
export const HERETICS_HOOD: ModelSpec = {
  id: 'heretics-hood',
  materials: {
    fabric: { color: 0x231a26, roughness: 0.95, flatShading: 'auto' },
  },
  parts: [
    // Cone shape — pointed apex, wider base.
    { kind: 'cone', pos: [0, 0.16, 0], radius: 0.14, height: 0.32, segments: 8, mat: 'fabric' },
    // Base lip — slightly wider band at the bottom for a "brim" read.
    { kind: 'torus', pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0], radius: 0.14, tube: 0.018, segments: [12, 8], mat: 'fabric' },
  ],
};

/** Skullcap of the Hanged — coif variant, recoloured darker with a
 *  small bone toggle on the crown. */
export const SKULLCAP_HANGED: ModelSpec = {
  id: 'skullcap-hanged',
  materials: {
    leather: { color: 0x1c1408, roughness: 0.92, metalness: 0.1, flatShading: 'auto' },
    bone:    { color: 0xb09878, roughness: 0.9, flatShading: 'auto' },
  },
  parts: [
    // Dome — hemisphere via slightly-flattened sphere.
    { kind: 'sphere', pos: [0, 0.08, 0], scale: [1.0, 0.7, 1.0], radius: 0.13, segments: [12, 8], mat: 'leather' },
    // Small bone fragment on top.
    { kind: 'box', pos: [0, 0.18, 0], size: [0.025, 0.045, 0.020], mat: 'bone' },
  ],
};

/** Gravecutter Gauntlets — variant of leather gloves with a brass
 *  knuckle plate on the front. */
export const GRAVECUTTER_GAUNTLETS: ModelSpec = {
  id: 'gravecutter-gauntlets',
  materials: {
    leather: { color: 0x2a1c10, roughness: 0.95, flatShading: 'auto' },
    binding: { color: 0x0c0805, roughness: 1.0 },
    brass:   { color: 0xa07a3a, roughness: 0.5, metalness: 0.85, flatShading: 'auto' },
  },
  parts: [
    { kind: 'box', pos: [0, 0.08, 0], size: [0.08, 0.12, 0.04], mat: 'leather' },
    { kind: 'box', pos: [0, 0.02, 0], size: [0.09, 0.025, 0.05], mat: 'binding' },
    { kind: 'box', pos: [0.045, 0.07, 0], size: [0.03, 0.05, 0.035], mat: 'leather' },
    // Brass knuckle plate.
    { kind: 'box', pos: [0, 0.10, 0.022], size: [0.07, 0.04, 0.012], mat: 'brass' },
  ],
};

/** Vellum Wraps — light cloth hand wrappings. Cylindrical wraps
 *  rather than a glove silhouette. Linen-pale colour. */
export const VELLUM_WRAPS: ModelSpec = {
  id: 'vellum-wraps',
  materials: {
    cloth: { color: 0xc8b890, roughness: 1.0, metalness: 0.0 },
    ink:   { color: 0x1a0c08, roughness: 1.0 },
  },
  parts: [
    // Stacked cloth rings around the wrist + hand.
    { kind: 'cylinder', pos: [0, 0.04, 0], radius: 0.044, height: 0.04, segments: 10, mat: 'cloth' },
    { kind: 'cylinder', pos: [0, 0.08, 0], radius: 0.042, height: 0.04, segments: 10, mat: 'cloth' },
    { kind: 'cylinder', pos: [0, 0.12, 0], radius: 0.040, height: 0.04, segments: 10, mat: 'cloth' },
    // Ink-stained finger wraps suggesting a scribe / caster.
    { kind: 'cylinder', pos: [0, 0.18, 0], radius: 0.030, height: 0.05, segments: 8, mat: 'ink' },
  ],
};

/** Shroud-Step Boots — slimmer profile than the worn boots; lighter
 *  fabric uppers suggest mobility. */
export const SHROUD_STEP_BOOTS: ModelSpec = {
  id: 'shroud-step-boots',
  materials: {
    fabric: { color: 0x3a2a32, roughness: 0.9 },
    sole:   { color: 0x140a08, roughness: 1.0 },
  },
  parts: [
    // Sole.
    { kind: 'box', pos: [0, 0.018, 0.02], size: [0.07, 0.020, 0.18], mat: 'sole' },
    // Upper — taller than worn boot, slimmer.
    { kind: 'box', pos: [0, 0.10, -0.02], size: [0.065, 0.16, 0.08], mat: 'fabric' },
  ],
};

/** Sin-Eater Sandals — flat sole + crossed straps. Reads ascetic. */
export const SIN_EATER_SANDALS: ModelSpec = {
  id: 'sin-eater-sandals',
  materials: {
    leather: { color: 0x281c10, roughness: 0.95 },
    strap:   { color: 0x180c06, roughness: 1.0 },
  },
  parts: [
    { kind: 'box', pos: [0, 0.012, 0.02], size: [0.075, 0.016, 0.20], mat: 'leather' },
    // Crossed straps.
    { kind: 'box', pos: [0, 0.05, 0.02], rot: [0, 0,  0.45], size: [0.12, 0.012, 0.025], mat: 'strap' },
    { kind: 'box', pos: [0, 0.05, 0.02], rot: [0, 0, -0.45], size: [0.12, 0.012, 0.025], mat: 'strap' },
  ],
};

/** Splintered Aegis — small round shield, cracked, banded with iron. */
export const SPLINTERED_AEGIS: ModelSpec = {
  id: 'splintered-aegis',
  materials: {
    wood: { color: 0x4a2e1a, roughness: 0.95, flatShading: 'auto' },
    iron: { color: 0x1e1a18, roughness: 0.5, metalness: 0.8, flatShading: 'auto' },
  },
  parts: [
    // Round shield body.
    { kind: 'cylinder', pos: [0, 0.08, 0], radius: 0.13, radiusTop: 0.13, height: 0.03, segments: 16, mat: 'wood' },
    // Iron rim.
    { kind: 'torus', pos: [0, 0.08, 0], rot: [Math.PI / 2, 0, 0], radius: 0.13, tube: 0.012, segments: [16, 8], mat: 'iron' },
    // Center boss.
    { kind: 'sphere', pos: [0, 0.08, 0.018], scale: [1, 1, 0.4], radius: 0.030, segments: [10, 8], mat: 'iron' },
  ],
};

/** Mendicant's Locket — modest amulet variant. Tarnished bronze
 *  pendant with a faint warm glow. */
export const MENDICANT_LOCKET: ModelSpec = {
  id: 'mendicant-locket',
  materials: {
    chain: { color: 0x2a2218, roughness: 0.6, metalness: 0.6, flatShading: 'auto' },
    bronze: { color: 0x4a3018, roughness: 0.55, metalness: 0.7,
              emissive: 0x884420, emissiveIntensity: 0.5, flatShading: 'auto' },
  },
  parts: [
    { kind: 'torus', pos: [0, 0.16, 0], rot: [Math.PI / 2, 0, 0], radius: 0.06, tube: 0.005, segments: [16, 6], mat: 'chain' },
    // Pendant — small round disc.
    { kind: 'cylinder', pos: [0, 0.07, 0], radius: 0.035, radiusTop: 0.035, height: 0.012, segments: 12, mat: 'bronze' },
  ],
};

/** Heart of the Drowned — amulet with a swollen blue-green stone. */
export const HEART_OF_DROWNED: ModelSpec = {
  id: 'heart-of-drowned',
  materials: {
    chain: { color: 0x1a2026, roughness: 0.7, metalness: 0.7, flatShading: 'auto' },
    stone: { color: 0x0a1820, emissive: 0x66c0e0, emissiveIntensity: 1.4,
             roughness: 0.3, metalness: 0.2, flatShading: 'auto' },
  },
  parts: [
    { kind: 'torus', pos: [0, 0.16, 0], rot: [Math.PI / 2, 0, 0], radius: 0.06, tube: 0.005, segments: [16, 6], mat: 'chain' },
    // Bulbous pendant.
    { kind: 'sphere', pos: [0, 0.07, 0], scale: [0.95, 1.10, 0.85], radius: 0.045, segments: [12, 10], mat: 'stone' },
  ],
};

// Ring colours — band style is generated via ringModel.
export const RING_OF_IRON     = ringModel('ring-iron',     0x808488, 0.8);
export const RING_OF_EMBER    = ringModel('ring-ember',    0xff5020, 2.4);
export const RING_OF_QUICKENING = ringModel('ring-quickening', 0xfff099, 2.6);

/** Phials — the unlabeled draughts (state/phial-identities.ts maps each
 *  color to ONE permanent mutation per run, unknown until first taste).
 *  Same flask silhouette as the potions so they read as drinkable; the
 *  liquid tells you nothing, which is the point. */
function phialModel(id: string, liquidEmissive: number, intensity: number): ModelSpec {
  return {
    id,
    materials: {
      glass: { color: 0x0c0c10, roughness: 0.22, metalness: 0.0, flatShading: 'auto',
               emissive: liquidEmissive, emissiveIntensity: intensity },
      cork:  { color: 0x2a2218, roughness: 0.95, flatShading: 'auto' },
    },
    parts: [
      // Rounder, squatter than the potion flask — a thing for keeping,
      // not a thing for gulping mid-fight.
      { kind: 'sphere', pos: [0, 0.045, 0], radius: 0.042, scale: [1, 1.1, 1], mat: 'glass' },
      { kind: 'cylinder', pos: [0, 0.10, 0], radius: 0.014, height: 0.035, segments: 8, mat: 'glass' },
      { kind: 'cylinder', pos: [0, 0.125, 0], radius: 0.017, height: 0.018, segments: 8, mat: 'cork' },
    ],
  };
}
export const MURKY_PHIAL = phialModel('murky-phial', 0x4a6840, 0.30);  // silted green-grey
export const BLACK_PHIAL = phialModel('black-phial', 0x1a1026, 0.22);  // drinks the light
export const PALE_PHIAL  = phialModel('pale-phial',  0x9aa8b8, 0.35);  // thin, bone-pale

/** Steady Tonic — variant of HEALING_POTION, blue glow instead of red. */
export const STEADY_TONIC: ModelSpec = {
  id: 'steady-tonic',
  materials: {
    glass: { color: 0x0a1018, roughness: 0.18, metalness: 0.0, flatShading: 'auto',
             emissive: 0x66a8e0, emissiveIntensity: 0.35 },
    cork:  { color: 0x3a2a18, roughness: 0.95, flatShading: 'auto' },
  },
  parts: [
    { kind: 'cylinder', pos: [0, 0.04, 0], radius: 0.038, radiusTop: 0.022, height: 0.08, segments: 12, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.09, 0], radius: 0.018, radiusTop: 0.018, height: 0.02, segments: 8, mat: 'cork' },
  ],
};
