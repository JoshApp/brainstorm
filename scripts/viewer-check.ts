// One-off: screenshot the asset viewer (launcher + a loaded subject) to verify
// ?viewer=1 wiring. Not part of the test suite — a manual smoke. Run:
//   npx tsx scripts/viewer-check.ts
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
].find((p) => existsSync(p))!;

const port = 5266;
const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = '';
vite.stdout?.on('data', (c: Buffer) => (out += c));
vite.stderr?.on('data', (c: Buffer) => (out += c));
await new Promise<void>((res, rej) => {
  const t = setInterval(() => { if (/Local:\s+http/.test(out)) { clearInterval(t); res(); } }, 100);
  setTimeout(() => { clearInterval(t); rej(new Error('vite timeout\n' + out)); }, 20000);
});

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const base = `http://127.0.0.1:${port}/brainstorm/`;
// 1. Launcher
await page.goto(`${base}?viewer=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('launcher rows:', await page.locator('#viewer-launcher a').count());
await page.screenshot({ path: '/tmp/viewer-launcher.png' });

// 2. A loaded mob subject (control bar + orbit)
await page.goto(`${base}?viewer=1&scenario=mob-wraith&inspect=true&inspectSubjectOnly=true`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('control bar present:', await page.locator('#viewer-bar').count() === 1);
console.log('bar buttons:', await page.locator('#viewer-bar button').count());
await page.screenshot({ path: '/tmp/viewer-mob.png' });

// 3. A loaded weapon subject (phase scrub) — scrub to the strike pose
await page.goto(`${base}?viewer=1&scenario=viewmodel-reapers-toll`, { waitUntil: 'networkidle' });
await page.waitForSelector('#viewer-bar button', { timeout: 8000 });
await page.waitForTimeout(500);
console.log('weapon bar buttons:', await page.locator('#viewer-bar button').allInnerTexts());
await page.locator('#viewer-bar button', { hasText: 'strike' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/viewer-weapon.png' });

await browser.close();
try { process.kill(-vite.pid!, 'SIGKILL'); } catch {}
console.log('done');
process.exit(0);
