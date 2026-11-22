// Backend boot check — does the game boot, render and keep presenting frames on
// each graphics backend?
//
//   npm run backend-boot                    # both backends
//   npm run backend-boot -- --backend=webgl2
//   npm run backend-boot -- --keep          # leave the screenshots in /tmp
//
// ── WHY ──────────────────────────────────────────────────────────────────────
//
// WebGPU is the default, but a large share of real devices land on the WebGL2
// backend: Steam Deck and other AMD Linux (WebGPU behind a Chrome flag), Samsung
// Exynos phones, iPhones before iOS 26, Firefox on Linux/Android, and any device
// whose adapter refuses (gpuweb Implementation-Status, 2026-10-02). The fallback
// exists (src/scene/create-renderer.ts) but nothing exercised it, so it could
// rot unseen while every snap and perf run went through WebGPU.
//
// Each backend gets a fresh vite dev server page on the `spawn` scenario,
// UNFROZEN, and must:
//   1. actually be on the backend asked for (create-renderer's own report);
//   2. drop the descent cover (the world was revealed);
//   3. keep presenting frames for SAMPLE_MS (no stall, no lost context);
//   4. raise no page error and no WebGPU validation error;
//   5. put light on screen (mean luminance above a floor — not a black canvas);
//   6. have every three.js renderer patch installed (their DEV install lines).
//
// Do NOT compare luma ACROSS backends: headless WebGPU frames (captured via
// paintHeadlessFrame) come out ~3x brighter than the same room on a real GPU,
// where both backends match (2026-11-21, docs/OPEN-ITEMS.md).
//
// Headless Chrome renders WebGL2 through SwiftShader and WebGPU through Dawn's
// software adapter, so this proves CORRECTNESS, not speed. Frame counts here say
// nothing about a phone.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { launchHeadless, installWebGPUShims, paintHeadlessFrame, chromiumPath, CHROMIUM_CANDIDATES } from './headless-browser';

type Backend = 'webgpu' | 'webgl2';

const SAMPLE_MS = 5_000;
const MIN_FRAMES = 10;           // over SAMPLE_MS; software rendering is slow, a stall is 0-2
const MIN_MEAN_LUMA = 2.0;       // 0-255. The dungeon is dark by design; a dead canvas is ~0
const REVEAL_TIMEOUT_MS = 120_000;

// Everything after the FIRST '=': `--url-extra=stablebuf=0` must yield
// `stablebuf=0`. (It used `.split('=')[1]`, which silently cut values at their
// own '=', so every --url-extra A/B ran with its flag unset.)
const arg = (name: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a === undefined ? undefined : a.slice(name.length + 3);
};
const wanted = (arg('backend') ?? 'both') as Backend | 'both';
const backends: Backend[] = wanted === 'both' ? ['webgl2', 'webgpu'] : [wanted];
const keep = process.argv.includes('--keep');
// Extra URL params for A/B runs, e.g. --url-extra=clustered=0 runs WebGPU on the
// tiled light loop the WebGL2 backend uses, to split backend from lighting.
const urlExtra = arg('url-extra') ? `&${arg('url-extra')}` : '';
const tag = arg('tag') ? `-${arg('tag')}` : '';
// --scenario=<name> boots another debug scenario (default `spawn`, an empty
// start room). perf-horde puts many skinned enemies on screen, which is where
// pipeline-naming bugs show up.
const scenarioName = arg('scenario') ?? 'spawn';
// --eval=<js expression> runs in the page after reveal and before sampling (may
// return a promise). For runtime A/Bs a URL flag can't express, e.g.
//   --eval="import('/brainstorm/src/style/render-webgpu.ts').then(m=>m.setGradeBypass(true))"
// --metrics prints one JSON line per backend after sampling: compile counts
// (__compileStats) and the pipeline census summary (__pipelineCensus). Counts are
// exact in headless; times are software rendering and only compare like-for-like
// on the same machine (e.g. before/after a three upgrade).
const wantMetrics = process.argv.includes('--metrics');
// --cpu: subscribe to the game's own frame-timing (src/debug/frame-timing.ts)
// for the sample window and print the per-frame averages — cpu ms, draws,
// uploads, alloc, and every render·/enc· bucket (debug/encode-breakdown.ts).
// JS-side encode cost is real CPU even on headless's software GPU, so it
// compares like-for-like across three versions on one machine. Pair with
// --frozen and a fixed --url-extra=seed=N so both runs draw identical frames.
const wantCpu = process.argv.includes('--cpu');
const frozen = process.argv.includes('--frozen');
const evalAfterReveal = process.argv.find((a) => a.startsWith('--eval='))?.slice('--eval='.length);

