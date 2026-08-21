import type { DelveRenderer } from './create-renderer';

// ── STABLE UNIFORM-BUFFER NAMES (three r185 WGSL codegen) ────────────────────
//
// THE BUG. three names a shader's uniform/storage BUFFER after a global node
// counter:
//
//   WGSLNodeBuilder.js:1326   uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.id;
//   NodeUniform.js            get id() { return this.node.id; }   // global counter
//
// That identifier is emitted into the generated WGSL — both the struct
// declaration and every read of it:
//
//   struct NodeBuffer_583001Struct { value : array< mat4x4<f32>, 17 > }
//   ... skinWeight.x * NodeBuffer_583001.value[ ... ]
//
// So two meshes whose shaders are otherwise IDENTICAL emit byte-different
// source. three keys its ProgrammableStage cache on the source STRING
// (Pipelines.js: `this.programs.vertex` is a Map keyed by shader code), and the
// pipeline cache key is `stageVertex.id,stageFragment.id,<render state>` — so a
// one-token difference mints a new program, a new pipeline key, and a fresh GPU
// compile.
//
// WHO TRIPS IT. Anything that builds a per-object buffer node:
//   - Skinning.js:138 — `referenceBuffer('skeleton.boneMatrices', 'mat4',
//     bones.length)` runs PER SkinnedMesh. Since creatures are SkinnedMeshes,
//     every mob INSTANCE minted its own vertex shader, at spawn, mid-fight.
//   - InstancedMesh — the instance-matrix buffer (`array<mat4x4<f32>, N>`
//     indexed by `instanceIndex`), one per instanced group per floor.
//
// MEASURED on main @443dd437 (desktop Chrome, WebGPU, full warm, two floors):
// 279 distinct vertex shaders, 107 after normalising the identifier away — 62%
// pure duplicates. 363 pipelines vs 181 if the name were stable. Pairwise
// diffing the six biggest same-material/same-length shader groups found EVERY
// differing byte to be a `NodeBuffer_<id>` occurrence and nothing else.
//
// WHY IT IS A WARMUP PROBLEM AND NOT A WARMUP BUG. The identifier does not
// exist until the object is constructed, so the warm compiles instance A's
// shader and the live spawn is instance B. No amount of coverage can close
// that — it is the reason `census.inPlaySeen` sat at ~200 on a fully warmed
// session while `gaps` read empty (a later absorb folds the in-play compiles
// into the warm set). See docs/WARMUP.md + debug/pipeline-census.ts.
//
// THE FIX. Name the buffer after its SHAPE instead of its identity:
// `NodeBuffer_mat4_17`. Two skeletons with 17 bones then generate byte-identical
// WGSL, share one ProgrammableStage, and share one pipeline. We set the name on
// the NODE (three reads `this.name || builder.context.nodeName` at
// UniformNode.js:176), so it persists for that node's lifetime and every later
// build agrees — and we correct the NodeUniform in-flight so the build that
// triggered us emits the stable name too.
//
// Instance-patched on the backend, never three's prototypes — same shape as
// bundle-pass-order.ts. WebGPU only: the WebGL2 fallback has the same bug
// (GLSLNodeBuilder.js:1746) but assigns to `node.name` directly, so it needs a
// different hook and isn't the backend we ship on.
//
// REMOVE ON A THREE BUMP IF upstream makes the fallback name deterministic
// (mrdoob/three.js — the fix there is to number the buffer by its binding slot
// rather than by `node.id`). The install logs its seam check in DEV; if a bump
// renames `createNodeBuilder` / `getUniformFromNode` the patch declines to
// install rather than crash, and the pipeline count silently doubles again —
// which is what `window.__bufferNameStats()` is for.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The name three generates when it falls back to the node id. Matching this
 *  EXACTLY is the whole safety story: we only rewrite names three derived from
 *  a counter, never one an author or three itself chose deliberately. */
const ID_DERIVED = /^NodeBuffer_\d+$/;

/** Sanitise to a WGSL identifier fragment. */
function ident(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}

/** A name derived from the buffer's SHAPE, so structurally identical buffers in
 *  different objects agree. `bufferType`/`bufferCount` are BufferNode's own
 *  fields; the fallbacks cover StorageBufferNode and anything else that lands
 *  in the same branch. */
function shapeName(node: any): string {
  const type = ident(String(node?.bufferType ?? node?.nodeType ?? 'buf'));
  const count = Number(node?.bufferCount ?? node?.value?.length ?? node?.count ?? 0) || 0;
  return `NodeBuffer_${type}_${count}`;
}

let installed = false;
let renamed = 0;
let collisions = 0;

