import type { ModelSpec } from '../ecs/model-types';

// Model specs for the three new weapon classes added alongside the
// existing sword/dagger/hammer/spear/crossbow/wand pool. Each is kept
// simple — primitive geometry stacked, recoloured for the rarity
// theme. Distinct bespoke meshes can replace these later without
// changing the item / class wiring.

// ── Scythe — long ash haft + curved iron blade hanging off the top.
// Reaper's silhouette. The blade is an extrude shape, kept thin
// so per-face shading shows the curve.
export const REAPERS_TOLL: ModelSpec = {
  id: 'reapers-toll',
  materials: {
    // fog:false on EVERY material — a held weapon sits right at the camera and
    // would otherwise fade into the close fog (it read as a tiny, dim sickle).
    haft: { color: 0x2a1c10, roughness: 0.95, metalness: 0.05, fog: false, flatShading: 'auto' },
    binding: { color: 0x0c0805, roughness: 1.0, fog: false },
    blade: {
      color: 0x141014,
      emissive: 0x441010,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.85,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Haft — long dark cylinder (taller snath), slightly tapered at the top.
    { kind: 'cylinder', pos: [0, -0.04, 0], radius: 0.026, radiusTop: 0.021, height: 0.94, segments: 10, mat: 'haft' },
    // Leather wraps near the grip + at the head.
    { kind: 'cylinder', pos: [0, -0.34, 0], radius: 0.030, height: 0.11, segments: 8, mat: 'binding' },
    { kind: 'cylinder', pos: [0,  0.36, 0], radius: 0.028, height: 0.06, segments: 8, mat: 'binding' },
    // Blade — a BIG curved crescent (the old one read as a sickle). Mirrored to
    // −X so the hook curves INWARD (toward screen-centre when held), the way a
    // reaping blade should. Shape scaled ~1.55× + a touch thicker so it catches
    // light and reads as a proper scythe head.
    { kind: 'extrude',
      pos: [-0.16, 0.40, 0],
      rot: [0, 0, 0.22],
      shape: [
        [ 0.00,  0.00],
        [-0.66, -0.06],
        [-0.75, -0.19],
        [-0.72, -0.29],
        [-0.47, -0.16],
        [-0.19, -0.08],
        [-0.03, -0.03],
      ],
      depth: 0.014,
      mat: 'blade' },
  ],
  // Reach derives from grip→blade_tip: long haft + the big reaping blade at the
  // top, held low on the haft — a scythe reaches far.
  slots: {
    blade_tip: { pos: [-0.20, 0.58, 0] },
    grip_anchor: { pos: [0, -0.30, 0] },
  },
};

// ── Whip — short handle + a chain of small dark spheres tapering
// out. Trying to render a flexible cord is hard with primitives, so
// we fake it with a string of spheres at decreasing radius. Looks
// right in motion.
export const PENITENTS_CHAIN: ModelSpec = {
  id: 'penitents-chain',
  materials: {
    // fog:false everywhere — held weapon at the camera, mustn't fade into fog.
    grip: { color: 0x1a1208, roughness: 0.9, metalness: 0.1, fog: false, flatShading: 'auto' },
    binding: { color: 0x0c0805, roughness: 1.0, fog: false },
    cord:   { color: 0x2c1a10, roughness: 0.85, metalness: 0.2, fog: false },
  },
  parts: [
    // Handle — short cylinder, leather-wrapped at the grip end.
    { kind: 'cylinder', pos: [0, -0.10, 0], radius: 0.028, height: 0.16, segments: 10, mat: 'grip' },
    { kind: 'cylinder', pos: [0, -0.16, 0], radius: 0.032, height: 0.06, segments: 10, mat: 'binding' },
    // Metal collar where the cord starts.
    { kind: 'cylinder', pos: [0, -0.02, 0], radius: 0.030, height: 0.02, segments: 10, mat: 'cord' },
    // Cord segments — chain0..chain5 (base→tip). At rest the lash DANGLES DOWN
    // (−Y) and a little forward (−Z) off the handle — visible hanging in front
    // of you, instead of the old up-and-right jut (the "wrong direction"). The
    // ripple solver (whip-chain.ts) coils it down-back on windup and LASHES it
    // forward + up on the crack.
    { kind: 'sphere', name: 'chain0', pos: [0, -0.05, -0.02], radius: 0.024, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', name: 'chain1', pos: [0, -0.14, -0.05], radius: 0.022, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', name: 'chain2', pos: [0, -0.25, -0.09], radius: 0.019, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', name: 'chain3', pos: [0, -0.37, -0.13], radius: 0.016, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', name: 'chain4', pos: [0, -0.50, -0.17], radius: 0.013, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', name: 'chain5', pos: [0, -0.64, -0.20], radius: 0.010, segments: [8, 6], mat: 'cord' },
  ],
};

// ── Throwing knives — a single drawn knife (the one being thrown
// this frame). Small triangular blade + tiny handle. The fan of 3
// projectiles spawns on strike — this model is just the hand-held
// one mid-throw.
export const CORD_OF_KNIVES: ModelSpec = {
  id: 'cord-of-knives',
  materials: {
    grip: { color: 0x161008, roughness: 0.95 },
    blade: { color: 0xc8c8c8, roughness: 0.35, metalness: 0.85, flatShading: 'auto' },
  },
  parts: [
    // Grip — short cylinder.
    { kind: 'cylinder', pos: [0, -0.05, 0], radius: 0.014, height: 0.08, segments: 8, mat: 'grip' },
    // Blade — triangular extrusion, tip pointing +Y.
    { kind: 'extrude',
      pos: [0, 0.02, 0],
      shape: [
        [-0.018, 0.00],
        [ 0.018, 0.00],
        [ 0.000, 0.18],
      ],
      depth: 0.005,
      mat: 'blade' },
  ],
};

// ── Bent sickle — a one-handed reaping hook. Short wood grip + a small
// rusted crescent off the top. Same scythe class as Reaper's Toll but a
// mundane, compact silhouette: a tool that was never meant for this.
export const BENT_SICKLE: ModelSpec = {
  id: 'bent-sickle',
  materials: {
    grip: { color: 0x32220f, roughness: 0.95, metalness: 0.05, flatShading: 'auto' },
    binding: { color: 0x0e0a06, roughness: 1.0 },
    blade: {
      // Pitted, rust-bitten iron — dull, no glow (it is a mundane tool).
      color: 0x6a5d4e, roughness: 0.75, metalness: 0.55, flatShading: 'auto',
    },
  },
  parts: [
    // Short haft along Y (held like the scythe, just stubbier).
    { kind: 'cylinder', pos: [0, -0.07, 0], radius: 0.018, height: 0.30, segments: 10, mat: 'grip' },
    // Leather grip wrap + a collar at the head.
    { kind: 'cylinder', pos: [0, -0.16, 0], radius: 0.022, height: 0.07, segments: 8, mat: 'binding' },
    { kind: 'cylinder', pos: [0,  0.07, 0], radius: 0.020, height: 0.04, segments: 8, mat: 'binding' },
    // Crescent blade — mirrored to −X so the hook curves INWARD (toward the
    // wielder when held), like a reaping blade, not outward.
    { kind: 'extrude',
      pos: [-0.02, 0.10, 0],
      rot: [0, 0, 0.30],
      shape: [
        [ 0.00,  0.00],
        [-0.26, -0.03],
        [-0.31, -0.10],
        [-0.28, -0.15],
        [-0.17, -0.07],
        [-0.07, -0.03],
        [-0.01, -0.01],
      ],
      depth: 0.008,
      mat: 'blade' },
    // Pommel bead.
    { kind: 'sphere', pos: [0, -0.21, 0], radius: 0.020, segments: [10, 8], mat: 'grip' },
  ],
  // Short crescent on a short grip — a sickle is a close, hooking weapon.
  // Grip sits on the lower binding wrap (≈ −0.16), held near the butt so the
  // hooked head stands clear above the fist, not clutched up at the neck.
  slots: {
    blade_tip: { pos: [-0.08, 0.22, 0] },
    grip_anchor: { pos: [0, -0.16, 0] },
  },
};

// ── Pilgrim's pike — a crude boar-pike: long ashen haft running forward
// (−Z) with a pitted iron spike + a single cross-lug. The reach IS the
// read; it pokes from outside a rat's lunge. Mundane spear class.
export const PILGRIMS_PIKE: ModelSpec = {
  id: 'pilgrims-pike',
  materials: {
    haft: { color: 0x40301f, roughness: 0.92, metalness: 0.05, flatShading: 'auto' },
    bind: { color: 0x24180e, roughness: 0.85, metalness: 0.1 },
    head: { color: 0x6f6258, roughness: 0.7, metalness: 0.6, flatShading: 'auto' },
  },
  parts: [
    // Long shaft forward along −Z.
    { kind: 'cylinder', pos: [0, 0, -0.16], radius: 0.013, height: 0.84, rot: [Math.PI / 2, 0, 0], mat: 'haft', jitter: 0.004 },
    // Grip binding toward the rear.
    { kind: 'cylinder', pos: [0, 0, 0.12], radius: 0.019, height: 0.11, rot: [Math.PI / 2, 0, 0], mat: 'bind' },
    // Socket binding behind the head.
    { kind: 'cylinder', pos: [0, 0, -0.50], radius: 0.017, height: 0.05, rot: [Math.PI / 2, 0, 0], mat: 'bind' },
    // Cross-lug — a short bar across the haft below the spike (the
    // boar-pike stop). Reads as "crude" vs the clean leaf spear.
    { kind: 'box', pos: [0, 0, -0.48], size: [0.10, 0.018, 0.018], mat: 'head' },
    // Spike head — a long narrow cone at the tip.
    { kind: 'cone', pos: [0, 0, -0.62], radius: 0.022, height: 0.20, rot: [-Math.PI / 2, 0, 0], mat: 'head', jitter: 0.003 },
  ],
  slots: {
    muzzle: { pos: [0, 0, -0.72] },
    strike_point: { pos: [0, 0, -0.72] },
    grip_anchor: { pos: [0, 0, 0.16] },   // rear-hand hold → long thrust reach
  },
};
