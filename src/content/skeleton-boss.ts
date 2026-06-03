// Marrow Sovereign — the towering greatscythe skeleton.
//
// Built in three composable sections, each a helper that returns a
// PartSpec[]:
//
//   - buildLowerTorso() — pelvis + legs (gaunt, very long). The legs are
//     NAMED ('leg-left' / 'leg-right') so the phase system can hide
//     them when phase 2 starts and the sovereign drops to a crawl.
//   - buildUpperTorso() — spine + ribcage + arms + skull. The marrow
//     glow lives INSIDE the ribcage so the ribs frame it as the target
//     rather than the glow swallowing the silhouette. Named 'core'
//     so the eye-flare + hit-flash hooks find it.
//   - buildScythe()     — haft + curved blade, parented to scytheHand.
//     Named 'scythe' so phase 2 hides it (he abandons the weapon).
//
// The main function just stitches them together. Want a beefier
// ribcage or a longer scythe? Edit one helper — the other two and
// the gameplay contract stay put.
//
// The boss reads "towering" through (a) elongated gaunt limbs in the
// authored geometry and (b) the spec scale in enemies.ts. Authored
// model is ~3m tall floor-to-skull; with spec scale ~1.7 he tops 5m.

import type { ModelSpec, PartSpec } from '../ecs/model-types';

export function marrowSovereignModel(): ModelSpec {
  return {
    id: 'marrow-sovereign',
    materials: {
      // Yellowed bone — off-white with a faint emissive so the
      // skeleton reads even in dim light. A warm rim picks the
      // silhouette out against the dark hall.
      bone: {
        color: 0xcdc3b4,
        roughness: 0.85,
        emissive: 0x1a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
        dissolvable: true,
        rim: { color: 0xc46838, power: 2.5, intensity: 0.45 },
      },
      // Darker bone for cracks, jaw, brow ridge, joint sockets.
      boneShadow: {
        color: 0x60584c,
        roughness: 0.9,
        flatShading: 'auto',
      },
      // Marrow glow inside the ribcage. The eye-flare + hit-flash
      // hooks (eyeMaterialName + flashMaterialName) both point here,
      // so a chest hit unmistakably lights it up.
      core: {
        color: 0x000000,
        emissive: 0xff2018,
        emissiveIntensity: 3.2,
        roughness: 1.0,
      },
      // Eye-socket ember — a hair more orange + dimmer than core, so
      // the player's eye reads CHEST first, skull second.
      ember: {
        color: 0x000000,
        emissive: 0xff4020,
        emissiveIntensity: 2.0,
        roughness: 1.0,
      },
      // Scythe haft — dark wood / bone hybrid.
      haft: {
        color: 0x2c241a,
        roughness: 0.9,
        flatShading: 'auto',
      },
      // Scythe blade — pale bone with a hot rim for the silhouette.
      blade: {
        color: 0xddd2bf,
        roughness: 0.5,
        metalness: 0.15,
        flatShading: 'auto',
        rim: { color: 0xff6030, power: 3.0, intensity: 0.7 },
      },
    },
    slots: {
      // 'rig' is the tilt + phase-transition pivot. Authored high
      // because the legs are LONG — the rig sits mid-torso, well
      // above the floor. Phase 2's rigYOffset drops it so the
      // legless torso comes down to crawl height.
      rig: { pos: [0, 1.85, 0] },
      // Hand slot for the scythe attachment (right hand grips the haft).
      scytheHand: { pos: [0.42, -0.10, 0.12], parent: 'rig' },
    },
    parts: [
      ...buildLowerTorso(),
      ...buildUpperTorso(),
      ...buildScythe(),
    ],
  };
}

// ── Lower torso ──────────────────────────────────────────────────────
// Pelvis + two long gaunt legs. Each leg is named so the phase system
// hides it intact on transition. Right leg breaks at 50% HP, left at
// ~12% (cosmetic part-break in the spec), then phase 2 takes over.

