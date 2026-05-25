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

  // Look up the animation targets by name. tiltPart can be either a named
  // part OR a slot (slots are pure anchors useful when an enemy has a 'rig'
  // group holding everything that should tilt together).
  const tiltPart = built.parts.get(spec.tiltPartName) ?? built.slots.get(spec.tiltPartName);
  const flashMat = built.materials.get(spec.flashMaterialName) as THREE.MeshStandardMaterial | undefined;
  const eyeMat   = built.materials.get(spec.eyeMaterialName)   as THREE.MeshStandardMaterial | undefined;

  // Windup telegraph: the eyes blaze brighter and shift toward red as the
  // enemy commits to a strike. The body itself does NOT change color — the
  // in-world feel stays grim/coherent. Motion (tilt + lift) + the eye flare
  // are the two cues.
  const eyeBaseColor = eyeMat ? eyeMat.emissive.clone() : new THREE.Color(0xff5500);
  const eyeWindupColor = new THREE.Color(0xff1505);  // hot red at peak windup
  const tmpEyeColor = new THREE.Color();
  function setEyeFlare(t: number) {
    // t in [0, 1] = neutral to full windup. Mutate eye intensity + tint.
    if (!eyeMat) return;
    eyeMat.emissiveIntensity = baseEyeEmissive * (1 + 7 * t);
    tmpEyeColor.copy(eyeBaseColor).lerp(eyeWindupColor, t);
    eyeMat.emissive.copy(tmpEyeColor);
  }

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
  // Per-cycle randomized windup duration so multiple enemies attacking in
  // unison de-synchronize over time (otherwise stacked mobs all strike on
  // the exact same frame and the player has no rhythm to read).
  let currentWindupTime = spec.windupTime;
  function rollWindupTime() {
    currentWindupTime = spec.windupTime * (0.78 + Math.random() * 0.44);  // ±22%
  }
  rollWindupTime();

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
  // (setEyeFlare lives above — combines intensity ramp + color shift.)

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
          rollWindupTime();
        }
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'winding': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / currentWindupTime);
        // Eye flare: ramp baseline → 8x intensity + color shift toward
        // hot red. With the eyes now POPPED OUT of the head and parented
        // to the body, this is highly visible.
        setEyeFlare(t);
        // Body lean: 29° forward at peak. Head + eyes follow via parenting.
        applyTilt(0.5 * t);
        // Upward lift — model rises ~10cm during windup ("rearing back"
        // motion). Adds a clear vertical movement cue on top of the lean.
        built.group.position.y = 0.10 * t;
        if (phaseTimer >= currentWindupTime) {
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
        // Slam past neutral on the strike (follow-through). Eyes blaze at peak.
        applyTilt(-0.25);
        built.group.position.y = 0;
        setEyeFlare(1);
        if (phaseTimer >= spec.strikeTime) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / spec.recoverTime);
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, t));
        // Eye flare fades back to baseline over the recovery.
        setEyeFlare(1 - t);
        built.group.position.y = 0;
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
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        setEyeFlare(f);
        applyTilt(0.5 * f);
        built.group.position.y = 0.10 * f;
        break;
      }
      case 'striking':
        setEyeFlare(1);
        applyTilt(-0.25);
        built.group.position.y = 0;
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        setEyeFlare(1 - f);
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, f));
        built.group.position.y = 0;
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
