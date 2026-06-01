// Enemy model factories — primitive-composed ModelSpecs for each creature
// silhouette. Split out of enemies.ts (which now holds only the data specs
// + registry). Each is a function of its palette so a re-skinned variant
// (e.g. an elite ghoul) reuses the shape with new material colours.

import type { ModelSpec, Vec3 } from '../ecs/model-types';
import { creature } from './creature';


// Two simple, distinct humanoid silhouettes built from primitives. Defined as
// functions of (bodyColor, eyeColor) so a future "elite ghoul" with a different
// palette doesn't need a duplicate model — it's the same shape with new
// material colors.

export function humanoidGhoulModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Grounded lurching corpse. Rig sits HIGHER (1.05) so the torso isn't
  // a capsule dragging on the floor — it's a body STANDING on stumpy
  // legs and flat ankle-less feet. Heavy asymmetry up top (left shoulder
  // bigger, left arm longer), wide bowed legs below. Faint festering
  // emissive; no rim (this is flesh, not spectral).
  return {
    id: 'ghoul-humanoid',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x180806,
        emissiveIntensity: 0.35,
        flatShading: 'auto',
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 1.05, 0] },
      weapon:   { pos: [0.35, 1.15, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.9, 0] satisfies Vec3 },
      // Shoulder pivots (parented to rig) — the pose-clip layer swings
      // these so the ghoul's arms heave up on windup + slam on strike.
      shoulderL: { pos: [-0.34, 0.20, 0.06], parent: 'rig' },
      shoulderR: { pos: [ 0.34, 0.20, 0.06], parent: 'rig' },
      // Hip pivots — legs swing from these with the walk gait.
      hipL: { pos: [-0.20, -0.40, 0], parent: 'rig' },
      hipR: { pos: [ 0.20, -0.40, 0], parent: 'rig' },
      // Neck pivot — head + eyes crane from here toward the player.
      neck: { pos: [0, 0.40, 0], parent: 'rig' },
    },
    parts: [
      // FEET — wide low cylinders. Hung under the hip pivots (relative
      // pos) so they swing with the legs.
      { parent: 'hipL', kind: 'cylinder', pos: [0, -0.60, 0.04], radius: 0.16, height: 0.08, segments: 8, mat: 'body', jitter: 0.012 },
      { parent: 'hipR', kind: 'cylinder', pos: [0, -0.60, -0.02], radius: 0.16, height: 0.08, segments: 8, mat: 'body', jitter: 0.012 },
      // LEGS — thick stumpy capsules bowed outward (different lengths
      // matching the asymmetric body theme).
      { parent: 'hipL', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.13, height: 0.40, mat: 'body', jitter: 0.018 },
      { parent: 'hipR', kind: 'capsule', pos: [0, -0.22, 0], radius: 0.12, height: 0.36, mat: 'body', jitter: 0.018 },
      // BODY — sits on top of the legs. Shorter than before (0.55) so
      // proportions read "torso on legs" not "leg-less capsule."
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.10, 0], scale: [1.10, 0.95, 0.95], radius: 0.34, height: 0.55, mat: 'body', jitter: 0.030 },
      // ASYMMETRIC SHOULDER HUMPS — left noticeably larger.
      { parent: 'rig', kind: 'sphere', pos: [-0.32, 0.30, 0], radius: 0.22, segments: [12, 10], mat: 'body', jitter: 0.022 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.32, 0.35, 0], radius: 0.16, segments: [12, 10], mat: 'body', jitter: 0.022 },
      // ARMS — different lengths (left longer). Hung from the shoulder
      // pivots (pos relative to each pivot) so the pose layer swings them.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.085, height: 0.50, mat: 'body', jitter: 0.020 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.15, 0], radius: 0.080, height: 0.35, mat: 'body', jitter: 0.020 },
      // FISTS — asymmetric (left larger, hanging lower).
      { parent: 'shoulderL', kind: 'sphere', pos: [0, -0.54, 0], radius: 0.105, segments: [10, 8], mat: 'body', jitter: 0.018 },
      { parent: 'shoulderR', kind: 'sphere', pos: [0, -0.34, 0], radius: 0.088, segments: [10, 8], mat: 'body', jitter: 0.018 },
      // HEAD — hunched forward (z=-0.05). Hung off the neck pivot so it
      // cranes toward the player.
      { name: 'head', parent: 'neck', kind: 'sphere',  pos: [0, 0.15, -0.05], scale: [1.08, 0.95, 1], radius: 0.27, mat: 'body', jitter: 0.025 },
      // Eyes — slightly closer together than wraith, set deep.
      { parent: 'neck', kind: 'sphere', pos: [-0.08, 0.18, -0.30], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      { parent: 'neck', kind: 'sphere', pos: [ 0.08, 0.18, -0.30], radius: 0.045, segments: [12, 10], mat: 'eyes' },
    ],
  };
}

