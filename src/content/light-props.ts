import type { ModelSpec } from '../ecs/model-types';
import { CONFIG } from '../config';

// "Coloured-light props" — small fixtures whose primary purpose is throwing a
// non-warm light into a space. Used to break up the dungeon's default warm
// torch palette: e.g. a cold pale-blue crack of moonlight in a warm chamber,
// or a cyan glow in the corridor transitioning to the haunted antechamber.
//
// Each is just a ModelSpec with one visible part (a glowing slit/disc) and
// an attached PointLight in the same color family. The whole thing is placed
// via the existing 'model' prop kind — no new prop type needed.

// Moonlight crack: a vertical glowing slit on a wall. Reads as light bleeding
// in through a crack in the masonry from somewhere outside the dungeon. The
// emissive box itself is highly visible against the dark stone; the
// PointLight casts cool pale-blue into the room.
// WALL STUB — a guttering candle melted onto a tiny sill, pressed
// almost flush to the wall. Its JOB is not to light the room: mounted
// this close to the plane, its light strikes the wall at grazing
// incidence along its whole length, so the brick faces stay dark and
// the GROOVES ignite — the engraved-wall effect Josh found and asked
// to make deliberate ("swap some of the big bright light for this").
// Habitation class: someone stuck a candle here, once.
export const WALL_STUB: ModelSpec = {
  id: 'wall-stub',
  // A candle on a shallow sill — it hugs the wall far tighter than a torch on
  // an arm does. Its own light comment already said "~7cm off the wall plane".
  mount: { to: 'wall', standoff: 0.07 },
  moodTintable: true,
  materials: {
    wax: { color: 0xb0a184, roughness: 0.95, flatShading: 'auto' },
    sill: { color: 0x2a2620, roughness: 0.9, flatShading: 'auto' },
    flame: { color: 0x000000, emissive: 0xffaa55, emissiveIntensity: 2.4, roughness: 1.0, fog: false },
  },
  parts: [
    { name: 'sill', kind: 'box', pos: [0, -0.05, -0.05], size: [0.16, 0.025, 0.11], mat: 'sill' },
    { name: 'wax', kind: 'cylinder', pos: [0, 0.0, -0.06], radius: 0.026, radiusTop: 0.020, height: 0.075, segments: 8, mat: 'wax' },
    // wax drips down the sill edge
    { kind: 'box', pos: [0.04, -0.075, -0.02], size: [0.018, 0.05, 0.018], mat: 'wax' },
    { name: 'flame', kind: 'sphere', pos: [0, 0.055, -0.06], radius: 0.020, segments: [8, 6], mat: 'flame' },
  ],
  // Half-strength pool, full-length rake: the light sits ~7cm off the
  // wall plane (the builder mounts stubs tighter than torches), so the
  // wall gets grazing incidence everywhere — structure before surface.
  light: {
    color: 0xffaa55,
    intensity: 24,
    distance: 8,
    decay: 2.0,
  },
};


