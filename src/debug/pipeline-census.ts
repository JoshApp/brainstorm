import type { DelveRenderer } from '../scene/create-renderer';

// ── PIPELINE CENSUS — warm coverage, measured ────────────────────────────────
//
// The warm (content/warmup-pass.ts + warm-real-roster + warmSceneCompile) is
// CONSTRUCTIVE: it builds subjects and hopes they cover the pipeline key space.
// Nothing ever asserted that they did. So "postWarmup must be 0" was a claim in
// docs/WARMUP.md, not a measurement — and phone recordings kept showing 80
// in-play compiles against it.
//
// This closes the loop. It snapshots the set of pipeline cache keys the WARM
// produced, then diffs the live cache against it and says, per surviving gap,
// WHICH FIELD of the key differs. That is the coverage report other engines
// give you (UE5 calls it PSO precaching); WebGPU exposes no persistent pipeline
// cache we can ship, so the report is the lever we actually have.
//
// PROD-SAFE and cheap: two Set scans, only on demand (recording save / the
// window hook). It rides along with a recording for the same reason the upload
// census does — the behaviour is WebGPU-only, so it can only be measured on a
// real device, and a number that never reaches the phone is not a measurement.
//
// ── The key layout ───────────────────────────────────────────────────────────
// three composes a render pipeline's cache key in exactly two places:
//   Pipelines._getRenderCacheKey  → `${stageVertex.id},${stageFragment.id},${backend.getRenderCacheKey(o)}`
//   WebGPUBackend.getRenderCacheKey → the material/render-state array below, .join()ed
// so the field ORDER here is not a guess — it mirrors those two functions. If a
// three upgrade reorders that array, `decodePipelineKey` starts mislabeling and
// the tests in tests/pipeline-census.test.ts are what will catch it.

/** Field names of three's WebGPU render-pipeline cache key, in key order.
 *  Fields past `topology` are the geometry cache key (variable length —
 *  attribute names/strides, then bone count) followed by the clipping key. */
export const KEY_FIELDS = [
  'vertexStage', 'fragmentStage',
  'transparent', 'blending', 'premultipliedAlpha',
  'blendSrc', 'blendDst', 'blendEquation',
  'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha',
  'colorWrite',
  'depthWrite', 'depthTest', 'depthFunc',
  'stencilWrite', 'stencilFunc',
  'stencilFail', 'stencilZFail', 'stencilZPass',
  'stencilFuncMask', 'stencilWriteMask',
  'side', 'frontFaceCW',
  'sampleCount',
  'colorSpace', 'colorFormat', 'depthStencilFormat',
  'topology',
] as const;

/** Index of the first geometry-cache-key field (everything after `topology`). */
const TAIL_AT = KEY_FIELDS.length;

export interface DecodedKey {
  /** Shader program ids. Three mints a new one ONLY for byte-new WGSL
   *  (Pipelines.programs.vertex is a Map keyed by the shader source), so a
   *  changed id means a genuinely different program, not a renamed one. */
  vertexStage: string;
  fragmentStage: string;
  /** Fixed-function render state, field-named. */
  state: Readonly<Record<string, string>>;
  /** Geometry attribute layout + skeleton + clipping — the variable-length tail. */
  tail: string;
}

/** Split a raw cache key into named fields. Pure — the whole point is that the
 *  decode is testable in node while the thing it decodes is WebGPU-only. */
export function decodePipelineKey(key: string): DecodedKey {
  const p = key.split(',');
  const state: Record<string, string> = {};
  for (let i = 2; i < TAIL_AT; i++) state[KEY_FIELDS[i]] = p[i] ?? '';
  return {
    vertexStage: p[0] ?? '',
    fragmentStage: p[1] ?? '',
    state,
    tail: p.slice(TAIL_AT).join(','),
  };
}

/** Everything that identifies a pipeline EXCEPT which shader program it runs.
 *  Two keys sharing this differ only in their WGSL — the program-churn case. */
