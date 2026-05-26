import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { addItem, removeItem, addItemSilently } from '../player/inventory';
import { tryAutoEquip, equipFromInventory } from '../player/equipment';
import { getTexture } from '../style/procedural-textures';
import { RARITY_COLORS, type ItemSpec, type Rarity } from '../content/items';
import { playLootLand, playPickupChime } from '../audio/sfx';

// Rarity → audio "preciousness" index. Mundane is dull, fabled is bright.
const RARITY_INDEX: Record<Rarity, number> = {
  mundane: 0, uncommon: 1, rare: 2, cursed: 3, fabled: 4,
};

// Pickup interactable: a loot model on the floor that the player can walk up
// to and TAKE. The model bobs + rotates; an attached PointLight + floor
// disc tinted by the item's rarity make it visible from a distance — the
// classic "loot on the dungeon floor" silhouette.
//
// Layout:
//   pickupGroup (root, added to scene; removed on take/destroy)
//   ├─ floorDisc      flat decal on the floor, doesn't move
//   ├─ glowLight      PointLight at item-center height, doesn't move
//   └─ built.group    the actual item geometry, bobs + rotates

const BOB_AMPLITUDE = 0.04;
const BOB_FREQUENCY = 1.8;
const ROTATE_SPEED = 0.5;  // rad/s

// Floor-glow disc size + tunings — tweaked so loot is visible from across
// a room without saturating the immediate area.
const DISC_SIZE = 0.9;
const LIGHT_INTENSITY = 3.5;
const LIGHT_DISTANCE = 2.4;
const LIGHT_DECAY = 1.6;

export function createPickup(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  item: ItemSpec,
) {
  const rarityColor = RARITY_COLORS[item.rarity ?? 'mundane'];

  // Wrap everything in one group so destroy is a single scene.remove().
  const pickupGroup = new THREE.Group();
  pickupGroup.position.copy(pos);
  scene.add(pickupGroup);

  // ── Floor disc — flat plane on the ground, rarity-tinted ───────────
  const discMat = new THREE.MeshStandardMaterial({
    map: getTexture('fire-wisp'),
    color: rarityColor,
    emissive: rarityColor,
    emissiveIntensity: 1.2,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(DISC_SIZE, DISC_SIZE), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.01 - pos.y;  // sit ~1cm above the floor (compensate for parent y)
  pickupGroup.add(disc);

  // ── Glow light — a small PointLight at item-center height ──────────
  const glowLight = new THREE.PointLight(rarityColor, LIGHT_INTENSITY, LIGHT_DISTANCE, LIGHT_DECAY);
  glowLight.position.y = 0.35 - pos.y;
  pickupGroup.add(glowLight);

  // ── Item model — bobs + rotates ────────────────────────────────────
  const built = buildModel(item.dropModel);
  built.group.position.y = Math.max(0, 0.35 - pos.y);  // float above the floor disc
  pickupGroup.add(built.group);

  // Loot landing — the small thump as the item hits the floor.
  playLootLand();

  const baseItemY = built.group.position.y;
  let t = 0;
  const id = generateEntityId('pickup');

  const interactable = {
    id,
    position: pos.clone(),
    radius: 1.0,
    promptLabel: 'TAKE',
    onUse() {
      // Pickup chime — rarity-tinted (mundane low/dull, fabled high/long).
      playPickupChime(RARITY_INDEX[item.rarity ?? 'mundane']);
      // Inventory addition + auto-equip routing. The notification toast
      // listens for the addItem event; equipment routing decides whether
      // to keep the item in the bag.
      addItem(item.id);
      if (item.kind === 'weapon') {
        // Weapons always equip on pickup (replace current).
        const previous = equipFromInventory(item);
        if (previous) addItemSilently(previous.id);
        removeItem(item.id);
      } else if (item.kind !== 'consumable') {
        // All other equipment kinds auto-equip only if a matching slot
        // is empty (ring + armor + helmet + amulet + gloves + boots +
        // offhand); falls back to staying in the bag otherwise.
        if (tryAutoEquip(item)) removeItem(item.id);
      }
      interactable.destroyed = true;
    },
    tick(dt: number) {
      t += dt;
      built.group.position.y = baseItemY + Math.sin(t * BOB_FREQUENCY) * BOB_AMPLITUDE;
      built.group.rotation.y += ROTATE_SPEED * dt;
    },
    destroyed: false,
    /** When destroyed, the interactable system removes built.group from
     *  its parent. We override built.group so that "parent" is the
     *  pickupGroup itself — removing it cleans up disc + light + item. */
    built: { ...built, group: pickupGroup },
  };
  registerInteractable(interactable);
}
