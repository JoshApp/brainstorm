import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';

// First mob: capsule body + sphere head + emissive eyes.
// State machine:
//   chasing  → walk toward the player at ENEMY_MOVE_SPEED
//   winding  → in attack range; eyes flare and body tilts forward (TELEGRAPH)
//   striking → lunge forward; hit window — distance check fires once
//   recovering → can't attack again; player can retreat or counter-strike
//
// Damage to player happens via damagePlayer() during the strike phase, one hit
// per strike. Enemy hit-flashes white briefly on taking damage from the player.

type EnemyState = 'chasing' | 'winding' | 'striking' | 'recovering';

export interface Enemy {
  group: THREE.Group;
  hitTargets: THREE.Object3D[];  // meshes the player's raycaster tests against
  alive: boolean;
  hp: number;
  takeDamage(amount: number): void;
  /** Called each frame with the player's world position. */
  update(dt: number, playerPos: THREE.Vector3): void;
}

const tmpDir = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3): Enemy {
  const group = new THREE.Group();
  group.position.copy(position);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: CONFIG.ENEMY_COLOR,
    roughness: 0.95,
    metalness: 0.0,
  });

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

  const baseEyeEmissive = 1.6;
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: CONFIG.ENEMY_EYE_COLOR,
    emissiveIntensity: baseEyeEmissive,
    roughness: 1.0,
  });
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
  const originalColor = new THREE.Color(CONFIG.ENEMY_COLOR);
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
    // capsule's "front" is +Z by default; we want body facing the player,
    // so eyes (positioned at -0.24 z) need to point AT the player → rotate 180°
    group.rotation.y += Math.PI;
  }

  function update(dt: number, playerPos: THREE.Vector3) {
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
        // Walk toward player on XZ plane
        if (distance > CONFIG.ENEMY_ATTACK_RANGE) {
          tmpDir.subVectors(playerPos, group.position);
          tmpDir.y = 0;
          tmpDir.normalize();
          group.position.addScaledVector(tmpDir, CONFIG.ENEMY_MOVE_SPEED * dt);
        } else {
          state = 'winding';
          phaseTimer = 0;
          strikeAlreadyHit = false;
        }
        // Eyes settle to baseline
        eyeMat.emissiveIntensity = baseEyeEmissive;
        group.rotation.x = 0;
        break;
      }

      case 'winding': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / CONFIG.ENEMY_WINDUP_TIME);
        // TELEGRAPH: eyes flare to ~4x baseline, body tilts forward
        eyeMat.emissiveIntensity = baseEyeEmissive + (4.5 - 1) * baseEyeEmissive * t;
        group.rotation.x = 0.25 * t; // pitch forward
        if (phaseTimer >= CONFIG.ENEMY_WINDUP_TIME) {
          state = 'striking';
          phaseTimer = 0;
        }
        break;
      }

      case 'striking': {
        phaseTimer += dt;
        // Hit check fires once, only if player still in strike range
        if (!strikeAlreadyHit && distance <= CONFIG.ENEMY_STRIKE_RANGE) {
          damagePlayer(CONFIG.ENEMY_ATTACK_DAMAGE);
          strikeAlreadyHit = true;
        }
        // Visual: hold the wound-up lean for the strike duration
        if (phaseTimer >= CONFIG.ENEMY_STRIKE_TIME) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        phaseTimer += dt;
        // Settle eyes + body back toward neutral
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
  };
}
