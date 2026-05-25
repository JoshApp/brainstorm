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

  // Windup telegraph: the body material gains an emissive glow that ramps up
  // during winding and fades during recovery. This is the dominant visual
  // tell — "the whole enemy lights up red about to strike" — readable from
  // anywhere in the room on a phone screen. We mutate emissive on the body
  // material; saving original values to restore between cycles.
  const windupColor = new THREE.Color(0xff2010);
  const bodyOriginalEmissive = flashMat ? flashMat.emissive.clone() : new THREE.Color(0x000000);
  const bodyOriginalEmissiveIntensity = flashMat?.emissiveIntensity ?? 0;
  function setWindupGlow(t: number) {
    // t in [0, 1] = no glow to full glow. Set body emissive directly.
    if (!flashMat) return;
    if (t <= 0) {
      flashMat.emissive.copy(bodyOriginalEmissive);
      flashMat.emissiveIntensity = bodyOriginalEmissiveIntensity;
    } else {
      flashMat.emissive.copy(windupColor);
      flashMat.emissiveIntensity = bodyOriginalEmissiveIntensity + 1.4 * t;
    }
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
        setEyeEmissive(baseEyeEmissive);
        applyTilt(0);
        setWindupGlow(0);
        built.group.position.y = 0;
        break;
      }

      case 'winding': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / currentWindupTime);
        // Eye flare: ramp baseline → 6x intensity over the windup.
        setEyeEmissive(baseEyeEmissive * (1 + 5 * t));
        // Body lean: 29° forward at peak.
        applyTilt(0.5 * t);
        // BODY EMISSIVE GLOW — the dominant telegraph. The whole enemy
        // lights up red over the windup, readable from across the room.
        setWindupGlow(t);
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
        // During the strike, the body slams down past neutral (-15°) for a
        // brief "follow-through" instead of staying at peak windup tilt.
        applyTilt(-0.25);
        built.group.position.y = 0;  // slammed back down
        setWindupGlow(1);  // keep the glow burning during the actual strike
        if (phaseTimer >= spec.strikeTime) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / spec.recoverTime);
        setEyeEmissive(THREE.MathUtils.lerp(baseEyeEmissive * 6, baseEyeEmissive, t));
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, t));
        // Glow fades over the recovery — the enemy "cools down."
        setWindupGlow(1 - t);
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
        setEyeEmissive(baseEyeEmissive);
        applyTilt(0);
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        setEyeEmissive(baseEyeEmissive * (1 + 5 * f));
        applyTilt(0.5 * f);
        setWindupGlow(f);
        built.group.position.y = 0.10 * f;
        break;
      }
      case 'striking':
        setEyeEmissive(baseEyeEmissive * 6);
        applyTilt(-0.25);
        setWindupGlow(1);
        built.group.position.y = 0;
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        setEyeEmissive(THREE.MathUtils.lerp(baseEyeEmissive * 6, baseEyeEmissive, f));
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, f));
        setWindupGlow(1 - f);
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
