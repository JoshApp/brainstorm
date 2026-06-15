import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { emit } from '../broadcast/event-bus';
import { whisper } from '../ui/whisper';
import { makeRevealMaterial } from '../scene/lamp-reveal';
import { createPickup } from './pickup';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import type { FallenDelver, CorpsePose } from '../content/corpses';

// A fallen delver — someone who came down before you and failed here. Walking
// up reveals their epitaph (in-world, whispered, NO pause) as your lamp finds
// the body; if they died holding something, a glint at the hand marks it and
// SEARCH takes it. The voice in the deep may have something to say about the
// ones who carried gear they couldn't keep.
//
// Geometry is built inline (corpses are simple + want pose variety per body);
// materials inline so the corpse stays drained-gray, never picking up the
// eye-glow that reads as "alive."

interface PoseParams {
  bodyRotZ: number;      // tilt of the lying body
  head: [number, number, number];
  headRotZ: number;
  arm: [number, number, number];
  armRotY: number;
  /** Where the held-loot glint sits (near the hand). */
  glint: [number, number, number];
}

// Three reads of "a body on the floor." Coordinates are in the corpse's local
// frame (long axis along X, as the lying capsule runs).
const POSES: Record<CorpsePose, PoseParams> = {
  // Crawled and stopped — one arm flung forward, head toward that hand.
  crawled: {
    bodyRotZ: Math.PI / 2,
    head: [0.5, 0.18, 0.05], headRotZ: -0.3,
    arm: [0.55, 0.12, 0.32], armRotY: 0.5,
    glint: [0.78, 0.1, 0.34],
  },
  // Curled inward — head tucked low toward the body, arm drawn close.
  curled: {
    bodyRotZ: Math.PI / 2,
    head: [0.34, 0.16, 0.22], headRotZ: -0.9,
    arm: [0.18, 0.12, 0.26], armRotY: 1.5,
    glint: [0.05, 0.1, 0.30],
  },
  // Slumped — fell back, head lolled the other way, arm out to the side.
  slumped: {
    bodyRotZ: Math.PI / 2 + 0.12,
    head: [0.52, 0.2, -0.1], headRotZ: 0.4,
    arm: [0.3, 0.12, -0.34], armRotY: -0.6,
    glint: [0.42, 0.1, -0.40],
  },
};

export function spawnCorpse(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  fallen: FallenDelver,
  loot: ItemSpec | null,
) {
  const pose = POSES[fallen.pose] ?? POSES.crawled;

  // Materials — drained gray, darker than enemies so it doesn't read as a
  // threat. flatShading keeps it faceted/PS1.
  const fleshMat = new THREE.MeshStandardMaterial({
    color: 0x42342a, roughness: 0.95, metalness: 0.0, flatShading: true,
  });
  const ragMat = new THREE.MeshStandardMaterial({
    color: 0x1f1814, roughness: 1.0, metalness: 0.0, flatShading: true,
  });

  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;
  parent.add(group);

  // Body — a capsule lying on its side, long axis along X.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8), fleshMat);
  body.rotation.z = pose.bodyRotZ;
  body.position.set(0, 0.22, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), fleshMat);
  head.position.set(...pose.head);
  head.rotation.z = pose.headRotZ;
  head.castShadow = true;
  group.add(head);

  // Outstretched / drawn arm — sells the pose ("crawled, then stopped").
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.35, 4, 6), fleshMat);
  arm.rotation.z = Math.PI / 2;
  arm.rotation.y = pose.armRotY;
  arm.position.set(...pose.arm);
  arm.castShadow = true;
  group.add(arm);

  // Tattered cloak pooled over the body — silhouette so it reads across a room.
  const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.55), ragMat);
  cloak.position.set(0, 0.1, 0);
  cloak.castShadow = true;
  cloak.receiveShadow = true;
  group.add(cloak);

  // If they died holding something: a lamp-reactive glint at the hand, tinted
  // by the loot's rarity. It blooms only when your lamp falls on the body —
  // the signal that this one is worth searching. Removed once looted.
  let glint: THREE.Mesh | null = null;
  if (loot) {
    const glintMat = makeRevealMaterial({
      texture: 'fire-wisp',
      color: RARITY_COLORS[loot.rarity ?? 'mundane'],
      size: [0.22, 0.22],
      intensity: 0.95,
    });
    glint = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), glintMat);
    glint.position.set(...pose.glint);
    glint.renderOrder = 2;
    // Billboard-ish: lay it flat-ish so it reads from the usual approach. A
    // simple upward tilt is enough; it's a glow blob, not a sprite.
    glint.rotation.x = -Math.PI / 2.6;
    group.add(glint);
  }

  let epitaphSpoken = false;
  let looted = false;

  const interactable = {
    id: generateEntityId('corpse'),
    position: pos.clone(),
    radius: 1.4,
    promptLabel: loot ? 'SEARCH' : 'READ',
    onUse() {
      // The epitaph — in-world, whispered, no pause. Always plays; only the
      // FIRST read counts toward lore + the event log (re-reads don't farm it).
      whisper(fallen.epitaph);
      if (!epitaphSpoken) {
        epitaphSpoken = true;
        emit({ type: 'note:read', noteBody: `${fallen.name}: ${fallen.epitaph}` });
      }

      if (loot && !looted) {
        looted = true;
        // Drop what they carried beside the body, through the normal pickup
        // path (same as a chest), and pull the glint — there's nothing left
        // to find.
        const worldPos = new THREE.Vector3();
        group.getWorldPosition(worldPos);
        worldPos.y += 0.1;
        createPickup(parent, worldPos, loot);
        if (glint) { group.remove(glint); glint.geometry.dispose(); (glint.material as THREE.Material).dispose(); glint = null; }
        // Body's still here to re-read, but there's nothing more to take.
        interactable.promptLabel = 'READ';
        // The thing that watches has something to say about the ones who
        // carried gear they couldn't keep. Queued behind the epitaph (the
        // whisper queue sequences them). NOTE: this is the dungeon's wit, a
        // different temperature than the in-world epitaph — when the Phase 5
        // voice-in-the-deep gets its own surface, move reactions onto it.
        if (fallen.reaction) whisper(fallen.reaction);
      }
    },
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