export interface BufferNameStats {
  installed: boolean;
  /** Buffer nodes given a shape-derived name (cumulative, session). */
  renamed: number;
  /** Times two DIFFERENT buffers wanted the same shape name inside one shader
   *  stage and the second was disambiguated (`…_2`). NOT a fault: DELVE's
   *  clustered-lighting fragment stage genuinely carries several same-shaped
   *  `UniformArrayNode`s (`vec4[16]` light colours vs `vec4[16]` positions,
   *  `vec4[48]`…) with distinct backing arrays, and each needs its own
   *  identifier. Measured ~1800/session against ~3200 renames. It matters only
   *  if it ever grows unbounded — that would mean the suffix, not the shape, is
   *  carrying the identity, and fragment programs would stop deduping. */
  collisions: number;
}

export function bufferNameStats(): BufferNameStats {
  return { installed, renamed, collisions };
}

/** Install on the live renderer right after `init()`. Patches the backend
 *  instance, not three's prototypes. Idempotent; no-op off WebGPU. */
export function installStableBufferNames(renderer: DelveRenderer): void {
  const backend = (renderer as any).backend;
  if (!backend?.isWebGPUBackend) return;
  if (installed) return;
  // ?stablebuf=0 — A/B the patch against upstream's id-derived names, for
  // attributing a rendering fault to the rename rather than guessing.
  if (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('stablebuf') === '0') {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[stable-buffer-names] disabled by ?stablebuf=0');
    }
    return;
  }
  if (typeof backend.createNodeBuilder !== 'function') {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[stable-buffer-names] backend.createNodeBuilder missing — patch NOT installed');
    }
    return;
  }

  const origCreate = backend.createNodeBuilder.bind(backend);
  backend.createNodeBuilder = (object: unknown, rendererRef: unknown): unknown => {
    const builder: any = origCreate(object, rendererRef);
    if (!builder || typeof builder.getUniformFromNode !== 'function') return builder;

    const origGet = builder.getUniformFromNode.bind(builder);
    // Naming is BUILDER-LOCAL and never written back to the node. A WGSL
    // identifier is module-scoped, so a node may legitimately be called
    // different things in two different shaders — what must hold is that ONE
    // shader never gives two nodes the same identifier (invalid WGSL, and the
    // vertex-buffer layout it produces does not match what the draw binds).
    //
    // Persisting the name on the node was the first attempt and it was wrong:
    // once a node carried a name, later builders reused it WITHOUT re-checking
    // it against the names already claimed in that shader, so two same-shaped
    // buffers could collide silently. Keeping the table per-builder makes the
    // check unconditional.
    // Keyed per SHADER STAGE, not per builder: a WGSL identifier is scoped to
    // its module, and the vertex and fragment modules are separate.
    const tables = new Map<string, { claimed: Map<string, unknown>; assigned: Map<unknown, string> }>();
    const tableFor = (stage: string): { claimed: Map<string, unknown>; assigned: Map<unknown, string> } => {
      let t = tables.get(stage);
      if (!t) { t = { claimed: new Map(), assigned: new Map() }; tables.set(stage, t); }
      return t;
    };

    builder.getUniformFromNode = function (
      node: any, type: string, shaderStage: string, name: string | null = null,
    ): any {
      const uniform = origGet(node, type, shaderStage, name);
      // Only the id-derived fallback. A buffer that carries a name three or an
      // author chose deliberately passes through untouched.
      if (!uniform || typeof uniform.name !== 'string' || !ID_DERIVED.test(uniform.name)) {
        return uniform;
      }
      const { claimed, assigned } = tableFor(String(shaderStage));
      // IDENTITY = the shared BUFFER three allocated for this node where it has
      // one (`getSharedDataFromNode` is three's own dedupe of the several node
      // wrappers that can reach one logical buffer), falling back to the node.
      const identity = (() => {
        try { return this.getSharedDataFromNode?.(node)?.buffer ?? node; }
        catch { return node; }
      })();
      let stable = assigned.get(identity);
      if (stable === undefined) {
        stable = shapeName(node);
        if (claimed.has(stable)) {
          // Two same-shaped buffers in ONE shader (e.g. current + previous-frame
          // bone matrices). Disambiguate rather than emit a duplicate identifier.
          collisions++;
          let n = 2;
          while (claimed.has(`${stable}_${n}`)) n++;
          stable = `${stable}_${n}`;
        }
        claimed.set(stable, identity);
        assigned.set(identity, stable);
        renamed++;
      }
      uniform.name = stable;
      return uniform;
    };
    return builder;
  };

  installed = true;
  if (typeof window !== 'undefined') {
    (window as unknown as { __bufferNameStats?: () => BufferNameStats })
      .__bufferNameStats = bufferNameStats;
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[stable-buffer-names] shape-derived uniform-buffer names installed');
  }
}
