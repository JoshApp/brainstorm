// Marrow Sovereign — the towering bone-clawed skeleton.
//
// Built in composable sections, each a helper returning PartSpec[]:
//
//   - buildLowerTorso() — pelvis girdle (iliac wings, pubis, sacrum)
//     under the 'pelvis' joint, then two gaunt anatomical legs
//     parented to the hip joints. Legs are NAMED ('leg-left',
//     'leg-right') so the phase system hides them on the phase-2
//     collapse.
//   - buildUpperTorso() — spine + ribcage + arms + skull. Everything
//     hangs off the 'spine' joint so an upper-body twist on a sweep
//     rotates the entire torso together; arms hang off shoulder
//     joints; skull hangs off the neck joint. The marrow glow lives
//     INSIDE the ribcage as the player's aim target.
//
// Joint slots the keyframe animator drives (see src/anim/clips-marrow.ts):
//
//   - 'pelvis'                — hip-cluster pivot; the walk bob
//   - 'hipL' / 'hipR'         — leg swing
//   - 'spine'                 — upper-body twist/lean
//   - 'shoulderL' / 'shoulderR' — arm swing
//   - 'neck'                  — head tilt
//
// The DARKNESS-REACTIVE marrow-red rim on the bone material is the
// signature: the silhouette self-draws in red where the hall's light
// doesn't reach. He carries his own dread-glow into the black.
//
// Model dimensions: authored ~3m floor-to-skull; EnemySpec.scale 1.7
// makes him tower at ~5m.

import type { ModelSpec, PartSpec } from '../ecs/model-types';

