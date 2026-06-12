import * as THREE from 'three';
import { groundYAt } from '../level/elevation';
import { buildModel, mergeRigidSegments } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { INTERACT_PRIORITY } from './types';
import { addItem, removeItem, isAtCarryLimit } from '../player/inventory';
import { showInWorldMessage } from '../ui/pickup-notification';
import { tryAutoEquip } from '../player/equipment';
import { rollItemInstance, instanceDisplayName } from '../player/item-instance';
import { getTexture } from '../style/procedural-textures';
import { RARITY_COLORS, type ItemSpec, type Rarity } from '../content/items';
import { playLootLand, playPickupChime, playDenied } from '../audio/sfx';
import { flashPickupGlow } from '../ui/vignette';
import { emit } from '../broadcast/event-bus';
import { getActiveLevel } from '../level/loader';
import { pooledPlane, pooledRing } from '../scene/geometry-pool';

// Rarity → audio "preciousness" index. Mundane is dull, fabled is bright.
const RARITY_INDEX: Record<Rarity, number> = {
  mundane: 0, uncommon: 1, rare: 2, cursed: 3, fabled: 4,
};

// Rarity → haptic pattern (ms; arrays are vibrate/pause/vibrate…). The
// preciousness ladder you can FEEL through the glass: a single soft tick for
// junk, building to a strong double-thunk for a fabled find. Cursed gets a
// deliberately uneven stutter — a "something's wrong with this one" pulse —
// instead of a cleaner double, so the body reads the curse before the UI does.
const PICKUP_HAPTIC: Record<number, number | number[]> = {
  0: 8,                          // mundane — soft tick
  1: 16,                         // uncommon — medium thunk
  2: [14, 36, 14],               // rare — clean double
  3: [10, 22, 10, 22, 10],       // cursed — uneven stutter
  4: [28, 46, 30],               // fabled — strong double
};
function pickupHaptic(rarityIdx: number) {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate(PICKUP_HAPTIC[rarityIdx] ?? 8);
}

// Pickup interactable: a loot model on the floor that the player can walk up
// to and TAKE. The model bobs + rotates; an emissive floor disc + a borrowed
// PointLight (from a fixed pool) tinted by the item's rarity make it visible
// from a distance.
//
// PERF: a dropped item is an emissive floor disc (glows via bloom, no real
// light) + the merged item geometry. No per-item point light — a floor strewn
// with loot would otherwise register dozens of pool lights, sorted every frame,
// when only 4 can ever bind.
//
// Layout:
//   pickupGroup (root, added to scene; removed on take/destroy)
//   ├─ floorDisc      flat emissive decal on the floor, doesn't move
//   └─ built.group    the actual item geometry, bobs + rotates

const BOB_AMPLITUDE = 0.04;
const BOB_FREQUENCY = 1.8;
const ROTATE_SPEED = 0.5;  // rad/s

const DISC_SIZE = 0.9;

// Pickups no longer take a real point light — the emissive floor disc (+ bloom)
// carries the glow, and only 4 pickup lights could ever be active, so a litter
// of loot just spammed the light pool with registrations it sorted every frame
// and never bound. initPickupLightPool is kept as a no-op for boot-order compat.

