/**
 * Continue Run round-trip test.
 *
 *   npm run harness-continue
 *
 * Verifies that Save/Quit/Continue restores a run exactly:
 *   1. Boot a fresh run with ?harness=1&autostart=1&seed=42&depth=2
 *      — deterministic floor 2 of seed 42.
 *   2. Capture the observation (floor id, depth, room, enemies, walls).
 *   3. Navigate away and back with ?harness=1&autostart=continue.
 *   4. Capture observation #2.
 *   5. Assert the two match field-by-field. If they don't, Continue is broken.
 *
 * Tests the Continue Run reliability + seeded jump infrastructure from
 * companion task 6.
 */

import { chromium, type ConsoleMessage } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const CHROMIUM_PATH = CANDIDATES.find((p) => existsSync(p));

const SEED = 42;
const DEPTH = 2;

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
      if (/Local:\s+http:\/\/.+:\d+/.test(viteOutput)) { clearInterval(t); resolve(true); }
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
    // ONE context so localStorage persists across the two boots.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 } });
    const page = await ctx.newPage();
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        console.log(`  [browser ${m.type()}] ${m.text()}`);
      }
    });
    page.on('pageerror', (e) => console.log(`  [browser pageerror] ${e.message}`));

    // ── Boot 1: fresh seeded jump ────────────────────────────────────
    const url1 = `http://127.0.0.1:${port}/brainstorm/?harness=1&autostart=1&seed=${SEED}&depth=${DEPTH}&freeze=false`;
    console.log(`Boot 1: ${url1}`);
    await page.goto(url1, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => Boolean((window as any).harness),
      { timeout: 10_000 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.evaluate(async () => { await (window as any).harness.ready; });
    // Give a frame or two for level:loaded to fire + save to persist.
    await page.waitForTimeout(500);

    const obs1 = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    const save1 = await page.evaluate(() => localStorage.getItem('delve:save'));
    console.log('  observation: depth=%d floorId=%s room=%s', obs1.depth, obs1.floorId, obs1.roomId);
    console.log('  enemies: %d  walls8.N=%s', obs1.visible.enemies.length, obs1.geometry.walls8.N);
    console.log('  save: %s', save1 ? `(${save1.length} bytes)` : 'MISSING');

    if (!save1) throw new Error('No save written after seeded jump');
    const parsed1 = JSON.parse(save1!);
    if (parsed1.floorId !== `depth-${DEPTH}`) throw new Error(`save.floorId=${parsed1.floorId}, want depth-${DEPTH}`);
    if (parsed1.depth !== DEPTH) throw new Error(`save.depth=${parsed1.depth}, want ${DEPTH}`);
    if (parsed1.startedAt !== SEED) throw new Error(`save.startedAt=${parsed1.startedAt}, want ${SEED} (seed)`);

    // ── Boot 2: CONTINUE the saved run ──────────────────────────────
    const url2 = `http://127.0.0.1:${port}/brainstorm/?harness=1&autostart=continue&freeze=false`;
    console.log(`\nBoot 2: ${url2}`);
    await page.goto(url2, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => Boolean((window as any).harness),
      { timeout: 10_000 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.evaluate(async () => { await (window as any).harness.ready; });
    await page.waitForTimeout(500);

    const obs2 = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    console.log('  observation: depth=%d floorId=%s room=%s', obs2.depth, obs2.floorId, obs2.roomId);
    console.log('  enemies: %d  walls8.N=%s', obs2.visible.enemies.length, obs2.geometry.walls8.N);

    // ── Compare ─────────────────────────────────────────────────────
    const diffs: string[] = [];
    if (obs1.floorId !== obs2.floorId) diffs.push(`floorId: ${obs1.floorId} → ${obs2.floorId}`);
    if (obs1.depth !== obs2.depth) diffs.push(`depth: ${obs1.depth} → ${obs2.depth}`);
    if (obs1.roomId !== obs2.roomId) diffs.push(`roomId: ${obs1.roomId} → ${obs2.roomId}`);
    if (obs1.visible.enemies.length !== obs2.visible.enemies.length) {
      diffs.push(`enemy count: ${obs1.visible.enemies.length} → ${obs2.visible.enemies.length}`);
    }
    // Walls8 — compare each cardinal (floats so small slop OK)
    for (const d of ['N','NE','E','SE','S','SW','W','NW'] as const) {
      const a = obs1.geometry.walls8[d];
      const b = obs2.geometry.walls8[d];
      if (Math.abs((a ?? 999) - (b ?? 999)) > 0.5) {
        diffs.push(`walls8.${d}: ${a} → ${b}`);
      }
    }
    // Enemy positions (sorted by distance already in observation.ts)
    for (let i = 0; i < Math.min(obs1.visible.enemies.length, obs2.visible.enemies.length); i++) {
      const e1 = obs1.visible.enemies[i];
      const e2 = obs2.visible.enemies[i];
      if (e1.kind !== e2.kind) diffs.push(`enemies[${i}].kind: ${e1.kind} → ${e2.kind}`);
      if (Math.hypot(e1.pos.x - e2.pos.x, e1.pos.z - e2.pos.z) > 0.5) {
        diffs.push(`enemies[${i}].pos: (${e1.pos.x},${e1.pos.z}) → (${e2.pos.x},${e2.pos.z})`);
      }
    }

    if (diffs.length > 0) {
      console.error('\n✗ CONTINUE RUN DIVERGED — bug found:');
      for (const d of diffs) console.error('  ' + d);
      throw new Error('Continue Run does not restore the original floor');
    }
    console.log('\n✓ Continue Run round-trip matches.');
    console.log(`  Saved startedAt = ${parsed1.startedAt} (= seed ${SEED})`);
    console.log(`  Floor layout, enemies, walls all match between boot 1 and boot 2.`);
  } catch (err) {
    console.error('✗ Continue Run test failed:', err);
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
