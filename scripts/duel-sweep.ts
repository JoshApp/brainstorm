/**
 * Player duel sweep — the player-side counterpart to `npm run threat`.
 * Measures how the FIGHTING bot fares 1v1 vs each enemy, headless.
 *
 *   npm run duel                          (default enemy set, seeds 1-5)
 *   npm run duel -- rat,skeleton,ghoul
 *   npm run duel -- --seeds=10
 *
 * For each enemy × seed it loads ?scenario=threat&enemy=<id>&seed=<n>&simfreeze=1
 * and runs window.__sim.duel(): the aggressive pilot fights to a win (room
 * cleared) or a loss (player dies). Aggregated into win-rate, median clear time
 * (player TTK), and median HP cost — the offense half of combat balance, which
 * needs a competent bot (it now wins by trading rather than dodge-dancing).
 *
 * Pair with `npm run threat` (enemy offense) for the full picture per enemy.
 * DEV-only path (?simfreeze + window.__sim are DEV-gated).
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

const DEFAULT_ENEMIES = ['rat', 'skeleton', 'ghoul', 'skirmisher', 'acolyte', 'wraith', 'stoneguard'];

interface DuelResult { won: boolean; died: boolean; clearSec: number | null; hpLost: number; maxHp: number; }

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const enemies = positional[0] ? positional[0].split(',') : DEFAULT_ENEMIES;
  const seedCount = Number(process.argv.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? '5');
  const frames = Number(process.argv.find((a) => a.startsWith('--frames='))?.split('=')[1] ?? '2700');
  const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
  const port = 5180 + Math.floor(Math.random() * 100);

  if (!existsSync(CHROMIUM_PATH)) { console.error(`Chromium not found at ${CHROMIUM_PATH}`); process.exit(1); }

  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  vite.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { out += c.toString(); });
  const ready = await new Promise<boolean>((resolve) => {
    const iv = setInterval(() => { if (/Local:\s+http:\/\/.+:\d+/.test(out)) { clearInterval(iv); resolve(true); } }, 100);
    setTimeout(() => { clearInterval(iv); resolve(false); }, 20_000);
  });
  if (!ready) { console.error('Vite did not start.\n' + out); vite.kill(); process.exit(1); }

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage();

  const rows: Array<{ enemy: string; winRate: number; clearSec: number | null; hpLost: number | null; runs: number }> = [];
  console.log(`\nDuel sweep — ${enemies.length} enemies × ${seeds.length} seeds (aggressive pilot, 1v1)\n`);

  for (const enemy of enemies) {
    let wins = 0, runs = 0;
    const clearTimes: number[] = [];
    const hpLosts: number[] = [];
    for (const seed of seeds) {
      const url = `http://127.0.0.1:${port}/brainstorm/?scenario=threat&enemy=${enemy}&seed=${seed}&simfreeze=1`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      try { await page.waitForFunction(() => !!(window as any).__sim, { timeout: 15_000 }); }
      catch { console.log(`  ${enemy} seed ${seed}: __sim never appeared (skipped)`); continue; }
      const r = (await page.evaluate((f) => (window as any).__sim.duel(f), frames)) as DuelResult;
      runs++;
      if (r.won) { wins++; if (r.clearSec != null) clearTimes.push(r.clearSec); }
      hpLosts.push(r.hpLost);
    }
    if (runs) {
      rows.push({
        enemy,
        winRate: Math.round((wins / runs) * 100),
        clearSec: median(clearTimes),
        hpLost: median(hpLosts),
        runs,
      });
      process.stdout.write('.');
    }
  }
  console.log('\n');

  rows.sort((a, b) => b.winRate - a.winRate || (a.clearSec ?? 99) - (b.clearSec ?? 99));
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);
  console.log(pad('ENEMY', 12) + padL('WIN-RATE', 10) + padL('CLEAR(s)', 11) + padL('HP-LOST', 10) + padL('RUNS', 7));
  console.log('-'.repeat(50));
  for (const r of rows) {
    console.log(
      pad(r.enemy, 12) +
      padL(`${r.winRate}%`, 10) +
      padL(r.clearSec != null ? r.clearSec.toFixed(1) : '—', 11) +
      padL(r.hpLost != null ? r.hpLost.toFixed(1) : '—', 10) +
      padL(String(r.runs), 7),
    );
  }
  console.log('\nLow win-rate or high HP-lost = a genuine threat to the aggressive baseline.\n');

  await browser.close();
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
