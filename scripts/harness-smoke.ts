/**
 * Quick smoke test for the harness foundation + observation pipeline.
 *
 *   npm run harness-smoke
 *
 * Boots vite, opens ?harness=1&scenario=spawn, waits for window.harness,
 * checks state(), prints an observation, and exits 0 on success.
 *
 * This is the seed for scripts/play.ts (the full CLI driver). When that
 * lands, this file is the minimal sanity check kept around for
 * regressions.
 */

import { chromium, type ConsoleMessage } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

// Resolve a usable Chromium binary. Sandboxed envs may pre-install at
// /opt/pw-browsers; otherwise Playwright's own cache works.
const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
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

  const ready = await new Promise<boolean>((resolve) => {
    const t = setInterval(() => {
      if (/Local:\s+http:\/\/.+:\d+/.test(viteOutput)) {
        clearInterval(t);
        resolve(true);
      }
    }, 100);
    setTimeout(() => { clearInterval(t); resolve(false); }, 20_000);
  });
  if (!ready) {
    console.error('Vite did not start within 20s:\n' + viteOutput);
    killVite();
    process.exit(1);
  }

  let exitCode = 0;
  let browser;
  try {
    browser = await chromium.launch({
      ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 } });
    const page = await ctx.newPage();
    page.on('console', (m: ConsoleMessage) => {
      console.log(`  [browser ${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => { console.log(`  [browser pageerror] ${e.message}`); });

    // freeze=false overrides the scenario's debug-freeze so the harness's
    // own pause source is the ONLY one active — proves the harness pause
    // works in isolation.
    const url = `http://127.0.0.1:${port}/brainstorm/?harness=1&scenario=spawn&freeze=false`;
    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for window.harness to exist (dynamic import has to resolve).
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => Boolean((window as any).harness),
      { timeout: 10_000 },
    );

    // Wait for ready (level loaded → harness can observe).
    await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => { await (window as any).harness.ready; },
    );

    // 1. State check — harness booted, paused, turn=0
    const state = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.state(),
    );
    console.log('state:', state);
    if (!state.booted) throw new Error('state.booted=false after ready');
    if (!state.paused) throw new Error('state.paused=false in turn-based mode');

    // 2. Observation — JSON shape + text shape
    const obs = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    console.log('\nobservation.player:', JSON.stringify(obs.player, null, 2));
    console.log('observation.geometry.walls8:', JSON.stringify(obs.geometry.walls8));
    console.log('observation.visible.enemies:', obs.visible.enemies.length, 'visible');
    console.log('observation.light:', JSON.stringify(obs.light));

    if (obs.player.hp.max <= 0) throw new Error('player.hp.max not populated');
    if (obs.pausedReason !== 'harness') {
      throw new Error(`expected pausedReason=harness, got ${obs.pausedReason}`);
    }

    const txt = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observeText(),
    );
    console.log('\n--- observeText() ---');
    console.log(txt);
    console.log('---');

    // 3. Action loop — move, turn, attack. Verify state changes.
    const beforePos = { x: obs.player.pos.x, z: obs.player.pos.z };
    const beforeYaw = obs.player.facingYaw;

    console.log('\n→ act move S 0.4s');
    const moveResult = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (window as any).harness.act({ kind: 'move', dir: 'S', seconds: 0.4 }),
    );
    console.log(`  ok=${moveResult.ok} elapsed=${moveResult.elapsed.toFixed(3)}s budget=${moveResult.budgetEnd}`);
    const after1 = moveResult.observation;
    console.log(`  player pos: (${after1.player.pos.x}, ${after1.player.pos.z})`);
    const dx = after1.player.pos.x - beforePos.x;
    const dz = after1.player.pos.z - beforePos.z;
    if (Math.hypot(dx, dz) < 0.1) {
      throw new Error(`move S barely advanced player: dx=${dx} dz=${dz}`);
    }

    console.log('\n→ act turn +π/2');
    const turnResult = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (window as any).harness.act({ kind: 'turn', angle: Math.PI / 2 }),
    );
    const after2 = turnResult.observation;
    console.log(`  yaw before=${beforeYaw.toFixed(3)} after=${after2.player.facingYaw.toFixed(3)}`);
    const yawDelta = Math.abs(after2.player.facingYaw - beforeYaw);
    if (yawDelta < 0.1) throw new Error('turn did not change yaw');

    console.log('\n→ act attack (waits for swing to complete)');
    const atkResult = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (window as any).harness.act({ kind: 'attack' }),
    );
    console.log(`  ok=${atkResult.ok} elapsed=${atkResult.elapsed.toFixed(3)}s budget=${atkResult.budgetEnd}`);
    if (!atkResult.ok) throw new Error(`attack failed: ${atkResult.reason}`);
    if (atkResult.elapsed < 0.2) {
      throw new Error(`attack returned too fast (${atkResult.elapsed}s); should wait for swing`);
    }

    // After action sequence, world should be paused again.
    const finalState = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.state(),
    );
    console.log('\nfinal state:', finalState);
    if (!finalState.paused) throw new Error('world not re-paused after action sequence');
    if (finalState.turn < 3) throw new Error(`turn counter didn't advance (turn=${finalState.turn})`);

    console.log('\n✓ Smoke test passed.');
  } catch (err) {
    console.error('✗ Smoke test failed:', err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killVite();
  }
  process.exit(exitCode);

  function killVite() {
    if (vite.pid) {
      try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
    try { vite.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
