import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuiltModel } from './build-model';
// Not the bare env literal: this module is imported by tests/merge-static.test.ts
// under the tsx runner, where import.meta.env is undefined and a bare .DEV throws
// at module load. dev.ts guards that and still constant-folds to `false` under
// `vite build`. (Learned the hard way — adding the self-check below with the bare
// literal failed all 13 tests at once.)
import { DEV } from '../debug/dev';

// ── SUBTREE STATIC MERGE ─────────────────────────────────────────────────────
//
// Collapse the meshes inside ONE logical object into one mesh per material,
// without changing what the object IS.
//
// This is the answer to a measurement, not a hunch. The floor-wide batcher
// (scene/static-batch.ts) reports what it batched; a skip tally added alongside
// it reports what it did NOT, and on a depth-3 floor the answer was:
//
//     173  interactable (excluded set)      ← 70% of everything left loose
//      60  transparent (back-to-front ordering)
//       8  flame (animated flicker)
//       6  already instanced/batched
//
// Interactables are excluded from the batcher ON PURPOSE — they need individual
// identity for tap-targeting, state and removal, and folding them into a
// floor-wide batch would take that away. But the exclusion is about the object,
// not about the twenty boxes it happens to be BUILT from. A staircase measured
// 88 meshes across 9 materials; a merchant 20 across 7; a chest 13 across 4.
// Merging an object's own sub-meshes keeps it exactly one tappable thing and
// still collapses its draw calls, which is the win the batcher couldn't reach.
//
// WHY A THIRD MERGE FUNCTION EXISTS, briefly, because it is a fair question:
// build-model's mergeRigidSegments merges per NODE (so a rig's joints stay
// apart) and viewmodel-merge's mergeRigidViewmodel merges an entire subtree
// into its root (so the hand's slots survive only because of where they happen
// to sit). Neither can express "collapse everything EXCEPT these specific nodes,
// which something animates or removes" — which is exactly what an interactable
// needs, since a chest lid opens and a stair door swings.
//
// Both of those also share a hole this one closes: they remove a merged mesh
// with `removeFromParent()`, which takes ITS CHILDREN WITH IT. That is harmless
// for a hand whose bones are leaves, and silent data loss for anything else. A
// merged mesh here leaves a plain Object3D behind at the same local transform
// whenever it had children, so a preserved slot, sprite or glow keeps its exact
// place in the world.

/** A material's mergeability class. Reasons are strings so a DEV report can say
 *  WHY a mesh stayed loose, the same way the batcher's skip tally does. */
type Skip = string | null;

/** Material identity for bucketing. INSTANCE, not value signature — deliberately.
 *
 *  The world batcher keys on a value signature because its inputs are dead
 *  stone and two identical-looking materials are interchangeable there. Inside
 *  an interactable they are NOT: runtime code reaches for a specific material
 *  instance (`built.materials.get('rune')`) and mutates it — tint, emissive,
 *  opacity — so folding a mesh onto a DIFFERENT instance that merely looks the
 *  same would silently stop it responding.
 *
 *  This costs nothing. Measured across every interactable on a depth-3 floor,
 *  bucketing by instance and by value produced the SAME bucket count for every
 *  single object (9/9 on the staircase, 7/7 on the merchant, 4/4 on the chest)
 *  — because a model built from one ModelSpec already shares one material
 *  instance per material id. So the safe key is free. */
function bucketKey(m: THREE.Mesh, owner: THREE.Object3D): string {
  const mat = m.material as THREE.Material;
  return `${owner.uuid}|${mat.uuid}|${m.castShadow ? 'c' : ''}${m.receiveShadow ? 'r' : ''}`
    + `|${m.renderOrder}|${m.layers.mask}`;
}

