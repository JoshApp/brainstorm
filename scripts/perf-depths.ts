/**
 * PERF-DEPTHS — structural complexity across the whole descent.
 *
 *   npm run perf-depths                     depths 1..12, 2 seeds each
 *   npm run perf-depths --seeds=4 --max=12
 *   npm run perf-depths phone               phone viewport
 *
 * `npm run perf` prices ONE posed scenario. This walks REAL SEEDED FLOORS the
 * length of a run, because the question a mobile budget actually asks is not
 * "how heavy is the worst room we could build" but "does depth 12 cost more
 * than depth 1, and where does it go".
 *
 * ── WHERE THE NUMBERS COME FROM, AND WHY NOT FROM renderer.info ─────────────
 *
 * These are read from `window.__drawData()` (debug/draw-report.ts), which WALKS
 * THE LIVE SCENE GRAPH and attributes every visible drawable to its owner.
 *
 * It does not use `renderer.info`, and that is deliberate: under the WebGPU node
 * RenderPipeline this game renders through, `info.render.drawCalls`,
 * `info.memory.geometries` and the pipeline cache all sit at ZERO while the game
 * renders perfectly well (textures and renderTargets do populate, so it is not
 * that the renderer is idle — the node pipeline's passes simply never reach the
 * code that increments those counters). `npm run perf` reads exactly those
 * fields, which is why it prints 0 draws / 0 triangles for every scenario. That
 * is a broken instrument, not a cheap game, and nothing should be concluded
 * from it until it is fixed.
 *
 * A scene walk is also the more useful measurement: it knows an object is an
 * altar rather than "a draw with program 7", so it can say WHICH bucket to
 * attack. Its counts are device-independent — a phone draws the same drawables.
 *
 * FPS is not reported. The harness runs a CPU rasteriser (swiftshader), so
 * wall-clock frame time here measures this machine, not a phone.
 *
 * Each floor is read from the SPAWN POINT standing still: consistent and
 * comparable across depths, and deliberately near the cheapest pose a floor
 * has. Read the trend as the signal and the absolute as a floor, not a ceiling.
 */
import { withHarness, parseCommonArgs, num, pad, padL } from './perf-core';

type Cat = string;
interface DrawReportData {
  draws: number; rtris: number;
  drawables: number; meshes: number; sprites: number; points: number;
  shadowCasters: number; transparent: number; sceneTris: number;
  programs: number; geometries: number; textures: number;
  lightsActive: number; lightsShadow: number;
  bySource: Record<Cat, number>;
  mergedDraws: number; mergeableNow: number; dynamicDraws: number;
  looseBySource: Record<string, number>;
}

const argv = process.argv.slice(2);
const flag = (name: string, dflt: number): number => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  const n = a ? Number(a.slice(name.length + 3)) : NaN;
  return Number.isFinite(n) ? n : dflt;
};

