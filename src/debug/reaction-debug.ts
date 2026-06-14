// DEV-only on-screen confirmation for the reactive-defense beats — so you can
// SEE, on the phone, the exact frame a parry or perfect dodge registered (and,
// for the dodge, how long the bullet-time window then runs). Pure diagnostic:
// every entry point hard-returns unless DEV, and the overlay DOM is only ever
// built under the dev server, so nothing reaches the live build.

import { DEV } from './dev';

let el: HTMLDivElement | null = null;
let hideAt = 0;
let rafPending = false;

function ensure(): HTMLDivElement | null {
  if (!DEV || typeof document === 'undefined') return null;
  if (el) return el;
  el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:20%', 'transform:translateX(-50%)',
    'font:700 22px/1.2 ui-monospace,monospace', 'letter-spacing:2px',
    'padding:6px 16px', 'border-radius:6px', 'pointer-events:none',
    'z-index:99999', 'opacity:0', 'transition:opacity 70ms',
    'background:rgba(0,0,0,0.5)', 'text-shadow:0 2px 6px #000',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function tick(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (!el) return;
    if (performance.now() >= hideAt) { el.style.opacity = '0'; return; }
    tick();
  });
}

/** DEV-only: flash a reaction label centred near the top for `holdMs`. */
export function flashReaction(label: string, color: string, holdMs = 600): void {
  if (!DEV) return;
  const e = ensure();
  if (!e) return;
  e.textContent = label;
  e.style.color = color;
  e.style.opacity = '1';
  hideAt = performance.now() + holdMs;
  tick();
}
