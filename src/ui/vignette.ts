import { CONFIG } from '../config';

// Red vignette overlay — used for both damage hit-flashes and the death state.
// Pure DOM, radial gradient transparent in the middle to dark red at the edges.
// Two independent layers:
//   - flash: short, intense, fades back to 0 (damage taken)
//   - persistent: held by external controllers (death sequence ramps this up)
// The two are composited via separate divs so they don't fight each other.

let flashEl: HTMLDivElement | null = null;
let persistentEl: HTMLDivElement | null = null;

function baseStyle() {
  return {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '8',
    opacity: '0',
    transition: 'opacity 0.28s ease-out',
    willChange: 'opacity',
  } as Partial<CSSStyleDeclaration>;
}

function ensureElements() {
  if (flashEl && persistentEl) return;

  persistentEl = document.createElement('div');
  persistentEl.id = 'vignette-persistent';
  Object.assign(persistentEl.style, baseStyle());
  persistentEl.style.background =
    'radial-gradient(ellipse at center, transparent 30%, rgba(140, 10, 10, 0.35) 75%, rgba(60, 0, 0, 0.85) 100%)';
  persistentEl.style.transition = 'opacity 1.4s ease-in';
  document.body.appendChild(persistentEl);

  flashEl = document.createElement('div');
  flashEl.id = 'vignette-flash';
  Object.assign(flashEl.style, baseStyle());
  flashEl.style.background =
    'radial-gradient(ellipse at center, transparent 5%, rgba(170, 20, 20, 0.6) 60%, rgba(120, 0, 0, 0.95) 100%)';
  document.body.appendChild(flashEl);
}

/** Damage hit-flash: instant red bloom that fades back to 0. */
export function flashVignette() {
  ensureElements();
  if (!flashEl) return;
  // Snap to full opacity (no transition), then transition back to 0.
  flashEl.style.transition = 'none';
  flashEl.style.opacity = String(CONFIG.VIGNETTE_FLASH_OPACITY);
  // Force a reflow so the next style change actually transitions.
  void flashEl.offsetWidth;
  flashEl.style.transition = `opacity ${CONFIG.VIGNETTE_FLASH_FADE_MS}ms ease-out`;
  flashEl.style.opacity = '0';
}

/** Set persistent vignette opacity directly (used by death sequence). */
export function setPersistentVignette(opacity: number, transitionMs?: number) {
  ensureElements();
  if (!persistentEl) return;
  if (transitionMs !== undefined) {
    persistentEl.style.transition = `opacity ${transitionMs}ms ease-in`;
  }
  persistentEl.style.opacity = String(Math.max(0, Math.min(1, opacity)));
}
