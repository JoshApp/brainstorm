/**
 * reach.ts — FAITHFUL reachability check via the live harness.
 *
 *   npm run reach -- --seed N --depth M
 *
 * Boots the floor headless (real Chromium), BFS's the REAL WalkableRegion from
 * spawn with the player's collision radius, and reports which stairs a
 * reachable spot can actually reach. Unlike the fast rect-level CI guards,
 * this sees archway columns, stairwell footprints, ruined columns — every
 * obstacle — so it catches collision-narrowed soft-locks the abstract checks
 * can't. Exits non-zero if any stair is unreachable.
 *
 * Slower than the rect guards (boots a browser per floor), so it's the
 * spot-check for a reported seed, not a 300-floor sweep.
 */
import { chromium, type ConsoleMessage } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const seed = Number(get('--seed') ?? Math.floor(Math.random() * 1e9));
const depth = Number(get('--depth') ?? 1);
const port = Number(get('--port') ?? 5180 + Math.floor(Math.random() * 300));

type Report = {
  ok: boolean; reachableCells: number; strictCells: number; openableBarriers: Array<{ x: number; z: number }>;
  unreachedRooms: string[];
  stairs: Array<{ x: number; z: number; reachable: boolean; minDist: number; blockedBy?: string }>;
};

async function main() {
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  vite.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { out += c.toString(); });
  const killVite = () => { try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* ignore */ } };
  const ready = await new Promise<boolean>((res) => {
    const t = setInterval(() => { if (/Local:\s+http:\/\/.+:\d+/.test(out)) { clearInterval(t); res(true); } }, 100);
    setTimeout(() => { clearInterval(t); res(false); }, 20_000);
  });
  if (!ready) { console.error('vite failed:\n' + out); killVite(); process.exit(1); }

  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  let bad = false;
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 400 } })).newPage();
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') console.log(`  [browser error] ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`  [browser pageerror] ${e.message}`));
    const url = `http://127.0.0.1:${port}/brainstorm/?harness=1&autostart=1&seed=${seed}&depth=${depth}&freeze=false`;
    console.log(`reach — seed ${seed} depth ${depth}\n${url}\n`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as { harness?: unknown }).harness), { timeout: 10_000 });
    const okReady = await page.evaluate(async () => Promise.race([
      (window as { harness: { ready: Promise<void> } }).harness.ready.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
    ]));
    if (!okReady) { console.error('harness never became ready'); bad = true; return; }

    const rep = await page.evaluate(() => (window as { harness: { reachability(): Report } }).harness.reachability()) as Report;
    // Two numbers, because they answer different questions. The first is
    // LAYOUT — can the player get there at all, opening what they'd open. The
    // second is what you can walk to right now with every door shut. Reporting
    // only the second is what made this tool call 5 of 7 floors soft-locked.
    console.log(`reachable cells from spawn: ${rep.reachableCells}  (layout — doors and gates assumed openable)`);
    console.log(`  with every barrier shut: ${rep.strictCells}  ·  ${rep.openableBarriers.length} openable barrier(s)`
      + (rep.openableBarriers.length ? ': ' + rep.openableBarriers.map((b) => `(${b.x}, ${b.z})`).join(' ') : ''));
    if (rep.unreachedRooms.length) console.log(`  rooms never entered: ${rep.unreachedRooms.join(', ')}`);
    if (rep.stairs.length === 0) console.log('  (no stairs on this floor)');
    for (const s of rep.stairs) {
      console.log(`  stair @(${s.x}, ${s.z}): ${s.reachable ? 'REACHABLE ✓' : 'UNREACHABLE ✗'}  (closest reachable spot: ${s.minDist}m, need <=1.6m)`
        + (s.blockedBy ? `  — ${s.blockedBy}` : ''));
      if (!s.reachable) bad = true;
    }
    console.log(bad ? '\n✗ SOFT-LOCK: a stair is unreachable.' : '\n✓ all stairs reachable.');
  } finally {
    await browser.close();
    killVite();
  }
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
