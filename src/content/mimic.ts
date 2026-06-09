// Mimic mob model — a chest that wasn't.
//
// Visually: chest dimensions + iron banding (so the silhouette half-
// remembers what it was pretending to be) but with the lid SPRUNG
// OPEN, fangs ringing the maw, a glowing throat inside, and four
// long spindly legs holding the body off the floor. This is the
// POST-REVEAL form. The disguise itself is handled by the chest
// interactable (src/interactables/chest.ts) — when the player
// "opens" a mimic chest, the chest is torn down and a Mimic mob is
// spawned at the same position.
//
// Anatomy:
//   - rig: root pivot — tilts as a whole on windup/strike so the
//     gaping maw lunges at the player's face.
//   - body: hollow chest box (front/back/left/right walls).
//   - lid: parented to a hinge slot at the back-top edge, posed
//     OPEN (about -1.4 rad) so the underside + fangs face the
//     player.
//   - throat: dark interior sphere with high emissive — the "maw".
//   - upper / lower fangs: rings of cone teeth on the lid underside
//     and the body's upper rim, interlocking like a bear-trap.
//   - eyes: two small bright spheres deep inside the throat — a
//     pinprick stare from the dark.
//   - legs: 4 spindly capsule pairs (thigh + shin) bent like an
//     insect's, holding the body 0.15m off the floor. Bent slightly
//     outward so the silhouette reads "chest standing on spider legs."

import type { ModelSpec, Vec3 } from '../ecs/model-types';
import type { CreatureSpec, SkinPart } from './creature-types';
import { skeletonFromSlots } from './skeletons';

/** The Mimic as a CREATURE — same chest-on-legs model (hinged lid, fang rings,
 *  glowing throat) routed through the creature pipeline. The skeleton is the
 *  model's own slots (skeletonFromSlots round-trips them, rig yaw + hinge
 *  preserved), the skin IS the parts. spine/head/limbs left empty so we author
 *  the one body capsule the legacy mimic used (deriveHurtbox: aimHeight 0.6 →
 *  capsule y 0.21–0.87, radius 0.32; no head). The chest ambush is unchanged —
 *  the chest interactable still spawns this enemy id on a mimic open. */
export function mimicCreatureSpec(): CreatureSpec {
  const model = mimicModel();
  return {
    id: 'mimic',
    archetype: 'biped',                 // unused — the custom skeleton overrides it
    skeleton: skeletonFromSlots(model.slots ?? {}, { root: 'rig', spine: [], head: null, limbs: [] }),
    skin: model.parts as SkinPart[],
    materials: model.materials,
    // No creature.flash binding: the mimic flashes the PART named 'body' (the
    // chest floor), driven by EnemySpec.flashMaterialName — not a material.
    zones: [
      { id: 'body', role: 'body', shape: { kind: 'capsule', a: [0, 0.21, 0], b: [0, 0.87, 0], radius: 0.32 } },
    ],
  };
}

