import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { instancedBufferAttribute, positionGeometry, vec4 } from 'three/tsl';
import { registerWarmup } from '../content/warmup-registry';

// ── INSTANCED FLAME-MESH BATCH — the solid flame BLOBS in one draw ───────────
//
// sprite-batch.ts collapsed the additive flame SPRITES (wisps, tongue stacks);
// this is its sibling for the solid emissive flame SPHERES — the candle/torch/
// brazier blob authored as `kind:'sphere', mat:'flame'`. The 2026-07-05 POCO
// recordings showed 17-19 of them per floor, each its own Mesh with its own
// CLONED MeshStandardMaterial (per-fixture flicker), i.e. a draw + a uniform
// upload apiece, every frame — the analyzer's standing "UNMERGED" complaint.
//
// Here they become ONE Mesh: an InstancedBufferGeometry unit sphere whose
// position/scale/colour ride per-instance attributes. All flame blobs on a
// floor = 1 draw + one small buffer write per frame.
//
// LOOK: the blob's real material is emissive-dominant (emissiveIntensity ~2-3
// vs a dim base colour, in a dark scene) — so the batch renders UNLIT
// (MeshBasicNodeMaterial, fog on) at emissive×intensity. Torch flicker and
// mood tint drive the same handle fields the material/mesh versions exposed.
//
// CONSUMER CONTRACT (mirrors BatchedSprite):
//  - `obj` is a placeholder Object3D parented where the sphere sat; world
//    position + ancestor visibility are read per tick (fog-cull, room culler
//    and wick states keep working by toggling ancestors).
//  - `color` (hex-settable Color) + `emissiveIntensity` are LIVE — torchlight
//    writes intensity per flicker frame; mood-tint setHex()es the colour.
//  - `scaleMul` (V3) + `offsetY` are LIVE — torch flicker's scale jitter/bob.
//  - `stretch` carries the authored part scale (candles author [1,1.4,1]).
//
// SCOPE: only parts built with opts.batchSprites (builder props + torchlight
// fixtures). Bench/viewer/loot models keep real meshes. ?flamebatch=0 A/Bs.

const MAX_PER_BATCH = 128;

export interface BatchedFlameMesh {
  obj: THREE.Object3D;
  color: THREE.Color;
  emissiveIntensity: number;
  scaleMul: THREE.Vector3;
  offsetY: number;
  /** Authored part scale (e.g. the candle flame's [1,1.4,1] stretch). */
  stretch: THREE.Vector3;
  /** Authored sphere radius (metres). */
  radius: number;
}

let batchScene: THREE.Scene | null = null;
let mesh: THREE.Mesh | null = null;
let geo: THREE.InstancedBufferGeometry | null = null;
let aPos: THREE.InstancedBufferAttribute | null = null;
let aScale: THREE.InstancedBufferAttribute | null = null;
let aCol: THREE.InstancedBufferAttribute | null = null;
const entries: BatchedFlameMesh[] = [];
const _world = new THREE.Vector3();

export function flameMeshBatchEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('flamebatch') !== '0';
}

function ensureBatch(): void {
  if (mesh) return;
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const g = new THREE.InstancedBufferGeometry();
  g.index = sphere.index;
  g.setAttribute('position', sphere.getAttribute('position'));
  g.setAttribute('uv', sphere.getAttribute('uv'));
  aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_BATCH * 3), 3);
  aScale = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_BATCH * 3), 3);
  aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_BATCH * 3), 3);
  for (const a of [aPos, aScale, aCol]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFlamePos', aPos);
  g.setAttribute('aFlameScale', aScale);
  g.setAttribute('aFlameCol', aCol);
  g.instanceCount = 0;
  geo = g;

  const mat = new MeshBasicNodeMaterial();
  mat.fog = true;   // blobs sit in the world fog like their Mesh ancestors
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (mat as any).positionNode = (positionGeometry as any)
    .mul(instancedBufferAttribute(aScale))
    .add(instancedBufferAttribute(aPos));
  (mat as any).colorNode = (vec4 as any)(instancedBufferAttribute(aCol), 1);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  mat.name = 'flame-mesh-batch';

  mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;      // instances span the floor; culled per-entry via visibility
  mesh.matrixAutoUpdate = false;   // identity — instance positions are world-space
  mesh.castShadow = false;
  mesh.name = 'flame-mesh-batch';
  batchScene?.add(mesh);
}

/** Enable batching (the game calls this once with the live scene; bench/viewer
 *  never do, so models built there keep real flame meshes). */
export function setFlameMeshBatchScene(scene: THREE.Scene): void {
  batchScene = scene;
  if (mesh) scene.add(mesh);
}

export function isFlameMeshBatchingEnabled(): boolean {
  return batchScene !== null && flameMeshBatchEnabled();
}

