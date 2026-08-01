/**
 * Compose a relic art-STYLE comparison contact sheet: rows = relics, columns =
 * registers (ink / specimen / oil / relief / …), each cell the newest generated
 * run for that (relic, style) pair. One labelled PNG a human can eyeball to pick
 * the direction, written to public/art/relic-styles.png.
 *
 *   npx tsx scripts/art-relic-contact.ts "<out.png>" "<style style …>" "<relicId relicId …>"
 *
 * Reads the run manifest (public/art/runs/index.json) + the run PNGs on disk, so
 * it runs right after `delve art relic … --style …` sweeps in the same job. Uses
 * the workflow's headless Chromium to rasterise (Playwright).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import * as M from './art-runs';

const [, , outArg, stylesArg, relicsArg] = process.argv;
const out = outArg || resolve(process.cwd(), 'public/art/relic-styles.png');
const styles = (stylesArg || 'ink specimen oil relief').trim().split(/\s+/);
const relics = (relicsArg || '').trim().split(/\s+/).filter(Boolean);

const m = M.load();

/** Newest relic run for a (subject, style) pair, or null. */
function newest(subject: string, style: string) {
  let best: { n: number; file: string } | null = null;
  for (const r of m.runs) {
    if (r.kind !== 'relic' || r.subject !== subject || r.style !== style) continue;
    if (!best || r.n > best.n) best = { n: r.n, file: `${r.id}.png` };
  }
  return best;
}

function dataUri(file: string): string | null {
  const p = resolve(M.RUNS_DIR, file);
  if (!existsSync(p)) return null;
  return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
}

const CELL = 200;
const LABEL = 120;
const HEADER = 30;

const rowsHtml = relics.map((relic) => {
  const cells = styles.map((style) => {
    const n = newest(relic, style);
    const uri = n ? dataUri(n.file) : null;
    const inner = uri
      ? `<img src="${uri}" style="width:${CELL}px;height:${CELL}px;object-fit:contain;display:block;background:#0a0806">`
      : `<div style="width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;background:#161010;color:#5a4a3a;font:11px monospace">— none —</div>`;
    return `<td style="padding:4px">${inner}</td>`;
  }).join('');
  return `<tr><td style="width:${LABEL}px;color:#c8b89a;font:12px monospace;padding-right:8px;text-align:right;vertical-align:middle">${relic}</td>${cells}</tr>`;
}).join('');

const headerHtml = `<tr><td style="width:${LABEL}px"></td>${styles.map((s) => `<td style="text-align:center;color:#9a8a6a;font:bold 13px monospace;height:${HEADER}px">${s}</td>`).join('')}</tr>`;

const width = LABEL + styles.length * (CELL + 8) + 24;
const height = HEADER + relics.length * (CELL + 8) + 24;

const html = `<html><body style="margin:0;background:#120e0c;padding:12px"><table style="border-collapse:collapse">${headerHtml}${rowsHtml}</table></body></html>`;

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(existsSync);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.waitForTimeout(300);
await p.screenshot({ path: out });
await b.close();
console.log(`relic style contact sheet → ${out}  (${relics.length} relics × ${styles.length} styles)`);