/** Why this mesh can't be folded in, or null if it can. */
function skipReason(o: THREE.Object3D): Skip {
  const m = o as THREE.Mesh;
  if ((m as THREE.InstancedMesh).isInstancedMesh) return 'already instanced';
  if ((m as THREE.BatchedMesh).isBatchedMesh) return 'already batched';
  if ((m as THREE.SkinnedMesh).isSkinnedMesh) return 'skinned (bones move vertices)';
  if (Array.isArray(m.material)) return 'multi-material group';
  if (!m.geometry?.attributes?.position) return 'no position attribute';
  if (m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) return 'morph targets';
  if (!m.visible) return 'hidden (something controls its visibility)';
  if (m.name === 'flame') return 'flame (animated flicker)';
  if (m.userData?.dynamicPart) return 'dynamicPart (opted out)';
  const mat = m.material as THREE.MeshStandardMaterial;
  // TRANSPARENT stays loose: merging fuses two draws into one sort position, so
  // whatever ordering the author arranged between them is gone. Additive blending
  // IS order-independent and could be merged — but only against other additive
  // meshes, and the win here is in the opaque mass, so it isn't worth the
  // special case yet.
  if (mat.transparent) return 'transparent (back-to-front ordering)';
  // TEXTURED stays loose: the merge normalizes the attribute set, and a uv that
  // means something is not safe to rewrite. (Same rule as viewmodel-merge.)
  if (mat.map) return 'textured (uv would not survive)';
  // A material whose emissive is DRIVEN AT RUNTIME must keep its own mesh —
  // same tags the world batcher honours, same reason.
  if ((mat.userData as { animatedEmissive?: boolean })?.animatedEmissive) return 'animated emissive';
  if ((mat.userData as { reveal?: unknown })?.reveal) return 'reveal/dissolve chain';
  return null;
}

export interface MergeStaticResult {
  /** Meshes considered (everything under the root). */
  before: number;
  /** Meshes remaining after the merge. */
  after: number;
  /** Reason → count, for the meshes that stayed loose. */
  skipped: Record<string, number>;
}

export interface MergeStaticOptions {
  /**
   * Meshes that must survive as themselves because something looks them up and
   * moves, hides or swaps them. Authored-named nodes are protected
   * automatically (see below); this is for the ones nothing names.
   */
  boundaries?: Iterable<THREE.Object3D | undefined>;
  /** Name stamped on merged meshes, for debug overlays. */
  label?: string;
  /**
   * Fold AUTHORED-named parts in too. Off by default, because a name is
   * normally a reference.
   *
   * Turn it on only for an object whose parts are never looked up after build.
   * That is a claim about a specific file, so CHECK IT (`grep 'parts\.\|slots\.'`
   * in the interactable) rather than assuming — and it matters: a ModelSpec
   * names nearly every part, so with names protected a model-built prop merges
   * almost nothing. The merchant measured 20 → 17 meshes with names honoured
   * and 20 → 7 without, and nothing in merchant.ts touches parts or slots.
   * (`mergeRigidSegments` carries the same option, for the same reason.)
   */
  ignoreNames?: boolean;
}

// ── WHY THE MERGE SCOPE IS "ONE PARENT NODE", NOT "THE WHOLE SUBTREE" ────────
//
// A mesh only ever merges with its OWN SIBLINGS, into their shared parent. It
// never crosses a group boundary, even an unnamed one.
//
// That looks over-cautious until you read stairs.ts, which builds an unnamed
// `wardGroup` holding the boss seal and then writes `wardGroup.visible =
// sealActive` — one assignment, hiding a dozen meshes. Fold those meshes up
// into the staircase root and that line silently stops working: the seal is
// drawn over a boss door that is already open, and nothing anywhere errors.
//
// The same shape recurs everywhere — a group's `visible`, its transform, its
// removal on some event. NONE of it is visible to static analysis, and an
// unnamed group is not a promise that nobody touches it. So the structure the
// author built IS the safety boundary, and the merge respects it.
//
// This costs almost nothing where it matters. Measured: the staircase's 52
// opaque meshes are all direct children of one group, so per-node scoping
// collapses them to 9 exactly as a subtree-wide merge would. Grouping is how
// authors express "these belong together", which is very close to "these share
// a material" already.

/**
 * Merge the static meshes under `root` into one mesh per (boundary, material).
 * Returns what it did — callers log it; tests assert on it.
 *
 * Safe to call on a subtree that is already in the scene: the merged mesh is
 * added and the sources are detached in the same tick, so nothing flickers.
 */