// Wall cresset — a wall-mounted iron sconce holding a small flame
// basket. Drop-in alternative to WALL_TORCH for the lit-fixture
// pool. Same local conventions: origin = flame centre (where the
// PointLight sits), -Z = into the wall (arm reaches back to mount).
//
// Sprite-stack flame (no MeshStandard 'flame' part) — the cheap
// per-sprite flicker handles all the "alive" work. createTorchlight
// in src/scene/torchlight.ts is built to tolerate the missing
// 'flame' / 'wisp' parts so this model needs neither.
//
// Light spec mirrors WALL_TORCH exactly so the pool can't tell the
// fixtures apart — a cresset at slot N is indistinguishable from a
// torch at slot N for shading purposes. The only difference is the
// silhouette.
export const WALL_CRESSET: ModelSpec = {
  id: 'wall-cresset',
  // Same convention as the torch: origin = flame, arm reaches back in −Z.
  mount: { to: 'wall', standoff: 0.18 },
  moodTintable: true,
  materials: {
    iron: { color: 0x14110d, roughness: 0.55, metalness: 0.6, flatShading: true },
    coal: { color: 0x1a0e08, roughness: 1.0, flatShading: true },
  },
  parts: [
    // Wall plate — small flat anchor flush with the wall, suggests
    // a forged bracket bolted into the masonry.
    { kind: 'box',      pos: [0, -0.10, -0.32], size: [0.10, 0.18, 0.04], mat: 'iron' },
    // Sconce arm — horizontal bar reaching from the plate to under
    // the basket. -Z is into wall; arm runs along Z.
    { kind: 'box',      pos: [0, -0.16, -0.18], size: [0.035, 0.035, 0.28], mat: 'iron' },
    // Brace strut — angled support from arm down to plate.
    { kind: 'box',      pos: [0, -0.21, -0.24], size: [0.025, 0.025, 0.18], rot: [Math.PI / 6, 0, 0], mat: 'iron' },
    // Basket cup — short tapered cylinder at the arm tip.
    { kind: 'cylinder', pos: [0, -0.10, -0.02], radius: 0.058, radiusTop: 0.075, height: 0.06, segments: 12, mat: 'iron' },
    // Basket rim — thin torus across the top.
    { kind: 'torus',    pos: [0, -0.07, -0.02], radius: 0.070, tube: 0.008, segments: [4, 14], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    // Coal mound inside the basket.
    { kind: 'cylinder', pos: [0, -0.085, -0.02], radius: 0.052, radiusTop: 0.045, height: 0.02, segments: 10, mat: 'coal', jitter: 0.005 },
    // Smouldering hot dots on the coal.
    {
      kind: 'sprite', pos: [-0.025, -0.07, 0.0], size: [0.06, 0.06],
      texture: 'fire-wisp', blending: 'additive', color: 0xff6824, opacity: 0.85,
      flicker: { scale: 0.30, bob: 0.004, speed: 3.1 },
    },
    {
      kind: 'sprite', pos: [ 0.025, -0.07, -0.03], size: [0.05, 0.05],
      texture: 'fire-wisp', blending: 'additive', color: 0xff7028, opacity: 0.85,
      flicker: { scale: 0.28, bob: 0.004, speed: 2.5 },
    },
    // Flame stack — small, fits within the basket footprint.
    {
      kind: 'sprite', pos: [0, -0.02, -0.02], size: [0.11, 0.13],
      texture: 'fire-wisp', blending: 'additive', color: 0xffe8b0,
      flicker: { scale: 0.18, bob: 0.014, speed: 3.3 },
    },
    {
      kind: 'sprite', pos: [0,  0.04, -0.02], size: [0.12, 0.20],
      texture: 'fire-wisp', blending: 'additive', color: 0xffd070,
      flicker: { scale: 0.22, bob: 0.024, speed: 2.5 },
    },
    {
      kind: 'sprite', pos: [0,  0.11, -0.02], size: [0.15, 0.26],
      texture: 'fire-wisp', blending: 'additive', color: 0xff9040,
      flicker: { scale: 0.24, bob: 0.032, speed: 1.9 },
    },
    {
      kind: 'sprite', pos: [0,  0.04, -0.02], size: [0.34, 0.42],
      texture: 'fire-wisp', blending: 'additive', color: 0xc8642a, opacity: 0.48,
      flicker: { scale: 0.10, bob: 0.014, speed: 0.9 },
    },
  ],
  light: {
    // Torch-class light so the pool treats cresset and torch
    // identically. No castShadow — wall cresset is a sibling of
    // torch and shadow cost on mobile is already metered by torches
    // alone; doubling the shadow casters by adding cressets isn't
    // worth it.
    color: CONFIG.TORCH_COLOR,
    intensity: CONFIG.TORCH_INTENSITY,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    castShadow: false,
  },
};

// Iron brazier — a forged fire bowl on a stout pedestal, flames
// licking up out of the bowl. Free-standing, reads from any angle
// as "occupied chamber, someone lit this." Sits anywhere on a floor.
//
// Torch-class attached PointLight — contends in the environment
// slot pool alongside torches and the wall cresset. The pool's
// LOS + frustum cull + nearest-N ranking handles slot allocation,
// so a brazier in a room with 4 torches just adds a 5th contender
// — only the player-visible ones win slots each frame.
//
// Authored centred on origin with base flush at y=0 — so a placer
// can drop it straight onto the floor with `y: 0`.
export const IRON_BRAZIER: ModelSpec = {
  id: 'iron-brazier',
  // Mood-tintable: flame + sprite colours retint to match the room's
  // torch palette, same hook the candle uses. Wax/iron unchanged.
  moodTintable: true,
  materials: {
    iron: { color: 0x161210, roughness: 0.55, metalness: 0.6, flatShading: true },
    coal: { color: 0x1a0e08, roughness: 1.0, flatShading: true },
  },
  parts: [
    // ── Pedestal ────────────────────────────────────────────────────
    // Tapered cylinder rising from the floor to under the bowl —
    // reads as a cast-iron stem, wider at the foot for stability.
    { kind: 'cylinder', pos: [0, 0.04, 0], radius: 0.18, radiusTop: 0.14, height: 0.08, segments: 14, mat: 'iron' },
    { kind: 'cylinder', pos: [0, 0.30, 0], radius: 0.10, radiusTop: 0.07, height: 0.44, segments: 12, mat: 'iron' },
    // Decorative ring band partway up the stem.
    { kind: 'torus',    pos: [0, 0.36, 0], radius: 0.09, tube: 0.012, segments: [6, 16], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    // ── Bowl ────────────────────────────────────────────────────────
    // Wide inverted cone forming the cup, with a slight rim torus on
    // top so the lip catches light. Hollow read comes from the dark
    // coal layer inside (next part).
    { kind: 'cylinder', pos: [0, 0.62, 0], radius: 0.30, radiusTop: 0.34, height: 0.14, segments: 16, mat: 'iron' },
    { kind: 'torus',    pos: [0, 0.69, 0], radius: 0.32, tube: 0.020, segments: [6, 20], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    // Charred coal layer inside the bowl — dark mound that the
    // flames sit on. Slightly smaller than the bowl interior so a
    // hint of the iron rim shows.
    { kind: 'cylinder', pos: [0, 0.65, 0], radius: 0.26, radiusTop: 0.24, height: 0.04, segments: 14, mat: 'coal', jitter: 0.01 },
    // ── Coals — a few jittered additive hot spots on top of the
    //    mound. Same trick as the bonfire. ────────────────────────
    {
      kind: 'sprite', pos: [-0.09, 0.69,  0.05], size: [0.14, 0.14],
      texture: 'fire-wisp', blending: 'additive', color: 0xff7028, opacity: 0.85,
      flicker: { scale: 0.30, bob: 0.005, speed: 3.4 },
    },
    {
      kind: 'sprite', pos: [ 0.11, 0.69, -0.06], size: [0.12, 0.12],
      texture: 'fire-wisp', blending: 'additive', color: 0xff6020, opacity: 0.85,
      flicker: { scale: 0.28, bob: 0.005, speed: 2.7 },
    },
    {
      kind: 'sprite', pos: [-0.02, 0.69, -0.12], size: [0.10, 0.10],
      texture: 'fire-wisp', blending: 'additive', color: 0xff8030, opacity: 0.85,
      flicker: { scale: 0.32, bob: 0.005, speed: 3.9 },
    },
    // ── Flame stack — bonfire layering, scaled to the bowl ────────
    // White core → yellow body → orange tongue → red tip, plus a
    // wider warmth haze. Same family as the bonfire but ~half the
    // size since the bowl is ~half the footprint of a fire pit.
    {
      kind: 'sprite', pos: [0, 0.78, 0], size: [0.24, 0.24],
      texture: 'fire-wisp', blending: 'additive', color: 0xffe8b0,
      flicker: { scale: 0.18, bob: 0.020, speed: 3.2 },
    },
    {
      kind: 'sprite', pos: [0, 0.88, 0], size: [0.26, 0.40],
      texture: 'fire-wisp', blending: 'additive', color: 0xffd070,
      flicker: { scale: 0.20, bob: 0.035, speed: 2.4 },
    },
    {
      kind: 'sprite', pos: [0, 0.98, 0], size: [0.34, 0.52],
      texture: 'fire-wisp', blending: 'additive', color: 0xff9040,
      flicker: { scale: 0.22, bob: 0.05, speed: 1.7 },
    },
    {
      kind: 'sprite', pos: [0, 1.12, 0], size: [0.20, 0.58],
      texture: 'fire-wisp', blending: 'additive', color: 0xff5020,
      flicker: { scale: 0.28, bob: 0.08, speed: 2.9 },
    },
    // Outer warmth haze — wide + dim.
    {
      kind: 'sprite', pos: [0, 0.88, 0], size: [0.85, 0.70],
      texture: 'fire-wisp', blending: 'additive', color: 0xc8642a, opacity: 0.55,
      flicker: { scale: 0.10, bob: 0.02, speed: 0.9 },
    },
  ],
  light: {
    // Brazier shares the torch-class profile so it can substitute
    // for / contend alongside torches in the environment light pool
    // without changing the budget. Light origin sits at the flame
    // stack's mid-height (≈0.95m). castShadow off — most braziers
    // sit near a wall and a shadow caster there pays for almost no
    // visible benefit.
    color: CONFIG.TORCH_COLOR,
    intensity: CONFIG.TORCH_INTENSITY,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    pos: [0, 0.95, 0],
    castShadow: false,
  },
};

// Cresset pike — a tall iron rod driven point-first into the floor,
// crowned with a small flame basket. Tall narrow silhouette reads
// well at room edges, in corners, or flanking doorways without
// claiming much floor footprint. ~2.0m total.
//
// Like the brazier: torch-class attached PointLight registered with
// the environment pool. The light origin sits at the basket height
// so the floor pool around the pike matches the visible flame.
export const CRESSET_PIKE: ModelSpec = {
  id: 'cresset-pike',
  moodTintable: true,
  materials: {
    iron: { color: 0x161210, roughness: 0.55, metalness: 0.6, flatShading: true },
    coal: { color: 0x1a0e08, roughness: 1.0, flatShading: true },
  },
  parts: [
    // Spike at the base — small cone pointing UP from the floor,
    // suggesting the pike is driven point-first into stone.
    { kind: 'cone',     pos: [0, 0.06, 0], radius: 0.05, height: 0.12, segments: 8, mat: 'iron' },
    // Ring band at the bottom of the visible pole — like a
    // wrought-iron foot collar.
    { kind: 'torus',    pos: [0, 0.13, 0], radius: 0.045, tube: 0.010, segments: [6, 12], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    // Main pole — thin cylinder running up to the basket.
    { kind: 'cylinder', pos: [0, 0.95, 0], radius: 0.025, height: 1.65, segments: 10, mat: 'iron' },
    // Mid-pole cross-arms — two short horizontal cylinders crossed,
    // purely decorative. Reads as wrought-iron filigree.
    { kind: 'cylinder', pos: [0, 1.05, 0], radius: 0.012, height: 0.22, segments: 6, rot: [0, 0, Math.PI / 2], mat: 'iron' },
    { kind: 'cylinder', pos: [0, 1.05, 0], radius: 0.012, height: 0.22, segments: 6, rot: [Math.PI / 2, 0, Math.PI / 2], mat: 'iron' },
    // Basket cup at the top — short wide tapered cylinder.
    { kind: 'cylinder', pos: [0, 1.86, 0], radius: 0.13, radiusTop: 0.16, height: 0.10, segments: 14, mat: 'iron' },
    { kind: 'torus',    pos: [0, 1.91, 0], radius: 0.15, tube: 0.012, segments: [6, 18], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    // Coal mound inside the basket.
    { kind: 'cylinder', pos: [0, 1.88, 0], radius: 0.11, radiusTop: 0.10, height: 0.03, segments: 12, mat: 'coal', jitter: 0.008 },
    // Smouldering coal dots.
    {
      kind: 'sprite', pos: [-0.04, 1.91,  0.02], size: [0.08, 0.08],
      texture: 'fire-wisp', blending: 'additive', color: 0xff6824, opacity: 0.85,
      flicker: { scale: 0.30, bob: 0.004, speed: 3.1 },
    },
    {
      kind: 'sprite', pos: [ 0.05, 1.91, -0.04], size: [0.07, 0.07],
      texture: 'fire-wisp', blending: 'additive', color: 0xff7028, opacity: 0.85,
      flicker: { scale: 0.28, bob: 0.004, speed: 2.5 },
    },
    // Flame stack — narrower than the brazier (smaller basket).
    {
      kind: 'sprite', pos: [0, 1.98, 0], size: [0.14, 0.16],
      texture: 'fire-wisp', blending: 'additive', color: 0xffe8b0,
      flicker: { scale: 0.18, bob: 0.018, speed: 3.4 },
    },
    {
      kind: 'sprite', pos: [0, 2.06, 0], size: [0.16, 0.26],
      texture: 'fire-wisp', blending: 'additive', color: 0xffd070,
      flicker: { scale: 0.22, bob: 0.030, speed: 2.5 },
    },
    {
      kind: 'sprite', pos: [0, 2.16, 0], size: [0.20, 0.34],
      texture: 'fire-wisp', blending: 'additive', color: 0xff9040,
      flicker: { scale: 0.24, bob: 0.04, speed: 1.8 },
    },
    {
      kind: 'sprite', pos: [0, 2.28, 0], size: [0.12, 0.34],
      texture: 'fire-wisp', blending: 'additive', color: 0xff5020,
      flicker: { scale: 0.28, bob: 0.06, speed: 2.9 },
    },
    // Outer warmth haze — narrow + tall so the silhouette stays
    // pike-like at distance.
    {
      kind: 'sprite', pos: [0, 2.10, 0], size: [0.45, 0.60],
      texture: 'fire-wisp', blending: 'additive', color: 0xc8642a, opacity: 0.50,
      flicker: { scale: 0.10, bob: 0.02, speed: 0.9 },
    },
  ],
  light: {
    // Pike rides the same torch-class profile as the brazier.
    // Position is raised toward the basket (≈2.1m) so the light's
    // apparent origin matches the visible flame.
    color: CONFIG.TORCH_COLOR,
    intensity: CONFIG.TORCH_INTENSITY,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    pos: [0, 2.10, 0],
    castShadow: false,
  },
};

// Floor glow: ambient mood. Earlier passes tried to make this
// the primary "room is tinted" lever via a bright PointLight +
// bright floor decal — but that read as "spotlight on the floor"
// and competed with fountains, altars, anything else that wanted
// to anchor the eye in the room centre.
//
// New model: floorGlow is JUST a handful of additive specks of
// dust hanging in the air around its anchor, plus a very soft
// fill light that tints nearby surfaces. The actual room mood
// (warm vs cold vs sickly green) comes from per-vault TORCH
// tinting now. floorGlow's role is the local accent — a hint of
// colour over a specific prop (an altar, a chest pile) — not the
// room's lighting register.
// Great brazier — the IRON_BRAZIER model with a HALL-grade light. A wall
// torch (and the plain iron brazier) only reaches ~torch-distance, which
// leaves the centre of a big arena (e.g. the 18×16 boss-hall) in the dark.
// This variant throws light ~2× as far and brighter, so a few ringing an
// arena actually light the floor the boss fights on — a free-standing,
// not-on-the-wall light source for large rooms. Reuses the brazier parts;
// only the light spec differs.
export const GREAT_BRAZIER: ModelSpec = {
  ...IRON_BRAZIER,
  id: 'great-brazier',
  light: {
    color: CONFIG.TORCH_COLOR,
    intensity: CONFIG.TORCH_INTENSITY * 1.8,
    distance: CONFIG.TORCH_DISTANCE * 2.0,
    decay: CONFIG.TORCH_DECAY,
    pos: [0, 0.95, 0],
    castShadow: false,
  },
};

export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  const id = `floor-glow-${tint.toString(16)}`;
  // Small additive motes scattered around the source. Tiny enough
  // that they read as "dust in the air catching the light"
  // rather than as a glowing object on the floor.
  const motes: Array<{ pos: [number, number, number]; size: [number, number] }> = [
    { pos: [-0.6,  0.45,  0.2], size: [0.22, 0.26] },
    { pos: [ 0.5,  0.30, -0.4], size: [0.18, 0.22] },
    { pos: [ 0.3,  0.85,  0.5], size: [0.16, 0.20] },
    { pos: [-0.4,  1.20, -0.3], size: [0.20, 0.24] },
    { pos: [ 0.1,  1.70,  0.0], size: [0.14, 0.18] },
    { pos: [-0.2,  2.20,  0.3], size: [0.12, 0.16] },
  ];
  return {
    id,
    materials: {},
    parts: motes.map((m) => ({
      kind: 'sprite' as const,
      pos: m.pos,
      size: m.size,
      texture: 'fire-wisp',
      color: tint,
      blending: 'additive' as const,
    })),
    light: {
      color: tint,
      // Subtle, broad, raised. Doesn't ANCHOR the room — just
      // tints whatever's already in it. Was intensity 13 / dist 13
      // / decay 1.8; now much softer + wider so the colour
      // suffuses without any spot being bright.
      intensity: 6,
      distance: 14,
      decay: 2.2,
      pos: [0, 2.0, 0],
      castShadow: false,
    },
  };
}
