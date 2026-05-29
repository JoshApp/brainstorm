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
let buttonEl: HTMLButtonElement | null = null;

export function mountDebugButton(ctx: DebugContext): void {
  if (mounted) return;
  mounted = true;

  const btn = document.createElement('button');
  buttonEl = btn;
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
      const id = makeId(snap);

      // All four screenshot layers.
      const images = [
        { name: 'annotated', dataUrl: snap.screenshot.pngDataUrl },
        { name: 'geometry', dataUrl: snap.overlays.geometry },
        { name: 'light', dataUrl: snap.overlays.lightHeat },
        { name: 'cone', dataUrl: snap.overlays.cone },
      ];

      // PREFERRED PATH: POST to the dev server, which writes
      // debug-captures/<id>/ to disk for Claude to read by id. Strip the
      // heavy image dataUrls out of the JSON (they go as PNG files).
      const uploaded = await tryUpload(id, text, stripImages(snap), images);

      if (uploaded) {
        toast(`✓ captured: ${id} — tell Claude "read debug capture ${id}"`);
      } else {
        // FALLBACK (live URL / no dev server): clipboard + downloads.
        let clip = false;
        try { await navigator.clipboard.writeText(text); clip = true; } catch {
          downloadDataUrl('data:text/plain;charset=utf-8,' + encodeURIComponent(text), `${id}-report.txt`);
        }
        for (const img of images) downloadDataUrl(img.dataUrl, `${id}-${img.name}.png`);
        toast(clip
          ? `copied report + downloaded ${images.length} shots (id ${id})`
          : `downloaded report + ${images.length} shots (id ${id})`);
      }
      // eslint-disable-next-line no-console
      console.log(`[debug capture ${id}]\n` + text);
    } catch (err) {
      toast('capture failed: ' + ((err as Error).message ?? 'error'));
    } finally {
      btn.textContent = orig;
      busy = false;
    }
  });

  document.body.appendChild(btn);
}

/** Remove the capture button (live toggle-off from settings). The toast
 *  element + console buffer are left in place — both are harmless when
 *  idle and cheap to keep. */
export function unmountDebugButton(): void {
  if (buttonEl) {
    buttonEl.remove();
    buttonEl = null;
  }
  mounted = false;
}

/** POST the capture bundle to the dev-server endpoint. Returns true on
 *  success, false if there's no endpoint (live URL) or it errored — the
 *  caller then falls back to clipboard + download. */
async function tryUpload(
  id: string,
  report: string,
  snapshot: unknown,
  images: Array<{ name: string; dataUrl: string }>,
): Promise<boolean> {
  try {
    const res = await fetch('/__debug/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, report, snapshot, images }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json && json.ok);
  } catch {
    return false; // network error / no endpoint
  }
}

/** Short, paste-friendly id: floor + 4 random base36 chars. Avoids
 *  Date.now collisions across rapid captures. */
function makeId(snap: { observation: { depth: number } }): string {
  const rnd = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `d${snap.observation.depth}-${rnd}`;
}

/** Drop the big base64 image dataUrls from the snapshot before it's
 *  written as JSON — the images are saved as separate PNG files, so the
 *  JSON stays readable. */
function stripImages(snap: object): unknown {
  const { screenshot, overlays, ...rest } = snap as Record<string, unknown>;
  void screenshot; void overlays;
  return rest;
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
