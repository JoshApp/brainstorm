import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { buildModel } from '../ecs/build-model';
import { registerInteractable } from './system';
import { emit } from '../broadcast/event-bus';
import { whisper } from '../ui/whisper';
import { makeRevealMaterial } from '../scene/lamp-reveal';
import { createPickup } from './pickup';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import type { FallenDelver, CorpsePose } from '../content/corpses';
import { makeCorpseModel } from '../content/corpse-model';

// A fallen delver — someone who came down before you and failed here. Walking
// up reveals their epitaph (in-world, whispered, NO pause); if they died holding
// something, a lamp-reactive glint at the hand marks it and SEARCH takes it.
//
// Geometry is a parametric ModelSpec (content/corpse-model.ts) — hooded head,
// limbs, draped cloak, blood pool, dropped pack, fleshy/skeletal decay — so the
// bodies read as people, not capsules. Benchable: delve bench model-corpse-*.

// Where the loot glint sits per pose — near the reaching hand / the dropped pack.
const GLINT_POS: Record<CorpsePose, [number, number, number]> = {
  crawled: [0.62, 0.13, 0.34],
  curled: [0.34, 0.14, 0.30],
  slumped: [0.10, 0.13, 0.32],
};

export function spawnCorpse(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  fallen: FallenDelver,
  loot: ItemSpec | null,
) {
  const built = buildModel(makeCorpseModel(fallen.pose, fallen.decay ?? 'fleshy', !!loot));
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  parent.add(built.group);

  // If they died holding something: a lamp-reactive glint at the hand, tinted by
  // the loot's rarity. It blooms only when your lamp falls across the body — the
  // signal that this one is worth searching. Removed once looted.
  let glint: THREE.Mesh | null = null;
  if (loot) {
    const glintMat = makeRevealMaterial({
      texture: 'fire-wisp',
      color: RARITY_COLORS[loot.rarity ?? 'mundane'],
      size: [0.22, 0.22],
      intensity: 0.95,
    });
    glint = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), glintMat);
    glint.position.set(...GLINT_POS[fallen.pose]);
    glint.rotation.x = -Math.PI / 2.6;
    glint.renderOrder = 2;
    built.group.add(glint);
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
        // Drop what they carried beside the body through the normal pickup path
        // (same as a chest), and pull the glint — nothing left to find.
        const worldPos = new THREE.Vector3();
        built.group.getWorldPosition(worldPos);
        worldPos.y += 0.1;
        createPickup(parent, worldPos, loot);
        if (glint) {
          built.group.remove(glint);
          glint.geometry.dispose();
          (glint.material as THREE.Material).dispose();
          glint = null;
        }
        interactable.promptLabel = 'READ';   // still here to re-read, nothing to take
        // The thing that watches has a word for the ones who carried gear they
        // couldn't keep. Queued behind the epitaph (the whisper queue sequences
        // them). NOTE: this is the dungeon's WIT, a different temperature than
        // the in-world epitaph — when the Phase 5 voice-in-the-deep gets its own
        // surface, move reactions onto it.
        if (fallen.reaction) whisper(fallen.reaction);
      }
    },
    built,
  };
  registerInteractable(interactable);
}