// Quadruped — body horizontal, four small leg capsules, long tail. Demonstrates
// the model system handling a fundamentally different silhouette from primitives.
export function quadrupedRatModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Mangy, twitchy quadruped. Light jitter (small creature — heavy jitter
  // would collapse the silhouette). Whiskers added as thin cones forward
  // of the snout. Eye glow turned up so a darting red pinprick reads at
  // a glance even when the body's near-black against floor.
  return {
    id: 'rat-quadruped',
    materials: {
      // Slight emissive on the body so the rat doesn't black out completely
      // in unlit floor gaps. Dark warm tone.
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x0a0604,
        emissiveIntensity: 0.5,
        flatShading: 'auto',
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      // Whisker material — flat, no jitter, very dim.
      whisker: { color: 0x1a1410, roughness: 1.0, flatShading: 'auto' },
    },
    slots: {
      rig: { pos: [0, 0.14, 0] },
      back: { pos: [0, 0.22, 0] },
    },
    parts: [
      // Body — light jitter; the rat is small so big amplitudes would
      // tear the capsule.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], radius: 0.10, height: 0.28, mat: 'body', jitter: 0.008 },
      // Head — same light jitter as body.
      { name: 'head', parent: 'rig', kind: 'sphere', pos: [0, -0.01, -0.22], radius: 0.085, mat: 'body', jitter: 0.008 },
      // Snout
      { parent: 'rig', kind: 'cone', pos: [0, -0.025, -0.30], rot: [-Math.PI / 2, 0, 0], radius: 0.04, height: 0.07, segments: 8, mat: 'body' },
      // Eyes — popped out of the head surface.
      { parent: 'rig', kind: 'sphere', pos: [-0.05, 0.025, -0.305], radius: 0.022, mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.05, 0.025, -0.305], radius: 0.022, mat: 'eyes' },
      // Eye halo sprites — tiny additive flares so the eyes read at distance
      // (the spheres alone go to a pixel each on a phone screen).
      { parent: 'rig', kind: 'sprite', pos: [-0.05, 0.025, -0.31], size: [0.08, 0.08], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { parent: 'rig', kind: 'sprite', pos: [ 0.05, 0.025, -0.31], size: [0.08, 0.08], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      // Whiskers — four thin cones sticking forward, slightly fanned. Sells
      // "rodent" in one glance.
      { parent: 'rig', kind: 'cylinder', pos: [-0.045, -0.005, -0.35], rot: [-Math.PI / 2, 0,  0.5], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      { parent: 'rig', kind: 'cylinder', pos: [-0.04,  -0.025, -0.35], rot: [-Math.PI / 2, 0,  0.3], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      { parent: 'rig', kind: 'cylinder', pos: [ 0.045, -0.005, -0.35], rot: [-Math.PI / 2, 0, -0.5], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      { parent: 'rig', kind: 'cylinder', pos: [ 0.04,  -0.025, -0.35], rot: [-Math.PI / 2, 0, -0.3], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      // Four legs
      { parent: 'rig', kind: 'capsule', pos: [-0.07, -0.10, -0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.07, -0.10, -0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [-0.07, -0.10,  0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.07, -0.10,  0.10], radius: 0.022, height: 0.05, mat: 'body' },
      // Tail — light jitter for irregular mangy look.
      { parent: 'rig', kind: 'cylinder', pos: [0, 0, 0.28], rot: [Math.PI / 2, 0, 0], radius: 0.015, radiusTop: 0.005, height: 0.30, segments: 6, mat: 'body', jitter: 0.006 },
    ],
  };
}

// Acolyte — hooded ranged caster. Wider robe extrude underneath (no
// visible feet — looks like it's floating in fabric), tall thin body
// capsule, dark hooded head (eyes deep-set, glowing slits), staff parented
// to the weapon slot with a glowing orb at the tip that matches the
// projectile color. Reads at a glance: "thin dark figure with a glowing
// stick — that one shoots."
export function acolyteModel(bodyColor: number, eyeColor: number, eyeEmissive: number, staffGlow: number): ModelSpec {
  // Ritual caster. Robe gets heavy jitter (torn ceremonial fabric);
  // body gets a faint green rim — the magic they channel illuminates
  // them from within at the edges. 'chant' presence pulses the orb's
  // emissive each frame so the staff feels alive even at rest.
  return {
    id: 'acolyte-caster',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        flatShading: 'auto',
        // Subtle channelled-magic rim — same green family as the orb
        // but desaturated so it reads as reflected glow, not the orb
        // itself bleeding through the body.
        rim: { color: 0x3a8060, power: 3.5, intensity: 0.6 },
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      robe: {
        color: 0x080a0e,
        roughness: 1.0,
        flatShading: 'auto',
        // Robe gets the same faint green rim as the body — keeps the
        // overall silhouette outlined in the magic palette.
        rim: { color: 0x224c3a, power: 3.5, intensity: 0.5 },
        dissolvable: true,
      },
      staff: { color: 0x1a140e, roughness: 0.9, flatShading: 'auto', dissolvable: true },
      orb: { color: 0x000000, emissive: staffGlow, emissiveIntensity: 2.6, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 0.85, 0] },
      muzzle: { pos: [0.30, 1.20, -0.15] satisfies Vec3 },
      // Neck pivot — hood + head + eyes crane toward the player.
      neck: { pos: [0, 0.60, 0], parent: 'rig' },
    },
    parts: [
      // Robed trailing tail — torn fabric look via heavy jitter on the
      // extruded silhouette.
      {
        kind: 'extrude', parent: 'rig',
        pos: [0, -0.55, 0],
        shape: [
          [-0.26, 0.55], [-0.34, 0.10], [-0.22, -0.35], [-0.08, -0.50],
          [ 0.08, -0.50], [ 0.22, -0.35], [ 0.34, 0.10], [ 0.26, 0.55],
        ],
        depth: 0.05,
        mat: 'robe',
        jitter: 0.025,
      },
      // Body — light jitter (the body is mostly hidden by robe; heavy
      // jitter would distort the robe shape too).
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0.05, 0], radius: 0.26, height: 0.85, mat: 'robe', jitter: 0.012 },
      // Head — slightly elongated, light jitter.
      { name: 'head', parent: 'neck', kind: 'sphere', pos: [0, 0.15, 0], scale: [1, 1.10, 1], radius: 0.22, mat: 'body', jitter: 0.014 },
      // Hood — cone with jitter so the fabric reads as crumpled/torn,
      // not factory-made. On the neck so it cranes with the head.
      { parent: 'neck', kind: 'cone', pos: [0, 0.26, 0.02], radius: 0.30, height: 0.40, segments: 10, mat: 'robe', jitter: 0.020 },
      // Eyes — small mesh spheres deep under the hood.
      { parent: 'neck', kind: 'sphere', pos: [-0.08, 0.14, -0.20], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { parent: 'neck', kind: 'sphere', pos: [ 0.08, 0.14, -0.20], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { name: 'eyeHaloL', parent: 'neck', kind: 'sprite', pos: [-0.08, 0.14, -0.24], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { name: 'eyeHaloR', parent: 'neck', kind: 'sprite', pos: [ 0.08, 0.14, -0.24], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      // Staff — thin, slight jitter for hand-carved feel.
      { parent: 'rig', kind: 'cylinder', pos: [0.30, 0.10, -0.05], radius: 0.025, height: 1.4, segments: 6, mat: 'staff', jitter: 0.008 },
      // Orb — clean (no jitter; magic geometry should look intentional).
      { parent: 'rig', kind: 'sphere', pos: [0.30, 0.80, -0.05], radius: 0.085, segments: [12, 10], mat: 'orb' },
      // Halo around the orb so the projectile color reads at distance.
      { parent: 'rig', kind: 'sprite', pos: [0.30, 0.80, -0.05], size: [0.40, 0.40], texture: 'fire-wisp', blending: 'additive', color: staffGlow },
    ],
  };
}

export function skirmisherModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Grounded lean predator — distinct from the ghoul by silhouette
  // alone:
  //   - Tall + narrow (vs ghoul's bulky + hunched).
  //   - Symmetric (vs ghoul's asymmetric).
  //   - Thin legs + small box feet (vs ghoul's stumpy cylinders).
  //   - Crossed-belt sash + ribbed loincloth (clothed; the ghoul is
  //     bare flesh).
  // Faint amber rim catches light on edges — reads as taut skin over
  // wiry muscle, not wraith-style spectral glow.
  return {
    id: 'skirmisher-humanoid',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        flatShading: 'auto',
        rim: { color: 0x9c6a3a, power: 3.5, intensity: 0.55 },
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      strap: { color: 0x0d0a07, roughness: 1.0, flatShading: 'auto', dissolvable: true },
    },
    slots: {
      rig: { pos: [0, 1.00, 0] },
      weapon:   { pos: [0.28, 1.0, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.85, 0] satisfies Vec3 },
      // Shoulder PIVOTS — parented to the rig so they follow the body
      // lean AND can swing the arms independently (the pose-clip layer
      // rotates these). Arms + fists hang below each pivot.
      shoulderL: { pos: [-0.24, 0.16, 0], parent: 'rig' },
      shoulderR: { pos: [ 0.24, 0.16, 0], parent: 'rig' },
      // Hip pivots — legs swing from these with the walk gait.
      hipL: { pos: [-0.11, -0.30, 0], parent: 'rig' },
      hipR: { pos: [ 0.11, -0.30, 0], parent: 'rig' },
      // Neck pivot — head + eyes crane toward the player.
      neck: { pos: [0, 0.36, 0], parent: 'rig' },
    },
    parts: [
      // FEET — narrow boxes (not cylinders like ghoul). Hung under the
      // hip pivots so they stride with the legs.
      { parent: 'hipL', kind: 'box', size: [0.13, 0.06, 0.22], pos: [0, -0.66, 0.05], mat: 'body', jitter: 0.009 },
      { parent: 'hipR', kind: 'box', size: [0.13, 0.06, 0.22], pos: [0, -0.66, 0.05], mat: 'body', jitter: 0.009 },
      // LEGS — thin (radius 0.075, taller 0.55 height). Held vertical,
      // closer together than ghoul's bowed stance.
      { parent: 'hipL', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.075, height: 0.55, mat: 'body', jitter: 0.010 },
      { parent: 'hipR', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.075, height: 0.55, mat: 'body', jitter: 0.010 },
      // BODY — narrower than ghoul (radius 0.25 vs 0.34), TALLER torso.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.05, 0], scale: [0.90, 1.10, 1.0], radius: 0.25, height: 0.60, mat: 'body', jitter: 0.013 },
      // CROSSED-BELT SASH — angled across the chest.
      { parent: 'rig', kind: 'extrude', pos: [0, 0.15, -0.24], rot: [0, 0, 0.55],
        shape: [[-0.30, -0.03], [0.30, -0.03], [0.30, 0.03], [-0.30, 0.03]],
        depth: 0.04, mat: 'strap' },
      // LOINCLOTH — small extruded strip around the waist. Sells "clothed"
      // and visually separates body from legs.
      { parent: 'rig', kind: 'extrude', pos: [0, -0.30, 0],
        shape: [[-0.22, -0.05], [0.22, -0.05], [0.22, 0.05], [-0.22, 0.05]],
        depth: 0.32, mat: 'strap' },
      // Shoulder humps — small + symmetric.
      { parent: 'rig', kind: 'sphere', pos: [-0.22, 0.25, 0], radius: 0.12, segments: [12, 10], mat: 'body', jitter: 0.011 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.22, 0.25, 0], radius: 0.12, segments: [12, 10], mat: 'body', jitter: 0.011 },
      // Arms — long thin capsules, hung from the shoulder PIVOTS (not
      // the rig) so the pose-clip layer can swing them on the charge.
      // pos is relative to the shoulder slot; the capsule hangs below it.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.28, 0.04], radius: 0.050, height: 0.55, mat: 'body', jitter: 0.011 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.28, 0.04], radius: 0.050, height: 0.55, mat: 'body', jitter: 0.011 },
      // Small fists — at the end of each arm, also under the pivot.
      { parent: 'shoulderL', kind: 'sphere', pos: [0, -0.58, 0.04], radius: 0.060, segments: [10, 8], mat: 'body', jitter: 0.010 },
      { parent: 'shoulderR', kind: 'sphere', pos: [0, -0.58, 0.04], radius: 0.060, segments: [10, 8], mat: 'body', jitter: 0.010 },
      // Head — narrow + slightly forward (craned, scout-like). Hung off
      // the neck pivot so it tracks the player.
      { name: 'head', parent: 'neck', kind: 'sphere',  pos: [0, 0.14, -0.06], scale: [0.85, 1.05, 1.05], radius: 0.20, mat: 'body', jitter: 0.012 },
      // Eyes — wider apart than ghoul, push the alert-predator read.
      { parent: 'neck', kind: 'sphere', pos: [-0.08, 0.16, -0.26], radius: 0.040, segments: [12, 10], mat: 'eyes' },
      { parent: 'neck', kind: 'sphere', pos: [ 0.08, 0.16, -0.26], radius: 0.040, segments: [12, 10], mat: 'eyes' },
      // Eye halos (amber).
      { parent: 'neck', kind: 'sprite', pos: [-0.08, 0.16, -0.29], size: [0.14, 0.14], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { parent: 'neck', kind: 'sprite', pos: [ 0.08, 0.16, -0.29], size: [0.14, 0.14], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
    ],
  };
}

// Wraith — tall hovering spectral figure. Pale glowing body, sunken eyes,
// magic-damage melee. Slow + telegraphed but hits hard and bypasses
// physical armor entirely (only magic-armor reduces). Pairs with the bone
// amulet's magic-armor passive as a real soft-counter.
export function wraithModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Spectral palette tuned for "soft ghost glow at body edges" — emissive
  // ramped up so the silhouette reads in shadow, color shifted slightly
  // cooler than the previous teal.
  return {
    id: 'wraith',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x2a4a5c,
        emissiveIntensity: 0.55,
        flatShading: 'auto',
        // Fresnel rim — fragments at the silhouette edge get a soft
        // teal glow. Sells "ghost" without translucency. Tuned cooler
        // than the eye color so it reads as ambient spectral presence,
        // not as the eyes themselves leaking.
        rim: { color: 0x4a8cb0, power: 2.2, intensity: 1.4 },
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      robe: {
        color: 0x070b10,
        roughness: 1.0,
        flatShading: 'auto',
        // Robe gets a much subtler rim — it's near-black, so a soft
        // edge glow keeps its silhouette visible against the fog.
        rim: { color: 0x1f3340, power: 3.0, intensity: 0.8 },
        dissolvable: true,
      },
      // 'bone' — used for the gnarled arms + claw tips. Paler than the
      // body to read as exposed bone reaching out of the robe sleeves.
      bone: {
        color: 0x4a4338,
        roughness: 1.0,
        emissive: 0x1a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
        // Bone rim is pale cyan-white — reads as cold light catching
        // on bone surfaces.
        rim: { color: 0xa8d4e0, power: 2.8, intensity: 1.1 },
        dissolvable: true,
      },
    },
    slots: {
      // 'rig' sits HIGHER than other enemies so the wraith visibly floats —
      // feet should be off the floor. The presence-tick adds a slow bob
      // on top of this baseline.
      rig: { pos: [0, 1.05, 0] },
      // Shoulder pivots — the spindly arms reach forward on the strike.
      shoulderL: { pos: [-0.32, 0.20, 0.06], parent: 'rig' },
      shoulderR: { pos: [ 0.32, 0.20, 0.06], parent: 'rig' },
      // Neck pivot — the gnarled skull cranes toward the player.
      neck: { pos: [0, 0.58, 0], parent: 'rig' },
    },
    parts: [
      // OUTER AURA — large additive sprite behind everything else. Reads
      // as "this thing has presence beyond its physical body." Cool teal
      // matches the body emissive. Big enough to bloom outside the
      // silhouette, low enough alpha that it doesn't wash the room.
      { parent: 'rig', kind: 'sprite', pos: [0, 0.20, 0.05], size: [1.7, 2.2], texture: 'fire-wisp', blending: 'additive', color: 0x224058 },

      // ROBE TAIL — wider, more irregular silhouette than the original
      // (note the asymmetric points — left side shorter, right side
      // ragged). Heavy jitter on the extrude vertices gives torn-fabric
      // edges that vary per-instance.
      {
        kind: 'extrude', parent: 'rig',
        pos: [0, -0.55, 0],
        shape: [
          [-0.22, 0.55], [-0.34, 0.10], [-0.30, -0.20], [-0.22, -0.45], [-0.08, -0.55],
          [ 0.04, -0.50], [ 0.16, -0.58], [ 0.28, -0.35], [ 0.34, -0.05], [ 0.30, 0.25], [ 0.22, 0.55],
        ],
        depth: 0.06,
        mat: 'robe',
        jitter: 0.035,
      },

      // BODY — tall capsule, jittered so the surface looks gnarled rather
      // than a polished pill. Slight horizontal scale so it's not a perfect
      // cylinder of revolution; reads more like robed shoulders.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0.05, 0], scale: [1.05, 1, 1], radius: 0.30, height: 0.80, mat: 'body', jitter: 0.035 },

      // SHOULDER HUMPS — small spheres jutting out at the shoulders to
      // break the cylindrical body silhouette. Each one gets independent
      // jitter so the two shoulders aren't symmetric.
      { parent: 'rig', kind: 'sphere', pos: [-0.30, 0.40, 0.02], radius: 0.16, segments: [12, 10], mat: 'body', jitter: 0.025 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.30, 0.40, 0.02], radius: 0.16, segments: [12, 10], mat: 'body', jitter: 0.025 },

      // ARMS — long thin capsules hung from the shoulder pivots.
      // "Spindly," not muscular. The bone material reads paler so they
      // pop against the dark body. Heavy jitter twists them into gnarled
      // limbs. The pivots let them reach forward on the strike.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.045, height: 0.55, mat: 'bone', jitter: 0.020 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.045, height: 0.55, mat: 'bone', jitter: 0.020 },

      // CLAW TIPS — small jittered spheres at the bottom of each arm so
      // the silhouette ends in something pointy rather than rounded.
      { parent: 'shoulderL', kind: 'sphere', pos: [-0.02, -0.62, 0], radius: 0.055, segments: [10, 8], mat: 'bone', jitter: 0.025 },
      { parent: 'shoulderR', kind: 'sphere', pos: [ 0.02, -0.62, 0], radius: 0.055, segments: [10, 8], mat: 'bone', jitter: 0.025 },

      // HEAD — sphere with vertical scale + jitter. Used to be a clean
      // ovoid; now it's a gnarled skull-ish shape unique to each instance.
      { name: 'head', parent: 'neck', kind: 'sphere', pos: [0, 0.17, 0], scale: [1, 1.18, 1], radius: 0.24, mat: 'body', jitter: 0.030 },

      // EYE SPHERES + HALO SPRITES — same dual-layer pattern as before
      // (mesh for close-up, sprite for distance). On the neck so they
      // crane with the head.
      { parent: 'neck', kind: 'sphere', pos: [-0.10, 0.20, -0.30], radius: 0.06, segments: [12, 10], mat: 'eyes' },
      { parent: 'neck', kind: 'sphere', pos: [ 0.10, 0.20, -0.30], radius: 0.06, segments: [12, 10], mat: 'eyes' },
      { name: 'eyeHaloL', parent: 'neck', kind: 'sprite', pos: [-0.10, 0.20, -0.34], size: [0.26, 0.26], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { name: 'eyeHaloR', parent: 'neck', kind: 'sprite', pos: [ 0.10, 0.20, -0.34], size: [0.26, 0.26], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
    ],
  };
}

// Stoneguard — slow tanky armoured brute. Box-heavy silhouette to read
// as "this one wears plates, not flesh." Tiny recessed eye slits (no
// flaring red — this is mineral, not feral). One arm carries a maul:
// thick handle + spherical stone head, the visible threat.
export function stoneguardModel(bodyColor: number, eyeColor: number): ModelSpec {
  return {
    id: 'stoneguard',
    materials: {
      // Stone — warm gray, very rough, faint dust emissive so it reads
      // even in dark corners without becoming a silhouette.
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x0a0908,
        emissiveIntensity: 0.35,
        flatShading: 'auto',
        dissolvable: true,
      },
      // Eye slits — dim red, almost embers behind the helmet rather
      // than the bright glares the flesh mobs have.
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: 1.2, roughness: 1.0 },
      // Maul head — slightly more metallic so it picks up torchlight
      // distinctly from the stone body. Reads as the swung weapon.
      maul: { color: 0x2a2622, roughness: 0.55, metalness: 0.6, flatShading: 'auto' },
    },
    slots: {
      rig: { pos: [0, 1.20, 0] },     // taller than ghoul (1.05)
      // Shoulder pivots under the pauldrons. The maul rides the RIGHT
      // pivot, so the pose layer heaves it overhead on windup and slams
      // it down on strike — the stoneguard's signature crusher.
      shoulderL: { pos: [-0.45, 0.18, 0], parent: 'rig' },
      shoulderR: { pos: [ 0.45, 0.18, 0], parent: 'rig' },
      // Hip pivots — the heavy greaves plod from these.
      hipL: { pos: [-0.22, -0.40, 0], parent: 'rig' },
      hipR: { pos: [ 0.22, -0.40, 0], parent: 'rig' },
      // Neck pivot — the helmet tips toward the player.
      neck: { pos: [0, 0.36, 0], parent: 'rig' },
    },
    parts: [
      // FEET — wide stone slabs, hung under the hip pivots.
      { parent: 'hipL', kind: 'box', pos: [0, -0.72, 0], size: [0.30, 0.12, 0.36], mat: 'body', jitter: 0.012 },
      { parent: 'hipR', kind: 'box', pos: [0, -0.72, 0], size: [0.30, 0.12, 0.36], mat: 'body', jitter: 0.012 },
      // LEGS — thick boxy greaves.
      { parent: 'hipL', kind: 'box', pos: [0, -0.30, 0], size: [0.26, 0.70, 0.26], mat: 'body', jitter: 0.018 },
      { parent: 'hipR', kind: 'box', pos: [0, -0.30, 0], size: [0.26, 0.70, 0.26], mat: 'body', jitter: 0.018 },
      // TORSO — the defining plate. Boxy, wide. Slight overhang at
      // the shoulders sells "armoured."
      { name: 'body', parent: 'rig', kind: 'box', pos: [0, -0.05, 0], size: [0.70, 0.65, 0.42], mat: 'body', jitter: 0.024 },
      // SHOULDER PAULDRONS — flanking the torso top, blocky.
      { parent: 'rig', kind: 'box', pos: [-0.45, 0.20, 0], size: [0.22, 0.22, 0.30], mat: 'body', jitter: 0.020 },
      { parent: 'rig', kind: 'box', pos: [ 0.45, 0.20, 0], size: [0.22, 0.22, 0.30], mat: 'body', jitter: 0.020 },
      // ARMS — thick capsules hung from the shoulder pivots so they
      // heave with the swing.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.28, 0], radius: 0.11, height: 0.40, mat: 'body', jitter: 0.018 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.28, 0], radius: 0.11, height: 0.40, mat: 'body', jitter: 0.018 },
      // OFF-SIDE FIST — bare, on the left pivot.
      { parent: 'shoulderL', kind: 'sphere', pos: [0, -0.60, 0], radius: 0.13, segments: [10, 8], mat: 'body', jitter: 0.018 },
      // MAUL — handle (thin capsule) + head (chunky box), on the RIGHT
      // pivot so it swings overhead → down with the strike. The head
      // sits below the fist for a "resting at the ready" rest pose.
      { parent: 'shoulderR', kind: 'cylinder', pos: [0, -0.50, 0.05], radius: 0.025, height: 0.42, mat: 'maul' },
      { parent: 'shoulderR', kind: 'box',      pos: [0, -0.76, 0.05], size: [0.22, 0.22, 0.22], mat: 'maul', jitter: 0.010 },
      // HELMET — boxy faceplate. Hung off the neck pivot so the visor
      // tips toward the player.
      { parent: 'neck', kind: 'box', pos: [0, 0.14, 0], size: [0.42, 0.36, 0.36], mat: 'body', jitter: 0.018 },
      // EYE SLITS — two tiny dim rectangles set deep into the helmet.
      // Small + recessed so the embers read as "behind a visor."
      { parent: 'neck', kind: 'box', pos: [-0.09, 0.16, -0.19], size: [0.06, 0.025, 0.02], mat: 'eyes' },
      { parent: 'neck', kind: 'box', pos: [ 0.09, 0.16, -0.19], size: [0.06, 0.025, 0.02], mat: 'eyes' },
    ],
  };
}

// Ooze — squat blobby creature, no humanoid silhouette. Built from a
// few squashed spheres with a brightly emissive interior orb so the
// "alive" reads even when the outer body is dim against a dark floor.
// `scale` lets the same model serve the big parent and the smaller
// split offspring without authoring two factories.
export function oozeModel(bodyColor: number, innerColor: number, scale: number = 1): ModelSpec {
  // s — geometry multiplier. Applied through size/radius rather than
  // a parent group transform so collision radius (set on the spec, not
  // the model) and visible size stay in sync at the spec level.
  const s = scale;
  return {
    id: `ooze-${scale.toFixed(2)}`,
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.55,
        emissive: 0x080a04,
        emissiveIntensity: 0.6,
        flatShading: 'auto',
        dissolvable: true,
        // Soft sickly rim so the silhouette glows faintly even when
        // the body is in shadow — the ooze should always read as
        // "wet", not "lump of stone."
        rim: { color: 0x88cc33, power: 2.2, intensity: 0.5 },
      },
      core: {
        color: 0x000000,
        emissive: innerColor,
        emissiveIntensity: 2.4,
        roughness: 1.0,
      },
    },
    slots: {
      rig: { pos: [0, 0.18 * s, 0] },
    },
    parts: [
      // OUTER BODY — squashed sphere (wide, low). Mild jitter for
      // organic surface variation; the rim glow + scale animation in
      // 'twitch' presence sells the "blob" feel.
      { name: 'body', parent: 'rig', kind: 'sphere', pos: [0, 0, 0], scale: [1.15 * s, 0.85 * s, 1.15 * s], radius: 0.22, segments: [16, 12], mat: 'body', jitter: 0.018 },
      // Slight TRAILING BUMP at the back — gives the blob a direction
      // hint (faces forward via the head position).
      { parent: 'rig', kind: 'sphere', pos: [0, -0.02 * s, 0.12 * s], radius: 0.12 * s, segments: [10, 8], mat: 'body', jitter: 0.015 },
      // CORE — bright emissive orb inside. Reads as the nucleus you
      // need to break.
      { parent: 'rig', kind: 'sphere', pos: [0, 0, 0], radius: 0.07 * s, segments: [10, 8], mat: 'core' },
    ],
  };
}