function buildLowerTorso(): PartSpec[] {
  // Y coordinates relative to the rig (which sits high mid-torso at y=1.85).
  // Foot-bottom lands ~2.65 below the rig so it rests near the floor; skull
  // top sits ~1.2 above. Keep the foot height when retuning so he stays
  // grounded.
  const parts: PartSpec[] = [];

  // ── Pelvis — a bony GIRDLE, not a block: a central body with two iliac
  //    wings flaring up-and-out, a low pubic bridge, and the sacrum seated
  //    where the spine meets it. Stays through phase 2 (the crawler keeps
  //    its hips) — only the legs below are named for hiding.
  parts.push({ name: 'pelvis', parent: 'rig', kind: 'box', pos: [0, -0.52, 0], size: [0.24, 0.15, 0.22], mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'box', pos: [-0.215, -0.45, -0.01], rot: [0, 0, 0.55], size: [0.20, 0.09, 0.19], mat: 'bone' });   // L iliac wing
  parts.push({ parent: 'rig', kind: 'box', pos: [ 0.215, -0.45, -0.01], rot: [0, 0, -0.55], size: [0.20, 0.09, 0.19], mat: 'bone' });  // R iliac wing
  parts.push({ parent: 'rig', kind: 'box', pos: [0, -0.63, 0.02], size: [0.30, 0.07, 0.15], mat: 'boneShadow' });                       // pubic / ischium bridge
  parts.push({ parent: 'rig', kind: 'box', pos: [0, -0.40, -0.05], size: [0.15, 0.13, 0.15], mat: 'boneShadow' });                      // sacrum

  parts.push(...buildLeg(-1));
  parts.push(...buildLeg(1));
  return parts;
}

// One gaunt leg — femoral head, a faintly-bowed femur, a knobbly knee
// (two condyles + a kneecap), the tibia paired with a thin parallel FIBULA,
// an ankle knob, and a boned foot (heel + metatarsals + toe stubs). EVERY
// primitive carries the leg's name so the phase system hides the whole limb
// intact when it breaks.
function buildLeg(side: -1 | 1): PartSpec[] {
  const name = side < 0 ? 'leg-left' : 'leg-right';
  const x = side * 0.19;
  const p: PartSpec[] = [];
  // Femoral head into the hip socket.
  p.push({ name, parent: 'rig', kind: 'sphere', pos: [x, -0.70, 0], radius: 0.072, segments: [10, 8], mat: 'bone' });
  // Femur — long shaft, faintly bowed outward.
  p.push({ name, parent: 'rig', kind: 'capsule', pos: [x + side * 0.012, -1.08, 0.02], rot: [0, 0, side * 0.05], radius: 0.050, height: 0.62, mat: 'bone' });
  // Knee — two condyle balls + a small kneecap in front.
  p.push({ name, parent: 'rig', kind: 'sphere', pos: [x - 0.028, -1.50, 0.02], radius: 0.046, segments: [8, 6], mat: 'bone' });
  p.push({ name, parent: 'rig', kind: 'sphere', pos: [x + 0.028, -1.50, 0.02], radius: 0.046, segments: [8, 6], mat: 'bone' });
  p.push({ name, parent: 'rig', kind: 'sphere', pos: [x, -1.49, 0.075], radius: 0.032, segments: [8, 6], mat: 'boneShadow' });
  // Tibia (shin) — the main lower bone.
  p.push({ name, parent: 'rig', kind: 'capsule', pos: [x, -1.98, 0.03], radius: 0.044, height: 0.64, mat: 'bone' });
  // Fibula — thin parallel bone, the boniest tell.
  p.push({ name, parent: 'rig', kind: 'capsule', pos: [x + side * 0.052, -1.98, 0.0], radius: 0.018, height: 0.60, mat: 'boneShadow' });
  // Ankle knob.
  p.push({ name, parent: 'rig', kind: 'sphere', pos: [x, -2.44, 0.04], radius: 0.042, segments: [8, 6], mat: 'bone' });
  // Foot — heel/tarsus, metatarsal plate (forward), toe stubs. Bottom kept
  // at the old foot height so he stays grounded.
  p.push({ name, parent: 'rig', kind: 'box', pos: [x, -2.58, -0.02], size: [0.10, 0.08, 0.11], mat: 'bone' });
  p.push({ name, parent: 'rig', kind: 'box', pos: [x, -2.62, 0.13], size: [0.13, 0.06, 0.22], mat: 'bone' });
  p.push({ name, parent: 'rig', kind: 'box', pos: [x, -2.615, 0.26], size: [0.13, 0.04, 0.06], mat: 'boneShadow' });
  return p;
}

