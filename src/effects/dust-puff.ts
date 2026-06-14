import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';

// Dust puff — a short-lived bloom of soft grey billboards kicked up when
// something heavy meets stone (the gate slam, the gate settling back up).
// The visual that sells WEIGHT: a slam you only hear reads as a sound effect;
// a slam that throws dust reads as mass hitting the floor.
//
// Modelled on blood-burst (sprite pool, single tick + clear; the main loop
// drives the tick) but NORMAL-blended and grey — dust occludes light, it does
// not glow, so additive blending would be wrong here. The sprites expand,
// drift up and outward, and fade.

interface Puff {
  sprite: THREE.Sprite;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  baseSize: number;
}

const puffs: Puff[] = [];

// Light upward buoyancy then a slow settle — dust hangs, it doesn't arc like a
// droplet. Small negative so it eventually sinks.
const SETTLE = -0.45;

// Shared material so every puff reuses one WebGL program. Grey-brown, soft,
// non-glowing. fog:true so distant dust fades into the dungeon haze.
let puffMat: THREE.SpriteMaterial | null = null;
function ensureMat() {
  if (!puffMat) {
    puffMat = new THREE.SpriteMaterial({
      // 'moonbeam' is a NEUTRAL white radial blob — unlike 'fire-wisp' it bakes
      // in no warm gradient, so the grey tint reads as stone dust, not embers.
      map: getTexture('moonbeam'),
      color: 0x6b6258,                // dusty grey-brown
      transparent: true,
      opacity: 0.5,
      blending: THREE.NormalBlending, // dust occludes, never glows
      depthWrite: false,
      fog: true,
    });
  }
}

export interface DustPuffOpts {
  count?: number;     // how many billboards
  spread?: number;    // horizontal scatter radius (m) of spawn points
  size?: number;      // base sprite size (m)
  rise?: number;      // initial upward velocity (m/s)
  life?: number;      // seconds before fully faded
}

/** Fire a dust puff at a world position. Defaults read as a chunk of debris
 *  at the foot of a wall; callers scale via opts for a big slam vs a small
 *  settle. */
export function spawnDustPuff(scene: THREE.Object3D, x: number, y: number, z: number, opts: DustPuffOpts = {}) {
  ensureMat();
  const count = opts.count ?? 8;
  const spread = opts.spread ?? 0.5;
  const size = opts.size ?? 0.42;
  const rise = opts.rise ?? 0.9;
  const life = opts.life ?? 0.7;

  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(puffMat!);
    const baseSize = size * (0.7 + Math.random() * 0.6);
    sprite.scale.set(baseSize, baseSize, 1);
    sprite.position.set(
      x + (Math.random() - 0.5) * spread,
      y + Math.random() * 0.12,
      z + (Math.random() - 0.5) * spread,
    );
    scene.add(sprite);
    const angle = Math.random() * Math.PI * 2;
    const horSpeed = 0.4 + Math.random() * 0.7;
    puffs.push({
      sprite,
      vx: Math.cos(angle) * horSpeed,
      vy: rise * (0.5 + Math.random() * 0.7),
      vz: Math.sin(angle) * horSpeed,
      age: 0,
      life: life * (0.8 + Math.random() * 0.4),
      baseSize,
    });
  }
}

export function tickDustPuff(dt: number) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.vy += SETTLE * dt;             // buoyant then settling
    p.vx *= 1 - 1.4 * dt;            // drag — the cloud spreads then stalls
    p.vz *= 1 - 1.4 * dt;
    p.sprite.position.x += p.vx * dt;
    p.sprite.position.y += p.vy * dt;
    p.sprite.position.z += p.vz * dt;
    p.age += dt;
    const t = p.age / p.life;
    // Expand as it disperses — a tightening then billowing cloud.
    const scale = p.baseSize * (1 + t * 1.6);
    p.sprite.scale.set(scale, scale, 1);
    if (p.age >= p.life) {
      p.sprite.parent?.remove(p.sprite);
      puffs.splice(i, 1);
    }
  }

  // Shared opacity tail — fade ALL active puffs together off the youngest
  // age, like blood-burst. Cheap, avoids per-sprite material clones; reads
  // fine because a puff spawns as one cohort.
  if (puffs.length > 0 && puffMat) {
    let youngestT = 1;
    for (const p of puffs) {
      const t = p.age / p.life;
      if (t < youngestT) youngestT = t;
    }
    puffMat.opacity = 0.5 * (1 - youngestT * 0.85);
  } else if (puffMat) {
    puffMat.opacity = 0.5;
  }
}

export function clearDustPuff() {
  for (const p of puffs) p.sprite.parent?.remove(p.sprite);
  puffs.length = 0;
}
