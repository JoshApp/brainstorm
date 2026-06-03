// Marrow Sovereign — the Act II / III boss skeleton. 4m tall, gaunt,
// carrying a greatscythe taller than himself. Phase 1: standing fight
// — player aims LOW to destroy the legs (cosmetically, anything that
// damages phase-1 HP). Phase 2: legs gone, skeleton CRAWLS forward on
// his arms, the scythe abandoned on the ground.
//
// Model contract:
//   - Named parts the phase system hides: 'leg-left', 'leg-right',
//     'scythe' (during phase 2). 'core' is the marrow glow inside
//     the ribcage; doubles as the eye-glow material for windup flare.
//   - `rig` slot is the body pivot the phase-2 transition lowers
//     (rigYOffset) + tilts forward (rigPitch) to read as a crawl.

import type { ModelSpec, Vec3 } from '../ecs/model-types';

export function marrowSovereignModel(): ModelSpec {
  return {
    id: 'marrow-sovereign',
    materials: {
      // Yellowed bone — off-white with a faint emissive so the
      // skeleton reads even in dim light. Slight rim glow picks up
      // the silhouette edges.
      bone: {
        color: 0xcdc3b4,
        roughness: 0.85,
        emissive: 0x1a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
        dissolvable: true,
        rim: { color: 0xc46838, power: 2.5, intensity: 0.4 },
      },
      // Darker bone for cracks + skull cavities. Same family as bone
      // but desaturated.
      boneShadow: {
        color: 0x60584c,
        roughness: 0.9,
        flatShading: 'auto',
      },
      // Marrow glow inside the ribcage. Drives the hit-flash via the
      // emissive-pulse path (eyeMaterialName + flashMaterialName both
      // point here). High base intensity so it's an unmistakable target
      // through the ribs.
      core: {
        color: 0x000000,
        emissive: 0xff2018,
        emissiveIntensity: 3.4,
        roughness: 1.0,
      },
      // Eye-socket ember — same family as marrow but a hair more
      // orange and dimmer than core so the player's eye reads chest
      // first, skull second.
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
      // Scythe blade — pale bone with a rim for the silhouette.
      blade: {
        color: 0xddd2bf,
        roughness: 0.5,
        metalness: 0.15,
        flatShading: 'auto',
        rim: { color: 0xff6030, power: 3.0, intensity: 0.7 },
      },
    },
    slots: {
      // 'rig' is the tilt + transition pivot. Authored y=1.0 so
      // animations centred on it rotate around mid-torso.
      rig: { pos: [0, 1.0, 0] },
      // Hand slot for scythe attachment (right hand grips the haft).
      scytheHand: { pos: [0.32, 0.10, 0.10], parent: 'rig' },
    },
    parts: [
      // ── PELVIS — a low hip block bridging the legs.
      { name: 'pelvis', parent: 'rig', kind: 'box', pos: [0, -0.40, 0], size: [0.38, 0.12, 0.24], mat: 'bone' },

      // ── LEGS — named so the phase system can hide them.
      //    Each leg = thigh + shin + foot. Wider stance for a planted
      //    silhouette.
      // Left leg (player's left = world -x).
      { name: 'leg-left', parent: 'rig', kind: 'sphere', pos: [-0.16, -0.50, 0], radius: 0.07, segments: [8, 6], mat: 'bone' },   // hip joint
      { name: 'leg-left', parent: 'rig', kind: 'capsule', pos: [-0.18, -0.78, 0.02], radius: 0.055, height: 0.40, mat: 'bone' },   // thigh
      { name: 'leg-left', parent: 'rig', kind: 'sphere', pos: [-0.20, -1.05, 0.02], radius: 0.055, segments: [8, 6], mat: 'bone' }, // knee
      { name: 'leg-left', parent: 'rig', kind: 'capsule', pos: [-0.20, -1.33, 0.03], radius: 0.05, height: 0.42, mat: 'bone' },    // shin
      { name: 'leg-left', parent: 'rig', kind: 'box', pos: [-0.20, -1.60, 0.06], size: [0.12, 0.06, 0.20], mat: 'bone' },          // foot

      // Right leg (world +x).
      { name: 'leg-right', parent: 'rig', kind: 'sphere', pos: [ 0.16, -0.50, 0], radius: 0.07, segments: [8, 6], mat: 'bone' },
      { name: 'leg-right', parent: 'rig', kind: 'capsule', pos: [ 0.18, -0.78, 0.02], radius: 0.055, height: 0.40, mat: 'bone' },
      { name: 'leg-right', parent: 'rig', kind: 'sphere', pos: [ 0.20, -1.05, 0.02], radius: 0.055, segments: [8, 6], mat: 'bone' },
      { name: 'leg-right', parent: 'rig', kind: 'capsule', pos: [ 0.20, -1.33, 0.03], radius: 0.05, height: 0.42, mat: 'bone' },
      { name: 'leg-right', parent: 'rig', kind: 'box', pos: [ 0.20, -1.60, 0.06], size: [0.12, 0.06, 0.20], mat: 'bone' },

      // ── SPINE — vertebra stack from pelvis up.
      { parent: 'rig', kind: 'sphere', pos: [0, -0.26, 0], radius: 0.055, segments: [8, 6], mat: 'bone' },
      { parent: 'rig', kind: 'sphere', pos: [0, -0.10, 0], radius: 0.055, segments: [8, 6], mat: 'bone' },
      { parent: 'rig', kind: 'sphere', pos: [0,  0.06, 0], radius: 0.055, segments: [8, 6], mat: 'bone' },
      { parent: 'rig', kind: 'sphere', pos: [0,  0.22, 0], radius: 0.055, segments: [8, 6], mat: 'bone' },

      // ── RIBCAGE — the marrow glow sits BEHIND the ribs visually.
      //    Inner glowing oval (the core), then 6 curved ribs in front
      //    that the player sees the red through. The 'core' part name
      //    lets the eye-flare + hit-flash systems find it.
      { name: 'core', parent: 'rig', kind: 'sphere', pos: [0, 0.08, 0], scale: [1.6, 1.8, 0.6], radius: 0.13, segments: [16, 12], mat: 'core' },
      // Sternum bar.
      { parent: 'rig', kind: 'box', pos: [0, 0.10, 0.16], size: [0.07, 0.34, 0.04], mat: 'bone' },
      // Ribs left + right, three on each side, curving outward.
      ...buildRibs(),

      // ── SHOULDERS / ARMS.
      // Left shoulder + arm (player's left).
      { parent: 'rig', kind: 'sphere', pos: [-0.30, 0.28, 0], radius: 0.085, segments: [10, 8], mat: 'bone' },
      { parent: 'rig', kind: 'capsule', pos: [-0.36, 0.05, 0.05], rot: [0, 0, 0.35], radius: 0.04, height: 0.35, mat: 'bone' },
      { parent: 'rig', kind: 'sphere', pos: [-0.46, -0.16, 0.07], radius: 0.04, segments: [8, 6], mat: 'bone' },
      { parent: 'rig', kind: 'capsule', pos: [-0.50, -0.36, 0.09], rot: [0, 0, 0.15], radius: 0.035, height: 0.32, mat: 'bone' },
      // Hand (left): closed fist
      { parent: 'rig', kind: 'sphere', pos: [-0.52, -0.55, 0.10], radius: 0.06, segments: [8, 6], mat: 'bone' },

      // Right shoulder + arm holding scythe.
      { parent: 'rig', kind: 'sphere', pos: [ 0.30, 0.28, 0], radius: 0.085, segments: [10, 8], mat: 'bone' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.32, 0.08, 0.05], rot: [0, 0, -0.25], radius: 0.04, height: 0.32, mat: 'bone' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.34, -0.10, 0.08], radius: 0.04, segments: [8, 6], mat: 'bone' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.33, -0.28, 0.08], rot: [0.5, 0, -0.05], radius: 0.035, height: 0.30, mat: 'bone' },

      // ── SKULL — slightly oversized for a "death's-head" silhouette.
      //    Eye sockets are cone notches into the skull, mat: 'ember'.
      { parent: 'rig', kind: 'sphere', pos: [0, 0.62, 0], scale: [1.0, 1.05, 1.0], radius: 0.16, segments: [16, 12], mat: 'bone' },
      // Jaw — lower box wedged into the skull bottom.
      { parent: 'rig', kind: 'box', pos: [0, 0.49, 0.02], size: [0.18, 0.07, 0.20], mat: 'boneShadow' },
      // Eye sockets (embers).
      { parent: 'rig', kind: 'sphere', pos: [-0.06, 0.65, -0.14], radius: 0.027, segments: [8, 6], mat: 'ember' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.06, 0.65, -0.14], radius: 0.027, segments: [8, 6], mat: 'ember' },
      // Brow ridge — a small box just above the sockets.
      { parent: 'rig', kind: 'box', pos: [0, 0.71, -0.12], size: [0.20, 0.04, 0.04], mat: 'boneShadow' },
      // Nose hollow.
      { parent: 'rig', kind: 'sphere', pos: [0, 0.58, -0.14], radius: 0.020, segments: [6, 6], mat: 'boneShadow' },

      // ── SCYTHE — haft + curved blade, attached to scytheHand.
      //    Hidden in phase 2.
      // Haft: long capsule.
      { name: 'scythe', parent: 'scytheHand', kind: 'capsule', pos: [0, 0.85, 0], rot: [0, 0, 0], radius: 0.04, height: 1.7, mat: 'haft' },
      // Blade base (where the haft meets the curve).
      { name: 'scythe', parent: 'scytheHand', kind: 'sphere', pos: [0, 1.75, 0], radius: 0.06, segments: [8, 6], mat: 'blade' },
      // Blade — a flattened, curved capsule swept off the top of the haft.
      { name: 'scythe', parent: 'scytheHand', kind: 'capsule', pos: [-0.45, 1.95, 0], rot: [0, 0, -1.3], scale: [1.0, 1.0, 0.35], radius: 0.045, height: 0.85, mat: 'blade' },
      // Blade tip.
      { name: 'scythe', parent: 'scytheHand', kind: 'cone', pos: [-0.85, 2.20, 0], rot: [0, 0, -1.1], radius: 0.045, height: 0.20, segments: 6, mat: 'blade' },
    ],
  };
}

/** Three ribs per side, curving forward from the spine to the
 *  sternum. Built as rotated cylinders. */
function buildRibs(): Array<{ parent: string; kind: 'cylinder'; pos: Vec3; rot: Vec3; radius: number; height: number; segments: number; mat: string }> {
  const ribs: Array<{ parent: string; kind: 'cylinder'; pos: Vec3; rot: Vec3; radius: number; height: number; segments: number; mat: string }> = [];
  for (let i = 0; i < 3; i++) {
    const y = 0.22 - i * 0.10;        // stacked top → bottom
    const w = 0.22 + i * 0.02;        // wider toward bottom
    for (const sx of [-1, 1]) {
      ribs.push({
        parent: 'rig',
        kind: 'cylinder',
        pos: [sx * w * 0.5, y, 0.06],
        rot: [0.4, 0, sx * 0.95],
        radius: 0.012,
        height: 0.28,
        segments: 6,
        mat: 'bone',
      });
    }
  }
  return ribs;
}