export function mimicModel(): ModelSpec {
  return {
    id: 'mimic',
    materials: {
      // Chest-toned wood, slightly darker than the wood chest so the
      // post-reveal form reads as a notch more sinister.
      wood: {
        color: 0x1c1208,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: 'auto',
        dissolvable: true,
      },
      wood_dark: {
        color: 0x0e0905,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: 'auto',
        dissolvable: true,
      },
      iron: {
        color: 0x14110d,
        roughness: 0.85,
        metalness: 0.55,
        flatShading: 'auto',
      },
      // Wet pink-red interior. Strong emissive so the maw glows
      // from across the room when the mimic faces the player.
      throat: {
        color: 0x4a0a0c,
        emissive: 0xc4202a,
        emissiveIntensity: 1.4,
        roughness: 0.7,
      },
      // Yellowed bone. Slight emissive so they read against the
      // dark throat.
      fang: {
        color: 0xb8a87a,
        emissive: 0x2a1808,
        emissiveIntensity: 0.4,
        roughness: 0.6,
        flatShading: 'auto',
      },
      // Pinprick stare. The eye material gets driven by the windup-
      // flare animation (enemy.ts uses spec.eyeMaterialName).
      eyes: {
        color: 0x000000,
        emissive: 0xffaa30,
        emissiveIntensity: 2.4,
        roughness: 1.0,
      },
    },
    slots: {
      // 'rig' is the part the tilt-anim looks up. Sits at the
      // body's center so the whole creature leans forward.
      //
      // Yawed 180° because the model is authored with its maw at local
      // +Z, but the engine faces a mob at the player with the model's
      // -Z (container.lookAt + π — see enemy.ts). Without this the mimic
      // showed the player its BACK: hinge + closed-looking lid toward the
      // camera, teeth pointing away. The flip is on the rig (the tilt
      // target) and survives the per-frame tilt, which only writes
      // rotation.x — so the maw now both FACES and LUNGES at the player.
      rig: { pos: [0, 0.20, 0], rot: [0, Math.PI, 0] },
      // Hinge at the back-top edge of the body — same hinge geometry
      // as a real chest, so a future open-and-eat animation can use
      // the same swing.
      hinge: { pos: [0, 0.30, -0.18], parent: 'rig' },
    },
    parts: [
      // ── Body — hollow chest shape (no top, lid swings off the
      //         hinge instead). Wall thickness 0.04m.
      { name: 'body', parent: 'rig', kind: 'box', pos: [0, -0.18, 0],    size: [0.50, 0.04, 0.40], mat: 'wood' },
      // Front wall
      { parent: 'rig', kind: 'box', pos: [0, -0.035, 0.18],  size: [0.50, 0.27, 0.04], mat: 'wood' },
      // Back wall
      { parent: 'rig', kind: 'box', pos: [0, -0.035, -0.18], size: [0.50, 0.27, 0.04], mat: 'wood' },
      // Left wall
      { parent: 'rig', kind: 'box', pos: [-0.23, -0.035, 0], size: [0.04, 0.27, 0.40], mat: 'wood' },
      // Right wall
      { parent: 'rig', kind: 'box', pos: [ 0.23, -0.035, 0], size: [0.04, 0.27, 0.40], mat: 'wood' },
      // Iron bands wrap the body, half-remembered from the disguise.
      { parent: 'rig', kind: 'box', pos: [-0.18, -0.05, 0],  size: [0.02, 0.32, 0.42], mat: 'iron' },
      { parent: 'rig', kind: 'box', pos: [ 0.18, -0.05, 0],  size: [0.02, 0.32, 0.42], mat: 'iron' },

      // ── Throat — the wet glowing interior. A flattened sphere
      //    inside the body cavity.
      { parent: 'rig', kind: 'sphere', pos: [0, -0.08, 0], scale: [1.6, 0.6, 1.2], radius: 0.12, segments: [10, 8], mat: 'throat' },

      // ── Lid — sprung open. Hinged at the back-top edge,
      //    rotated backward so the underside faces the player.
      {
        name: 'lid',
        parent: 'hinge',
        kind: 'box',
        pos: [0, 0.025, 0.18],
        rot: [-2.0, 0, 0],          // ~115° — flung well back off the hinge, maw gaping open
        size: [0.5, 0.05, 0.4],
        mat: 'wood_dark',
      },

      // ── Upper fangs — ring of 7 cone teeth hanging from the
      //    underside of the lid. Cones point DOWN in lid-local
      //    space, which (because the lid is rotated -1.45rad)
      //    means they point roughly FORWARD at the player. Slight
      //    inward tilt sells the "closing trap" feel.
      { parent: 'lid', kind: 'cone', pos: [-0.18, -0.04, 0.10], rot: [Math.PI, 0, 0], radius: 0.025, height: 0.08, segments: 6, mat: 'fang' },
      { parent: 'lid', kind: 'cone', pos: [-0.10, -0.04, 0.06], rot: [Math.PI, 0, 0], radius: 0.026, height: 0.09, segments: 6, mat: 'fang' },
      { parent: 'lid', kind: 'cone', pos: [-0.03, -0.04, 0.04], rot: [Math.PI, 0, 0], radius: 0.028, height: 0.10, segments: 6, mat: 'fang' },
      { parent: 'lid', kind: 'cone', pos: [ 0.04, -0.04, 0.04], rot: [Math.PI, 0, 0], radius: 0.028, height: 0.10, segments: 6, mat: 'fang' },
      { parent: 'lid', kind: 'cone', pos: [ 0.11, -0.04, 0.06], rot: [Math.PI, 0, 0], radius: 0.026, height: 0.09, segments: 6, mat: 'fang' },
      { parent: 'lid', kind: 'cone', pos: [ 0.19, -0.04, 0.10], rot: [Math.PI, 0, 0], radius: 0.025, height: 0.08, segments: 6, mat: 'fang' },

      // ── Lower fangs — interlocking ring on the top rim of the
      //    body cavity. Cones point UP, so the silhouette is a
      //    bear-trap when read head-on.
      { parent: 'rig', kind: 'cone', pos: [-0.18, 0.115, 0.10], radius: 0.025, height: 0.08, segments: 6, mat: 'fang' },
      { parent: 'rig', kind: 'cone', pos: [-0.10, 0.115, 0.13], radius: 0.026, height: 0.09, segments: 6, mat: 'fang' },
      { parent: 'rig', kind: 'cone', pos: [-0.03, 0.115, 0.14], radius: 0.028, height: 0.10, segments: 6, mat: 'fang' },
      { parent: 'rig', kind: 'cone', pos: [ 0.04, 0.115, 0.14], radius: 0.028, height: 0.10, segments: 6, mat: 'fang' },
      { parent: 'rig', kind: 'cone', pos: [ 0.11, 0.115, 0.13], radius: 0.026, height: 0.09, segments: 6, mat: 'fang' },
      { parent: 'rig', kind: 'cone', pos: [ 0.19, 0.115, 0.10], radius: 0.025, height: 0.08, segments: 6, mat: 'fang' },

      // ── Eyes — two small bright spheres set DEEP in the throat,
      //    near the back wall. The pinprick read against black is
      //    the part that makes the maw feel watching.
      { parent: 'rig', kind: 'sphere', pos: [-0.06, -0.06, -0.10], radius: 0.022, segments: [8, 8], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.06, -0.06, -0.10], radius: 0.022, segments: [8, 8], mat: 'eyes' },

      // ── Legs — 4 capsules in pairs (thigh + shin) per corner.
      //    Bent slightly outward so the mimic stands wider than
      //    its body, like a beetle hunkered down.
      //    Front-left
      { parent: 'rig', kind: 'capsule', pos: [-0.30, -0.18, 0.18], rot: [0, 0,  0.45], radius: 0.025, height: 0.18, mat: 'wood_dark' },
      { parent: 'rig', kind: 'capsule', pos: [-0.36, -0.30, 0.20], rot: [0, 0, -0.40], radius: 0.022, height: 0.18, mat: 'wood_dark' },
      //    Front-right
      { parent: 'rig', kind: 'capsule', pos: [ 0.30, -0.18, 0.18], rot: [0, 0, -0.45], radius: 0.025, height: 0.18, mat: 'wood_dark' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.36, -0.30, 0.20], rot: [0, 0,  0.40], radius: 0.022, height: 0.18, mat: 'wood_dark' },
      //    Back-left
      { parent: 'rig', kind: 'capsule', pos: [-0.30, -0.18, -0.18], rot: [0, 0,  0.45], radius: 0.025, height: 0.18, mat: 'wood_dark' },
      { parent: 'rig', kind: 'capsule', pos: [-0.36, -0.30, -0.20], rot: [0, 0, -0.40], radius: 0.022, height: 0.18, mat: 'wood_dark' },
      //    Back-right
      { parent: 'rig', kind: 'capsule', pos: [ 0.30, -0.18, -0.18], rot: [0, 0, -0.45], radius: 0.025, height: 0.18, mat: 'wood_dark' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.36, -0.30, -0.20], rot: [0, 0,  0.40], radius: 0.022, height: 0.18, mat: 'wood_dark' },
    ],
  };
}