export function marrowSovereignModel(): ModelSpec {
  return {
    id: 'marrow-sovereign',
    materials: {
      // Yellowed bone — off-white with a faint emissive so the skeleton
      // reads even in dim light. DARKNESS-REACTIVE marrow-red rim: the
      // contour self-draws in glowing red where the hall's light doesn't
      // reach (no torch needed), and steps back to lit bone where a brazier
      // catches it. This is the "revealed in the dark" look as a material —
      // he carries his own dread-glow into the black.
      bone: {
        color: 0xcdc3b4,
        roughness: 0.85,
        emissive: 0x1a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
        dissolvable: true,
        rim: { color: 0xff3a1e, power: 2.2, intensity: 0.85, darkReactive: 1.0 },
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
    },
    slots: {
      // 'rig' is the body root — the existing tilt/phase pivot.
      // Authored high because the legs are LONG.
      rig: { pos: [0, 1.85, 0] },
      // Pelvis — hip-cluster pivot. Drives the walk bob (vertical
      // pos delta) and parents the two hip joints, so a pelvis bob
      // takes the whole lower body with it.
      pelvis: { pos: [0, -0.55, 0], parent: 'rig' },
      // Hip joints — child of pelvis so they inherit the bob.
      hipL: { pos: [-0.19, -0.15, 0], parent: 'pelvis' },
      hipR: { pos: [ 0.19, -0.15, 0], parent: 'pelvis' },
      // Spine — mid-torso pivot. Rotates the whole upper body for
      // a sweep/lean. Direct child of rig (NOT pelvis) so an upper-
      // body twist doesn't move the legs.
      spine: { pos: [0, 0, 0], parent: 'rig' },
      // Shoulder joints — child of spine so arms ride the twist.
      shoulderL: { pos: [-0.33, 0.42, 0], parent: 'spine' },
      shoulderR: { pos: [ 0.33, 0.42, 0], parent: 'spine' },
      // Neck — skull pivot. Child of spine.
      neck: { pos: [0, 0.55, 0], parent: 'spine' },
    },
    parts: [
      ...buildLowerTorso(),
      ...buildUpperTorso(),
    ],
  };
}

// ── Lower torso ──────────────────────────────────────────────────────
// Bony pelvic girdle hung off the 'pelvis' joint; two anatomical legs
// hung off 'hipL'/'hipR'. Positions inside each helper are JOINT-local
// — that's what lets the animator rotate the hip and have the whole leg
// swing together.

function buildLowerTorso(): PartSpec[] {
  const parts: PartSpec[] = [];

  // ── Pelvis girdle — central body, iliac wings flaring up-and-out,
  //    low pubic bridge, sacrum at the spine seat. All in pelvis-local
  //    coords (pelvis slot sits at rig y=-0.55).
  parts.push({ parent: 'pelvis', kind: 'box', pos: [0, 0.03, 0],     size: [0.24, 0.15, 0.22], mat: 'bone' });
  parts.push({ parent: 'pelvis', kind: 'box', pos: [-0.215, 0.10, -0.01], rot: [0, 0, 0.55],  size: [0.20, 0.09, 0.19], mat: 'bone' });        // L iliac wing
  parts.push({ parent: 'pelvis', kind: 'box', pos: [ 0.215, 0.10, -0.01], rot: [0, 0, -0.55], size: [0.20, 0.09, 0.19], mat: 'bone' });        // R iliac wing
  parts.push({ parent: 'pelvis', kind: 'box', pos: [0, -0.08, 0.02],  size: [0.30, 0.07, 0.15], mat: 'boneShadow' });                          // pubic bridge
  parts.push({ parent: 'pelvis', kind: 'box', pos: [0,  0.15, -0.05], size: [0.15, 0.13, 0.15], mat: 'boneShadow' });                          // sacrum

  parts.push(...buildLeg(-1));
  parts.push(...buildLeg(1));
  return parts;
}

// One gaunt anatomical leg — femoral head, faintly-bowed femur, knobbly
// knee (two condyles + a kneecap), tibia paired with a thin parallel
// FIBULA, ankle knob, boned foot (heel + metatarsals + toe stubs).
// EVERY primitive carries the leg's name so the phase system hides the
// whole limb intact when it breaks. Positions are HIP-LOCAL — the hip
// joint slot sits where the femoral head goes.
function buildLeg(side: -1 | 1): PartSpec[] {
  const name = side < 0 ? 'leg-left' : 'leg-right';
  const joint = side < 0 ? 'hipL' : 'hipR';
  const p: PartSpec[] = [];
  // Femoral head — sits at the hip joint origin.
  p.push({ name, parent: joint, kind: 'sphere',  pos: [0, 0, 0],                        radius: 0.072, segments: [10, 8], mat: 'bone' });
  // Femur — long shaft, faintly bowed outward.
  p.push({ name, parent: joint, kind: 'capsule', pos: [side * 0.012, -0.38, 0.02], rot: [0, 0, side * 0.05], radius: 0.050, height: 0.62, mat: 'bone' });
  // Knee — two condyle balls + a small kneecap in front.
  p.push({ name, parent: joint, kind: 'sphere',  pos: [-0.028, -0.80, 0.02],       radius: 0.046, segments: [8, 6], mat: 'bone' });
  p.push({ name, parent: joint, kind: 'sphere',  pos: [ 0.028, -0.80, 0.02],       radius: 0.046, segments: [8, 6], mat: 'bone' });
  p.push({ name, parent: joint, kind: 'sphere',  pos: [0, -0.79, 0.075],           radius: 0.032, segments: [8, 6], mat: 'boneShadow' });
  // Tibia (shin) — the main lower bone.
  p.push({ name, parent: joint, kind: 'capsule', pos: [0, -1.28, 0.03],            radius: 0.044, height: 0.64, mat: 'bone' });
  // Fibula — thin parallel bone, the boniest tell.
  p.push({ name, parent: joint, kind: 'capsule', pos: [side * 0.052, -1.28, 0.0],  radius: 0.018, height: 0.60, mat: 'boneShadow' });
  // Ankle knob.
  p.push({ name, parent: joint, kind: 'sphere',  pos: [0, -1.74, 0.04],            radius: 0.042, segments: [8, 6], mat: 'bone' });
  // Foot — heel/tarsus, metatarsal plate (forward), toe stubs.
  p.push({ name, parent: joint, kind: 'box',     pos: [0, -1.88, -0.02],           size: [0.10, 0.08, 0.11], mat: 'bone' });
  p.push({ name, parent: joint, kind: 'box',     pos: [0, -1.92, 0.13],            size: [0.13, 0.06, 0.22], mat: 'bone' });
  p.push({ name, parent: joint, kind: 'box',     pos: [0, -1.915, 0.26],           size: [0.13, 0.04, 0.06], mat: 'boneShadow' });
  return p;
}

// ── Upper torso ──────────────────────────────────────────────────────
// Spine column, ribcage with contained marrow glow, shoulders + arms,
// neck, skull. Everything hangs off the 'spine' joint (rig-local origin)
// or its descendants ('shoulderL/R', 'neck'). Most spine-local positions
// equal their old rig-local positions because the 'spine' joint sits at
// rig [0,0,0]; only the arms and neck cluster shift to joint-local coords.

function buildUpperTorso(): PartSpec[] {
  const parts: PartSpec[] = [];

  // ── Spine — column of knobbly vertebrae from the sacrum to the neck,
  //    each with a small spinous process so it reads as a bony spine.
  for (let i = 0; i < 7; i++) {
    const y = -0.32 + i * 0.115;
    parts.push({ parent: 'spine', kind: 'sphere', pos: [0, y, -0.02], radius: 0.050, segments: [8, 6], mat: 'bone' });
    parts.push({ parent: 'spine', kind: 'box',    pos: [0, y, -0.07], size: [0.03, 0.055, 0.045], mat: 'boneShadow' });
  }

  // ── Ribcage — a curved CAGE framing the contained marrow glow.
  parts.push({ name: 'core', parent: 'spine', kind: 'sphere', pos: [0, 0.20, 0.0],  scale: [1.0, 1.35, 0.6], radius: 0.12, segments: [16, 12], mat: 'core' });
  // Sternum — flat bone plate down the chest front, widening at the top.
  parts.push({ parent: 'spine', kind: 'box',  pos: [0, 0.20, 0.21], size: [0.06, 0.40, 0.035], mat: 'bone' });
  parts.push({ parent: 'spine', kind: 'box',  pos: [0, 0.40, 0.19], size: [0.13, 0.07, 0.04], mat: 'bone' });   // manubrium
  parts.push(...buildRibs());

  // ── Shoulder girdle — clavicles bridging spine to shoulders, scapula
  //    wings behind.
  parts.push({ parent: 'spine', kind: 'capsule', pos: [-0.20, 0.45, 0.11], rot: [0, 0, -0.42], radius: 0.022, height: 0.22, mat: 'bone' });
  parts.push({ parent: 'spine', kind: 'capsule', pos: [ 0.20, 0.45, 0.11], rot: [0, 0,  0.42], radius: 0.022, height: 0.22, mat: 'bone' });
  parts.push({ parent: 'spine', kind: 'box',     pos: [-0.31, 0.36, -0.10], rot: [0, -0.45, 0.22],  size: [0.13, 0.19, 0.04], mat: 'boneShadow' });
  parts.push({ parent: 'spine', kind: 'box',     pos: [ 0.31, 0.36, -0.10], rot: [0,  0.45, -0.22], size: [0.13, 0.19, 0.04], mat: 'boneShadow' });

  parts.push(...buildArm(-1));
  parts.push(...buildArm(1));

  // ── Neck vertebrae — three small bones from the neck-joint origin up
  //    to the skull base. Neck-local: joint sits at rig y=0.55, so the
  //    first vertebra is right at y=0 and the others stack above.
  for (let i = 0; i < 3; i++) {
    parts.push({ parent: 'neck', kind: 'sphere', pos: [0, i * 0.06, 0], radius: 0.046 - i * 0.003, segments: [8, 6], mat: 'bone' });
  }

  // ── Skull — the death's-head (see buildSkull). Neck-local.
  parts.push(...buildSkull());

  return parts;
}

// One arm — shoulder ball at the joint origin, humerus, knobbly elbow,
// the TWO forearm bones (radius + ulna, the boniest read), and — on
// both sides now — a skeletal hand of palm + finger stubs. Arms are
// unnamed: the crawler keeps them. Positions are SHOULDER-LOCAL.
function buildArm(side: -1 | 1): PartSpec[] {
  const joint = side < 0 ? 'shoulderL' : 'shoulderR';
  const p: PartSpec[] = [];
  // Shoulder ball (humeral head) — at the joint origin.
  p.push({ parent: joint, kind: 'sphere',  pos: [0, 0, 0],                                   radius: 0.082, segments: [12, 10], mat: 'bone' });
  // Humerus — upper arm, angled out from the shoulder.
  p.push({ parent: joint, kind: 'capsule', pos: [side * 0.05, -0.30, 0.04], rot: [0, 0, side * 0.26], radius: 0.042, height: 0.46, mat: 'bone' });
  // Elbow knob.
  p.push({ parent: joint, kind: 'sphere',  pos: [side * 0.13, -0.58, 0.06],                  radius: 0.05,  segments: [8, 6],   mat: 'bone' });
  // Forearm — radius + ulna. With the scythe gone both arms hang the
  // same; a small forward pitch keeps the hands ahead of the hips.
  p.push({ parent: joint, kind: 'capsule', pos: [side * 0.15, -0.86, 0.11], rot: [0.20, 0, side * 0.06], radius: 0.034, height: 0.44, mat: 'bone' });
  p.push({ parent: joint, kind: 'capsule', pos: [side * 0.195, -0.86, 0.08], rot: [0.20, 0, side * 0.06], radius: 0.025, height: 0.42, mat: 'boneShadow' });
  // Hand — carpal palm + three finger bones, fingers curling.
  p.push({ parent: joint, kind: 'box',     pos: [side * 0.17, -1.13, 0.15], size: [0.085, 0.09, 0.05], mat: 'bone' });
  for (let i = -1; i <= 1; i++) {
    p.push({ parent: joint, kind: 'capsule', pos: [side * 0.17 + i * 0.026, -1.22, 0.17], rot: [0.4, 0, 0], radius: 0.011, height: 0.085, mat: 'boneShadow' });
  }
  return p;
}

/** Five ribs per side, each in two angled segments so it CURVES from
 *  the spine out and forward to the sternum — a cage, not a fence. The
 *  bottom pair are short "floating" ribs. Spine-local. */
function buildRibs(): PartSpec[] {
  const ribs: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.40 - i * 0.105;
    const floating = i >= 4;
    const w = 0.21 + i * 0.012 - (floating ? 0.07 : 0);
    for (const sx of [-1, 1] as const) {
      // Back segment — leaves the spine, sweeping out + a touch forward.
      ribs.push({ parent: 'spine', kind: 'capsule', pos: [sx * w * 0.34, y + 0.012, -0.05], rot: [0.18, 0, sx * 1.15], radius: 0.014, height: 0.18, mat: 'bone' });
      // Front segment — curving in toward the sternum.
      ribs.push({ parent: 'spine', kind: 'capsule', pos: [sx * w * 0.82, y - 0.02,  0.11], rot: [0.5,  sx * 0.5,  sx * 0.7], radius: 0.013, height: floating ? 0.14 : 0.20, mat: 'bone' });
    }
  }
  return ribs;
}

