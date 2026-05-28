import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { VASE_TALL, VASE_SQUAT } from '../content/vase';
import { spawnGoldCoins } from '../effects/gold-coins';
import { createPickup } from '../interactables/pickup';
import { ITEMS } from '../content/items';
import { playEnemyDeath } from '../audio/sfx';

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

/** Spawn a vase destructible at world (x, z). Random variant
 *  + random rotation. */
export function spawnVase(
  scene: THREE.Object3D,
  x: number,
  z: number,
): Destructible {
  const id = `vase-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const isTall = Math.random() < 0.5;
  const model = isTall ? VASE_TALL : VASE_SQUAT;
  const built = buildModel(model);
  const group = built.group;
  group.position.set(x, 0, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);

  const tmpDropPos = new THREE.Vector3();

  const dest: Destructible = {
    id,
    group,
    position: group.position,
    collisionRadius: 0.18,
    hp: 2,
    alive: true,
    takeDamage(amount, _hitPoint) {
      if (!dest.alive) return 0;
      dest.hp -= amount;
      if (dest.hp > 0) return amount;
      // Destroyed.
      dest.alive = false;
      playEnemyDeath('small');
      // Roll loot.
      const dropY = 0.25;
      tmpDropPos.set(group.position.x, dropY, group.position.z);
      if (Math.random() < VASE_GOLD_CHANCE) {
        const amt = VASE_GOLD_MIN + Math.floor(Math.random() * (VASE_GOLD_MAX - VASE_GOLD_MIN + 1));
        spawnGoldCoins(scene, tmpDropPos, amt);
      }
      if (Math.random() < VASE_POTION_CHANCE) {
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
