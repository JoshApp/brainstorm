/**
 * LOOK SHEET — the art-direction comparison loop, as one command.
 *
 *   npm run delve look                 every preset, phone viewport
 *   npm run delve look drawn boneink   just these two, bigger cells
 *   npm run delve look --scenario=spawn   judge a look somewhere else
 *   npm run delve look --no-gray       skip the grayscale row
 *   npm run delve look --lab           shoot the STYLE LAB instead of the game
 *
 * --lab points the same composer at style-lab.html — a sandbox with its own
 * scene and no game code under it, where a recipe may do anything (see
 * src/lab/style-lab.ts). One sheet layout, two subjects: what we HAVE and what
 * we WANT. They are never mixed on one sheet, because a cell showing something
 * the engine cannot do would quietly become a promise.
 *
 * Renders the BEAUTY CORNER (?scenario=look-lab — see debug/scenarios.ts) once
 * per look and lays the frames out as a contact sheet, with a GRAYSCALE copy of
 * the same row underneath.
 *
 * Two deliberate choices, both of them the point:
 *
 *   THUMBNAILS. Cells are small. A look that only holds up at full screen does
 *   not hold up — the phone is 6 inches away from a face and the frame is read
 *   in half a second. If you cannot tell two cells apart at this size, the
 *   difference between them is not a style decision, it is a preference.
 *
 *   THE GRAYSCALE ROW. If the composition dies with the colour removed, the
 *   look is being carried by hue alone, which collapses the moment the room's
 *   torch tint changes — and DELVE changes it constantly, by design. Value
 *   structure first; colour is the second question.
 *
 * Output: /tmp/look-sheet.png
 *
 * KNOWN ROUGH EDGE: the profiler's "lag NNms" readout survives both the
 * hud-hidden class and a display:none !important stylesheet, so it sits in the
 * top-left of every cell. It is identical in every cell, so it does not bias a
 * comparison — but it is ugly and it is not fixed. Whoever next touches this,
 * find where that element is re-created per frame rather than adding a third
 * way to hide it.
 */