// Spider — low, eight-legged scuttler. Two body segments (bulbous
// abdomen + smaller cephalothorax), a cluster of glowing eyes, fangs,
// and four splayed legs per side. Not humanoid, so it's hand-authored
// (creature() is for uprights); the legs are static and the 'twitch'
// presence does the scuttle. Sits low to the floor.
export function spiderModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  const legs: ModelSpec['parts'] = [];
  // Four legs per side, fanned front→back, splayed outward + down.
  const zs = [-0.16, -0.05, 0.06, 0.17];
  for (const sx of [-1, 1] as const) {
    zs.forEach((z, i) => {
      // Front legs reach a touch forward, back legs a touch back (subtle
      // per-index roll on the splay so they aren't a fan of clones).
      legs.push({
        parent: 'rig', kind: 'capsule',
        pos: [sx * 0.16, 0.02, z],
        rot: [0.15, 0, sx * (1.05 + i * 0.05)],
        radius: 0.018, height: 0.36,
        mat: 'body', jitter: 0.006,
      });
      // Foot tip — tiny dark sphere at the splayed end, near the floor.
      legs.push({
        parent: 'rig', kind: 'sphere',
        pos: [sx * 0.34, -0.22, z + 0.02],
        radius: 0.02, segments: [6, 6], mat: 'body',
      });
    });
  }
  return {
    id: 'spider',
    materials: {
      body: { color: bodyColor, roughness: 0.7, emissive: 0x0a0608, emissiveIntensity: 0.4, flatShading: 'auto', dissolvable: true,
        rim: { color: 0x6a3050, power: 3.0, intensity: 0.4 } },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 0.28, 0] },
    },
    parts: [
      ...legs,
      // Abdomen — big bulbous sphere at the back.
      { name: 'body', parent: 'rig', kind: 'sphere', pos: [0, 0.04, 0.17], scale: [1.05, 0.9, 1.2], radius: 0.21, segments: [14, 12], mat: 'body', jitter: 0.02 },
      // Cephalothorax — smaller, forward.
      { parent: 'rig', kind: 'sphere', pos: [0, 0.0, -0.12], scale: [1.0, 0.85, 1.0], radius: 0.14, segments: [12, 10], mat: 'body', jitter: 0.015 },
      // Eye cluster — several small glowing spheres on the front face.
      { parent: 'rig', kind: 'sphere', pos: [-0.05, 0.06, -0.23], radius: 0.028, segments: [8, 8], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.05, 0.06, -0.23], radius: 0.028, segments: [8, 8], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [-0.09, 0.02, -0.21], radius: 0.018, segments: [8, 8], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.09, 0.02, -0.21], radius: 0.018, segments: [8, 8], mat: 'eyes' },
      // Eye halo so the cluster reads as a glint at distance.
      { name: 'eyeHaloL', parent: 'rig', kind: 'sprite', pos: [0, 0.05, -0.26], size: [0.22, 0.12], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      // Fangs — two short downward cones at the mouth.
      { parent: 'rig', kind: 'cone', pos: [-0.04, -0.06, -0.22], rot: [Math.PI, 0, 0], radius: 0.022, height: 0.10, segments: 6, mat: 'body' },
      { parent: 'rig', kind: 'cone', pos: [ 0.04, -0.06, -0.22], rot: [Math.PI, 0, 0], radius: 0.022, height: 0.10, segments: 6, mat: 'body' },
    ],
  };
}
