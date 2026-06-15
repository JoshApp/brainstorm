/**
 * Perf recording READER — digests a dashcam recording (from the in-game
 * recorder → POST /__perf → perf-recordings/<id>.json) into a diagnosis, so a
 * spike you felt on the phone becomes "here's the spike, the 2s around it, what
 * fired, and the pattern it's part of."
 *
 *   npm run perf:read                 # newest recording
 *   npm run perf:read rec-2026-...    # a specific id
 *   npm run perf:read --list          # list recordings
 *
 * Reads the same JSON the recorder writes (src/debug/perf-recorder.ts Recording).
 * Sections: distribution + throttle curve (over time) · CPU/GPU split · spikes
 * WITH context + per-system/per-pass elevation + events · RECURRENCE (what
 * repeats — the real signal) · resource trend (leak check).
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'perf-recordings');

interface RecFrame {
  t: number; dt: number; cpu: number; gpu: number | null;
  draws: number; tris: number; heap: number | null; gc: boolean;
  geo: number; tex: number; prog: number;
  sys: number[]; gph?: number[]; ev?: string[];
}
interface Recording {
  meta: { startedAt: string; durationMs: number; frameCount: number; targetMs: number;
    gpuSupported: boolean; ua: string; dpr: number; viewport: [number, number]; renderScale?: number; label?: string };
  systemNames: string[]; gpuPhaseNames?: string[]; frames: RecFrame[];
}

const r1 = (n: number) => n.toFixed(1);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function median(arr: number[]): number { const s = [...arr].sort((a, b) => a - b); return pct(s, 50); }
// Tiny ASCII bar for the throttle sparkline.
function bar(v: number, max: number, w = 24): string {
  const n = max > 0 ? Math.round((v / max) * w) : 0;
  return '█'.repeat(n) + '·'.repeat(Math.max(0, w - n));
}

function listRecordings(): string[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m).map((x) => x.f.replace(/\.json$/, ''));
}

const arg = process.argv[2];
if (arg === '--list' || (!arg && false)) {
  const ids = listRecordings();
  console.log(ids.length ? ids.join('\n') : '(no recordings in perf-recordings/)');
  process.exit(0);
}

const ids = listRecordings();
if (!ids.length) { console.error('No recordings in perf-recordings/. Record one in-game (PROFILER TOOLS) on the dev server.'); process.exit(1); }
const id = arg && !arg.startsWith('--') ? arg.replace(/\.json$/, '') : ids[0];
const path = join(DIR, id + '.json');
if (!existsSync(path)) { console.error(`No such recording: ${id}\nAvailable:\n  ${ids.slice(0, 10).join('\n  ')}`); process.exit(1); }

const rec = JSON.parse(readFileSync(path, 'utf8')) as Recording;
const F = rec.frames;
const target = rec.meta.targetMs || 1000 / 60;
const names = rec.systemNames ?? [];
const gphNames = rec.gpuPhaseNames ?? [];

console.log(`\n══════════  ${id}  ══════════`);
console.log(`${rec.meta.label ?? '(no label)'}  ·  ${F.length} frames · ${r1(rec.meta.durationMs / 1000)}s`);
const rs = rec.meta.renderScale ?? 1;
const fillW = Math.round(rec.meta.viewport[0] * rec.meta.dpr * rs);
const fillH = Math.round(rec.meta.viewport[1] * rec.meta.dpr * rs);
console.log(`device: dpr ${rec.meta.dpr} · ${rec.meta.viewport[0]}×${rec.meta.viewport[1]} · render-scale ${rs} → ~${fillW}×${fillH} fill px · gpu-timing ${rec.meta.gpuSupported ? 'yes' : 'NO (cpu only)'}`);
console.log(rec.meta.ua.replace(/^Mozilla\/5\.0 /, '').slice(0, 80));
if (!F.length) { console.log('\n(empty recording)'); process.exit(0); }

// ── Distribution ──────────────────────────────────────────────────────────
const dts = F.map((f) => f.dt).sort((a, b) => a - b);
const overBudget = F.filter((f) => f.dt > target).length;
const over2x = F.filter((f) => f.dt > target * 2).length;
console.log('\n── FRAME TIME ──');
console.log(`  mean ${r1(dts.reduce((a, b) => a + b, 0) / dts.length)}ms · p50 ${r1(pct(dts, 50))} · p95 ${r1(pct(dts, 95))} · p99 ${r1(pct(dts, 99))} · max ${r1(dts[dts.length - 1])}  (budget ${r1(target)}ms)`);
console.log(`  over budget: ${overBudget}/${F.length} (${Math.round(100 * overBudget / F.length)}%) · over 2× budget: ${over2x} (${Math.round(100 * over2x / F.length)}%)`);

// ── Throttle curve (over time) ────────────────────────────────────────────
const BINS = 12;
const span = F[F.length - 1].t - F[0].t || 1;
const bins: number[][] = Array.from({ length: BINS }, () => []);
for (const f of F) bins[Math.min(BINS - 1, Math.floor(((f.t - F[0].t) / span) * BINS))].push(f.dt);
const binMeans = bins.map((b) => b.length ? b.reduce((a, c) => a + c, 0) / b.length : 0);
const binP95 = bins.map((b) => b.length ? pct([...b].sort((a, c) => a - c), 95) : 0);
const maxBin = Math.max(...binP95, target);
console.log('\n── OVER TIME (mean / p95 per time-slice — a rising trend = thermal throttle) ──');
for (let i = 0; i < BINS; i++) {
  const t0 = (i / BINS) * span / 1000;
  console.log(`  ${padL(r1(t0) + 's', 6)} ${bar(binP95[i], maxBin)} mean ${padL(r1(binMeans[i]), 5)} p95 ${padL(r1(binP95[i]), 5)}ms`);
}
const firstHalf = binMeans.slice(0, BINS / 2).reduce((a, b) => a + b, 0) / (BINS / 2);
const secondHalf = binMeans.slice(BINS / 2).reduce((a, b) => a + b, 0) / (BINS / 2);
if (secondHalf > firstHalf * 1.2) console.log(`  ⚠ second half ${r1(secondHalf)}ms vs first ${r1(firstHalf)}ms — degrading over time (throttle or accumulating cost).`);

// ── CPU vs GPU ────────────────────────────────────────────────────────────
const haveGpu = F.some((f) => f.gpu != null);
const meanCpu = F.reduce((a, f) => a + f.cpu, 0) / F.length;
const meanGpu = haveGpu ? F.reduce((a, f) => a + (f.gpu ?? 0), 0) / F.length : null;
console.log('\n── CPU vs GPU (mean ms) ──');
console.log(`  cpu ${r1(meanCpu)}ms` + (meanGpu != null ? ` · gpu ${r1(meanGpu)}ms → ${meanGpu > meanCpu ? 'GPU-bound' : 'CPU-bound'} on average` : ' · (no GPU timing on this device)'));

// Per-system + per-pass baselines (median across all frames).
const sysMedian = names.map((_, i) => median(F.map((f) => f.sys[i] ?? 0)));
const gphMedian = gphNames.map((_, i) => median(F.map((f) => f.gph?.[i] ?? 0)));

// ── Spikes (clustered) + their context ────────────────────────────────────
const spikeThresh = Math.max(target * 2, pct(dts, 95));
const clusters: { start: number; peak: RecFrame; peakI: number }[] = [];
for (let i = 0; i < F.length; i++) {
  if (F[i].dt <= spikeThresh) continue;
  const last = clusters[clusters.length - 1];
  if (last && F[i].t - last.peak.t < 250) { if (F[i].dt > last.peak.dt) { last.peak = F[i]; last.peakI = i; } }
  else clusters.push({ start: F[i].t, peak: F[i], peakI: i });
}
console.log(`\n── SPIKES (>${r1(spikeThresh)}ms) — ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} ──`);
const topElevSys = (f: RecFrame) => names
  .map((n, i) => ({ n, d: (f.sys[i] ?? 0) - sysMedian[i] }))
  .filter((x) => x.d > 0.3).sort((a, b) => b.d - a.d).slice(0, 3);
const topElevGph = (f: RecFrame) => gphNames
  .map((n, i) => ({ n, d: (f.gph?.[i] ?? 0) - gphMedian[i] }))
  .filter((x) => x.d > 0.3).sort((a, b) => b.d - a.d).slice(0, 3);

for (const c of clusters.slice(0, 10).sort((a, b) => b.peak.dt - a.peak.dt)) {
  const f = c.peak;
  const sysS = topElevSys(f).map((x) => `${x.n} +${r1(x.d)}`).join(', ') || '—';
  const gphS = topElevGph(f).map((x) => `${x.n} +${r1(x.d)}`).join(', ') || '—';
  // Events within ±300ms of the peak.
  const evs = new Set<string>();
  for (const g of F) if (Math.abs(g.t - f.t) < 300 && g.ev) g.ev.forEach((e) => evs.add(e));
  console.log(`  @${padL(r1(f.t / 1000) + 's', 7)} ${padL(r1(f.dt), 5)}ms  cpu ${r1(f.cpu)}${f.gpu != null ? ` gpu ${r1(f.gpu)}` : ''} · draws ${f.draws} tris ${Math.round(f.tris / 1000)}k${f.gc ? ' · GC' : ''}`);
  console.log(`           sys: ${sysS}`);
  if (gphNames.length) console.log(`           gpu: ${gphS}`);
  if (evs.size) console.log(`           events: ${[...evs].join(', ')}`);
}

// ── Recurrence — what repeats (the real signal) ───────────────────────────
console.log('\n── RECURRENCE (the patterns — what repeats matters more than one bad frame) ──');
const culpritTally = new Map<string, number>();
const eventTally = new Map<string, number>();
for (const c of clusters) {
  const top = topElevSys(c.peak)[0];
  if (top) culpritTally.set(top.n, (culpritTally.get(top.n) ?? 0) + 1);
  const evs = new Set<string>();
  for (const g of F) if (Math.abs(g.t - c.peak.t) < 300 && g.ev) g.ev.forEach((e) => evs.add(e.split(':')[0]));
  evs.forEach((e) => eventTally.set(e, (eventTally.get(e) ?? 0) + 1));
}
const rankedCulprits = [...culpritTally].sort((a, b) => b[1] - a[1]);
if (rankedCulprits.length) console.log('  top spike culprit (system most-elevated at the peak):');
for (const [n, c] of rankedCulprits.slice(0, 5)) console.log(`    ${pad(n, 18)} top in ${c}/${clusters.length} spikes`);
const rankedEvents = [...eventTally].sort((a, b) => b[1] - a[1]);
if (rankedEvents.length) {
  console.log('  events co-occurring with spikes:');
  for (const [n, c] of rankedEvents.slice(0, 6)) console.log(`    ${pad(n, 18)} ${c}/${clusters.length} spikes`);
}
if (clusters.length >= 3) {
  const gaps: number[] = [];
  for (let i = 1; i < clusters.length; i++) gaps.push(clusters[i].peak.t - clusters[i - 1].peak.t);
  const gm = median(gaps);
  const variance = gaps.reduce((a, g) => a + Math.abs(g - gm), 0) / gaps.length;
  console.log(`  cadence: spikes ~every ${r1(gm / 1000)}s${variance < gm * 0.35 ? ' (REGULAR — periodic, suspect a recurring pass/event)' : ' (irregular — content-driven)'}`);
}

// ── Resource trend (leak check) ───────────────────────────────────────────
const a = F[0], b = F[F.length - 1];
const climbed = (b.geo - a.geo) > 5 || (b.tex - a.tex) > 5 || (b.prog - a.prog) > 2 || (b.heap != null && a.heap != null && b.heap - a.heap > 30);
console.log('\n── RESOURCES (start → end — climbing while heap is flat = GPU leak) ──');
console.log(`  geometries ${a.geo}→${b.geo} · textures ${a.tex}→${b.tex} · programs ${a.prog}→${b.prog} · heap ${a.heap ?? '?'}→${b.heap ?? '?'}MB`);
if (climbed) console.log('  ⚠ resources climbed over the recording — possible leak.');
console.log('');
