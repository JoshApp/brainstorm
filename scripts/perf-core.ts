/**
 * Perf harness core — the shared headless-profiling machinery behind both
 * `scripts/perf.ts` (single run) and `scripts/perf-ab.ts` (A/B compare).
 *
 * It boots the Vite dev server + a headless Chromium ONCE, then lets a caller
 * sample any number of scenario/flag configs against that one browser via
 * `harness.sample(cfg)`. Each sample reloads the page (a clean world per
 * config, no cross-contamination), waits for the level to build, then reads
 * `window.__perf()` every ~50ms for a few seconds and aggregates.
 *
 * WHY the counts are trustworthy and FPS is not: headless Chromium renders via
 * `--use-gl=swiftshader` (a CPU rasteriser), so wall-clock frame time here is
 * NOT representative of a real mobile GPU. The `renderer.info` COUNTS, however,
 * are GPU-independent and deterministic — draw calls (incl. the shadow-map
 * passes, which Three accumulates into render.calls), triangles, active lights,
 * GPU programs. Those are exactly what predict cost on the phone. Read FPS off
 * the on-screen PERF METER on the actual device.
 *
 * Requires `window.__perf`, which is DEV-only (installed in main.ts behind
 * import.meta.env.DEV) — so this works against the dev server only, never a
 * production build. That's fine: it's a dev tool.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];

export function resolveChromium(): string {
  return CHROMIUM_CANDIDATES.find((p) => existsSync(p)) ?? CHROMIUM_CANDIDATES[0];
}

export interface Viewport { width: number; height: number; deviceScaleFactor?: number; }
export const VIEWPORTS: Record<string, Viewport> = {
  desktop: { width: 1280, height: 600 },
  phone:   { width: 844, height: 390, deviceScaleFactor: 2 },
  tablet:  { width: 1024, height: 768 },
};

/** Raw shape returned by window.__perf() (see src/debug/perf-probe.ts). */
export interface PerfSnapshot {
  fps: number; lastMs: number; p95Ms: number;
  draws: number; tris: number;
  geometries: number; textures: number; programs: number; geometryPool: number;
  lightsActive: number; lightsRegistered: number;
  heapMB: number | null; allocRateMBs: number | null; gcPerSec: number | null;
}

export interface Stat { min: number; avg: number; max: number; }

/** Aggregated result of sampling one config — the per-frame counters reduced
 *  to min/avg/max plus the (static) last-frame GPU-resource counts. */
export interface PerfAggregate {
  scenario: string;
  label: string;
  samples: number;
  draws: Stat; tris: Stat; lightsActive: Stat; lightsRegistered: Stat;
  geometries: number; textures: number; programs: number; geometryPool: number;
  heapMB: Stat | null; allocRateMBs: Stat | null; gcPerSec: Stat | null;
}

export interface SampleConfig {
  scenario: string;
  /** Extra URL flags, e.g. { shadows: 'off', n: '16' }. */
  flags?: Record<string, string>;
  /** Sample window in seconds (default 6). */
  secs?: number;
  /** Display label (defaults to a "scenario flags" summary). */
  label?: string;
}

export function stat(xs: number[]): Stat {
  if (!xs.length) return { min: 0, avg: 0, max: 0 };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; sum += x; }
  return { min, avg: sum / xs.length, max };
}

