// Re-fit already-baked relic sprites IN PLACE: re-trim each to its SOLID object
// (ignoring faint contact-shadow / halo pixels that a low alpha threshold let
// into the bake's bounding box), then re-centre and enlarge into the square.
//
// Why: the first greenscreen bake trimmed at alpha > 24, so a faint soft shadow
// under some relics was counted as "object" — which pushed the real object UP
// off-centre AND shrank it (the shadow ate frame space). Re-fitting at a high
// alpha threshold drops the shadow from the box, so the object sits centred and
// fills more of the sprite. Operates on public/relics/*.webp directly — no
// regeneration, no FAL.
//
//   npx tsx scripts/refit-relics.ts
//
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = [
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
].find((p) => existsSync(p));

const OUT_SIZE = 512;
const QUALITY = 0.9;
const ALPHA_TH = 110;   // only pixels this opaque define the object box (drops shadow)
const MARGIN = 0.96;    // object fills this fraction of the square (was 0.92)
const DIR = resolve(process.cwd(), 'public/relics');

const files = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
if (files.length === 0) { console.error('no sprites in public/relics'); process.exit(1); }

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();

const refit = async (b64: string): Promise<string> =>
  page.evaluate(async ({ b64, OUT_SIZE, QUALITY, ALPHA_TH, MARGIN }) => {
    if (!(globalThis as unknown as { __name?: unknown }).__name) (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    const img = new Image(); img.src = `data:image/webp;base64,${b64}`; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const src = document.createElement('canvas'); src.width = W; src.height = H;
    const sctx = src.getContext('2d')!; sctx.drawImage(img, 0, 0);
    const px = sctx.getImageData(0, 0, W, H).data;

    // Solid-object bounding box (ignore faint shadow / halo).
    let minX = W, maxX = -1, minY = H, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] >= ALPHA_TH) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }  // nothing solid — keep all
    const bw = maxX - minX + 1, bh = maxY - minY + 1;

    const out = document.createElement('canvas'); out.width = OUT_SIZE; out.height = OUT_SIZE;
    const octx = out.getContext('2d')!; octx.imageSmoothingQuality = 'high';
    const scale = (OUT_SIZE * MARGIN) / Math.max(bw, bh);
    const dw = bw * scale, dh = bh * scale;
    octx.drawImage(src, minX, minY, bw, bh, (OUT_SIZE - dw) / 2, (OUT_SIZE - dh) / 2, dw, dh);
    return out.toDataURL('image/webp', QUALITY);
  }, { b64, OUT_SIZE, QUALITY, ALPHA_TH, MARGIN });

let n = 0;
for (const f of files) {
  const p = resolve(DIR, f);
  const b64 = readFileSync(p).toString('base64');
  const webp = Buffer.from((await refit(b64)).split(',')[1], 'base64');
  writeFileSync(p, webp);
  n++;
  console.log(`  refit ${f} (${(webp.length / 1024).toFixed(0)}kb)`);
}
await browser.close();
console.log(`\nre-fitted ${n} relic sprite(s) in place.`);
