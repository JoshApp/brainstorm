/**
 * LUX SCAN — headless perceived-light measurement across rooms.
 *
 * Boots the game (vite + chromium, same rig as snap.ts), loads a
 * scenario or a seeded procgen run, then drives window.__lux.tour():
 * the camera teleports to every room, faces four directions, and the
 * meter reads the RENDERED frame each time. Prints a per-room table
 * with verdicts against the tier bands (debug/lux.ts LUX_BANDS).
 *
 * Usage:
 *   npx tsx scripts/lux-scan.ts                          # depth-1 procgen, seed 7
 *   npx tsx scripts/lux-scan.ts --seed=12                # other seed
 *   npx tsx scripts/lux-scan.ts --scenario=tint-lab      # a scenario
 *
 * This is the tuning loop: change a light constant, re-run, watch the
 * means move against the bands — no eyeballs needed until the end.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chromium } from 'playwright';

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
];

async function main(): Promise<void> {
  const scenario = process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1];
  const seed = process.argv.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? '7';

  // Boot vite.
  const vite = spawn('npx', ['vite', '--port', '5197', '--strictPort'], { stdio: 'pipe', detached: true });
  let viteOut = '';
  vite.stdout.on('data', (d) => { viteOut += String(d); });
  vite.stderr.on('data', (d) => { viteOut += String(d); });
  const deadline = Date.now() + 30000;
  while (!viteOut.includes('Local:') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!viteOut.includes('Local:')) {
    console.error('vite did not start:\n' + viteOut);
    vite.kill(); process.exit(1);
  }

  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`));

  const depth = process.argv.find((a) => a.startsWith('--depth='))?.split('=')[1] ?? '1';
  const url = scenario
    ? `http://localhost:5197/?scenario=${scenario}&lux=1`
    : `http://localhost:5197/?autostart=descend&seed=${seed}&depth=${depth}&dev=1&lux=1`;
  console.log(`loading ${url}`);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__lux !== undefined, { timeout: 30000 });
  // Let the level finish building + first frames settle.
  await page.waitForTimeout(4000);

  const stops = await page.evaluate(() => (window as any).__lux.tour());
  await browser.close();
  // npx wraps vite — kill the whole process group or the port stays held.
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }

  // Aggregate per room (mean over the 4 facings).
  const byRoom = new Map<string, { tier: string; means: number[]; voids: number[]; verdicts: string[] }>();
  for (const s of stops) {
    const e = byRoom.get(s.roomId) ?? { tier: s.tier, means: [], voids: [], verdicts: [] };
    e.means.push(s.report.screen.mean);
    e.voids.push(s.report.screen.voidPct);
    e.verdicts.push(s.report.verdict);
    byRoom.set(s.roomId, e);
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  console.log('\nroom                          tier   mean   min    max    void%  verdict(worst)');
  for (const [id, e] of byRoom) {
    const mean = r3(e.means.reduce((t, v) => t + v, 0) / e.means.length);
    const lo = r3(Math.min(...e.means));
    const hi = r3(Math.max(...e.means));
    const voidPct = Math.round(e.voids.reduce((t, v) => t + v, 0) / e.voids.length);
    const worst = e.verdicts.find((v) => v.startsWith('TOO')) ?? e.verdicts[0];
    console.log(
      `${id.padEnd(30)}${e.tier.padEnd(7)}${String(mean).padEnd(7)}${String(lo).padEnd(7)}${String(hi).padEnd(7)}${String(voidPct).padEnd(7)}${worst}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
