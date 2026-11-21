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
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { launchHeadless, installWebGPUShims, paintHeadlessFrame, chromiumPath, CHROMIUM_CANDIDATES } from './headless-browser';

type Backend = 'webgpu' | 'webgl2';

const SAMPLE_MS = 5_000;
const MIN_FRAMES = 10;           // over SAMPLE_MS; software rendering is slow, a stall is 0-2
const MIN_MEAN_LUMA = 2.0;       // 0-255. The dungeon is dark by design; a dead canvas is ~0
const REVEAL_TIMEOUT_MS = 120_000;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const wanted = (arg('backend') ?? 'both') as Backend | 'both';
const backends: Backend[] = wanted === 'both' ? ['webgl2', 'webgpu'] : [wanted];
const keep = process.argv.includes('--keep');
// Extra URL params for A/B runs, e.g. --url-extra=clustered=0 runs WebGPU on the
// tiled light loop the WebGL2 backend uses, to split backend from lighting.
const urlExtra = arg('url-extra') ? `&${arg('url-extra')}` : '';
const tag = arg('tag') ? `-${arg('tag')}` : '';
// --eval=<js expression> runs in the page after reveal and before sampling (may
// return a promise). For runtime A/Bs a URL flag can't express, e.g.
//   --eval="import('/brainstorm/src/style/render-webgpu.ts').then(m=>m.setGradeBypass(true))"
const evalAfterReveal = process.argv.find((a) => a.startsWith('--eval='))?.slice('--eval='.length);

if (!chromiumPath()) {
  console.error(`No Chromium found. Looked in:\n  ${CHROMIUM_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}

const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
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
  { name: 'stable-buffer-names', line: '[stable-buffer-names] shape-derived uniform-buffer names installed', backends: ['webgpu'] },
  { name: 'stable-shader-names', line: '[stable-shader-names] per-group uniform / per-stage variable names installed', backends: ['webgpu'] },
  { name: 'stale-vertex-buffers', line: '[stale-vertex-buffers] geometry-swap cache repair installed', backends: ['webgpu', 'webgl2'] },
  { name: 'material-attribution', line: '[material-attribution] unnamed materials will be auto-named', backends: ['webgpu', 'webgl2'] },
];

interface Result { backend: Backend; ok: boolean; problems: string[]; notes: string[] }

async function check(backend: Backend): Promise<Result> {
  const problems: string[] = [];
  const notes: string[] = [];
  const browser = await launchHeadless();
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    if (backend === 'webgpu') await installWebGPUShims(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(m.text()));

    const flag = backend === 'webgl2' ? '&webgpu=0' : '';
    const url = `http://127.0.0.1:${port}/brainstorm/?scenario=spawn&freeze=false${flag}${urlExtra}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });

    const revealed = await page.waitForFunction(`(function () {
      function gone(id) { var el = document.getElementById(id); return !el || parseFloat(getComputedStyle(el).opacity) < 0.05; }
      return typeof window.__presentedFrames === 'function'
        && gone('descent-fade') && gone('descent-loading') && gone('boot-loading');
    })()`, undefined, { timeout: REVEAL_TIMEOUT_MS }).then(() => true, () => false);
    notes.push(`reveal ${revealed ? 'after' : 'NOT within'} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!revealed) problems.push(`descent cover still up after ${REVEAL_TIMEOUT_MS / 1000}s`);

    // The backend we got, from create-renderer's own report. Same module instance
    // as the app: vite serves one URL per module.
    const active = await page.evaluate(`import('/brainstorm/src/scene/create-renderer.ts')
      .then(function (m) { return m.activeGraphicsBackend(); })
      .catch(function (e) { return 'unreadable: ' + e.message; })`) as string;
    notes.push(`backend ${active}`);
    if (active !== backend) problems.push(`asked for ${backend}, running on ${active}`);

    if (evalAfterReveal) {
      const out = await page.evaluate(evalAfterReveal).catch((e: Error) => `eval failed: ${e.message}`);
      notes.push(`eval → ${JSON.stringify(out)?.slice(0, 120)}`);
      await page.waitForTimeout(1_000);   // let a pipeline rebuild land
    }
    const f0 = await page.evaluate('window.__presentedFrames ? window.__presentedFrames() : -1') as number;
    await page.waitForTimeout(SAMPLE_MS);
    const f1 = await page.evaluate('window.__presentedFrames ? window.__presentedFrames() : -1') as number;
    const frames = f1 - f0;
    notes.push(`${frames} frames in ${SAMPLE_MS / 1000}s`);
    if (f0 < 0) problems.push('window.__presentedFrames missing (renderer never wired?)');
    else if (frames < MIN_FRAMES) problems.push(`only ${frames} frames presented in ${SAMPLE_MS / 1000}s — stalled`);

    if (backend === 'webgpu') await paintHeadlessFrame(page);
    const shot = await page.screenshot();
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

    const gpuErrors = await page.evaluate('(window.__gpuErrors || []).slice(0, 8)') as string[];
    for (const e of gpuErrors) problems.push(`gpu validation: ${e.slice(0, 240)}`);
    for (const e of pageErrors) problems.push(`page error: ${e.slice(0, 240)}`);
  } catch (e) {
    problems.push(`check crashed: ${(e as Error).message.slice(0, 300)}`);
  } finally {
    await browser.close();
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
