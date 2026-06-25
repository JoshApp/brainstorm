import * as THREE from 'three';
import { isWebGPU } from '../scene/renderer-mode';
import { forEachLight } from '../scene/light-pool';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  vertexIndex, time, hash, float, vec3, uniform, uniformArray,
} from 'three/tsl';

// GPU EMBERS — glowing sparks rising off the torches, the first WebGPU-era
// atmosphere win. Each ember's whole trajectory is a pure function of (time, its
// index, its torch) evaluated in the GPU vertex node — no per-frame CPU work, no
// draw-per-particle, the entire cloud is one Points draw. Stateless + looping
// (deterministic rise) suits embers perfectly; stateful compute is the next step
// for blood/physics.

/* eslint-disable @typescript-eslint/no-explicit-any */

const COUNT = 800;
const MAX_TORCHES = 16;
const RISE_H = 2.6;           // metres an ember climbs over its life
const DRIFT = 0.30;           // horizontal sway amplitude (grows as it rises)
const JITTER = 0.16;          // per-ember scatter around the torch
const LIFE_MIN = 1.8, LIFE_MAX = 3.8;

let inited = false;
let points: THREE.Points | null = null;

const torchArr = (uniformArray as any)(Array.from({ length: MAX_TORCHES }, () => new THREE.Vector3()));
const torchCount = (uniform as any)(0);
const _scratch: THREE.Vector3[] = Array.from({ length: MAX_TORCHES }, () => new THREE.Vector3());

export function initEmbersGPU(_renderer: any, scene: THREE.Scene): void {
  if (inited || !isWebGPU()) return;
  inited = true;

  // Per-ember identity = its vertex index; everything below is a hash of it.
  const i = (float as any)(vertexIndex);
  const lifespan = (float as any)(LIFE_MIN).add((hash as any)(i.add(2)).mul(LIFE_MAX - LIFE_MIN));
  const phase = time.add((hash as any)(i.add(7)).mul(20.0)).div(lifespan).fract();   // 0..1, loops

  // Spawn torch position (read from the per-frame uniform array, indexed by hash).
  const tIdx = (hash as any)(i).mul(torchCount.max(1)).floor().toInt();
  const spawn = (torchArr as any).element(tIdx);
  const jx = (hash as any)(i.add(3)).sub(0.5).mul(JITTER);
  const jz = (hash as any)(i.add(4)).sub(0.5).mul(JITTER);

  // Rise accelerates a touch; drift widens as it climbs (heat plume).
  const rise = phase.mul(phase.mul(0.4).add(0.6)).mul(RISE_H);
  const sway = phase.mul(DRIFT);
  const driftX = time.mul(2.1).add(i).sin().mul(sway);
  const driftZ = time.mul(1.7).add(i.mul(1.3)).cos().mul(sway);
  const pos = (vec3 as any)(
    spawn.x.add(jx).add(driftX),
    spawn.y.add(0.06).add(rise),
    spawn.z.add(jz).add(driftZ),
  );
  const finalPos = (torchCount.greaterThan(0) as any).select(pos, (vec3 as any)(0, -100, 0));

  // Bright fresh off the flame, fade as it climbs and cools (quick fade-in too).
  const glow = phase.oneMinus().pow(1.4).mul(phase.mul(8.0).clamp(0, 1));

  const mat: any = new (PointsNodeMaterial as any)();
  mat.positionNode = finalPos;
  mat.colorNode = (vec3 as any)(1.0, 0.5, 0.16).mul(glow.mul(2.8));   // HDR ember orange → blooms
  mat.sizeNode = (float as any)(3.0).mul(glow.mul(0.6).add(0.4));
  mat.size = 3.0;
  mat.sizeAttenuation = true;
  mat.transparent = true;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.fog = true;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // never frustum-culled

  points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
}

/** Refresh torch spawn points each frame (the motion itself is GPU-computed). */
export function tickEmbersGPU(): void {
  if (!inited) return;
  let n = 0;
  forEachLight('environment', (src: any) => {
    if (n >= MAX_TORCHES || !src.id.startsWith('torch-')) return;
    _scratch[n].copy(src.position);
    n++;
  });
  for (let k = 0; k < n; k++) (torchArr as any).array[k].copy(_scratch[k]);
  (torchCount as any).value = n;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
