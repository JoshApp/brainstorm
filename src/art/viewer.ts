/**
 * DELVE art suite (DEV ONLY) — the visual half of the forking art loop.
 *
 * Reads the append-only run manifest (public/art/runs/index.json) and shows
 * EVERY iteration, never swallowing the last — so you can compare a batch,
 * trace forks (⟜parent), and judge directions side by side. Then you steer:
 *   ★ star runs you want more of   ✎ draw on a run to mark a refinement
 *   write a note · Submit          → POSTs to the dev server (art-feedback/)
 * A background watcher wakes Claude with your note + drawings to fork the next
 * round. Loaded only by /art.html on the dev server; never in the game build.
 */
import { CARD_ART } from './cards';
import { type ArtManifest, type ArtRun, runsFor } from './runs';
import { THEME, FONT_UI, displayHeading, injectThemeKeyframes } from '../ui/theme';

injectThemeKeyframes();
const BASE = import.meta.env.BASE_URL;
const imgURL = (file: string) => `${BASE}art/${file}`;

// ── feedback state ──────────────────────────────────────────────────────────
const selections = new Set<string>();        // ★ "more of this"
const rejects = new Set<string>();            // ✕ "not this"
const drawings = new Map<string, string>();   // runId -> annotated PNG dataURL

// ── shell ─────────────────────────────────────────────────────────────────
const root = document.body;
Object.assign(root.style, {
  fontFamily: FONT_UI,
  background: `radial-gradient(ellipse at 50% -10%, rgba(40,28,18,0.45), transparent 55%), ${THEME.void}`,
  minHeight: '100vh', margin: '0', padding: '0 0 140px', color: THEME.text,
} as Partial<CSSStyleDeclaration>);

function caption(text: string, color: string = THEME.faint, size = 10) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, { fontFamily: FONT_UI, fontSize: `${size}px`, letterSpacing: '0.18em', color, textAlign: 'center' } as Partial<CSSStyleDeclaration>);
  return el;
}
function sectionHead(text: string) {
  const wrap = document.createElement('div');
  wrap.style.textAlign = 'center';
  wrap.style.margin = '40px 0 14px';
  const h = displayHeading(text, { size: 22, glow: true });
  h.style.textAlign = 'center';
  wrap.appendChild(h);
  return wrap;
}