/** No-op kept for boot-order back-compat. */
export function initPickupLightPool(_scene: THREE.Scene) {
  // intentionally empty
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
  const disc = new THREE.Mesh(pooledPlane(DISC_SIZE, DISC_SIZE), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.01 - pos.y;  // sit ~1cm above the floor (compensate for parent y)
  // Hide the disc during fountain — it'd be a glowing landmark at the
  // spawn point with no item on top of it (weird).
  disc.visible = !launch;
  pickupGroup.add(disc);

  // ── Pickup ring — thin glowing ring on the floor, ONLY visible
  // when the player is in range. Tells the player "you can take this"
  // without relying solely on the use button (some players reach for
  // the object directly with their thumb on phone).
  const ringGeom = pooledRing(0.50, 0.62, 28);
  const ringMat = new THREE.MeshBasicMaterial({
    color: rarityColor,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015 - pos.y;
  ring.visible = false;  // toggled on by tick when in range
  pickupGroup.add(ring);

  // ── Item model — bobs + rotates ────────────────────────────────────
  const built = buildModel(item.dropModel);
  // Lego-merge the item's static meshes into one-per-material. The whole model
  // bobs/rotates as a group (no per-part animation, no name lookups), so this
  // is pure draw-call savings — important when a pack of loot litters the floor,
  // since every ground item's draws are live CPU cost (the thing that heats the
  // chip into a throttle). ignoreNames: the drop model is usually the weapon's
  // VIEWMODEL, whose parts are named for swing animation — but a pickup never
  // animates parts, so collapse by material regardless of name. Flames/sprites
  // are still preserved.
  mergeRigidSegments(built, { ignoreNames: true });
  // A dropped item neither casts NOR receives shadows. The drop model defaults
  // every part to cast+receive (buildModel), so a litter of loot re-renders into
  // the lamp's 6-face cube map every frame for nothing — measured at ~5-6 draws
  // PER ITEM. The loot glow comes from the emissive disc + bloom, not a cast
  // shadow; grounding (the soft contact shadow under an item) is better done as
  // a cheap dedicated blob in a future shadow pass than by paying full cube-map
  // cast/receive here.
  built.group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.castShadow = false;
    m.receiveShadow = false;
  });
  pickupGroup.add(built.group);

  // Fountain state. itemX/Y/Z are LOCAL to pickupGroup (which sits at
  // pos). On land, we re-parent the group to the landed world position
  // and reset locals to (0, REST_Y, 0) so the rest-mode math is clean.
  let mode: 'flying' | 'settled' = launch ? 'flying' : 'settled';
  let itemX = 0;
  let itemZ = 0;
  // Rest height is RELATIVE TO THE GROUND under the item (REST_Y above
  // it), expressed in pickupGroup-local Y. On flat floors this reduces
  // to the old absolute REST_Y.
  const restLocalY = () =>
    Math.max(0, groundYAt(pos.x + itemX, pos.z + itemZ) + REST_Y - pos.y);
  let itemY = mode === 'flying'
    ? (launch!.startHeight ?? LAUNCH_HEIGHT_DEFAULT)
    : restLocalY();
  let vx = launch ? launch.velocity.x : 0;
  let vy = launch ? launch.velocity.y : 0;
  let vz = launch ? launch.velocity.z : 0;

  built.group.position.set(itemX, itemY, itemZ);

  const id = generateEntityId('pickup');

  // No per-item point light: the floor disc is emissive (+ bloom), which carries
  // the loot glow on its own, and only 4 pickup lights could ever be active
  // anyway — so a litter of loot used to register dozens of real lights that the
  // pool sorted every frame for nothing. The emissive disc is enough.

  // If we're not fountaining, this is effectively the moment it lands.
  if (mode === 'settled') playLootLand(pos);

  let t = 0;
  // Tiny "land puff" — disc scales briefly bigger on landing for an
  // anticipation pop, then settles back.
  let landPuff = 0;

  const interactable = {
    id,
    position: pos.clone(),
    radius: 1.0,
    // Loot wins a tap over a chest / fountain / the stairs you're standing on.
    priority: INTERACT_PRIORITY.pickup,
    // Promptless during flight — the interactables system filters out
    // empty-label items, so the player can't grab an item mid-arc. We
    // flip to 'TAKE' the moment it lands (mode → 'settled').
    promptLabel: (mode === 'settled' ? 'TAKE' : ''),
    // Items are small; the default 1.07× outline doesn't read at all
    // on a 30cm sword. 1.45× makes the silhouette properly pop without
    // looking like a halo balloon.
    outlineScale: 1.45,
    // A consumable you have no room for is "in the way but not takeable":
    // report it ineligible so a full potion landing on top of other loot
    // doesn't trap the item beneath — selection falls through to the
    // takeable item. (onUse still surfaces the "carry no more" message if
    // the potion is the only thing here.)
    canUse() {
      return !(item.kind === 'consumable' && isAtCarryLimit(item.id));
    },
    onUse() {
      // Carry cap (consumables): if full, leave the pickup on the ground and
      // tell the player — no chime, no destroy, so they can grab it later.
      if (item.kind === 'consumable' && isAtCarryLimit(item.id)) {
        showInWorldMessage('You can carry no more.');
        playDenied();
        return;
      }
      // Pickup feel — a rarity ladder across three channels so a real find
      // lands as an EVENT without a celebratory UI pop (the dungeon doesn't
      // cheer). Audio: rarity-tinted toll + low resonant swell / held tone
      // on rare+. Haptic: a soft tick for mundane → a strong double-thunk
      // for fabled. Screen: a deep-amber edge bloom on uncommon+ only.
      const rarityIdx = RARITY_INDEX[item.rarity ?? 'mundane'];
      playPickupChime(rarityIdx);
      pickupHaptic(rarityIdx);
      flashPickupGlow(rarityIdx);
      // Emit on the event bus so the run-state's "items found" set + any
      // future listeners (LLM narration of first-discovery, etc.) hear it.
      emit({ type: 'item:picked-up', itemId: item.id });
      // Inventory addition + auto-equip routing. The notification toast
      // listens for the addItem event; equipment routing decides whether
      // to keep the item in the bag.
      if (item.kind !== 'consumable') {
        // Roll affixes now and pass them through to the equipment
        // sidecar. Decorated name (base + suffixes) feeds the pickup
        // toast so the player sees "scimitar of the keening" if a
        // suffix rolled. V1 limitation: if auto-equip fails (slot
        // already filled), the affixes are discarded and the bagged
        // item shows its plain name — proper bag-resident affix
        // preservation lands with the full inventory rewrite.
        const inst = rollItemInstance(item);
        const displayName = instanceDisplayName(inst);
        addItem(item.id, displayName);
        if (tryAutoEquip(item, inst.affixes)) removeItem(item.id);
      } else {
        addItem(item.id);
      }
      interactable.destroyed = true;
    },
    tick(dt: number) {
      if (mode === 'flying') {
        vy += GRAVITY * dt;
        const nextX = itemX + vx * dt;
        const nextZ = itemZ + vz * dt;
        // Horizontal motion through walkable.clampMove — same primitive
        // the player + gold coins use. Slides along walls on partial
        // blocks; zeroes velocity on the blocked axis so the item
        // sticks instead of jittering against the wall. Vertical
        // motion is unaffected.
        const walkable = getActiveLevel()?.walkable;
        if (walkable) {
          const wx = pos.x + itemX;
          const wz = pos.z + itemZ;
          const m = walkable.clampMove(wx, wz, pos.x + nextX, pos.z + nextZ, 0.05);
          if (m.x !== pos.x + nextX) vx = 0;
          if (m.z !== pos.z + nextZ) vz = 0;
          itemX = m.x - pos.x;
          itemZ = m.z - pos.z;
        } else {
          itemX = nextX;
          itemZ = nextZ;
        }
        itemY += vy * dt;
        // Faster spin in the air sells the toss.
        built.group.rotation.y += ROTATE_SPEED * FLIGHT_SPIN_MUL * dt;
        built.group.rotation.x += ROTATE_SPEED * FLIGHT_SPIN_MUL * 0.6 * dt;
        if (itemY <= restLocalY() && vy < 0) {
          // LAND. Snap to rest height, re-parent the group so the
          // disc / interactable hitbox / future bob centers on the
          // landed spot instead of the spawn spot.
          const landedWorldX = pos.x + itemX;
          const landedWorldZ = pos.z + itemZ;
          pickupGroup.position.set(landedWorldX, pos.y, landedWorldZ);
          interactable.position.set(landedWorldX, pos.y, landedWorldZ);
          itemX = 0; itemZ = 0;
          itemY = restLocalY();
          built.group.position.set(itemX, itemY, itemZ);
          // Reset spin tilt so it bobs upright.
          built.group.rotation.x = 0;
          mode = 'settled';
          disc.visible = true;
          landPuff = 1;
          // Item just landed → it's pickable now. Empty during flight
          // means the interactables system was ignoring it; TAKE now
          // surfaces the prompt + tap target.
          interactable.promptLabel = 'TAKE';
          playLootLand(built.group.position);
        } else {
          built.group.position.set(itemX, itemY, itemZ);
        }
      } else {
        t += dt;
        itemY = restLocalY() + Math.sin(t * BOB_FREQUENCY) * BOB_AMPLITUDE;
        built.group.position.y = itemY;
        built.group.rotation.y += ROTATE_SPEED * dt;
        if (landPuff > 0) {
          landPuff = Math.max(0, landPuff - dt * 4);  // ~0.25s puff
          const scale = 1 + landPuff * 0.6;
          disc.scale.set(scale, scale, 1);
        }
      }
      // In-range floor ring: only visible when the player IS in range.
      // Pulses gently. Settled-only — flying items aren't takeable yet
      // so the ring would be misleading mid-arc.
      if (mode === 'settled') {
        const isInRange = getInRangeInteractable() === interactable;
        ring.visible = isInRange;
        if (isInRange) {
          const pulse = 1 + 0.08 * Math.sin(t * Math.PI * 2 / 0.9);
          ring.scale.set(pulse, pulse, 1);
        }
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
