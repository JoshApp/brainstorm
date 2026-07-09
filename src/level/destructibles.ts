import * as THREE from 'three';
import { groundYAt } from './elevation';
import { buildModel } from '../ecs/build-model';
import { VASE_TALL, VASE_SQUAT, VASE_FLASK, VASE_BROKEN } from '../content/vase';
import { COBWEB_BARRIER } from '../content/cobweb';
import { spawnGoldCoins } from '../effects/gold-coins';
import { createPickup } from '../interactables/pickup';
import { rollDropTable } from '../content/drop-tables';
import { getCurrentDepth } from './loader';
import { ITEMS } from '../content/items';
import { playEnemyDeath, playSurfaceShatter } from '../audio/sfx';
import { spawnShatterBurst } from '../effects/shatter-burst';
import {
  spawn as spawnEntity,
  destroy as destroyEntity,
  get as getEntity,
  generateEntityId,
} from '../ecs/world';
import {
  computeDamage,
  setEntityCombatStats,
  clearEntityCombatStats,
  type DamageEvent,
} from '../combat/damage';
import type { Damageable } from '../combat/damageable';
import { propHurtbox } from '../combat/hurtbox';
import { gameRng, gameRngInt, gameRngChance, buildRng, buildRngInt } from '../engine/rng';

// Destructible props — a parallel hit-test target list for the
// combat system. Distinct from enemies (no AI, no perception, no
// damage TO the player) but share the same swing-cone-then-take-
// hit pattern so the player's existing combat reach + animation
// fires breakable vases naturally.
//
// On hit: HP drops by the swing's damage. When HP hits zero,
// fire spawnShardBurst (a few additive shards puffing outward),
// roll a loot table, despawn. The shard burst piggy-backs on
// existing gold-coin / pickup systems to avoid a new particle
// system.

// A destructible is a Damageable like any enemy — it just has no AI and
// 0 armor. Its HP lives in the ECS entity pool (keyed by entityId), so
// the damage pipeline, buffs, and any future DoT/AoE pick it up with no
// special-casing in the combat system.
export interface Destructible extends Damageable {
  id: string;
  group: THREE.Group;
}

// Loot table for vases. Heals no longer spill from pottery (Estus Stage 2 —
// the flask is the heal economy; common heal slots pay in currency instead).
const VASE_GOLD_CHANCE = 0.50;     // 50% drop SOME gold

// Vase variant pool — weighted random picks. Broken vase is
// rarer than the intact ones; it also rolls much lower loot
// drop rates inside takeDamage (signalled by the broken flag).
interface VaseVariant {
  model: typeof VASE_TALL;
  weight: number;
  broken?: boolean;
}
const VASE_VARIANTS: VaseVariant[] = [
  { model: VASE_TALL,   weight: 4 },
  { model: VASE_SQUAT,  weight: 4 },
  { model: VASE_FLASK,  weight: 3 },
  { model: VASE_BROKEN, weight: 1, broken: true },
];

/** Spawn a vase destructible at world (x, z). Random variant
 *  + random rotation + random scale jitter (90-115%).
 *
 *  `onDestroyed` is invoked when HP hits zero, BEFORE the mesh
 *  is removed from the scene. The builder uses it to splice the
 *  vase's obstacle entry out of the walkable region so the
 *  player can pass through the smashed cell. */
