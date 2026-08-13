// GPU context / device loss recovery.
//
// Mobile GPUs drop the context under memory pressure or on backgrounding.
// By DEFAULT that's a permanent black screen — and worse here, the next render
// call would throw and trip the fatal crash overlay for something that's
// actually recoverable. Two loss channels, one veil + frame-loop gate:
//
// - WebGL2 fallback backend: the canvas 'webglcontextlost' event. The browser
//   only RESTORES the context if we preventDefault() on the lost event, so we
//   do: gate the frame loop (isContextLost), show a brief in-character veil,
//   and on restore resume. Without this, a tab-switch can brick a run.
// - WebGPU backend: the device.lost promise. A lost GPUDevice CANNOT be
//   revived in place — every pipeline/buffer/texture on it is gone, and Three
//   has no whole-renderer rebuild path — so the honest recovery is the veil +
//   an immediate reload offer (the run save persists; a reload resumes it).

let lost = false;
let veil: HTMLDivElement | null = null;
let restoreTimer: number | null = null;

export function isContextLost(): boolean { return lost; }

export function installContextRecovery(opts: {
  canvas: HTMLCanvasElement;
  onRestore: () => void;
  onLost?: () => void;
}): void {
  const { canvas, onRestore, onLost } = opts;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // REQUIRED — without this the context never comes back
    if (lost) return;
    lost = true;
    onLost?.();
    showVeil('the dark gutters');
    // Some devices never fire 'restored'; after a grace period, offer a reload.
    restoreTimer = window.setTimeout(() => showReload(), 6000);
  });

  canvas.addEventListener('webglcontextrestored', () => {
    if (restoreTimer != null) { clearTimeout(restoreTimer); restoreTimer = null; }
    try { onRestore(); } catch { /* if reinit fails, the reload offer stands */ return; }
    lost = false;
    hideVeil();
  });
}

/** WebGPU device-loss watch. Call after renderer.init() — the device exists
 *  then. No-op on the WebGL2 backend (the canvas events above own that path).
 *  reason === 'destroyed' is an intentional teardown (never ours in play) and
 *  page unload on some browsers — ignored to avoid a veil flash on refresh. */
export function installDeviceLossRecovery(renderer: unknown): void {
  type LostInfo = { reason: string };
  const device = (renderer as { backend?: { isWebGPUBackend?: boolean; device?: { lost?: Promise<LostInfo> } } })?.backend;
  if (!device?.isWebGPUBackend || !device.device?.lost) return;
  void device.device.lost.then((info: LostInfo) => {
    if (info.reason === 'destroyed' || lost) return;
    lost = true;   // idle the frame loop — a render on a lost device throws
    showVeil('the dark gutters');
    showReload();
  });
  installGpuErrorWatch(device.device as unknown as GpuDeviceLike);
}

// ── Uncaptured-error watch (the PARTIAL-loss diagnostic) ─────────────────────
//
// Field report (2026-07-18): after a long tab-out, the starter-chamber FLOOR
// came back invisible — see-through into the void — while everything else kept
// rendering. That's not full device loss (the watch above would have veiled);
// it's ONE resource dying (a texture/buffer reclaimed while backgrounded), which
// makes just that mesh's draw fail validation EVERY FRAME — and before this
// watch, entirely silently. WebGPU reports exactly what died on the device's
// 'uncapturederror' channel; nobody was listening.
//
// Two jobs:
//   1. DIAGNOSE — record the first few error messages (they name the dead
//      resource) to memory + localStorage, so a phone occurrence is
//      retrievable after the fact instead of gone with the console.
//   2. RECOVER — a sustained storm (errors every frame for seconds) means the
//      world is broken and will not heal; offer the same in-character
//      veil + reload as device loss (the save persists; a reload rebuilds
//      every GPU resource). One-frame hiccups never trip it.

interface GpuDeviceLike {
  addEventListener?: (type: string, fn: (e: { error?: { message?: string } }) => void) => void;
}

const ERR_STORE_KEY = 'delve:gpu-errors';
const STORM_COUNT = 40;        // errors …
const STORM_WINDOW_MS = 4000;  // … within this window = broken world, offer reload
let errCount = 0;
let stormStartAt = 0;
let stormCountInWindow = 0;
const firstMessages: string[] = [];
let hiddenAt = 0;
let lastHiddenGapMs = 0;

