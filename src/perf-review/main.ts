// Perf review viewer — the offline reviewer for recordings made by the
// in-game session recorder (src/debug/perf-recorder.ts). This is the "scrub
// the timeline, find where frames dropped" half of the loop.
//
// It loads a recording three ways:
//   • ?id=<id>            — fetched from the dev server's /__perf/get
//   • the picker          — lists /__perf/list, newest first
//   • drag-and-drop       — drop a .json downloaded off a phone (no dev server)
//
// The timeline stacks each frame's per-system CPU cost so you can SEE which
// system's band swells during a spike, overlays the real frame interval (dt)
// and GPU line, draws the 60fps + 30fps budget lines, and flags every dropped
// frame. Hover to read that frame's full breakdown; click a marker to jump to
// the worst frames.
//
// Standalone tool — no game imports, so the types are declared locally rather
// than pulled from the recorder (which would drag in the whole engine).

interface RecFrame {
  t: number; dt: number; cpu: number; gpu: number | null;
  draws: number; tris: number; heap: number | null; gc: boolean; sys: number[];
}
interface Recording {
  meta: {
    startedAt: string; durationMs: number; frameCount: number; targetMs: number;
    gpuSupported: boolean; ua: string; dpr: number; viewport: [number, number]; label?: string;
  };
  systemNames: string[];
  frames: RecFrame[];
}

const app = document.getElementById('app') as HTMLDivElement;
const TARGET_DEFAULT = 1000 / 60;

// ── DOM scaffold ─────────────────────────────────────────────────────────
app.innerHTML = `
  <div id="bar" style="display:flex;align-items:center;gap:14px;padding:8px 14px;border-bottom:1px solid #1c2430;background:#0d121a;flex-wrap:wrap">
    <strong style="letter-spacing:.06em;color:#8fb8ff">DELVE · PERF REVIEW</strong>
    <select id="picker" style="background:#121a26;color:#cdd9e8;border:1px solid #28384c;border-radius:5px;padding:4px 8px;font:inherit"></select>
    <span id="summary" style="color:#9fb4cc;font-size:12px"></span>
    <span style="margin-left:auto;color:#5e7088;font-size:11px">drop a .json anywhere · hover to scrub</span>
  </div>
  <div id="legend" style="display:flex;flex-wrap:wrap;gap:5px 12px;padding:6px 14px;border-bottom:1px solid #161d28;font-size:11px;color:#9fb4cc"></div>
  <canvas id="tl" style="display:block;width:100%;flex:1;min-height:0;cursor:crosshair"></canvas>
  <div id="markers" style="display:flex;gap:6px;padding:6px 14px;border-top:1px solid #161d28;overflow-x:auto;white-space:nowrap"></div>
  <div id="frame" style="padding:8px 14px;border-top:1px solid #1c2430;background:#0d121a;min-height:150px;max-height:34vh;overflow:auto;font-size:12px"></div>
`;

const picker = document.getElementById('picker') as HTMLSelectElement;
const summaryEl = document.getElementById('summary') as HTMLSpanElement;
const legendEl = document.getElementById('legend') as HTMLDivElement;
const canvas = document.getElementById('tl') as HTMLCanvasElement;
const markersEl = document.getElementById('markers') as HTMLDivElement;
const frameEl = document.getElementById('frame') as HTMLDivElement;
const g = canvas.getContext('2d')!;

let rec: Recording | null = null;
let targetMs = TARGET_DEFAULT;
let topSystems: number[] = [];        // indices into systemNames, by total cost desc
let cursorFrame = -1;

function hue(i: number): number { return (i * 47 + 13) % 360; }
function sysColor(idx: number, a = 1): string {
  const rank = topSystems.indexOf(idx);
  if (rank < 0) return `rgba(90,100,115,${a})`;   // "other"
  return `hsla(${hue(rank)},65%,60%,${a})`;
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

function setRecording(r: Recording): void {
  rec = r;
  targetMs = r.meta.targetMs || TARGET_DEFAULT;

  // Rank systems by total cost so the stack shows the heaviest at the bottom
  // and everything past the top-8 collapses into "other".
  const totals = r.systemNames.map((_, i) => r.frames.reduce((s, f) => s + (f.sys[i] || 0), 0));
  topSystems = totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a]).slice(0, 8);

  buildSummary();
  buildLegend();
  buildMarkers();
  cursorFrame = worstFrameIndex();
  resize();
  showFrame(cursorFrame);
}

