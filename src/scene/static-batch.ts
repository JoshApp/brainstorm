import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import { getAllInteractables } from '../interactables/system';
import { deferGpuDispose } from '../style/render-webgpu';

// ── STATIC-WORLD BATCHING (BatchedMesh) ──────────────────────────────────────
//
// The endgame of the 2026-07-04 phone-CPU work. Three's WebGPU renderer
// charges its expensive per-OBJECT frontend (uniform upload, bind groups,
// node updates, renderObject dispatch — measured ~45% of frame CPU) per draw;
// the static world (room shells, props, merged fixtures) was ~100+ of those.
// A THREE.BatchedMesh collapses everything sharing a material family into ONE
// render object: on WebGPU it still encodes one small drawIndexed per visible
// instance, but those are the cheap ~2.5% native calls — the frontend runs
// once per BATCH.
//
// Why not extend the per-room merge (level/static-merge.ts)? Fragmentation:
// the remaining loose static (doorframes, eye sockets, singleton props) sits
// 1-2 per room, below any per-room merge threshold. BatchedMesh batches
// FLOOR-WIDE per material while keeping PER-INSTANCE visibility — so the room
// culler still occlusion-culls at room granularity (setVisibleAt), and Three's
// own per-instance frustum culling handles the rest.
//
// What goes in (Stage 1): opaque, non-animated meshes inside the same static
// set the matrix-freeze pass classifies — shell pieces, prop-group meshes,
// per-room merged fixtures. Excluded: transparent/additive meshes (decals,
// glows — blending/sort semantics), the animated 'flame' mesh, sprite-batch
// placeholders, InstancedMesh decor (already instanced), anything tagged
// `userData.dynamicPart` (a part whose TRANSFORM or per-instance MATERIAL
// animates — blink lids, crown glows), and everything interactable/
// destructible/torch/enemy (they animate, open, or die).
//
// Lifecycle: batches are children of level.root — the level teardown removes
// and disposes them with everything else, and the per-floor descent compile
// (warmSceneCompile) warms their pipelines behind the cover. Escape hatch:
// ?batchworld=0.

/** Default ON; ?batchworld=0 is the kill switch.
 *
 *  HISTORY: this shipped default-OFF for a night because ~1 boot in 3 hit an
 *  intermittent black-world race (`setIndexBuffer: parameter 1 is not of type
 *  'GPUBuffer'` → depth/output usage-scope storm — the same signature that
 *  killed the render-bundle experiment). The GPUBuffer.destroy stack traps
 *  identified the root cause: the level teardown's SYNCHRONOUS
 *  geometry-dispose burst destroyed buffers a queued frame still referenced.
 *  Fixed via deferGpuDispose (render-webgpu.ts) — teardown removes from the
 *  scene immediately, buffers die at the next GPU-idle frame. Soaked: 5/5
 *  clean boots + 3 chained descents + a 15-mob smite, zero GPU errors. */
