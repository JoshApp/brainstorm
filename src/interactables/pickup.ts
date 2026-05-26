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

// Fountain physics — items pop out of the spawn point on an arc,
// settle into the bob+rotate display mode when they hit the floor.
const REST_Y = 0.35;              // y where the item bobs around once settled
const GRAVITY = -10.0;            // m/s² in game units (slightly punchier than real)
const LAUNCH_HEIGHT_DEFAULT = 0.9; // start at "torso" height when no override given
const FLIGHT_SPIN_MUL = 4;         // items spin faster while flying — adds flair

/** Optional launch parameters for a fountain pop. If omitted, the pickup
 *  appears settled on the floor immediately (legacy behavior, used by chest
 *  loot if a future caller wants it). */
export interface PickupLaunch {
  /** Initial world-space velocity (m/s). y > 0 means upward. */
  velocity: THREE.Vector3;
  /** Starting height above pos.y. Default 0.9m (enemy torso). */
  startHeight?: number;
}

export function createPickup(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  item: ItemSpec,
  launch?: PickupLaunch,
) {
  const rarityColor = RARITY_COLORS[item.rarity ?? 'mundane'];

  // Wrap everything in one group so destroy is a single scene.remove().
  // pickupGroup stays at the SETTLED ground position; the item moves in
  // local space within it during the fountain phase, then we re-parent
  // the group to the actual landed spot.
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
  // Hide the disc during fountain — it'd be a glowing landmark at the
  // spawn point with no item on top of it (weird).
  disc.visible = !launch;
  pickupGroup.add(disc);

  // ── Glow light — borrowed from the pre-allocated pool ──────────────
  const pooledLight = acquireLight();

  // ── Item model — bobs + rotates ────────────────────────────────────
  const built = buildModel(item.dropModel);
  pickupGroup.add(built.group);

  // Fountain state. itemX/Y/Z are LOCAL to pickupGroup (which sits at
  // pos). On land, we re-parent the group to the landed world position
  // and reset locals to (0, REST_Y, 0) so the rest-mode math is clean.
  let mode: 'flying' | 'settled' = launch ? 'flying' : 'settled';
  let itemX = 0;
  let itemZ = 0;
  let itemY = mode === 'flying'
    ? (launch!.startHeight ?? LAUNCH_HEIGHT_DEFAULT)
    : Math.max(0, REST_Y - pos.y);
  let vx = launch ? launch.velocity.x : 0;
  let vy = launch ? launch.velocity.y : 0;
  let vz = launch ? launch.velocity.z : 0;

  built.group.position.set(itemX, itemY, itemZ);

  // Light follows the item (also during flight). Position now.
  if (pooledLight) {
    pooledLight.light.color.setHex(rarityColor);
    pooledLight.light.intensity = LIGHT_INTENSITY;
    pooledLight.light.position.set(pos.x + itemX, pos.y + itemY, pos.z + itemZ);
  }

  // If we're not fountaining, this is effectively the moment it lands.
  if (mode === 'settled') playLootLand();

  let t = 0;
  // Tiny "land puff" — disc scales briefly bigger on landing for an
  // anticipation pop, then settles back.
  let landPuff = 0;
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
      if (mode === 'flying') {
        vy += GRAVITY * dt;
        itemX += vx * dt;
        itemY += vy * dt;
        itemZ += vz * dt;
        // Faster spin in the air sells the toss.
        built.group.rotation.y += ROTATE_SPEED * FLIGHT_SPIN_MUL * dt;
        built.group.rotation.x += ROTATE_SPEED * FLIGHT_SPIN_MUL * 0.6 * dt;
        if (itemY <= REST_Y - pos.y && vy < 0) {
          // LAND. Snap to rest height, re-parent the group so the
          // disc / interactable hitbox / future bob centers on the
          // landed spot instead of the spawn spot.
          const landedWorldX = pos.x + itemX;
          const landedWorldZ = pos.z + itemZ;
          pickupGroup.position.set(landedWorldX, pos.y, landedWorldZ);
          interactable.position.set(landedWorldX, pos.y, landedWorldZ);
          itemX = 0; itemZ = 0;
          itemY = Math.max(0, REST_Y - pos.y);
          built.group.position.set(itemX, itemY, itemZ);
          // Reset spin tilt so it bobs upright.
          built.group.rotation.x = 0;
          mode = 'settled';
          disc.visible = true;
          landPuff = 1;
          playLootLand();
        } else {
          built.group.position.set(itemX, itemY, itemZ);
        }
      } else {
        t += dt;
        itemY = Math.max(0, REST_Y - pos.y) + Math.sin(t * BOB_FREQUENCY) * BOB_AMPLITUDE;
        built.group.position.y = itemY;
        built.group.rotation.y += ROTATE_SPEED * dt;
        if (landPuff > 0) {
          landPuff = Math.max(0, landPuff - dt * 4);  // ~0.25s puff
          const scale = 1 + landPuff * 0.6;
          disc.scale.set(scale, scale, 1);
        }
      }
      // Light tracks the item every frame (cheap; just a Vector3 set).
      if (pooledLight) {
        pooledLight.light.position.set(
          pickupGroup.position.x + itemX,
          pickupGroup.position.y + itemY,
          pickupGroup.position.z + itemZ,
        );
      }
    },
    destroyed: false,
    /** When destroyed, the interactable system removes built.group from
     *  its parent. We override built.group so that "parent" is the
     *  pickupGroup itself — removing it cleans up disc + light + item. */
    built: { ...built, group: pickupGroup },
  };
  registerInteractable(interactable);
}