// ── Upper torso ──────────────────────────────────────────────────────
// Spine column, ribcage with contained marrow glow, shoulders + arms,
// neck, skull. The skull is oversized for a death's-head silhouette
// that reads from across the hall.

function buildUpperTorso(): PartSpec[] {
  const parts: PartSpec[] = [];

  // ── Spine — a column of knobbly vertebrae from the sacrum to the neck,
  //    each with a small spinous process so it reads as a bony spine, not
  //    a string of beads.
  for (let i = 0; i < 7; i++) {
    const y = -0.32 + i * 0.115;
    parts.push({ parent: 'rig', kind: 'sphere', pos: [0, y, -0.02], radius: 0.050, segments: [8, 6], mat: 'bone' });
    parts.push({ parent: 'rig', kind: 'box', pos: [0, y, -0.07], size: [0.03, 0.055, 0.045], mat: 'boneShadow' });
  }

  // ── Ribcage — a curved CAGE framing the contained marrow glow. The glow
  //    sits deep behind the ribs so they read as the silhouette and the
  //    fire as something caught inside it.
  parts.push({ name: 'core', parent: 'rig', kind: 'sphere', pos: [0, 0.20, 0.0], scale: [1.0, 1.35, 0.6], radius: 0.12, segments: [16, 12], mat: 'core' });
  // Sternum — a flat bone plate down the chest front, widening at the top.
  parts.push({ parent: 'rig', kind: 'box', pos: [0, 0.20, 0.21], size: [0.06, 0.40, 0.035], mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'box', pos: [0, 0.40, 0.19], size: [0.13, 0.07, 0.04], mat: 'bone' });   // manubrium
  parts.push(...buildRibs());

  // ── Shoulder girdle — clavicles bridging the spine to the shoulders +
  //    angled scapula wings behind.
  parts.push({ parent: 'rig', kind: 'capsule', pos: [-0.20, 0.45, 0.11], rot: [0, 0, -0.42], radius: 0.022, height: 0.22, mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'capsule', pos: [ 0.20, 0.45, 0.11], rot: [0, 0,  0.42], radius: 0.022, height: 0.22, mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'box', pos: [-0.31, 0.36, -0.10], rot: [0, -0.45, 0.22], size: [0.13, 0.19, 0.04], mat: 'boneShadow' });
  parts.push({ parent: 'rig', kind: 'box', pos: [ 0.31, 0.36, -0.10], rot: [0,  0.45, -0.22], size: [0.13, 0.19, 0.04], mat: 'boneShadow' });

  parts.push(...buildArm(-1));
  parts.push(...buildArm(1));

  // ── Neck — three vertebrae stacked to the skull.
  for (let i = 0; i < 3; i++) {
    parts.push({ parent: 'rig', kind: 'sphere', pos: [0, 0.55 + i * 0.06, 0], radius: 0.046 - i * 0.003, segments: [8, 6], mat: 'bone' });
  }

  // ── Skull — the death's-head (see buildSkull).
  parts.push(...buildSkull());

  return parts;
}

// One arm — shoulder ball, humerus, knobbly elbow, the TWO forearm bones
// (radius + ulna, the boniest read), and — on the left — a skeletal hand of
// palm + finger stubs. The right arm reaches toward the scytheHand slot so
// the haft reads as gripped. Arms are unnamed: the crawler keeps them.
function buildArm(side: -1 | 1): PartSpec[] {
  const x = side * 0.33;
  const p: PartSpec[] = [];
  // Shoulder ball (humeral head).
  p.push({ parent: 'rig', kind: 'sphere', pos: [x, 0.42, 0], radius: 0.082, segments: [12, 10], mat: 'bone' });
  // Humerus — upper arm, angled out from the shoulder.
  p.push({ parent: 'rig', kind: 'capsule', pos: [x + side * 0.05, 0.12, 0.04], rot: [0, 0, side * 0.26], radius: 0.042, height: 0.46, mat: 'bone' });
  // Elbow knob.
  p.push({ parent: 'rig', kind: 'sphere', pos: [x + side * 0.13, -0.16, 0.06], radius: 0.05, segments: [8, 6], mat: 'bone' });
  // Forearm — radius + ulna, the boniest tell. Right arm tucks forward to
  // the haft; left hangs a touch more open.
  const fpitch = side > 0 ? 0.45 : 0.12;
  p.push({ parent: 'rig', kind: 'capsule', pos: [x + side * 0.15, -0.44, 0.11], rot: [fpitch, 0, side * 0.06], radius: 0.034, height: 0.44, mat: 'bone' });
  p.push({ parent: 'rig', kind: 'capsule', pos: [x + side * 0.195, -0.44, 0.08], rot: [fpitch, 0, side * 0.06], radius: 0.025, height: 0.42, mat: 'boneShadow' });
  if (side < 0) {
    // Left hand — carpal palm + three finger bones, fingers curling.
    p.push({ parent: 'rig', kind: 'box', pos: [x + side * 0.17, -0.71, 0.15], size: [0.085, 0.09, 0.05], mat: 'bone' });
    for (let i = -1; i <= 1; i++) {
      p.push({ parent: 'rig', kind: 'capsule', pos: [x + side * 0.17 + i * 0.026, -0.80, 0.17], rot: [0.4, 0, 0], radius: 0.011, height: 0.085, mat: 'boneShadow' });
    }
  }
  return p;
}

