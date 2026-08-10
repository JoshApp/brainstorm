/**
 * FRAME RECORDING ANALYSER — `npm run delve rec <recording.json>`
 *
 *   npm run delve rec ~/Downloads/rec20260810T160503.json
 *   npm run delve rec rec.json --frames        (also dump the worst frames)
 *
 * Turns a captured frame recording (the in-game profiler's export) into the
 * question you actually want answered: WHERE IS THE FRAME GOING, and is this a
 * spike problem or a baseline problem?
 *
 * Those two need opposite fixes and look identical in a "the fps drops" report,
 * so the report leads with the split:
 *
 *   SPIKE     a handful of frames blow the budget. Cause is an event — a build,
 *             a shader compile, a GC, a level stream. Fix the event.
 *   BASELINE  the median frame misses. Nothing is spiking; the frame simply
 *             costs too much every time. Fix the per-frame cost.
 *
 * The second thing it prints is the one that stops people optimising the wrong
 * thing: it regresses cost against draws, triangles AND uniform buffers, and
 * names whichever one actually explains the frame. That matters — on the first
 * four recordings from Josh's phone, renderer CPU tracked UNIFORM BUFFERS at
 * r=+0.92 while draws managed r=+0.27 and triangles r=+0.22. Fitting against
 * draws alone (which is what this tool did first, because draw calls are what
 * everyone assumes a frame is made of) would have sent us batching geometry to
 * fix a problem that has nothing to do with geometry.
 *
 * When nothing correlates, that is itself the answer: the cost is FIXED per
 * frame, and no amount of culling, batching or resolution will move it.
 *
 * Pass several recordings at once. Within a single recording the draw count
 * barely varies, so the fit is unstable — the same four recordings put the
 * fitted fixed cost anywhere from 0.9ms to 11.5ms when read one at a time.
 *
 * Reads only the recording. No engine imports, so it can be pointed at a file
 * from any build, including one this checkout does not have.
 */

import { readFileSync } from 'node:fs';

