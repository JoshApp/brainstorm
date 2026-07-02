import * as THREE from 'three';
import { addFrameListener, removeFrameListener, gpuActive, gpuSupported, type FrameSample } from './frame-timing';
import { shareOrDownload, flash } from './share-file';
import { getCurrentDepth } from '../level/loader';
import {
  setBloomEnabled, setInscatterEnabled, setDepthCrushEnabled,
  getBloomEnabled, getInscatterEnabled, getDepthCrushEnabled,
  setPS1Scale, getPS1Scale,
} from '../style/render-frame';
import { setShadowMode, getShadowMode, setLightBudgetTrim, getLightSlotTotals } from '../scene/light-pool';
import { setMotesHidden } from '../effects/drifting-motes';
import { setSurfaceDetailEnabled, getSurfaceDetailEnabled } from '../style/surface-detail';
import { setAdaptiveResolution, isAdaptiveResolutionEnabled } from '../scene/adaptive-resolution';
import type { DelveRenderer } from '../scene/create-renderer';

// GPU COST ATTRIBUTION — an A/B auto-profiler.
//
// The whole-frame GPU timer (gpu-timer.ts) tells you the frame costs ~18ms on
// the GPU, but NOT what's eating it. This sweeps the big render features one at
// a time: it samples a baseline, toggles ONE feature off, waits for the GPU
// timer to settle past its 1-3 frame lag (longer where the toggle forces a
// shader recompile), samples again, and restores. The drop IS that feature's
// GPU cost. Re-measures the baseline at the end so you can see whether the
// scene drifted under you (it shouldn't if you held still).
//
// Beyond the post-pipeline toggles, the sweep prices the STRUCTURAL costs that
// no draw counter shows:
//   • light budget — every pooled PointLight (parked or not) is compiled into
//     every lit material and evaluated per fragment. Trimming 19 → 10 slots
//     measures what the generous budget costs per frame.
//   • PBR shading  — scene.overrideMaterial swaps every mesh to Lambert
//     (cheap diffuse) or Basic (unlit) for the stage. Lambert Δ ≈ the GGX
//     BRDF tax; Basic Δ ≈ the entire lighting bill. Upper bounds — the
//     override also drops emissive/detail work.
//   • resolution   — scene-target scale and canvas DPR stages split "fill-
//     bound in the 3D pass" from "fill-bound in the full-res blit".
//
// If neither the timer-query extension nor the GPU probe is active, the sweep
// arms the readPixels probe itself for the duration — one tap, no setup.
// Stand still during the sweep — a moving camera changes the baseline.

const SETTLE_FRAMES = 9;     // skip after a toggle — covers the timer's 1-3 frame lag
const SETTLE_RECOMPILE = 40; // toggles that change light count / override materials recompile every program
const SAMPLE_FRAMES = 30;    // average the GPU timer over this many frames per stage

let scene: THREE.Scene | null = null;
let renderer: DelveRenderer | null = null;
let running = false;

export function initGpuAttribution(s: THREE.Scene, r: DelveRenderer): void {
  scene = s;
  renderer = r;
}

interface Probe {
  name: string;
  note?: string;
  /** Extra settle frames (shader recompiles need more than timer lag). */
  settle?: number;
  /** Return a reason string to skip this probe (e.g. DPR already 1). */
  skip?: () => string | null;
  off(): void;
  restore(): void;
}

/** Hide every currently-visible Sprite in the scene; restore exactly that set.
 *  Measures TOTAL sprite overdraw (torch flames + halos + trails) — the figure
 *  that says whether batching the torch sprites is worth the work. */
