import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { emit } from '../broadcast/event-bus';
import type { StyleMaterials } from '../style/materials';
import type { WalkableRegion } from '../level/walkable';

// First mob: capsule body + sphere head + emissive eyes.
// State machine:
//   chasing  → walk toward the player at ENEMY_MOVE_SPEED (with collision)
//   winding  → in attack range; eyes flare and body tilts forward (TELEGRAPH)
//   striking → lunge forward; hit window — distance check fires once
//   recovering → can't attack again; player can retreat or counter-strike
//
// Movement is constrained by the WalkableRegion so the enemy can no longer
// walk through walls or pillars (fixes the "enemy disappears" bug — it was
// chasing into geometry and ending up behind walls in fog).

type EnemyState = 'chasing' | 'winding' | 'striking' | 'recovering';

const ENEMY_RADIUS = 0.45;

export interface Enemy {
  group: THREE.Group;
  hitTargets: THREE.Object3D[];
  alive: boolean;
  hp: number;
  takeDamage(amount: number): void;
  /** Called each frame with the player's world position + walkable region. */
  update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion): void;
  /** Debug-only: jump to a specific AI state + phase timer, apply visuals. */
  setDebugState(state: EnemyState, phaseTimer: number): void;
  /** Debug-only: teleport without collision check. */
  setDebugPosition(x: number, z: number): void;
}

const tmpDir = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3, materials: StyleMaterials): Enemy {
  const group = new THREE.Group();
  group.position.copy(position);

  const bodyMat = materials.enemyBody;
  const eyeMat = materials.enemyEye;
  const baseEyeEmissive = eyeMat.emissiveIntensity;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 12), bodyMat);
  body.position.y = 0.8;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), bodyMat);
  head.position.y = 1.5;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  // Eyes positioned at z = -0.24 (the FRONT of the capsule per Three.js convention
  // where -Z is forward). lookAt() makes -Z point at the target, so eyes face
  // the target with no extra rotation needed.
  const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.08, 1.52, -0.24);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.08, 1.52, -0.24);
  group.add(rightEye);

  scene.add(group);

  // --- Hit-flash on damage taken ---
  let flashTimer = 0;
  const originalColor = bodyMat.color.clone();
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);

  // --- AI state machine ---
  let state: EnemyState = 'chasing';
  let phaseTimer = 0;
  let strikeAlreadyHit = false;

  const meshState = {
    alive: true,
    hp: CONFIG.ENEMY_HP,
  };

  function takeDamage(amount: number) {
    if (!meshState.alive) return;
    meshState.hp -= amount;
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
    if (meshState.hp <= 0) {
      meshState.alive = false;
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
    // (No extra rotation flip — eyes at z=-0.24 are forward per Three.js convention.)
  }

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion) {
    if (!meshState.alive) return;

    // Hit-flash decay (independent of AI state)
    if (flashTimer > 0) {
      flashTimer -= dt;
      const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
      bodyMat.color.copy(originalColor).lerp(flashColor, t);
    } else {
      bodyMat.color.copy(originalColor);
    }

    // Always face the player (looks dumb if you sidestep otherwise)
    faceTarget(playerPos);

    const distance = distToXZ(playerPos);

    switch (state) {
      case 'chasing': {
        if (distance > CONFIG.ENEMY_ATTACK_RANGE) {
          tmpDir.subVectors(playerPos, group.position);
          tmpDir.y = 0;
          tmpDir.normalize();
          const step = CONFIG.ENEMY_MOVE_SPEED * dt;
          const newX = group.position.x + tmpDir.x * step;
          const newZ = group.position.z + tmpDir.z * step;
          // Apply walkable-region collision so the enemy can't ghost through
          // walls or pillars while chasing.
          const resolved = walkable.clampMove(
            group.position.x, group.position.z,
            newX, newZ,
            ENEMY_RADIUS,
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
        const t = Math.min(1, phaseTimer / CONFIG.ENEMY_WINDUP_TIME);
        eyeMat.emissiveIntensity = baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * t;
        group.rotation.x = 0.25 * t;
        if (phaseTimer >= CONFIG.ENEMY_WINDUP_TIME) {
          state = 'striking';
          phaseTimer = 0;
        }
        break;
      }

      case 'striking': {
        phaseTimer += dt;
        if (!strikeAlreadyHit && distance <= CONFIG.ENEMY_STRIKE_RANGE) {
          damagePlayer(CONFIG.ENEMY_ATTACK_DAMAGE);
          strikeAlreadyHit = true;
        }
        if (phaseTimer >= CONFIG.ENEMY_STRIKE_TIME) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / CONFIG.ENEMY_RECOVER_TIME);
        eyeMat.emissiveIntensity = THREE.MathUtils.lerp(baseEyeEmissive * 4.5, baseEyeEmissive, t);
        group.rotation.x = THREE.MathUtils.lerp(0.25, 0, t);
        if (phaseTimer >= CONFIG.ENEMY_RECOVER_TIME) {
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
    // Apply state-appropriate visuals immediately so freeze+screenshot
    // captures the right pose without needing an update tick.
    switch (s) {
      case 'chasing':
        eyeMat.emissiveIntensity = baseEyeEmissive;
        group.rotation.x = 0;
        break;
      case 'winding': {
        const f = Math.min(1, t / CONFIG.ENEMY_WINDUP_TIME);
        eyeMat.emissiveIntensity = baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * f;
        group.rotation.x = 0.25 * f;
        break;
      }
      case 'striking':
        eyeMat.emissiveIntensity = baseEyeEmissive * 4.5;
        group.rotation.x = 0.25;
        break;
      case 'recovering': {
        const f = Math.min(1, t / CONFIG.ENEMY_RECOVER_TIME);
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
    group,
    hitTargets: [body, head],
    get alive() {
      return meshState.alive;
    },
    get hp() {
      return meshState.hp;
    },
    takeDamage,
    update,
    setDebugState,
    setDebugPosition,
  };
}
