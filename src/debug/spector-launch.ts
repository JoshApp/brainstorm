// DEV-only spector.js launcher — the draw-call autopsy tool (think RenderDoc
// for WebGL). When the profiler says you're GPU-bound or your draw count looks
// wrong, this captures EVERY GL command of the next frame: every draw call,
// state change, shader, and texture bind, with the geometry behind each.
//
// It loads spector.js from a CDN ON DEMAND so nothing ships in the bundle (and
// nothing is pulled unless you actually ask for a capture). If the CDN is
// unreachable (offline), use the spector.js BROWSER EXTENSION instead — same
// tool, zero code. See docs/profiling.md.
//
// Trigger: F6, or window.__spector() in the console.

const CDN = 'https://cdn.jsdelivr.net/npm/spectorjs@0.9.30/dist/spector.bundle.js';
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('spector.js CDN unreachable'));
    document.head.appendChild(s);
  });
  return loading;
}

export async function launchSpector(): Promise<void> {
  try {
    await loadScript();
  } catch (e) {
    loading = null;
    // eslint-disable-next-line no-console
    console.warn('[spector]', (e as Error).message, '— install the spector.js browser extension and click its capture button instead.');
    return;
  }
  const SPECTOR = (window as unknown as { SPECTOR?: { Spector: new () => SpectorInstance } }).SPECTOR;
  if (!SPECTOR) return;
  const spector = new SPECTOR.Spector();
  spector.displayUI();
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (canvas) spector.captureCanvas(canvas);
}

interface SpectorInstance {
  displayUI(): void;
  captureCanvas(c: HTMLCanvasElement): void;
}
