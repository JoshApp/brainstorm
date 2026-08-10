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
// Upload baseline (ub/ubKB columns, builds ≥ 2026-07-05): a spike frame whose
// ubKB dwarfs the median is an UPLOAD BURST; one with gc=true is the
// collector landing mid-frame; neither = first-touch object prep / external.
const hasUb = F.some((x) => x.ubKB !== undefined);
const mdUbKB = hasUb ? med(col((x) => x.ubKB ?? 0)) : 0;
let spikes = 0, spikeGc = 0, spikeUpload = 0, spikeCpuHeavy = 0;
for (let i = 1; i < F.length; i++) {
  if (F[i].dt > mdDt * 2) {
    spikes++;
    const dp = F[i].prog - F[i - 1].prog, dg = F[i].geo - F[i - 1].geo;
    const top = (F[i].sys || []).map((ms, j) => [sn[j], ms]).filter((x) => x[1] > 3).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const cpuHeavy = F[i].cpu > mdDt;   // the CPU did real work (not an idle/GPU stall)
    if (cpuHeavy) spikeCpuHeavy++;
    let verdict = '';
    if (F[i].gc) { spikeGc++; verdict = ' ⚑GC'; }
    if (hasUb && cpuHeavy && (F[i].ubKB ?? 0) > Math.max(64, mdUbKB * 5)) { spikeUpload++; verdict += ` ⚑UPLOAD ${F[i].ub}×/${F[i].ubKB}KB`; }
    if (spikes <= 12) console.log(`  [${i}] dt=${f1(F[i].dt)} cpu=${f1(F[i].cpu)} prog${dp >= 0 ? '+' : ''}${dp} geo${dg >= 0 ? '+' : ''}${dg}${hasUb ? ` ub=${F[i].ub}/${F[i].ubKB}KB` : ''} ev=${JSON.stringify(F[i].ev || [])} ${JSON.stringify(top)}${verdict}`);
  }
}
console.log(`  total spikes: ${spikes}${hasUb ? `  (cpu-heavy ${spikeCpuHeavy} · gc-flagged ${spikeGc} · upload-burst ${spikeUpload})` : ''}`);
if (hasUb) console.log(`  uploads/frame median ${med(col((x) => x.ub ?? 0))}× · ${f1(mdUbKB)}KB`);

