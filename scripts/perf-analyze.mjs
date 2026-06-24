#!/usr/bin/env node
// Mechanical analyzer for DELVE perf recordings (the dashcam JSON) — so we read a
// DIAGNOSIS, not raw JSON. Usage:  node scripts/perf-analyze.mjs <recording.json>
//
// It folds every ad-hoc analysis we did by hand into one pass + an auto-DIAGNOSIS
// that flags the patterns we keep hitting: leaks (geo/prog climbing), shadow-pass
// cost, unmerged decor, per-enemy named-part cost, GPU-timer inflation, and
// thermal drift (dt rising at constant draw load = throttling, not a code change).
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/perf-analyze.mjs <recording.json>'); process.exit(1); }
const r = JSON.parse(readFileSync(file, 'utf8'));
const F = r.frames || [];
const sn = r.systemNames || [];
const gph = r.gpuPhaseNames || [];
const A = r.meta?.sceneAudit;

const col = (a) => F.map(a);
const sorted = (a) => [...a].sort((x, y) => x - y);
const med = (a) => sorted(a)[a.length >> 1] ?? 0;
const pct = (a, p) => sorted(a)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const k = (n) => (n / 1000).toFixed(0) + 'k';
const hr = (t) => `\n══ ${t} ${'═'.repeat(Math.max(0, 60 - t.length))}`;

const dt = col((x) => x.dt), draws = col((x) => x.draws), tris = col((x) => x.tris);
const cpu = col((x) => x.cpu), gpu = col((x) => x.gpu ?? 0);
const mdDt = med(dt);

console.log(`\nPERF ANALYSIS · ${file.split('/').pop()}  (${F.length} frames, ${(r.meta?.durationMs / 1000).toFixed(0)}s)`);

console.log(hr('SETTINGS'));
console.log(`  device DPR ${r.meta?.dpr}  ·  EFFECTIVE pixelRatio ${r.meta?.pixelRatio ?? '?'}  ·  viewport ${JSON.stringify(r.meta?.viewport)}`);
if (r.meta?.graphics) console.log('  ' + Object.entries(r.meta.graphics).map(([k, v]) => `${k}=${v}`).join('  '));

console.log(hr('FRAME TIME (trust this — GPU-pass ms over-reports)'));
console.log(`  dt   median ${f1(mdDt)}ms (${(1000 / mdDt).toFixed(0)}fps)  ·  p95 ${f1(pct(dt, 0.95))}  ·  max ${f1(Math.max(...dt))}`);
console.log(`  cpu  median ${f1(med(cpu))}ms  ·  p95 ${f1(pct(cpu, 0.95))}`);

console.log(hr('GPU PASSES (relative share only)'));
for (const nm of gph) { const i = gph.indexOf(nm); const v = med(col((x) => x.gph?.[i] ?? 0)); if (v > 0.2) console.log(`  ${nm.padEnd(8)} ${f1(v)}ms`); }
const gpuSum = gph.reduce((s, nm, i) => s + med(col((x) => x.gph?.[i] ?? 0)), 0);
if (gpuSum > mdDt * 1.25) console.log(`  ⚠ pass-sum ${f1(gpuSum)}ms ≫ dt ${f1(mdDt)}ms → GPU timer inflates; use relative share, not absolutes.`);

console.log(hr('CPU SYSTEMS (median ms)'));
for (const [n, v] of sn.map((n, i) => [n, med(col((x) => x.sys?.[i] ?? 0))]).filter((x) => x[1] > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 8))
  console.log(`  ${n.padEnd(20)} ${f1(v)}`);

console.log(hr('DRAWS / GEOMETRY / LEAK CHECK'));
console.log(`  draws  median ${med(draws)}  max ${Math.max(...draws)}`);
console.log(`  tris   median ${k(med(tris))}  max ${k(Math.max(...tris))}`);
const dGeo = (F.at(-1)?.geo ?? 0) - (F[0]?.geo ?? 0), dProg = (F.at(-1)?.prog ?? 0) - (F[0]?.prog ?? 0);
console.log(`  geo    ${F[0]?.geo} → ${F.at(-1)?.geo} (${dGeo >= 0 ? '+' : ''}${dGeo})   prog ${F[0]?.prog} → ${F.at(-1)?.prog} (${dProg >= 0 ? '+' : ''}${dProg})   tex ${F.at(-1)?.tex}`);

