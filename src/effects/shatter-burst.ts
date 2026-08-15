import * as THREE from 'three';
import { disposeGpu } from '../scene/gpu-dispose';
import { getTexture } from '../style/procedural-textures';
import { registerWarmup } from '../content/warmup-registry';
import { groundYAt } from '../level/elevation';

// Shatter burst — physics-y debris pop fired when a
// destructible (vases first; future jars, crates, bones) is
// destroyed. A handful of small box "shards" fly outward + up
// with random spin, fall under gravity, bounce damped off the
// floor, and despawn after a short life. A few additive sprite
// "dust puffs" fire alongside them for the suggestion of a
// powdery cloud at the impact.
//
// Lifecycle matches the other effect pools (xp-wisps,
// gold-coins, drifting-motes):
//   spawnShatterBurst(scene, x, y, z, broken?) on destroy
//   tickShatterBurst(dt)                       each frame
//   clearShatterBurst()                        on level swap

interface Shard {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  rvx: number; rvy: number; rvz: number;
  age: number;
  life: number;
  material: THREE.MeshStandardMaterial;
}

interface Puff {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  baseSize: number;
}

const shards: Shard[] = [];
const puffs: Puff[] = [];

const SHARD_GRAVITY     = -9.5;
const SHARD_BOUNCE_DAMP = 0.32;
const SHARD_GROUND_DRAG = 0.55;
// Rest height ABOVE the local ground (elevation-aware via groundYAt), so debris
// on a raised/sunken floor settles on THAT floor, not the base level.
const FLOOR_REST        = 0.04;
const FADE_TAIL         = 0.45;       // seconds of opacity tail before despawn

// Material pool keyed by tint hex — we reuse one material per
// colour so a single vase-burst doesn't allocate N MeshStandard
// materials. Materials live for the lifetime of the program.
const shardMaterialCache = new Map<number, THREE.MeshStandardMaterial>();
function getShardMaterial(tint: number): THREE.MeshStandardMaterial {
  let mat = shardMaterialCache.get(tint);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
    });
    shardMaterialCache.set(tint, mat);
  }
  return mat;
}

const puffMaterial = new THREE.SpriteMaterial({
  map: getTexture('moonbeam'),
  color: 0x6c5a48,         // warm dust grey-tan
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  fog: false,
  depthWrite: false,
});

/** Fire a shatter burst at world (x, y, z). `broken` marks
 *  already-cracked sources (pre-broken vases) — they emit half
 *  as many shards since less of the original prop was solid. */
export function spawnShatterBurst(
  scene: THREE.Object3D,
  x: number, y: number, z: number,
  broken: boolean = false,
  /** Shard tint (hex). Default: dull brown (vase/crate debris). Pass a bone /
   *  body colour for a crumbling skeleton or construct. */
  tint?: number,
): void {
  const shardCount = broken ? 3 + Math.floor(Math.random() * 2) : 6 + Math.floor(Math.random() * 3);
  const shardTint = (tint ?? 0x3a2418) + Math.floor(Math.random() * 0x040404);
  const material = getShardMaterial(shardTint);

  for (let i = 0; i < shardCount; i++) {
    const sx = 0.04 + Math.random() * 0.04;
    const sy = 0.04 + Math.random() * 0.05;
    const sz = 0.03 + Math.random() * 0.03;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    // Cloned material per-shard would be ideal for per-shard
    // fade-out; instead we accept a global fade across all
    // shards in a burst by tweaking the shared material's
    // opacity in tick. Shards already have varied life
    // jitter so the burst doesn't pop in unison.
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Outward velocity in the horizontal plane + an upward
    // kick. Random heading per shard so they fan out.
    const angle = Math.random() * Math.PI * 2;
    const horSpeed = 1.4 + Math.random() * 1.4;
    const upSpeed = 1.5 + Math.random() * 1.2;
    shards.push({
      mesh,
      vx: Math.cos(angle) * horSpeed,
      vy: upSpeed,
      vz: Math.sin(angle) * horSpeed,
      rvx: (Math.random() - 0.5) * 14,
      rvy: (Math.random() - 0.5) * 14,
      rvz: (Math.random() - 0.5) * 14,
      age: 0,
      life: 1.4 + Math.random() * 0.6,
      material,
    });
  }

  // Dust puff sprites — additive, drift slightly outward,
  // expand + fade. ~3 per burst.
  const puffCount = 3;
  for (let i = 0; i < puffCount; i++) {
    const sprite = new THREE.Sprite(puffMaterial);
    const baseSize = 0.18 + Math.random() * 0.12;
    sprite.scale.set(baseSize, baseSize, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.1, y, z + (Math.random() - 0.5) * 0.1);
    scene.add(sprite);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.4 + Math.random() * 0.3;
    puffs.push({
      sprite,
      material: puffMaterial,
      vx: Math.cos(angle) * speed,
      vy: 0.5 + Math.random() * 0.3,
      vz: Math.sin(angle) * speed,
      age: 0,
      life: 0.55 + Math.random() * 0.2,
      baseSize,
    });
  }
}

