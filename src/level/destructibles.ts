import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { VASE_TALL, VASE_SQUAT, VASE_FLASK, VASE_BROKEN } from '../content/vase';
import { spawnGoldCoins } from '../effects/gold-coins';
import { createPickup } from '../interactables/pickup';
import { ITEMS } from '../content/items';
import { playEnemyDeath } from '../audio/sfx';
import { spawnShatterBurst } from '../effects/shatter-burst';

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

export interface Destructible {
  id: string;
  group: THREE.Group;
  /** World position of the destructible's centre — combat uses
   *  this for cone + range checks. Aliased with group.position. */
  position: THREE.Vector3;
  /** Half-extent for the combat cone's "is it pointing at this"
   *  test. Vases are small (~0.18m). */
  collisionRadius: number;
  hp: number;
  alive: boolean;
  /** Take a damage value. Returns the applied damage (== given
   *  for now — no armour on destructibles). */
  takeDamage(amount: number, hitPoint: THREE.Vector3): number;
}

// Loot table for vases.
const VASE_GOLD_CHANCE = 0.50;     // 50% drop SOME gold
const VASE_POTION_CHANCE = 0.04;   // 4% drop a healing potion
const VASE_GOLD_MIN = 1;
const VASE_GOLD_MAX = 3;

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
  const variant = pickVariant();
  const built = buildModel(variant.model);
  const group = built.group;
  group.position.set(x, 0, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  // Scale jitter — 90-115% so vases in a cluster don't all read
  // the same height.
  const s = 0.90 + Math.random() * 0.25;
  group.scale.set(s, s, s);
  scene.add(group);
  const isBroken = !!variant.broken;

  const tmpDropPos = new THREE.Vector3();

  const dest: Destructible = {
    id,
    group,
    position: group.position,
    collisionRadius: 0.18,
    // Plain vases shatter in ONE hit — they're flavour clutter, not
    // a fight. Any sturdier breakable (a reinforced crate, a sealed
    // urn) that wants to take multiple swings should be its own
    // destructible with a higher hp; the default is one-and-done.
    hp: 1,
    alive: true,
    takeDamage(amount, _hitPoint) {
      if (!dest.alive) return 0;
      dest.hp -= amount;
      if (dest.hp > 0) return amount;
      // Destroyed.
      dest.alive = false;
      // Spawn the shatter burst before removing the mesh so we
      // have a position reference; the burst lives on its own
      // pool ticked from main.ts.
      spawnShatterBurst(scene, group.position.x, group.position.y + 0.20, group.position.z, isBroken);
      // Tell the builder/runtime to splice this vase's
      // obstacle out of the walkable region — without this, the
      // player can't walk through the smashed cell.
      onDestroyed?.();
      playEnemyDeath('small');
      // Roll loot. Pre-broken vases drop a small amount of dust
      // rather than coins — visually they were already smashed,
      // so the "reward" should match.
      const goldChance  = isBroken ? VASE_GOLD_CHANCE * 0.25 : VASE_GOLD_CHANCE;
      const potionChance = isBroken ? 0 : VASE_POTION_CHANCE;
      const dropY = 0.25;
      tmpDropPos.set(group.position.x, dropY, group.position.z);
      if (Math.random() < goldChance) {
        const amt = VASE_GOLD_MIN + Math.floor(Math.random() * (VASE_GOLD_MAX - VASE_GOLD_MIN + 1));
        spawnGoldCoins(scene, tmpDropPos, amt);
      }
      if (Math.random() < potionChance) {
        const potion = ITEMS['healing-potion'];
        if (potion) {
          const launchVel = new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            2.4,
            (Math.random() - 0.5) * 1.2,
          );
          createPickup(scene, tmpDropPos.clone(), potion, { velocity: launchVel });
        }
      }
      // Remove from scene next frame (after caller sees alive=false).
      // Disposing geometries: walk the model group.
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
      scene.remove(group);
      return amount;
    },
  };
  return dest;
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
  const target = 2 + Math.floor(Math.random() * 3);   // 2-4
  const placed: Destructible[] = [];
  const positions: Array<{ x: number; z: number }> = [];
  const MIN_SEP = 0.32;
  for (let i = 0; i < target * 3 && placed.length < target; i++) {
    const ox = (Math.random() - 0.5) * 0.7;
    const oz = (Math.random() - 0.5) * 0.7;
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
  let r = Math.random() * total;
  for (const v of VASE_VARIANTS) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return VASE_VARIANTS[VASE_VARIANTS.length - 1];
}
