// WebGL context-loss recovery.
//
// Mobile GPUs drop the WebGL context under memory pressure or on backgrounding.
// By DEFAULT that's a permanent black screen — and worse here, the next render
// call would throw and trip the fatal crash overlay for something that's
// actually recoverable. The browser will only RESTORE the context if we
// preventDefault() on the lost event, so we do: gate the frame loop
// (isContextLost), show a brief in-character veil, and on restore rebuild the
// custom render targets and resume. Without this, a tab-switch can brick a run.

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

function showVeil(line: string): void {
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
