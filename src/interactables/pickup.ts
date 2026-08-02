import * as THREE from 'three';
import { groundYAt } from '../level/elevation';
import { stdMat } from '../style/material-registry';
import { buildModel, mergeRigidSegments } from '../ecs/build-model';
import { buildRelicBillboard } from '../effects/relic-billboard';
import { hasRelicArt } from '../content/relic-art-assets';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { INTERACT_PRIORITY } from './types';
import { addItem, isAtCarryLimit } from '../player/inventory';
import { showInWorldMessage } from '../ui/pickup-notification';
import { groundEquip } from '../player/ground-equip';
import { rollItemInstance } from '../player/item-instance';
import type { AffixInstance } from '../content/affixes';
import { getTexture } from '../style/procedural-textures';
import { RARITY_COLORS, type ItemSpec, type Rarity } from '../content/items';
import { playLootLand, playPickupChime, playDenied, playFlaskUncork } from '../audio/sfx';
import { getFlask, addCharges, addCapacity } from '../player/flask';
import { flashPickupGlow } from '../ui/vignette';
import { emit } from '../broadcast/event-bus';
import { getActiveLevel } from '../level/active-level';
import { pooledPlane, pooledRing } from '../scene/geometry-pool';
import { registerWarmup } from '../content/warmup-registry';
import { gameRng } from '../engine/rng';

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
  // Gear ejected by a swap keeps its identity: instead of re-rolling affixes
  // when re-taken, this dropped pickup carries the SAME rolled affixes it had on
  // the body. Undefined (a fresh floor drop) rolls at take-time as before.
  presetAffixes?: AffixInstance[],
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
  // SHARED per rarity (the only varying field is the rarity colour; the fire-wisp texture is shared)
  // — so loot litter reuses ~one pipeline per rarity instead of forging one per drop. Not mutated.
  const discMat = stdMat({
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
  // The disc/ring sit just above the GROUND under the item, in
  // pickupGroup-local Y (the group rides at pos.y). On a flat floor this
  // is 0.01 - pos.y as before; on an elevated/sloped floor it tracks the
  // real floor so the ring doesn't float at world-zero while the item
  // rests two metres down. Recomputed on land for thrown drops.
  const floorLocalY = (gx: number, gz: number, lift: number) =>
    groundYAt(gx, gz) + lift - pos.y;
  const disc = new THREE.Mesh(pooledPlane(DISC_SIZE, DISC_SIZE), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = floorLocalY(pos.x, pos.z, 0.01);
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
  ring.position.y = floorLocalY(pos.x, pos.z, 0.015);
  ring.visible = false;  // toggled on by tick when in range
  pickupGroup.add(ring);

  // ── Item model — bobs + rotates (or a 2.5D billboard for arted relics) ──────
  // A relic with baked 2.5D art DROPS as a curved, lit, camera-facing billboard
  // (effects/relic-billboard.ts) instead of its procedural stand-in model — the
  // same painted object the reliquary shows, standing in the world and shaded by
  // the torchlight so it reads as solid. It bobs but never spins (the billboard
  // owns its own facing), and it isn't mesh-merged.
  const isBillboard = item.kind === 'relic' && hasRelicArt(item.id);
  const built = isBillboard ? buildRelicBillboard(item) : buildModel(item.dropModel);
  // Lego-merge the item's static meshes into one-per-material. The whole model
  // bobs/rotates as a group (no per-part animation, no name lookups), so this
  // is pure draw-call savings — important when a pack of loot litters the floor,
  // since every ground item's draws are live CPU cost (the thing that heats the
  // chip into a throttle). ignoreNames: the drop model is usually the weapon's
  // VIEWMODEL, whose parts are named for swing animation — but a pickup never
  // animates parts, so collapse by material regardless of name. Flames/sprites
  // are still preserved. (A billboard is a single mesh — nothing to merge.)
  if (!isBillboard) mergeRigidSegments(built, { ignoreNames: true });
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
    // The overlay reads this to show the FULL item card while you're aimed at it
    // — see before you take (ui/item-overlay.ts).
    previewItem: item,
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
      // Flask items feed the flask directly on pickup (no bag stop): a shard
      // always fuses; a draught pours ONLY when a pip is empty. A draught
      // NEVER pockets — at a full flask it stays on the stone for later,
      // same contract as a carry-capped potion (waste nothing, carry
      // nothing).
      if (item.consumableFlaskCapacity != null) return true;
      if (item.consumableFlaskCharges != null) {
        const f = getFlask();
        return f.charges < f.capacity;
      }
      return !(item.kind === 'consumable' && isAtCarryLimit(item.id));
    },
    // Consumables + KEYS are decision-free — grab them on walk-over, no tap
    // (a key is pure currency, never a choice). Gear stays a deliberate tap
    // (equipping is a choice + the bag is finite). The carry-cap gate (canUse)
    // means a full bag leaves the potion on the floor for later.
    autoPickup: item.kind === 'consumable' || item.kind === 'key',
    onUse() {
      // Where the object physically is (nudged up off the floor to the item
      // body), so the diegetic pickup chip flies into the HUD from the item's
      // real on-screen spot rather than a canned screen point.
      const p = interactable.position;
      const wp = { x: p.x, y: p.y + 0.35, z: p.z };
      // Flask SHARD — fuses into the flask the moment it's touched: +capacity,
      // the new pip arriving filled. Never enters the bag; growth is the event.
      if (item.consumableFlaskCapacity != null) {
        addCapacity(item.consumableFlaskCapacity, true);
        showInWorldMessage('The flask grows deeper.');
        const rarityIdx = RARITY_INDEX[item.rarity ?? 'mundane'];
        playPickupChime(rarityIdx);
        pickupHaptic(rarityIdx);
        flashPickupGlow(rarityIdx);
        emit({ type: 'item:picked-up', itemId: item.id, worldPos: wp });
        interactable.destroyed = true;
        return;
      }
      // Flask DRAUGHT — pours straight into the flask, instantly (a lit pip,
      // no bag stop, no inventory item). At a full flask it stays on the
      // ground: canUse() already blocks walk-over; this guard covers a
      // deliberate tap and says why.
      if (item.consumableFlaskCharges != null) {
        const f = getFlask();
        if (f.charges >= f.capacity) {
          showInWorldMessage('The flask is full.');
          playDenied();
          return;
        }
        addCharges(item.consumableFlaskCharges);
        showInWorldMessage('The flask accepts it.');
        playFlaskUncork();
        pickupHaptic(RARITY_INDEX[item.rarity ?? 'mundane']);
        emit({ type: 'item:picked-up', itemId: item.id, worldPos: wp });
        interactable.destroyed = true;
        return;
      }
      // Carry cap (consumables): if full, leave the pickup on the ground and
      // tell the player — no chime, no destroy, so they can grab it later.
      if (item.kind === 'consumable' && isAtCarryLimit(item.id)) {
        showInWorldMessage('You can carry no more.');
        playDenied();
        return;
      }
      const rarityIdx = RARITY_INDEX[item.rarity ?? 'mundane'];

      // GEAR (weapon / offhand / vestment / relic) — no bag. It goes straight
      // onto the body via the ground-equip path: an empty slot takes it
      // instantly; full slots open a swap-or-leave compare; a relic collects.
      // The pickup feel fires only when it actually LANDS (onEquipped) — a
      // LEAVE leaves the stone quiet and the item where it lay.
      if (item.kind !== 'consumable' && item.kind !== 'key') {
        // Ejected gear keeps its rolled affixes; a fresh floor drop rolls now.
        const affixes = presetAffixes ?? rollItemInstance(item).affixes;
        groundEquip({
          item,
          affixes,
          onEquipped: () => {
            playPickupChime(rarityIdx);
            pickupHaptic(rarityIdx);
            flashPickupGlow(rarityIdx);
            emit({ type: 'item:picked-up', itemId: item.id, worldPos: wp });
            interactable.destroyed = true;
          },
          dropDisplaced: (dItem, dAff) => dropGearPickup(scene, interactable.position, dItem, dAff),
        });
        return;
      }

      // Pickup feel — a rarity ladder across three channels so a real find
      // lands as an EVENT without a celebratory UI pop (the dungeon doesn't
      // cheer). Audio: rarity-tinted toll + low resonant swell / held tone
      // on rare+. Haptic: a soft tick for mundane → a strong double-thunk
      // for fabled. Screen: a deep-amber edge bloom on uncommon+ only.
      playPickupChime(rarityIdx);
      pickupHaptic(rarityIdx);
      flashPickupGlow(rarityIdx);
      // Emit on the event bus so the run-state's "items found" set + any
      // future listeners (LLM narration of first-discovery, etc.) hear it.
      emit({ type: 'item:picked-up', itemId: item.id, worldPos: wp });
      addItem(item.id);
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
        // Faster spin in the air sells the toss — but a billboard never spins
        // (it always faces the player), so let it fly facing you instead.
        if (!isBillboard) {
          built.group.rotation.y += ROTATE_SPEED * FLIGHT_SPIN_MUL * dt;
          built.group.rotation.x += ROTATE_SPEED * FLIGHT_SPIN_MUL * 0.6 * dt;
        }
        if (itemY <= restLocalY() && vy < 0) {
          // LAND. Snap to rest height, re-parent the group so the
          // disc / interactable hitbox / future bob centers on the
          // landed spot instead of the spawn spot.
          let landedWorldX = pos.x + itemX;
          let landedWorldZ = pos.z + itemZ;
          // Never rest over a carved pit: voids aren't in the elevation
          // field, so a drop there would float at rim height over the
          // black drop (and be unreachable). Nudge to the nearest walkable
          // ground (resolveSpawn excludes void/wall obstacles).
          const w = getActiveLevel()?.walkable;
          if (w) {
            const safe = w.resolveSpawn(landedWorldX, landedWorldZ, 0.2);
            landedWorldX = safe.x; landedWorldZ = safe.z;
          }
          pickupGroup.position.set(landedWorldX, pos.y, landedWorldZ);
          interactable.position.set(landedWorldX, pos.y, landedWorldZ);
          // The throw may have drifted to a different ground cell — re-seat
          // the disc + ring on the floor under where it actually landed.
          disc.position.y = floorLocalY(landedWorldX, landedWorldZ, 0.01);
          ring.position.y = floorLocalY(landedWorldX, landedWorldZ, 0.015);
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
        // Billboards face the camera (relic-billboard onBeforeRender), everything
        // else slowly turns on its pedestal.
        if (!isBillboard) built.group.rotation.y += ROTATE_SPEED * dt;
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

// Eject a displaced piece of gear back onto the floor when a swap replaces it
// (ground-equip's dropDisplaced). A gentle random toss so it arcs out a short
// way instead of landing dead-centre on the pickup it just replaced — the same
// physics a fountain pop uses. Its affixes ride along so re-taking it restores
// the exact piece you set down.
export function dropGearPickup(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  item: ItemSpec,
  affixes: readonly AffixInstance[],
) {
  const ang = gameRng() * Math.PI * 2;
  const speed = 1.1 + gameRng() * 0.5;
  createPickup(
    scene,
    pos.clone(),
    item,
    { velocity: new THREE.Vector3(Math.cos(ang) * speed, 2.4, Math.sin(ang) * speed), startHeight: 0.7 },
    [...affixes],
  );
}

// Warm the loot-litter pipelines at boot: the floor disc is a SHARED stdMat per
// rarity (transparent, fog-off — a variant nothing placed in a floor uses), so
// without this the FIRST drop of each rarity compiled it in-play, on the death
// beat that dropped the loot (the `shared:std` post-warmup compiles in the
// 2026-07-04 traces). One disc per rarity + one range ring; the shared stdMat
// pool retains the instances, so the compiled state stays pinned for the session.
registerWarmup({
  label: 'pickup-litter', live: true,
  spawn: (scene) => {
    for (const rarity of Object.keys(RARITY_COLORS) as Rarity[]) {
      const m = new THREE.Mesh(pooledPlane(DISC_SIZE, DISC_SIZE), stdMat({
        map: getTexture('fire-wisp'),
        color: RARITY_COLORS[rarity],
        emissive: RARITY_COLORS[rarity],
        emissiveIntensity: 1.2,
        transparent: true,
        alphaTest: 0.05,
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }));
      m.frustumCulled = false;
      scene.add(m);
    }
    const ring = new THREE.Mesh(pooledRing(0.50, 0.62, 28), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      fog: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    ring.frustumCulled = false;
    scene.add(ring);
  },
  clear: () => {},
});