if (!chromiumPath()) {
  console.error(`No Chromium found. Looked in:\n  ${CHROMIUM_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}

const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
// "0.187.0" → "187", the form three writes to window.__THREE__ (its REVISION).
const installedThree = String(JSON.parse(readFileSync(`${repoRoot}/node_modules/three/package.json`, 'utf8')).version)
  .split('.')[1];
const port = 5180 + Math.floor(Math.random() * 100);
const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let viteOut = '';
vite.stdout?.on('data', (c: Buffer) => { viteOut += c.toString(); });
vite.stderr?.on('data', (c: Buffer) => { viteOut += c.toString(); });
const stopVite = () => { try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopVite);

const up = await new Promise<boolean>((resolve) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    // Strip ANSI colour first: GitHub Actions forces colour, which puts escape
    // codes between "Local" and ":" and the URL never matches.
    // eslint-disable-next-line no-control-regex
    if (/Local:\s+http:\/\/.+:\d+/.test(viteOut.replace(/\x1b\[[0-9;]*m/g, ''))) { clearInterval(iv); resolve(true); }
    else if (Date.now() - t0 > 30_000) { clearInterval(iv); resolve(false); }
  }, 100);
});
if (!up) { console.error('vite did not start:\n' + viteOut); process.exit(1); }

function meanLuma(png: Buffer): number {
  const img = PNG.sync.read(png);
  let sum = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n * 4; i += 4) sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  return sum / n;
}

// The install line each renderer patch logs in DEV (src/scene/*.ts), and the
// backends it installs on. bundle-pass-order and the two stable-name patches are
// WebGPU-only by design.
const PATCHES: { name: string; line: string; backends: Backend[] }[] = [
  { name: 'bundle-pass-order', line: '[bundle-pass-order] mid-pass bundle flush installed', backends: ['webgpu'] },
  { name: 'stable-shader-names', line: '[stable-shader-names] per-group uniform / per-stage variable names installed', backends: ['webgpu'] },
  { name: 'stale-vertex-buffers', line: '[stale-vertex-buffers] geometry-swap cache repair installed', backends: ['webgpu', 'webgl2'] },
  { name: 'material-attribution', line: '[material-attribution] unnamed materials will be auto-named', backends: ['webgpu', 'webgl2'] },
];

interface Result { backend: Backend; ok: boolean; problems: string[]; notes: string[] }

// A frozen page (main thread stuck) makes every page.evaluate wait forever, and
// the run dies to an outer `timeout` having printed nothing. So: every step is
// named, each page call has its own deadline, and a hang reports WHERE.
const STEP_TIMEOUT_MS = 30_000;
const verbose = process.argv.includes('--verbose');
function withTimeout<T>(p: Promise<T>, what: string, ms = STEP_TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s: ${what}`)), ms))]);
}