// ── Summary / legend / markers ────────────────────────────────────────────
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

function buildLegend(): void {
  if (!rec) return;
  legendEl.innerHTML = topSystems.map((idx) =>
    `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${sysColor(idx)}"></span>${rec!.systemNames[idx]}</span>`,
  ).join('') + `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${sysColor(-1)}"></span>other</span>` +
    `<span style="margin-left:8px;color:#ff82dc">— gpu</span><span style="color:#dfe8f5">— frame(dt)</span>`;
}

function worstFrameIndex(): number {
  if (!rec || !rec.frames.length) return -1;
  let wi = 0, wv = -1;
  for (let i = 0; i < rec.frames.length; i++) if (rec.frames[i].dt > wv) { wv = rec.frames[i].dt; wi = i; }
  return wi;
}

function buildMarkers(): void {
  if (!rec) return;
  // The N worst frames, de-clustered (skip ones within 10 frames of a picked one).
  const order = rec.frames.map((f, i) => [i, f.dt] as [number, number]).sort((a, b) => b[1] - a[1]);
  const picked: number[] = [];
  for (const [i] of order) {
    if (picked.length >= 8) break;
    if (picked.some((p) => Math.abs(p - i) < 10)) continue;
    if (rec.frames[i].dt <= targetMs * 1.5) break;
    picked.push(i);
  }
  picked.sort((a, b) => a - b);
  markersEl.innerHTML = picked.length
    ? '<span style="color:#7a8aa0;align-self:center;margin-right:4px">spikes:</span>' + picked.map((i) =>
        `<button data-f="${i}" style="background:#2a1418;color:#ffb0b0;border:1px solid #5a2a2a;border-radius:5px;padding:3px 8px;font:inherit;cursor:pointer">${(rec!.frames[i].t / 1000).toFixed(1)}s · ${rec!.frames[i].dt.toFixed(0)}ms</button>`,
      ).join('')
    : '<span style="color:#6a8a6a;align-self:center">no dropped frames over 1.5× budget — clean run</span>';
  markersEl.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { cursorFrame = Number((b as HTMLButtonElement).dataset.f); draw(); showFrame(cursorFrame); }));
}

// ── Timeline drawing ──────────────────────────────────────────────────────
function resize(): void {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(r.width));
  canvas.height = Math.max(1, Math.floor(r.height));
  draw();
}

function draw(): void {
  if (!rec) return;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a0d13';
  g.fillRect(0, 0, W, H);

  const frames = rec.frames;
  const n = frames.length;
  if (!n) return;

  // Y scale: fit to p99.5 of dt/cpu/gpu so a lone monster spike doesn't flatten
  // everything, but never below 34ms so the 30fps line is always on screen.
  const all: number[] = [];
  for (const f of frames) { all.push(f.dt, f.cpu); if (f.gpu) all.push(f.gpu); }
  all.sort((a, b) => a - b);
  const maxY = Math.max(34, quantile(all, 0.995) * 1.1);
  const y = (ms: number) => H - Math.min(1, ms / maxY) * H;

  // Per-pixel bucketing: each column = the WORST (highest dt) frame in its
  // range, so spikes are never hidden by downsampling.
  const colFrame: number[] = new Array(W);
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / W) * n);
    const b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
    let wi = a, wv = -1;
    for (let i = a; i < b && i < n; i++) if (frames[i].dt > wv) { wv = frames[i].dt; wi = i; }
    colFrame[x] = wi;
  }

  // Stacked per-system CPU bands (heaviest at the bottom).
  for (let x = 0; x < W; x++) {
    const f = frames[colFrame[x]];
    let acc = 0;
    // Draw top systems first (bottom of stack), then everything else as "other".
    let otherSum = 0;
    for (let i = 0; i < f.sys.length; i++) if (topSystems.indexOf(i) < 0) otherSum += f.sys[i];
    for (const idx of topSystems) {
      const v = f.sys[idx] || 0;
      if (v <= 0) continue;
      const y0 = y(acc), y1 = y(acc + v);
      g.fillStyle = sysColor(idx, 0.85);
      g.fillRect(x, y1, 1, y0 - y1);
      acc += v;
    }
    if (otherSum > 0) {
      const y0 = y(acc), y1 = y(acc + otherSum);
      g.fillStyle = sysColor(-1, 0.7);
      g.fillRect(x, y1, 1, y0 - y1);
    }
  }

  // Budget guide lines.
  for (const [ms, col, label] of [[targetMs, 'rgba(140,240,160,0.5)', '60'], [targetMs * 2, 'rgba(255,210,130,0.45)', '30']] as const) {
    if (ms > maxY) continue;
    const gy = y(ms);
    g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); g.stroke();
    g.setLineDash([]);
    g.fillStyle = col; g.font = '10px monospace';
    g.fillText(`${label}fps`, 3, gy - 3);
  }

  // GPU line (magenta) + frame-interval line (white) on top of the stack.
  drawLine(colFrame, (f) => f.gpu, 'rgba(255,130,220,0.9)', y, W);
  drawLine(colFrame, (f) => f.dt, 'rgba(220,232,245,0.9)', y, W);

  // Dropped-frame markers — red ticks at the top.
  g.fillStyle = '#ff4040';
  for (let x = 0; x < W; x++) {
    if (frames[colFrame[x]].dt > targetMs * 1.5) g.fillRect(x, 0, 1, 4);
  }

  // Cursor.
  if (cursorFrame >= 0) {
    const cx = Math.round((cursorFrame / n) * W);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx + 0.5, 0); g.lineTo(cx + 0.5, H); g.stroke();
  }
}

