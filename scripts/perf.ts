/**
 * Perf CLI — headless structural-load profiler for a single scenario.
 *
 * Boots Vite, loads a scenario UNFROZEN (so AI / projectiles / light binding
 * tick), samples window.__perf() once per ~50ms for a few seconds, and prints
 * min / avg / max of the cost-predicting counters: draw calls, triangles,
 * active lights, GPU geometries/textures/programs, plus a JS-heap
 * allocation-churn (GC) proxy.
 *
 *   npm run perf                          (defaults to "perf-max")
 *   npm run perf perf-horde
 *   npm run perf perf-lights phone        (phone viewport DPR)
 *   npm run perf perf-creatures phone --n=16 --kind=ghoul
 *   npm run perf perf-horde --shadows=off (A/B the lamp shadow pass)
 *   npm run perf spawn --secs=8
 *
 * For comparing two configs side-by-side with deltas, use `npm run perf:ab`
 * (scripts/perf-ab.ts) — it boots the browser once and prints Δ columns.
 *
 * See scripts/perf-core.ts for WHY the counts are real but FPS is not.
 * Requires window.__perf (DEV-only) — dev server only, never a prod build.
 */

import { withHarness, parseCommonArgs, num, pad, type PerfAggregate, type SampleConfig, type Viewport } from './perf-core';

/** Pull the scenario-shaping flags (everything not a runner flag) into a URL
 *  flag bag: --shadows=off → { shadows: 'off' }, --portalcull → { portalcull: '1' },
 *  --n=16 → { n: '16' }. Lets any scenario param ride through generically. */
function flagsFromArgv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    if (body.startsWith('secs=') || body.startsWith('port=')) continue;   // runner flags
    const eq = body.indexOf('=');
    if (eq === -1) out[body] = '1';                       // bare flag → "1"
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function printReport(r: PerfAggregate, viewportName: string, viewport: Viewport, secs: number): void {
  console.log(`\nPERF · scenario "${r.scenario}" · ${viewportName} ${viewport.width}×${viewport.height} · ${secs}s sample`);
  console.log('\n' + '─'.repeat(56));
  console.log(`  ${pad('metric', 22)}${pad('min', 10)}${pad('avg', 10)}${pad('max', 10)}`);
  console.log('─'.repeat(56));
  const row = (label: string, s: { min: number; avg: number; max: number }, d = 0) =>
    console.log(`  ${pad(label, 22)}${pad(num(s.min, d), 10)}${pad(num(s.avg, d), 10)}${pad(num(s.max, d), 10)}`);
  row('draw calls', r.draws);
  row('triangles', r.tris);
  row('active lights', r.lightsActive);
  row('registered lights', r.lightsRegistered);
  console.log('─'.repeat(56));
  console.log(`  ${pad('static (last frame)', 22)}`);
  console.log(`    geometries (GPU)    ${num(r.geometries)}`);
  console.log(`    textures (GPU)      ${num(r.textures)}`);
  console.log(`    shader programs     ${num(r.programs)}`);
  console.log(`    geometry pool       ${num(r.geometryPool)}`);
  console.log('─'.repeat(56));
  if (r.heapMB && r.allocRateMBs && r.gcPerSec) {
    console.log(`  GC / allocation churn (heap sawtooth):`);
    console.log(`    JS heap MB          ${num(r.heapMB.min, 1)} … ${num(r.heapMB.max, 1)}`);
    console.log(`    alloc churn MB/s    ${num(r.allocRateMBs.avg, 2)} avg, ${num(r.allocRateMBs.max, 2)} peak`);
    console.log(`    GC collections/s    ${num(r.gcPerSec.avg, 1)} avg, ${num(r.gcPerSec.max, 0)} peak`);
  } else {
    console.log(`  GC churn: heap not exposed by this browser build.`);
  }
  console.log('─'.repeat(56));
  console.log(`  (headless swiftshader — FPS is not real. ${r.samples} samples.)`);
  // THE COUNTERS ABOVE CAN BE A LIE, AND SILENCE WOULD LAUNDER IT.
  //
  // Every renderer-derived figure here comes from `renderer.info`, and under the
  // WebGPU node RenderPipeline this game renders through, those fields are never
  // written: draws, triangles, geometries and the pipeline cache all sit at 0
  // while the game renders perfectly well. (info.memory.textures and
  // renderTargets DO populate, which is how you can tell the renderer is not
  // merely idle.) A zero here means "not measured", not "free" — so say so
  // rather than let a reader take 0 draw calls for a result.
  if (r.draws.max === 0 && r.tris.max === 0) {
    console.log('');
    console.log('  ⚠ draws / triangles / geometries / shader programs read ZERO.');
    console.log('    renderer.info is not populated by the node RenderPipeline, so these are');
    console.log('    UNMEASURED, not cheap. Do not conclude anything from them.');
    console.log('    For real structural counts use `npm run perf-depths` (walks the scene');
    console.log('    graph via window.__drawData) or the on-screen PERF METER on a device.');
  }
  console.log('');
}

async function main() {
  const argv = process.argv.slice(2);
  const { positionals, viewport, viewportName, secs, port } = parseCommonArgs(argv);
  const scenario = positionals[0] ?? 'perf-max';
  const flags = flagsFromArgv(argv);

  const cfg: SampleConfig = { scenario, flags, secs };
  await withHarness({ viewport, port, onLog: (l) => console.log(l) }, async (h) => {
    printReport(await h.sample(cfg), viewportName, viewport, secs);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
