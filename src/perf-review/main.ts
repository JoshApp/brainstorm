// Perf COCKPIT — the offline reviewer for recordings made by the in-game
// session recorder (src/debug/perf-recorder.ts). The "scrub the timeline, find
// where the frame went" half of the loop.
//
// Where the old viewer was one cramped canvas, this is a stack of SYNCHRONIZED
// LANES on a shared, zoomable time axis — the Unity/Unreal-profiler shape:
//
//   • CPU/frame   — per-system cost stacked, dt + gpu lines, 60/30 budget guides
//   • GPU passes  — prepass/scene/bloom/blit stacked (the gph breakdown the old
//                   viewer threw away), or the gpu line where per-pass is absent
//   • Heap / GC   — heap fill + a tick on every GC frame
//   • Draws / res — draw count + geometry/texture/program lines (leak watch)
//   • Events      — flags where spawn/death/level… fired (the "why" beside a spike)
//
// One cursor crosses every lane. CLICK pins a frame; ←/→ step it (Shift = jump
// to the next spike); the wheel zooms the time axis around the cursor and drag
// pans it. The pinned frame's full breakdown renders below as a HIERARCHICAL
// flame (render → render·scene/bloom/blit), and the recording's own metadata
// (graphics settings, scene audit, fill resolution) is one click away — a
// recording self-documents the config it was taken under.
//
// Loads three ways: ?id=<id> (dev server), the picker (/__perf/list), or
// drag-and-drop a .json downloaded off a phone.
//
// Standalone tool — NO game imports, so the recording types are declared
// locally rather than dragging the whole engine into the reviewer bundle. Keep
// them in sync with perf-recorder.ts (RecFrame / Recording).

interface RecFrame {
  t: number; dt: number; cpu: number; gpu: number | null;
  draws: number; tris: number; heap: number | null; gc: boolean;
  geo: number; tex: number; prog: number;
  sys: number[];
  cam?: [number, number];
  gph?: number[];
  ev?: string[];
}
interface Recording {
  meta: {
    startedAt: string; durationMs: number; frameCount: number; targetMs: number;
    gpuSupported: boolean; ua: string; dpr: number; viewport: [number, number];
    renderScale?: number; pixelRatio?: number;
    graphics?: Record<string, unknown>;
    sceneAudit?: { total?: Record<string, number>; byKind?: Record<string, { meshes: number; instances: number }> } & Record<string, unknown>;
    label?: string;
  };
  systemNames: string[];
  gpuPhaseNames?: string[];
  frames: RecFrame[];
}

const app = document.getElementById('app') as HTMLDivElement;
const TARGET_DEFAULT = 1000 / 60;

// ── DOM scaffold ─────────────────────────────────────────────────────────
app.innerHTML = `
  <div id="bar" style="display:flex;align-items:center;gap:14px;padding:8px 14px;border-bottom:1px solid #1c2430;background:#0d121a;flex-wrap:wrap">
    <strong style="letter-spacing:.06em;color:#8fb8ff">DELVE · PERF COCKPIT</strong>
    <select id="picker" style="background:#121a26;color:#cdd9e8;border:1px solid #28384c;border-radius:5px;padding:4px 8px;font:inherit"></select>
    <button id="livebtn" style="background:#16202e;color:#9fb4cc;border:1px solid #2a5a3a;border-radius:5px;padding:4px 9px;font:inherit;cursor:pointer">● LIVE</button>
    <span id="summary" style="color:#9fb4cc;font-size:12px"></span>
    <button id="metabtn" style="background:#16202e;color:#9fb4cc;border:1px solid #28384c;border-radius:5px;padding:4px 9px;font:inherit;cursor:pointer">meta ▾</button>
    <span style="margin-left:auto;color:#5e7088;font-size:11px">drop a .json · wheel = zoom · drag = pan · click = pin · ←/→ step · ⇧ = spikes · F = fit</span>
  </div>
  <div id="meta" style="display:none;padding:8px 14px;border-bottom:1px solid #161d28;background:#0b0f16;font-size:11px;color:#9fb4cc;line-height:1.6"></div>
  <div id="legend" style="display:flex;flex-wrap:wrap;gap:5px 12px;padding:6px 14px;border-bottom:1px solid #161d28;font-size:11px;color:#9fb4cc"></div>
  <canvas id="tl" style="display:block;width:100%;flex:1;min-height:0;cursor:crosshair"></canvas>
  <div id="markers" style="display:flex;gap:6px;padding:6px 14px;border-top:1px solid #161d28;overflow-x:auto;white-space:nowrap"></div>
  <div id="frame" style="padding:8px 14px;border-top:1px solid #1c2430;background:#0d121a;min-height:160px;max-height:36vh;overflow:auto;font-size:12px"></div>
`;

const picker = document.getElementById('picker') as HTMLSelectElement;
const summaryEl = document.getElementById('summary') as HTMLSpanElement;
const metaBtn = document.getElementById('metabtn') as HTMLButtonElement;
const metaEl = document.getElementById('meta') as HTMLDivElement;
const legendEl = document.getElementById('legend') as HTMLDivElement;
const canvas = document.getElementById('tl') as HTMLCanvasElement;
const markersEl = document.getElementById('markers') as HTMLDivElement;
const frameEl = document.getElementById('frame') as HTMLDivElement;
const g = canvas.getContext('2d')!;

