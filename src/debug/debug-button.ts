// On-screen debug capture button. Shown only with ?debug=1.
//
// A discreet chip in the top-centre (clear of the left movement joystick
// and the right look zone). One tap:
//   1. grabs a debug snapshot
//   2. copies the compact text report to the clipboard (paste into chat)
//   3. downloads the annotated screenshot PNG (so the image reaches chat)
//   4. flashes a confirmation toast
//
// All failures are surfaced in the toast rather than thrown — a broken
// capture mid-glitch shouldn't take the game down with it.

import type { DebugContext } from './capture';
import { captureDebugSnapshot, formatSnapshotText } from './capture';

let mounted = false;
let busy = false;

export function mountDebugButton(ctx: DebugContext): void {
  if (mounted) return;
  mounted = true;

  const btn = document.createElement('button');
  btn.textContent = '⊕ CAPTURE';
  Object.assign(btn.style, {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top, 0px))',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 14px',
    background: 'rgba(20, 14, 10, 0.7)',
    border: '1px solid rgba(255, 180, 90, 0.55)',
    borderRadius: '4px',
    color: 'rgba(255, 210, 160, 0.9)',
    fontFamily: 'ui-monospace, monospace',
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.18em',
    zIndex: '9998',
    cursor: 'pointer',
    // Don't let the button eat look/move drags that start elsewhere.
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (busy) return;
    busy = true;
    const orig = btn.textContent;
    btn.textContent = '… CAPTURING';
    try {
      const snap = await captureDebugSnapshot(ctx);
      const text = formatSnapshotText(snap);

      let clip = false;
      try {
        await navigator.clipboard.writeText(text);
        clip = true;
      } catch {
        // Clipboard can fail (permissions / insecure context). Fall back
        // to a downloadable .txt so the report is never lost.
        downloadDataUrl(
          'data:text/plain;charset=utf-8,' + encodeURIComponent(text),
          filename(snap, 'txt'),
        );
      }

      // Always download the annotated screenshot so the image reaches chat.
      downloadDataUrl(snap.screenshot.pngDataUrl, filename(snap, 'png'));

      toast(clip
        ? 'COPIED to clipboard + screenshot downloaded — paste into chat'
        : 'report + screenshot downloaded');
      // Also log the text so it's grabbable from devtools on desktop.
      // eslint-disable-next-line no-console
      console.log('[debug capture]\n' + text);
    } catch (err) {
      toast('capture failed: ' + ((err as Error).message ?? 'error'));
    } finally {
      btn.textContent = orig;
      busy = false;
    }
  });

  document.body.appendChild(btn);
}

function filename(snap: { observation: { floorId: string; roomId: string | null } }, ext: string): string {
  const room = snap.observation.roomId ?? 'noroom';
  const safe = `${snap.observation.floorId}-${room}`.replace(/[^a-z0-9-]/gi, '_');
  return `delve-capture-${safe}.${ext}`;
}

function downloadDataUrl(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    Object.assign(toastEl.style, {
      position: 'fixed',
      top: 'calc(44px + env(safe-area-inset-top, 0px))',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '7px 14px',
      background: 'rgba(20, 14, 10, 0.92)',
      border: '1px solid rgba(255, 180, 90, 0.5)',
      borderRadius: '4px',
      color: 'rgba(255, 220, 180, 0.95)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      maxWidth: '80vw',
      textAlign: 'center',
      zIndex: '9999',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.display = 'none';
  }, 3200);
}
