import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';

// Blood burst — short-lived spray of red additive sprites + a few
// chunky droplet meshes. Used by the blood-altar take effect (the
// price for the cursed offering paid in front of the player's eyes).
//
// Lives in its own pool with a single tick + clear like the
// shatter-burst module; main.ts drives the tick.

interface Drop {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  rvx: number; rvy: number; rvz: number;
  age: number;
  life: number;
}

interface Sprite {
  sprite: THREE.Sprite;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  baseSize: number;
}

const drops: Drop[] = [];
const sprites: Sprite[] = [];

const GRAVITY = -9.0;
const FLOOR_Y = 0.03;

// Shared materials — kept module-local so all bursts can reuse the
// same WebGL programs.
let dropMat: THREE.MeshStandardMaterial | null = null;
let spriteMat: THREE.SpriteMaterial | null = null;

function ensureMats() {
  if (!dropMat) {
    dropMat = new THREE.MeshStandardMaterial({
      color: 0x3a0506,
      roughness: 0.4,
      metalness: 0.0,
      emissive: 0x5a0204,
      emissiveIntensity: 1.6,
      fog: false,
      flatShading: 'flat',
    });
  }
  if (!spriteMat) {
    spriteMat = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: 0xc02014,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
}

/** Fire a burst at the given world position. Typical use: blood
 *  altar take. Defaults read as a chest-height splatter ~0.7m above
 *  the floor (call site can override Y for higher offerings). */
export function spawnBloodBurst(scene: THREE.Object3D, x: number, y: number, z: number) {
  ensureMats();

  // Heavy droplets — physical-ish chunks that arc and land.
  const dropCount = 14 + Math.floor(Math.random() * 6);
  for (let i = 0; i < dropCount; i++) {
    const r = 0.02 + Math.random() * 0.022;
    const geo = new THREE.SphereGeometry(r, 6, 5);
    const mesh = new THREE.Mesh(geo, dropMat!);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
    const angle = Math.random() * Math.PI * 2;
    const horSpeed = 1.6 + Math.random() * 1.6;
    const upSpeed  = 2.0 + Math.random() * 1.6;
    drops.push({
      mesh,
      vx: Math.cos(angle) * horSpeed,
      vy: upSpeed,
      vz: Math.sin(angle) * horSpeed,
      rvx: (Math.random() - 0.5) * 14,
      rvy: (Math.random() - 0.5) * 14,
      rvz: (Math.random() - 0.5) * 14,
      age: 0,
      life: 0.9 + Math.random() * 0.4,
    });
  }

  // Bright additive sprites — the visible "spray." Larger spread,
  // shorter life than the droplets so the effect peaks fast.
  const spriteCount = 10;
  for (let i = 0; i < spriteCount; i++) {
    const sprite = new THREE.Sprite(spriteMat!);
    const baseSize = 0.22 + Math.random() * 0.16;
    sprite.scale.set(baseSize, baseSize, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.08, y, z + (Math.random() - 0.5) * 0.08);
    scene.add(sprite);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.6 + Math.random() * 0.8;
    sprites.push({
      sprite,
      vx: Math.cos(angle) * speed,
      vy: 0.6 + Math.random() * 0.8,
      vz: Math.sin(angle) * speed,
      age: 0,
      life: 0.45 + Math.random() * 0.25,
      baseSize,
    });
  }
}

export function tickBloodBurst(dt: number) {
  // Droplets — arc, fall, land, despawn.
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.vy += GRAVITY * dt;
    d.mesh.position.x += d.vx * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.position.z += d.vz * dt;
    d.mesh.rotation.x += d.rvx * dt;
    d.mesh.rotation.y += d.rvy * dt;
    d.mesh.rotation.z += d.rvz * dt;
    if (d.mesh.position.y < FLOOR_Y && d.vy < 0) {
      d.mesh.position.y = FLOOR_Y;
      d.vy *= -0.25;
      d.vx *= 0.6;
      d.vz *= 0.6;
    }
    d.age += dt;
    if (d.age >= d.life) {
      d.mesh.parent?.remove(d.mesh);
      d.mesh.geometry.dispose();
      drops.splice(i, 1);
    }
  }

  // Sprites — drift outward, scale up, fade, despawn.
  for (let i = sprites.length - 1; i >= 0; i--) {
    const s = sprites[i];
    s.vy += GRAVITY * 0.35 * dt;       // softer gravity than droplets
    s.sprite.position.x += s.vx * dt;
    s.sprite.position.y += s.vy * dt;
    s.sprite.position.z += s.vz * dt;
    s.age += dt;
    const t = s.age / s.life;
    const scale = s.baseSize * (1 + t * 1.2);
    s.sprite.scale.set(scale, scale, 1);
    if (s.age >= s.life) {
      s.sprite.parent?.remove(s.sprite);
      sprites.splice(i, 1);
    }
  }

  // Shared opacity tail — fade ALL active sprites together based on the
  // youngest age in the active set. Quick + cheap and avoids
  // per-sprite material clones.
  if (sprites.length > 0 && spriteMat) {
    let youngestT = 1;
    for (const s of sprites) {
      const t = s.age / s.life;
      if (t < youngestT) youngestT = t;
    }
    spriteMat.opacity = 0.95 * (1 - youngestT * 0.6);
  } else if (spriteMat) {
    spriteMat.opacity = 0.95;
  }
}

export function clearBloodBurst() {
  for (const d of drops) {
    d.mesh.parent?.remove(d.mesh);
    d.mesh.geometry.dispose();
  }
  drops.length = 0;
  for (const s of sprites) s.sprite.parent?.remove(s.sprite);
  sprites.length = 0;
}