export function staticWorldBatchingEnabled(): boolean {
  if (typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('batchworld') !== '0';
}

// rectId → the batch instances belonging to that room rect (culler toggles).
const rectIndex = new Map<string, Array<{ batch: THREE.BatchedMesh; id: number }>>();
let liveBatches: THREE.BatchedMesh[] = [];

/** Value-signature for collapsing per-instance-cloned but visually identical
 *  materials (same idea as static-merge's matSig, wider surface). */
function matSig(mat: THREE.Material): string {
  const m = mat as THREE.MeshStandardMaterial;
  return [
    mat.type,
    m.color?.getHexString() ?? '-',
    m.emissive?.getHexString() ?? '-',
    (m.roughness ?? 0).toFixed(2),
    (m.metalness ?? 0).toFixed(2),
    (m.emissiveIntensity ?? 0).toFixed(2),
    m.map?.uuid ?? '-',
    (m.alphaTest ?? 0).toFixed(2),
    m.vertexColors ? 'vc' : '-',
    m.flatShading ? 'fs' : '-',
    (mat as THREE.Material & { fog?: boolean }).fog === false ? 'nofog' : 'fog',
    mat.side,
  ].join('|');
}

/**
 * Attribute-layout signature — every geometry in one BatchedMesh must share the
 * exact attribute set (names, item sizes).
 *
 * INDEXED-NESS IS DELIBERATELY NOT IN THIS KEY. It used to be, and it split
 * batches whose attribute layout was otherwise character-for-character
 * identical: measured on depth 12, three of twenty batches existed only because
 * `…position:3,uv:2|i` and `…position:3,uv:2|n` were treated as different
 * layouts. Indexed-ness is not a property of the SHADING, it is an accident of
 * how each geometry happened to be built — so it is resolved at batch-assembly
 * time instead (de-index the group when it is mixed, exactly as
 * level/static-merge.ts already does for the same reason).
 */
function attrSig(geo: THREE.BufferGeometry): string {
  const names = Object.keys(geo.attributes).sort();
  return names.map((n) => `${n}:${geo.attributes[n].itemSize}`).join(',');
}

function shellRectId(src: string): string | null {
  const dot = src.indexOf('·');
  if (dot < 0) return null;
  const rest = src.slice(dot + 1).trim();
  const sp = rest.search(/\s/);
  return (sp < 0 ? rest : rest.slice(0, sp)) || null;
}

function rectIdAt(level: LiveLevel, x: number, z: number): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  const scan = (rooms: ReadonlyArray<{ id: string; rect: { x: number; z: number; w: number; d: number }; logicalOnly?: boolean }>) => {
    for (const room of rooms) {
      if (room.logicalOnly) continue;
      const { rect } = room;
      if (Math.abs(x - rect.x) > rect.w / 2 + 0.05 || Math.abs(z - rect.z) > rect.d / 2 + 0.05) continue;
      const area = rect.w * rect.d;
      if (area < bestArea) { bestArea = area; bestId = room.id; }
    }
  };
  scan(level.spec.rooms);
  scan(level.spec.corridors as never);
  return bestId;
}

interface Item { mesh: THREE.Mesh; rectId: string; geo: THREE.BufferGeometry }

// ── COLOUR → VERTEX BAKE ─────────────────────────────────────────────────────
// Most static materials differ ONLY by colour (the census: ~13 flat-shaded
// stone materials, all rough=1 metal=0, colours apart) — keying batches on the
// material value fragments them into near-singletons. For plain materials
// (no map, black emissive, opaque, front-side, no vertex colours) the colour
// is baked into a per-vertex `color` attribute instead, and every such mesh
// shares ONE white vertexColors material per shading family — mathematically
// identical output (base = color × vertexColor), one batch instead of ~13.
const bakedMats = new Map<string, THREE.MeshStandardMaterial>();

function bakeFamilyKey(m: THREE.MeshStandardMaterial): string {
  return `${m.flatShading ? 'f' : 's'}|${(m.roughness ?? 1).toFixed(2)}|${(m.metalness ?? 0).toFixed(2)}|${(m as THREE.Material & { fog?: boolean }).fog === false ? 'nofog' : 'fog'}`;
}

function isBakeable(mat: THREE.Material): mat is THREE.MeshStandardMaterial {
  const m = mat as THREE.MeshStandardMaterial;
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
    && !m.map && !m.transparent && (m.alphaTest ?? 0) === 0
    && m.side === THREE.FrontSide && !m.vertexColors
    && m.emissive !== undefined && m.emissive.getHex() === 0x000000;
}

function bakedMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const key = bakeFamilyKey(src);
  let m = bakedMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: src.roughness,
      metalness: src.metalness,
      flatShading: src.flatShading,
      fog: (src as THREE.Material & { fog?: boolean }).fog,
    });
    m.name = `static-batch-baked:${key}`;
    bakedMats.set(key, m);   // module-lifetime — pins the batch pipeline across floors
  }
  return m;
}

/** A colour-attributed variant of `geo` (cloned — geometry may be POOLED and
 *  shared by props of other colours; never mutate the original). Cached per
 *  (geometry, colour) within one floor build. */
function coloredVariant(
  cache: Map<string, THREE.BufferGeometry>,
  geo: THREE.BufferGeometry,
  color: THREE.Color,
): THREE.BufferGeometry {
  const key = `${geo.uuid}|${color.getHexString()}`;
  let v = cache.get(key);
  if (v) return v;
  v = geo.clone();
  const n = v.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  v.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  cache.set(key, v);
  return v;
}