export function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
export function padL(s: string, n: number): string { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
export function num(n: number, d = 0): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** A live harness: one Vite server + one browser page, sample many configs. */
export interface Harness {
  /** Navigate to a config + aggregate window.__perf() over the sample window. */
  sample(cfg: SampleConfig): Promise<PerfAggregate>;
  /** Navigate to a config, wait for the build, then read ANY DEV probe once
   *  (e.g. window.__drawData()). For one-shot structural dissection. */
  read<T>(cfg: SampleConfig, probe: string): Promise<T>;
  /** Navigate to a config, then hand the raw Playwright page to the caller —
   *  for tools that need CDP access (heap sampling, tracing). */
  withPage<T>(cfg: SampleConfig, fn: (page: Page) => Promise<T>): Promise<T>;
}

function buildUrl(port: number, cfg: SampleConfig): string {
  const params = new URLSearchParams({ scenario: cfg.scenario, freeze: 'false' });
  for (const [k, v] of Object.entries(cfg.flags ?? {})) params.set(k, v);
  return `http://127.0.0.1:${port}/brainstorm/?${params.toString()}`;
}

export function flagLabel(cfg: SampleConfig): string {
  const flags = Object.entries(cfg.flags ?? {}).map(([k, v]) => `${k}=${v}`).join(',');
  return cfg.label ?? (flags ? `${cfg.scenario} ${flags}` : cfg.scenario);
}

/**
 * Boot Vite + Chromium once, hand a sampler to `fn`, tear everything down.
 * `port` defaults to a random high port so parallel runs don't collide.
 */
export async function withHarness(
  opts: { viewport: Viewport; port?: number; onLog?: (line: string) => void },
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  const chromiumPath = resolveChromium();
  if (!existsSync(chromiumPath)) {
    throw new Error(`Chromium binary not found at ${chromiumPath} — run: npx playwright install chromium`);
  }
  const port = opts.port ?? 5280 + Math.floor(Math.random() * 80);
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');

  const vite: ChildProcess = spawn(
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
  if (!ready) {
    try { vite.kill('SIGKILL'); } catch { /* already dead */ }
    throw new Error('Vite did not start in 20s:\n' + viteOutput);
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath: chromiumPath,
      // --enable-precise-memory-info unlocks usedJSHeapSize granularity so the
      // GC churn proxy is meaningful headless.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-precise-memory-info'],
    });
    const context = await browser.newContext({ viewport: opts.viewport });
    const page: Page = await context.newPage();
    page.on('pageerror', (err) => opts.onLog?.(`[browser pageerror] ${err.message}`));

    // Navigate to a config + wait for the level to build. Shared by sample/read.
    const goto = async (cfg: SampleConfig): Promise<void> => {
      const url = buildUrl(port, cfg);
      opts.onLog?.(`opening ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(1500);   // level build + enemies wake
    };

    const read = async <T>(cfg: SampleConfig, probe: string): Promise<T> => {
      await goto(cfg);
      // Optional extra settle (cfg.secs) — for probes that need the world to run
      // a while first (e.g. mobs aggroing + ringing up before __mobPack reads).
      if (cfg.secs) await page.waitForTimeout(cfg.secs * 1000);
      return page.evaluate((p) => (window as unknown as Record<string, () => unknown>)[p](), probe) as Promise<T>;
    };

    const sample = async (cfg: SampleConfig): Promise<PerfAggregate> => {
      const secs = cfg.secs ?? 6;
      await goto(cfg);

      const hasProbe = await page.evaluate(() => typeof (window as { __perf?: unknown }).__perf === 'function');
      if (!hasProbe) {
        throw new Error('window.__perf not found — is this the DEV server? (probe is DEV-gated)');
      }

      const samples: PerfSnapshot[] = [];
      const ticks = Math.max(1, Math.round((secs * 1000) / 50));
      for (let i = 0; i < ticks; i++) {
        samples.push(await page.evaluate(() => (window as unknown as { __perf: () => PerfSnapshot }).__perf()));
        await page.waitForTimeout(50);
      }
      // Drop the first few samples (warmup: shader compiles, first AI ticks).
      const warm = samples.slice(Math.min(10, samples.length - 1));
      const last = warm[warm.length - 1];
      const heap = warm.map((s) => s.heapMB).filter((h): h is number => h !== null);
      const alloc = warm.map((s) => s.allocRateMBs).filter((h): h is number => h !== null);
      const gc = warm.map((s) => s.gcPerSec).filter((h): h is number => h !== null);
      return {
        scenario: cfg.scenario,
        label: flagLabel(cfg),
        samples: warm.length,
        draws: stat(warm.map((s) => s.draws)),
        tris: stat(warm.map((s) => s.tris)),
        lightsActive: stat(warm.map((s) => s.lightsActive)),
        lightsRegistered: stat(warm.map((s) => s.lightsRegistered)),
        geometries: last.geometries, textures: last.textures,
        programs: last.programs, geometryPool: last.geometryPool,
        heapMB: heap.length ? stat(heap) : null,
        allocRateMBs: alloc.length ? stat(alloc) : null,
        gcPerSec: gc.length ? stat(gc) : null,
      };
    };

    const withPage = async <T>(cfg: SampleConfig, pfn: (p: Page) => Promise<T>): Promise<T> => {
      await goto(cfg);
      return pfn(page);
    };

    await fn({ sample, read, withPage });
  } finally {
    if (browser) await browser.close().catch(() => { /* best effort */ });
    if (vite.pid) { try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* group gone */ } }
    try { vite.kill('SIGKILL'); } catch { /* already dead */ }
  }
}

/** Parse `--secs=`, `--port=`, and a viewport positional from argv. Shared by
 *  both CLIs. `argv` is process.argv.slice(2). */
export function parseCommonArgs(argv: string[]): {
  positionals: string[]; viewport: Viewport; viewportName: string; secs: number; port?: number;
} {
  const flags = argv.filter((a) => a.startsWith('--'));
  const positionals = argv.filter((a) => !a.startsWith('--'));
  const secs = Number(flags.find((a) => a.startsWith('--secs='))?.split('=')[1] ?? '6');
  const portStr = flags.find((a) => a.startsWith('--port='))?.split('=')[1];
  const port = portStr ? Number(portStr) : undefined;
  // Viewport is the first positional that names a known viewport.
  const viewportName = positionals.find((p) => p in VIEWPORTS) ?? 'desktop';
  return {
    positionals: positionals.filter((p) => !(p in VIEWPORTS)),
    viewport: VIEWPORTS[viewportName], viewportName, secs, port,
  };
}
