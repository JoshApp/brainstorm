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
//   3. ALL starter altars (this one and its siblings) drop their
//      floating weapon meshes — but the stone blocks STAY as
//      monuments. You walked past two rejected altars; you keep
//      walking past two empty ones. Commitment-by-absence.
//
// The stair-unlock predicate (has-equipment: weapon) flips the
// stairwell from SEALED to DESCEND the moment the weapon is set,
// without any additional wiring here.

// Slow rotation + small bob to suggest "alive offering," not a museum
// piece nailed to a plinth.
const ROTATE_SPEED = 0.5;        // rad/sec around the weapon's Y axis
const BOB_AMPLITUDE = 0.025;     // metres of vertical bob
const BOB_FREQUENCY = 1.5;       // Hz

/**
 * Spawn a starter altar (stone block + offered weapon).
 *
 * @param onDestroy  Owner-supplied cleanup — typically the builder
 *                   passes a splice that removes this altar's
 *                   collision AABB from the level's obstacles list
 *                   when the offer is gone. (Without this, the
 *                   invisible hitbox stays — the recurring leak the
 *                   interactables system now defends against via
 *                   the onDestroy hook.)
 */
export function spawnStarterAltar(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  weaponItem: ItemSpec,
  materials: StyleMaterials,
  onDestroy?: () => void,
) {
  // ── Stone group — the altar block. Stays in the scene forever, as
  // a monument to the choice. Lives directly under the scene root so
  // the system's auto-remove on the WEAPON group can't drag the
  // stones with it.
  const stoneGroup = new THREE.Group();
  stoneGroup.position.copy(pos);
  stoneGroup.rotation.y = rotY;
  scene.add(stoneGroup);

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
  stoneGroup.add(base);

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
  stoneGroup.add(top);

  // ── Weapon group — SEPARATE root, sibling to the stones. This is
  // what built.group points at, so the system's auto-remove on
  // destroy only takes the weapon away (we still set
  // keepBuiltOnDestroy=true belt-and-braces for the partial-removal
  // semantics, but having a separate root means tap-target raycasts
  // also resolve to a tap on the weapon, not on the stone block).
  const weaponSpec = weaponItem.viewmodel ?? weaponItem.dropModel;
  const built = buildModel(weaponSpec);
  const weaponGroup = built.group;
  const restingY = baseHeight + topH + 0.30;
  weaponGroup.position.copy(pos);
  weaponGroup.position.y += restingY;
  // Same Y-rotation as the stone so tilt/orientation reads consistent;
  // mild diagonal tilt on top so the offering feels held aloft, not
  // balanced.
  weaponGroup.rotation.set(0.20, rotY, 0.30);
  scene.add(weaponGroup);

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
    // built.group = weaponGroup so tap-target raycasts resolve when
    // the player taps the floating weapon. The stone block is its
    // own scene-graph branch and stays after this interactable dies.
    built: {
      group: weaponGroup,
      parts: new Map(),
      slots: new Map(),
      materials: new Map(),
      hitTargets: [],
    },
    // Belt-and-braces with the separate-roots approach above: even if
    // someone later re-parents the weapon under the stone group, this
    // flag prevents the system from yanking the stone too.
    keepBuiltOnDestroy: true,
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
      weaponGroup.rotation.y = rotY + phase * ROTATE_SPEED;
      weaponGroup.position.y = pos.y + restingY + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
    },
    destroyed: false,
    // Cleanup: remove the floating weapon group + dispose its meshes,
    // then call the owner's splice (which removes the collision AABB
    // the builder pushed into the level's obstacles list). The stone
    // block + its base AABB STAY — the silent "you walked past this"
    // commitment marker.
    onDestroy() {
      scene.remove(weaponGroup);
      weaponGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
        mesh.geometry.dispose();
      });
      onDestroy?.();
      unsubscribe();
    },
  };
  registerInteractable(interactable);

  // ── Self-mark-destroyed on any starter:chosen ────────────────────
  // The system tick will see destroyed=true next frame and run
  // onDestroy (above) which does the actual cleanup.
  const unsubscribe = onEvent((e) => {
    if (e.type !== 'starter:chosen') return;
    if (interactable.destroyed) return;
    interactable.destroyed = true;
    interactable.promptLabel = '';
  });
}