interface Frame {
  t: number; dt: number; cpu: number; gpu: number;
  draws: number; tris: number; heap: number; gc: boolean;
  geo: number; tex: number; prog: number; ub: number; ubKB: number;
  sys: number[]; gph: number[];
}
interface Rec {
  meta: Record<string, unknown> & {
    durationMs: number; frameCount: number; targetMs: number;
    viewport: [number, number]; pixelRatio: number; renderScale: number;
    graphics: Record<string, unknown>;
    sceneAudit?: { total: Record<string, number>; byKind: Record<string, { meshes: number; instances: number }> };
  };
  systemNames: string[];
  gpuPhaseNames: string[];
  frames: Frame[];
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const f2 = (v: number) => v.toFixed(2).padStart(7);

/** Least-squares fit of y against x. The intercept is the point of the whole
 *  exercise — cost that does NOT scale with the scene. */
function fit(xs: number[], ys: number[]): { slope: number; intercept: number; r: number } {
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  if (vx === 0) return { slope: 0, intercept: my, r: 0 };
  const slope = cov / vx;
  return { slope, intercept: my - slope * mx, r: vy ? cov / Math.sqrt(vx * vy) : 0 };
}

function main(): void {
  const args = process.argv.slice(2);
  const paths = args.filter((a) => !a.startsWith('--'));
  if (!paths.length) {
    console.log('usage: npm run delve rec <recording.json> [more.json …] [--frames]');
    console.log('  Pass SEVERAL recordings to pool them. Within one recording the draw');
    console.log('  count barely varies, so a fit against it is unstable — four pooled');
    console.log('  recordings swung the fitted fixed cost from 0.9ms to 11.5ms apart.');
    process.exit(1);
  }
  const recs = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')) as Rec);
  const rec = recs[0];
  const { meta: m, systemNames: SN, gpuPhaseNames: GN } = rec;
  const F = recs.flatMap((r) => r.frames);
  const path = paths.length === 1 ? paths[0] : `${paths.length} recordings pooled`;
  const target = m.targetMs;

  const dts = F.map((f) => f.dt);
  const s = [...dts].sort((a, b) => a - b);
  const med = pct(s, 0.5);
  const overBudget = F.filter((f) => f.dt > target).length;
  const spikes = F.filter((f) => f.dt > target * 2).length;

  console.log(`\n═══ ${path.split('/').pop()} ═══`);
  if (paths.length > 1) console.log(`  ${paths.map((p) => p.split('/').pop()).join('\n  ')}`);
  console.log(`build ${String(m.build ?? '?')}  ·  ${F.length} frames over ${(m.durationMs / 1000).toFixed(1)}s  ·  target ${target.toFixed(1)}ms`);
  const rt = `${Math.round(m.viewport[0] * m.pixelRatio * m.renderScale)}×${Math.round(m.viewport[1] * m.pixelRatio * m.renderScale)}`;
  console.log(`viewport ${m.viewport[0]}×${m.viewport[1]}  pixelRatio ${m.pixelRatio}  renderScale ${m.renderScale}  →  RENDER TARGET ${rt} px`);

  console.log('\n── frame time ──');
  console.log(`  median ${f2(med)}ms (${(1000 / med).toFixed(0)} fps)   p95 ${f2(pct(s, 0.95))}ms   p99 ${f2(pct(s, 0.99))}ms   max ${f2(s[s.length - 1])}ms`);
  console.log(`  over budget: ${overBudget}/${F.length} (${((100 * overBudget) / F.length).toFixed(0)}%)   spikes >2× budget: ${spikes} (${((100 * spikes) / F.length).toFixed(1)}%)`);
  console.log(`  cpu median ${f2(pct([...F.map((f) => f.cpu)].sort((a, b) => a - b), 0.5))}ms   gpu median ${f2(pct([...F.map((f) => f.gpu)].sort((a, b) => a - b), 0.5))}ms`);
  console.log(`  gc frames ${F.filter((f) => f.gc).length}`);

  // ── The verdict. Spike and baseline need opposite fixes. ──
  const spikeShare = spikes / F.length;
  console.log('\n── VERDICT ──');
  if (med <= target && spikeShare > 0.01) {
    console.log(`  SPIKES. The median frame (${med.toFixed(1)}ms) fits the budget; ${(100 * spikeShare).toFixed(1)}% of frames blow it.`);
    console.log('  Chase the EVENT — look at the worst frames below and what is elevated in them.');
  } else if (med > target) {
    console.log(`  BASELINE. The median frame is ${med.toFixed(1)}ms against a ${target.toFixed(1)}ms budget — it misses EVERY frame.`);
    console.log(`  Only ${(100 * spikeShare).toFixed(1)}% of frames are spikes, so there is no event to chase.`);
    console.log('  The per-frame cost itself is the bug. Read the breakdown below.');
  } else {
    console.log(`  HEALTHY. Median ${med.toFixed(1)}ms inside a ${target.toFixed(1)}ms budget, few spikes.`);
  }

  // ── Where the CPU goes ──
  const n = SN.length;
  const tot = new Array(n).fill(0);
  const maxs = new Array(n).fill(0);
  for (const f of F) for (let i = 0; i < Math.min(n, f.sys.length); i++) {
    tot[i] += f.sys[i];
    maxs[i] = Math.max(maxs[i], f.sys[i]);
  }
  const cpuMean = mean(F.map((f) => f.cpu));
  const rows = SN.map((name, i) => ({ name, mean: tot[i] / F.length, max: maxs[i] }))
    .filter((r) => r.mean >= 0.005)
    .sort((a, b) => b.mean - a.mean);
  console.log(`\n── cpu by system (mean ${cpuMean.toFixed(2)}ms) ──`);
  console.log('  NOTE: nested names (a·b) are INSIDE their parent — do not sum the column.');
  for (const r of rows.slice(0, 14)) {
    console.log(`  ${r.name.padEnd(26)}${f2(r.mean)}ms  max ${f2(r.max)}  ${((100 * r.mean) / cpuMean).toFixed(0).padStart(3)}% of cpu`);
  }
  const nonRender = rows.filter((r) => !r.name.startsWith('render')).reduce((sum, r) => sum + r.mean, 0);
  console.log(`  ${'— everything except render —'.padEnd(26)}${f2(nonRender)}ms  ${((100 * nonRender) / cpuMean).toFixed(0).padStart(3)}% of cpu`);

  if (GN.length) {
    console.log('\n── gpu by phase ──');
    GN.forEach((name, i) => {
      const v = F.filter((f) => f.gph.length > i).map((f) => f.gph[i]);
      if (v.length) console.log(`  ${name.padEnd(26)}${f2(mean(v))}ms  max ${f2(Math.max(...v))}`);
    });
  }

  // ── What actually predicts the frame? ──
  //
  // The first version of this regressed cost against DRAW CALLS only, because
  // draw calls are what everyone assumes a frame is made of. Pooling four
  // recordings said otherwise, decisively: CPU render cost tracks the number of
  // UNIFORM BUFFERS at r=+0.92, while draws (r=+0.27) and triangles (r=+0.22)
  // explain almost nothing. Fitting only against draws would have had us
  // batching geometry to fix a problem that is not geometry.
  //
  // So it fits all three and names the winner. Correlation is not cause — but a
  // near-perfect fit against one variable and noise against the others tells you
  // which one to go and read the code for, which is the whole job of this report.
  const draws = F.map((f) => f.draws);
  // Fit on STEADY frames only. A least-squares fit is dominated by its extremes,
  // and a handful of 200ms+ stalls (which are not the renderer scaling with
  // anything — see the worst-frames list) drag every correlation toward noise:
  // including them turned an r=+0.92 signal into r=+0.68 and flipped the
  // verdict. Outliers are a separate question from "what does a normal frame
  // cost", and this section is asking the second one.
  const steady = F.filter((f) => f.dt < target * 3.5);
  const dropped = F.length - steady.length;
  // Regress the RENDERER's own submission cost, not total CPU — total CPU folds
  // in gameplay systems that scale with entirely different things.
  const sceneIdx = SN.indexOf('render·scene');
  const sceneCost = sceneIdx >= 0 ? steady.map((f) => f.sys[sceneIdx] ?? 0) : steady.map((f) => f.cpu);
  const preds: Array<[string, number[], string]> = [
    ['draws', steady.map((f) => f.draws), 'µs/draw'],
    ['triangles', steady.map((f) => f.tris), 'ns/tri'],
    ['uniformBufs', steady.map((f) => f.ub), 'µs/buffer'],
  ];
  console.log(`\n── what predicts the frame? (r near ±1 = that variable IS the cost) ──`);
  console.log(`  fitted on ${steady.length} steady frames; ${dropped} outlier${dropped === 1 ? '' : 's'} above ${(target * 3.5).toFixed(0)}ms excluded`);
  for (const [label, ys] of [
    [sceneIdx >= 0 ? 'render·scene' : 'cpu', sceneCost],
    ['gpu', steady.map((f) => f.gpu)],
  ] as Array<[string, number[]]>) {
    let best = { name: '', r: 0 };
    for (const [pname, xs, unit] of preds) {
      const { slope, intercept, r } = fit(xs, ys);
      const scaled = unit === 'ns/tri' ? slope * 1e6 : slope * 1000;
      const flag = Math.abs(r) > 0.7 ? '  ←' : '';
      console.log(`  ${label} vs ${pname.padEnd(12)} ${scaled.toFixed(2).padStart(9)} ${unit.padEnd(10)} + ${intercept.toFixed(2).padStart(6)}ms fixed   r=${r >= 0 ? '+' : ''}${r.toFixed(3)}${flag}`);
      if (Math.abs(r) > Math.abs(best.r)) best = { name: pname, r };
    }
    if (Math.abs(best.r) > 0.7) {
      console.log(`  → ${label} is explained by ${best.name.toUpperCase()} (r=${best.r.toFixed(2)}). Go read the code that touches it.`);
    } else {
      console.log(`  → ${label} correlates with NOTHING in the scene (best r=${best.r.toFixed(2)}). It is a FIXED per-frame cost —`);
      console.log(`    culling, batching, resolution and content will not move it. Look at the pass structure.`);
    }
    console.log('');
  }
  console.log(`  draws ${Math.round(mean(draws))} mean / ${Math.max(...draws)} max   tris ${Math.round(mean(F.map((f) => f.tris)))} mean   ${Math.round(mean(F.map((f) => f.tris / Math.max(1, f.draws))))} tris per draw`);
  console.log(`  uniform buffers ${Math.round(mean(F.map((f) => f.ub)))} mean / ${Math.max(...F.map((f) => f.ub))} max  (${Math.round(mean(F.map((f) => f.ub)) / Math.max(1, mean(draws)) * 10) / 10} per draw)`);
  console.log(`  programs ${Math.max(...F.map((f) => f.prog))}   geometries ${Math.max(...F.map((f) => f.geo))}   textures ${Math.max(...F.map((f) => f.tex))}`);
  console.log(`  ${Math.round(mean(F.map((f) => f.tris / Math.max(1, f.draws))))} triangles per draw is the number to look at: if it is small, the frame is`);
  console.log('  paying SUBMISSION cost, not geometry cost, and batching beats every other lever.');

  if (m.sceneAudit) {
    const a = m.sceneAudit;
    console.log(`\n── scene ── ${Object.entries(a.total).map(([k, v]) => `${k} ${v}`).join('  ')}`);
    const kinds = Object.entries(a.byKind).sort((x, y) => y[1].meshes - x[1].meshes).slice(0, 8);
    for (const [k, v] of kinds) console.log(`  ${k.padEnd(30)} meshes ${String(v.meshes).padStart(4)}  instances ${String(v.instances).padStart(4)}`);
  }

  console.log(`\n── graphics settings in effect ──\n  ${JSON.stringify(m.graphics)}`);

  if (args.includes('--frames')) {
    console.log('\n── worst frames ──');
    const worst = [...F].sort((a, b) => b.dt - a.dt).slice(0, 10);
    for (const f of worst) {
      const top = SN.map((name, i) => ({ name, v: f.sys[i] ?? 0 })).sort((x, y) => y.v - x.v).slice(0, 3)
        .map((x) => `${x.name} ${x.v.toFixed(1)}`).join(', ');
      console.log(`  t=${String(f.t).padStart(6)}ms dt ${f2(f.dt)} cpu ${f2(f.cpu)} gpu ${f2(f.gpu)} draws ${String(f.draws).padStart(4)}${f.gc ? ' GC' : ''}  | ${top}`);
    }
  }
  console.log('');
}

main();
