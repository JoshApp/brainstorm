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
  // Y coordinates (relative to rig, which sits high mid-torso):
  //   pelvis:  -0.55     (wide hip block)
  //   hip:     -0.70     (ball joints)
  //   thigh:   -1.10     (capsule centre)
  //   knee:    -1.55     (ball)
  //   shin:    -2.05     (capsule centre)
  //   ankle:   -2.50     (ball)
  //   foot:    -2.62     (heavy planted box)
  // So foot-bottom sits ~2.65 below rig. Rig at y=1.85 → foot near
  // floor. Skull top ~1.2 above rig → ~3.05 above floor.
  const parts: PartSpec[] = [];

  // Pelvis — wider angular block bridging the legs.
  parts.push({ name: 'pelvis', parent: 'rig', kind: 'box', pos: [0, -0.55, 0], size: [0.46, 0.16, 0.30], mat: 'bone' });
  // Sacral wedge sitting on top — reads as the base of the spine.
  parts.push({ parent: 'rig', kind: 'box', pos: [0, -0.43, -0.02], size: [0.18, 0.10, 0.20], mat: 'boneShadow' });

  for (const side of [-1, 1] as const) {
    const name = side < 0 ? 'leg-left' : 'leg-right';
    // Hip ball joint.
    parts.push({ name, parent: 'rig', kind: 'sphere', pos: [side * 0.18, -0.70, 0], radius: 0.08, segments: [10, 8], mat: 'bone' });
    // Thigh — long capsule angled very slightly outward (gaunt stance).
    parts.push({ name, parent: 'rig', kind: 'capsule', pos: [side * 0.20, -1.10, 0.02], radius: 0.060, height: 0.62, mat: 'bone' });
    // Knee cap.
    parts.push({ name, parent: 'rig', kind: 'sphere', pos: [side * 0.22, -1.55, 0.02], radius: 0.062, segments: [10, 8], mat: 'bone' });
    // Shin — slightly thinner than the thigh.
    parts.push({ name, parent: 'rig', kind: 'capsule', pos: [side * 0.22, -2.05, 0.03], radius: 0.052, height: 0.66, mat: 'bone' });
    // Ankle.
    parts.push({ name, parent: 'rig', kind: 'sphere', pos: [side * 0.22, -2.50, 0.05], radius: 0.048, segments: [8, 6], mat: 'boneShadow' });
    // Foot — heavier than current; reads "planted."
    parts.push({ name, parent: 'rig', kind: 'box', pos: [side * 0.22, -2.62, 0.10], size: [0.16, 0.08, 0.28], mat: 'bone' });
  }

  return parts;
}

// ── Upper torso ──────────────────────────────────────────────────────
// Spine column, ribcage with contained marrow glow, shoulders + arms,
// neck, skull. The skull is oversized for a death's-head silhouette
// that reads from across the hall.

function buildUpperTorso(): PartSpec[] {
  const parts: PartSpec[] = [];

  // ── Spine — five vertebrae from pelvis to neck.
  for (let i = 0; i < 5; i++) {
    const y = -0.30 + i * 0.16;
    parts.push({ parent: 'rig', kind: 'sphere', pos: [0, y, 0], radius: 0.058, segments: [8, 6], mat: 'bone' });
  }

  // ── Ribcage. The glow sits CONTAINED behind the ribs — smaller and
  //    further back than the king's core, so the ribs frame it rather
  //    than the glow swallowing the silhouette. The chest is where the
  //    player aims; the ribs are what they see.
  // Core marrow glow — contained inside the chest cavity.
  parts.push({ name: 'core', parent: 'rig', kind: 'sphere', pos: [0, 0.18, 0.02], scale: [1.0, 1.3, 0.55], radius: 0.13, segments: [16, 12], mat: 'core' });
  // Sternum bar (wider, thinner-front).
  parts.push({ parent: 'rig', kind: 'box', pos: [0, 0.18, 0.20], size: [0.08, 0.44, 0.04], mat: 'bone' });
  // Ribs curving from spine to sternum — four per side now (was three).
  parts.push(...buildRibs());
  // Clavicles — a small bone bar each side bridging the spine to the shoulders.
  parts.push({ parent: 'rig', kind: 'capsule', pos: [-0.20, 0.42, 0.10], rot: [0, 0, -0.4], radius: 0.024, height: 0.20, mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'capsule', pos: [ 0.20, 0.42, 0.10], rot: [0, 0,  0.4], radius: 0.024, height: 0.20, mat: 'bone' });

  // ── Shoulders + arms.
  // Left shoulder + arm — hangs at the side, fingers curled.
  parts.push({ parent: 'rig', kind: 'sphere', pos: [-0.38, 0.42, 0], radius: 0.10, segments: [12, 10], mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'capsule', pos: [-0.46, 0.10, 0.05], rot: [0, 0, 0.30], radius: 0.045, height: 0.50, mat: 'bone' });  // upper arm
  parts.push({ parent: 'rig', kind: 'sphere', pos: [-0.56, -0.20, 0.07], radius: 0.045, segments: [8, 6], mat: 'bone' });                // elbow
  parts.push({ parent: 'rig', kind: 'capsule', pos: [-0.60, -0.50, 0.10], rot: [0, 0, 0.12], radius: 0.038, height: 0.46, mat: 'bone' }); // forearm
  parts.push({ parent: 'rig', kind: 'sphere', pos: [-0.62, -0.74, 0.12], radius: 0.065, segments: [8, 6], mat: 'bone' });                // fist

  // Right shoulder + arm — gripping the scythe (it's parented to scytheHand).
  parts.push({ parent: 'rig', kind: 'sphere', pos: [ 0.38, 0.42, 0], radius: 0.10, segments: [12, 10], mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'capsule', pos: [ 0.40, 0.12, 0.05], rot: [0, 0, -0.22], radius: 0.045, height: 0.46, mat: 'bone' }); // upper arm
  parts.push({ parent: 'rig', kind: 'sphere', pos: [ 0.42, -0.14, 0.08], radius: 0.045, segments: [8, 6], mat: 'bone' });                // elbow
  parts.push({ parent: 'rig', kind: 'capsule', pos: [ 0.42, -0.40, 0.10], rot: [0.4, 0, -0.05], radius: 0.038, height: 0.42, mat: 'bone' }); // forearm
  // (no separate fist — the scythe haft visually emerges from the hand)

  // ── Neck — two small vertebrae stacked above the clavicles.
  parts.push({ parent: 'rig', kind: 'sphere', pos: [0, 0.58, 0], radius: 0.050, segments: [8, 6], mat: 'bone' });
  parts.push({ parent: 'rig', kind: 'sphere', pos: [0, 0.66, 0], radius: 0.048, segments: [8, 6], mat: 'bone' });

  // ── Skull — oversized for a death's-head read from across the hall.
  parts.push(...buildSkull());

  return parts;
}

/** Four ribs per side, curving forward from the spine to the sternum. */
function buildRibs(): PartSpec[] {
  const ribs: PartSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const y = 0.34 - i * 0.10;          // stacked top → bottom
    const w = 0.24 + i * 0.015;         // slightly wider toward the bottom
    for (const sx of [-1, 1] as const) {
      ribs.push({
        parent: 'rig',
        kind: 'cylinder',
        pos: [sx * w * 0.5, y, 0.08],
        rot: [0.38, 0, sx * 0.95],
        radius: 0.014,
        height: 0.32,
        segments: 6,
        mat: 'bone',
      });
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