async function check(backend: Backend): Promise<Result> {
  const problems: string[] = [];
  const notes: string[] = [];
  const tStart = Date.now();
  const step = (what: string) => { if (verbose) console.error(`  [${backend} +${((Date.now() - tStart) / 1000).toFixed(1)}s] ${what}`); };
  const browser = await launchHeadless();
  const pageErrorsSeen: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    if (backend === 'webgpu') await installWebGPUShims(context);
    const page = await context.newPage();
    const pageErrors = pageErrorsSeen;
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(m.text()));

    const flag = backend === 'webgl2' ? '&webgpu=0' : '';
    const url = `http://127.0.0.1:${port}/brainstorm/?scenario=${scenarioName}&freeze=${frozen ? 'true' : 'false'}${flag}${urlExtra}`;
    const t0 = Date.now();
    step('goto');
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    step('waiting for reveal');

    const revealed = await page.waitForFunction(`(function () {
      function gone(id) { var el = document.getElementById(id); return !el || parseFloat(getComputedStyle(el).opacity) < 0.05; }
      return typeof window.__presentedFrames === 'function'
        && gone('descent-fade') && gone('descent-loading') && gone('boot-loading');
    })()`, undefined, { timeout: REVEAL_TIMEOUT_MS }).then(() => true, () => false);
    const revealAt = Date.now();
    notes.push(`reveal ${revealed ? 'after' : 'NOT within'} ${((revealAt - t0) / 1000).toFixed(1)}s`);
    if (!revealed) problems.push(`descent cover still up after ${REVEAL_TIMEOUT_MS / 1000}s`);

    // The backend we got, from create-renderer's own report. Same module instance
    // as the app: vite serves one URL per module.
    // The three the page actually LOADED vs the one installed. Vite serves
    // pre-bundled deps from <worktree>/.vite (vite.config.ts cacheDir) keyed on
    // the lockfile, so swapping three without the lockfile changing serves the
    // OLD build. On 2026-11-21 that made r187 look fixed twice when it was r186
    // from the cache. A mismatch makes every other number here meaningless.
    step('checking three revision');
    const loaded = await withTimeout(page.evaluate('window.__THREE__ || null'), 'three revision') as string | null;
    notes.push(`three r${loaded}`);
    if (loaded !== installedThree) {
      problems.push(`page loaded three r${loaded} but node_modules has r${installedThree} — stale vite cache? rm -rf .vite`);
    }

    step('reading backend');
    const active = await withTimeout(page.evaluate(`import('/brainstorm/src/scene/create-renderer.ts')
      .then(function (m) { return m.activeGraphicsBackend(); })
      .catch(function (e) { return 'unreadable: ' + e.message; })`), 'read backend') as string;
    notes.push(`backend ${active}`);
    if (active !== backend) problems.push(`asked for ${backend}, running on ${active}`);

    if (evalAfterReveal) {
      const out = await page.evaluate(evalAfterReveal).catch((e: Error) => `eval failed: ${e.message}`);
      // EVAL_CHARS=N widens the echoed result (default 120) for census-sized answers.
      notes.push(`eval → ${JSON.stringify(out)?.slice(0, Number(process.env.EVAL_CHARS ?? 120))}`);
      await page.waitForTimeout(1_000);   // let a pipeline rebuild land
    }
    if (wantCpu) {
      step('cpu listener');
      await withTimeout(page.evaluate(`import('/brainstorm/src/debug/frame-timing.ts').then(function (m) {
        var acc = window.__bbCpu = { n: 0, sums: {} };
        function add(k, v) { if (typeof v === 'number' && isFinite(v)) acc.sums[k] = (acc.sums[k] || 0) + v; }
        m.addFrameListener(function (s) {
          acc.n++;
          add('cpuMs', s.cpuMs); add('draws', s.draws); add('uploads', s.uploads);
          add('uploadKB', s.uploadKB); add('allocMB', s.allocMB);
          s.systems.forEach(function (v, k) { if (/^(render|enc)/.test(k)) add(k, v); });
        });
        return 'ok';
      })`), 'cpu listener');
    }
    step('sampling frames');
    const f0 = await withTimeout(page.evaluate('window.__presentedFrames ? window.__presentedFrames() : -1'), 'frame count') as number;
    await page.waitForTimeout(SAMPLE_MS);
    const f1 = await withTimeout(page.evaluate('window.__presentedFrames ? window.__presentedFrames() : -1'), 'frame count') as number;
    const frames = f1 - f0;
    notes.push(`${frames} frames in ${SAMPLE_MS / 1000}s`);
    if (f0 < 0) problems.push('window.__presentedFrames missing (renderer never wired?)');
    else if (frames < MIN_FRAMES) problems.push(`only ${frames} frames presented in ${SAMPLE_MS / 1000}s — stalled`);

    if (wantCpu) {
      const cpu = await withTimeout(page.evaluate(`(function () {
        var a = window.__bbCpu; if (!a || !a.n) return null;
        var out = { frames: a.n };
        Object.keys(a.sums).sort().forEach(function (k) { out[k] = +(a.sums[k] / a.n).toFixed(3); });
        return out;
      })()`), 'cpu read');
      console.log(`CPU ${JSON.stringify({ backend, three: installedThree, ...cpu })}`);
    }

    if (wantMetrics) {
      step('metrics');
      const m = await withTimeout(page.evaluate(`(function () {
        var c = window.__compileStats ? window.__compileStats() : null;
        var k = window.__pipelineCensus ? window.__pipelineCensus() : null;
        return {
          compiles: c ? { total: c.total, postWarmup: c.postWarmup, hitches: c.compileHitches, laggy: c.laggyFrames } : null,
          census: k ? { warmed: k.warmed, resident: k.resident, evicted: k.evicted, inPlaySeen: k.inPlaySeen } : null,
        };
      })()`), 'metrics').catch((e: Error) => ({ error: e.message }));
      console.log(`METRICS ${JSON.stringify({ backend, revealS: +((revealAt - t0) / 1000).toFixed(1), frames, ...m })}`);
    }

    // GPU errors BEFORE the screenshot: a capture that hangs must not hide them.
    step('gpu errors');
    const gpuErrors = await withTimeout(page.evaluate('(window.__gpuErrors || []).slice(0, 8)'), 'gpu errors') as string[];
    for (const e of gpuErrors) problems.push(`gpu validation: ${e.slice(0, 240)}`);
    const totalGpuErrors = await withTimeout(page.evaluate('(window.__gpuErrors || []).length'), 'gpu error count') as number;
    if (totalGpuErrors) notes.push(`${totalGpuErrors} gpu validation errors`);

    step('screenshot');
    if (backend === 'webgpu') await withTimeout(paintHeadlessFrame(page), 'paintHeadlessFrame');
    const shot = await withTimeout(page.screenshot(), 'screenshot');
    const luma = meanLuma(shot);
    notes.push(`mean luma ${luma.toFixed(1)}`);
    if (luma < MIN_MEAN_LUMA) problems.push(`screen is black (mean luma ${luma.toFixed(2)})`);
    const shotPath = `/tmp/backend-boot-${backend}${tag}.png`;
    if (keep || problems.length) { writeFileSync(shotPath, shot); notes.push(`screenshot ${shotPath}`); }

    // Each three.js patch logs one line when it installs (DEV) and SKIPS itself
    // silently when an upgrade moved its seam. tests/three-patch-canaries checks
    // the seams statically; this checks they actually installed on this backend.
    for (const p of PATCHES) {
      if (!p.backends.includes(backend)) continue;
      if (!consoleLines.some((l) => l.includes(p.line))) problems.push(`three.js patch not installed: ${p.name}`);
    }

    for (const e of pageErrors) problems.push(`page error: ${e.slice(0, 240)}`);
  } catch (e) {
    problems.push(`check crashed: ${(e as Error).message.slice(0, 300)}`);
    for (const e of pageErrorsSeen) problems.push(`page error: ${e.slice(0, 240)}`);
  } finally {
    await withTimeout(browser.close(), 'browser close', 10_000).catch(() => {});
  }
  return { backend, ok: problems.length === 0, problems, notes };
}

let failed = 0;
for (const b of backends) {
  const r = await check(b);
  console.log(`${r.ok ? '✓' : '✗'} ${b}: ${r.notes.join(', ')}`);
  for (const p of r.problems) console.log(`    ${p}`);
  if (!r.ok) failed++;
}
stopVite();
process.exit(failed ? 1 : 0);
