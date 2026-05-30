/**
 * Snap CLI — headless screenshot of the game in a given scenario.
 *
 * Usage:
 *   npm run snap                              (defaults to "spawn", desktop viewport)
 *   npm run snap enemy-close
 *   npm run snap inventory phone              (phone-landscape viewport)
 *   npm run snap inventory phone-portrait
 *   npm run snap inventory tablet
 *   npm run snap inventory desktop
 *   npm run snap spawn --port=5180            (use a different port)
 *
 * Output: /tmp/snap-<scenario>.png            (or -<viewport>.png if non-default)
 *
 * Use the viewport presets to iterate on mobile UI without guessing —
 * the inventory panel needs different framing on a 392-tall phone vs
 * a 600-tall laptop window.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Pre-installed by the sandbox; Playwright's normal browser download is blocked.
// Probe the known install locations (sandbox + Playwright's own cache) and
// take the first that exists, rather than hard-coding one version path.
const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const CHROMIUM_PATH = CHROMIUM_CANDIDATES.find((p) => existsSync(p)) ?? CHROMIUM_CANDIDATES[0];

// Viewport presets. Realistic mobile/tablet sizes so the snap previews
// match what Josh actually sees on his phone.
const VIEWPORTS: Record<string, { width: number; height: number; deviceScaleFactor?: number }> = {
  // Default — laptop window, what we've been snapping all along.
  desktop:          { width: 1280, height: 600 },
  // iPhone 14 Pro effective landscape (390 × 844 portrait → 844 × 390 landscape;
  // the safe area between notches narrows usable space slightly).
  phone:            { width: 844,  height: 390 },
  // iPhone 14 Pro portrait — to test the rotate-warning + portrait UX.
  'phone-portrait': { width: 390,  height: 844 },
  // Slightly larger phone (Pixel 7) landscape.
  'phone-large':    { width: 915,  height: 412 },
  // iPad mini landscape.
  tablet:           { width: 1024, height: 768 },
};

// Scenarios that need extra wait time (animations playing out)
// Screens with multi-second open animations need a longer wait so the
// snap captures the FINAL state (title's letter-spacing tween is 1.6s,
// the death sequence is several seconds before the end screen).
const LONG_WAIT_SCENARIOS = new Set([
  'death', 'title', 'title-continue', 'title-veteran', 'end', 'codex', 'stash',
]);

async function main() {
  const scenario = process.argv[2] || 'spawn';

  // Optional viewport name as the 3rd positional arg.
  const viewportArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'desktop';
  const viewport = VIEWPORTS[viewportArg];
  if (!viewport) {
    console.error(`Unknown viewport "${viewportArg}". Available: ${Object.keys(VIEWPORTS).join(', ')}`);
    process.exit(1);
  }
  console.log(`Viewport: ${viewportArg} ${viewport.width}×${viewport.height}`);

  const port = Number(
    process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ??
      String(5180 + Math.floor(Math.random() * 100)),
  );
  const outDir = '/tmp';
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // Suffix with viewport name unless it's the default desktop.
  const suffix = viewportArg === 'desktop' ? '' : `-${viewportArg}`;
  const outPath = `${outDir}/snap-${scenario}${suffix}.png`;

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

    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    // Special pseudo-scenarios that need a bare URL (no ?scenario=…) so
    // the normal boot path (title screen / end screen) shows up instead
    // of being bypassed by the debug scenario shortcut.
    const isBare =
      scenario === 'title' || scenario === 'title-continue' ||
      scenario === 'title-veteran' || scenario === 'end' ||
      scenario === 'codex' || scenario === 'stash';
    let url: string;
    if (scenario === 'end') url = `http://127.0.0.1:${port}/brainstorm/?showEnd=1&fakemeta=1`;
    else if (scenario === 'title-continue') url = `http://127.0.0.1:${port}/brainstorm/?fakesave=1`;
    else if (scenario === 'title-veteran') url = `http://127.0.0.1:${port}/brainstorm/?fakemeta=1`;
    else if (scenario === 'codex') url = `http://127.0.0.1:${port}/brainstorm/?fakemeta=1&showCodex=1`;
    else if (scenario === 'stash') url = `http://127.0.0.1:${port}/brainstorm/?fakemeta=1&showStash=1`;
    else if (scenario === 'safe-transition') url = `http://127.0.0.1:${port}/brainstorm/?showSafeTransition=1`;
    else if (isBare) url = `http://127.0.0.1:${port}/brainstorm/`;
    else url = `http://127.0.0.1:${port}/brainstorm/?scenario=${encodeURIComponent(scenario)}`;
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
