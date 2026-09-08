import type { DelveRenderer } from './create-renderer';

// ── STABLE UNIFORM / VARIABLE NAMES (three r185 WGSL codegen) ────────────────
//
// THE BUG, second verse. stable-buffer-names.ts fixed the buffer identifiers
// three derives from a GLOBAL node counter. The ordinary uniforms, textures
// and local variables have the same disease, from counters that are global to
// the BUILDER instead:
//
//   NodeBuilder.js:2087   const index = this.uniforms.index ++;      // uniforms AND attributes, both stages
//                         new NodeUniform( name || ( 'nodeUniform' + index ), ... )
//   NodeBuilder.js:1986   const index = this.uniforms.index ++;      // getBufferAttributeFromNode — same counter
//   NodeBuilder.js:2126   name = ( readOnly ? 'nodeConst' : 'nodeVar' ) + id;   // this.vars._var, both stages
//
// The vertex stage is built first, so every fragment uniform and variable is
// numbered AFTER however many uniforms, ATTRIBUTES and variables the vertex
// stage claimed. A skinned vertex stage claims two more attributes and a
// handful more variables than a plain one. The fragment shader that follows is
// the same shader with every identifier shifted by that count — and the
// shader source is the program cache key, so it compiles once per vertex
// layout it is paired with.
//
// MEASURED on a depth-3 floor after the buffer-name fix: 14 fragment programs
// behind `shared:std`, of which several pairs were byte-identical but for
// `nodeUniform2`→`nodeUniform0`, `nodeVar6`→`nodeVar0`. The shadow-depth
// material paid it three times over — one 49-line fragment shader compiled
// once per caster layout.
//
// THE FIX. Number things by the scope their name actually lives in:
//   - group uniforms  → per UNIFORM GROUP (`object.nu3`, `render.nu3` may
//     coexist). The group's struct is ONE declaration shared by both stages
//     (WGSLNodeBuilder.getUniforms emits every member of `this.uniformGroups`
//     into each stage), so a per-stage counter would produce duplicate
//     members; per-group is the finest scope that stays unique.
//   - textures / samplers → per builder (`nt3`, module-scope declarations).
//   - variables / consts  → per SHADER STAGE (`var<private>` is module-local).
// Names are assigned in the order three creates them, which is the graph's
// own order — the same for any two builds of the same graph — and attributes
// no longer perturb them. Only counter-derived names are touched; anything an
// author or three named deliberately passes through. The prefixes are ones
// three never generates, so they cannot collide with its declaration registry.
//
// The GPU-side wrapper (FloatNodeUniform, NodeSampledTexture…) COPIES the name
// at construction and the struct is emitted from the wrapper, so both the
// NodeUniform and its `uniformGPU` are renamed together.
//
// SAFE BY CONSTRUCTION: a uniform buffer's LAYOUT comes from the order of
// `binding.uniforms`, never from member names, and bindings are matched by
// index. The rename changes shader text and nothing else. `?stableshader=0`
// A/Bs it.
//
// Instance-patched on the backend, chained after stable-buffer-names (each
// wraps the builder's methods and only rewrites the names it recognises).

/* eslint-disable @typescript-eslint/no-explicit-any */

const COUNTER_UNIFORM = /^nodeUniform\d+$/;
const COUNTER_VAR = /^nodeVar\d+$/;
const COUNTER_CONST = /^nodeConst\d+$/;
const TEXTURE_TYPES = new Set(['texture', 'cubeTexture', 'cubeDepthTexture', 'storageTexture', 'texture3D']);

let installed = false;
let renamedUniforms = 0;
let renamedVars = 0;

export function shaderNameStats(): { installed: boolean; renamedUniforms: number; renamedVars: number } {
  return { installed, renamedUniforms, renamedVars };
}

