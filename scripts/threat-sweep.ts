/**
 * Enemy threat sweep — measures REALIZED enemy offense by simulation, headless.
 *
 *   npm run threat                       (default enemy set, seeds 1-3)
 *   npm run threat -- rat,skeleton,ghoul (custom enemies)
 *   npm run threat -- --seeds=5 --frames=3600
 *
 * For each enemy × seed it loads ?scenario=threat&enemy=<id>&seed=<n>&simfreeze=1
 * and runs window.__sim.threatProbe(): a PASSIVE punching-bag player stands in
 * the enemy's face and never fights back, so we measure how fast that enemy
 * kills an undefended player (time-to-kill, DPS) — including its AI behaviour
 * (approach time, kiting, whiffs), which a static spec can't capture.
 *
 * It prints, per enemy: theoretical DPS (from the spec — always-attacking upper
 * bound) vs REALIZED DPS (the sim), and the realized/theoretical ratio. A low
 * ratio means an enemy looks scary on paper but its behaviour wastes most of
 * that threat — a balance signal only simulation surfaces.
 *
 * DEV-only path (?simfreeze + window.__sim are DEV-gated).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { ENEMIES } from '../src/content/enemies';
import { scaleEnemySpec } from '../src/content/modifiers';

// Must match buildThreatScenario's level.depth so theoretical damage uses the
// same depth-scaling the sim applies.
const THREAT_DEPTH = 3;

const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const CHROMIUM_PATH = CHROMIUM_CANDIDATES.find((p) => existsSync(p)) ?? CHROMIUM_CANDIDATES[0];

const DEFAULT_ENEMIES = ['rat', 'skeleton', 'ghoul', 'skirmisher', 'acolyte', 'wraith', 'stoneguard'];

interface ProbeResult { died: boolean; ttkSec: number | null; dps: number; maxHp: number; }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Theoretical DPS from the spec: full damage every attack cycle (the
 *  always-in-range, never-whiffs upper bound). */
function theoreticalDps(id: string): number | null {
  const base = ENEMIES[id];
  if (!base) return null;
  const e = scaleEnemySpec(base, THREAT_DEPTH); // depth-scale like the sim does
  const cycle = (e.windupTime ?? 0) + (e.strikeTime ?? 0) + (e.recoverTime ?? 0);
  if (cycle <= 0 || !e.attackDamage) return null;
  return e.attackDamage / cycle;
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const enemies = positional[0] ? positional[0].split(',') : DEFAULT_ENEMIES;
  const seedCount = Number(process.argv.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? '3');
  const frames = Number(process.argv.find((a) => a.startsWith('--frames='))?.split('=')[1] ?? '3600');
  const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
  const port = 5180 + Math.floor(Math.random() * 100);

  if (!existsSync(CHROMIUM_PATH)) {
    console.error(`Chromium not found at ${CHROMIUM_PATH}`);
    process.exit(1);
  }

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

  const rows: Array<{ enemy: string; realizedDps: number; ttkSec: number | null; deaths: number; runs: number }> = [];
  console.log(`\nThreat sweep — ${enemies.length} enemies × ${seeds.length} seeds, ${(frames / 60).toFixed(0)}s window\n`);

  for (const enemy of enemies) {
    const dpsRuns: number[] = [];
    const ttkRuns: number[] = [];
    let deaths = 0;
    for (const seed of seeds) {
      const url = `http://127.0.0.1:${port}/brainstorm/?scenario=threat&enemy=${enemy}&seed=${seed}&simfreeze=1`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForFunction(() => !!(window as any).__sim, { timeout: 15_000 });
      } catch {
        console.log(`  ${enemy} seed ${seed}: __sim never appeared (skipped)`);
        continue;
      }
      const r = (await page.evaluate((f) => (window as any).__sim.threatProbe(f), frames)) as ProbeResult;
      dpsRuns.push(r.dps);
      if (r.died && r.ttkSec != null) { ttkRuns.push(r.ttkSec); deaths++; }
    }
    if (dpsRuns.length) {
      rows.push({
        enemy,
        realizedDps: Math.round(median(dpsRuns) * 100) / 100,
        ttkSec: ttkRuns.length ? Math.round(median(ttkRuns) * 10) / 10 : null,
        deaths,
        runs: seeds.length,
      });
      process.stdout.write('.');
    }
  }
  console.log('\n');

  // Sort by realized threat, descending.
  rows.sort((a, b) => b.realizedDps - a.realizedDps);
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);
  console.log(pad('ENEMY', 12) + padL('THEORY-DPS', 12) + padL('REAL-DPS', 11) + padL('TTK(s)', 9) + padL('REAL/THEORY', 13) + padL('KILLED', 9));
  console.log('-'.repeat(66));
  for (const r of rows) {
    const th = theoreticalDps(r.enemy);
    const ratio = th && th > 0 ? `${Math.round((r.realizedDps / th) * 100)}%` : '—';
    console.log(
      pad(r.enemy, 12) +
      padL(th ? th.toFixed(2) : '—', 12) +
      padL(r.realizedDps.toFixed(2), 11) +
      padL(r.ttkSec != null ? r.ttkSec.toFixed(1) : 'survived', 9) +
      padL(ratio, 13) +
      padL(`${r.deaths}/${r.runs}`, 9),
    );
  }
  console.log('\nREAL/THEORY < ~50% → the enemy wastes most of its paper threat (slow approach / kiting / whiffs).\n');

  await browser.close();
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
