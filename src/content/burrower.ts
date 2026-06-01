// Burrower mob model — a segmented worm-like predator that emerges
// from the floor when the player walks past. Lives underground, so:
// no eyes, pale unhealthy flesh, all the visual investment is in the
// MAW. When the mob emerges, the silhouette read needs to land in
// the first half-second of the burst, so the maw is oversized for
// the body — a ring of fangs you see from across the room.
//
// Anatomy (root at the floor; the entire group is lowered to y=-1.2
// while buried and rises back to y=0 on emerge — see enemy.ts):
//   - body: three stacked tapering cylinder segments, jittered, the
//     bottom widest. Reads as "worm rising out of the ground."
//   - maw: a flattened sphere on top with a glowing throat behind
//     a ring of cone-fangs. The maw IS the face.
//   - forelimbs: two thin grasping claws at mid-body, hung from
//     stubby shoulders — for the small lateral menace silhouette.

import type { ModelSpec, Vec3 } from '../ecs/model-types';

export function burrowerModel(): ModelSpec {
  return {
    id: 'burrower',
    materials: {
      // Pale corpse-flesh — unhealthy off-white with a faint internal
      // glow so the body reads at low light. Dissolvable so the death
      // dissolve still works.
      body: {
        color: 0xa89880,
        roughness: 0.95,
        emissive: 0x2a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
        dissolvable: true,
      },
      // Darker leathery underside / claws.
      hide: {
        color: 0x382820,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: 'auto',
      },
      // Wet pink-red throat.
      throat: {
        color: 0x4a0a0c,
        emissive: 0xc4202a,
        emissiveIntensity: 1.6,
        roughness: 0.7,
      },
      // Yellowed bone fangs.
      fang: {
        color: 0xb8a87a,
        emissive: 0x2a1808,
        emissiveIntensity: 0.4,
        roughness: 0.6,
        flatShading: 'auto',
      },
      // The mob has no proper eyes, but the spec interface requires
      // an eye material the windup-flare animation can drive. We
      // route it onto the throat instead so the maw FLARES on a
      // strike instead of pinprick eyes.
      eyes: {
        color: 0x000000,
        emissive: 0xff3018,
        emissiveIntensity: 2.4,
        roughness: 1.0,
      },
    },
    slots: {
      // 'rig' sits at the maw height — when the strike pose tilts
      // the rig, the maw lunges forward at the player.
      rig: { pos: [0, 1.05, 0] },
    },
    parts: [
      // ── BODY SEGMENTS — three tapering cylinders stacked. Bottom
      //    widest at the floor, narrowest at the maw collar. Each
      //    has jitter so the silhouette doesn't read as a stack of
      //    perfect cans.
      { kind: 'cylinder', pos: [0, 0.15, 0], radius: 0.32, radiusTop: 0.28, height: 0.30, segments: 10, mat: 'body', jitter: 0.022 },
      { kind: 'cylinder', pos: [0, 0.50, 0], radius: 0.28, radiusTop: 0.22, height: 0.40, segments: 10, mat: 'body', jitter: 0.020 },
      { kind: 'cylinder', pos: [0, 0.88, 0], radius: 0.22, radiusTop: 0.17, height: 0.34, segments: 10, mat: 'body', jitter: 0.018 },

      // ── MAW — flattened sphere where the head would be. Parented
      //    to rig so it lunges on a strike.
      { name: 'body', parent: 'rig', kind: 'sphere', pos: [0, 0, 0], scale: [1.2, 0.8, 1.2], radius: 0.20, segments: [14, 10], mat: 'body', jitter: 0.018 },
      // Throat — inset glowing interior; pulses on windup via the
      // eyeMaterialName='eyes' hook (the 'eyes' material is mapped
      // to this throat sphere).
      { name: 'core', parent: 'rig', kind: 'sphere', pos: [0, 0, -0.06], scale: [1.0, 0.6, 1.3], radius: 0.14, segments: [12, 8], mat: 'throat' },
      // The 'eyes' material in this mob actually drives the throat
      // glow — the spec doesn't need an eye sphere but the windup
      // flare hook expects SOME mesh wired to 'eyes'. We add one
      // tiny invisible-ish marker sphere inside the throat; without
      // a part using 'eyes' the material variable never gets the
      // emissive shader path. Hidden behind the throat.
      { parent: 'rig', kind: 'sphere', pos: [0, 0, -0.05], radius: 0.005, segments: [4, 4], mat: 'eyes' },

      // ── FANG RING — 8 cones around the maw rim. Each points
      //    outward + slightly inward (like a closing trap). Mat
      //    'fang' so the bone read pops against the dark throat.
      ...Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const r = 0.21;
        return {
          parent: 'rig',
          kind: 'cone' as const,
          pos: [Math.cos(a) * r, Math.sin(a) * r * 0.55, -0.04] as Vec3,
          rot: [Math.PI / 2 + 0.05, 0, -a] as Vec3,
          radius: 0.025, height: 0.10, segments: 6, mat: 'fang',
        };
      }),

      // ── FORELIMBS — two thin grasping claws hung from stubby
      //    shoulders at mid-body. Add the small lateral menace
      //    silhouette so the creature reads as "predator," not
      //    "tube with teeth."
      // Shoulder pad
      { kind: 'sphere', pos: [-0.26, 0.85, 0.04], radius: 0.07, segments: [8, 6], mat: 'body', jitter: 0.010 },
      { kind: 'sphere', pos: [ 0.26, 0.85, 0.04], radius: 0.07, segments: [8, 6], mat: 'body', jitter: 0.010 },
      // Upper arm
      { kind: 'capsule', pos: [-0.32, 0.70, 0.08], rot: [-0.3, 0,  0.5], radius: 0.035, height: 0.16, mat: 'body', jitter: 0.010 },
      { kind: 'capsule', pos: [ 0.32, 0.70, 0.08], rot: [-0.3, 0, -0.5], radius: 0.035, height: 0.16, mat: 'body', jitter: 0.010 },
      // Claw tip (cone, points forward + down)
      { kind: 'cone', pos: [-0.42, 0.56, 0.16], rot: [-0.6, 0,  0.5], radius: 0.025, height: 0.12, segments: 6, mat: 'hide' },
      { kind: 'cone', pos: [ 0.42, 0.56, 0.16], rot: [-0.6, 0, -0.5], radius: 0.025, height: 0.12, segments: 6, mat: 'hide' },
    ],
  };
}
