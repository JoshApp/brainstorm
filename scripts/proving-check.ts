// One-off smoke for Proving Grounds: title → PROVING → pick a fight → Descend,
// and confirm we land in a playable arena. Manual check, not in the suite.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
].find((p) => existsSync(p))!;

const port = 5277;
const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = '';
vite.stdout?.on('data', (c: Buffer) => (out += c));
vite.stderr?.on('data', (c: Buffer) => (out += c));
await new Promise<void>((res, rej) => {
  const t = setInterval(() => { if (/Local:\s+http/.test(out)) { clearInterval(t); res(); } }, 100);
  setTimeout(() => { clearInterval(t); rej(new Error('vite timeout')); }, 20000);
});

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const base = `http://127.0.0.1:${port}/brainstorm/`;
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Title → PROVING
await page.click('text=PROVING');
await page.waitForSelector('#proving-grounds', { timeout: 5000 });
console.log('proving screen open');

// Fight is the default mode. Pick a boss, then hit Descend (footer button lives
// on document.body, outside #proving-grounds) — drive both in one evaluate.
const picked = await page.evaluate(() => {
  const root = document.getElementById('proving-grounds')!;
  const btns = [...root.querySelectorAll('button')] as HTMLButtonElement[];
  const descentTab = btns.findIndex((b) => b.textContent === 'Descent');
  const firstFight = btns[descentTab + 1];
  firstFight?.click();
  const descend = [...document.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').startsWith('Descend')) as HTMLButtonElement | undefined;
  descend?.click();
  return firstFight?.textContent ?? '(none)';
});
console.log('picked fight target:', picked);

await page.waitForTimeout(3500);
console.log('proving screen still open?', await page.locator('#proving-grounds').count() > 0);
await page.screenshot({ path: '/tmp/proving-fight.png' });
console.log('saved /tmp/proving-fight.png');

await browser.close();
try { process.kill(-vite.pid!, 'SIGKILL'); } catch {}
process.exit(0);