let rec: Recording | null = null;
let targetMs = TARGET_DEFAULT;
let topSystems: number[] = [];        // indices into systemNames, by total cost desc
let leaves = new Set<number>();       // stackable systems = leaves; a parent like
                                      // 'render' is excluded once 'render·scene' etc.
                                      // exist, so the stack sums leaves only.
let hoverFrame = -1;
let pinnedFrame = -1;
// Zoomable view window over frame indices [lo, hi). Reset to full on load.
let viewLo = 0;
let viewHi = 1;

function activeFrame(): number { return pinnedFrame >= 0 ? pinnedFrame : hoverFrame; }
function hue(i: number): number { return (i * 47 + 13) % 360; }
function sysColor(idx: number, a = 1): string {
  const rank = topSystems.indexOf(idx);
  if (rank < 0) return `rgba(90,100,115,${a})`;   // "other"
  return `hsla(${hue(rank)},65%,60%,${a})`;
}
const PHASE_COLORS = ['#ff82dc', '#ffb454', '#5ad6ff', '#8fe0a0', '#c98bff', '#ff6a6a'];
function phaseColor(i: number, a = 1): string {
  const c = PHASE_COLORS[i % PHASE_COLORS.length];
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[i];
}

// ── Load ────────────────────────────────────────────────────────────────
async function loadList(): Promise<void> {
  try {
    const res = await fetch('/__perf/list');
    if (!res.ok) return;
    const list = (await res.json()) as Array<{ id: string; meta: Recording['meta'] }>;
    picker.innerHTML = '<option value="">— pick a recording —</option>' +
      list.map((r) => {
        const m = r.meta || ({} as Recording['meta']);
        const secs = m.durationMs ? (m.durationMs / 1000).toFixed(1) + 's' : '';
        return `<option value="${r.id}">${r.id} · ${secs}${m.label ? ' · ' + m.label : ''}</option>`;
      }).join('');
  } catch {
    picker.innerHTML = '<option value="">(no dev server — drop a .json)</option>';
  }
}

async function loadById(id: string): Promise<void> {
  const res = await fetch('/__perf/get?id=' + encodeURIComponent(id));
  if (!res.ok) return;
  setRecording((await res.json()) as Recording);
}

/** Rank systems by total cost (heaviest 8 → coloured; rest → "other") and mark
 *  leaves (parents like 'render' drop out once 'render·scene' etc. exist).
 *  Shared by file-load and the live stream. `window` caps the cost window so a
 *  long live session doesn't re-sum thousands of frames each tick. */
function computeRanking(window = Infinity): void {
  if (!rec) return;
  const names = rec.systemNames;
  const frames = window === Infinity ? rec.frames : rec.frames.slice(-window);
  const isParent = (i: number) => names.some((o, j) => j !== i && o.startsWith(names[i] + '·'));
  leaves = new Set(names.map((_, i) => i).filter((i) => !isParent(i)));
  const totals = names.map((_, i) => frames.reduce((s, f) => s + (f.sys[i] || 0), 0));
  topSystems = [...leaves].sort((a, b) => totals[b] - totals[a]).slice(0, 8);
}

function setRecording(r: Recording): void {
  stopLive();
  rec = r;
  targetMs = r.meta.targetMs || TARGET_DEFAULT;
  computeRanking();

  viewLo = 0;
  viewHi = Math.max(1, r.frames.length);
  pinnedFrame = -1;
  hoverFrame = worstFrameIndex();

  buildSummary();
  buildMeta();
  buildLegend();
  buildMarkers();
  resize();
  showFrame(activeFrame());
}

// ── Summary / meta / legend / markers ──────────────────────────────────────
function buildSummary(): void {
  if (!rec) return;
  const dts = rec.frames.map((f) => f.dt).filter((d) => d > 0).sort((a, b) => a - b);
  const over = rec.frames.filter((f) => f.dt > targetMs * 1.5).length;
  const fps = dts.length ? (1000 / (dts.reduce((a, b) => a + b, 0) / dts.length)) : 0;
  summaryEl.innerHTML =
    `${rec.meta.frameCount} frames · ${(rec.meta.durationMs / 1000).toFixed(1)}s · ` +
    `<b>${fps.toFixed(0)} fps avg</b> · ` +
    `med ${quantile(dts, 0.5).toFixed(1)} · p95 ${quantile(dts, 0.95).toFixed(1)} · p99 ${quantile(dts, 0.99).toFixed(1)}ms · ` +
    `<span style="color:${over ? '#ff8a8a' : '#8fe0a0'}">${over} dropped (${((over / rec.frames.length) * 100).toFixed(1)}%)</span> · ` +
    `gpu ${rec.meta.gpuSupported ? 'on' : 'n/a'}`;
}

