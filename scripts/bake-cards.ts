// Bake the chosen deck into SHIPPED game assets.
//
// The promoted card art + the chosen back live in public/art/ (gitignored
// exploration, full-res ~1.5MB each). This downscales them to small webp and
// writes them to public/cards/<id>.webp (committed, shipped) so the in-game
// card reading can show the real art. No sharp/jimp in the repo, so we
// downscale through a headless-canvas (the same trick scripts/crop.ts uses).
//
//   npx tsx scripts/bake-cards.ts          bake promoted deck + back
//
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
].find((p) => existsSync(p));

const TARGET_W = 512;     // card displays ~168–230px; 512 covers retina
const QUALITY = 0.86;
const ART = resolve(process.cwd(), 'public/art');
const OUT = resolve(process.cwd(), 'public/cards');
mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(ART, 'runs/index.json'), 'utf8')) as {
  promoted: Record<string, string>;
};

// [outputName, sourcePngPath]
const jobs: [string, string][] = [
  ...Object.entries(manifest.promoted).map(([id, runId]) => [id, resolve(ART, 'runs', `${runId}.png`)] as [string, string]),
  ['back', resolve(ART, 'back-1.png')],
];

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
let ok = 0;
for (const [name, src] of jobs) {
  if (!existsSync(src)) { console.log(`  skip ${name} (no ${src})`); continue; }
  const b64 = readFileSync(src).toString('base64');
  const dataUrl: string = await page.evaluate(async ({ b64, TARGET_W, QUALITY }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = TARGET_W, h = Math.round((img.naturalHeight / img.naturalWidth) * TARGET_W);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/webp', QUALITY);
  }, { b64, TARGET_W, QUALITY });
  const out = resolve(OUT, `${name}.webp`);
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const kb = (Buffer.from(dataUrl.split(',')[1], 'base64').length / 1024).toFixed(0);
  console.log(`  ${name.padEnd(16)} → public/cards/${name}.webp (${kb}kb)`);
  ok++;
}
await browser.close();
console.log(`\nbaked ${ok}/${jobs.length} card assets.`);