export function spawnVase(
  scene: THREE.Object3D,
  x: number,
  z: number,
  onDestroyed?: () => void,
): Destructible {
  const id = `vase-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const entityId = generateEntityId('vase');
  const variant = pickVariant();
  const built = buildModel(variant.model);
  const group = built.group;
  group.position.set(x, groundYAt(x, z), z);
  group.rotation.y = buildRng() * Math.PI * 2;
  // Scale jitter — 90-115% so vases in a cluster don't all read
  // the same height.
  const s = 0.90 + buildRng() * 0.25;
  group.scale.set(s, s, s);
  scene.add(group);
  const isBroken = !!variant.broken;

  // Register as an ECS entity so the damage pipeline owns its HP. Plain
  // vases shatter in ONE hit — they're flavour clutter, not a fight — but
  // computeDamage floors every hit at 1, so hp:1 means one-and-done while
  // still flowing through armor/crit/buffs like anything else. A sturdier
  // breakable (reinforced crate, sealed urn) just spawns with higher hp.
  spawnEntity({ id: entityId, kind: 'prop', hp: { base: 1, current: 1 }, buffs: [], passives: [] });
  setEntityCombatStats(entityId, {}); // defaults: 0 armor, 1x damage

  const tmpDropPos = new THREE.Vector3();

  const dest: Destructible = {
    id,
    entityId,
    group,
    position: group.position,
    // Vases sit low; aim the cone (and the floating damage number) at the
    // body, not the floor.
    aimHeight: 0.25,
    collisionRadius: 0.18,
    // One body sphere — forgiving (props are clutter, not a fight). Same hit
    // path as enemies. Local to the (uniformly-scaled) group, so it tracks the
    // vase's scale jitter.
    hurtbox: propHurtbox(group, 0.28, 0.34),
    hitFeedback: 'light',
    hitMaterial: 'ceramic',
    bloodAmount: 0,   // fired clay does not bleed
    alive: true,
    takeDamage(event: DamageEvent) {
      if (!dest.alive) return 0;
      const entity = getEntity(entityId);
      if (!entity || !entity.hp) return 0;
      const { applied } = computeDamage(event);
      entity.hp.current = Math.max(0, entity.hp.current - applied);
      if (entity.hp.current > 0) return applied;
      // Destroyed.
      dest.alive = false;
      destroyEntity(entityId);
      clearEntityCombatStats(entityId);
      // Spawn the shatter burst before removing the mesh so we
      // have a position reference; the burst lives on its own
      // pool ticked from main.ts.
      spawnShatterBurst(scene, group.position.x, group.position.y + 0.20, group.position.z, isBroken);
      // Tell the builder/runtime to splice this vase's
      // obstacle out of the walkable region — without this, the
      // player can't walk through the smashed cell.
      onDestroyed?.();
      // Shatter sound matched to the prop's material (ceramic vase → a proper
      // pottery break), NOT the mob-death squeak it used to borrow.
      playSurfaceShatter(dest.hitMaterial ?? 'ceramic', group.position);
      // Roll loot. Pre-broken vases drop a small amount of dust
      // rather than coins — visually they were already smashed,
      // so the "reward" should match.
      const goldChance  = isBroken ? VASE_GOLD_CHANCE * 0.25 : VASE_GOLD_CHANCE;
      const dropY = group.position.y + 0.25;
      tmpDropPos.set(group.position.x, dropY, group.position.z);
      // Rare drop (the goldChance gate keeps most vases empty), and when it comes
      // it's the unified 'vase' table — mostly a little gold, rarely a key/consumable.
      if (gameRngChance(goldChance)) {
        const bundle = rollDropTable('vase', getCurrentDepth(), gameRng);
        if (bundle.gold > 0) spawnGoldCoins(scene, tmpDropPos, bundle.gold);
        for (const item of bundle.items) createPickup(scene, tmpDropPos, item);
      }
      // Remove from scene; reclaim this vase's geometry.
      scene.remove(group);
      // Dispose ONLY this vase's own (non-pooled) geometry. Two hazards this guards:
      //   1. POOLED geometry is SHARED across every vase/prop (buildModel pulls from
      //      the geometry-pool). Disposing it frees buffers OTHER props still draw
      //      with — a latent bug on WebGL, and on WebGPU a hard fault.
      //   2. On WebGPU the render loop is fire-and-forget renderAsync — a frame is
      //      often in flight. Freeing a buffer that frame's command encoder still
      //      references = "invalid command buffer" → device loss → black screen
      //      (same class as the warmup-dispose bug). So on WebGPU we DON'T dispose
      //      synchronously at all; the per-vase geometry is tiny, GC reclaims it once
      //      the group is out of the scene. (Pooled geo must never be disposed here.)
      return applied;
    },
  };
  return dest;
}

/** Spawn a destructible COBWEB BARRIER at (x, z) facing `rotY` — a web
 *  curtain that plugs a passage until the player slashes it. Same
 *  Damageable contract as a vase (one swing clears it: hp 1), but no
 *  loot and a softer "tear" instead of a stone shatter. The caller
 *  pushes the blocking obstacle and passes `onDestroyed` to splice it
 *  out so the passage opens the instant the web is cut. */
// The COBWEB_BARRIER decals are authored to span a ~1.9m single doorway;
// widthM scales the curtain horizontally (and its blocking radius) so a
// wider web gate reads filled rather than a 2m web stretched over a 1m hole.
const COBWEB_BASE_WIDTH = 1.9;

export function spawnCobweb(
  scene: THREE.Object3D,
  x: number,
  z: number,
  rotY: number,
  widthM: number = COBWEB_BASE_WIDTH,
  onDestroyed?: () => void,
): Destructible {
  const id = `cobweb-${Math.floor(buildRng() * 1e9).toString(36)}`;
  const entityId = generateEntityId('prop');
  const built = buildModel(COBWEB_BARRIER);
  const group = built.group;
  group.position.set(x, groundYAt(x, z), z);
  group.rotation.y = rotY;
  // Widen the curtain along its local X (the passage-crossing axis) before
  // rotY orients it. Scaled, not rebuilt, so the gossamer layering is kept.
  group.scale.x = widthM / COBWEB_BASE_WIDTH;
  scene.add(group);

  spawnEntity({ id: entityId, kind: 'prop', hp: { base: 1, current: 1 }, buffs: [], passives: [] });
  setEntityCombatStats(entityId, {});

  const dest: Destructible = {
    id,
    entityId,
    group,
    position: group.position,
    aimHeight: 1.1,            // chest-height curtain — aim the cone at the web
    collisionRadius: Math.max(0.9, widthM / 2 + 0.1),  // covers the whole opening for aim-assist
    // A big body sphere spanning the doorway curtain (centre on the X axis, so
    // the group's X-only stretch doesn't distort it). Same hit path as enemies.
    hurtbox: propHurtbox(group, 1.0, Math.max(0.9, widthM / 2 + 0.1)),
    hitFeedback: 'light',
    bloodAmount: 0,   // silk does not bleed
    alive: true,
    takeDamage(event: DamageEvent) {
      if (!dest.alive) return 0;
      const entity = getEntity(entityId);
      if (!entity || !entity.hp) return 0;
      const { applied } = computeDamage(event);
      entity.hp.current = Math.max(0, entity.hp.current - applied);
      if (entity.hp.current > 0) return applied;
      dest.alive = false;
      destroyEntity(entityId);
      clearEntityCombatStats(entityId);
      // Soft tear — a few pale shards (web tatters), no stone crunch.
      spawnShatterBurst(scene, group.position.x, group.position.y + 1.0, group.position.z, true);
      playEnemyDeath('small', group.position);
      onDestroyed?.();         // opens the passage
      // NO synchronous dispose — same two hazards as the vase path above:
      // pooled geometry is shared across props, and on WebGPU a fire-and-forget
      // frame may still reference the buffers ("used in submit while destroyed"
      // → device loss). GC reclaims the web's own geometry once the group
      // leaves the scene.
      scene.remove(group);
      return applied;
    },
  };
  return dest;
}

/** Release the ECS entity backing a destructible that's being torn down
 *  with the level (i.e. never smashed). Smashing already cleans up via
 *  takeDamage; this is the leftover-on-floor-exit path. Idempotent. */
export function disposeDestructible(dest: Destructible) {
  if (!dest.alive) return;
  dest.alive = false;
  destroyEntity(dest.entityId);
  clearEntityCombatStats(dest.entityId);
}

/** Spawn a CLUSTER of 2-4 vases around (x, z). Used by the 'V'
 *  (capital) tile so a level author can drop "vase corner" with
 *  one tile and get a believable group.
 *
 *  `onVaseDestroyed(idx)` fires when an individual vase in the
 *  cluster is destroyed — the caller uses the index to splice
 *  THAT vase's obstacle (the cluster pushes one obstacle per
 *  vase into the walkable region). */
export function spawnVaseCluster(
  scene: THREE.Object3D,
  x: number,
  z: number,
  onVaseDestroyed?: (idx: number) => void,
): Destructible[] {
  const target = buildRngInt(2, 4);   // 2-4
  const placed: Destructible[] = [];
  const positions: Array<{ x: number; z: number }> = [];
  const MIN_SEP = 0.32;
  for (let i = 0; i < target * 3 && placed.length < target; i++) {
    const ox = (buildRng() - 0.5) * 0.7;
    const oz = (buildRng() - 0.5) * 0.7;
    const px = x + ox;
    const pz = z + oz;
    let tooClose = false;
    for (const p of positions) {
      const dx = p.x - px;
      const dz = p.z - pz;
      if (dx * dx + dz * dz < MIN_SEP * MIN_SEP) { tooClose = true; break; }
    }
    if (tooClose) continue;
    positions.push({ x: px, z: pz });
    const idx = placed.length;
    placed.push(spawnVase(scene, px, pz, () => onVaseDestroyed?.(idx)));
  }
  return placed;
}

function pickVariant(): VaseVariant {
  const total = VASE_VARIANTS.reduce((s, v) => s + v.weight, 0);
  let r = buildRng() * total;
  for (const v of VASE_VARIANTS) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return VASE_VARIANTS[VASE_VARIANTS.length - 1];
}
