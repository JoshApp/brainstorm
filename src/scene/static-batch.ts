import * as THREE from 'three';
import { attribute as tslAttribute } from 'three/tsl';
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

/** One instance inside a batch. `retired` is permanent removal — a smashed
 *  vase — as distinct from the culler's per-frame hide, which must never bring
 *  it back. Shared by reference between the rect index and the group index so
 *  either can retire it and both see it. */
interface BatchInstance { batch: THREE.BatchedMesh; id: number; retired: boolean }

// rectId → the batch instances belonging to that room rect (culler toggles).
const rectIndex = new Map<string, BatchInstance[]>();
// Top-level scene child → its instances. Only DESTRUCTIBLES need this: they are
// the one batched thing that can leave the world mid-floor, and the batch has to
// be told, because removing the (now empty) group from the scene no longer
// removes anything drawable.
const groupIndex = new Map<THREE.Object3D, BatchInstance[]>();
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

// ── THE UNLABELLED RESIDENTS ─────────────────────────────────────────────────
//
// The rect lookups in batchStaticWorld are an implicit ALLOWLIST: a root child
// that is not a destructible, not tagged `dbgKind:'prop'`, and carries no
// "<kind> · <rect>" dbgSource falls straight through `continue` and never
// reaches the batcher at all.
//
// Measured on a depth-3 floor (2026-08-10): the batcher SAW 282 static meshes
// and batched 280 of them — 99% efficiency on what reaches it — while ~300 more
// sat in 58 unlabelled root groups it never looked at (an unnamed 88-box
// masonry construct, an unnamed 40-piece arch, 16 identical 7-part fixtures,
// candelabra bodies…). The GATE was the ceiling, not the batcher. At the
// measured ~16.6µs of per-object GPU upload per frame, that is milliseconds a
// frame spent on stone that never moves.
//
// So: resolve those by BOUNDS. The fit check is the load-bearing part. A rect
// assignment drives room culling (setStaticBatchRectVisible), so getting it
// wrong does not cost a draw call — it makes stone VANISH while you are
// looking straight at it. That is the doorframe bug Josh reported, and
// room-culling.ts answers it for framed openings by assigning them to BOTH
// sides; a batch instance lives in exactly one rect and has no such answer.
// A group that straddles two rects is batched under NO_RECT: it joins a batch
// but never enters the rect index, so the room culler never toggles it.
//
// THIS DEPENDS ENTIRELY ON PER-INSTANCE FRUSTUM CULLING BEING ON, and the
// history is worth keeping because the first attempt got it exactly wrong. It
// shipped once while `perObjectFrustumCulled` was false, justified as "an
// instance nothing toggles has bit-for-bit the visibility it already had, since
// the room culler skips unlabelled children too". It did not. A loose mesh is
// still FRUSTUM culled every frame; a batch instance without per-instance
// culling is not. So ~240 instances did not keep their visibility, they lost
// their culling, and the phone showed the bill within the hour: draws 196 → 307
// while the object count FELL — the batch submitting the half of the floor
// behind the player, every frame.
//
// With per-instance culling on (verified on device 2026-08-10) the objection is
// gone: a NO_RECT instance is frustum culled exactly as the loose mesh was, and
// costs no render object on top. It gets one form of culling instead of the
// other, which is what it always had.
//
// If `?batchfrustum=0` is ever used to disable per-instance culling, this path
// becomes a regression again — which is why the sentinel is gated on it below
// rather than being unconditional.
const NO_RECT = '*';
const fitBox = new THREE.Box3();

/** Per-instance frustum culling inside a BatchedMesh. ON; `?batchfrustum=0`
 *  disables it (and, with it, the NO_RECT path above — see there for why). */
