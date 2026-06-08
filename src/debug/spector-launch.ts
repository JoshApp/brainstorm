// spector.js launcher — the draw-call autopsy tool (think RenderDoc for WebGL).
// Captures the GL command stream of one frame: every draw call, state change,
// shader, and texture bind. Use it to answer "what are all these draw calls?"
//
// Loads spector.js from a CDN ON DEMAND so nothing ships in the bundle. If the
// CDN is unreachable (offline), use the spector.js BROWSER EXTENSION instead —
// same tool, zero code. See docs/profiling.md.
//
// IMPORTANT — quick capture. A DELVE frame is ~660+ draws across FOUR passes
// (prepass / scene / bloom / blit). spector's DEFAULT capture snapshots the
// framebuffer STATE after every single command — that's a synchronous readback
// per draw, which locks the main thread for seconds and reads as a freeze. We
// pass quickCapture=true so it records the command LIST without the per-command
// visual snapshots: you still get the full draw-call breakdown, just not the
// thumbnail of each one. Much lighter, no freeze.
//
// Trigger: SPCT toolbar button, F6, or window.__spector().

const CDN = 'https://cdn.jsdelivr.net/npm/spectorjs@0.9.30/dist/spector.bundle.js';
let loading: Promise<void> | null = null;
let spector: SpectorInstance | null = null;
let capturing = false;

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
  if (capturing) return;   // a capture is already in flight — don't stack
  try {
    await loadScript();
  } catch (e) {
    loading = null;
    flash('spector: CDN unreachable — use the browser extension');
    // eslint-disable-next-line no-console
    console.warn('[spector]', (e as Error).message, '— install the spector.js browser extension instead.');
    return;
  }
  const SPECTOR = (window as unknown as { SPECTOR?: { Spector: new () => SpectorInstance } }).SPECTOR;
  if (!SPECTOR) return;
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas) return;

  // Build the spector instance + its result UI ONCE; repeated taps reuse it
  // (a fresh `new Spector()` each time stacks context spies and UI panels).
  if (!spector) {
    spector = new SPECTOR.Spector();
    spector.displayUI();
  }

  capturing = true;
  flash('spector: capturing one frame…');
  try {
    // captureCanvas(canvas, commandCount=0 → whole frame, quickCapture=true).
    spector.captureCanvas(canvas, 0, true);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[spector] capture failed', e);
  }
  // The capture resolves a frame or two later inside spector's own UI; clear
  // the re-entry guard after a short grace period.
  setTimeout(() => { capturing = false; }, 1500);
}

// Minimal transient status line (spector's result UI takes a moment to appear,
// so give immediate feedback that the tap registered).
function flash(msg: string): void {
  let el = document.getElementById('spector-flash') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'spector-flash';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: 'calc(120px + env(safe-area-inset-bottom, 0px))',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 12px',
      background: 'rgba(8, 14, 22, 0.9)',
      border: '1px solid rgba(140, 200, 255, 0.35)',
      borderRadius: '8px',
      color: 'rgba(200, 230, 255, 0.95)',
      font: '500 12px ui-monospace, monospace',
      pointerEvents: 'none',
      zIndex: '9001',
      transition: 'opacity 0.3s',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  window.setTimeout(() => { if (el) el.style.opacity = '0'; }, 2500);
}

interface SpectorInstance {
  displayUI(): void;
  captureCanvas(c: HTMLCanvasElement, commandCount?: number, quickCapture?: boolean): void;
}
