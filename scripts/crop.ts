// Crop/zoom a region of a PNG (default: quadrants of a bench ortho sheet).
// Usage: tsx scripts/crop.ts <in.png> <out.png> <x> <y> <w> <h> [scale]
// Quadrant shortcut: tsx scripts/crop.ts <in.png> <out.png> q:tl|tr|bl|br [scale]
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
];
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));

const [inPath, outPath, ...rest] = process.argv.slice(2);
const data = readFileSync(inPath).toString('base64');

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
await page.setContent(`<img id="i" src="data:image/png;base64,${data}" style="position:absolute;top:0;left:0">`);
const dims = await page.evaluate(() => {
  const i = document.getElementById('i') as HTMLImageElement;
  return new Promise<{ w: number; h: number }>((res) => {
    if (i.complete) res({ w: i.naturalWidth, h: i.naturalHeight });
    else i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
  });
});

let x: number, y: number, w: number, h: number, scale: number;
if (rest[0]?.startsWith('q:')) {
  const q = rest[0].slice(2);
  w = dims.w / 2; h = dims.h / 2;
  x = q === 'tr' || q === 'br' ? w : 0;
  y = q === 'bl' || q === 'br' ? h : 0;
  scale = Number(rest[1] ?? 2);
} else {
  [x, y, w, h] = rest.slice(0, 4).map(Number);
  scale = Number(rest[4] ?? 2);
}

await page.evaluate(({ x, y, scale }) => {
  const i = document.getElementById('i') as HTMLImageElement;
  i.style.transformOrigin = '0 0';
  i.style.transform = `scale(${scale}) translate(${-x}px, ${-y}px)`;
}, { x, y, scale });
await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
await page.screenshot({ path: outPath });
await browser.close();
console.log(`Saved ${outPath} (${Math.round(w * scale)}x${Math.round(h * scale)} from ${x},${y} ${w}x${h})`);