console.log(hr('PROGRAM CHURN (prog ±1 = a material minted+disposed per beat → recompile hitch)'));
let ups = 0, downs = 0;
const changes = [];
for (let i = 1; i < F.length; i++) {
  const d = (F[i].prog ?? 0) - (F[i - 1].prog ?? 0);
  if (d === 0) continue;
  if (d > 0) ups += d; else downs += -d;
  if (changes.length < 24) changes.push(`[${i}] prog ${d > 0 ? '+' : ''}${d}→${F[i].prog}  dt=${f1(F[i].dt)} ev=${JSON.stringify(F[i].ev || [])}`);
}
for (const c of changes) console.log('  ' + c);
const netUp = (F.at(-1)?.prog ?? 0) - (F[0]?.prog ?? 0);
console.log(`  totals: +${ups} / -${downs}  (net ${netUp >= 0 ? '+' : ''}${netUp})`);
// Compile types — from the 'C:<shaderType>' tags the instrument folds into ev.
const ctypes = {};
for (const f of F) for (const e of (f.ev || [])) if (typeof e === 'string' && e.startsWith('C:')) ctypes[e.slice(2)] = (ctypes[e.slice(2)] || 0) + 1;
const ce = Object.entries(ctypes).sort((a, b) => b[1] - a[1]);
if (ce.length) console.log(`  COMPILED THIS RECORDING: ${ce.map(([k, v]) => `${k}×${v}`).join(', ')}  (distanceRGBA=shadow-caster, physical=lit, sprite=fx)`);
// Full cacheKeys of in-session compiles — diff against the warmed set (dump live
// renderer.info.programs[].cacheKey) to find the flipped define / exact variant.
const ck = r.meta?.compiledKeys;
if (ck && ck.length) {
  console.log(`  FULL KEYS (${ck.length}) — diff vs warmed to find the variant:`);
  ck.slice(0, 12).forEach((kk, i) => console.log(`    [${i}] ${kk}`));
}
// WARM COVERAGE — the verdict, not just the count. `compiledKeys` says THAT
// something compiled; this says whether the warm could ever have prevented it.
// See src/debug/pipeline-census.ts for what each verdict means and its fix.
const pc = r.meta?.pipelineCensus;
if (pc) {
  console.log(`  WARM COVERAGE: warmed ${pc.warmed} pipelines · ${pc.resident} resident · ${pc.evicted} EVICTED`);
  if (pc.keySpace === 'stateless')
    console.log('    (WebGL2 backend — its cache key carries no render state, so every verdict below is program-identity only, not a state diff.)');
  if (pc.evicted > 0)
    console.log(`    ⚠ ${pc.evicted} warmed pipelines were RELEASED (three drops a pipeline at usedTimes 0). Warm coverage cannot fix this — whatever held them stopped holding them.`);
  for (const g of pc.gaps.slice(0, 10)) console.log(`    ×${String(g.count).padStart(3)} ${g.name.padEnd(22)} ${g.verdict}  ${g.detail}`);
  const churn = pc.gaps.filter((g) => g.verdict === 'PROGRAM-CHURN').reduce((n, g) => n + g.count, 0);
  const notWarmed = pc.gaps.filter((g) => g.verdict === 'NOT-WARMED').reduce((n, g) => n + g.count, 0);
  if (churn) console.log(`    → ${churn} PROGRAM-CHURN: same render state, freshly minted WGSL. Adding warm subjects cannot help; share/retain the material instance instead.`);
  if (notWarmed) console.log(`    → ${notWarmed} NOT-WARMED: a genuine coverage gap — warm a subject that renders in that state (docs/WARMUP.md "the four seams").`);
  if (!pc.gaps.length) console.log('    → no post-warm compiles. The warm covered everything this session touched.');
}
if (downs >= 2 && Math.abs(ups - downs) <= Math.max(2, ups * 0.3))
  console.log(`  ⚠ CHURN: ${downs} deletions ≈ ${ups} compiles → a per-beat effect mints+disposes a material/program. Pin it: shared geometry + a cloned-template material (clones share the program), or retain the material.`);
else if (netUp > 2)
  console.log(`  → mostly one-way (+${netUp}): first-use COMPILES not covered by warmup (warmup gap), not churn.`);

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
// Encode-storm discrimination (needs the ub/ubKB columns, builds ≥ 2026-07-05).
if (hasUb && spikeCpuHeavy > 0) {
  if (spikeUpload > 0) flags.push(`UPLOAD BURST: ${spikeUpload}/${spikeCpuHeavy} cpu-heavy spikes wrote ≫ the ${f1(mdUbKB)}KB/frame baseline — a system staged a big GPU copy that frame (skinning/instance/gore buffers). The ubKB number sizes it.`);
  if (spikeGc > 0) flags.push(`GC IN FRAME: ${spikeGc}/${spikes} spike frames collected mid-frame — the encode bracket was frozen, not busy. Chase allocation churn (alloc-profile attach mode), not the renderer.`);
  const unexplained = spikeCpuHeavy - spikeUpload - spikeGc;
  if (unexplained > 2) flags.push(`UNEXPLAINED ENCODE: ${unexplained} cpu-heavy spikes with normal uploads and no GC → likely first-touch object prep (bind-group/uniform build on newly visible objects). Cross-check ev tags + what became visible.`);
}
if (!flags.length) flags.push('No obvious flags — likely fill/lighting bound or device-limited. Profile in Chrome with CPU throttle for the structural picture.');
flags.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log();
