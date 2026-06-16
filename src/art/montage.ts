/**
 * DELVE art montage (DEV ONLY) — a contact sheet of every run for one subject,
 * each labeled by its style, for surveying a wide style exploration at a glance.
 *   /montage.html?subject=the-hollow-saint   (default)   ?subject=all
 * Loaded only on the dev server; not in the production build.
 */
import { type ArtManifest, type ArtRun } from './runs';
import { CARD_ART } from './cards';
import { THEME, FONT_UI, FONT_DISPLAY } from '../ui/theme';

const BASE = import.meta.env.BASE_URL;
const subject = new URLSearchParams(location.search).get('subject') ?? 'the-hollow-saint';
const COLS = Number(new URLSearchParams(location.search).get('cols') ?? 5);
const CELL = 230;
const nameOf = (id: string) => CARD_ART.find((c) => c.id === id)?.name ?? id;
// 'spread' mode: the deck as one object — the promoted run per card, big-labeled
// by card NAME (not style), to read the family scheme as a cohesive deck.
const SPREAD = subject === 'spread';

const root = document.body;
Object.assign(root.style, { fontFamily: FONT_UI, background: THEME.void, color: THEME.text, margin: '0', padding: '20px' } as Partial<CSSStyleDeclaration>);

function cell(run: ArtRun): HTMLElement {
  const c = document.createElement('div');
  Object.assign(c.style, { display: 'flex', flexDirection: 'column', gap: '4px' } as Partial<CSSStyleDeclaration>);
  const im = document.createElement('img');
  im.src = `${BASE}art/${run.file}`;
  Object.assign(im.style, { width: `${CELL}px`, height: `${Math.round(CELL * run.height / run.width)}px`, objectFit: 'cover', display: 'block', background: THEME.sunken } as Partial<CSSStyleDeclaration>);
  c.appendChild(im);
  const lab = document.createElement('div');
  lab.textContent = SPREAD ? nameOf(run.subject) : run.style;
  Object.assign(lab.style, { fontFamily: FONT_DISPLAY, fontSize: '14px', letterSpacing: '0.12em', color: THEME.amber, textAlign: 'center' } as Partial<CSSStyleDeclaration>);
  c.appendChild(lab);
  const sub = document.createElement('div');
  sub.textContent = SPREAD ? `${run.style} · ${run.id}` : `${run.id}${run.note ? ` · ${run.note}` : ''}`;
  Object.assign(sub.style, { fontFamily: FONT_UI, fontSize: '9px', color: THEME.faint, textAlign: 'center' } as Partial<CSSStyleDeclaration>);
  c.appendChild(sub);
  return c;
}

async function main() {
  let manifest: ArtManifest;
  try { manifest = await (await fetch(`${BASE}art/runs/index.json`, { cache: 'no-store' })).json(); }
  catch { root.textContent = 'no manifest'; return; }

  const styleFilter = new URLSearchParams(location.search).get('style');
  let runs = SPREAD
    ? CARD_ART.map((c) => manifest.runs.find((r) => r.id === manifest.promoted[c.id])).filter((r): r is ArtRun => !!r)
    : subject === 'all' ? manifest.runs : manifest.runs.filter((r) => r.subject === subject);
  if (styleFilter) runs = runs.filter((r) => r.style === styleFilter);
  const title = document.createElement('div');
  title.textContent = `${subject} — ${runs.length} runs`;
  Object.assign(title.style, { fontFamily: FONT_DISPLAY, fontSize: '20px', letterSpacing: '0.2em', color: THEME.amber, textTransform: 'uppercase', marginBottom: '16px' } as Partial<CSSStyleDeclaration>);
  root.appendChild(title);

  const grid = document.createElement('div');
  Object.assign(grid.style, { display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`, gap: '16px' } as Partial<CSSStyleDeclaration>);
  for (const r of runs) grid.appendChild(cell(r));
  root.appendChild(grid);
}
main();