function buildMeta(): void {
  if (!rec) return;
  const m = rec.meta;
  const fillW = m.viewport ? Math.round(m.viewport[0] * (m.pixelRatio ?? m.dpr) * (m.renderScale ?? 1)) : 0;
  const fillH = m.viewport ? Math.round(m.viewport[1] * (m.pixelRatio ?? m.dpr) * (m.renderScale ?? 1)) : 0;
  const rows: string[] = [];
  rows.push(`<b style="color:#8fb8ff">device</b> ${m.viewport?.[0]}×${m.viewport?.[1]} css · dpr ${m.dpr}` +
    (m.pixelRatio != null ? ` · cap ${m.pixelRatio}` : '') +
    (m.renderScale != null ? ` · renderScale ${m.renderScale}` : '') +
    (fillW ? ` · <span style="color:#ffb454">fill ≈ ${fillW}×${fillH}</span>` : ''));
  if (m.ua) rows.push(`<b style="color:#8fb8ff">ua</b> <span style="color:#7a8aa0">${escapeHtml(m.ua)}</span>`);
  if (m.graphics) {
    const gfx = Object.entries(m.graphics)
      .map(([k, v]) => `${k}=<span style="color:#cdd9e8">${escapeHtml(String(v))}</span>`).join(' · ');
    rows.push(`<b style="color:#8fb8ff">graphics</b> ${gfx}`);
  }
  const sa = m.sceneAudit;
  if (sa && sa.byKind) {
    const kinds = Object.entries(sa.byKind)
      .sort((a, b) => (b[1].meshes) - (a[1].meshes)).slice(0, 12)
      .map(([k, v]) => `${k} <span style="color:#cdd9e8">${v.meshes}</span>${v.instances ? `+${v.instances}i` : ''}`).join(' · ');
    rows.push(`<b style="color:#8fb8ff">scene</b> ${kinds}`);
  }
  metaEl.innerHTML = rows.join('<br>');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function buildLegend(): void {
  if (!rec) return;
  const phases = rec.gpuPhaseNames ?? [];
  legendEl.innerHTML =
    topSystems.map((idx) =>
      `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${sysColor(idx)}"></span>${rec!.systemNames[idx]}</span>`).join('') +
    `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${sysColor(-1)}"></span>other</span>` +
    `<span style="color:#dfe8f5;margin-left:6px">— frame(dt)</span>` +
    (phases.length
      ? `<span style="margin-left:10px;color:#7a8aa0">gpu:</span>` + phases.map((p, i) =>
          `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${phaseColor(i)}"></span>${p.replace('render·', '')}</span>`).join('')
      : `<span style="margin-left:10px;color:#ff82dc">— gpu</span>`);
}

function worstFrameIndex(): number {
  if (!rec || !rec.frames.length) return -1;
  let wi = 0, wv = -1;
  for (let i = 0; i < rec.frames.length; i++) if (rec.frames[i].dt > wv) { wv = rec.frames[i].dt; wi = i; }
  return wi;
}

/** The N worst frames, de-clustered (skip ones within 10 frames of a pick). */
function spikeFrames(): number[] {
  if (!rec) return [];
  const order = rec.frames.map((f, i) => [i, f.dt] as [number, number]).sort((a, b) => b[1] - a[1]);
  const picked: number[] = [];
  for (const [i] of order) {
    if (picked.length >= 8) break;
    if (picked.some((p) => Math.abs(p - i) < 10)) continue;
    if (rec.frames[i].dt <= targetMs * 1.5) break;
    picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

function buildMarkers(): void {
  if (!rec) return;
  const picked = spikeFrames();
  markersEl.innerHTML = picked.length
    ? '<span style="color:#7a8aa0;align-self:center;margin-right:4px">spikes:</span>' + picked.map((i) =>
        `<button data-f="${i}" style="background:#2a1418;color:#ffb0b0;border:1px solid #5a2a2a;border-radius:5px;padding:3px 8px;font:inherit;cursor:pointer">${(rec!.frames[i].t / 1000).toFixed(1)}s · ${rec!.frames[i].dt.toFixed(0)}ms</button>`).join('')
    : '<span style="color:#6a8a6a;align-self:center">no dropped frames over 1.5× budget — clean run</span>';
  markersEl.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => pinFrame(Number((b as HTMLButtonElement).dataset.f), true)));
}

// ── View / coordinate helpers ──────────────────────────────────────────────
function viewSpan(): number { return Math.max(1, viewHi - viewLo); }
function frameAtX(px: number, W: number): number {
  return Math.round(viewLo + (px / Math.max(1, W)) * viewSpan());
}
function clampView(): void {
  if (!rec) return;
  const n = rec.frames.length;
  if (followLive && isLive()) {
    // Live: a FIXED-width window anchored to the newest frame. While the buffer
    // is still filling (n < LIVE_WINDOW) the window extends PAST the data — the
    // right side stays blank instead of stretching a few frames across the whole
    // width (which read as "weirdly zoomed in").
    viewLo = Math.max(0, n - LIVE_WINDOW);
    viewHi = viewLo + LIVE_WINDOW;
    return;
  }
  const span = Math.min(n, Math.max(8, viewHi - viewLo));   // never zoom past 8 frames
  if (viewLo < 0) viewLo = 0;
  viewHi = viewLo + span;
  if (viewHi > n) { viewHi = n; viewLo = Math.max(0, n - span); }
}

// ── Lanes ───────────────────────────────────────────────────────────────
interface Lane { key: string; weight: number; label: string; }
const LANES: Lane[] = [
  { key: 'cpu', weight: 3.2, label: 'CPU · ms/frame' },
  { key: 'gpu', weight: 1.8, label: 'GPU · passes' },
  { key: 'mem', weight: 1.1, label: 'heap · GC' },
  { key: 'count', weight: 1.1, label: 'draws · geo/tex/prog' },
  { key: 'event', weight: 0.5, label: 'events' },
];

interface Rect { x: number; y: number; w: number; h: number; }
function laneRects(W: number, H: number): Map<string, Rect> {
  const gap = 6;
  const usable = H - gap * (LANES.length - 1);
  const totalW = LANES.reduce((s, l) => s + l.weight, 0);
  const out = new Map<string, Rect>();
  let y = 0;
  for (const l of LANES) {
    const h = Math.floor((l.weight / totalW) * usable);
    out.set(l.key, { x: 0, y, w: W, h });
    y += h + gap;
  }
  return out;
}

// Logical (CSS-pixel) canvas size. The backing store is this × devicePixelRatio
// so lines stay crisp on hi-DPI displays; the context is pre-scaled by DPR, so
// all drawing below works in CSS pixels (W/H = cssW/cssH, not canvas.width).
let cssW = 1;
let cssH = 1;
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  cssW = Math.max(1, Math.floor(r.width));
  cssH = Math.max(1, Math.floor(r.height));
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw(): void {
  if (!rec) return;
  const W = cssW, H = cssH;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a0d13';
  g.fillRect(0, 0, W, H);

  const frames = rec.frames;
  const n = frames.length;
  if (!n) return;
  clampView();

  // Per-column worst-frame bucketing within the current view — spikes never
  // hide under downsampling because each column keeps its highest-dt frame.
  // Columns PAST the data (live window wider than the buffer) hold the last real
  // frame so no lane ever indexes off the end; we clip them away below so the
  // right stays blank rather than smearing the last frame.
  const span = viewSpan();
  const colFrame: number[] = new Array(W);
  let maxCol = -1;
  let lastValid = 0;
  for (let x = 0; x < W; x++) {
    const a = Math.floor(viewLo + (x / W) * span);
    if (a >= n) { colFrame[x] = lastValid; continue; }
    const b = Math.max(a + 1, Math.floor(viewLo + ((x + 1) / W) * span));
    let wi = a, wv = -1;
    for (let i = a; i < b && i < n; i++) if (frames[i].dt > wv) { wv = frames[i].dt; wi = i; }
    colFrame[x] = lastValid = Math.min(n - 1, Math.max(0, wi));
    maxCol = x;
  }

  const rects = laneRects(W, H);
  // Clip the data lanes to the filled region while the live buffer is still
  // growing; full recordings fill every column so this is a no-op for them.
  const clipped = maxCol >= 0 && maxCol < W - 1;
  if (clipped) { g.save(); g.beginPath(); g.rect(0, 0, maxCol + 1, H); g.clip(); }
  drawCpuLane(rects.get('cpu')!, colFrame);
  drawGpuLane(rects.get('gpu')!, colFrame);
  drawMemLane(rects.get('mem')!, colFrame);
  drawCountLane(rects.get('count')!, colFrame);
  drawEventLane(rects.get('event')!, colFrame);
  if (clipped) g.restore();

  // Lane labels.
  g.font = '10px monospace';
  for (const l of LANES) {
    const r = rects.get(l.key)!;
    g.fillStyle = 'rgba(120,140,165,0.55)';
    g.fillText(l.label, 4, r.y + 11);
  }

  // Shared cursor across every lane.
  const af = activeFrame();
  if (af >= 0 && af >= viewLo && af < viewHi) {
    const cx = Math.round(((af - viewLo) / span) * W) + 0.5;
    g.strokeStyle = pinnedFrame >= 0 ? 'rgba(255,220,120,0.85)' : 'rgba(255,255,255,0.45)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke();
  }
}

function laneBg(r: Rect): void {
  g.fillStyle = 'rgba(255,255,255,0.015)';
  g.fillRect(r.x, r.y, r.w, r.h);
}

function drawCpuLane(r: Rect, colFrame: number[]): void {
  if (!rec) return;
  laneBg(r);
  const frames = rec.frames;
  // Y scale: p99.5 of dt/cpu/gpu across the WHOLE recording so zooming doesn't
  // rescale the axis underfoot; floor at 34ms so the 30fps line stays visible.
  const all: number[] = [];
  for (const f of frames) { all.push(f.dt, f.cpu); if (f.gpu) all.push(f.gpu); }
  all.sort((a, b) => a - b);
  const maxY = Math.max(34, quantile(all, 0.995) * 1.1);
  const y = (ms: number) => r.y + r.h - Math.min(1, ms / maxY) * r.h;

  // Stacked per-system CPU bands (heaviest at the bottom).
  for (let x = 0; x < r.w; x++) {
    const f = frames[colFrame[x]];
    let acc = 0;
    let otherSum = 0;
    for (let i = 0; i < f.sys.length; i++) if (leaves.has(i) && topSystems.indexOf(i) < 0) otherSum += f.sys[i];
    for (const idx of topSystems) {
      const v = f.sys[idx] || 0;
      if (v <= 0) continue;
      const y0 = y(acc), y1 = y(acc + v);
      g.fillStyle = sysColor(idx, 0.85);
      g.fillRect(r.x + x, y1, 1, y0 - y1);
      acc += v;
    }
    if (otherSum > 0) {
      const y0 = y(acc), y1 = y(acc + otherSum);
      g.fillStyle = sysColor(-1, 0.7);
      g.fillRect(r.x + x, y1, 1, y0 - y1);
    }
  }

  // Budget guides.
  for (const [ms, col, label] of [[targetMs, 'rgba(140,240,160,0.5)', '60'], [targetMs * 2, 'rgba(255,210,130,0.45)', '30']] as const) {
    if (ms > maxY) continue;
    const gy = y(ms);
    g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(r.x, gy); g.lineTo(r.x + r.w, gy); g.stroke();
    g.setLineDash([]);
    g.fillStyle = col; g.font = '10px monospace';
    g.fillText(`${label}fps`, r.x + r.w - 28, gy - 3);
  }

  // GPU + frame-interval lines.
  drawLine(r, colFrame, (f) => f.gpu, 'rgba(255,130,220,0.85)', y);
  drawLine(r, colFrame, (f) => f.dt, 'rgba(220,232,245,0.9)', y);

  // Dropped-frame ticks along the top edge.
  g.fillStyle = '#ff4040';
  for (let x = 0; x < r.w; x++) if (frames[colFrame[x]].dt > targetMs * 1.5) g.fillRect(r.x + x, r.y, 1, 3);
}

function drawGpuLane(r: Rect, colFrame: number[]): void {
  if (!rec) return;
  laneBg(r);
  const frames = rec.frames;
  const phases = rec.gpuPhaseNames;
  const hasGph = !!phases && frames.some((f) => f.gph && f.gph.length);
  // Scale to p99 of the per-frame GPU total (sum of phases, or the gpu number).
  const totals: number[] = [];
  for (const f of frames) {
    if (hasGph && f.gph) totals.push(f.gph.reduce((a, b) => a + b, 0));
    else if (f.gpu != null) totals.push(f.gpu);
  }
  totals.sort((a, b) => a - b);
  const maxY = Math.max(8, quantile(totals, 0.99) * 1.15);
  const y = (ms: number) => r.y + r.h - Math.min(1, ms / maxY) * r.h;

  if (hasGph && phases) {
    for (let x = 0; x < r.w; x++) {
      const f = frames[colFrame[x]];
      if (!f.gph) continue;
      let acc = 0;
      for (let i = 0; i < f.gph.length; i++) {
        const v = f.gph[i] || 0;
        if (v <= 0) continue;
        const y0 = y(acc), y1 = y(acc + v);
        g.fillStyle = phaseColor(i, 0.85);
        g.fillRect(r.x + x, y1, 1, y0 - y1);
        acc += v;
      }
    }
  } else {
    drawLine(r, colFrame, (f) => f.gpu, 'rgba(255,130,220,0.9)', y, true);
  }
  // 8ms / 16ms guides (half / full frame of a 60fps GPU budget).
  for (const ms of [8, 16]) {
    if (ms > maxY) continue;
    const gy = y(ms);
    g.strokeStyle = 'rgba(120,140,165,0.25)'; g.lineWidth = 1; g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(r.x, gy); g.lineTo(r.x + r.w, gy); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(120,140,165,0.5)'; g.font = '9px monospace';
    g.fillText(`${ms}ms`, r.x + r.w - 26, gy - 2);
  }
}

function drawMemLane(r: Rect, colFrame: number[]): void {
  if (!rec) return;
  laneBg(r);
  const frames = rec.frames;
  const heaps = frames.map((f) => f.heap).filter((h): h is number => h != null);
  if (!heaps.length) {
    g.fillStyle = 'rgba(120,140,165,0.4)'; g.font = '10px monospace';
    g.fillText('no heap data (performance.memory unavailable)', r.x + 60, r.y + r.h / 2);
    return;
  }
  const lo = Math.min(...heaps), hi = Math.max(...heaps);
  const span = Math.max(1, hi - lo);
  const y = (mb: number) => r.y + r.h - ((mb - lo) / span) * r.h;
  // Heap fill.
  g.beginPath(); g.moveTo(r.x, r.y + r.h);
  for (let x = 0; x < r.w; x++) {
    const h = frames[colFrame[x]].heap;
    g.lineTo(r.x + x, h != null ? y(h) : r.y + r.h);
  }
  g.lineTo(r.x + r.w, r.y + r.h); g.closePath();
  g.fillStyle = 'rgba(110,170,255,0.18)'; g.fill();
  g.strokeStyle = 'rgba(130,185,255,0.7)'; g.lineWidth = 1;
  g.beginPath();
  let started = false;
  for (let x = 0; x < r.w; x++) {
    const h = frames[colFrame[x]].heap;
    if (h == null) { started = false; continue; }
    if (!started) { g.moveTo(r.x + x, y(h)); started = true; } else g.lineTo(r.x + x, y(h));
  }
  g.stroke();
  // GC ticks.
  g.fillStyle = 'rgba(255,170,90,0.9)';
  for (let x = 0; x < r.w; x++) if (frames[colFrame[x]].gc) g.fillRect(r.x + x, r.y + r.h - 5, 1, 5);
  g.fillStyle = 'rgba(120,140,165,0.55)'; g.font = '9px monospace';
  g.fillText(`${Math.round(hi)}MB`, r.x + r.w - 36, r.y + 9);
  g.fillText(`${Math.round(lo)}MB`, r.x + r.w - 36, r.y + r.h - 2);
}

function drawCountLane(r: Rect, colFrame: number[]): void {
  if (!rec) return;
  laneBg(r);
  const frames = rec.frames;
  const maxDraws = Math.max(1, ...frames.map((f) => f.draws));
  const yD = (d: number) => r.y + r.h - (d / maxDraws) * r.h;
  // Draws fill.
  g.beginPath(); g.moveTo(r.x, r.y + r.h);
  for (let x = 0; x < r.w; x++) g.lineTo(r.x + x, yD(frames[colFrame[x]].draws));
  g.lineTo(r.x + r.w, r.y + r.h); g.closePath();
  g.fillStyle = 'rgba(150,200,170,0.16)'; g.fill();
  drawLineRaw(r, colFrame, (f) => f.draws, maxDraws, 'rgba(150,220,180,0.85)');
  // Leak-watch lines: geo / tex / prog, each normalized to its own max so a
  // CLIMB is visible regardless of absolute count.
  const series: [keyof RecFrame, string][] = [['geo', 'rgba(120,180,255,0.7)'], ['tex', 'rgba(255,200,120,0.7)'], ['prog', 'rgba(220,140,255,0.7)']];
  for (const [k, col] of series) {
    const max = Math.max(1, ...frames.map((f) => (f[k] as number) || 0));
    drawLineRaw(r, colFrame, (f) => (f[k] as number) || 0, max, col);
  }
  g.fillStyle = 'rgba(120,140,165,0.55)'; g.font = '9px monospace';
  g.fillText(`${maxDraws} draws max`, r.x + r.w - 88, r.y + 9);
}

function drawEventLane(r: Rect, colFrame: number[]): void {
  if (!rec) return;
  laneBg(r);
  const frames = rec.frames;
  g.font = '9px monospace';
  const placed: number[] = [];     // x positions already labelled, to avoid overlap
  for (let x = 0; x < r.w; x++) {
    const f = frames[colFrame[x]];
    if (!f.ev || !f.ev.length) continue;
    g.strokeStyle = 'rgba(255,200,90,0.8)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(r.x + x + 0.5, r.y); g.lineTo(r.x + x + 0.5, r.y + r.h); g.stroke();
    if (placed.every((p) => Math.abs(p - x) > 46)) {
      placed.push(x);
      g.fillStyle = 'rgba(255,220,150,0.95)';
      const label = f.ev.join(',');
      g.fillText(label.length > 22 ? label.slice(0, 21) + '…' : label, Math.min(r.x + x + 3, r.x + r.w - 120), r.y + r.h - 3);
    }
  }
  if (!placed.length) {
    g.fillStyle = 'rgba(120,140,165,0.4)';
    g.fillText('no tagged events in view', r.x + 60, r.y + r.h / 2 + 3);
  }
}

function drawLine(r: Rect, colFrame: number[], pick: (f: RecFrame) => number | null, color: string, y: (ms: number) => number, thick = false): void {
  if (!rec) return;
  g.strokeStyle = color; g.lineWidth = thick ? 1.4 : 1; g.beginPath();
  let started = false;
  for (let x = 0; x < r.w; x++) {
    const v = pick(rec.frames[colFrame[x]]);
    if (v == null) { started = false; continue; }
    const py = y(v);
    if (!started) { g.moveTo(r.x + x, py); started = true; } else g.lineTo(r.x + x, py);
  }
  g.stroke();
}

function drawLineRaw(r: Rect, colFrame: number[], pick: (f: RecFrame) => number, max: number, color: string): void {
  drawLine(r, colFrame, (f) => pick(f), color, (v) => r.y + r.h - (v / max) * r.h);
}

// ── Pinned/hovered-frame breakdown (hierarchical flame) ─────────────────────
function showFrame(i: number): void {
  if (!rec || i < 0 || i >= rec.frames.length) { frameEl.innerHTML = ''; return; }
  const f = rec.frames[i];
  const dropped = f.dt > targetMs * 1.5;
  const pinTag = pinnedFrame === i ? ' <span style="color:#ffd27a">📌 pinned</span>' : '';

  // Group system rows hierarchically by the 'parent·child' convention so the
  // single-frame view reads as a flame (render → render·scene/bloom/blit), not
  // a flat list. Parent ms is its own measured total; children sit beneath it.
  const names = rec.systemNames;
  const ms = (idx: number) => f.sys[idx] || 0;
  const childrenOf = new Map<string, number[]>();
  const roots: number[] = [];
  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    const dot = name.indexOf('·');
    if (dot < 0) { roots.push(idx); continue; }   // every top-level system is a root
    const parent = name.slice(0, dot);
    const arr = childrenOf.get(parent) ?? [];
    arr.push(idx);
    childrenOf.set(parent, arr);
  }
  // Only treat a root as a "parent" if it actually has children present.
  const isParentName = (idx: number) => childrenOf.has(names[idx]);
  const rootList = roots.filter((idx) => ms(idx) > 0.01 || isParentName(idx))
    .sort((a, b) => ms(b) - ms(a));
  const maxMs = Math.max(0.01, ...rootList.map(ms));

  const bar = (idx: number, indent: number): string => {
    const v = ms(idx);
    const w = Math.max(2, Math.round((v / maxMs) * 240));
    const col = sysColor(topSystems.indexOf(idx) >= 0 ? idx : -1, 0.8);
    const name = names[idx];
    const childIds = (childrenOf.get(name) ?? []).filter((c) => ms(c) > 0.005).sort((a, b) => ms(b) - ms(a));
    let html = `<div style="display:flex;align-items:center;gap:8px;height:15px">` +
      `<span style="width:${150 - indent}px;margin-left:${indent}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${indent ? '└ ' : ''}${name.includes('·') ? name.slice(name.indexOf('·') + 1) : name}</span>` +
      `<span style="width:46px;text-align:right;color:${v > 4 ? '#ffb070' : '#9fb4cc'}">${v.toFixed(2)}</span>` +
      `<span style="width:${w}px;height:8px;background:${col};border-radius:2px"></span></div>`;
    for (const c of childIds) html += bar(c, indent + 14);
    return html;
  };

  const cam = f.cam ? ` · look yaw ${(f.cam[0]).toFixed(2)} pitch ${(f.cam[1]).toFixed(2)}` : '';
  const evTag = f.ev && f.ev.length ? `<span style="color:#ffd27a">⚑ ${escapeHtml(f.ev.join(', '))}</span>` : '';
  const gphTag = f.gph && rec.gpuPhaseNames
    ? rec.gpuPhaseNames.map((p, k) => `${p.replace('render·', '')} ${(f.gph![k] || 0).toFixed(2)}`).join(' · ')
    : '';

  frameEl.innerHTML =
    `<div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px;align-items:center">` +
      `<b style="color:#8fb8ff">frame ${i} · ${(f.t / 1000).toFixed(2)}s</b>${pinTag}` +
      `<span style="color:${dropped ? '#ff8a8a' : '#cdd9e8'}">dt ${f.dt.toFixed(1)}ms (${(1000 / f.dt).toFixed(0)}fps)${dropped ? ' ⚠ DROPPED' : ''}</span>` +
      `<span>cpu ${f.cpu.toFixed(1)}ms</span>` +
      `<span style="color:#ff82dc">gpu ${f.gpu != null ? f.gpu.toFixed(1) + 'ms' : 'n/a'}</span>` +
      `<span style="color:#9fb4cc">wait ${Math.max(0, f.dt - f.cpu).toFixed(1)}ms</span>` +
      `<span>${f.draws} draws · ${(f.tris / 1000).toFixed(0)}k tris</span>` +
      `<span>geo ${f.geo} · tex ${f.tex} · prog ${f.prog}</span>` +
      `<span>heap ${f.heap ?? '—'}MB${f.gc ? ' · GC' : ''}</span>` +
      `<span style="color:#7a8aa0">${cam.slice(3)}</span>` +
      evTag +
    `</div>` +
    (gphTag ? `<div style="color:#c98bff;font-size:11px;margin-bottom:6px">gpu passes · ${gphTag}</div>` : '') +
    rootList.map((idx) => bar(idx, 0)).join('');
}

