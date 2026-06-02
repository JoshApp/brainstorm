// On-screen debug readout for eye dark-adaptation. Shows torch proximity, the
// 0..1 adaptation value (with a bar), and the resulting ambient intensity, so
// you can watch the effect engage as you move between torchlit and torchless
// areas. Mounted only when debug mode is on (?debug=1 or the DEBUG setting).

let el: HTMLDivElement | null = null;
let visible = true;

/** Show/hide the readout. Driven by the DEBUG settings tab. */
export function setDarkAdaptReadoutVisible(v: boolean): void {
  visible = v;
  if (el) el.style.display = v ? 'block' : 'none';
}

export function initDarkAdaptReadout(): void {
  if (el) return;
  el = document.createElement('div');
  el.id = 'dark-adapt-debug';
  el.style.display = visible ? 'block' : 'none';
  Object.assign(el.style, {
    position: 'fixed',
    left: 'calc(16px + env(safe-area-inset-left, 0px))',
    top: 'calc(76px + env(safe-area-inset-top, 0px))',  // under the depth counter
    font: '11px monospace',
    lineHeight: '1.35',
    color: 'rgba(150, 220, 160, 0.92)',
    background: 'rgba(0, 0, 0, 0.45)',
    padding: '4px 7px',
    borderRadius: '3px',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    zIndex: '60',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
}

/** Per-frame update. No-op (and allocates nothing) when not mounted.
 *  `lit` = estimated light on the surface you're facing (torch + lamp). */
export function updateDarkAdaptReadout(lit: number, adaptation: number, brightness: number): void {
  if (!el || !visible) return;
  const filled = Math.round(adaptation * 12);
  const bar = '█'.repeat(filled) + '·'.repeat(12 - filled);
  el.textContent =
    `eye-adapt ${adaptation.toFixed(2)} [${bar}]\n` +
    `lit ${lit.toFixed(2)}\n` +
    `brightness ×${brightness.toFixed(2)}`;
}
