// Throwaway: screenshot/diagnose the dev art viewer headless.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const CANDS = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const exe = CANDS.find((p) => existsSync(p));
const url = process.argv[2] ?? 'http://localhost:5175/brainstorm/art.html';
const out = process.argv[3] ?? '/tmp/art-viewer.png';
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1180, height: 1400 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('EXC:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text()); });
p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('NAV:', f.url()); });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
await p.waitForTimeout(2500);
const dims = await p.evaluate(() => ({ h: document.body.scrollHeight, body: document.querySelectorAll('[data-art-body]').length, imgs: document.images.length, canvas: document.querySelectorAll('canvas').length })).catch((e) => 'eval failed: ' + e.message);
console.log('dims', JSON.stringify(dims));
await p.screenshot({ path: out, fullPage: false, timeout: 20000 }).then(() => console.log('shot →', out)).catch((e) => console.log('shot failed:', e.message));
await b.close();