/** Skull — a proper death's-head: domed cranium, heavy brow, two large
 *  recessed eye sockets with embers sunk deep inside, a triangular nasal
 *  cavity, gaunt cheekbones, and a toothed maxilla over a slightly-gaping
 *  mandible. NECK-LOCAL — the neck joint sits at rig y=0.55, so the
 *  skull centre (was rig y=0.95) is now neck-y=0.40. */
function buildSkull(): PartSpec[] {
  const parts: PartSpec[] = [];
  const cy = 0.40;   // skull centre on the neck joint

  // ── Cranium — domed vault, a touch taller than wide, flattened at
  //    the face so the front reads as a plane rather than a ball.
  parts.push({ parent: 'neck', kind: 'sphere', pos: [0, cy + 0.05, -0.01], scale: [0.96, 1.08, 1.0], radius: 0.205, segments: [20, 16], mat: 'bone' });
  // Temple hollows — shadow presses at the sides above the cheeks.
  parts.push({ parent: 'neck', kind: 'sphere', pos: [-0.185, cy + 0.03, 0.01], radius: 0.05, segments: [8, 6], mat: 'boneShadow' });
  parts.push({ parent: 'neck', kind: 'sphere', pos: [ 0.185, cy + 0.03, 0.01], radius: 0.05, segments: [8, 6], mat: 'boneShadow' });

  // ── EYE SOCKETS — two LARGE black wells sunk into the face, each
  //    with an ember floating deep inside (a gaze in the dark).
  for (const sx of [-1, 1] as const) {
    parts.push({ parent: 'neck', kind: 'sphere', pos: [sx * 0.088, cy, -0.135], scale: [1.15, 1.0, 0.75], radius: 0.075, segments: [12, 10], mat: 'boneShadow' });
    parts.push({ parent: 'neck', kind: 'sphere', pos: [sx * 0.088, cy, -0.175], radius: 0.030, segments: [8, 6], mat: 'ember' });
  }
  // Brow ridge — heavy angular bar shadowing the sockets from above.
  parts.push({ parent: 'neck', kind: 'box', pos: [0, cy + 0.11, -0.165], size: [0.32, 0.05, 0.07], mat: 'bone' });
  // Glabella — bone bridge between the sockets.
  parts.push({ parent: 'neck', kind: 'box', pos: [0, cy, -0.195], size: [0.04, 0.14, 0.05], mat: 'bone' });

  // ── NASAL CAVITY — inverted dark triangle below the brow.
  parts.push({ parent: 'neck', kind: 'cone', pos: [0, cy - 0.09, -0.185], rot: [Math.PI, 0, 0], radius: 0.05, height: 0.13, segments: 3, mat: 'boneShadow' });

  // ── CHEEKBONES (zygomatic) — angular wedges flaring under the eyes.
  parts.push({ parent: 'neck', kind: 'box', pos: [-0.155, cy - 0.05, -0.10], rot: [0,  0.6, -0.25], size: [0.13, 0.05, 0.07], mat: 'bone' });
  parts.push({ parent: 'neck', kind: 'box', pos: [ 0.155, cy - 0.05, -0.10], rot: [0, -0.6,  0.25], size: [0.13, 0.05, 0.07], mat: 'bone' });

  // ── UPPER JAW (maxilla) + a row of teeth — the death grin.
  parts.push({ parent: 'neck', kind: 'box', pos: [0, cy - 0.15, -0.115], size: [0.235, 0.07, 0.11], mat: 'bone' });
  for (let i = -3; i <= 3; i++) {
    parts.push({ parent: 'neck', kind: 'box', pos: [i * 0.032, cy - 0.195, -0.17], size: [0.024, 0.05, 0.022], mat: 'bone' });
  }
  // ── LOWER JAW (mandible) — hung slightly open under the teeth, with
  //    its own tooth strip: the gaping skeletal maw.
  parts.push({ parent: 'neck', kind: 'box', pos: [0, cy - 0.235, -0.095], size: [0.215, 0.055, 0.12], mat: 'boneShadow' });
  parts.push({ parent: 'neck', kind: 'box', pos: [0, cy - 0.215, -0.165], size: [0.17, 0.045, 0.022], mat: 'bone' });

  return parts;
}
