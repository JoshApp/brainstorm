// Bake the chosen deck into SHIPPED, FRAMED game assets.
//
// Ports the atelier's framing tech (src/art/viewer.ts) into a headless canvas:
// each card's illustration is composited INTO the chosen frame — the frame's
// black window is detected (centre-cross + rect-bounded flood-fill, can't leak),
// the art is inlaid into that window with overscan (its own paper margin hidden
// behind the border), the frame's outer paper is cropped to the organic ink
// edge, and the result is exported as ONE webp per card. So both the reading and
// the in-world drop just show the finished framed card — no live compositing.
//
//   npx tsx scripts/bake-cards.ts
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

const OUT_W = 480;        // baked card width; H follows the frame aspect
const QUALITY = 0.88;
const ART = resolve(process.cwd(), 'public/art');
const OUT = resolve(process.cwd(), 'public/cards');
mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(ART, 'runs/index.json'), 'utf8')) as {
  promoted: Record<string, string>; activeFrame: string;
};
const frameB64 = readFileSync(resolve(ART, 'runs', `${manifest.activeFrame}.png`)).toString('base64');

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();

// The compositor — runs in the page. Mirrors viewer.ts frameWindow + inlay.
const composite = async (artB64: string): Promise<string> =>
  page.evaluate(async ({ frameB64, artB64, OUT_W, QUALITY }) => {
    // esbuild (tsx) wraps named fns with __name for stack traces; that helper
    // doesn't exist in the page, so shim it before any wrapped fn runs.
    if (!(globalThis as unknown as { __name?: unknown }).__name) (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    const load = async (b64: string) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); return i; };
    const frame = await load(frameB64);
    const art = await load(artB64);
    const W = OUT_W, H = Math.round((frame.naturalHeight / frame.naturalWidth) * OUT_W);

    // read frame pixels at output size
    const fcv = document.createElement('canvas'); fcv.width = W; fcv.height = H;
    const fctx = fcv.getContext('2d')!; fctx.drawImage(frame, 0, 0, W, H);
    const fd = fctx.getImageData(0, 0, W, H); const px = fd.data;
    const lum = (p: number) => { const i = p * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };

    const TH = 70, guard = Math.round(Math.min(W, H) * 0.05), OUTER = 140;
    const cx = W >> 1, cy = H >> 1;
    let L = cx; while (L > 0 && lum(cy * W + L - 1) < TH) L--;
    let R = cx; while (R < W - 1 && lum(cy * W + R + 1) < TH) R++;
    let T = cy; while (T > 0 && lum((T - 1) * W + cx) < TH) T--;
    let B = cy; while (B < H - 1 && lum((B + 1) * W + cx) < TH) B++;

    // window mask — rect-bounded flood-fill of the interior dark
    const mask = new Uint8Array(W * H), seen = new Uint8Array(W * H), st = [cy * W + cx];
    let minX = W, maxX = 0, minY = H, maxY = 0;
    while (st.length) {
      const p = st.pop()!; if (seen[p]) continue; seen[p] = 1;
      const x = p % W, y = (p - x) / W;
      if (x < L || x > R || y < T || y > B) continue;
      if (x < guard || y < guard || x >= W - guard || y >= H - guard) continue;
      if (lum(p) >= TH) continue;
      mask[p] = 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W);
    }
    // outer paper mask — flood bright inward from the edges
    const oMask = new Uint8Array(W * H), os = new Uint8Array(W * H);
    const ost = [0, W - 1, (H - 1) * W, W * H - 1, W >> 1, (H - 1) * W + (W >> 1), (H >> 1) * W, (H >> 1) * W + W - 1];
    while (ost.length) {
      const p = ost.pop()!; if (os[p]) continue; os[p] = 1;
      if (lum(p) < OUTER) continue;
      oMask[p] = 1;
      const x = p % W, y = (p - x) / W;
      if (x > 0) ost.push(p - 1); if (x < W - 1) ost.push(p + 1); if (y > 0) ost.push(p - W); if (y < H - 1) ost.push(p + W);
    }

    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d')!;
    // art inlaid into the window bbox (cover + 8% overscan), clipped to the window
    const wW = maxX - minX, wH = maxY - minY, OV = 0.08;
    ctx.save();
    ctx.beginPath(); ctx.rect(minX, minY, wW, wH); ctx.clip();
    const bw = wW * (1 + 2 * OV), bh = wH * (1 + 2 * OV), bx = minX - OV * wW, by = minY - OV * wH;
    const ar = art.naturalWidth / art.naturalHeight;
    let dw = bw, dh = bw / ar; if (dh < bh) { dh = bh; dw = bh * ar; }
    ctx.drawImage(art, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
    ctx.restore();
    // frame on top, window + outer punched transparent
    for (let p = 0; p < W * H; p++) if (mask[p] || oMask[p]) px[p * 4 + 3] = 0;
    fctx.putImageData(fd, 0, 0);
    ctx.drawImage(fcv, 0, 0);
    return out.toDataURL('image/webp', QUALITY);
  }, { frameB64, artB64, OUT_W, QUALITY });

let ok = 0;
for (const [id, runId] of Object.entries(manifest.promoted)) {
  const src = resolve(ART, 'runs', `${runId}.png`);
  if (!existsSync(src)) { console.log(`  skip ${id}`); continue; }
  const dataUrl = await composite(readFileSync(src).toString('base64'));
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(resolve(OUT, `${id}.webp`), bytes);
  console.log(`  ${id.padEnd(16)} → cards/${id}.webp (${(bytes.length / 1024).toFixed(0)}kb)`);
  ok++;
}

// the back stays a plain downscale (no frame composite)
const backSrc = resolve(ART, 'back-1.png');
if (existsSync(backSrc)) {
  const b64 = readFileSync(backSrc).toString('base64');
  const dataUrl: string = await page.evaluate(async ({ b64, OUT_W, QUALITY }) => {
    const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode();
    const w = OUT_W, h = Math.round((i.naturalHeight / i.naturalWidth) * OUT_W);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.drawImage(i, 0, 0, w, h);
    return cv.toDataURL('image/webp', QUALITY);
  }, { b64, OUT_W, QUALITY });
  writeFileSync(resolve(OUT, 'back.webp'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  back             → cards/back.webp`);
  ok++;
}

await browser.close();
console.log(`\nbaked ${ok} framed card assets.`);
