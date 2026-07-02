import { requestLux, showLuxCard } from './lux';

// LUX button — `?lux=1` on ANY build (it's a safe read-only diagnostic:
// measures pixels, changes nothing), always present in DEV. One tap →
// overlay card with the numbers + room context; a phone screenshot of
// that card is a complete bug report for light tuning.
// STICKY: ?lux=1 persists to localStorage (and ?lux=0 clears it) so
// the button survives the PWA's start_url launch, which carries no
// query params. The service worker's cache cycle still applies — a
// fresh deploy needs one open/close before the new bundle serves.
export function mountLuxButtonIfEnabled(): void {
  const luxParam = new URLSearchParams(window.location.search).get('lux');
  if (luxParam === '1') localStorage.setItem('delve-lux', '1');
  if (luxParam === '0') localStorage.removeItem('delve-lux');
  if (!import.meta.env.DEV && localStorage.getItem('delve-lux') !== '1') return;
  const btn = document.createElement('button');
  btn.textContent = 'LUX';
  Object.assign(btn.style, {
    position: 'fixed', top: '40%', right: '8px', zIndex: '9998',
    background: 'rgba(10,12,18,0.8)', color: '#9fb2cc',
    font: '10px ui-monospace, monospace', padding: '7px 9px',
    border: '1px solid #2a3242', borderRadius: '5px', opacity: '0.6',
  } as Partial<CSSStyleDeclaration>);
  btn.onclick = () => { requestLux().then(showLuxCard); };
  document.body.appendChild(btn);
}