/** Fling ONE bigger chunk (a severed head / limb) from (x,y,z) in the (dirX,
 *  dirZ) direction — it arcs up, tumbles, bounces, and fades. Reuses the shard
 *  pool + tick. `color` matches the creature (flesh / bone); `size` ~ the part. */
export function spawnGib(
  scene: THREE.Object3D,
  x: number, y: number, z: number,
  dirX: number, dirZ: number,
  color: number,
  size: number = 0.12,
): void {
  const len = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / len, nz = dirZ / len;
  const geo = new THREE.BoxGeometry(size, size * 0.8, size * 1.1);
  const material = getShardMaterial(color);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const horSpeed = 2.0 + Math.random() * 1.2;
  shards.push({
    mesh,
    vx: nx * horSpeed, vy: 2.3 + Math.random() * 0.9, vz: nz * horSpeed,
    rvx: (Math.random() - 0.5) * 16, rvy: (Math.random() - 0.5) * 16, rvz: (Math.random() - 0.5) * 16,
    age: 0,
    life: 1.6 + Math.random() * 0.6,
    material,
  });
}

export function tickShatterBurst(dt: number): void {
  // Tick shards.
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.vy += SHARD_GRAVITY * dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.z += s.vz * dt;
    const floorY = groundYAt(s.mesh.position.x, s.mesh.position.z) + FLOOR_REST;
    if (s.mesh.position.y < floorY && s.vy < 0) {
      s.mesh.position.y = floorY;
      s.vy *= -SHARD_BOUNCE_DAMP;
      s.vx *= SHARD_GROUND_DRAG;
      s.vz *= SHARD_GROUND_DRAG;
      // Tiny rotational damping on bounce so spinning slows.
      s.rvx *= 0.6; s.rvy *= 0.6; s.rvz *= 0.6;
    }
    s.mesh.rotation.x += s.rvx * dt;
    s.mesh.rotation.y += s.rvy * dt;
    s.mesh.rotation.z += s.rvz * dt;
    s.age += dt;
    if (s.age >= s.life) {
      // After the life expires, fade out via scale shrink for
      // FADE_TAIL seconds before despawning. Scale doesn't
      // require per-shard materials.
      const fadeT = (s.age - s.life) / FADE_TAIL;
      if (fadeT >= 1) {
        s.mesh.parent?.remove(s.mesh);
        disposeGpu(s.mesh.geometry);
        shards.splice(i, 1);
        continue;
      }
      const shrink = 1 - fadeT;
      s.mesh.scale.set(shrink, shrink, shrink);
    }
  }

  // Tick dust puffs.
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.sprite.position.x += p.vx * dt;
    p.sprite.position.y += p.vy * dt;
    p.sprite.position.z += p.vz * dt;
    p.vy -= dt * 0.4;                  // slight settling
    p.age += dt;
    const t = p.age / p.life;
    if (t >= 1) {
      p.sprite.parent?.remove(p.sprite);
      puffs.splice(i, 1);
      continue;
    }
    // Expand size; opacity is baked into the texture's
    // alpha-decay so we lean on size to imply dissipation.
    const grow = 1 + t * 1.6;
    p.sprite.scale.set(p.baseSize * grow, p.baseSize * grow, 1);
  }
}

export function clearShatterBurst(): void {
  for (const s of shards) {
    s.mesh.parent?.remove(s.mesh);
    disposeGpu(s.mesh.geometry);
  }
  shards.length = 0;
  for (const p of puffs) {
    p.sprite.parent?.remove(p.sprite);
  }
  puffs.length = 0;
}

// Boot-warmup: shards are a flatShading + transparent MeshStandardMaterial; the
// first crumbling skeleton compiled that variant mid-death. Self-register so the
// program is hot at boot. See content/warmup-registry.ts.
registerWarmup({
  label: 'shatter-burst',
  spawn: (scene) => spawnShatterBurst(scene, 0, 0.5, 0, false, 0xb0a890),
  clear: clearShatterBurst,
});