import { chromium, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { resolveChromium } from './perf-core';

const CELL_W = 420;   // per-cell render width — small ON PURPOSE (see above)
const CELL_H = 195;   // 844x390 phone landscape, halved
const PAD = 8;
const LABEL_H = 16;

interface LookInfo { id: string; name: string; note: string }

function cols(n: number): number {
  if (n <= 2) return n;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

/**
 * Mark a cell with its INDEX as a row of ticks, keyed to the legend the CLI
 * prints. An earlier version tried to burn the preset's NAME in a hand-rolled
 * bitmap font and produced unreadable speckle — a label you cannot read is
 * worse than no label, because it looks like the sheet is telling you
 * something. Counting ticks is unambiguous at thumbnail size, which is the only
 * size this sheet is ever read at.
 */
function drawIndex(png: PNG, x: number, y: number, index: number): void {
  for (let i = 0; i < index; i++) {
    for (let dx = 0; dx < 6; dx++) for (let dy = 0; dy < 6; dy++) {
      const px = x + i * 9 + dx, py = y + dy;
      const idx = (py * png.width + px) * 4;
      if (idx < 0 || idx + 3 >= png.data.length) continue;
      png.data[idx] = 214; png.data[idx + 1] = 202; png.data[idx + 2] = 176; png.data[idx + 3] = 255;
    }
  }
}

function blit(dst: PNG, src: PNG, ox: number, oy: number, gray: boolean): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = ((oy + y) * dst.width + (ox + x)) * 4;
      if (d < 0 || d + 3 >= dst.data.length) continue;
      if (gray) {
        // Rec. 709 luma — the value structure, which is the question the
        // grayscale row exists to ask.
        const v = Math.round(0.2126 * src.data[s] + 0.7152 * src.data[s + 1] + 0.0722 * src.data[s + 2]);
        dst.data[d] = v; dst.data[d + 1] = v; dst.data[d + 2] = v;
      } else {
        dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1]; dst.data[d + 2] = src.data[s + 2];
      }
      dst.data[d + 3] = 255;
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const wanted = argv.filter((a) => !a.startsWith('--'));
  const withGray = !flags.includes('--no-gray');
  const scenario = flags.find((f) => f.startsWith('--scenario='))?.split('=')[1] ?? 'look-lab';
  const lab = flags.includes('--lab');
  const out = flags.find((f) => f.startsWith('--out='))?.split('=')[1]
    ?? (lab ? '/tmp/style-sheet.png' : '/tmp/look-sheet.png');
  // One URL builder for both subjects, so the only difference between a look
  // sheet and a style sheet is which page it points at.
  const urlFor = (base: string, id?: string) => lab
    ? `${base}style-lab.html?bare=1${id ? `&style=${id}` : ''}`
    : `${base}?scenario=${scenario}${id ? `&look=${id}` : ''}&webgpu=0&nowarm=1&freeze=false`;
  const probe = lab ? 'window.__styles()' : 'window.__looks()';

  const chromiumPath = resolveChromium();
  if (!existsSync(chromiumPath)) throw new Error(`Chromium not found at ${chromiumPath}`);
  const port = 5400 + Math.floor(Math.random() * 90);
  const vite: ChildProcess = spawn('node_modules/.bin/vite',
    ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 2500));

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: CELL_W, height: CELL_H } });
    const page: Page = await ctx.newPage();

    const base = `http://127.0.0.1:${port}/brainstorm/`;
    await page.goto(urlFor(base), { waitUntil: 'networkidle', timeout: 40_000 });
    await page.waitForTimeout(lab ? 900 : 3000);

    if (!lab) {
      const builtLevel = await page.evaluate(`(window.__scene && (() => {\n        let n = null; window.__scene.traverse((o) => { if (!n && o.name && o.name.indexOf('level-') === 0) n = o.name; }); return n;\n      })()) || 'UNKNOWN'`);
      console.log(`scene: ${builtLevel}  (expected level-${scenario})`);
    }

    const all = await page.evaluate(probe) as LookInfo[];
    const looks = wanted.length ? all.filter((l) => wanted.includes(l.id)) : all;
    if (looks.length === 0) {
      console.log(`No such look. Available: ${all.map((l) => l.id).join(', ')}`);
      return;
    }

    const shots: Array<{ look: LookInfo; png: PNG }> = [];
    for (const look of looks) {
      // Re-navigate per look rather than applying in place: a look touches
      // material recompiles and render-target scale, and carrying one preset's
      // side effects into the next is exactly how a comparison sheet lies.
      await page.goto(urlFor(base, look.id), { waitUntil: 'networkidle', timeout: 40_000 });
      if (!lab) {
        await page.waitForFunction(`(function () {
          var el = document.getElementById('descent-fade');
          return !el || parseFloat(getComputedStyle(el).opacity) < 0.05;
        })()`, undefined, { timeout: 30_000 }).catch(() => { /* capture anyway */ });
      }
      await page.waitForTimeout(lab ? 500 : 1600);
      // The HUD is not the art direction. Same class the inspector uses.
      // The HUD and the profiler readout are not the art direction.
      // The HUD and the profiler readout are not the art direction. A
      // STYLESHEET rather than an inline style: the perf overlay rewrites its
      // own element every frame, so an inline display:none is gone by the time
      // the shutter opens.
      await page.evaluate(`(function () {
        document.body.classList.add('hud-hidden');
        var s = document.getElementById('look-sheet-hide');
        if (!s) {
          s = document.createElement('style');
          s.id = 'look-sheet-hide';
          s.textContent = '#perf-overlay, .game-hud { display: none !important; }';
          document.head.appendChild(s);
        }
      })()`);
      await page.waitForTimeout(120);
      shots.push({ look, png: PNG.sync.read(await page.screenshot({ type: 'png' })) });
      console.log(`  ${look.id.padEnd(14)} ${look.note}`);
    }

    const nCols = cols(shots.length);
    const nRows = Math.ceil(shots.length / nCols);
    const rowH = CELL_H + LABEL_H + PAD;
    const sheetW = nCols * (CELL_W + PAD) + PAD;
    const sheetH = PAD + nRows * rowH + (withGray ? nRows * rowH : 0);
    const sheet = new PNG({ width: sheetW, height: sheetH });
    for (let i = 0; i < sheet.data.length; i += 4) {
      sheet.data[i] = 18; sheet.data[i + 1] = 17; sheet.data[i + 2] = 20; sheet.data[i + 3] = 255;
    }

    shots.forEach((s, i) => {
      const cx = PAD + (i % nCols) * (CELL_W + PAD);
      const cy = PAD + Math.floor(i / nCols) * rowH;
      blit(sheet, s.png, cx, cy, false);
      drawIndex(sheet, cx + 3, cy + CELL_H + 4, i + 1);
      if (withGray) {
        const gy = PAD + nRows * rowH + Math.floor(i / nCols) * rowH;
        blit(sheet, s.png, cx, gy, true);
        drawIndex(sheet, cx + 3, gy + CELL_H + 4, i + 1);
      }
    });

    writeFileSync(out, PNG.sync.write(sheet));
    console.log(`\n${shots.length} ${lab ? 'styles · style-lab' : `looks · ${scenario}`} · ${withGray ? 'colour + grayscale' : 'colour only'}`);
    console.log(`→ ${out}`);
    console.log('\nlegend (top-left to bottom-right):');
    shots.forEach((s, i) => console.log(`  ${i + 1}. ${s.look.name.padEnd(14)} ${s.look.note}`));
  } finally {
    await browser.close().catch(() => { /* best effort */ });
    if (vite.pid) { try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* gone */ } }
    try { vite.kill('SIGKILL'); } catch { /* gone */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