function perInstanceFrustumEnabled(): boolean {
  if (typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('batchfrustum') !== '0';
}

export function containedRectId(level: LiveLevel, obj: THREE.Object3D): string | null {
  fitBox.setFromObject(obj);
  if (fitBox.isEmpty()) return null;
  const id = rectIdAt(level, (fitBox.min.x + fitBox.max.x) / 2, (fitBox.min.z + fitBox.max.z) / 2);
  if (!id) return null;
  // No footprint corner may land in a DIFFERENT rect. Overhang into the void
  // (null — wall thickness, the dead space between rooms) is fine and normal:
  // masonry sits at the room edge and leans out of it by design, and rejecting
  // that threw away the biggest groups on the floor. What must never happen is
  // an object that also stands in the NEXT room getting filed under this one,
  // because then it blinks out with this room while you watch it from there.
  for (const [x, z] of [
    [fitBox.min.x, fitBox.min.z], [fitBox.max.x, fitBox.min.z],
    [fitBox.min.x, fitBox.max.z], [fitBox.max.x, fitBox.max.z],
  ]) {
    const corner = rectIdAt(level, x, z);
    if (corner !== null && corner !== id) return null;
  }
  return id;
}

interface Item { mesh: THREE.Mesh; rectId: string; geo: THREE.BufferGeometry; owner: THREE.Object3D | null }

// ── COLOUR → VERTEX BAKE ─────────────────────────────────────────────────────
// Most static materials differ ONLY by colour (the census: ~13 flat-shaded
// stone materials, all rough=1 metal=0, colours apart) — keying batches on the
// material value fragments them into near-singletons. For plain materials
// (no map, black emissive, opaque, front-side, no vertex colours) the colour
// is baked into a per-vertex `color` attribute instead, and every such mesh
// shares ONE white vertexColors material per shading family — mathematically
// identical output (base = color × vertexColor), one batch instead of ~13.
const bakedMats = new Map<string, THREE.MeshStandardMaterial>();

// ROUGHNESS + METALNESS RIDE THE VERTICES TOO, so they are absent here.
//
// Measured on a depth-3 floor: 22 batches, split by material=15, attrLayout=3,
// shadowFlags=3 — material was the dominant splitter, and it was splitting on
// NOTHING BUT SURFACE SCALARS. Four separate batches existed for `bake|f` at
// roughness 1.00, 0.95, 0.90 and 0.85: the same shading, four render objects,
// four indirect textures, because of a value that fits in one float per vertex.
//
// Colour and emissive already ride attributes for exactly this reason. Surface
// scalars are the same shape of problem and get the same answer, which leaves
// the family as what genuinely needs a distinct SHADER: flat vs smooth normals,
// and fog on/off.
function bakeFamilyKey(m: THREE.MeshStandardMaterial): string {
  return `${m.flatShading ? 'f' : 's'}|${(m as THREE.Material & { fog?: boolean }).fog === false ? 'nofog' : 'fog'}`;
}

function isBakeable(mat: THREE.Material): mat is THREE.MeshStandardMaterial {
  const m = mat as THREE.MeshStandardMaterial;
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
    && !m.map && !m.transparent && (m.alphaTest ?? 0) === 0
    && m.side === THREE.FrontSide && !m.vertexColors
    // A material that already OWNS its emissive — a creature's reveal/rim/
    // dissolve chain (ecs/build-model.ts) or anything else that installed an
    // emissiveNode — must keep it. Baking would overwrite the whole chain with
    // a flat attribute read and silently delete the rim.
    && !(m.userData as { reveal?: unknown }).reveal
    && (m as { emissiveNode?: unknown }).emissiveNode === undefined
    // …and a material whose emissive is DRIVEN AT RUNTIME cannot be baked at
    // all: the archway crown glow (scene/threshold-draft.ts writes
    // emissiveIntensity by player proximity) currently sits at intensity 0 when
    // the floor is built, so baking would freeze every gate dark forever. The
    // tag is set where the animation is installed — see level/frame.ts.
    && !(m.userData as { animatedEmissive?: boolean }).animatedEmissive;
}

function bakedMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const key = bakeFamilyKey(src);
  let m = bakedMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      // Scalars come from the geometry (see aSurface below). These stay at
      // three's defaults purely so the classic material is well-formed before
      // the node conversion overrides them.
      roughness: 1,
      metalness: 0,
      flatShading: src.flatShading,
      fog: (src as THREE.Material & { fog?: boolean }).fog,
    });
    // EMISSIVE RIDES THE VERTICES TOO, so a faint self-glow stops forking a
    // batch. Six of twelve static material families were unbakeable purely
    // because they carried a near-black emissive (06050a, 040303, 0a0805) —
    // values under 4% brightness, each buying its own render object.
    //
    // Same mechanism the creature reveal path has shipped on for months
    // (ecs/build-model.ts: "variation rides on attributes, not new shaders"):
    // an emissiveNode reading a per-vertex attribute. Three's WebGPU backend
    // carries `*Node` properties through its classic→node material conversion,
    // which is why this works on a plain MeshStandardMaterial.
    (m as unknown as { emissiveNode?: unknown }).emissiveNode =
      (tslAttribute as (n: string, t: string) => unknown)('aRevealEmissive', 'vec3');
    // …and so do ROUGHNESS + METALNESS, packed into one vec2. Same mechanism,
    // same reason: a surface scalar is per-SURFACE data, not a reason to compile
    // and bind a second shader. This is what collapses `bake|f|1.00|0.00` and
    // `bake|f|0.95|0.00` — identical shading, one float apart — into one batch.
    const surf = (tslAttribute as (n: string, t: string) => { x: unknown; y: unknown })('aSurface', 'vec2');
    (m as unknown as { roughnessNode?: unknown }).roughnessNode = surf.x;
    (m as unknown as { metalnessNode?: unknown }).metalnessNode = surf.y;
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
  src: THREE.MeshStandardMaterial,
): THREE.BufferGeometry {
  const color = src.color;
  // Emissive is premultiplied by its intensity here, exactly as the creature
  // reveal path does (build-model.ts) — the shared material has no emissive
  // scalar left to apply, so the attribute has to carry the finished value.
  const ei = src.emissiveIntensity ?? 1;
  const em = src.emissive ?? BLACK;
  const er = em.r * ei, eg = em.g * ei, eb = em.b * ei;
  // Roughness + metalness are part of the variant now, so they belong in the
  // key — without them two props sharing a geometry and a colour but finished
  // differently (polished bronze, dull stone) would collide on the first one.
  const rough = src.roughness ?? 1, metal = src.metalness ?? 0;
  const key = `${geo.uuid}|${color.getHexString()}|${em.getHexString()}|${ei.toFixed(3)}`
    + `|${rough.toFixed(3)}|${metal.toFixed(3)}`;
  let v = cache.get(key);
  if (v) return v;
  v = geo.clone();
  const n = v.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const eArr = new Float32Array(n * 3);
  const sArr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
    eArr[i * 3] = er; eArr[i * 3 + 1] = eg; eArr[i * 3 + 2] = eb;
    sArr[i * 2] = rough; sArr[i * 2 + 1] = metal;
  }
  v.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  v.setAttribute('aRevealEmissive', new THREE.BufferAttribute(eArr, 3));
  v.setAttribute('aSurface', new THREE.BufferAttribute(sArr, 2));
  cache.set(key, v);
  return v;
}