const MAX_DEPTH = flag('max', 12);
const SEEDS = flag('seeds', 2);
// Fixed, unremarkable seeds — the point is the depth trend, and a fresh random
// seed each run would make two invocations incomparable for no benefit.
const SEED_BASE = [1000, 4242, 90210, 31337];

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main(): Promise<void> {
  const { viewport, viewportName } = parseCommonArgs(argv);
  const seeds = SEED_BASE.slice(0, Math.max(1, Math.min(SEED_BASE.length, SEEDS)));

  await withHarness({ viewport }, async (h) => {
    console.log(`\nSTRUCTURAL COMPLEXITY BY DEPTH · ${viewportName} ${viewport.width}×${viewport.height}`);
    console.log(`${seeds.length} seed(s) × depths 1..${MAX_DEPTH}, read at the spawn point`);
    console.log('scene-graph walk (window.__drawData) — renderer.info is broken under the node pipeline, see header\n');
    console.log(
      pad('depth', 7) + padL('drawable', 9) + padL('mesh', 7) + padL('sprite', 8) +
      padL('tris', 9) + padL('shadow', 8) + padL('transp', 8) +
      padL('merged', 8) + padL('mergeable', 10) + padL('dynamic', 9) + padL('lights', 8),
    );
    console.log('─'.repeat(91));

    const byDepth: Array<{ depth: number; rows: DrawReportData[] }> = [];
    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      const rows: DrawReportData[] = [];
      for (const seed of seeds) {
        const d = await h.read<DrawReportData | null>({
          scenario: '',   // a real seeded run, not a posed scenario
          flags: { autostart: '1', dev: '1', seed: String(seed), depth: String(depth) },
        }, '__drawData');
        if (d) rows.push(d);
      }
      if (!rows.length) continue;
      byDepth.push({ depth, rows });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        console.log(
          pad(i === 0 ? String(depth) : '', 7) +
          padL(num(r.drawables), 9) + padL(num(r.meshes), 7) + padL(num(r.sprites), 8) +
          padL(num(r.sceneTris / 1000, 1) + 'k', 9) + padL(num(r.shadowCasters), 8) +
          padL(num(r.transparent), 8) + padL(num(r.mergedDraws), 8) +
          padL(num(r.mergeableNow), 10) + padL(num(r.dynamicDraws), 9) +
          padL(num(r.lightsActive), 8),
        );
      }
    }

    const first = byDepth[0], last = byDepth[byDepth.length - 1];
    if (first && last) {
      console.log('\n' + '─'.repeat(91));
      console.log(pad('', 20) + padL(`depth ${first.depth}`, 12) + padL(`depth ${last.depth}`, 12) + padL('change', 12));
      const line = (name: string, f: (r: DrawReportData) => number, d = 0) => {
        const a = mean(first.rows.map(f)), b = mean(last.rows.map(f));
        const pct = a > 0 ? ((b - a) / a) * 100 : 0;
        console.log(pad(name, 20) + padL(num(a, d), 12) + padL(num(b, d), 12) +
          padL((pct >= 0 ? '+' : '') + num(pct, 1) + '%', 12));
      };
      line('drawables', (r) => r.drawables);
      line('scene triangles', (r) => r.sceneTris);
      line('sprites (overdraw)', (r) => r.sprites);
      line('transparent', (r) => r.transparent);
      line('shadow casters', (r) => r.shadowCasters);
      line('mergeable-now', (r) => r.mergeableNow);
      line('dynamic', (r) => r.dynamicDraws);
      line('lights lit', (r) => r.lightsActive, 1);
    }

    // WHERE THE DRAWABLES GO, averaged over every floor sampled. This is the
    // part that names the work: the biggest bucket is the one worth attacking.
    const all = byDepth.flatMap((d) => d.rows);
    const cats = new Map<string, number[]>();
    for (const r of all) for (const [k, v] of Object.entries(r.bySource ?? {})) {
      if (!cats.has(k)) cats.set(k, []);
      cats.get(k)!.push(v);
    }
    if (cats.size) {
      console.log('\n' + '─'.repeat(91));
      console.log(`drawables by owner (mean over ${all.length} floors)\n`);
      const ranked = [...cats.entries()].map(([k, xs]) => ({ k, v: mean(xs) })).sort((a, b) => b.v - a.v);
      const total = ranked.reduce((s, r) => s + r.v, 0);
      for (const { k, v } of ranked) {
        if (v < 0.5) continue;
        console.log(`  ${pad(k, 16)}${padL(num(v, 1), 8)}${padL(num((v / total) * 100, 1) + '%', 9)}`);
      }
    }

    // …and, within the loose static that COULD be merged, which system made it.
    const loose = new Map<string, number[]>();
    for (const r of all) for (const [k, v] of Object.entries(r.looseBySource ?? {})) {
      if (!loose.has(k)) loose.set(k, []);
      loose.get(k)!.push(v);
    }
    if (loose.size) {
      console.log(`\nloose static by generating system (the achievable merge win)\n`);
      const ranked = [...loose.entries()].map(([k, xs]) => ({ k, v: mean(xs) })).sort((a, b) => b.v - a.v);
      for (const { k, v } of ranked.slice(0, 10)) {
        if (v < 0.5) continue;
        console.log(`  ${pad(k, 24)}${padL(num(v, 1), 8)}`);
      }
    }

    const worst = all.slice().sort((a, b) => b.drawables - a.drawables)[0];
    const worstDepth = byDepth.find((d) => d.rows.includes(worst))?.depth;
    if (worst) {
      console.log(
        `\nheaviest floor sampled: depth ${worstDepth} · ${num(worst.drawables)} drawables · ` +
        `${num(worst.sceneTris / 1000, 1)}k tris · ${num(worst.transparent)} transparent`,
      );
    }
    console.log('\nconfirm FEEL on the phone (Settings → PERF METER); these are structure only.\n');
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
