/**
 * Perf CLI — headless structural-load profiler for a given scenario.
 *
 * Boots Vite, loads a scenario UNFROZEN (so AI / projectiles / light
 * binding tick), samples window.__perf() once per ~animation frame for a
 * few seconds, and prints min / avg / max of the cost-predicting counters:
 * draw calls, triangles, active lights, GPU geometries/textures/programs,
 * plus a JS-heap allocation-churn (GC) proxy.
 *
 * Usage:
 *   npm run perf                          (defaults to "perf-max")
 *   npm run perf perf-horde
 *   npm run perf perf-lights phone        (phone viewport DPR)
 *   npm run perf spawn --secs=8
 *   npm run perf perf-max --port=5191
 *
 * WHY no FPS: headless Chromium renders via --use-gl=swiftshader (a CPU
 * rasteriser), so wall-clock frame time here is NOT representative of a
 * real mobile GPU. The renderer.info COUNTS, however, are GPU-independent
 * and deterministic — they're exactly what predicts cost on the phone.
 * Read FPS off the on-screen PERF METER on the actual device.
 *
 * Requires window.__perf, which is DEV-only (installed in main.ts behind
 * import.meta.env.DEV) — so this works against the dev server only, never
 * a production build. That's fine: it's a dev tool.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const CHROMIUM_PATH = CHROMIUM_CANDIDATES.find((p) => existsSync(p)) ?? CHROMIUM_CANDIDATES[0];

const VIEWPORTS: Record<string, { width: number; height: number; deviceScaleFactor?: number }> = {
  desktop: { width: 1280, height: 600 },
  phone:   { width: 844, height: 390, deviceScaleFactor: 2 },
  tablet:  { width: 1024, height: 768 },
};

interface PerfSnapshot {
  fps: number; lastMs: number; p95Ms: number;
  draws: number; tris: number;
  geometries: number; textures: number; programs: number; geometryPool: number;
  lightsActive: number; lightsRegistered: number;
  heapMB: number | null; allocRateMBs: number | null; gcPerSec: number | null;
}

function stat(xs: number[]) {
  if (!xs.length) return { min: 0, avg: 0, max: 0 };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; sum += x; }
  return { min, avg: sum / xs.length, max };
}
function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function num(n: number, d = 0): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

async function main() {
  const scenario = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'perf-max';
  const viewportArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'desktop';
  const viewport = VIEWPORTS[viewportArg] ?? VIEWPORTS.desktop;
  const secs = Number(process.argv.find((a) => a.startsWith('--secs='))?.split('=')[1] ?? '6');
  const port = Number(
    process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ??
      String(5280 + Math.floor(Math.random() * 80)),
  );

  if (!existsSync(CHROMIUM_PATH)) {
    console.error(`Chromium binary not found at ${CHROMIUM_PATH}`);
    process.exit(1);
  }

  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn(
    'node_modules/.bin/vite',
    ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let viteOutput = '';
  vite.stdout?.on('data', (c: Buffer) => { viteOutput += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { viteOutput += c.toString(); });

  const ready = await new Promise<boolean>((resolve) => {
    const iv = setInterval(() => {
      if (/Local:\s+http:\/\/.+:\d+/.test(viteOutput)) { clearInterval(iv); resolve(true); }
    }, 100);
    setTimeout(() => { clearInterval(iv); resolve(false); }, 20_000);
  });
  if (!ready) { console.error('Vite did not start in 20s:\n' + viteOutput); vite.kill(); process.exit(1); }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      // --enable-precise-memory-info unlocks usedJSHeapSize granularity so
      // the GC churn proxy is meaningful headless.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-precise-memory-info'],
    });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.log(`  [browser pageerror] ${err.message}`));

    // freeze=false so the world ticks; this is a load test, not a snapshot.
    // --portalcull / --shadows= DEV overrides pass through for A/B perf runs.
    const portalCull = process.argv.includes('--portalcull') ? '&portalcull=1' : '';
    const shadowsArg = process.argv.find((a) => a.startsWith('--shadows='))?.split('=')[1];
    const shadowsOverride = shadowsArg ? `&shadows=${encodeURIComponent(shadowsArg)}` : '';
    const url = `http://127.0.0.1:${port}/brainstorm/?scenario=${encodeURIComponent(scenario)}&freeze=false${portalCull}${shadowsOverride}`;
    console.log(`\nPERF · scenario "${scenario}" · ${viewportArg} ${viewport.width}×${viewport.height} · ${secs}s sample`);
    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Let the level build + enemies wake before sampling.
    await page.waitForTimeout(1500);

    const hasProbe = await page.evaluate(() => typeof (window as any).__perf === 'function');
    if (!hasProbe) {
      console.error('window.__perf not found — is this the DEV server? (probe is DEV-gated)');
      throw new Error('no probe');
    }

    // Sample once every ~50ms for `secs` seconds.
    const samples: PerfSnapshot[] = [];
    const ticks = Math.max(1, Math.round((secs * 1000) / 50));
    for (let i = 0; i < ticks; i++) {
      const s = await page.evaluate(() => (window as any).__perf() as PerfSnapshot);
      samples.push(s);
      await page.waitForTimeout(50);
    }

    // Drop the first few samples (warmup: shader compiles, first AI ticks).
    const warm = samples.slice(Math.min(10, samples.length - 1));
    const draws = stat(warm.map((s) => s.draws));
    const tris = stat(warm.map((s) => s.tris));
    const la = stat(warm.map((s) => s.lightsActive));
    const lr = stat(warm.map((s) => s.lightsRegistered));
    const last = warm[warm.length - 1];

    const heapSamples = warm.map((s) => s.heapMB).filter((h): h is number => h !== null);
    const allocSamples = warm.map((s) => s.allocRateMBs).filter((h): h is number => h !== null);
    const gcSamples = warm.map((s) => s.gcPerSec).filter((h): h is number => h !== null);

    console.log('\n' + '─'.repeat(56));
    console.log(`  ${pad('metric', 22)}${pad('min', 10)}${pad('avg', 10)}${pad('max', 10)}`);
    console.log('─'.repeat(56));
    const row = (label: string, s: { min: number; avg: number; max: number }, d = 0) =>
      console.log(`  ${pad(label, 22)}${pad(num(s.min, d), 10)}${pad(num(s.avg, d), 10)}${pad(num(s.max, d), 10)}`);
    row('draw calls', draws);
    row('triangles', tris);
    row('active lights', la);
    row('registered lights', lr);
    console.log('─'.repeat(56));
    console.log(`  ${pad('static (last frame)', 22)}`);
    console.log(`    geometries (GPU)    ${num(last.geometries)}`);
    console.log(`    textures (GPU)      ${num(last.textures)}`);
    console.log(`    shader programs     ${num(last.programs)}`);
    console.log(`    geometry pool       ${num(last.geometryPool)}`);
    console.log('─'.repeat(56));
    if (heapSamples.length) {
      const h = stat(heapSamples), a = stat(allocSamples), g = stat(gcSamples);
      console.log(`  GC / allocation churn (heap sawtooth):`);
      console.log(`    JS heap MB          ${num(h.min, 1)} … ${num(h.max, 1)}`);
      console.log(`    alloc churn MB/s    ${num(a.avg, 2)} avg, ${num(a.max, 2)} peak`);
      console.log(`    GC collections/s    ${num(g.avg, 1)} avg, ${num(g.max, 0)} peak`);
    } else {
      console.log(`  GC churn: heap not exposed by this browser build.`);
    }
    console.log('─'.repeat(56));
    console.log(`  (headless swiftshader — counts are real, FPS is not. ${warm.length} samples.)\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (vite.pid) { try { process.kill(-vite.pid, 'SIGKILL'); } catch {} }
    try { vite.kill('SIGKILL'); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
