import { DEV } from './dev';
import { CONFIG } from '../config';
import { pipelineCacheOf } from './pipeline-census';
import type { DelveRenderer } from '../scene/create-renderer';

// ── PIPELINE BUDGET — the number that is not allowed to grow back ────────────
//
// 2026-09-08: one floor compiled 175 pipelines and 127 shader programs, and
// nobody had noticed because nothing was watching. The count got there one
// material flag, one bone count, one authored `fog: false` at a time. After
// the lean pass (docs/PIPELINE-BUDGET.md, "What a pipeline is actually made
// of") it sits well under the budget below; this check is what keeps it there.
//
// Measured at every covered warm point (warm-cache.ts noteCoveredWarmPoint —
// the descent prewarm, after a floor's set is compiled), on the metrics that
// matter:
//   - PROGRAMS: distinct vertex/fragment pairs — each is a shader compile.
//   - PIPELINES: distinct (vertex, fragment, render state) — what the GPU
//     actually builds. three's own cache also splits on vertex-layout
//     bookkeeping (indexed vs not, unused attributes) that never reaches the
//     descriptor, so its raw count runs ~15% higher and is not the budget.
//
// DEV only. Over budget is a console.error with the top offenders, so the
// material or layout that pushed it over is named the moment it lands.

const KEY_FIELDS_BEFORE_TAIL = 29;   // mirrors pipeline-census KEY_FIELDS.length

export interface PipelineBudgetReport {
  programs: number;
  pipelines: number;
  budget: { programs: number; pipelines: number };
  over: boolean;
  /** Material families by pipeline count, worst first. */
  top: Array<{ name: string; pipelines: number; programs: number }>;
}

export function measurePipelineBudget(renderer: DelveRenderer): PipelineBudgetReport | null {
  const cache = pipelineCacheOf(renderer);
  if (!cache) return null;
  const programs = new Set<string>();
  const pipelines = new Set<string>();
  const byName = new Map<string, { pipelines: number; programs: Set<string> }>();
  for (const [key, p] of cache) {
    if (p.computeProgram) continue;
    const parts = key.split(',');
    const prog = `${parts[0]}/${parts[1]}`;
    programs.add(prog);
    pipelines.add(`${prog}|${parts.slice(2, KEY_FIELDS_BEFORE_TAIL).join(',')}`);
    const name = p.vertexProgram?.name || p.fragmentProgram?.name || '?';
    let e = byName.get(name);
    if (!e) { e = { pipelines: 0, programs: new Set() }; byName.set(name, e); }
    e.pipelines++;
    e.programs.add(prog);
  }
  const budget = CONFIG.PIPELINE_BUDGET;
  const top = [...byName.entries()]
    .map(([name, e]) => ({ name, pipelines: e.pipelines, programs: e.programs.size }))
    .sort((a, b) => b.pipelines - a.pipelines)
    .slice(0, 8);
  return {
    programs: programs.size,
    pipelines: pipelines.size,
    budget,
    over: programs.size > budget.programs || pipelines.size > budget.pipelines,
    top,
  };
}

let lastReport: PipelineBudgetReport | null = null;
export function lastPipelineBudget(): PipelineBudgetReport | null { return lastReport; }

/** DEV: measure and shout if over. Safe to call often; it is two Set scans. */
export function checkPipelineBudget(renderer: DelveRenderer): void {
  if (!DEV) return;
  const r = measurePipelineBudget(renderer);
  if (!r) return;
  lastReport = r;
  if (r.over) {
    // eslint-disable-next-line no-console
    console.error(
      `[pipeline-budget] OVER BUDGET — ${r.programs} programs (budget ${r.budget.programs}), `
      + `${r.pipelines} pipelines (budget ${r.budget.pipelines}). Worst families:\n`
      + r.top.map((t) => `  ${t.name}: ${t.pipelines} pipelines / ${t.programs} programs`).join('\n')
      + '\nSee docs/PIPELINE-BUDGET.md — a new material flag, vertex layout or bone count is the usual cause.',
    );
  }
  if (typeof window !== 'undefined') {
    (window as unknown as { __pipelineBudget?: () => PipelineBudgetReport | null }).__pipelineBudget = () => lastReport;
  }
}
