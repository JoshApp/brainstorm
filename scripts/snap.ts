/**
 * Snap CLI — headless screenshot of the game in a given scenario.
 *
 * Usage:
 *   npm run snap                 (defaults to "spawn")
 *   npm run snap enemy-close
 *   npm run snap death
 *   npm run snap sword-strike
 *   npm run snap spawn --port=5180  (use a different port)
 *
 * Output: /tmp/snap-<scenario>.png
 *
 * Flow:
 *   1. Spawn `vite` dev server on a free port
 *   2. Wait for it to bind
 *   3. Open headless Chromium at /brainstorm/?scenario=<name>
 *   4. Wait for the scene to settle
 *   5. Take a viewport screenshot (default: phone landscape, 1280x600)
 *   6. Clean up
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Pre-installed by the sandbox; Playwright's normal browser download is blocked.
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const VIEWPORT = { width: 1280, height: 600 }; // phone landscape-ish

// Scenarios that need extra wait time (animations playing out)
const LONG_WAIT_SCENARIOS = new Set(['death']);

async function main() {
  const scenario = process.argv[2] || 'spawn';
  // Random port per run so stale vite processes from previous failed runs
  // don't collide. Range 5180-5280.
  const port = Number(
    process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ??
      String(5180 + Math.floor(Math.random() * 100)),
  );
  const outDir = '/tmp';
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/snap-${scenario}.png`;

  if (!existsSync(CHROMIUM_PATH)) {
    console.error(`Chromium binary not found at ${CHROMIUM_PATH}`);
    console.error('You may need to: PLAYWRIGHT_DOWNLOAD_HOST=... npx playwright install chromium');
    process.exit(1);
  }

  // 1. Start Vite. detached:true makes it a process group leader, so we can
  // kill the whole tree (vite + its esbuild child + npx shell) with one signal.
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn(
    'node_modules/.bin/vite',
    ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );

  let viteOutput = '';
  vite.stdout?.on('data', (chunk: Buffer) => {
    viteOutput += chunk.toString();
  });
  vite.stderr?.on('data', (chunk: Buffer) => {
    viteOutput += chunk.toString();
  });

  const ready = await new Promise<boolean>((resolve) => {
    const interval = setInterval(() => {
      if (/Local:\s+http:\/\/.+:\d+/.test(viteOutput)) {
        clearInterval(interval);
        resolve(true);
      }
    }, 100);
    setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, 20_000);
  });

  if (!ready) {
    console.error('Vite did not start within 20s. Output:\n' + viteOutput);
    vite.kill();
    process.exit(1);
  }

  // 2. Launch headless Chromium with the pre-installed binary
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
    });

    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    const url = `http://127.0.0.1:${port}/brainstorm/?scenario=${encodeURIComponent(scenario)}`;
    console.log(`Opening ${url}`);

    // Forward browser console messages (log/warn/error) to CLI output
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning' || type === 'log') {
        console.log(`  [browser ${type}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`  [browser pageerror] ${err.message}`);
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for canvas to actually render some frames
    const waitMs = LONG_WAIT_SCENARIOS.has(scenario) ? 1800 : 900;
    await page.waitForTimeout(waitMs);

    await page.screenshot({ path: outPath });
    console.log(`Saved ${outPath}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Kill the whole process group so vite + its esbuild child both die.
    if (vite.pid) {
      try { process.kill(-vite.pid, 'SIGKILL'); } catch {}
    }
    try { vite.kill('SIGKILL'); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