export function mergeStaticSubtree(root: THREE.Object3D, opts: MergeStaticOptions = {}): MergeStaticResult {
  const label = opts.label ?? 'static-merged';
  const skipped: Record<string, number> = {};
  const note = (r: string): void => { skipped[r] = (skipped[r] ?? 0) + 1; };

  // Protected meshes — never merged away, because something looks them up.
  // Anything the caller named, plus any AUTHORED-named node: a name is how the
  // rest of the codebase finds a part (`built.parts.get('lid')`), so a name is a
  // declaration that something may reach for it. Auto-generated debug names
  // (userData.autoName) are labels, not references, and protect nothing.
  const protectedNodes = new Set<THREE.Object3D>([root]);
  for (const b of opts.boundaries ?? []) if (b) protectedNodes.add(b);
  if (!opts.ignoreNames) {
    root.traverse((o) => {
      if (o !== root && o.name && o.userData?.autoName !== true) protectedNodes.add(o);
    });
  }

  root.updateMatrixWorld(true);
  const pre = { box: DEV ? measure(root) : (null as never) };

  // Bucket every mergeable mesh under ITS OWN PARENT (see the scope note above).
  interface Bucket { owner: THREE.Object3D; mat: THREE.Material; meshes: THREE.Mesh[]; proto: THREE.Mesh }
  const buckets = new Map<string, Bucket>();
  let before = 0;

  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    before++;
    if (protectedNodes.has(o)) { note('named part (something looks it up)'); return; }
    const reason = skipReason(o);
    if (reason) { note(reason); return; }
    const m = o as THREE.Mesh;
    const owner = m.parent;
    if (!owner) return;
    const key = bucketKey(m, owner);
    let b = buckets.get(key);
    if (!b) { b = { owner, mat: m.material as THREE.Material, meshes: [], proto: m }; buckets.set(key, b); }
    b.meshes.push(m);
  });
  // Sprites aren't meshes, so the traverse above never sees them; count the
  // skip anyway so the tally explains the whole object.
  root.traverse((o) => { if ((o as THREE.Sprite).isSprite) note('sprite (billboard)'); });

  const inv = new THREE.Matrix4();
  const local = new THREE.Matrix4();

  for (const b of buckets.values()) {
    if (b.meshes.length < 2) { note('lone mesh for its material (a merge of one saves nothing)'); continue; }

    inv.copy(b.owner.matrixWorld).invert();
    const geos: THREE.BufferGeometry[] = [];
    for (const m of b.meshes) {
      // Bake the mesh's transform RELATIVE TO ITS OWNER, so the merged mesh sits
      // correctly whether the owner is the root or a lid that will swing.
      local.multiplyMatrices(inv, m.matrixWorld);
      let g = m.geometry.clone().applyMatrix4(local);
      // Normalize the attribute set. mergeGeometries needs every input to agree
      // and returns NULL (silently) when they don't — the failure mode that left
      // whole buckets unmerged in two previous merge passes. position+normal+uv
      // is also the layout the pipeline warm already covers, so a merged mesh
      // doesn't mint a fresh shader variant (see viewmodel-merge for the hitch
      // that taught us to keep uv rather than strip it).
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
      geos.push(g);
    }

    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) { note('attribute mismatch (mergeGeometries refused)'); continue; }

    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.name = label;
    mesh.castShadow = b.proto.castShadow;
    mesh.receiveShadow = b.proto.receiveShadow;
    mesh.renderOrder = b.proto.renderOrder;
    mesh.layers.mask = b.proto.layers.mask;
    b.owner.add(mesh);

    for (const m of b.meshes) detach(m);
  }

  let after = 0;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) after++; });

  // SELF-CHECK. A merge is only correct if the drawn result is the SAME PICTURE
  // with fewer draws, and the two ways it goes wrong — geometry baked into the
  // wrong frame, or a child silently deleted along with its merged parent —
  // both show up as a change in what the object occupies or how many triangles
  // it has. A screenshot can't be trusted to catch either (the `chest` debug
  // scenario doesn't reliably frame the chest, so a before/after pair compared
  // two different views and would have "passed" any regression). This does,
  // deterministically, on every object, every build.
  if (DEV) {
    const box = measure(root);
    const drift = Math.max(pre.box.min.distanceTo(box.min), pre.box.max.distanceTo(box.max));
    if (drift > 1e-3) {
      // eslint-disable-next-line no-console
      console.error(`[merge-static] ${label} MOVED ${drift.toFixed(4)}m — geometry was baked in the wrong frame`);
    }
    if (box.tris !== pre.box.tris) {
      // eslint-disable-next-line no-console
      console.error(`[merge-static] ${label} LOST GEOMETRY: ${pre.box.tris} → ${box.tris} triangles`);
    }
  }
  return { before, after, skipped };
}

/** World bounds + triangle count of everything drawable under a root. Both
 *  halves matter: bounds catch a mis-baked transform, triangles catch a
 *  vanished child that happened to sit inside the existing silhouette. */