// ── Interaction ───────────────────────────────────────────────────────────
function pinFrame(i: number, recenter = false): void {
  if (!rec) return;
  pinnedFrame = Math.min(rec.frames.length - 1, Math.max(0, i));
  if (recenter && (pinnedFrame < viewLo || pinnedFrame >= viewHi)) {
    const span = viewSpan();
    viewLo = Math.max(0, pinnedFrame - Math.floor(span / 2));
    viewHi = viewLo + span;
    clampView();
  }
  draw();
  showFrame(pinnedFrame);
}

let dragStartX = -1;
let dragViewLo = 0;
let dragged = false;

canvas.addEventListener('mousedown', (e) => {
  dragStartX = e.clientX;
  dragViewLo = viewLo;
  dragged = false;
});
window.addEventListener('mouseup', (e) => {
  if (dragStartX >= 0 && !dragged && rec) {
    // A click (not a drag): pin the frame under the cursor.
    const r = canvas.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right) {
      const fi = frameAtX(e.clientX - r.left, cssW);
      pinnedFrame = pinnedFrame === fi ? -1 : fi;   // click the pinned frame again to unpin
      if (pinnedFrame >= 0) followLive = false;       // a pin freezes the live view to inspect
      draw();
      showFrame(activeFrame());
    }
  }
  dragStartX = -1;
});
canvas.addEventListener('mousemove', (e) => {
  if (!rec) return;
  const r = canvas.getBoundingClientRect();
  if (dragStartX >= 0) {
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 3) { dragged = true; followLive = false; }   // panning leaves the tail
    const span = viewSpan();
    viewLo = Math.round(dragViewLo - (dx / r.width) * span);
    clampView();
    draw();
    return;
  }
  hoverFrame = frameAtX(e.clientX - r.left, cssW);
  draw();
  if (pinnedFrame < 0) showFrame(hoverFrame);
});
canvas.addEventListener('wheel', (e) => {
  if (!rec) return;
  e.preventDefault();
  followLive = false;   // zooming into a region leaves the live tail
  const r = canvas.getBoundingClientRect();
  const anchor = frameAtX(e.clientX - r.left, cssW);   // zoom around the cursor
  const span = viewSpan();
  const factor = e.deltaY > 0 ? 1.25 : 0.8;
  const newSpan = Math.min(rec.frames.length, Math.max(8, Math.round(span * factor)));
  const frac = (anchor - viewLo) / span;
  viewLo = Math.round(anchor - frac * newSpan);
  viewHi = viewLo + newSpan;
  clampView();
  draw();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!rec) return;
  if (e.key === 'f' || e.key === 'F') {
    followLive = false; viewLo = 0; viewHi = rec.frames.length; draw(); return;
  }
  if (e.key === 'Escape') { pinnedFrame = -1; if (isLive()) followLive = true; draw(); showFrame(activeFrame()); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) {
      const spikes = spikeFrames();
      const cur = activeFrame();
      const next = dir > 0 ? spikes.find((s) => s > cur) : [...spikes].reverse().find((s) => s < cur);
      if (next != null) pinFrame(next, true);
    } else {
      pinFrame((pinnedFrame >= 0 ? pinnedFrame : hoverFrame) + dir, true);
    }
  }
});

