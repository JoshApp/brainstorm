import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { setSlot } from '../player/equipment';
import { emit, on as onEvent } from '../broadcast/event-bus';
import { playEquipClick } from '../audio/sfx';
import type { ItemSpec } from '../content/items';
import type { StyleMaterials } from '../style/materials';

// Starter-altar — a stone block with one of three offered weapons
// floating + slowly rotating above it. Lives ONLY in the starter
// chamber. On use:
//
//   1. The chosen weapon is equipped into the player's weapon slot
//      (the equipment listener in main.ts handles the viewmodel swap).
//   2. A 'starter:chosen' event fires.
//   3. ALL starter altars (this one and its siblings) tear down their
//      floating weapon meshes and become non-interactable. The
//      player's choice is committed — the rejected weapons are gone.
//
// The stair-unlock predicate (has-equipment: weapon) flips the
// stairwell from SEALED to DESCEND the moment the weapon is set,
// without any additional wiring here.

// Slow rotation + small bob to suggest "alive offering," not a museum
// piece nailed to a plinth.
const ROTATE_SPEED = 0.5;        // rad/sec around the weapon's Y axis
const BOB_AMPLITUDE = 0.025;     // metres of vertical bob
const BOB_FREQUENCY = 1.5;       // Hz

export function spawnStarterAltar(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  weaponItem: ItemSpec,
  materials: StyleMaterials,
) {
  // ── Altar block — same silhouette idiom as the existing 'altar' prop:
  // short stone slab + a slightly wider top plate. Reuses the style's
  // pillar material for a warm-stone read that matches the rest of
  // the dungeon's stonework.
  const altarGroup = new THREE.Group();
  altarGroup.position.copy(pos);
  altarGroup.rotation.y = rotY;
  scene.add(altarGroup);

  const baseHeight = 0.62;
  const baseW = 0.70;
  const baseD = 0.55;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(baseW, baseHeight, baseD),
    materials.wall,
  );
  base.position.y = baseHeight / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  altarGroup.add(base);

  const topW = baseW + 0.06;
  const topD = baseD + 0.06;
  const topH = 0.06;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(topW, topH, topD),
    materials.wall,
  );
  top.position.y = baseHeight + topH / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  altarGroup.add(top);

  // ── Weapon model floating above the altar ────────────────────────
  // Built from the item's drop model. We mount it pivot-up so the
  // grip points down — reads as "ready to be lifted," not "fallen."
  const weaponSpec = weaponItem.viewmodel ?? weaponItem.dropModel;
  const built = buildModel(weaponSpec);
  const weaponGroup = built.group;
  const restingY = baseHeight + topH + 0.30;   // ~30cm above altar top
  weaponGroup.position.set(0, restingY, 0);
  // Tilt so the weapon hovers diagonally — purely cosmetic, makes it
  // look offered rather than balanced.
  weaponGroup.rotation.set(0.20, 0, 0.30);
  altarGroup.add(weaponGroup);

  // ── Interactable wiring ──────────────────────────────────────────
  const id = generateEntityId('starter-altar');
  let phase = 0;
  let taken = false;

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.5,
    labelOffsetY: 1.1,
    promptLabel: 'TAKE',
    // built.group is what the tap-target raycaster intersects against.
    // Without it, TAP on the altar mesh finds nothing and the take
    // never fires (the in-range USE button still works, but the
    // diegetic tap-the-thing flow is broken). Pointing at altarGroup
    // means a tap on EITHER the stone base OR the floating weapon
    // resolves to this interactable.
    built: {
      group: altarGroup,
      parts: new Map(),
      slots: new Map(),
      materials: new Map(),
      hitTargets: [],
    },
    onUse() {
      if (taken) return;
      taken = true;
      // Equip directly. The equipment listener in main.ts swaps the
      // sword viewmodel + the active combat stats; no manual wiring
      // needed here.
      setSlot('weapon', weaponItem);
      playEquipClick();
      // Notify siblings so they tear down their offers too.
      emit({ type: 'starter:chosen', weaponId: weaponItem.id });
    },
    tick(dt: number) {
      if (taken) return;
      phase += dt;
      weaponGroup.rotation.y += dt * ROTATE_SPEED;
      weaponGroup.position.y = restingY + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
    },
    destroyed: false,
  };
  registerInteractable(interactable);

  // ── Self-tear-down on any starter:chosen ─────────────────────────
  // Whether THIS altar was picked or a sibling, the weapon offer goes
  // away. The altar stone stays — a commitment marker left on the
  // floor. Pure "you can't go back."
  const unsubscribe = onEvent((e) => {
    if (e.type !== 'starter:chosen') return;
    interactable.destroyed = true;
    interactable.promptLabel = '';
    // Remove the floating weapon — keep the stone altar visible.
    altarGroup.remove(weaponGroup);
    weaponGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
      mesh.geometry.dispose();
    });
    unsubscribe();
  });
}
