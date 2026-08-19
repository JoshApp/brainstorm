import type { ModelSpec } from '../ecs/model-types';

// First-person held sword as a ModelSpec. Used by createSword to build the
// visible weapon attached to the camera. Animation (windup/strike/recover)
// is still procedural on the model group; the spec just defines what the
// sword looks like.
//
// All materials use fog:false so the sword doesn't fade out in dungeon fog
// (it's a held first-person item, always within "torch-lit" range).

// ── BLADE PROFILE ────────────────────────────────────────────────────────────
// The blade was a uniform slab (`box [0.04, 0.6, 0.01]`) — same width from
// guard to tip, ending in a flat chop, with a rectangular cross-section. It was
// the first model ever authored for this game and it never got the extruded
// profile every other weapon here uses. At the old idle depth you couldn't
// tell; the presence pass brought it 7cm nearer the eye and it reads as a
// paddle.
//
// Straight, double-edged, short. The slight waist at 0.38 and the deliberate
// left/right asymmetry (0.021 vs -0.020, 0.022 vs -0.023) are the "pitted and
// ill-balanced" of the flavour text — a blade ground back by hand, unevenly,
// by someone who is not a smith. Kept subtle: this is a silhouette cue, not
// damage decoration.
//
// The tip stays at y = 0.65. MELEE REACH IS DERIVED from the grip→blade extent
// at item-load, so the profile's top station is a COMBAT number, not just a
// visual one — moving it silently rebalances the weapon.
const RUSTED_BLADE_SHAPE: [number, number][] = [
  // Right edge, hilt → tip
  [ 0.023, 0.000 ],
  [ 0.026, 0.090 ],
  [ 0.025, 0.240 ],
  [ 0.021, 0.380 ],   // waist
  [ 0.022, 0.455 ],
  [ 0.016, 0.560 ],
  [ 0.000, 0.650 ],   // point
  // Left edge, tip → hilt
  [-0.017, 0.558 ],
  [-0.023, 0.452 ],
  [-0.020, 0.380 ],
  [-0.025, 0.240 ],
  [-0.026, 0.090 ],
  [-0.023, 0.000 ],
];

// The honed edge, as a narrow band per cutting side. Sampled at the SAME y
// stations as the blade outline so it TRACKS THE TAPER — the old edge strips
// were straight boxes, which is why they could only ever sit alongside a
// straight blade. Extruded slightly deeper than the blade so the band stands
// proud on both faces and catches the light the dull flat swallows.
const RUSTED_EDGE_R_SHAPE: [number, number][] = [
  [ 0.023, 0.000 ], [ 0.026, 0.090 ], [ 0.025, 0.240 ],
  [ 0.021, 0.380 ], [ 0.022, 0.455 ], [ 0.016, 0.560 ],
  [ 0.012, 0.556 ], [ 0.017, 0.452 ], [ 0.016, 0.380 ],
  [ 0.020, 0.240 ], [ 0.021, 0.090 ], [ 0.018, 0.000 ],
];
const RUSTED_EDGE_L_SHAPE: [number, number][] =
  RUSTED_EDGE_R_SHAPE.map(([x, y]) => [-x, y]);

export const SWORD_RUSTED: ModelSpec = {
  // CHOKED UP against the cross-guard. Centred on the grip cylinder (the `along: 0.5` default)
  // the fist's top edge sits 47mm below the guard, leaving a long bare stretch of hilt above
  // the hand — which is what reads as the grip being "a bit too spread vertically". A sabre is
  // held with the index knuckle up against the guard.
  grip: { along: 0.85 },
  id: 'sword-rusted',
  materials: {
    // SHINE = WORTH (docs/VISUAL-LANGUAGE.md): a mundane blade EATS
    // light. The original material (roughness 0.4 / metalness 0.85 —
    // the first model ever authored for the game) bounced torchlight
    // like a polished mirror and out-shone actual signals. The flat
    // is now pitted rust-grey that swallows the room; only the EDGE
    // material below keeps a live gleam — the one part a survivor
    // would keep honed.
    blade: {
      color: 0x5e564c,
      roughness: 0.85,
      metalness: 0.45,
      fog: false,
      flatShading: 'auto',
    },
    edge: {
      color: 0x8a857c,
      roughness: 0.45,
      metalness: 0.8,
      fog: false,
      flatShading: 'auto',
    },
    guard: {
      color: 0x3a2f22,
      roughness: 0.7,
      metalness: 0.6,
      fog: false,
      flatShading: 'auto',
    },
    grip: {
      color: 0x1a1410,
      roughness: 0.9,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
    pommel: {
      color: 0x4a3a26,
      roughness: 0.6,
      metalness: 0.7,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Tapered double-edged blade — dull rusted flat, bevelled so the
    // cross-section is a shallow lens instead of a rectangle. `jitter` pits the
    // surface: 1.2mm of vertex noise, bucketed by position so shared verts move
    // together and no seams open. Enough to break the machined look at arm's
    // length, small enough that the silhouette still reads as a sword.
    { name: 'blade',  kind: 'extrude',  shape: RUSTED_BLADE_SHAPE, depth: 0.013,
      bevel: true, bevelSize: 0.0025, bevelThickness: 0.0025, bevelSegments: 1,
      jitter: 0.0012, mat: 'blade' },
    // Honed bands, one per cutting side — proud of the blade on both faces.
    { name: 'edge_r', kind: 'extrude',  shape: RUSTED_EDGE_R_SHAPE, depth: 0.016, mat: 'edge' },
    { name: 'edge_l', kind: 'extrude',  shape: RUSTED_EDGE_L_SHAPE, depth: 0.016, mat: 'edge' },
    // Short horizontal cross-guard. Bevelled — at the new idle depth a hard-
    // edged box beside a bevelled blade reads as the cheaper object of the two.
    { name: 'guard',  kind: 'box',      pos: [0,  0.04, 0], size: [0.18, 0.025, 0.04], bevel: 0.005, mat: 'guard' },
    // Cylindrical grip
    { name: 'grip',   kind: 'cylinder', pos: [0, -0.04, 0], radius: 0.022, height: 0.13, segments: 8, mat: 'grip' },
    // Spherical pommel at the bottom
    { name: 'pommel', kind: 'sphere',   pos: [0, -0.12, 0], radius: 0.03, segments: [10, 8], mat: 'pommel' },
  ],
  slots: {
    // Tip of the blade — for future trail effects on swing.
    blade_tip: { pos: [0, 0.65, 0] },
    // Where the wielder's hand goes — for future "enemy holds sword" composition.
    grip_anchor: { pos: [0, -0.04, 0] },
  },
};