// ── Detached LIVE mode ──────────────────────────────────────────────────────
// Connect to the game's BroadcastChannel (src/debug/perf-stream.ts), append
// each streamed frame to a rolling buffer, and follow the tail. The game tab
// pays only a postMessage per frame; ALL the drawing happens here, off its
// thread — the browser equivalent of Unity's detached profiler.
const liveBtn = document.getElementById('livebtn') as HTMLButtonElement;
const LIVE_CAP = 3600;                 // ~60s at 60fps, then the buffer slides
const LIVE_WINDOW = 600;               // default visible window while following (~10s)
type LiveMsg =
  | { t: 'schema'; names: string[]; gphNames: string[]; meta: Record<string, unknown> }
  | { t: 'frame'; f: RecFrame }
  | { t: 'hello' };

let liveChan: BroadcastChannel | null = null;
let followLive = true;                 // keep the view pinned to the newest frames
let liveDirty = false;
let liveRankCounter = 0;

function isLive(): boolean { return liveChan !== null; }

function startLive(): void {
  stopLive();
  rec = {
    meta: { startedAt: '', durationMs: 0, frameCount: 0, targetMs: TARGET_DEFAULT, gpuSupported: false, ua: '', dpr: 1, viewport: [0, 0] },
    systemNames: [], gpuPhaseNames: undefined, frames: [],
  };
  pinnedFrame = -1;
  followLive = true;
  viewLo = 0;
  viewHi = LIVE_WINDOW;          // a sensible default window, not the initial span of 1
  resize();                      // ensure the canvas is sized — a fresh page never loaded a recording
  liveChan = new BroadcastChannel('delve-perf');
  liveChan.onmessage = (e: MessageEvent<LiveMsg>) => onLiveMsg(e.data);
  liveChan.postMessage({ t: 'hello' } satisfies LiveMsg);   // ask the game for the schema
  liveBtn.textContent = '■ STOP';
  liveBtn.style.borderColor = '#7a2a2a';
  liveBtn.style.color = '#ffb0b0';
  requestAnimationFrame(liveFlush);
}

