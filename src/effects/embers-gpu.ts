import * as THREE from 'three';
import { forEachLight } from '../scene/light-pool';
import { canSeeSignalAt, signalDrawOrder } from '../scene/signal-layer';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  vertexIndex, time, hash, float, vec3, uniform, uniformArray, frameGroup,
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
const LIFE_MIN = 2.4, LIFE_MAX = 4.8;   // longer life = slower rise + drift

let inited = false;
let points: THREE.Points | null = null;

const torchArr = (uniformArray as any)(Array.from({ length: MAX_TORCHES }, () => new THREE.Vector3())).setGroup(frameGroup);
const torchColArr = (uniformArray as any)(Array.from({ length: MAX_TORCHES }, () => new THREE.Vector3(1, 0.5, 0.16))).setGroup(frameGroup);   // see scene/gore-webgpu.ts
const torchCount = (uniform as any)(0);
/** Embers per emitter — held constant as torches come and go. See tickEmbersGPU. */
const PER_TORCH = COUNT / MAX_TORCHES;
const activeCount = (uniform as any)(0);
const _scratch: THREE.Vector3[] = Array.from({ length: MAX_TORCHES }, () => new THREE.Vector3());
const _tmpCol = new THREE.Color();

export function initEmbersGPU(_renderer: any, scene: THREE.Scene): void {
  if (inited) return;
  inited = true;

  // Per-ember identity = its vertex index; everything below is a hash of it.
  const i = (float as any)(vertexIndex);
  const lifespan = (float as any)(LIFE_MIN).add((hash as any)(i.add(2)).mul(LIFE_MAX - LIFE_MIN));
  const phase = time.add((hash as any)(i.add(7)).mul(20.0)).div(lifespan).fract();   // 0..1, loops

  // Spawn torch position (read from the per-frame uniform array, indexed by hash).
  const tIdx = (hash as any)(i).mul(torchCount.max(1)).floor().toInt();
  const spawn = (torchArr as any).element(tIdx);
  const tColor = (torchColArr as any).element(tIdx);   // the spawn torch's light colour
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
  // Parked below the floor when there is no emitter for this index — either no torches at
  // all, or this slot is past the active share (see activeCount in tickEmbersGPU).
  const live = (torchCount.greaterThan(0) as any).and(i.lessThan(activeCount));
  const finalPos = (live as any).select(pos, (vec3 as any)(0, -100, 0));

  // Bright fresh off the flame, fade as it climbs and cools (quick fade-in too).
  const glow = phase.oneMinus().pow(1.4).mul(phase.mul(8.0).clamp(0, 1));

  const mat: any = new (PointsNodeMaterial as any)();
  mat.positionNode = finalPos;
  mat.colorNode = tColor.mul(glow.mul(2.8));   // ember takes its torch's light colour, HDR so it blooms
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
  // AFTER THE VEIL, like the fire they rise from. Embers are gated at the emitter (see
  // tickEmbersGPU), so any that exist belong to a torch the player can see — and a spark
  // that dimmed at a doorway while its flame did not would read as two different fires.
  signalDrawOrder(points);
  // Stay visible through the boot warm so this compute-driven PointsNodeMaterial pipeline
  // compiles THERE (the warm hides the rest of the scene; warmKeep opts back in) — else it
  // first-compiles when a torch/bonfire comes into view in-play (a hitch). See warmup-pass.ts.
  points.userData.warmKeep = true;
  scene.add(points);
}

/** Refresh torch spawn points each frame (the motion itself is GPU-computed). */
export function tickEmbersGPU(): void {
  if (!inited) return;
  let n = 0;
  forEachLight('environment', (src: any) => {
    if (n >= MAX_TORCHES || !src.id.startsWith('torch-')) return;
    // ── ONLY THE TORCHES YOU CAN SEE ────────────────────────────────────────
    //
    // Josh: *"the flames have these particle effects rising — these are not LOS culled."*
    // Right: this took the first sixteen registered torches with no visibility test at all,
    // so embers rose from fires through walls and past sealed thresholds while the flames
    // themselves were correctly hidden.
    //
    // Filtered at the EMITTER, which is the only place it can be done: the cloud is one
    // Points draw whose trajectories are a pure function of time and index, with no
    // per-particle object to hide. Sixteen tests a frame instead of eight hundred.
    if (!canSeeSignalAt(src.position.x, src.position.z)) return;
    _scratch[n].copy(src.position);
    // The torch's (possibly flicker-animated) light colour → this torch's embers.
    if (src.getColor) src.getColor(_tmpCol); else _tmpCol.setHex(src.color);
    (torchColArr as any).array[n].set(_tmpCol.r, _tmpCol.g, _tmpCol.b);
    n++;
  });
  for (let k = 0; k < n; k++) (torchArr as any).array[k].copy(_scratch[k]);
  (torchCount as any).value = n;
  // ── AND THE DENSITY PER TORCH STAYS PUT ─────────────────────────────────
  //
  // `tIdx = hash(i) * torchCount` spreads ALL of COUNT across however many emitters there
  // are, so dropping a torch from the list does not remove its embers — it hands them to
  // the survivors. Hiding half the torches on a floor would have doubled the sparks over
  // every remaining one, which reads as the fires flaring up as you walk away from them.
  //
  // So the number of ACTIVE particles tracks the number of emitters, and the rest park
  // below the floor. Each visible torch keeps its own share whatever else is culled.
  (activeCount as any).value = n * PER_TORCH;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