/**
 * Fold the level's static meshes into floor-wide BatchedMeshes (one per
 * material family). Call AFTER batchStaticFixtures (its merged output batches
 * too) and BEFORE the matrix freeze + room-culler creation.
 */
export function batchStaticWorld(level: LiveLevel): void {
  if (!staticWorldBatchingEnabled()) return;
  rectIndex.clear();
  liveBatches = [];

  // Same exclusion set as the freeze pass: things that animate, open, or die.
  const excluded = new Set<THREE.Object3D>();
  for (const i of getAllInteractables()) { const g = i.built?.group; if (g) excluded.add(g); }
  for (const d of level.destructibles) excluded.add(d.group);
  for (const t of level.torches) excluded.add(t.group);
  for (const e of level.enemies) excluded.add(e.group);

  level.root.updateMatrixWorld(true);

  // Collect batchable meshes per material-family key. Bakeable plain
  // materials collapse into one white vertexColors family (colour rides a
  // baked vertex attribute); the rest key on material value.
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; items: Item[] }>();
  const variantCache = new Map<string, THREE.BufferGeometry>();   // per-floor colour-variant cache
  let candidates = 0;
  for (const child of level.root.children.slice()) {
    if (excluded.has(child)) continue;
    let rectId: string | null = null;
    if (child.userData?.dbgKind === 'prop') rectId = rectIdAt(level, child.position.x, child.position.z);
    else if (typeof child.userData?.dbgSource === 'string') rectId = shellRectId(child.userData.dbgSource);
    if (!rectId) continue;
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.BatchedMesh).isBatchedMesh) return;
      if (Array.isArray(m.material)) return;              // multi-material groups stay loose
      const mat = m.material as THREE.Material;
      if (mat.transparent) return;                        // blend/sort semantics — stay loose
      if (m.name === 'flame') return;                     // animated flicker mesh
      if (m.userData?.dynamicPart) return;                // opt-out: animated transform/material
      if (m.userData?.batchedSprite) return;              // sprite-batch placeholder (not a Mesh anyway)
      let geo = m.geometry as THREE.BufferGeometry;
      if (!geo?.attributes?.position) return;
      candidates++;
      let batchMat = mat;
      let keyMat: string;
      if (isBakeable(mat)) {
        batchMat = bakedMaterial(mat);
        geo = coloredVariant(variantCache, geo, mat.color);
        keyMat = `bake|${bakeFamilyKey(mat)}`;
      } else {
        keyMat = matSig(mat);
      }
      const key = `${keyMat}§${attrSig(geo)}§${m.castShadow ? 'c' : ''}${m.receiveShadow ? 'r' : ''}`;
      let g = byKey.get(key);
      if (!g) { g = { mat: batchMat, cast: m.castShadow, receive: m.receiveShadow, items: [] }; byKey.set(key, g); }
      g.items.push({ mesh: m, rectId: rectId!, geo });
    });
  }

  // De-indexed variants, per floor build. Keyed by the SOURCE geometry so a
  // pooled geometry shared by twenty props is flattened once, not twenty times.
  const deindexCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  let batched = 0;
  let batchCount = 0;
  for (const [batchKey, { mat, cast, receive, items }] of byKey.entries()) {
    if (items.length < 2) continue;   // a batch of one saves nothing — keep the mesh
    // MIXED INDEXED-NESS → de-index the group. BatchedMesh needs one or the
    // other across its geometries, and the layout key no longer splits on it
    // (see attrSig). De-indexing is the cheap, lossless direction — building an
    // index means deduplicating vertices, and it only costs the vertex sharing
    // on the minority side, which is why this runs ONLY when the group is
    // genuinely mixed. A uniform group is left exactly as it was.
    const indexedCount = items.reduce((n, it) => n + (it.geo.index ? 1 : 0), 0);
    if (indexedCount !== 0 && indexedCount !== items.length) {
      for (const it of items) {
        if (!it.geo.index) continue;
        let flat = deindexCache.get(it.geo);
        if (!flat) { flat = it.geo.toNonIndexed(); deindexCache.set(it.geo, flat); }
        it.geo = flat;
      }
    }
    // Size the batch: unique geometries (pooled geometry repeats across props).
    const uniqueGeos = new Map<THREE.BufferGeometry, number>();   // geo → vertex count (dedup)
    let maxVerts = 0, maxIndices = 0;
    for (const it of items) {
      const geo = it.geo;
      if (uniqueGeos.has(geo)) continue;
      uniqueGeos.set(geo, geo.attributes.position.count);
      maxVerts += geo.attributes.position.count;
      maxIndices += geo.index ? geo.index.count : geo.attributes.position.count;
    }
    const batch = new THREE.BatchedMesh(items.length, maxVerts, maxIndices, mat);
    batch.name = `static-batch-world`;
    // THE KEY THAT PUT THESE TOGETHER, kept on the object. A BatchedMesh earns
    // its keep by collapsing many objects into ONE render object, so the number
    // of batches is the number that matters — and when it is higher than it
    // should be, the only way to find out WHY is to see which of the three key
    // dimensions (material · attribute layout · shadow flags) split them. That
    // was invisible until this line existed.
    batch.userData.batchKey = batchKey;
    batch.castShadow = cast;
    batch.receiveShadow = receive;
    batch.frustumCulled = false;         // instances span the floor
    // Per-INSTANCE frustum culling OFF: r185 rewrote BatchedMesh's frustum
    // path (reversedDepth planes, shared frustum) and it wrongly culls live
    // instances at certain view angles — altar pedestals, the bonfire sword,
    // entry rocks vanished from stable viewpoints (2026-07-05 phone reports;
    // repro'd on depth-18 ritual circle: pedestal present with ?batchworld=0,
    // gone with batching on). The room culler already gates instances per
    // rect, so intra-rect frustum culling buys ~nothing at our scale — the
    // upstream bug costs us more than the culling saves.
    batch.perObjectFrustumCulled = false;
    batch.sortObjects = false;           // opaque only — skip the per-frame sort
    batch.matrixAutoUpdate = false;
    batch.matrixWorldAutoUpdate = false;

    const geoIds = new Map<THREE.BufferGeometry, number>();
    for (const it of items) {
      const geo = it.geo;
      let geoId = geoIds.get(geo);
      if (geoId === undefined) { geoId = batch.addGeometry(geo); geoIds.set(geo, geoId); }
      const id = batch.addInstance(geoId);
      it.mesh.updateWorldMatrix(true, false);
      batch.setMatrixAt(id, it.mesh.matrixWorld);
      let list = rectIndex.get(it.rectId);
      if (!list) { list = []; rectIndex.set(it.rectId, list); }
      list.push({ batch, id });
      it.mesh.removeFromParent();        // the batch draws it now (source geo stays un-disposed;
      batched++;                         // pooled geometry is shared, baked geometry GC's)
    }
    level.root.add(batch);               // teardown removes it with the level root
    liveBatches.push(batch);
    batchCount++;
  }

  // The colour-variant clones were copied into the batch buffers and never
  // rendered themselves — no GPU side exists; free the CPU copies now.
  for (const v of variantCache.values()) v.dispose();
  variantCache.clear();

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[static-batch] ${batched}/${candidates} static meshes → ${batchCount} batches (${bakedMats.size} baked families)`);
  }
}

/** Room-culler hook: toggle a rect's batched instances with its objects. */
export function setStaticBatchRectVisible(rectId: string, on: boolean): void {
  const list = rectIndex.get(rectId);
  if (!list) return;
  for (const e of list) e.batch.setVisibleAt(e.id, on);
}

/** Room-culler hook: restore every batched instance (culling disabled/dispose). */
export function showAllStaticBatches(): void {
  for (const [, list] of rectIndex) for (const e of list) e.batch.setVisibleAt(e.id, true);
}

/** Level teardown: dispose the batches (their internal geometry AND the
 *  matrices DataTexture — the generic teardown mesh-walk only frees
 *  `.geometry`, which would leak one texture per batch per floor). Runs in
 *  the same synchronous teardown block as the rest of the level's disposal,
 *  behind the descent cover. */
export function resetStaticBatches(): void {
  for (const b of liveBatches) {
    b.removeFromParent();
    // DEFERRED — a queued frame may still reference the batch's (large)
    // buffers; destroying them synchronously was part of the black-world
    // race. Dies at the next GPU-idle frame.
    deferGpuDispose(() => b.dispose());
  }
  rectIndex.clear();
  liveBatches = [];
}
