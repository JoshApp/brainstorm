import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { emit } from '../broadcast/event-bus';
import type { EnemySpec } from '../content/enemies';
import type { WalkableRegion } from '../level/walkable';
import {
  spawn as spawnEntity,
  destroy as destroyEntity,
  get as getEntity,
  generateEntityId,
} from '../ecs/world';
import type { EntityId } from '../ecs/types';
import { buildModel } from '../ecs/build-model';

// Enemy = a mob driven by its EnemySpec.
//
// Geometry/materials come from spec.model via buildModel(). This module owns
// only the behavior glue:
//   - AI state machine (chasing → winding → striking → recovering)
//   - Per-instance presentation state (hit flash, animated emissive)
//   - World-entity bookkeeping (HP lives in the world; effects can address it)
//
// Two nested groups:
//   - `container` handles world position + yaw (face-player lookAt)
//   - `model.group` (inside container) handles internal tilt animations
// This way the body lean during windup doesn't fight the lookAt.

type EnemyState = 'chasing' | 'winding' | 'striking' | 'recovering';

export interface Enemy {
  entityId: EntityId;
  group: THREE.Group;
  hitTargets: THREE.Object3D[];
  alive: boolean;
  hp: number;
  collisionRadius: number;
  takeDamage(amount: number): void;
  update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion): void;
  setDebugState(state: EnemyState, phaseTimer: number): void;
  setDebugPosition(x: number, z: number): void;
}

const tmpDir = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();

export function createEnemy(
  scene: THREE.Scene,
  position: THREE.Vector3,
  spec: EnemySpec,
): Enemy {
  // Container: world position + yaw to face player.
  const container = new THREE.Group();
  container.position.copy(position);

  // Built model: meshes + named parts + per-instance materials.
  const built = buildModel(spec.model);
  container.add(built.group);

  scene.add(container);

  // Look up the animation targets by name.
  const tiltPart = built.parts.get(spec.tiltPartName);
  const flashMat = built.materials.get(spec.flashMaterialName) as THREE.MeshStandardMaterial | undefined;
  const eyeMat   = built.materials.get(spec.eyeMaterialName)   as THREE.MeshStandardMaterial | undefined;

  // World entity (HP + buffs).
  const entityId = generateEntityId(`enemy-${spec.id}`);
  spawnEntity({
    id: entityId,
    kind: 'enemy',
    hp: { base: spec.hp, current: spec.hp },
    buffs: [],
    passives: [],
  });

  // Per-instance presentation state.
  let flashTimer = 0;
  const originalColor = flashMat ? flashMat.color.clone() : new THREE.Color();
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);
  const baseEyeEmissive = spec.baseEyeEmissive;

  let state: EnemyState = 'chasing';
  let phaseTimer = 0;
  let strikeAlreadyHit = false;
  let aliveLocal = true;

  function takeDamage(amount: number) {
    if (!aliveLocal) return;
    const entity = getEntity(entityId);
    if (!entity || !entity.hp) return;
    entity.hp.current = Math.max(0, entity.hp.current - amount);
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
    if (entity.hp.current <= 0) {
      aliveLocal = false;
      destroyEntity(entityId);
      scene.remove(container);
      emit({ type: 'enemy:killed' });
    }
  }

  function distToXZ(target: THREE.Vector3): number {
    const dx = container.position.x - target.x;
    const dz = container.position.z - target.z;
    return Math.hypot(dx, dz);
  }

  function faceTarget(target: THREE.Vector3) {
    tmpFlat.set(target.x, container.position.y, target.z);
    container.lookAt(tmpFlat);
  }

  function applyTilt(angle: number) {
    if (tiltPart) tiltPart.rotation.x = angle;
  }

  function setEyeEmissive(intensity: number) {
    if (eyeMat) eyeMat.emissiveIntensity = intensity;
  }

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion) {
    if (!aliveLocal) return;

    if (flashMat) {
      if (flashTimer > 0) {
        flashTimer -= dt;
        const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
        flashMat.color.copy(originalColor).lerp(flashColor, t);
      } else {
        flashMat.color.copy(originalColor);
      }
    }

    faceTarget(playerPos);
    const distance = distToXZ(playerPos);

    switch (state) {
      case 'chasing': {
        if (distance > spec.attackRange) {
          tmpDir.subVectors(playerPos, container.position);
          tmpDir.y = 0;
          tmpDir.normalize();
          const step = spec.moveSpeed * dt;
          const newX = container.position.x + tmpDir.x * step;
          const newZ = container.position.z + tmpDir.z * step;
          const resolved = walkable.clampMove(
            container.position.x, container.position.z,
            newX, newZ,
            spec.collisionRadius,
          );
          container.position.x = resolved.x;
          container.position.z = resolved.z;
        } else {
          state = 'winding';
          phaseTimer = 0;
          strikeAlreadyHit = false;
        }
        setEyeEmissive(baseEyeEmissive);
        applyTilt(0);
        break;
      }

      case 'winding': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / spec.windupTime);
        setEyeEmissive(baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * t);
        applyTilt(0.25 * t);
        if (phaseTimer >= spec.windupTime) {
          state = 'striking';
          phaseTimer = 0;
        }
        break;
      }

      case 'striking': {
        phaseTimer += dt;
        if (!strikeAlreadyHit && distance <= spec.strikeRange) {
          damagePlayer(spec.attackDamage);
          strikeAlreadyHit = true;
        }
        if (phaseTimer >= spec.strikeTime) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / spec.recoverTime);
        setEyeEmissive(THREE.MathUtils.lerp(baseEyeEmissive * 4.5, baseEyeEmissive, t));
        applyTilt(THREE.MathUtils.lerp(0.25, 0, t));
        if (phaseTimer >= spec.recoverTime) {
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }
    }
  }

  function setDebugState(s: EnemyState, t: number) {
    state = s;
    phaseTimer = t;
    strikeAlreadyHit = false;
    switch (s) {
      case 'chasing':
        setEyeEmissive(baseEyeEmissive);
        applyTilt(0);
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        setEyeEmissive(baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * f);
        applyTilt(0.25 * f);
        break;
      }
      case 'striking':
        setEyeEmissive(baseEyeEmissive * 4.5);
        applyTilt(0.25);
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        setEyeEmissive(THREE.MathUtils.lerp(baseEyeEmissive * 4.5, baseEyeEmissive, f));
        applyTilt(THREE.MathUtils.lerp(0.25, 0, f));
        break;
      }
    }
  }

  function setDebugPosition(x: number, z: number) {
    container.position.x = x;
    container.position.z = z;
  }

  return {
    entityId,
    group: container,
    hitTargets: built.hitTargets,
    collisionRadius: spec.collisionRadius,
    get alive() {
      return aliveLocal;
    },
    get hp() {
      const e = getEntity(entityId);
      return e?.hp?.current ?? 0;
    },
    takeDamage,
    update,
    setDebugState,
    setDebugPosition,
  };
}