/** Stop following but KEEP the captured buffer as a normal scrub session. */
function stopLive(): void {
  if (!liveChan) return;
  liveChan.close();
  liveChan = null;
  liveBtn.textContent = '● LIVE';
  liveBtn.style.borderColor = '#2a5a3a';
  liveBtn.style.color = '#9fb4cc';
}

function onLiveMsg(m: LiveMsg): void {
  if (!rec || !m) return;
  if (m.t === 'schema') {
    rec.systemNames = m.names;
    rec.gpuPhaseNames = m.gphNames.length ? m.gphNames : undefined;
    targetMs = (m.meta.targetMs as number) || TARGET_DEFAULT;
    rec.meta = { ...rec.meta, ...m.meta, frameCount: rec.frames.length } as Recording['meta'];
    buildMeta();
    buildLegend();
    resize();   // the freshly-filled legend may have changed the canvas's flex height
  } else if (m.t === 'frame') {
    rec.frames.push(m.f);
    if (rec.frames.length > LIVE_CAP) rec.frames.shift();
    liveDirty = true;
  }
}

function liveFlush(): void {
  if (!liveChan) return;
  if (liveDirty && rec) {
    liveDirty = false;
    rec.meta.frameCount = rec.frames.length;
    rec.meta.durationMs = rec.frames.length ? rec.frames[rec.frames.length - 1].t : 0;
    if ((liveRankCounter++ % 30) === 0) computeRanking(600);   // re-rank ~twice a second
    // The view window itself is owned by clampView() (its live branch anchors a
    // fixed LIVE_WINDOW to the newest frame); draw() calls it.
    buildSummary();
    buildMarkers();
    draw();
    if (pinnedFrame < 0) showFrame(followLive ? rec.frames.length - 1 : hoverFrame);
  }
  requestAnimationFrame(liveFlush);
}

// ── Wiring ────────────────────────────────────────────────────────────────
liveBtn.addEventListener('click', () => { if (isLive()) stopLive(); else startLive(); });
metaBtn.addEventListener('click', () => {
  const open = metaEl.style.display !== 'none';
  metaEl.style.display = open ? 'none' : 'block';
  metaBtn.textContent = open ? 'meta ▾' : 'meta ▴';
});
picker.addEventListener('change', () => { if (picker.value) void loadById(picker.value); });
window.addEventListener('resize', resize);

window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  file.text().then((t) => { try { setRecording(JSON.parse(t) as Recording); } catch { alert('not a valid recording JSON'); } });
});

// Size the canvas immediately — the live path never loads a recording, so it
// must not depend on setRecording() to call resize() (else it draws into a 1×1
// logical canvas blown up by DPR). A second rAF pass catches late flex layout.
resize();
requestAnimationFrame(resize);

void loadList();
const startId = new URLSearchParams(location.search).get('id');
if (startId) void loadById(startId);
