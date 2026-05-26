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
// to and TAKE. The model bobs + rotates; an emissive floor disc + a borrowed
// PointLight (from a fixed pool) tinted by the item's rarity make it visible
// from a distance.
//
// PERF: pickups borrow lights from a FIXED pool pre-allocated at boot.
// Three.js recompiles every material's shader whenever the scene's
// light COUNT changes — but moving / recoloring / dimming an existing
// light is free. So initLightPool() seeds the scene with N idle lights
// once, and pickups grab/release them without ever changing the count.
// Previously, creating a new PointLight per drop caused a multi-frame
// hitch on every kill — especially when 3+ items dropped at once.
//
// Layout:
//   pickupGroup (root, added to scene; removed on take/destroy)
//   ├─ floorDisc      flat decal on the floor, doesn't move
//   └─ built.group    the actual item geometry, bobs + rotates
// (Light is shared from the pool — not parented to the group.)

const BOB_AMPLITUDE = 0.04;
const BOB_FREQUENCY = 1.8;
const ROTATE_SPEED = 0.5;  // rad/s

const DISC_SIZE = 0.9;
const LIGHT_INTENSITY = 3.5;
const LIGHT_DISTANCE = 2.4;
const LIGHT_DECAY = 1.6;

// ── Light pool ────────────────────────────────────────────────────────
// Pre-allocate enough lights for the worst-case simultaneous-pickup count.
// 8 is comfortable: at most every enemy on Floor 1 dropping max items at
// once, plus a chest's worth. Exceeding it is silent: extra pickups just
// don't get a light (disc still visible).
const POOL_SIZE = 8;

interface PoolLight {
  light: THREE.PointLight;
  inUse: boolean;
}
const lightPool: PoolLight[] = [];

/** Call once at boot, with the live scene. Allocates the light pool. */
export function initPickupLightPool(scene: THREE.Scene) {
  if (lightPool.length > 0) return;  // idempotent
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffffff, 0, LIGHT_DISTANCE, LIGHT_DECAY);
    // Far below the floor so it's invisible while idle. Intensity 0 also
    // hides it, but parking it off-stage avoids any rounding-edge cases.
    light.position.set(0, -100, 0);
    scene.add(light);
    lightPool.push({ light, inUse: false });
  }
}

function acquireLight(): PoolLight | null {
  for (const p of lightPool) {
    if (!p.inUse) {
      p.inUse = true;
      return p;
    }
  }
  return null;
}

function releaseLight(p: PoolLight) {
  p.inUse = false;
  p.light.intensity = 0;
  p.light.position.set(0, -100, 0);
}

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

  // ── Glow light — borrowed from the pre-allocated pool ──────────────
  // No-op if the pool is exhausted; disc still gives a visible signal.
  const pooledLight = acquireLight();
  if (pooledLight) {
    pooledLight.light.color.setHex(rarityColor);
    pooledLight.light.intensity = LIGHT_INTENSITY;
    pooledLight.light.position.set(pos.x, pos.y + 0.35, pos.z);
  }

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
      if (pooledLight) releaseLight(pooledLight);
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
