import * as THREE from 'three';
import { disposeGpu } from '../scene/gpu-dispose';
import { CONFIG } from '../config';
import { getTexture } from '../style/procedural-textures';
import type { WalkableRect } from '../level/types';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, uniform as tslUniform, texture as tslTexture, time, hash, float, vec3 } from 'three/tsl';

// Drifting motes — subtle volumetric ambient. A small pool of
// additive billboarded specks slowly floats through every room,
// reading as "dust in the air" / "embers / spirits drifting".
// They don't try to be a particle storm; the eye should notice
// them peripherally, not be overwhelmed.
//
// ONE DRAW for the whole pool. Each mote used to be its own
// THREE.Sprite (N motes = N draw calls + N objects the renderer
// sorts), which the draw-report flagged as the dominant sprite
// count on a floor. They're now a SINGLE camera-billboarded quad
// batch: one BufferGeometry of N quads whose 4 corners are rewritten
// each frame to face the camera (the same screen-aligned facing a
// Sprite does), one additive material, one mesh. 52 draws → 1.
//
// Motes have a lifetime + scale-based fade-in/out (the quad shrinks
// to nothing at birth/death — no per-mote opacity, so the whole
// batch stays one material). On despawn they respawn at a random
// walkable position weighted by room area so big halls have more
// motes than small alcoves.
//
// Lifecycle matches the xpWisps / goldCoins module pattern:
//   initDriftingMotes(scene, rects, tint) at level load
//   tickDriftingMotes(dt, camera) each frame
//   clearDriftingMotes() at level teardown

// Atmosphere tuning lives in src/config.ts (CONFIG.EFFECTS_MOTES).
const MOTE_COUNT       = CONFIG.EFFECTS_MOTES.COUNT;
const SPAWN_Y_MIN      = CONFIG.EFFECTS_MOTES.SPAWN_Y_MIN;
const SPAWN_Y_MAX      = CONFIG.EFFECTS_MOTES.SPAWN_Y_MAX;
const LIFE_MIN         = CONFIG.EFFECTS_MOTES.LIFE_MIN;
const LIFE_MAX         = CONFIG.EFFECTS_MOTES.LIFE_MAX;
const DRIFT_SPEED_LAT  = CONFIG.EFFECTS_MOTES.DRIFT_SPEED_LAT;
const DRIFT_SPEED_UP   = CONFIG.EFFECTS_MOTES.DRIFT_SPEED_UP;
const BASE_SIZE        = CONFIG.EFFECTS_MOTES.BASE_SIZE;
const FADE_FRACTION    = CONFIG.EFFECTS_MOTES.FADE_FRACTION;

let rects: WalkableRect[] = [];

// ── WebGPU path (one draw, ZERO per-frame buffer rewrite) ──
// The CPU path rewrites every quad corner each frame + re-uploads the whole
// position buffer. The GPU path bakes each mote's home + seed into STATIC vertex
// attributes once; the vertex node drifts + billboards entirely on the GPU. Per
// frame the CPU only refreshes the two camera-basis uniforms below.
/* eslint-disable @typescript-eslint/no-explicit-any */
let gpuMesh: THREE.Mesh | null = null;
const nCamRight = (tslUniform as any)(new THREE.Vector3(1, 0, 0));
const nCamUp = (tslUniform as any)(new THREE.Vector3(0, 1, 0));
/* eslint-enable @typescript-eslint/no-explicit-any */