export function stateSignature(d: DecodedKey): string {
  return KEY_FIELDS.slice(2).map((f) => d.state[f] ?? '').join(',') + '|' + d.tail;
}

/** Named field differences between two decoded keys (render state only). */
export function diffState(live: DecodedKey, warm: DecodedKey): string[] {
  const out: string[] = [];
  for (let i = 2; i < TAIL_AT; i++) {
    const f = KEY_FIELDS[i];
    if (live.state[f] !== warm.state[f]) out.push(`${f} ${warm.state[f] || '∅'}→${live.state[f] || '∅'}`);
  }
  if (live.tail !== warm.tail) out.push('geometry/clipping layout differs');
  return out;
}

export type Verdict =
  /** The warm never produced this render state at all — a true coverage gap.
   *  Fix: warm a subject that renders in this state. */
  | 'NOT-WARMED'
  /** Same render state AND same geometry layout as something warmed, but a
   *  different shader program. The warm cannot fix this by building more
   *  subjects — the program itself is being re-minted. Fix: share the material
   *  instance (so its WGSL is generated once) or stop it being disposed. */
  | 'PROGRAM-CHURN'
  /** Warmed the same material family but in a different render state; the
   *  detail names the field. Fix: warm at THIS state. */
  | 'STATE-MISMATCH'
  /** Byte-identical to a key the warm produced, compiled anyway — the warm's
   *  pipeline was evicted (three releases a pipeline at usedTimes 0) or the
   *  browser cache missed. Fix: retain whatever held it. */
  | 'RECOMPILE';

export interface CensusEntry {
  name: string;
  count: number;
  verdict: Verdict;
  detail: string;
}

export interface PipelineCensus {
  /** Whether the key carries render state at all. WebGLBackend.getRenderCacheKey
   *  returns '' — on that backend a key is only `vtxId,fragId,`, so every field
   *  label would be empty and EVERY gap would read as PROGRAM-CHURN. Say so
   *  instead of quietly reporting a verdict the key can't support. */
  keySpace: 'webgpu-full' | 'stateless';
  /** Distinct pipeline keys the warm passes produced. */
  warmed: number;
  /** Pipelines resident in three's cache at capture time. */
  resident: number;
  /** Warm keys NO LONGER resident — three released them (usedTimes hit 0).
   *  A non-zero count means the warm's work is being thrown away, which no
   *  amount of extra warm coverage can fix. */
  evicted: number;
  /** Post-warm compiles, grouped and classified, worst first. */
  gaps: CensusEntry[];
}

/** Classify one live key against the warm set. Pure. */
export function classifyKey(
  live: string,
  warmKeys: readonly string[],
  warmDecoded?: readonly DecodedKey[],
): { verdict: Verdict; detail: string } {
  if (warmKeys.length === 0) return { verdict: 'NOT-WARMED', detail: 'no warm set was captured' };
  if (warmKeys.includes(live)) {
    return { verdict: 'RECOMPILE', detail: 'identical key was warmed — the warmed pipeline was released or missed' };
  }
  const d = decodePipelineKey(live);
  const sig = stateSignature(d);
  const warm = warmDecoded ?? warmKeys.map(decodePipelineKey);
  const churn = warm.filter((w) => stateSignature(w) === sig);
  if (churn.length) {
    const ids = churn.slice(0, 3).map((w) => `${w.vertexStage}/${w.fragmentStage}`).join(' ');
    return {
      verdict: 'PROGRAM-CHURN',
      detail: `identical render state + geometry layout, new shader program `
        + `(${d.vertexStage}/${d.fragmentStage}; warm had ${ids}) — the WGSL is being re-minted, not the state`,
    };
  }
  // Nearest warmed key = fewest differing state fields, tail-match preferred.
  let best: DecodedKey | null = null;
  let bestDiff: string[] = [];
  for (const w of warm) {
    const diff = diffState(d, w);
    if (!best || diff.length < bestDiff.length) { best = w; bestDiff = diff; }
  }
  if (!best || bestDiff.length > 6) {
    return { verdict: 'NOT-WARMED', detail: 'no warmed pipeline resembles this one' };
  }
  return { verdict: 'STATE-MISMATCH', detail: bestDiff.join('; ') };
}