/** Register a batched flame blob. Caller parents `handle.obj` where the
 *  sphere would have sat. Colour defaults to the material's emissive look. */
export function createBatchedFlameMesh(opts: {
  radius: number;
  stretch: [number, number, number];
  emissive: number;
  emissiveIntensity: number;
}): BatchedFlameMesh {
  ensureBatch();
  const entry: BatchedFlameMesh = {
    obj: new THREE.Object3D(),
    color: new THREE.Color(opts.emissive),
    emissiveIntensity: opts.emissiveIntensity,
    scaleMul: new THREE.Vector3(1, 1, 1),
    offsetY: 0,
    stretch: new THREE.Vector3(...opts.stretch),
    radius: opts.radius,
  };
  entry.obj.userData.batchedFlame = entry;
  entries.push(entry);
  return entry;
}

/** True when every ancestor up to (and including) the batch scene is visible. */
function worldVisible(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    if (cur === (batchScene as THREE.Object3D)) return true;
    cur = cur.parent;
  }
  return false;   // detached (torn down / not yet mounted)
}

/** Per-frame: fold every visible entry into the instance attributes. */
export function tickFlameMeshBatch(): void {
  if (!batchScene || !mesh || !geo || !aPos || !aScale || !aCol) return;
  let n = 0;
  for (const e of entries) {
    if (n >= MAX_PER_BATCH) break;
    if (!worldVisible(e.obj)) continue;
    e.obj.getWorldPosition(_world);
    aPos.setXYZ(n, _world.x, _world.y + e.offsetY, _world.z);
    aScale.setXYZ(
      n,
      e.radius * e.stretch.x * e.scaleMul.x,
      e.radius * e.stretch.y * e.scaleMul.y,
      e.radius * e.stretch.z * e.scaleMul.z,
    );
    const b = e.emissiveIntensity;
    aCol.setXYZ(n, e.color.r * b, e.color.g * b, e.color.b * b);
    n++;
  }
  mesh.visible = n > 0;   // instanceCount 0 still submits a degenerate draw
  if (n === 0 && geo.instanceCount === 0) return;
  geo.instanceCount = n;
  aPos.needsUpdate = true;
  aScale.needsUpdate = true;
  aCol.needsUpdate = true;
}

/**
 * DEV: the instances actually being drawn this frame, as text.
 *
 * The batch's vertices are placed by a custom positionNode from `aFlamePos`/`aFlameScale`, so
 * Three's bounding box only ever describes the unit sphere the geometry started as — every probe
 * that walks the scene sees "2m sphere at the origin" whatever the batch is really drawing. The
 * only honest answer comes from the attributes.
 */
export function flameBatchDebug(): string {
  if (!geo || !aPos || !aScale) return 'flame batch: not built';
  const rows: string[] = [];
  for (let i = 0; i < geo.instanceCount; i++) {
    const px = aPos.getX(i), py = aPos.getY(i), pz = aPos.getZ(i);
    const sx = aScale.getX(i), sy = aScale.getY(i), sz = aScale.getZ(i);
    const atOrigin = Math.hypot(px, py, pz) < 0.5;
    const big = Math.max(sx, sy, sz) > 0.2;
    rows.push(`${i}: pos[${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)}] `
      + `scale[${sx.toFixed(3)},${sy.toFixed(3)},${sz.toFixed(3)}]`
      + `${atOrigin ? ' ← AT ORIGIN' : ''}${big && atOrigin ? ' AND BIG' : ''}`);
  }
  return `flame batch: ${geo.instanceCount} instance(s), entries=${entries.length}, `
    + `meshVisible=${mesh?.visible}\n  ${rows.join('\n  ')}`;
}

/** Drop every entry (level teardown — placeholders die with the level root;
 *  the batch mesh + pipeline stay resident for the next floor). */
export function resetFlameMeshBatch(): void {
  entries.length = 0;
  if (geo) geo.instanceCount = 0;
}

// Warm the batch pipeline at boot: one visible dummy instance rendered through
// the real pipeline by the warm pass; the mesh lives in the scene permanently,
// so the compiled pipeline stays pinned.
registerWarmup({
  label: 'flame-mesh-batch', live: true,
  spawn: () => {
    if (!batchScene) return;
    ensureBatch();
    if (!geo || !aPos || !aScale || !aCol) return;
    aPos.setXYZ(0, 0, 0.5, 0);
    aScale.setXYZ(0, 0.02, 0.03, 0.02);
    aCol.setXYZ(0, 1, 0.7, 0.3);
    geo.instanceCount = 1;
    aPos.needsUpdate = true; aScale.needsUpdate = true; aCol.needsUpdate = true;
  },
  clear: () => { if (geo) geo.instanceCount = 0; },
});
