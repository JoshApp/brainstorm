/**
 * Measure where the boot's seconds go — cold load, then a RELOAD in the same
 * browser context (warm HTTP + shader cache), which is exactly what Josh's
 * "NEW RUN" does: settings/abandonRun and quitToMenu both call location.reload().
 *
 *   npx tsx scripts/tmp/boot-timing.ts
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
];
const CHROMIUM_PATH = CHROMIUM_CANDIDATES.find((p) => existsSync(p))!;
const PORT = 5271;
const URL = `http://127.0.0.1:${PORT}/brainstorm/`;

const vite = spawn('node_modules/.bin/vite',
  ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = '';
vite.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
await new Promise<void>((r) => {
  const i = setInterval(() => { if (/Local:\s+http/.test(out)) { clearInterval(i); r(); } }, 100);
});

const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 500 } });
const page = await ctx.newPage();

// Watch the loading bar: when does it first become visible, and at what value?
await page.addInitScript(() => {
  const w = window as unknown as { __barTrace?: Array<{ t: number; v: number; on: boolean }> };
  w.__barTrace = [];
  // setInterval, not rAF: the init script runs BEFORE the document body exists,
  // so a self-rescheduling rAF that stops when #boot-loading is absent quits on
  // its very first tick and records nothing.
  let sawVeil = false;
  const id = setInterval(() => {
    const bar = document.querySelector('#boot-loading .boot-bar') as HTMLElement | null;
    const fill = document.querySelector('#boot-loading .boot-bar-fill') as HTMLElement | null;
    if (bar && fill) {
      sawVeil = true;
      const m = /scaleX\(([0-9.]+)\)/.exec(fill.style.transform);
      w.__barTrace!.push({ t: Math.round(performance.now()), v: m ? +m[1] : 0, on: bar.classList.contains('on') });
    } else if (sawVeil) {
      clearInterval(id);
    }
  }, 30);
});

async function run(label: string) {
  const t0 = Date.now();
  await page.waitForFunction(
    () => !document.getElementById('boot-loading'),
    undefined, { timeout: 180_000 },
  ).catch(() => console.log('  (veil never dropped within 180s)'));
  const wall = Date.now() - t0;
  const phases = await page.evaluate(() => {
    const w = window as unknown as { __bootTimeline?: () => Array<{ name: string; ms: number }> };
    return w.__bootTimeline?.() ?? [];
  });
  const trace = await page.evaluate(() => {
    const w = window as unknown as { __barTrace?: Array<{ t: number; v: number; on: boolean }> };
    return w.__barTrace ?? [];
  });
  console.log(`\n══ ${label} ══  (veil up for ${wall}ms wall)`);
  const total = phases.reduce((a, p) => a + p.ms, 0);
  for (const p of phases) {
    console.log(`   ${p.name.padEnd(14)} ${String(Math.round(p.ms)).padStart(6)}ms  ${((p.ms / total) * 100).toFixed(0)}%`);
  }
  console.log(`   ${'TOTAL'.padEnd(14)} ${String(Math.round(total)).padStart(6)}ms`);

  // THE PLAYER'S QUESTION: what does the bar look like?
  const visible = trace.filter((s) => s.on);
  console.log(`   bar: ${trace.length} samples, ${visible.length} with .on` +
    `, max value seen ${Math.max(0, ...trace.map((s) => s.v)).toFixed(2)}`);
  if (!visible.length) { console.log('   bar: never became visible'); return; }
  const first = visible[0];
  const firstT = first.t, lastT = visible[visible.length - 1].t;
  const atFull = visible.find((s) => s.v >= 0.999);
  console.log(`   bar: revealed at t=${firstT}ms showing ${(first.v * 100).toFixed(0)}%` +
    `  ·  reached 100% at t=${atFull ? atFull.t : 'never'}` +
    `  ·  last seen t=${lastT}ms`);
  if (atFull) console.log(`   bar: SAT AT 100% for ${lastT - atFull.t}ms before the veil dropped`);
  const beforeBar = phases.length ? firstT : 0;
  console.log(`   bar: ${beforeBar}ms of boot elapsed with NO bar at all`);
}

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await run('COLD (first ever load)');

await page.reload({ waitUntil: 'domcontentloaded' });
await run('WARM (reload = what NEW RUN does)');

await browser.close();
try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* ignore */ }
process.exit(0);
