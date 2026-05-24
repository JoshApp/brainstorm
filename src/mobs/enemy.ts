import * as THREE from 'three';
import { CONFIG } from '../config';

// First mob: capsule body + sphere head. Stands at spawn for now (no AI yet
// per CLAUDE.md Phase 2 — we'll add approach/attack behavior next). Has HP,
// takes damage, hit-flashes white briefly, vanishes on death.
//
// Eyes are emissive so the silhouette is still visible against the dark when
// the torch flicker dims.

export interface Enemy {
  group: THREE.Group;
  hitTargets: THREE.Object3D[];  // meshes the raycaster should test against
  alive: boolean;
  hp: number;
  takeDamage(amount: number): void;
  update(dt: number): void;
}

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3): Enemy {
  const group = new THREE.Group();
  group.position.copy(position);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: CONFIG.ENEMY_COLOR,
    roughness: 0.95,
    metalness: 0.0,
  });

  // Body — capsule, eye-level a bit shorter than the player
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 12), bodyMat);
  body.position.y = 0.8;  // center the capsule above the floor
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Head — sphere on top of body
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), bodyMat);
  head.position.y = 1.5;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  // Eyes — two small emissive spheres on the head, facing -Z (initial facing)
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: CONFIG.ENEMY_EYE_COLOR,
    emissiveIntensity: 1.6,
    roughness: 1.0,
    fog: true,
  });
  const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.08, 1.52, -0.24);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.08, 1.52, -0.24);
  group.add(rightEye);

  scene.add(group);

  // Hit-flash state — temporarily swap body color to a bright value on damage.
  let flashTimer = 0;
  const originalColor = new THREE.Color(CONFIG.ENEMY_COLOR);
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);

  const state = {
    alive: true,
    hp: CONFIG.ENEMY_HP,
  };

  function takeDamage(amount: number) {
    if (!state.alive) return;
    state.hp -= amount;
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
    if (state.hp <= 0) {
      state.alive = false;
      // Drop dead — for prototype, just remove. Later: fall, fade, leave corpse.
      scene.remove(group);
    }
  }

  function update(dt: number) {
    if (!state.alive) return;
    if (flashTimer > 0) {
      flashTimer -= dt;
      const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
      bodyMat.color.copy(originalColor).lerp(flashColor, t);
    } else {
      bodyMat.color.copy(originalColor);
    }
  }

  return {
    group,
    hitTargets: [body, head],
    get alive() {
      return state.alive;
    },
    get hp() {
      return state.hp;
    },
    takeDamage,
    update,
  };
}
