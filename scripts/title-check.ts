// One-off: does the title screen scroll on a short landscape phone? Measures
// the start-screen's scrollHeight vs its clientHeight (with fakemeta so every
// secondary link shows — the busiest case). Manual smoke.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
].find((p) => existsSync(p))!;

const port = 5288;
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
const base = `http://127.0.0.1:${port}/brainstorm/`;

for (const vp of [{ name: 'landscape', width: 844, height: 390 }, { name: 'tiny-landscape', width: 740, height: 360 }, { name: 'portrait', width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(`${base}?fakemeta=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start-screen', { timeout: 25000 });
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const el = document.getElementById('start-screen')!;
    return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollable: el.scrollHeight > el.clientHeight + 1 };
  });
  console.log(`${vp.name} (${vp.width}x${vp.height}): scrollH=${m.scrollH} clientH=${m.clientH} → ${m.scrollable ? 'SCROLLS ✗' : 'fits ✓'}`);
  await page.screenshot({ path: `/tmp/title-${vp.name}.png` });
  await ctx.close();
}

await browser.close();
try { process.kill(-vite.pid!, 'SIGKILL'); } catch {}
process.exit(0);