/** Five ribs per side, each in two angled segments so it CURVES from the
 *  spine out and forward to the sternum — a cage, not a fence. The bottom
 *  pair are short "floating" ribs. */
function buildRibs(): PartSpec[] {
  const ribs: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.40 - i * 0.105;
    const floating = i >= 4;
    const w = 0.21 + i * 0.012 - (floating ? 0.07 : 0);
    for (const sx of [-1, 1] as const) {
      // Back segment — leaves the spine, sweeping out + a touch forward.
      ribs.push({ parent: 'rig', kind: 'capsule', pos: [sx * w * 0.34, y + 0.012, -0.05], rot: [0.18, 0, sx * 1.15], radius: 0.014, height: 0.18, mat: 'bone' });
      // Front segment — curving in toward the sternum.
      ribs.push({ parent: 'rig', kind: 'capsule', pos: [sx * w * 0.82, y - 0.02, 0.11], rot: [0.5, sx * 0.5, sx * 0.7], radius: 0.013, height: floating ? 0.14 : 0.20, mat: 'bone' });
    }
  }
  return ribs;
}

/** Skull — a proper death's-head: domed cranium, heavy brow, two large
 *  recessed eye sockets with embers sunk deep inside, a triangular nasal
 *  cavity, gaunt cheekbones, and a toothed maxilla over a slightly-gaping
 *  mandible. Built to read unmistakably as a SKULL from across the hall,
 *  not a glowing blob. Front of the face is −Z (toward the player). */
