import * as THREE from 'three';
import { registerWarmup } from '../content/warmup-registry';
import { getTexture } from '../style/procedural-textures';

// Parry spark — the steel-on-steel CLASH at the point where a parry catches a
// strike. Where blood is wet and dust is heavy, this is HOT and instant: a
// bright white-gold flash plus a spray of fast spark streaks that arc out and
// die in a fraction of a second. Additive (it GLOWS — a flash of struck metal),
// unlike the occluding dust puff.
//
// Same pool shape as blood-burst / dust-puff: one tick + clear, the main loop
// drives the tick. Spawned at the clash world point by the parry resolution.

interface Spark {
  sprite: THREE.Sprite;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  baseSize: number;
}

const sparks: Spark[] = [];
let flash: { sprite: THREE.Sprite; age: number; life: number; baseSize: number } | null = null;

const GRAVITY = -7.0;   // sparks arc down a touch as they fly

// Shared materials — one WebGL program for all sparks + the flash.
let sparkMat: THREE.SpriteMaterial | null = null;
let flashMat: THREE.SpriteMaterial | null = null;
function ensureMats() {
  if (!sparkMat) {
    sparkMat = new THREE.SpriteMaterial({
      map: getTexture('moonbeam'),   // neutral white radial — tint carries the colour
      color: 0xffe8a8,               // white-gold struck-steel
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
  }
  if (!flashMat) {
    flashMat = new THREE.SpriteMaterial({
      map: getTexture('moonbeam'),
      color: 0xfffbe6,               // near-white hot core
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
  }
}

/** Fire a clash spark at a world position (the point where the parry connects). */
export function spawnParrySpark(scene: THREE.Object3D, x: number, y: number, z: number) {
  ensureMats();

  // Central flash — a single bright bloom that snaps big then vanishes.
  if (!flash) {
    const sprite = new THREE.Sprite(flashMat!);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(0.2);
    scene.add(sprite);
    flash = { sprite, age: 0, life: 0.14, baseSize: 0.55 };
  } else {
    flash.sprite.position.set(x, y, z);
    flash.age = 0;
  }

  // Spark streaks — a spray flung outward, biased slightly upward (struck
  // sparks fountain up before gravity takes them).
  const count = 12 + Math.floor(Math.random() * 6);
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(sparkMat!);
    const baseSize = 0.05 + Math.random() * 0.06;
    sprite.scale.set(baseSize, baseSize, 1);
    sprite.position.set(x, y, z);
    scene.add(sprite);
    const ang = Math.random() * Math.PI * 2;
    const up = 0.3 + Math.random() * 0.9;
    const horiz = 1.8 + Math.random() * 2.6;
    sparks.push({
      sprite,
      vx: Math.cos(ang) * horiz,
      vy: up * 2.2,
      vz: Math.sin(ang) * horiz,
      age: 0,
      life: 0.18 + Math.random() * 0.22,
      baseSize,
    });
  }
}

export function tickParrySpark(dt: number) {
  // Flash — expand fast, fade out.
  if (flash) {
    flash.age += dt;
    const t = flash.age / flash.life;
    const s = flash.baseSize * (0.4 + t * 1.3);
    flash.sprite.scale.set(s, s, 1);
    if (flashMat) flashMat.opacity = Math.max(0, 1 - t);
    if (flash.age >= flash.life) {
      flash.sprite.parent?.remove(flash.sprite);
      flash = null;
    }
  }

  // Streaks — arc out under gravity, stretch slightly along travel, fade.
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.vy += GRAVITY * dt;
    s.sprite.position.x += s.vx * dt;
    s.sprite.position.y += s.vy * dt;
    s.sprite.position.z += s.vz * dt;
    s.age += dt;
    // Slight shrink as they burn out — a spark dwindles to a point.
    const k = 1 - s.age / s.life;
    const size = s.baseSize * (0.5 + 0.5 * k);
    s.sprite.scale.set(size, size, 1);
    if (s.age >= s.life) {
      s.sprite.parent?.remove(s.sprite);
      sparks.splice(i, 1);
    }
  }

  // Shared opacity tail for the streaks — fade off the youngest, like the
  // other bursts (cheap; a clash spawns as one cohort).
  if (sparks.length > 0 && sparkMat) {
    let youngestT = 1;
    for (const s of sparks) {
      const t = s.age / s.life;
      if (t < youngestT) youngestT = t;
    }
    sparkMat.opacity = Math.max(0, 1 - youngestT);
  } else if (sparkMat) {
    sparkMat.opacity = 1.0;
  }
}

export function clearParrySpark() {
  for (const s of sparks) s.sprite.parent?.remove(s.sprite);
  sparks.length = 0;
  if (flash) { flash.sprite.parent?.remove(flash.sprite); flash = null; }
}

// Warm the deflect-spark material so the first parry of a fight doesn't compile.
registerWarmup({ label: 'parry-spark', spawn: (s) => spawnParrySpark(s, 0, 0.3, -0.6), clear: clearParrySpark });
