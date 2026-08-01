// Bake promoted relic runs into SHIPPED 2.5D sprites (public/relics/<id>.webp).
//
// A relic is a single occult OBJECT on black (not a framed card), so the bake is
// simpler than the deck's: no frame composite. For each PROMOTED relic run we
//   1. flood-fill the near-black BACKGROUND inward from the edges → transparent
//      (edge-connected only, so dark parts INSIDE the lit object stay opaque —
//      a black iron ring doesn't get eaten),
//   2. trim to the opaque bounding box,
//   3. fit into a square target and export a transparent webp.
// Then we regenerate src/content/relic-art-index.ts with the baked ids, so the
// game picks them up (relic-art-assets.ts → itemImageUrl → every UI surface +
// the in-world billboard). Run AFTER `delve art relic all` + `delve art promote`.
//
//   npx tsx scripts/bake-relics.ts
//
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { RELIC_ART } from '../src/art/relic-art';

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
].find((p) => existsSync(p));

const OUT_SIZE = 512;     // baked sprite is square OUT_SIZE×OUT_SIZE (object fit inside)
const QUALITY = 0.9;
const ART = resolve(process.cwd(), 'public/art');
const OUT = resolve(process.cwd(), 'public/relics');
const INDEX = resolve(process.cwd(), 'src/content/relic-art-index.ts');
mkdirSync(OUT, { recursive: true });

const manifestPath = resolve(ART, 'runs/index.json');
if (!existsSync(manifestPath)) {
  console.error('no art runs yet — generate with `delve art relic all` + promote first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { promoted: Record<string, string> };
const relicIds = new Set(RELIC_ART.map((r) => r.id));

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();

// The keyer — runs in the page. CHROMA-keys the flat green screen the relics are
// generated against → alpha, trims to the opaque bbox, fits into a square,
// returns a transparent webp. Chroma keying works by COLOUR, so it removes the
// green EVERYWHERE at once — the outer background AND any enclosed hole (a ring's
// centre) — which an edge flood-fill can't reach. The alpha is FEATHERED across
// a "greenness" ramp (anti-aliased edges, not a hard on/off cut → far less
// jaggy), and green spill on the object's rim is de-spilled so there's no green
// fringe. Rot relics' sickly DESATURATED green survives: keying measures green
// DOMINANCE (g minus the stronger of r/b), which pure screen-green has in spades
// and a muted green does not.
const keyOut = async (b64: string): Promise<string> =>
  page.evaluate(async ({ b64, OUT_SIZE, QUALITY }) => {
    if (!(globalThis as unknown as { __name?: unknown }).__name) (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const src = document.createElement('canvas'); src.width = W; src.height = H;
    const sctx = src.getContext('2d')!; sctx.drawImage(img, 0, 0);
    const id = sctx.getImageData(0, 0, W, H); const px = id.data;

    // Greenness = how far green dominates the stronger of red/blue. Pure screen
    // green ≈ 200+, a muted/olive object green ≈ 0-40. Feather alpha between LOW
    // (fully opaque) and HIGH (fully transparent).
    const LOW = 48, HIGH = 130;
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const greenness = g - Math.max(r, b);
      let a = 255;
      if (greenness >= HIGH) a = 0;
      else if (greenness > LOW) a = Math.round(255 * (1 - (greenness - LOW) / (HIGH - LOW)));
      px[i + 3] = a;
      // De-spill: wherever green is winning at all, pull it down to the stronger
      // of r/b so kept edge pixels don't keep a green rim.
      if (a > 0 && greenness > 0) px[i + 1] = Math.max(r, b);
    }
    sctx.putImageData(id, 0, 0);

    // Opaque bounding box (a small alpha guard against stray specks).
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < minX) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }   // nothing keyed — keep all
    const bw = maxX - minX + 1, bh = maxY - minY + 1;

    // Fit the trimmed object into a square with a small margin.
    const out = document.createElement('canvas'); out.width = OUT_SIZE; out.height = OUT_SIZE;
    const octx = out.getContext('2d')!; octx.imageSmoothingQuality = 'high';
    const margin = 0.92, scale = (OUT_SIZE * margin) / Math.max(bw, bh);
    const dw = bw * scale, dh = bh * scale;
    octx.drawImage(src, minX, minY, bw, bh, (OUT_SIZE - dw) / 2, (OUT_SIZE - dh) / 2, dw, dh);
    return out.toDataURL('image/webp', QUALITY);
  }, { b64, OUT_SIZE, QUALITY });

const baked: string[] = [];
for (const [subject, runId] of Object.entries(manifest.promoted)) {
  if (!relicIds.has(subject)) continue;                 // relics only
  const srcPath = resolve(ART, 'runs', `${runId}.png`);
  if (!existsSync(srcPath)) { console.log(`  skip ${subject} (no run image)`); continue; }
  const b64 = readFileSync(srcPath).toString('base64');
  const webp = Buffer.from((await keyOut(b64)).split(',')[1], 'base64');
  writeFileSync(resolve(OUT, `${subject}.webp`), webp);
  baked.push(subject);
  console.log(`  ${subject.padEnd(20)} → relics/${subject}.webp (${(webp.length / 1024).toFixed(0)}kb)`);
}

await browser.close();

// Regenerate the index from EVERY relic sprite present on disk (∈ RELIC_ART),
// not just the ones baked THIS run — so a targeted re-roll (bake only a few,
// with the rest restored from the relic-art branch) keeps the full set in the
// index instead of narrowing it to the subset.
const onDisk = readdirSync(OUT)
  .filter((f) => f.endsWith('.webp'))
  .map((f) => f.replace(/\.webp$/, ''))
  .filter((id) => relicIds.has(id));
const indexed = [...new Set([...onDisk, ...baked])].sort();
const body = indexed.map((id) => `  '${id}',`).join('\n');
writeFileSync(INDEX, `// BAKED RELIC ART INDEX — GENERATED by scripts/bake-relics.ts. Do not hand-edit.
// The relic ids with a shipped 2.5D sprite in public/relics/<id>.webp. Consumed
// by src/content/relic-art-assets.ts → itemImageUrl (every UI surface + the
// in-world billboard). Empty until the first bake runs.
export const BAKED_RELIC_ART: readonly string[] = [
${body}
];
`);

console.log(`\nbaked ${baked.length} relic sprite(s) this run; indexed ${indexed.length} on disk. Wrote src/content/relic-art-index.ts.`);
