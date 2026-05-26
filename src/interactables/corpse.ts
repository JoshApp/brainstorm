import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { showNote } from '../ui/note-card';

// Corpse = a slumped body with a readable note pinned to / scrawled on it.
// Pure atmosphere — no combat, no drops. Walking up shows the READ prompt;
// interact opens the note overlay (pauses the world via the menu stack).
//
// Geometry is built inline here rather than as a ModelSpec since corpses
// are simple + we may want each one to look slightly different later (a
// pose variant per note). Materials inline so the corpse stays gray-dead
// without picking up enemy-style eye glow.

export function spawnCorpse(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  note: string,
) {
  // Materials — drained gray, low roughness so it reads as flesh-not-stone
  // but darker than enemy bodies so it doesn't look threatening.
  const fleshMat = new THREE.MeshStandardMaterial({
    color: 0x42342a,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  const ragMat = new THREE.MeshStandardMaterial({
    color: 0x1f1814,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
  });

  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;
  parent.add(group);

  // Body — a capsule LYING ON ITS SIDE. Rotated 90° about Z so the long
  // axis runs along X. Top of capsule slightly off the floor.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.7, 4, 8),
    fleshMat,
  );
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 0.22, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Head — sphere slightly toward one end, tilted as if dropped.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    fleshMat,
  );
  head.position.set(0.5, 0.18, 0.05);
  head.rotation.z = -0.3;
  head.castShadow = true;
  group.add(head);

  // Arm — a smaller capsule outstretched. Sells "they crawled, then
  // stopped" rather than "they sat down to die."
  const arm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.07, 0.35, 4, 6),
    fleshMat,
  );
  arm.rotation.z = Math.PI / 2;
  arm.rotation.y = 0.5;
  arm.position.set(0.55, 0.12, 0.32);
  arm.castShadow = true;
  group.add(arm);

  // Tattered cloak / robe pooled over the body. Dark, low form, adds
  // silhouette so the corpse reads from across a room.
  const cloak = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.06, 0.55),
    ragMat,
  );
  cloak.position.set(0, 0.1, 0);
  cloak.castShadow = true;
  cloak.receiveShadow = true;
  group.add(cloak);

  // A small scroll-shape sticking out of the cloak — the "note" the player
  // is about to read. Lighter color so the eye finds it.
  const scrollMat = new THREE.MeshStandardMaterial({
    color: 0xa08658,
    roughness: 0.85,
    emissive: 0x3a2a18,
    emissiveIntensity: 0.4,
  });
  const scroll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8),
    scrollMat,
  );
  scroll.rotation.z = Math.PI / 2;
  scroll.position.set(-0.25, 0.18, 0.1);
  scroll.castShadow = true;
  group.add(scroll);

  const interactable = {
    id: generateEntityId('corpse'),
    position: pos.clone(),
    radius: 1.2,
    promptLabel: 'READ',
    onUse() {
      showNote(note);
      // Note can be re-read; we don't destroy the corpse on first interact.
      // (If a player wants to forget, they can walk away.)
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