const BLACK = new THREE.Color(0x000000);

/**
 * Fold the level's static meshes into floor-wide BatchedMeshes (one per
 * material family). Call AFTER batchStaticFixtures (its merged output batches
 * too) and BEFORE the matrix freeze + room-culler creation.
 */
export function batchStaticWorld(level: LiveLevel): void {
  if (!staticWorldBatchingEnabled()) return;
  rectIndex.clear();
  groupIndex.clear();
  liveBatches = [];

  // Same exclusion set as the freeze pass: things that animate, open, or die.
  const excluded = new Set<THREE.Object3D>();
  for (const i of getAllInteractables()) { const g = i.built?.group; if (g) excluded.add(g); }
  // DESTRUCTIBLES ARE BATCHED. They were excluded with the enemies and the
  // interactables, on the reasoning that they "animate, open, or die" — but a
  // vase does none of the first two. It stands perfectly still until one swing
  // deletes it, and it is the single biggest bucket of drawables on a floor
  // (34% of visible drawables, measured). Nothing flashes it (userData.flash is
  // set only by enemy-presentation) and nothing raycasts it (tap-target sees
  // enemies and interactables only), so while it lives it is as static as a
  // wall. Its death is handled by retiring its instances — see below.
  const destructibleGroups = new Set<THREE.Object3D>();
  for (const d of level.destructibles) destructibleGroups.add(d.group);
  for (const t of level.torches) excluded.add(t.group);
  for (const e of level.enemies) excluded.add(e.group);

  level.root.updateMatrixWorld(true);

  // Collect batchable meshes per material-family key. Bakeable plain
  // materials collapse into one white vertexColors family (colour rides a
  // baked vertex attribute); the rest key on material value.
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; items: Item[] }>();
  const variantCache = new Map<string, THREE.BufferGeometry>();   // per-floor colour-variant cache
  let candidates = 0;
  let straddled = 0;      // unlabelled groups spanning two rects — batched, no room rect
  const perInstanceFrustum = perInstanceFrustumEnabled();
  for (const child of level.root.children.slice()) {
    if (excluded.has(child)) continue;
    let rectId: string | null = null;
    const isDestructible = destructibleGroups.has(child);
    // A destructible group carries no dbgKind/dbgSource (it is spawned straight
    // into the root by destructibles.ts), so resolve its rect by position the
    // same way a prop does — otherwise it silently fails the lookup below and
    // never batches at all.
    if (isDestructible) rectId = rectIdAt(level, child.position.x, child.position.z);
    else if (child.userData?.dbgKind === 'prop') rectId = rectIdAt(level, child.position.x, child.position.z);
    else if (typeof child.userData?.dbgSource === 'string') rectId = shellRectId(child.userData.dbgSource);
    // Unlabelled static residents — see containedRectId. Doors are the one
    // dbgKind excluded by name: a door's whole job is to move, and unlike a
    // torch or an enemy it is not guaranteed to be in the interactable set
    // by the time this runs.
    if (!rectId && child.userData?.dbgKind !== 'door') {
      rectId = containedRectId(level, child);
      // Only batch a straddler when its instances will still be frustum culled.
      if (!rectId && perInstanceFrustum) { rectId = NO_RECT; straddled++; }
    }
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
        geo = coloredVariant(variantCache, geo, mat);
        keyMat = `bake|${bakeFamilyKey(mat)}`;
      } else {
        keyMat = matSig(mat);
      }
      const key = `${keyMat}§${attrSig(geo)}§${m.castShadow ? 'c' : ''}${m.receiveShadow ? 'r' : ''}`;
      let g = byKey.get(key);
      if (!g) { g = { mat: batchMat, cast: m.castShadow, receive: m.receiveShadow, items: [] }; byKey.set(key, g); }
      g.items.push({ mesh: m, rectId: rectId!, geo, owner: isDestructible ? child : null });
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
    // Per-INSTANCE frustum culling — ON. `?batchfrustum=0` is the kill switch.
    //
    // NOTE ON SCOPE, because this is easy to misread: ordinary meshes are
    // frustum culled and always have been, via Object3D.frustumCulled tested by
    // the renderer against its own frustum. Nothing here ever touched that. This
    // is a DIFFERENT code path — BatchedMesh's PER-INSTANCE culling, which
    // builds its own frustum inside BatchedMesh.onBeforeRender.
    //
    // It was off from 2026-07-05, on a report that r185's rewritten frustum path
    // wrongly culled live instances (altar pedestals, the bonfire sword). That
    // no longer reproduces: verified on device 2026-08-10, a floor walked with
    // it on and nothing blinked out. Reading three 0.185.1 agrees — the WebGPU
    // renderer sets camera._reversedDepth when reversedDepthBuffer is on
    // (three.webgpu.js _updateCamera) and BatchedMesh passes camera.reversedDepth
    // into setFromProjectionMatrix. Either the original report predated a fix or
    // it was misattributed.
    //
    // This is what makes batching FREE rather than a trade. Without it, folding
    // a mesh into a batch deleted its frustum culling, and the phone showed the
    // bill: draws 196 → 307 while the object count fell. With it, a batched
    // instance is culled exactly as a loose mesh was, and the per-object
    // frontend cost is gone on top. Turning it on is the precondition for
    // everything else this file does.
    batch.perObjectFrustumCulled = perInstanceFrustum;
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
      const inst: BatchInstance = { batch, id, retired: false };
      // NO_RECT instances stay out of the index deliberately — nothing toggles
      // them by room; the per-instance frustum test is their culling.
      if (it.rectId !== NO_RECT) {
        let list = rectIndex.get(it.rectId);
        if (!list) { list = []; rectIndex.set(it.rectId, list); }
        list.push(inst);
      }
      if (it.owner) {
        let owned = groupIndex.get(it.owner);
        if (!owned) { owned = []; groupIndex.set(it.owner, owned); }
        owned.push(inst);
      }
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
    console.log(`[static-batch] ${batched}/${candidates} static meshes → ${batchCount} batches `
      + `(${bakedMats.size} baked families, ${straddled} groups span two rects → batched, frustum-culled only)`);
  }
}

