import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import { getAllInteractables } from '../interactables/system';

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

/** ?batchworld=1 enables. DEFAULT OFF — the implementation is complete and
 *  renders correctly (verified: visuals, per-rect culling, teardown, zero
 *  in-play compiles), but roughly one boot in three hits an INTERMITTENT
 *  race during the first-descent warm: `setIndexBuffer: parameter 1 is not
 *  of type 'GPUBuffer'` followed by a depth/output texture usage-scope error
 *  storm and a black world — the same signature the render-bundle experiment
 *  died on. Best current theory: the warm's render-target collapse/restore
 *  (setWarmLowRes) destroys pass textures while a submit that references
 *  them is still in flight, and the batches' larger first-frame buffer
 *  uploads widen the window. Fix the warm-resize/in-flight hazard (or land a
 *  Three upgrade) before flipping this on; the payoff measured so far is
 *  ~30 static render objects replacing ~150+ per floor.
 *
 *  ALSO KNOWN (tune before enabling): material-family fragmentation — 30
 *  batches/floor because shell/prop materials differ mostly by COLOUR.
 *  Baking colour into vertex attributes (one white vertexColors material per
 *  shading family) would collapse the flat-shaded stone family (~13 batches)
 *  into one. See the 2026-07-04 session notes. */
export function staticWorldBatchingEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('batchworld') === '1';
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

/** Attribute-layout signature — every geometry in one BatchedMesh must share
 *  the exact attribute set (names, item sizes, indexed-ness). */
function attrSig(geo: THREE.BufferGeometry): string {
  const names = Object.keys(geo.attributes).sort();
  return names.map((n) => `${n}:${geo.attributes[n].itemSize}`).join(',') + (geo.index ? '|i' : '|n');
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

interface Item { mesh: THREE.Mesh; rectId: string }

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

  // Collect batchable meshes per material-family key.
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; items: Item[] }>();
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
      const geo = m.geometry as THREE.BufferGeometry;
      if (!geo?.attributes?.position) return;
      candidates++;
      const key = `${matSig(mat)}§${attrSig(geo)}§${m.castShadow ? 'c' : ''}${m.receiveShadow ? 'r' : ''}`;
      let g = byKey.get(key);
      if (!g) { g = { mat, cast: m.castShadow, receive: m.receiveShadow, items: [] }; byKey.set(key, g); }
      g.items.push({ mesh: m, rectId: rectId! });
    });
  }

  let batched = 0;
  let batchCount = 0;
  for (const { mat, cast, receive, items } of byKey.values()) {
    if (items.length < 2) continue;   // a batch of one saves nothing — keep the mesh
    // Size the batch: unique geometries (pooled geometry repeats across props).
    const uniqueGeos = new Map<THREE.BufferGeometry, number>();   // geo → vertex count (dedup)
    let maxVerts = 0, maxIndices = 0;
    for (const it of items) {
      const geo = it.mesh.geometry as THREE.BufferGeometry;
      if (uniqueGeos.has(geo)) continue;
      uniqueGeos.set(geo, geo.attributes.position.count);
      maxVerts += geo.attributes.position.count;
      maxIndices += geo.index ? geo.index.count : geo.attributes.position.count;
    }
    const batch = new THREE.BatchedMesh(items.length, maxVerts, maxIndices, mat);
    batch.name = `static-batch-world`;
    batch.castShadow = cast;
    batch.receiveShadow = receive;
    batch.frustumCulled = false;         // instances span the floor; Three culls per instance
    batch.sortObjects = false;           // opaque only — skip the per-frame sort
    batch.matrixAutoUpdate = false;
    batch.matrixWorldAutoUpdate = false;

    const geoIds = new Map<THREE.BufferGeometry, number>();
    for (const it of items) {
      const geo = it.mesh.geometry as THREE.BufferGeometry;
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

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[static-batch] ${batched}/${candidates} static meshes → ${batchCount} BatchedMesh draws (?batchworld=0 to disable)`);
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
  for (const b of liveBatches) { b.removeFromParent(); b.dispose(); }
  rectIndex.clear();
  liveBatches = [];
}