function buildSkull(): PartSpec[] {
  const parts: PartSpec[] = [];
  const cy = 0.95;   // skull centre on the rig

  // ── Cranium — a domed vault, a touch taller than wide, flattened at the
  //    face so the front reads as a plane rather than a ball.
  parts.push({ parent: 'rig', kind: 'sphere', pos: [0, cy + 0.05, -0.01], scale: [0.96, 1.08, 1.0], radius: 0.205, segments: [20, 16], mat: 'bone' });
  // Temple hollows — shadow presses at the sides above the cheeks.
  parts.push({ parent: 'rig', kind: 'sphere', pos: [-0.185, cy + 0.03, 0.01], radius: 0.05, segments: [8, 6], mat: 'boneShadow' });
  parts.push({ parent: 'rig', kind: 'sphere', pos: [ 0.185, cy + 0.03, 0.01], radius: 0.05, segments: [8, 6], mat: 'boneShadow' });

  // ── EYE SOCKETS — the defining read: two LARGE black wells sunk into the
  //    face, each with an ember floating deep inside (a gaze in the dark).
  for (const sx of [-1, 1] as const) {
    parts.push({ parent: 'rig', kind: 'sphere', pos: [sx * 0.088, cy, -0.135], scale: [1.15, 1.0, 0.75], radius: 0.075, segments: [12, 10], mat: 'boneShadow' });
    parts.push({ parent: 'rig', kind: 'sphere', pos: [sx * 0.088, cy, -0.175], radius: 0.030, segments: [8, 6], mat: 'ember' });
  }
  // Brow ridge — a heavy angular bar shadowing the sockets from above.
  parts.push({ parent: 'rig', kind: 'box', pos: [0, cy + 0.11, -0.165], size: [0.32, 0.05, 0.07], mat: 'bone' });
  // Glabella — the bone bridge between the sockets.
  parts.push({ parent: 'rig', kind: 'box', pos: [0, cy, -0.195], size: [0.04, 0.14, 0.05], mat: 'bone' });

  // ── NASAL CAVITY — an inverted dark triangle below the brow.
  parts.push({ parent: 'rig', kind: 'cone', pos: [0, cy - 0.09, -0.185], rot: [Math.PI, 0, 0], radius: 0.05, height: 0.13, segments: 3, mat: 'boneShadow' });

  // ── CHEEKBONES (zygomatic) — angular wedges flaring under the eyes; the
  //    gaunt, hollow-cheeked read.
  parts.push({ parent: 'rig', kind: 'box', pos: [-0.155, cy - 0.05, -0.10], rot: [0, 0.6, -0.25], size: [0.13, 0.05, 0.07], mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'box', pos: [ 0.155, cy - 0.05, -0.10], rot: [0, -0.6, 0.25], size: [0.13, 0.05, 0.07], mat: 'bone' });

  // ── UPPER JAW (maxilla) + a row of teeth — the death grin.
  parts.push({ parent: 'rig', kind: 'box', pos: [0, cy - 0.15, -0.115], size: [0.235, 0.07, 0.11], mat: 'bone' });
  for (let i = -3; i <= 3; i++) {
    parts.push({ parent: 'rig', kind: 'box', pos: [i * 0.032, cy - 0.195, -0.17], size: [0.024, 0.05, 0.022], mat: 'bone' });
  }
  // ── LOWER JAW (mandible) — hung slightly open under the teeth, with its
  //    own tooth strip: the gaping skeletal maw.
  parts.push({ parent: 'rig', kind: 'box', pos: [0, cy - 0.235, -0.095], size: [0.215, 0.055, 0.12], mat: 'boneShadow' });
  parts.push({ parent: 'rig', kind: 'box', pos: [0, cy - 0.215, -0.165], size: [0.17, 0.045, 0.022], mat: 'bone' });

  return parts;
}

// ── Scythe ───────────────────────────────────────────────────────────
// Long haft + curved blade. Sized to match the towering body — the
// haft is nearly as tall as the boss himself, the blade sweeps over
// his shoulder. All parts named 'scythe' so phase 2 drops the weapon.

function buildScythe(): PartSpec[] {
  const parts: PartSpec[] = [];
  // Pommel — small bone cap at the bottom of the haft.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'sphere', pos: [0, -0.05, 0], radius: 0.055, segments: [8, 6], mat: 'haft' });
  // Haft — extra-long capsule rising from the hand. Authored 2.2m
  // (vs. 1.7m before) so it reads as a TWO-HANDED weapon scaled to a
  // towering frame.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'capsule', pos: [0, 1.05, 0], rot: [0, 0, 0], radius: 0.045, height: 2.20, mat: 'haft' });
  // Bone bindings — two darker rings around the haft (grip + balance
  // point) so it doesn't read as one featureless stick.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'torus', pos: [0, 0.35, 0], rot: [Math.PI / 2, 0, 0], radius: 0.050, tube: 0.012, segments: [10, 6], mat: 'boneShadow' });
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'torus', pos: [0, 1.55, 0], rot: [Math.PI / 2, 0, 0], radius: 0.050, tube: 0.012, segments: [10, 6], mat: 'boneShadow' });
  // Cap where the haft meets the blade.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'sphere', pos: [0, 2.18, 0], radius: 0.075, segments: [10, 8], mat: 'blade' });
  // Blade — a flattened curved capsule swept off the haft top.
  //   Bigger sweep + thicker centre so it reads as a real reaper's blade.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'capsule', pos: [-0.58, 2.40, 0], rot: [0, 0, -1.30], scale: [1.0, 1.0, 0.32], radius: 0.055, height: 1.10, mat: 'blade' });
  // Mid-blade widening — a flat scale wedge to imply taper.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'box', pos: [-0.30, 2.40, 0], rot: [0, 0, -1.0], size: [0.55, 0.18, 0.02], mat: 'blade' });
  // Blade tip — a cone pointing sideways, the killing edge.
  parts.push({ name: 'scythe', parent: 'scytheHand', kind: 'cone', pos: [-1.10, 2.62, 0], rot: [0, 0, -1.0], radius: 0.060, height: 0.30, segments: 6, mat: 'blade' });
  return parts;
}