// ── The live side ────────────────────────────────────────────────────────────

/** three's private pipeline cache. Read-only; the same map `pipelineCount()`
 *  and frame-timing's compile capture already read. */
interface PipelineEntry {
  vertexProgram?: { name?: string };
  fragmentProgram?: { name?: string };
  computeProgram?: { name?: string };
}
export function pipelineCacheOf(r: DelveRenderer): Map<string, PipelineEntry> | null {
  return (r as unknown as { _pipelines?: { caches?: Map<string, PipelineEntry> } })._pipelines?.caches ?? null;
}
function nameOf(p: PipelineEntry | undefined): string {
  return p?.vertexProgram?.name || p?.fragmentProgram?.name || p?.computeProgram?.name || '?';
}

const warmKeys = new Set<string>();
let sealed = false;
// The renderer the warm ran on, remembered so a recording can take a census
// without the recorder having to import the renderer (it deliberately doesn't —
// see its scene-audit provider for the same reason).
let censusRenderer: DelveRenderer | null = null;

/** Fold everything currently in the pipeline cache into the warm set. Call at
 *  the END of each warm pass — boot warm, roster warm, per-descent scene
 *  compile, prepare pass. Idempotent and additive: warms run at several points
 *  and the union of them is what "the warm produced" means. */
export function absorbWarmPipelines(r: DelveRenderer): void {
  const caches = pipelineCacheOf(r);
  if (!caches) return;
  for (const k of caches.keys()) warmKeys.add(k);
  sealed = true;
  censusRenderer = r;
}

/** The census for whatever renderer the warm ran on — null before any warm.
 *  This is the recorder's entry point. */
export function censusForRecording(): PipelineCensus | null {
  return censusRenderer ? takePipelineCensus(censusRenderer) : null;
}

/** How many distinct pipelines the warm has produced so far. */
export function warmedPipelineCount(): number { return warmKeys.size; }

/** Diff the live pipeline cache against the warm set and classify every gap.
 *  Returns null before any warm has been absorbed (nothing to diff against). */
export function takePipelineCensus(r: DelveRenderer): PipelineCensus | null {
  if (!sealed) return null;
  const caches = pipelineCacheOf(r);
  if (!caches) return null;
  const warmList = [...warmKeys];
  const warmDecoded = warmList.map(decodePipelineKey);
  let resident = 0;
  const grouped = new Map<string, CensusEntry>();
  for (const [k, p] of caches) {
    resident++;
    if (warmKeys.has(k)) continue;
    const { verdict, detail } = classifyKey(k, warmList, warmDecoded);
    const name = nameOf(p);
    // Group by what a fix would address — the material and the reason — so 31
    // deaths minting 31 programs read as ONE finding with a count, not 31 rows.
    const g = grouped.get(`${name}|${verdict}`);
    if (g) g.count++;
    else grouped.set(`${name}|${verdict}`, { name, count: 1, verdict, detail });
  }
  let evicted = 0;
  for (const k of warmKeys) if (!caches.has(k)) evicted++;
  // A key that never reaches `topology` carries no backend render state — that's
  // the WebGL2 fallback, where getRenderCacheKey() returns ''.
  const stateful = warmList.some((k) => k.split(',').length > TAIL_AT);
  return {
    keySpace: stateful ? 'webgpu-full' : 'stateless',
    warmed: warmKeys.size,
    resident,
    evicted,
    gaps: [...grouped.values()].sort((a, b) => b.count - a.count),
  };
}

/** Expose on window so the census is one call away in DevTools on a phone,
 *  not only inside a recording. Prod-safe (read-only diagnostics). */
export function installPipelineCensusHook(r: DelveRenderer): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __pipelineCensus?: () => unknown }).__pipelineCensus = () => takePipelineCensus(r);
}
