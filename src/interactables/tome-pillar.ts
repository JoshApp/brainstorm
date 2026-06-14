import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { registerLight } from '../scene/light-pool';
import { openCharacterScreen } from '../ui/character-screen';

// Tome pillar — a stone pedestal with an open ledger on top, pages lit
// from within. Interacting opens the CHARACTER screen.
//
// Lives in the safe room as the "review your delver" beat — between
// killing whatever you killed and committing to whatever comes next, you
// stop and you read. The book REFLECTS your build; it never changes it.
// Raising attributes happens at the bonfire (REST → the level-up menu).
//
// Visual family: same dark stone as the fountain pedestal (so the room's
// fixtures read as the same hand carved them), an open book on a leather
// rest, a soft warm glow rising from the pages. Distinct silhouette —
// taller, narrower, lit at the top — so it doesn't blur with the fountain
// from across the room.

export function spawnTomePillar(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
) {
  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;
  parent.add(group);

  // Pedestal — taller than the fountain bowl so the book reads at chest
  // height for the player. Same dark stone family as the fountain so
  // the safe-room fixtures feel hewn by the same hand.
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x3a342c,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.32, 1.00, 8),
    stoneMat,
  );
  pedestal.position.y = 0.50;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  // Capstone slab — slight overhang reads as a finished plinth.
  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.30, 0.06, 8),
    stoneMat,
  );
  slab.position.y = 1.03;
  slab.castShadow = true;
  group.add(slab);

  // Book — leather cover + two angled pages forming an open spread.
  // Self-illuminated pages (emissive) so the book itself is the light
  // source readers' eyes land on; the registered point light below
  // throws warmth onto the floor + nearby walls.
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x3a1a0e,
    roughness: 0.7,
    metalness: 0.0,
    flatShading: true,
  });
  const pageMat = new THREE.MeshStandardMaterial({
    color: 0xc8b078,
    emissive: 0xffb060,
    emissiveIntensity: 0.65,
    roughness: 0.85,
    flatShading: true,
    fog: false,
  });
  // Leather cover — a flat slab the pages sit on.
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.36), leatherMat);
  cover.position.y = 1.075;
  cover.castShadow = true;
  group.add(cover);
  // Two pages — slight tilt outward like an open book.
  const leftPage = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.018, 0.32), pageMat);
  leftPage.position.set(-0.135, 1.105, 0);
  leftPage.rotation.z = 0.14;
  group.add(leftPage);
  const rightPage = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.018, 0.32), pageMat);
  rightPage.position.set(0.135, 1.105, 0);
  rightPage.rotation.z = -0.14;
  group.add(rightPage);
  // Spine ridge between the pages.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.36), leatherMat);
  spine.position.y = 1.110;
  group.add(spine);

  // Warm point light at page height — small radius so the tome reads as
  // a local accent (lit knowledge in a candle-lit room), not as a major
  // illumination source.
  registerLight({
    id: `tome-light-${generateEntityId('tome-light')}`,
    category: 'environment',
    position: new THREE.Vector3(pos.x, pos.y + 1.20, pos.z),
    color: 0xffc080,
    intensity: 1.1,
    distance: 2.2,
    decay: 1.5,
  });

  const interactable = {
    id: generateEntityId('tome-pillar'),
    position: pos.clone(),
    radius: 1.3,
    promptLabel: 'STUDY',
    // Prompt floats over the book itself, not at the floor.
    labelOffsetY: 1.5,
    onUse() {
      openCharacterScreen();
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
