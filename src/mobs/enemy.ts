import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { emit } from '../broadcast/event-bus';
import type { EnemySpec } from '../content/enemies';
import { getStyle } from '../style';
import type { WalkableRegion } from '../level/walkable';
import { spawn as spawnEntity, destroy as destroyEntity, get as getEntity, generateEntityId } from '../ecs/world';
import type { EntityId } from '../ecs/types';

// Enemy = a mob driven by its EnemySpec (data, in src/content/enemies.ts).
// Per-instance state (AI state machine, hit flash timer) lives in this closure;
// shared/queryable state (HP, buffs) lives in the world entity record so that
// effects (apply-buff, heal, damage) can address it uniformly.

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
  const flatShading = getStyle() === 'flat';

  const group = new THREE.Group();
  group.position.copy(position);

  // Per-enemy materials (so each spec can have its own colors / variants).
  const bodyMat = new THREE.MeshStandardMaterial({
    color: spec.bodyColor,
    roughness: 0.95,
    metalness: 0.0,
    flatShading,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: spec.eyeColor,
    emissiveIntensity: spec.eyeEmissive,
    roughness: 1.0,
  });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(spec.capsuleRadius, spec.capsuleHeight, 4, 12),
    bodyMat,
  );
  body.position.y = spec.bodyHeightCenter;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(spec.headRadius, 16, 12), bodyMat);
  head.position.y = spec.headY;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  // Eyes — positioned at -Z (the front per Three.js convention)
  const eyeGeo = new THREE.SphereGeometry(spec.eyeRadius, 8, 6);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-spec.eyeSeparation, spec.eyeY, spec.eyeZ);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(spec.eyeSeparation, spec.eyeY, spec.eyeZ);
  group.add(rightEye);

  scene.add(group);

  // World entity (HP + buffs)
  const entityId = generateEntityId(`enemy-${spec.id}`);
  spawnEntity({
    id: entityId,
    kind: 'enemy',
    hp: { base: spec.hp, current: spec.hp },
    buffs: [],
    passives: [],
  });

  // Per-instance presentation state
  let flashTimer = 0;
  const originalColor = bodyMat.color.clone();
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);
  const baseEyeEmissive = spec.eyeEmissive;

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
      scene.remove(group);
      emit({ type: 'enemy:killed' });
    }
  }

  function distToXZ(target: THREE.Vector3): number {
    const dx = group.position.x - target.x;
    const dz = group.position.z - target.z;
    return Math.hypot(dx, dz);
  }

  function faceTarget(target: THREE.Vector3) {
    tmpFlat.set(target.x, group.position.y, target.z);
    group.lookAt(tmpFlat);
  }

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion) {
    if (!aliveLocal) return;

    if (flashTimer > 0) {
      flashTimer -= dt;
      const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
      bodyMat.color.copy(originalColor).lerp(flashColor, t);
    } else {
      bodyMat.color.copy(originalColor);
    }

    faceTarget(playerPos);
    const distance = distToXZ(playerPos);

    switch (state) {
      case 'chasing': {
        if (distance > spec.attackRange) {
          tmpDir.subVectors(playerPos, group.position);
          tmpDir.y = 0;
          tmpDir.normalize();
          const step = spec.moveSpeed * dt;
          const newX = group.position.x + tmpDir.x * step;
          const newZ = group.position.z + tmpDir.z * step;
          const resolved = walkable.clampMove(
            group.position.x, group.position.z,
            newX, newZ,
            spec.collisionRadius,
          );
          group.position.x = resolved.x;
          group.position.z = resolved.z;
        } else {
          state = 'winding';
          phaseTimer = 0;
          strikeAlreadyHit = false;
        }
        eyeMat.emissiveIntensity = baseEyeEmissive;
        group.rotation.x = 0;
        break;
      }

      case 'winding': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / spec.windupTime);
        eyeMat.emissiveIntensity = baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * t;
        group.rotation.x = 0.25 * t;
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
        eyeMat.emissiveIntensity = THREE.MathUtils.lerp(baseEyeEmissive * 4.5, baseEyeEmissive, t);
        group.rotation.x = THREE.MathUtils.lerp(0.25, 0, t);
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
        eyeMat.emissiveIntensity = baseEyeEmissive;
        group.rotation.x = 0;
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        eyeMat.emissiveIntensity = baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * f;
        group.rotation.x = 0.25 * f;
        break;
      }
      case 'striking':
        eyeMat.emissiveIntensity = baseEyeEmissive * 4.5;
        group.rotation.x = 0.25;
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        eyeMat.emissiveIntensity = THREE.MathUtils.lerp(baseEyeEmissive * 4.5, baseEyeEmissive, f);
        group.rotation.x = THREE.MathUtils.lerp(0.25, 0, f);
        break;
      }
    }
  }

  function setDebugPosition(x: number, z: number) {
    group.position.x = x;
    group.position.z = z;
  }

  return {
    entityId,
    group,
    hitTargets: [body, head],
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