/** Room-culler hook: toggle a rect's batched instances with its objects. */
export function setStaticBatchRectVisible(rectId: string, on: boolean): void {
  const list = rectIndex.get(rectId);
  if (!list) return;
  // A RETIRED instance stays hidden. Without this guard the culler resurrects
  // every smashed vase the moment its room comes back into view.
  for (const e of list) if (!e.retired) e.batch.setVisibleAt(e.id, on);
}

/**
 * Permanently hide the instances a destructible contributed — call when it
 * dies, INSTEAD of relying on removing its group from the scene. The group is
 * empty by then (the batch owns its meshes), so removing it draws nothing down.
 *
 * Returns true if this group was batched, so the caller can tell "handled" from
 * "never batched" (batching off, transparent material, singleton below the
 * two-item threshold — all of which still hold their own meshes).
 */
export function retireBatchedGroup(group: THREE.Object3D): boolean {
  const owned = groupIndex.get(group);
  if (!owned || owned.length === 0) return false;
  for (const e of owned) {
    e.retired = true;
    e.batch.setVisibleAt(e.id, false);
  }
  groupIndex.delete(group);
  return true;
}

/** Room-culler hook: restore every batched instance (culling disabled/dispose). */
export function showAllStaticBatches(): void {
  for (const [, list] of rectIndex) for (const e of list) if (!e.retired) e.batch.setVisibleAt(e.id, true);
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