function drawLine(colFrame: number[], pick: (f: RecFrame) => number | null, color: string, y: (ms: number) => number, W: number): void {
  if (!rec) return;
  g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
  let started = false;
  for (let x = 0; x < W; x++) {
    const v = pick(rec.frames[colFrame[x]]);
    if (v == null) { started = false; continue; }
    const py = y(v);
    if (!started) { g.moveTo(x, py); started = true; } else g.lineTo(x, py);
  }
  g.stroke();
}

// ── Hovered-frame breakdown ───────────────────────────────────────────────
function showFrame(i: number): void {
  if (!rec || i < 0 || i >= rec.frames.length) return;
  const f = rec.frames[i];
  const rows = f.sys.map((ms, idx) => [rec!.systemNames[idx], ms] as [string, number])
    .filter(([, ms]) => ms > 0.01).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  const dropped = f.dt > targetMs * 1.5;
  frameEl.innerHTML =
    `<div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px">` +
      `<b style="color:#8fb8ff">frame ${i} · ${(f.t / 1000).toFixed(2)}s</b>` +
      `<span style="color:${dropped ? '#ff8a8a' : '#cdd9e8'}">dt ${f.dt.toFixed(1)}ms (${(1000 / f.dt).toFixed(0)}fps)${dropped ? ' ⚠ DROPPED' : ''}</span>` +
      `<span>cpu ${f.cpu.toFixed(1)}ms</span>` +
      `<span style="color:#ff82dc">gpu ${f.gpu != null ? f.gpu.toFixed(1) + 'ms' : 'n/a'}</span>` +
      `<span>${f.draws} draws · ${(f.tris / 1000).toFixed(0)}k tris</span>` +
      `<span>heap ${f.heap ?? '—'}MB${f.gc ? ' · GC' : ''}</span>` +
    `</div>` +
    rows.map(([name, ms]) => {
      const idx = rec!.systemNames.indexOf(name);
      const w = Math.max(2, Math.round((ms / max) * 220));
      return `<div style="display:flex;align-items:center;gap:8px;height:15px">` +
        `<span style="width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>` +
        `<span style="width:46px;text-align:right;color:${ms > 4 ? '#ffb070' : '#9fb4cc'}">${ms.toFixed(2)}</span>` +
        `<span style="width:${w}px;height:8px;background:${sysColor(idx, 0.8)};border-radius:2px"></span></div>`;
    }).join('');
}

canvas.addEventListener('mousemove', (e) => {
  if (!rec) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  cursorFrame = Math.min(rec.frames.length - 1, Math.max(0, Math.floor(x * rec.frames.length)));
  draw();
  showFrame(cursorFrame);
});

// ── Wiring ────────────────────────────────────────────────────────────────
picker.addEventListener('change', () => { if (picker.value) void loadById(picker.value); });
window.addEventListener('resize', resize);

// Drag-and-drop a downloaded recording (the no-dev-server path).
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  file.text().then((t) => { try { setRecording(JSON.parse(t) as Recording); } catch { alert('not a valid recording JSON'); } });
});

void loadList();
const startId = new URLSearchParams(location.search).get('id');
if (startId) void loadById(startId);
