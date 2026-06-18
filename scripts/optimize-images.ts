// Image optimizer — PNG → WebP for shipped assets, so nothing heavy reaches the
// phone. Uses a headless-canvas encode (chromium's toDataURL('image/webp')), so
// no native deps (sharp/cwebp) needed — same trick as scripts/bake-cards.ts.
//
//   npx tsx scripts/optimize-images.ts [dir] [quality] [maxLongSide]
//   delve optimize [dir]                      (defaults: public/textures 0.82 1280)
//
// Writes <name>.webp beside each <name>.png and leaves the PNG in place (delete
// the PNGs once the app references .webp). Downscales anything over maxLongSide.
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
].find((p) => existsSync(p));

const dir = resolve(process.cwd(), process.argv[2] ?? 'src/assets/textures');
const Q = Number(process.argv[3] ?? 0.82);
const MAXW = Number(process.argv[4] ?? 1280);

const pngs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'));
if (!pngs.length) { console.log(`no PNGs in ${dir}`); process.exit(0); }

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newContext({ deviceScaleFactor: 1 }).then((c) => c.newPage());
let saved = 0, total = 0;
for (const f of pngs) {
  const src = join(dir, f);
  const b64 = readFileSync(src).toString('base64');
  const webpB64 = await page.evaluate(async ({ b64, Q, MAXW }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, MAXW / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/webp', Q).split(',')[1];
  }, { b64, Q, MAXW });
  const out = src.replace(/\.png$/i, '.webp');
  writeFileSync(out, Buffer.from(webpB64, 'base64'));
  const before = statSync(src).size, after = statSync(out).size;
  total += before; saved += before - after;
  console.log(`  ${f.padEnd(26)} ${String(Math.round(before / 1024)).padStart(5)}KB → ${String(Math.round(after / 1024)).padStart(4)}KB webp  (-${Math.round((1 - after / before) * 100)}%)`);
}
await browser.close();
console.log(`\n${pngs.length} image(s): ${Math.round(total / 1024)}KB → saved ${Math.round(saved / 1024)}KB (-${Math.round(saved / total * 100)}%)`);