function measure(root: THREE.Object3D): { min: THREE.Vector3; max: THREE.Vector3; tris: number; box: THREE.Box3 } {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    box.expandByObject(m);
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  if (box.isEmpty()) { box.min.set(0, 0, 0); box.max.set(0, 0, 0); }
  return { min: box.min, max: box.max, tris, box };
}

/**
 * Remove a merged-away mesh WITHOUT taking its children with it.
 *
 * This is the whole reason this module exists rather than reusing one of the
 * two older merge passes. `removeFromParent()` on a mesh that still has
 * children deletes those children from the scene silently — no error, no
 * warning, they are simply not drawn again. A stair mesh with a glow plane
 * parented to it, a pedestal with a slot where a reward spawns: merge the
 * parent and the child vanishes, and the only symptom is that something you
 * expected to see isn't there.
 *
 * So when the mesh has children, a plain Object3D takes its exact local
 * transform and adopts them. Same parent, same local transform → identical
 * world matrices for the whole subtree, one fewer draw call.
 */
function detach(m: THREE.Mesh): void {
  const parent = m.parent;
  if (!parent) return;
  if (m.children.length) {
    const holder = new THREE.Object3D();
    holder.name = m.name || 'merged-holder';
    holder.position.copy(m.position);
    holder.quaternion.copy(m.quaternion);
    holder.scale.copy(m.scale);
    holder.visible = m.visible;
    for (const c of m.children.slice()) holder.add(c);
    parent.add(holder);
  }
  parent.remove(m);
  // The source geometry is NOT disposed: it is frequently POOLED (pooledBox /
  // pooledPlane hand out the same BufferGeometry to dozens of callers), and the
  // outline pass builds its hulls from the very same instance. Detaching is the
  // whole job; the clone that went into the batch was already freed above.
}

/**
 * DEV log for one merge. The skip tally is the point: a merge that saved
 * nothing looks identical to one that was never called, and the difference
 * between "there is no win here" and "the win is being skipped for a reason I
 * could remove" is exactly what the floor batcher's own tally made visible.
 * `?mergereport=1` prints the per-reason breakdown too.
 */
export function reportMerge(what: string, res: MergeStaticResult): void {
  if (!DEV) return;
  const saved = res.before - res.after;
  // eslint-disable-next-line no-console
  console.log(`[merge-static] ${what}: ${res.before} → ${res.after} meshes (−${saved})`);
  const verbose = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('mergereport') === '1';
  if (!verbose) return;
  const rows = Object.entries(res.skipped).sort((a, b) => b[1] - a[1]);
  if (rows.length) {
    // eslint-disable-next-line no-console
    console.log(`[merge-static] ${what} skips:\n`
      + rows.map(([r, n]) => `    ${String(n).padStart(4)}  ${r}`).join('\n'));
  }
}

/**
 * Merge an interactable's own static meshes, keeping every part the game holds
 * a reference to. The wrapper the interactables actually call.
 *
 * Everything in `built.parts` and `built.slots` is protected, because those maps
 * ARE the reference list — `chest.ts` looks up `parts.get('lid')` to swing it and
 * `slots.get('loot_spawn')` to spawn at it. A mesh the caller moves that is in
 * NEITHER map and carries no authored name has to be passed in `extraBoundaries`.
 * (Groups don't need protecting: the merge never crosses one.)
 */
export function mergeInteractableStatics(
  built: BuiltModel,
  opts: {
    label?: string;
    extraBoundaries?: Iterable<THREE.Object3D | undefined>;
    ignoreNames?: boolean;
  } = {},
): MergeStaticResult {
  // `parts` IS the authored-name map, so under ignoreNames it must not be fed
  // back in as boundaries — doing so silently cancels the option out (measured:
  // the merchant stayed at 20 → 17 with ignoreNames set, because all 13 of its
  // named meshes were still protected via this list). `slots` stays protected
  // either way: a slot is an attachment point, and things get parented to it.
  const boundaries: Array<THREE.Object3D | undefined> = [
    ...(opts.ignoreNames ? [] : built.parts.values()),
    ...built.slots.values(),
    ...(opts.extraBoundaries ?? []),
  ];
  const res = mergeStaticSubtree(built.group, {
    boundaries,
    label: opts.label ?? 'interactable-merged',
    ignoreNames: opts.ignoreNames,
  });
  // hitTargets referenced meshes that may now be detached — rebuild from the
  // survivors, exactly as mergeRigidSegments does after its own merge.
  if (built.hitTargets.length) {
    built.hitTargets.length = 0;
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) built.hitTargets.push(o); });
  }
  return res;
}