function installGpuErrorWatch(device: GpuDeviceLike): void {
  if (!device.addEventListener) return;
  // Track how long the tab was backgrounded — the field bug's trigger. Folded
  // into the stored diagnostic so "after a long tab-out" is data, not memory.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt) { lastHiddenGapMs = Date.now() - hiddenAt; hiddenAt = 0; }
  });
  device.addEventListener('uncapturederror', (e) => {
    const msg = e.error?.message ?? 'unknown GPU error';
    errCount++;
    if (firstMessages.length < 5) {
      firstMessages.push(msg);
      try {
        localStorage.setItem(ERR_STORE_KEY, JSON.stringify({
          at: new Date().toISOString(),
          hiddenGapS: Math.round(lastHiddenGapMs / 1000),
          count: errCount,
          messages: firstMessages,
        }));
      } catch { /* storage full/blocked — the console log below still fires */ }
      // eslint-disable-next-line no-console
      console.error(`[gpu] uncaptured error #${errCount} (last hidden gap ${Math.round(lastHiddenGapMs / 1000)}s):`, msg);
    }
    // Storm detection — reset the window when it lapses; veil once per life.
    const now = Date.now();
    if (now - stormStartAt > STORM_WINDOW_MS) { stormStartAt = now; stormCountInWindow = 0; }
    stormCountInWindow++;
    if (stormCountInWindow >= STORM_COUNT && !lost) {
      lost = true;   // idle the frame loop — every further frame just errors again
      // Carry the FIRST message onto the veil. The player is on a phone with no
      // console; without this the only thing they can report is the in-character
      // sentence, which names nothing — and the message that names the dead
      // resource sits in localStorage that nothing ever reads back.
      showVeil('something below has shifted', firstMessages[0]);
      showReload();
    }
  });
}

/** The stored diagnostic from the last uncaptured-error episode (or null).
 *  Read by the settings debug panel / a future report channel. */
export function getStoredGpuErrorReport(): string | null {
  try { return localStorage.getItem(ERR_STORE_KEY); } catch { return null; }
}

function showVeil(line: string, detail?: string): void {
  if (veil) return;
  veil = document.createElement('div');
  Object.assign(veil.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99998',
    background: 'rgba(2, 1, 0, 0.92)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    color: 'rgba(210, 175, 135, 0.85)',
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(16px, 4vw, 22px)',
    letterSpacing: '0.08em',
    textAlign: 'center',
    padding: '24px',
  } as Partial<CSSStyleDeclaration>);
  const msg = document.createElement('div');
  msg.textContent = line;
  veil.appendChild(msg);
  if (detail) {
    // Deliberately plain and small — this is a failure screen, and a player who
    // can read the cause out loud is worth more here than the register.
    const d = document.createElement('div');
    d.textContent = detail.slice(0, 300);
    Object.assign(d.style, {
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontStyle: 'normal', fontSize: '11px', lineHeight: '1.45',
      opacity: '0.55', maxWidth: '46ch', wordBreak: 'break-word',
    } as Partial<CSSStyleDeclaration>);
    veil.appendChild(d);
  }
  document.body.appendChild(veil);
}

function showReload(): void {
  if (!veil) return;
  const note = document.createElement('div');
  note.textContent = 'the dark holds. descend anew.';
  Object.assign(note.style, { fontSize: '13px', fontStyle: 'normal', opacity: '0.7' } as Partial<CSSStyleDeclaration>);
  const btn = document.createElement('button');
  btn.textContent = 'DESCEND AGAIN';
  Object.assign(btn.style, {
    marginTop: '4px',
    padding: '11px 26px',
    minHeight: '44px',
    borderRadius: '30px',
    border: '1px solid rgba(255, 190, 120, 0.55)',
    background: 'linear-gradient(180deg, rgba(80, 42, 22, 0.85), rgba(50, 24, 10, 0.85))',
    color: 'rgba(255, 230, 200, 0.98)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    cursor: 'pointer',
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); window.location.reload(); });
  veil.append(note, btn);
}

function hideVeil(): void {
  if (!veil) return;
  veil.remove();
  veil = null;
}