function spriteProbe(root: THREE.Scene): Probe {
  let hidden: THREE.Object3D[] = [];
  return {
    name: 'all sprites',
    note: 'torch flames + halos + trails — total additive overdraw',
    off() {
      hidden = [];
      root.traverse((o) => {
        if ((o as unknown as { isSprite?: boolean }).isSprite && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      });
    },
    restore() {
      for (const o of hidden) o.visible = true;
      hidden = [];
    },
  };
}

/** Swap every mesh's material for the stage via scene.overrideMaterial. */
function overrideProbe(root: THREE.Scene, name: string, mat: THREE.Material, note: string): Probe {
  let prev: THREE.Material | null = null;
  return {
    name,
    note,
    settle: SETTLE_RECOMPILE,
    off() { prev = root.overrideMaterial; root.overrideMaterial = mat; },
    restore() { root.overrideMaterial = prev; },
  };
}

interface StageStats { gpu: number | null; cpu: number; draws: number; dt: number; }

export async function runGpuAttribution(): Promise<void> {
  if (running) { flash('attribution already running'); return; }
  if (!scene || !renderer) { flash('attribution not initialised'); return; }
  running = true;

  // No GPU timestamps on this device → the sweep falls back to CPU/dt deltas
  // (the report labels which signal it used via gpuActive()).

  // The adaptive scaler would fight the resolution stage (and drift the
  // baseline mid-sweep on a struggling device) — suspend it, restore after.
  const adaptiveWasOn = isAdaptiveResolutionEnabled();
  if (adaptiveWasOn) setAdaptiveResolution(false);

  flash('GPU attribution: hold still ~30s…');

  const root = scene;
  const rend = renderer;
  // Capture the REAL prior state of everything we toggle, so restore puts it
  // back exactly — not to a hardcoded default (the old bug that left ink
  // outlines / bloom force-enabled after a sweep).
  const prevShadow = getShadowMode();
  const prevBloom = getBloomEnabled();
  const prevInscatter = getInscatterEnabled();
  const prevDepth = getDepthCrushEnabled();
  const prevDetail = getSurfaceDetailEnabled();
  const prevScale = getPS1Scale();
  const prevDpr = rend.getPixelRatio();

  const lambertMat = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
  const basicMat = new THREE.MeshBasicMaterial({ color: 0x222222 });

  // setPixelRatio resizes the drawing buffer; the low-res target derives from
  // it, so re-apply the current scale to resize the target chain to match.
  const applyDpr = (ratio: number): void => {
    rend.setPixelRatio(ratio);
    setPS1Scale(getPS1Scale());
  };

  const probes: Probe[] = [
    {
      name: `light budget ${getLightSlotTotals().full}→${getLightSlotTotals().trimmed}`,
      note: 'parked pool slots still cost per-fragment on every lit material',
      settle: SETTLE_RECOMPILE,
      off: () => setLightBudgetTrim(true),
      restore: () => setLightBudgetTrim(false),
    },
    overrideProbe(root, 'pbr→lambert', lambertMat,
      'GGX/PBR shading tax vs cheap diffuse — upper bound (also drops emissive/detail)'),
    overrideProbe(root, 'lit→unlit', basicMat,
      'the ENTIRE lighting bill — upper bound'),
    {
      name: 'shadows',
      note: 'lamp cube-map render + extra scene draws',
      off: () => setShadowMode('off'),
      restore: () => setShadowMode(prevShadow),
    },
    { name: 'bloom', off: () => setBloomEnabled(false), restore: () => setBloomEnabled(prevBloom) },
    spriteProbe(root),
    { name: 'motes', off: () => setMotesHidden(true), restore: () => setMotesHidden(false) },
    {
      name: 'blit post-fx',
      note: 'fog inscatter + depth crush',
      off: () => { setInscatterEnabled(false); setDepthCrushEnabled(false); },
      restore: () => { setInscatterEnabled(prevInscatter); setDepthCrushEnabled(prevDepth); },
    },
    {
      name: 'detail textures',
      note: 'baked wall/floor/ceiling detail + relief',
      off: () => setSurfaceDetailEnabled(false),
      restore: () => setSurfaceDetailEnabled(prevDetail),
    },
    // (The 'viewmodel prepass' probe is gone: the WebGPU path has no depth
    // pre-pass at all — opaque viewmodel parts just write normal depth.)
    {
      name: `scale ${prevScale.toFixed(2)}→0.30`,
      note: 'scene-target fill — big Δ = fragment-bound in the 3D pass',
      skip: () => (prevScale <= 0.31 ? 'already ≤0.30' : null),
      off: () => setPS1Scale(0.3),
      restore: () => setPS1Scale(prevScale),
    },
    {
      name: `dpr ${prevDpr.toFixed(2)}→1.00`,
      note: 'canvas fill — big Δ = the full-res blit is the wall',
      skip: () => (prevDpr <= 1.01 ? 'already 1' : null),
      off: () => applyDpr(1),
      restore: () => applyDpr(prevDpr),
    },
  ];

  // Stage list: INTERLEAVED baselines — baseline, probe, baseline, probe, …
  // Each probe is costed against the MEAN OF ITS NEIGHBOURING baselines, not
  // one global baseline. This is what makes the sweep survive a phone
  // thermally throttling mid-run: drift moves the local baselines along with
  // the probe stages, so the deltas stay honest. (A real phone run drifted
  // +4.6ms over one sweep and poisoned every late stage — never again.)
  interface Stage { key: string; settle: number; apply: () => void; cleanup?: () => void; }
  const skipped: { name: string; reason: string }[] = [];
  const stages: Stage[] = [];
  const baselineKeys: string[] = [];
  // Probe name → the baseline keys measured immediately before/after it.
  const localBaselines = new Map<string, [string, string]>();
  let bi = 0;
  const pushBaseline = (settle: number): string => {
    const key = `baseline#${bi++}`;
    baselineKeys.push(key);
    stages.push({ key, settle, apply: () => {} });
    return key;
  };
  let prevBaselineKey = pushBaseline(SETTLE_FRAMES);
  for (const p of probes) {
    const reason = p.skip?.();
    if (reason) { skipped.push({ name: p.name, reason }); continue; }
    const settle = p.settle ?? SETTLE_FRAMES;
    stages.push({ key: p.name, settle, apply: () => p.off(), cleanup: () => p.restore() });
    // Restoring a recompile-heavy probe recompiles again — give the
    // following baseline the same long settle.
    const afterKey = pushBaseline(settle);
    localBaselines.set(p.name, [prevBaselineKey, afterKey]);
    prevBaselineKey = afterKey;
  }

  const measured = new Map<string, StageStats>();

  await new Promise<void>((resolve) => {
    let si = 0;
    let phase: 'apply' | 'settle' | 'measure' = 'apply';
    let frame = 0;
    let gAcc = 0, gN = 0, cAcc = 0, dAcc = 0, dtAcc = 0, n = 0;

    const onFrame = (s: FrameSample): void => {
      if (phase === 'apply') {
        stages[si].apply();
        phase = 'settle';
        frame = 0;
        return;
      }
      frame++;
      if (phase === 'settle') {
        if (frame >= stages[si].settle) { phase = 'measure'; frame = 0; gAcc = 0; gN = 0; cAcc = 0; dAcc = 0; dtAcc = 0; n = 0; }
        return;
      }
      // measure
      if (s.gpuMs != null && s.gpuMs > 0) { gAcc += s.gpuMs; gN++; }
      cAcc += s.cpuMs; dAcc += s.draws; dtAcc += s.dt; n++;
      if (frame >= SAMPLE_FRAMES) {
        measured.set(stages[si].key, {
          gpu: gN > 0 ? gAcc / gN : null,
          cpu: n > 0 ? cAcc / n : 0,
          draws: n > 0 ? dAcc / n : 0,
          dt: n > 0 ? dtAcc / n : 0,
        });
        stages[si].cleanup?.();
        si++;
        if (si >= stages.length) { removeFrameListener(onFrame); resolve(); return; }
        phase = 'apply';
      }
    };
    addFrameListener(onFrame);
  });

  // Be paranoid: make sure everything is restored to its REAL prior state even
  // if a stage threw.
  setBloomEnabled(prevBloom); setShadowMode(prevShadow); setMotesHidden(false);
  setInscatterEnabled(prevInscatter); setDepthCrushEnabled(prevDepth);
  setLightBudgetTrim(false); setSurfaceDetailEnabled(prevDetail);
  if (root.overrideMaterial === lambertMat || root.overrideMaterial === basicMat) root.overrideMaterial = null;
  setPS1Scale(prevScale);
  if (rend.getPixelRatio() !== prevDpr) applyDpr(prevDpr);
  lambertMat.dispose(); basicMat.dispose();
  if (adaptiveWasOn) setAdaptiveResolution(true);

  const baseline = measured.get(baselineKeys[0]);
  const lastBaseline = measured.get(baselineKeys[baselineKeys.length - 1]);
  const fmt = (v: number | null | undefined): string => (v == null ? '  n/a' : v.toFixed(2).padStart(5));
  const pct = (v: number | null): string =>
    (v == null || !baseline?.gpu ? '' : ` (${Math.round((v / baseline.gpu) * 100)}%)`);

  // Each probe is costed against the MEAN of the baselines measured right
  // before and right after it — drift-immune (see the stage-list note).
  const localMean = (p: Probe, pick: (s: StageStats) => number | null): number | null => {
    const keys = localBaselines.get(p.name);
    if (!keys) return null;
    const vals = keys
      .map((k) => measured.get(k))
      .filter((s): s is StageStats => !!s)
      .map(pick)
      .filter((v): v is number => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // Rank by measured GPU cost, descending — the read order IS the priority order.
  const ranked = probes
    .filter((p) => measured.has(p.name))
    .map((p) => {
      const m = measured.get(p.name)!;
      const bGpu = localMean(p, (s) => s.gpu);
      const bCpu = localMean(p, (s) => s.cpu);
      const bDraws = localMean(p, (s) => s.draws);
      return {
        p,
        gpuCost: bGpu != null && m.gpu != null ? bGpu - m.gpu : null,
        cpuCost: bCpu != null ? bCpu - m.cpu : null,
        drawsDelta: bDraws != null ? m.draws - bDraws : 0,
      };
    })
    .sort((a, b) => (b.gpuCost ?? -Infinity) - (a.gpuCost ?? -Infinity));

  // Worst-case drift across ALL interleaved baselines — the honesty meter.
  const baselineGpus = baselineKeys
    .map((k) => measured.get(k)?.gpu)
    .filter((v): v is number => v != null);
  const driftSpan = baselineGpus.length >= 2 ? Math.max(...baselineGpus) - Math.min(...baselineGpus) : null;

  const L: string[] = [];
  L.push('DELVE GPU ATTRIBUTION');
  L.push(`depth ${getCurrentDepth()} · ${new Date().toISOString()}`);
  L.push(`timing: ${gpuSupported() ? 'timer-query' : 'readPixels probe'} · scale ${prevScale.toFixed(2)} · dpr ${prevDpr.toFixed(2)} · shadows ${prevShadow}`);
  L.push('A/B sweep — each feature toggled off, GPU-timer delta = its cost.');
  L.push('Baselines are re-measured between every stage and each feature is costed');
  L.push('against its NEIGHBOURING baselines, so thermal drift cannot poison the deltas.');
  L.push('Hold still for the sweep.');
  L.push('');
  L.push(`baseline: ${fmt(baseline?.gpu)} gpu · ${fmt(baseline?.cpu)} cpu · ${fmt(baseline?.dt)} dt · ${Math.round(baseline?.draws ?? 0)} draws`);
  L.push('');
  L.push('feature costs, ranked (local baseline − feature-off):');
  for (const r of ranked) {
    const d = Math.round(r.drawsDelta);
    L.push(
      `  ${r.p.name.padEnd(20)}: ${fmt(r.gpuCost)} gpu${pct(r.gpuCost)} · ${fmt(r.cpuCost)} cpu · ${d >= 0 ? '+' : ''}${d} draws` +
      (r.p.note ? `\n${' '.repeat(24)}${r.p.note}` : ''),
    );
  }
  for (const s of skipped) L.push(`  ${s.name.padEnd(20)}:  skipped — ${s.reason}`);
  L.push('');
  L.push(
    `baseline drift    : first ${fmt(baseline?.gpu)} → last ${fmt(lastBaseline?.gpu)} gpu · ` +
    `span ${driftSpan != null ? driftSpan.toFixed(2) : 'n/a'} across ${baselineGpus.length} interleaved baselines ` +
    `(local costing absorbs this — big span = device throttling, not bad data)`,
  );
  L.push('');
  L.push('notes: negative/zero = within timer noise (feature is ~free or GPU-parallel');
  L.push('with something else). pbr→lambert / lit→unlit are upper bounds (override');
  L.push('also drops emissive + detail). Under vsync the dt column saturates at the');
  L.push('refresh interval — read gpu, not dt.');

  const text = L.join('\n');
  lastReport = text;
  // Structured form of the same ranking, for the perf cockpit (it renders bars
  // instead of dumping the monospace text). Built from the same `ranked` array.
  lastData = {
    depth: getCurrentDepth(),
    ts: new Date().toISOString(),
    timing: gpuSupported() ? 'timer-query' : 'readPixels probe',
    baseline: {
      gpu: baseline?.gpu ?? null, cpu: baseline?.cpu ?? null,
      dt: baseline?.dt ?? null, draws: Math.round(baseline?.draws ?? 0),
    },
    driftSpan,
    ranked: ranked.map((r) => ({
      name: r.p.name, gpuCost: r.gpuCost, cpuCost: r.cpuCost,
      drawsDelta: Math.round(r.drawsDelta), note: r.p.note,
    })),
  };
  reportListener?.(lastData);
  console.log(text);   // also readable from a remote console / driving harness
  const name = `delve-gpu-attr-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const shared = await shareOrDownload(name, text);
  flash(shared ? 'GPU attribution shared' : 'GPU attribution downloaded');
  running = false;
}

/** Structured form of a sweep result — the cockpit renders this as bars. */
export interface AttrEntry { name: string; gpuCost: number | null; cpuCost: number | null; drawsDelta: number; note?: string }
export interface AttrData {
  depth: number; ts: string; timing: string;
  baseline: { gpu: number | null; cpu: number | null; dt: number | null; draws: number };
  driftSpan: number | null;
  ranked: AttrEntry[];
}

let lastReport: string | null = null;
let lastData: AttrData | null = null;
let reportListener: ((d: AttrData) => void) | null = null;
/** The most recent sweep's report text — for harness/remote-console reads. */
export function getLastAttributionReport(): string | null { return lastReport; }
/** The most recent sweep's structured result (null until a sweep has run). */
export function getLastAttributionData(): AttrData | null { return lastData; }
/** Notified each time a sweep completes — perf-stream forwards it to the cockpit. */
export function onAttributionReport(cb: ((d: AttrData) => void) | null): void { reportListener = cb; }
/** True while a sweep is in progress — poll this from a driving harness. */
export function isAttributionRunning(): boolean { return running; }