console.log(hr('SCENE AUDIT (at save)'));
if (!A) console.log('  (none — pre-audit build)');
else {
  console.log(`  ${A.total.meshes} meshes · ${A.total.instances} instances · ${A.total.uniqueGeometries} geometries`);
  if (A.instancing) {
    const inSceneBatches = A.instancing.batches.filter((b) => b.inScene).length;
    const orphans = Math.max(0, (A.enemyBatchMeshesInScene ?? 0) - inSceneBatches);   // scene meshes not tracked by the map
    console.log(`  instancing: ${A.instancing.mapSize} batches in map (${inSceneBatches} attached) · ${A.instancing.live} live mobs · enemyMeshesInScene ${A.enemyBatchMeshesInScene}` + (orphans ? `  ⚠ ${orphans} ORPHANS` : '  ✓ no orphans'));
    const byType = {};
    for (const b of A.instancing.batches) { const t = b.key.split('|')[0]; (byType[t] ??= { seg: 0, inst: 0, inScene: 0 }); byType[t].seg++; byType[t].inst += b.count; if (b.inScene) byType[t].inScene++; }
    console.log('  per-type: ' + Object.entries(byType).map(([t, v]) => `${t}(${v.seg}seg,${v.inst}inst,${v.inScene}inScene)`).join('  '));
  }
  console.log('  byKind: ' + Object.entries(A.byKind).slice(0, 14).map(([k, v]) => `${k}=${v.meshes}`).join(' '));
}

console.log(hr('SPIKES (dt > 2× median)'));
let spikes = 0;
for (let i = 1; i < F.length; i++) {
  if (F[i].dt > mdDt * 2) {
    spikes++;
    const dp = F[i].prog - F[i - 1].prog, dg = F[i].geo - F[i - 1].geo;
    const top = (F[i].sys || []).map((ms, j) => [sn[j], ms]).filter((x) => x[1] > 3).sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (spikes <= 12) console.log(`  [${i}] dt=${f1(F[i].dt)} cpu=${f1(F[i].cpu)} prog${dp >= 0 ? '+' : ''}${dp} geo${dg >= 0 ? '+' : ''}${dg} ev=${JSON.stringify(F[i].ev || [])} ${JSON.stringify(top)}`);
  }
}
console.log(`  total spikes: ${spikes}`);

// ── AUTO-DIAGNOSIS ──────────────────────────────────────────────────────────
console.log(hr('DIAGNOSIS'));
const flags = [];
if (dProg > 2) flags.push(`SHADER COMPILE: prog +${dProg} during play → first-use compiles (warmup gap). Spikes with prog+N are this.`);
if (dGeo > 40) flags.push(`GEO LEAK?: geometries +${dGeo} and not recovering → something built not disposed (corpses/drops/effects/orphan batches).`);
// thermal: split into thirds, dt rising at ~flat draw load
const third = Math.floor(F.length / 3);
if (third > 20) {
  const dtA = med(F.slice(0, third).map((x) => x.dt)), dtC = med(F.slice(-third).map((x) => x.dt));
  const drA = med(F.slice(0, third).map((x) => x.draws)), drC = med(F.slice(-third).map((x) => x.draws));
  if (dtC > dtA * 1.18 && Math.abs(drC - drA) < drA * 0.15) flags.push(`THERMAL/THROTTLE?: dt ${f1(dtA)}→${f1(dtC)}ms while draws ~flat (${drA}→${drC}) → downclocking, not a code change.`);
}
if (A?.byKind) {
  // unmerged decor: many meshes of the same primitive name
  const merge = Object.entries(A.byKind).filter(([kk, v]) => v.meshes >= 8 && /Geometry|cone|sphere|torus|box|sprite/i.test(kk));
  if (merge.length) flags.push(`UNMERGED/INSTANCEABLE: ${merge.map(([kk, v]) => `${v.meshes}× ${kk}`).join(', ')} → merge static / pool dynamic (run the draw report for the exact owner).`);
  // per-enemy named parts: groups of N matching live mob count
  if (A.instancing?.live > 0) {
    const named = Object.entries(A.byKind).filter(([kk, v]) => v.meshes === A.instancing.live && /^[a-z]/.test(kk) && !kk.startsWith('sprite'));
    if (named.length > 4) flags.push(`PER-ENEMY NAMED PARTS: ${named.length} part types × ${A.instancing.live} mobs (${named.slice(0, 6).map((x) => x[0]).join(',')}…) drawn individually — NOT instanced. Each clothed creature ≈ segments + ~${named.length} extra draws. The big per-enemy cost.`);
  }
}
if (gpuSum > mdDt * 1.4) flags.push(`GPU-TIMER INFLATION: pass-sum ${f1(gpuSum)} vs dt ${f1(mdDt)} — don't chase per-pass absolutes (cost us a night on a "stale 11ms bloom"). Trust dt + draw counts.`);
if (!flags.length) flags.push('No obvious flags — likely fill/lighting bound or device-limited. Profile in Chrome with CPU throttle for the structural picture.');
flags.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log();