export function initDriftingMotes(
  scene: THREE.Object3D,
  walkableRects: WalkableRect[],
  tint: number = 0xc8d4ff,
): void {
  clearDriftingMotes();
  if (walkableRects.length === 0) return;
  rects = walkableRects;

  initMotesWebGPU(scene, tint);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Build the GPU mote batch: bake home + seed per mote into static attributes,
// then a node material that drifts (linear velocity over a looping life) and
// camera-billboards each quad in the vertex node. Mirrors the CPU drift/fade
// exactly, so the look is identical — only the work moves to the GPU.
function initMotesWebGPU(scene: THREE.Object3D, tint: number): void {
  const N = MOTE_COUNT;
  const home = new Float32Array(N * 4 * 3);    // per-vertex mote anchor (4 verts share)
  const corner = new Float32Array(N * 4 * 2);  // which corner: ±0.5
  const seed = new Float32Array(N * 4);        // per-mote random
  const uvs = new Float32Array(N * 4 * 2);
  const position = new Float32Array(N * 4 * 3); // dummy (positionNode overrides)
  const index = new Uint16Array(N * 6);
  const CORNERS = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];

  for (let i = 0; i < N; i++) {
    const r = pickRect(rects);
    const hx = r.x - r.w / 2 + Math.random() * r.w;
    const hz = r.z - r.d / 2 + Math.random() * r.d;
    const hy = SPAWN_Y_MIN + Math.random() * (SPAWN_Y_MAX - SPAWN_Y_MIN);
    const s = Math.random();
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      home[v * 3] = hx; home[v * 3 + 1] = hy; home[v * 3 + 2] = hz;
      corner[v * 2] = CORNERS[c * 2]; corner[v * 2 + 1] = CORNERS[c * 2 + 1];
      seed[v] = s;
      uvs[v * 2] = c === 1 || c === 2 ? 1 : 0;
      uvs[v * 2 + 1] = c >= 2 ? 1 : 0;
    }
    const v0 = i * 4;
    index.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], i * 6);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geom.setAttribute('home', new THREE.BufferAttribute(home, 3));
  geom.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
  geom.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(index, 1));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const aHome: any = (attribute as any)('home', 'vec3');
  const aCorner: any = (attribute as any)('corner', 'vec2');
  const aSeed: any = (attribute as any)('seed', 'float');

  // Looping life → linear drift from home (matches the CPU velocity model).
  const lifespan = (float as any)(LIFE_MIN).add((hash as any)(aSeed).mul(LIFE_MAX - LIFE_MIN));
  const phase = time.add((hash as any)(aSeed.add(11)).mul(40.0)).div(lifespan).fract();
  const age = phase.mul(lifespan);
  const vx = (hash as any)(aSeed.add(1)).sub(0.5).mul(DRIFT_SPEED_LAT);
  const vy = (hash as any)(aSeed.add(2)).mul(0.5).add(0.5).mul(DRIFT_SPEED_UP);
  const vz = (hash as any)(aSeed.add(3)).sub(0.5).mul(DRIFT_SPEED_LAT);
  const center = aHome.add((vec3 as any)(vx, vy, vz).mul(age));

  // Scale fade in/out (same ramp as the CPU path) — birth/death as a vanishing speck.
  const fIn = phase.div(FADE_FRACTION).clamp(0, 1);
  const fOut = (float as any)(1).sub(phase).div(FADE_FRACTION).clamp(0, 1);
  const half = (float as any)(BASE_SIZE).mul(fIn.min(fOut)).mul(0.5);

  const worldPos = center
    .add(nCamRight.mul(aCorner.x.mul(half)))
    .add(nCamUp.mul(aCorner.y.mul(half)));

  const mat: any = new (MeshBasicNodeMaterial as any)();
  mat.positionNode = worldPos;
  const c = new THREE.Color(tint);
  mat.colorNode = (tslTexture as any)(getTexture('fire-wisp')).mul((vec3 as any)(c.r, c.g, c.b)).mul(0.55);
  mat.transparent = true;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.fog = true;
  mat.side = THREE.DoubleSide;

  gpuMesh = new THREE.Mesh(geom, mat);
  gpuMesh.frustumCulled = false;
  gpuMesh.renderOrder = 2;
  gpuMesh.userData.dbgKind = 'fx';
  scene.add(gpuMesh);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function tickDriftingMotes(_dt: number, camera: THREE.Camera): void {
  // The whole drift + billboard runs in the vertex node. All the CPU does each
  // frame is hand the GPU this frame's camera right/up. No buffer rewrite.
  if (!gpuMesh) return;
  const e = camera.matrixWorld.elements;
  nCamRight.value.set(e[0], e[1], e[2]).normalize();
  nCamUp.value.set(e[4], e[5], e[6]).normalize();
}

/** Hide/show the whole mote batch — used by the GPU-attribution probe to
 *  measure what the motes cost. No-op if motes aren't initialised. */
export function setMotesHidden(hidden: boolean): void {
  if (gpuMesh) gpuMesh.visible = !hidden;
}

export function clearDriftingMotes(): void {
  if (gpuMesh) {
    gpuMesh.parent?.remove(gpuMesh);
    disposeGpu(gpuMesh.geometry, gpuMesh.material as THREE.Material);
    gpuMesh = null;
  }
  rects = [];
}

/** Area-weighted pick of a rect. Bigger rooms host more motes. */
function pickRect(pool: WalkableRect[]): WalkableRect {
  const total = pool.reduce((s, r) => s + r.w * r.d, 0);
  let pick = Math.random() * total;
  for (const r of pool) {
    pick -= r.w * r.d;
    if (pick <= 0) return r;
  }
  return pool[pool.length - 1];
}
