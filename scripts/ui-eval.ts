// UI matrix — render a ui-bench specimen across the real device sizes at once,
// with an automatic FIT/OVERFLOW report, so menu fit can be judged on mobile AND
// desktop in one shot (no per-size round-trips).
//
//   npx tsx scripts/ui-eval.ts <specimen> [out.png] [--port N]
//   delve ui <specimen>
//
// The game is landscape-locked, so the phones are landscape; desktop sizes are a
// real secondary target, not debug. The tool hides the bench toolbar so the menu
// gets the FULL viewport (as in the real game), screenshots each size, and
// measures whether anything spills past the viewport edges.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
].find((p) => existsSync(p));

const args = process.argv.slice(2);
const specimen = args.find((a) => !a.startsWith('--') && !a.endsWith('.png')) ?? 'grimoire';
const out = args.find((a) => a.endsWith('.png')) ?? `/tmp/ui-${specimen}.png`;
const portI = args.indexOf('--port');
const PORT = portI >= 0 ? args[portI + 1] : '5191';
const url = `http://localhost:${PORT}/brainstorm/ui-bench.html?ui=${specimen}`;

// landscape phones (real play orientation) + desktop (secondary market)
const DEVICES = [
  { name: 'iPhone SE', w: 667, h: 375 },
  { name: 'iPhone 14', w: 844, h: 390 },
  { name: 'Pro Max', w: 932, h: 430 },
  { name: 'iPad', w: 1024, h: 768 },
  { name: 'Laptop', w: 1280, h: 720 },
  { name: 'Desktop', w: 1680, h: 900 },
];

const browser = await chromium.launch({ executablePath: CHROME });
const shots: Array<{ name: string; w: number; h: number; b64: string; fits: boolean; note: string }> = [];

for (const d of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2200);
  const fit = await p.evaluate(() => {
    // hide the bench toolbar (the very-high-zIndex fixed bar) and give any
    // host the full viewport, so the menu is measured as it'd run in the game.
    const fixed = Array.from(document.body.children).filter((e) => getComputedStyle(e).position === 'fixed') as HTMLElement[];
    const bar = fixed.slice().sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0))[0];
    if (bar) bar.style.display = 'none';
    // Only the bench content HOST (it sits below the toolbar at top:46px) needs the
    // full viewport so a specimen mounted into it measures full-screen. createSheet
    // overlays are already full-screen + self-centred — forcing inset:0 on them
    // would break their centring (and report bogus overflow), so leave them.
    for (const f of fixed) { if (f !== bar && (f.style.inset || '').startsWith('46')) f.style.inset = '0'; }
    void document.body.offsetHeight;
    // worst element spilling past the viewport edges (the real "doesn't fit")
    let worst = '', amt = 0, edge = '';
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el === bar || (bar && bar.contains(el))) continue;
      const s = getComputedStyle(el);
      // skip decorative bleed (watermarks, backgrounds): invisible, faint, or
      // non-interactive — only FUNCTIONAL content that spills counts as a misfit.
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.25 || s.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      const over = [r.bottom - innerHeight, r.right - innerWidth, -r.top, -r.left];
      const m = Math.max(...over); if (m > amt) { amt = m; edge = ['bottom', 'right', 'top', 'left'][over.indexOf(m)]; worst = el.tagName.toLowerCase() + ' “' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22) + '”'; }
    }
    return { amt: Math.round(amt), edge, worst };
  });
  await p.waitForTimeout(120);
  const b64 = (await p.screenshot()).toString('base64');
  const fits = fit.amt <= 2;
  shots.push({ name: d.name, w: d.w, h: d.h, b64, fits, note: fits ? 'fits' : `+${fit.amt}px past ${fit.edge} — ${fit.worst}` });
  await ctx.close();
}

// contact sheet
const sctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const sp = await sctx.newPage();
const cells = shots.map((s) => {
  const col = s.fits ? '#7fae74' : '#d06a5a';
  const w = Math.min(s.w, 430);
  return `<div style="margin:9px"><div style="font:12px/1.4 system-ui;color:${col};margin-bottom:4px">${s.name} · ${s.w}×${s.h} · ${s.fits ? 'fits' : 'OVERFLOW'}</div><img src="data:image/png;base64,${s.b64}" style="width:${w}px;border:2px solid ${col};display:block;border-radius:2px"></div>`;
}).join('');
await sp.setContent(`<body style="margin:0;background:#16110b;display:flex;flex-wrap:wrap;align-items:flex-start;padding:6px">${cells}</body>`);
await sp.waitForTimeout(350);
const dim = await sp.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
await sp.setViewportSize({ width: Math.min(1600, dim.w + 12), height: Math.min(5000, dim.h + 12) });
await sp.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`\nUI matrix · ${specimen}`);
for (const s of shots) console.log(`  ${s.fits ? '✓' : '✗'} ${s.name.padEnd(11)} ${`${s.w}×${s.h}`.padEnd(9)}  ${s.note}`);
console.log(`\ncontact sheet → ${out}`);
