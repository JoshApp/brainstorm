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
 *   # Animation grid — capture N evenly-spaced frames over a duration
 *   # and lay them out as a contact sheet. Auto-unfreezes the scenario
 *   # so animations actually run. Saves to /tmp/snap-<scenario>-grid.png.
 *   npm run snap mob-mimic --frames=6                (6 frames over 2s)
 *   npm run snap boss --frames=8 --duration=4        (8 frames over 4s)
 *
 * Output: /tmp/snap-<scenario>.png            (or -<viewport>.png if non-default)
 *         /tmp/snap-<scenario>-grid.png       (when --frames is set)
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
  'elevation-lab',   // descent title card covers the frame for ~1.6s
]);

// Contact-sheet column count by frame count. Hand-picked for the
// common N values so the grid reads time-left-to-right, top-to-bottom
// with no awkward gaps. Falls back to a square-ish layout for
// anything else.
function gridCols(n: number): number {
  if (n <= 3) return n;
  if (n === 4) return 2;
  if (n <= 6) return 3;
  if (n === 8) return 4;
  if (n === 9) return 3;
  if (n <= 12) return 4;
  return Math.ceil(Math.sqrt(n));
}

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

  // Animation-grid mode: --frames=N (and optional --duration=Ns, default 2s).
  // 0/undefined = single-frame mode (the original behaviour).
  const framesArg = process.argv.find((a) => a.startsWith('--frames='))?.split('=')[1];
  const frameCount = framesArg ? Math.max(1, Math.min(32, Number(framesArg))) : 0;
  const durationSec = Number(process.argv.find((a) => a.startsWith('--duration='))?.split('=')[1] ?? '2');
  const durationMs = Math.max(100, durationSec * 1000);
  if (frameCount > 0) {
    console.log(`Animation grid: ${frameCount} frames over ${durationSec}s`);
  }

  const port = Number(
    process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ??
      String(5180 + Math.floor(Math.random() * 100)),
  );
  const outDir = '/tmp';
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // Suffix with viewport name unless it's the default desktop.
  const suffix = viewportArg === 'desktop' ? '' : `-${viewportArg}`;
  const outPath = frameCount > 0
    ? `${outDir}/snap-${scenario}${suffix}-grid.png`
    : `${outDir}/snap-${scenario}${suffix}.png`;

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
    // In animation-grid mode, force the scenario UNFROZEN so the world
    // actually ticks between captures — the whole point is to see what
    // moves. ?freeze=false overrides scenario.freeze at apply time
    // (see getScenarioFromUrl in src/debug/scenarios.ts).
    const freezeOverride = frameCount > 0 ? '&freeze=false' : '';
    // INSPECTION MODE — flood the scene with flat bright light, push
    // fog out, suppress the floor title card, and strip the gameplay
    // HUD. Auto-enabled for any scenario named mob-*, model-*, item-*,
    // or vault-* (the inspection scenario family). --inspect forces it
    // on for anything else; --no-inspect turns it off if you actually
    // want torch-lit atmosphere on a mob shot.
    const inspectFamily = /^(mob|model|item|vault|palette)-/.test(scenario);
    const inspectFlag = process.argv.includes('--inspect');
    const noInspectFlag = process.argv.includes('--no-inspect');
    const wantInspect = noInspectFlag ? false : (inspectFlag || inspectFamily);
    const inspectOverride = wantInspect ? '&inspect=true' : '';
    // Subject-only previews hide the level geometry around the mob/
    // item/model. Vault previews opt OUT — the room IS the subject.
    const subjectOnlyFamily = /^(mob|model|item)-/.test(scenario);
    const subjectOnlyOverride = subjectOnlyFamily ? '&inspectSubjectOnly=true' : '';
    if (wantInspect) console.log('Inspect mode: flat-lit, HUD stripped, title suppressed');
    // HUD-only mode — auto-enabled for `hud-*` scenarios. Hides the
    // 3D canvas + puts a flat backdrop behind the HUD widgets so the
    // inventory panel / HP bar / hotbar / broadcast pop / boss bar
    // can be snapped without the dungeon scene fighting them.
    const hudFamily = /^hud-/.test(scenario);
    const hudOnlyFlag = process.argv.includes('--hud-only');
    const wantHudOnly = hudOnlyFlag || hudFamily;
    const hudOnlyOverride = wantHudOnly ? '&hudOnly=true' : '';
    if (wantHudOnly) console.log('HUD-only mode: canvas hidden, flat backdrop');
    // --shadows=off|hero|single|all forces the dynamic-shadow mode (DEV URL
    // override) so a scene can be snapped + compared across shadow settings.
    const shadowsArg = process.argv.find((a) => a.startsWith('--shadows='))?.split('=')[1];
    const shadowsOverride = shadowsArg ? `&shadows=${encodeURIComponent(shadowsArg)}` : '';
    if (shadowsArg) console.log(`Shadow mode: ${shadowsArg}`);
    // --ps1=0.3 forces the scene-render scale (DEV override).
    const ps1Arg = process.argv.find((a) => a.startsWith('--ps1='))?.split('=')[1];
    const ps1Override = ps1Arg ? `&ps1=${encodeURIComponent(ps1Arg)}` : '';
    if (ps1Arg) console.log(`PS1 scale: ${ps1Arg}`);
    // --portalcull forces room culling on (DEV override) for A/B.
    const portalCull = process.argv.includes('--portalcull') ? '&portalcull=1' : '';
    if (portalCull) console.log('Portal culling: ON');
    // --phase=strike poses the equipped weapon at a swing phase (animation review).
    const phaseArg = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1];
    const phaseOverride = phaseArg ? `&phase=${encodeURIComponent(phaseArg)}` : '';
    if (phaseArg) console.log(`Weapon phase: ${phaseArg}`);
    let url: string;
    if (scenario === 'end') url = `http://127.0.0.1:${port}/brainstorm/?showEnd=1&fakemeta=1`;
    else if (scenario === 'title-continue') url = `http://127.0.0.1:${port}/brainstorm/?fakesave=1`;
    else if (scenario === 'title-veteran') url = `http://127.0.0.1:${port}/brainstorm/?fakemeta=1`;
    else if (scenario === 'codex') url = `http://127.0.0.1:${port}/brainstorm/?fakemeta=1&showCodex=1`;
    else if (scenario === 'stash') url = `http://127.0.0.1:${port}/brainstorm/?fakemeta=1&showStash=1`;
    else if (scenario === 'safe-transition') url = `http://127.0.0.1:${port}/brainstorm/?showSafeTransition=1`;
    else if (isBare) url = `http://127.0.0.1:${port}/brainstorm/`;
    // Item viewer: `item-<id>` is sugar for the generic `item`
    // scenario with the requested item id passed via the &item=
    // URL override. Lets us snap any of the 50+ items with one
    // scenario row + one snap arg.
    else if (scenario.startsWith('item-')) {
      const itemId = scenario.slice('item-'.length);
      url = `http://127.0.0.1:${port}/brainstorm/?scenario=item&item=${encodeURIComponent(itemId)}${freezeOverride}${inspectOverride}${hudOnlyOverride}${subjectOnlyOverride}${shadowsOverride}`;
    }
    else url = `http://127.0.0.1:${port}/brainstorm/?scenario=${encodeURIComponent(scenario)}${freezeOverride}${inspectOverride}${hudOnlyOverride}${subjectOnlyOverride}${shadowsOverride}${ps1Override}${portalCull}${phaseOverride}`;
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

    // Wait for canvas to actually render some frames. Vault-inspector previews
    // (`vault-<id>`) wait long enough for the floor title card to fully fade
    // (~1.6s after load) so the geometry shot isn't covered by "Depth N" text.
    const longWait = LONG_WAIT_SCENARIOS.has(scenario) || scenario.startsWith('vault-');
    const waitMs = longWait ? 2000 : 900;
    await page.waitForTimeout(waitMs);

    if (frameCount > 0) {
      // ── Animation grid: capture N frames at evenly-spaced moments
      //    across `durationMs`, then compose them into a single
      //    contact-sheet PNG. Each cell is the FULL viewport-size
      //    frame with a small t= label burnt into the top-left.
      const frames: Buffer[] = [];
      const interval = frameCount > 1 ? durationMs / (frameCount - 1) : 0;
      for (let i = 0; i < frameCount; i++) {
        if (i > 0) await page.waitForTimeout(interval);
        frames.push(await page.screenshot({ type: 'png' }));
        process.stdout.write(`  captured frame ${i + 1}/${frameCount}\r`);
      }
      process.stdout.write('\n');

      // Compose: lay frames out in a grid as an HTML page, then
      // screenshot the page. fullPage:true captures the full document
      // height regardless of the browser viewport, so the grid renders
      // at full per-cell resolution.
      const cols = gridCols(frameCount);
      const rows = Math.ceil(frameCount / cols);
      const cellW = viewport.width;
      const cellH = viewport.height;
      const labels = frames.map((_, i) =>
        frameCount > 1 ? `t=${((i / (frameCount - 1)) * (durationMs / 1000)).toFixed(2)}s` : 't=0.00s'
      );
      const cells = frames.map((buf, i) =>
        `<div class="cell">
          <img src="data:image/png;base64,${buf.toString('base64')}">
          <div class="lbl">${labels[i]}</div>
        </div>`
      ).join('');
      const html = `<!doctype html><html><head><style>
        html, body { margin: 0; padding: 0; background: #000; }
        .grid {
          display: grid;
          grid-template-columns: repeat(${cols}, ${cellW}px);
          gap: 2px;
          width: ${cols * cellW + (cols - 1) * 2}px;
        }
        .cell { position: relative; width: ${cellW}px; height: ${cellH}px; }
        .cell img { width: ${cellW}px; height: ${cellH}px; display: block; }
        .lbl {
          position: absolute; top: 8px; left: 10px;
          padding: 3px 8px;
          background: rgba(0,0,0,0.7);
          color: #ddd;
          font-family: 'SF Mono', Menlo, monospace;
          font-size: 16px;
          letter-spacing: 0.04em;
          border: 1px solid rgba(255,255,255,0.1);
        }
      </style></head><body><div class="grid">${cells}</div></body></html>`;
      // Resize viewport so fullPage screenshot doesn't introduce
      // unexpected scaling — the grid renders 1:1 at its native size.
      await page.setViewportSize({
        width: cols * cellW + (cols - 1) * 2,
        height: rows * cellH + (rows - 1) * 2,
      });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150); // let images decode
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`Saved ${outPath} (${cols}×${rows} grid, ${frameCount} frames over ${durationSec}s)`);
    } else {
      await page.screenshot({ path: outPath });
      console.log(`Saved ${outPath}`);
    }
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