// ── image with graceful placeholder ─────────────────────────────────────────
function pic(src: string, w: number, h: number, hint: string): HTMLElement {
  const el = document.createElement('img');
  el.src = src; el.crossOrigin = 'anonymous';
  Object.assign(el.style, { width: `${w}px`, height: `${h}px`, objectFit: 'cover', display: 'block' } as Partial<CSSStyleDeclaration>);
  el.onerror = () => {
    const ph = document.createElement('div');
    Object.assign(ph.style, { width: `${w}px`, height: `${h}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: FONT_UI, fontSize: '10px', color: THEME.faint, background: THEME.sunken, border: `1px dashed ${THEME.rule}`, padding: '0 12px', boxSizing: 'border-box' } as Partial<CSSStyleDeclaration>);
    ph.textContent = hint; el.replaceWith(ph);
  };
  return el;
}

// ── a run tile: image + meta + ★/✕/✎ controls ───────────────────────────────
const TILE_W = 168;
function tile(run: ArtRun, manifest: ArtManifest): HTMLElement {
  const h = Math.round(TILE_W * (run.height / run.width));
  const card = document.createElement('div');
  Object.assign(card.style, { position: 'relative', width: `${TILE_W}px`, display: 'flex', flexDirection: 'column', gap: '5px', padding: '6px', borderRadius: '3px', border: '1px solid transparent', background: THEME.sunken } as Partial<CSSStyleDeclaration>);

  const isPromoted = manifest.promoted[run.subject] === run.id || manifest.activeFrame === run.id;
  function refresh() {
    card.style.borderColor = selections.has(run.id) ? THEME.amber : rejects.has(run.id) ? THEME.blood : isPromoted ? THEME.ruleStrong : 'transparent';
    card.style.boxShadow = selections.has(run.id) ? THEME.emberGlow : 'none';
  }

  const im = pic(imgURL(run.file), TILE_W - 12, h - 12, `${run.id} missing`);
  if (drawings.has(run.id)) (im as HTMLImageElement).style.outline = `2px solid ${THEME.blood}`;
  card.appendChild(im);

  const meta = run.id + (isPromoted ? ' ★promoted' : '') + ` · ${run.style} · ${run.seed}` + (run.parentId ? ` ⟜${run.parentId}` : '');
  const cap = caption(meta, THEME.dim, 9);
  cap.style.textAlign = 'left';
  cap.title = (run.tweak ? `tweak: ${run.tweak}\n` : '') + run.prompt;
  card.appendChild(cap);

  const bar = document.createElement('div');
  Object.assign(bar.style, { display: 'flex', gap: '4px' } as Partial<CSSStyleDeclaration>);
  const mkBtn = (label: string, on: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, { flex: '1', cursor: 'pointer', fontFamily: FONT_UI, fontSize: '11px', padding: '4px 0', background: THEME.raised, color: THEME.text, border: `1px solid ${THEME.rule}`, borderRadius: '2px' } as Partial<CSSStyleDeclaration>);
    b.onclick = (e) => { e.stopPropagation(); on(); refresh(); updateBar(); };
    return b;
  };
  bar.appendChild(mkBtn('★', () => { rejects.delete(run.id); selections.has(run.id) ? selections.delete(run.id) : selections.add(run.id); }));
  bar.appendChild(mkBtn('✕', () => { selections.delete(run.id); rejects.has(run.id) ? rejects.delete(run.id) : rejects.add(run.id); }));
  bar.appendChild(mkBtn('✎', () => openDraw(run, () => { (im as HTMLImageElement).style.outline = `2px solid ${THEME.blood}`; })));
  card.appendChild(bar);

  refresh();
  return card;
}

function row(): HTMLElement {
  const r = document.createElement('div');
  Object.assign(r.style, { display: 'flex', gap: '12px', overflowX: 'auto', padding: '4px 24px 14px', justifyContent: 'flex-start' } as Partial<CSSStyleDeclaration>);
  return r;
}

// ── frame cutout: flood-fill the flat-black centre to transparent ───────────
// Preserves every intricate inner cusp (the fill stops at the lit ornate edge),
// so the frame can OVERLAY the art instead of sitting behind a hard rectangle.
interface Window01 { x0: number; y0: number; x1: number; y1: number }
function frameOverlay(src: string, onReady: (c: HTMLCanvasElement, win: Window01) => void, threshold = 48) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const seen = new Uint8Array(w * h);
    const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let minX = w, maxX = 0, minY = h, maxY = 0;  // bounds of the cut window
    const stack = [(Math.floor(h / 2) * w + Math.floor(w / 2))];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue; seen[p] = 1;
      const i = p * 4;
      if (lum(i) >= threshold) continue;  // hit the ornate edge — stop
      px[i + 3] = 0;                        // dark cavity → transparent
      const x = p % w, y = (p - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    ctx.putImageData(data, 0, 0);
    const win: Window01 = maxX > minX
      ? { x0: minX / w, y0: minY / h, x1: (maxX + 1) / w, y1: (maxY + 1) / h }
      : { x0: 0, y0: 0, x1: 1, y1: 1 };
    onReady(cv, win);
  };
  img.src = src;
}

// ── the composited card: art INLAID into the frame's window, frame overlapping.
// The window bounds come from the cutout above; we inflate the art a touch so
// the frame's ornate inner edge overlaps it (no seam).
const TAROT_ASPECT = 1312 / 768;
function spreadCard(run: ArtRun, frame: ArtRun | null): HTMLElement {
  const W = 236, H = Math.round(W * (frame ? frame.height / frame.width : TAROT_ASPECT));
  const card = document.createElement('div');
  Object.assign(card.style, { position: 'relative', width: `${W}px`, height: `${H}px`, boxShadow: THEME.shadow, overflow: 'hidden', background: '#000' } as Partial<CSSStyleDeclaration>);

  const art = pic(imgURL(run.file), W, H, `${run.subject} not promoted`);
  Object.assign(art.style, { position: 'absolute', inset: '0', zIndex: '0' } as Partial<CSSStyleDeclaration>);
  card.appendChild(art);

  const spec = CARD_ART.find((c) => c.id === run.subject);
  const scrim = document.createElement('div');
  Object.assign(scrim.style, { position: 'absolute', left: '14%', right: '14%', bottom: '6%', zIndex: '2', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '20px', background: `linear-gradient(transparent, ${THEME.void} 80%)`, pointerEvents: 'none' } as Partial<CSSStyleDeclaration>);
  scrim.appendChild(displayHeading(spec?.name ?? run.subject, { size: 13, glow: true }));
  card.appendChild(scrim);

  if (frame) {
    frameOverlay(imgURL(frame.file), (cv, win) => {
      const mX = 0.06 * W, mY = 0.06 * H;  // margin: art shrinks INSIDE the window, centred (black mat shows)
      Object.assign(art.style, {
        inset: 'auto',
        left: `${win.x0 * W + mX}px`, top: `${win.y0 * H + mY}px`,
        width: `${(win.x1 - win.x0) * W - 2 * mX}px`, height: `${(win.y1 - win.y0) * H - 2 * mY}px`,
      } as Partial<CSSStyleDeclaration>);
      Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '1', pointerEvents: 'none' } as Partial<CSSStyleDeclaration>);
      card.appendChild(cv);
      // anchor the title inside the window's lower edge
      Object.assign(scrim.style, { left: `${win.x0 * W}px`, right: `${(1 - win.x1) * W}px`, bottom: `${(1 - win.y1) * H + 4}px` } as Partial<CSSStyleDeclaration>);
    });
  }
  return card;
}

// ── draw modal ───────────────────────────────────────────────────────────────
function openDraw(run: ArtRun, onSaved: () => void) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '1000', background: 'rgba(0,0,0,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px' } as Partial<CSSStyleDeclaration>);

  const img = new Image(); img.crossOrigin = 'anonymous';
  const holder = document.createElement('div');
  holder.style.position = 'relative';
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'absolute', inset: '0', cursor: 'crosshair', touchAction: 'none' } as Partial<CSSStyleDeclaration>);
  let ctx: CanvasRenderingContext2D;

  img.onload = () => {
    const scale = Math.min(620 / img.naturalWidth, (window.innerHeight - 160) / img.naturalHeight, 1);
    const dw = Math.round(img.naturalWidth * scale), dh = Math.round(img.naturalHeight * scale);
    cv.width = dw; cv.height = dh; cv.style.width = `${dw}px`; cv.style.height = `${dh}px`;
    const base = document.createElement('img');
    base.src = img.src; Object.assign(base.style, { width: `${dw}px`, height: `${dh}px`, display: 'block' } as Partial<CSSStyleDeclaration>);
    holder.appendChild(base); holder.appendChild(cv);
    ctx = cv.getContext('2d')!;
    ctx.strokeStyle = 'rgba(220,40,40,0.95)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  };
  img.src = imgURL(run.file);

  let drawing = false;
  const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  cv.addEventListener('pointerdown', (e) => { drawing = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
  cv.addEventListener('pointerup', () => { drawing = false; });

  const bar = document.createElement('div');
  Object.assign(bar.style, { display: 'flex', gap: '10px' } as Partial<CSSStyleDeclaration>);
  const btn = (label: string, primary: boolean, on: () => void) => {
    const b = document.createElement('button'); b.textContent = label;
    Object.assign(b.style, { cursor: 'pointer', fontFamily: FONT_UI, fontSize: '13px', padding: '8px 18px', borderRadius: '3px', background: primary ? THEME.ember : THEME.raised, color: primary ? '#1a0f06' : THEME.text, border: `1px solid ${THEME.rule}` } as Partial<CSSStyleDeclaration>);
    b.onclick = on; return b;
  };
  bar.appendChild(caption(`drawing on ${run.id} — mark what to change`, THEME.dim, 11));
  const close = () => overlay.remove();
  bar.appendChild(btn('Clear', false, () => ctx.clearRect(0, 0, cv.width, cv.height)));
  bar.appendChild(btn('Cancel', false, close));
  bar.appendChild(btn('Save mark', true, () => {
    // composite base + strokes so Claude sees the drawing ON the image
    const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
    const o = out.getContext('2d')!;
    o.drawImage(img, 0, 0, cv.width, cv.height);
    o.drawImage(cv, 0, 0);
    drawings.set(run.id, out.toDataURL('image/png'));
    selections.add(run.id); // a drawn-on run is implicitly "this direction"
    onSaved(); updateBar(); close();
  }));

  overlay.appendChild(holder);
  overlay.appendChild(bar);
  document.body.appendChild(overlay);
}

// ── submit bar (sticky footer) ──────────────────────────────────────────────
let noteEl: HTMLTextAreaElement;
let statusEl: HTMLElement;
function updateBar() {
  statusEl.textContent = `★ ${selections.size}   ✕ ${rejects.size}   ✎ ${drawings.size}`;
}
function submitBar() {
  const bar = document.createElement('div');
  Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '900', display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 20px', background: THEME.panel, borderTop: `1px solid ${THEME.ruleStrong}`, boxShadow: '0 -10px 30px rgba(0,0,0,0.7)' } as Partial<CSSStyleDeclaration>);

  noteEl = document.createElement('textarea');
  noteEl.placeholder = 'note for Claude — what direction, what to change, what you liked…';
  Object.assign(noteEl.style, { flex: '1', height: '46px', resize: 'none', fontFamily: FONT_UI, fontSize: '13px', padding: '8px 10px', background: THEME.sunken, color: THEME.text, border: `1px solid ${THEME.rule}`, borderRadius: '3px' } as Partial<CSSStyleDeclaration>);
  bar.appendChild(noteEl);

  statusEl = caption('★ 0   ✕ 0   ✎ 0', THEME.dim, 12);
  statusEl.style.whiteSpace = 'nowrap';
  bar.appendChild(statusEl);

  const submit = document.createElement('button');
  submit.textContent = 'Submit ▸';
  Object.assign(submit.style, { cursor: 'pointer', fontFamily: FONT_UI, fontSize: '14px', fontWeight: '600', padding: '12px 24px', borderRadius: '3px', background: THEME.ember, color: '#1a0f06', border: 'none' } as Partial<CSSStyleDeclaration>);
  submit.onclick = async () => {
    submit.textContent = 'Submitting…'; submit.disabled = true;
    try {
      const res = await fetch('/__art/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          note: noteEl.value,
          selections: [...selections], rejects: [...rejects],
          drawings: [...drawings].map(([runId, dataUrl]) => ({ runId, dataUrl })),
        }),
      });
      const j = await res.json();
      submit.textContent = j.ok ? '✓ Sent to Claude' : 'Failed';
      if (j.ok) { selections.clear(); rejects.clear(); drawings.clear(); noteEl.value = ''; setTimeout(() => render(), 900); }
    } catch {
      submit.textContent = 'No dev server';
    }
    setTimeout(() => { submit.textContent = 'Submit ▸'; submit.disabled = false; updateBar(); }, 1400);
  };
  bar.appendChild(submit);
  document.body.appendChild(bar);
}

// ── render ──────────────────────────────────────────────────────────────────
let manifest: ArtManifest;
function render() {
  document.querySelectorAll('[data-art-body]').forEach((n) => n.remove());
  const body = document.createElement('div');
  body.setAttribute('data-art-body', '');
  body.style.paddingTop = '24px';

  const head = document.createElement('div'); head.style.textAlign = 'center';
  const h = displayHeading('The Spread — Atelier', { size: 26, glow: true }); h.style.textAlign = 'center';
  head.appendChild(h);
  head.appendChild(caption(`${manifest.runs.length} runs · star a direction, draw on what to change, submit`, THEME.faint, 11));
  body.appendChild(head);

  // composited spread (promoted art + active frame, cutout overlay)
  const frame = manifest.activeFrame ? manifest.runs.find((r) => r.id === manifest.activeFrame) ?? null : null;
  body.appendChild(sectionHead('The Spread'));
  const spread = row(); spread.style.justifyContent = 'center';
  for (const c of CARD_ART) {
    const pr = manifest.promoted[c.id];
    const run = pr ? manifest.runs.find((r) => r.id === pr) : undefined;
    if (run) spread.appendChild(spreadCard(run, frame));
  }
  body.appendChild(spread);

  // per-card iteration rows (every run, never swallowed)
  for (const c of CARD_ART) {
    const runs = runsFor(manifest, c.id);
    if (!runs.length) continue;
    body.appendChild(sectionHead(c.name));
    const r = row();
    for (const run of runs) r.appendChild(tile(run, manifest));
    body.appendChild(r);
  }

  // frame candidates
  const frames = manifest.runs.filter((r) => r.kind === 'frame');
  if (frames.length) {
    body.appendChild(sectionHead('Frames'));
    const r = row();
    for (const run of frames) r.appendChild(tile(run, manifest));
    body.appendChild(r);
  }

  root.appendChild(body);
  updateBar();
}

async function main() {
  submitBar();
  try {
    const res = await fetch(`${BASE}art/runs/index.json`, { cache: 'no-store' });
    manifest = res.ok ? await res.json() : { runs: [], promoted: {}, activeFrame: null };
  } catch {
    manifest = { runs: [], promoted: {}, activeFrame: null };
  }
  render();
}
main();
