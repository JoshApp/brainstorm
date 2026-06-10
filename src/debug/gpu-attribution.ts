import type * as THREE from 'three';
import { addFrameListener, removeFrameListener, gpuActive, type FrameSample } from './frame-timing';
import { shareOrDownload, flash } from './share-file';
import { getCurrentDepth } from '../level/loader';
import {
  setBloomEnabled, setInscatterEnabled, setDepthCrushEnabled,
  getBloomEnabled, getInscatterEnabled, getDepthCrushEnabled,
} from '../style/render-target';
import { setShadowMode, getShadowMode } from '../scene/light-pool';
import { setMotesHidden } from '../effects/drifting-motes';

// GPU COST ATTRIBUTION — an A/B auto-profiler.
//
// The whole-frame GPU timer (gpu-timer.ts) tells you the frame costs ~18ms on
// the GPU, but NOT what's eating it. This sweeps the big render features one at
// a time: it samples a baseline, toggles ONE feature off, waits for the GPU
// timer to settle past its 1-3 frame lag, samples again, and restores. The
// drop IS that feature's GPU cost. Re-measures the baseline at the end so you
// can see whether the scene drifted under you (it shouldn't if you held still).
//
// This is the robust complement to per-pass timing: instead of "the scene pass
// is 14ms" it says "bloom 3ms, shadows 2ms, all sprites 4ms" — the numbers you
// actually optimize against (e.g. is the per-room torch-flame batch worth it).
//
// Uses ONLY the GPU timer that already works on the device; degrades to a clear
// "GPU timing unavailable" if the extension/probe isn't active. Stand still
// during the ~4s sweep — a moving camera changes the baseline mid-measurement.

const SETTLE_FRAMES = 9;    // skip after a toggle — covers the timer's 1-3 frame lag + any shader recompile
const SAMPLE_FRAMES = 26;   // average the GPU timer over this many frames per stage

let scene: THREE.Scene | null = null;
let running = false;

export function initGpuAttribution(s: THREE.Scene): void {
  scene = s;
}

interface Probe {
  name: string;
  note?: string;
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

export async function runGpuAttribution(): Promise<void> {
  if (running) { flash('attribution already running'); return; }
  if (!scene) { flash('attribution not initialised'); return; }
  if (!gpuActive()) {
    flash('GPU timing unavailable (no timer-query / probe) — turn the GPU probe on');
    return;
  }
  running = true;
  flash('GPU attribution: hold still ~4s…');

  const root = scene;
  // Capture the REAL prior state of everything we toggle, so restore puts it
  // back exactly — not to a hardcoded default (the old bug that left ink
  // outlines / bloom force-enabled after a sweep).
  const prevShadow = getShadowMode();
  const prevBloom = getBloomEnabled();
  const prevInscatter = getInscatterEnabled();
  const prevDepth = getDepthCrushEnabled();
  // Order: cheap → expensive doesn't matter (each is isolated), but keep the
  // headline suspects first.
  const probes: Probe[] = [
    { name: 'bloom', off: () => setBloomEnabled(false), restore: () => setBloomEnabled(prevBloom) },
    {
      name: 'shadows',
      note: 'lamp cube-map render + extra scene draws',
      off: () => setShadowMode('off'),
      restore: () => setShadowMode(prevShadow),
    },
    spriteProbe(root),
    { name: 'motes', off: () => setMotesHidden(true), restore: () => setMotesHidden(false) },
    {
      name: 'blit post-fx',
      note: 'fog inscatter + depth crush',
      off: () => { setInscatterEnabled(false); setDepthCrushEnabled(false); },
      restore: () => { setInscatterEnabled(prevInscatter); setDepthCrushEnabled(prevDepth); },
    },
  ];

  // Stage list: baseline, each probe-off, then baseline again (drift check).
  interface Stage { name: string; apply: () => void; cleanup?: () => void; }
  const stages: Stage[] = [
    { name: 'baseline', apply: () => {} },
    ...probes.map((p): Stage => ({ name: p.name, apply: () => p.off(), cleanup: () => p.restore() })),
    { name: 'baseline·recheck', apply: () => {} },
  ];

  const measured = new Map<string, number | null>();

  await new Promise<void>((resolve) => {
    let si = 0;
    let phase: 'apply' | 'settle' | 'measure' = 'apply';
    let frame = 0;
    let acc = 0;
    let n = 0;

    const onFrame = (s: FrameSample): void => {
      if (phase === 'apply') {
        stages[si].apply();
        phase = 'settle';
        frame = 0;
        return;
      }
      frame++;
      if (phase === 'settle') {
        if (frame >= SETTLE_FRAMES) { phase = 'measure'; frame = 0; acc = 0; n = 0; }
        return;
      }
      // measure
      if (s.gpuMs != null && s.gpuMs > 0) { acc += s.gpuMs; n++; }
      if (frame >= SAMPLE_FRAMES) {
        measured.set(stages[si].name, n > 0 ? acc / n : null);
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

  const baseline = measured.get('baseline') ?? null;
  const recheck = measured.get('baseline·recheck') ?? null;
  const fmt = (v: number | null): string => (v == null ? ' n/a' : v.toFixed(2).padStart(5));
  const pct = (v: number | null): string =>
    (v == null || !baseline ? '' : `  (${Math.round((v / baseline) * 100)}%)`);

  const L: string[] = [];
  L.push('DELVE GPU ATTRIBUTION');
  L.push(`depth ${getCurrentDepth()} · ${new Date().toISOString()}`);
  L.push('A/B sweep — each feature toggled off, GPU-timer delta = its cost.');
  L.push('Hold still during the sweep; the recheck below shows any baseline drift.');
  L.push('');
  L.push(`baseline GPU      : ${fmt(baseline)} ms`);
  L.push('cost of each feature (baseline − feature-off):');
  for (const p of probes) {
    const off = measured.get(p.name);
    const cost = baseline != null && off != null ? baseline - off : null;
    L.push(`  ${p.name.padEnd(14)}: ${fmt(cost)} ms${pct(cost)}${p.note ? `   — ${p.note}` : ''}`);
  }
  L.push('');
  L.push(`baseline recheck  : ${fmt(recheck)} ms   (drift ${baseline != null && recheck != null ? (recheck - baseline).toFixed(2) : 'n/a'} — keep small)`);
  L.push('');
  L.push('notes: negative/zero = within timer noise (feature is ~free or GPU-parallel');
  L.push('with something else). A big "all sprites" = torch-flame batching is worth it.');

  const text = L.join('\n');
  const name = `delve-gpu-attr-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const shared = await shareOrDownload(name, text);
  flash(shared ? 'GPU attribution shared' : 'GPU attribution downloaded');
  running = false;
}