/** Install on the live renderer right after `init()`. Idempotent; no-op off WebGPU. */
export function installStableShaderNames(renderer: DelveRenderer): void {
  const backend = (renderer as any).backend;
  if (!backend?.isWebGPUBackend || installed) return;
  if (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('stableshader') === '0') {
    if (import.meta.env.DEV) console.log('[stable-shader-names] disabled by ?stableshader=0');   // eslint-disable-line no-console
    return;
  }
  if (typeof backend.createNodeBuilder !== 'function') {
    if (import.meta.env.DEV) console.warn('[stable-shader-names] backend.createNodeBuilder missing — patch NOT installed');   // eslint-disable-line no-console
    return;
  }

  const origCreate = backend.createNodeBuilder.bind(backend);
  backend.createNodeBuilder = (object: unknown, rendererRef: unknown): unknown => {
    const builder: any = origCreate(object, rendererRef);
    if (!builder || typeof builder.getUniformFromNode !== 'function' || typeof builder.getVarFromNode !== 'function'
      || typeof builder.getDataFromNode !== 'function') return builder;

    // Counters live on the builder. A NodeUniform / NodeVar is renamed once,
    // the first time three hands it out (it caches and returns the same object
    // on later calls for the same node + stage).
    const groupCounters = new Map<string, number>();
    let textureCounter = 0;
    const stageCounters = new Map<string, { v: number; c: number }>();
    const stageCtr = (stage: unknown): { v: number; c: number } => {
      const k = String(stage);
      let c = stageCounters.get(k);
      if (!c) { c = { v: 0, c: 0 }; stageCounters.set(k, c); }
      return c;
    };
    const seen = new WeakSet<object>();

    const origGetUniform = builder.getUniformFromNode.bind(builder);
    builder.getUniformFromNode = function (node: any, type: string, shaderStage?: string, name: string | null = null): any {
      const stage = shaderStage ?? this.shaderStage;
      const u = origGetUniform(node, type, stage, name);
      if (!u || typeof u.name !== 'string' || seen.has(u) || !COUNTER_UNIFORM.test(u.name)) return u;
      seen.add(u);
      let stable: string;
      let gpu: any = null;
      try { gpu = this.getDataFromNode(node, stage, this.globalCache)?.uniformGPU ?? null; } catch { gpu = null; }
      if (TEXTURE_TYPES.has(type)) {
        stable = `nt${textureCounter++}`;
        // uniformGPU is `[texture]` or `[sampler, texture]`; the sampler's name is derived.
        if (Array.isArray(gpu)) {
          for (const g of gpu) {
            if (!g || typeof g.name !== 'string') continue;
            g.name = g.name.endsWith('_sampler') ? `${stable}_sampler` : stable;
          }
        }
      } else if (gpu && !Array.isArray(gpu) && typeof gpu.name === 'string' && gpu.name === u.name) {
        // A plain group uniform — the wrapper copied the counter name; rename both.
        const group = String(node?.groupNode?.name ?? 'g');
        const n = groupCounters.get(group) ?? 0;
        groupCounters.set(group, n + 1);
        stable = `nu${n}`;
        gpu.name = stable;
      } else {
        // Buffers (already `NodeBuffer_…`), or a wrapper we don't recognise —
        // leave three's name alone rather than desynchronise the two.
        return u;
      }
      u.name = stable;
      renamedUniforms++;
      return u;
    };

    const origGetVar = builder.getVarFromNode.bind(builder);
    builder.getVarFromNode = function (node: any, name: string | null = null, type?: string, shaderStage?: string, readOnly = false): any {
      const stage = shaderStage ?? this.shaderStage;
      // `type` is passed through untouched so three's own default
      // (`node.getNodeType(this)`) still applies when the caller omitted it.
      const v = origGetVar(node, name, type, stage, readOnly);
      if (v && typeof v.name === 'string' && !seen.has(v)) {
        if (COUNTER_VAR.test(v.name)) { seen.add(v); v.name = `nv${stageCtr(stage).v++}`; renamedVars++; }
        else if (COUNTER_CONST.test(v.name)) { seen.add(v); v.name = `nc${stageCtr(stage).c++}`; renamedVars++; }
      }
      return v;
    };
    return builder;
  };

  installed = true;
  if (typeof window !== 'undefined') {
    (window as unknown as { __shaderNameStats?: typeof shaderNameStats }).__shaderNameStats = shaderNameStats;
  }
  if (import.meta.env.DEV) console.log('[stable-shader-names] per-group uniform / per-stage variable names installed');   // eslint-disable-line no-console
}
