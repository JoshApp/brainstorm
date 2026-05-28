/**
 * Tight diagnostic for stair descent — proves whether the harness
 * interact action actually advances depth.
 */

import { chromium, type ConsoleMessage } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const CHROMIUM_PATH = CANDIDATES.find((p) => existsSync(p));

async function main(): Promise<void> {
  const port = 5180 + Math.floor(Math.random() * 100);
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn(
    'node_modules/.bin/vite',
    ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let viteOutput = '';
  vite.stdout?.on('data', (c: Buffer) => { viteOutput += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { viteOutput += c.toString(); });
  await new Promise<void>((resolve) => {
    const t = setInterval(() => {
      if (/Local:\s+http:\/\/.+:\d+/.test(viteOutput)) { clearInterval(t); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(t); resolve(); }, 20_000);
  });

  let exitCode = 0;
  let browser;
  try {
    browser = await chromium.launch({
      ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
    page.on('console', (m: ConsoleMessage) => {
      const t = m.type();
      if (t === 'error' || t === 'log' || t === 'warning') console.log(`  [${t}] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

    const url = `http://127.0.0.1:${port}/brainstorm/?harness=1&autostart=1&seed=42&depth=2&freeze=false`;
    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => Boolean((window as any).harness), { timeout: 10_000 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.evaluate(async () => { await (window as any).harness.ready; });

    // Walk to the stairs
    const beforeObs = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    console.log(`Initial: depth=${beforeObs.depth} pos=(${beforeObs.player.pos.x},${beforeObs.player.pos.z})`);
    const stairs = beforeObs.visible.interactables.find((i: { kind: string }) => i.kind === 'stairs');
    if (!stairs) { console.error('No stairs visible'); return; }
    console.log(`Stairs at (${stairs.pos.x},${stairs.pos.z}) dist=${stairs.distance.toFixed(1)} state=${stairs.state}`);

    // Step bot until stairs in range
    let turnsTaken = 0;
    for (let t = 0; t < 50; t++) {
      const stepObs = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).harness.observe(),
      );
      const s = stepObs.visible.interactables.find((i: { kind: string; inRange: boolean }) => i.kind === 'stairs' && i.inRange);
      if (s) { turnsTaken = t; break; }
      await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const h = (window as any).harness;
          await h.act(h.bot.step(h.observe()));
        },
      );
      turnsTaken = t + 1;
    }
    console.log(`Bot walked ${turnsTaken} turns to reach stairs`);

    const atStairs = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    console.log(`At stairs: depth=${atStairs.depth} floorId=${atStairs.floorId}`);
    const stairsHere = atStairs.visible.interactables.find((i: { kind: string }) => i.kind === 'stairs');
    console.log(`  stairs: dist=${stairsHere.distance} state=${stairsHere.state} inRange=${stairsHere.inRange}`);

    // Now: manually fire interact then observe immediately, then wait 1s and observe again
    console.log('\nFiring interact...');
    const interactResult = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (window as any).harness.act({ kind: 'interact' }),
    );
    console.log(`  result ok=${interactResult.ok} elapsed=${interactResult.elapsed} budgetEnd=${interactResult.budgetEnd}`);
    console.log(`  observation depth=${interactResult.observation.depth} floorId=${interactResult.observation.floorId}`);

    // Wait an extra second to see if the descent finishes late
    console.log('\nWaiting another 1.5s with explicit wait action...');
    const waitResult = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (window as any).harness.act({ kind: 'wait', seconds: 1.5 }),
    );
    console.log(`  result depth=${waitResult.observation.depth} floorId=${waitResult.observation.floorId}`);

    // Final state
    const finalObs = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    console.log(`\nFINAL: depth=${finalObs.depth} floorId=${finalObs.floorId}`);
    if (finalObs.depth === atStairs.depth) {
      console.error('\n✗ DESCENT FAILED — depth did not change');
    } else {
      console.log('\n✓ DESCENT SUCCEEDED');
    }
  } catch (err) {
    console.error('error:', err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (vite.pid) try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { vite.kill('SIGKILL'); } catch { /* ignore */ }
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
