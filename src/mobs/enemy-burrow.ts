// The burrow ambush (spec.burrowed).
//
// A burrowed enemy starts BURIED: the built model sits below the floor
// (invisible) and a small dirt mound marks the spot. When the player walks
// within triggerDistance, the model rises smoothly to y=0 and the mound
// shrinks away; afterward it is a normal melee predator. While buried or
// emerging the enemy is invulnerable and inert — perception, AI and
// takeDamage all early-return on `!surfaced`.
//
// Split out of createEnemy (Phase 3, docs/OPEN-ITEMS.md). Pinned by
// tests/enemy-golden.test.ts (the burrower spec).

import * as THREE from 'three';
import type { EnemySpec } from '../content/enemies';
import type { BuiltModel } from '../ecs/build-model';

const BURROW_DEPTH = -1.6;

export interface EnemyBurrow {
  /** Out of the ground: targetable, perceiving, acting. Always true for a
   *  spec that doesn't burrow. */
  readonly surfaced: boolean;
  /** Watch for the player while buried, rise while emerging. True while the
   *  enemy is still underground or mid-burst: skip everything else this frame. */
  tick(dt: number, playerPos: THREE.Vector3): boolean;
}

export function createEnemyBurrow(
  spec: EnemySpec,
  built: BuiltModel,
  container: THREE.Group,
  /** The floor blob shadow: hidden while buried, revealed on surfacing. */
  blob: THREE.Object3D,
): EnemyBurrow {
  let state: 'buried' | 'emerging' | 'surfaced' = spec.burrowed ? 'buried' : 'surfaced';
  let timer = 0;
  let mound: THREE.Group | null = null;
  if (state === 'buried') {
    // Drop the creature below the floor.
    built.group.position.y = BURROW_DEPTH;
    // Build a small dirt-mound tell at the spawn spot. Short jittered cones
    // clustered together so it reads as disturbed earth, not a perfect dome.
    // Earth-brown matte; faint emissive so it's just a hair visible against
    // the dark floor in gameplay lighting.
    mound = new THREE.Group();
    const moundMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f14, roughness: 1.0,
      emissive: 0x0a0604, emissiveIntensity: 0.5,
      flatShading: true,
    });
    for (const off of [[0, 0, 0], [0.10, 0, 0.08], [-0.08, 0, 0.05], [0.02, 0, -0.10]] as const) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.08, 6), moundMat);
      cone.position.set(off[0], 0.04, off[2]);
      cone.rotation.y = Math.random() * Math.PI;
      mound.add(cone);
    }
    container.add(mound);
  }

  function tick(dt: number, playerPos: THREE.Vector3): boolean {
    if (state === 'buried') {
      // The ONLY thing a buried enemy watches is the player's distance to
      // the burrow spot. When close enough, flip to emerging.
      const dx = playerPos.x - container.position.x;
      const dz = playerPos.z - container.position.z;
      const trigger = spec.burrowed!.triggerDistance;
      if (dx * dx + dz * dz < trigger * trigger) {
        state = 'emerging';
        timer = 0;
      }
      return true;
    }
    if (state === 'emerging') {
      // Ease-out rise from BURROW_DEPTH to 0, plus a quick mound-shrink so the
      // dirt visibly bursts apart. emergeTime is short (~0.4s) so the motion
      // reads as an ambush, not a slow elevator.
      timer += dt;
      const t = Math.min(1, timer / spec.burrowed!.emergeTime);
      const ease = 1 - (1 - t) * (1 - t);
      built.group.position.y = BURROW_DEPTH * (1 - ease);
      if (mound) {
        const s = Math.max(0, 1 - t * 1.4);
        mound.scale.setScalar(s);
        if (s <= 0) {
          container.remove(mound);
          mound = null;
        }
      }
      if (t >= 1) {
        state = 'surfaced';
        built.group.position.y = 0;
        blob.visible = true;   // grounded now — reveal the contact shadow
      }
      return true;
    }
    return false;
  }

  return {
    get surfaced() { return state === 'surfaced'; },
    tick,
  };
}
