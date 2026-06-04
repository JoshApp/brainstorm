import { staminaStore, type StaminaState } from '../state/hud-stores';
import { bind } from './hud';

// Thin stamina gauge, sitting just above the HP pips at bottom-center.
// Deliberately quieter than the HP bar: HP is discrete warm-orange pips
// (count your hits); stamina is one continuous cold steel-blue sliver
// (a breath meter). The cool/warm split keeps the two resources instantly
// distinct in peripheral vision.
//
// Auto-hides when rested. Stamina is irrelevant most of the time — you
// only spend it on charged swings and shots — so a permanent gauge would
// be HUD clutter against the grimdark restraint. It fades in the instant
// you spend and fades back out once it's full again, so it reads as a
// transient "you're winded" signal rather than chrome.
//
// Store-bound (staminaStore), so the fill only writes to the DOM when the
// fraction actually moves; idling at full produces zero churn.

let container: HTMLDivElement | null = null;
let fill: HTMLDivElement | null = null;

const BAR_W = 200;   // matches the HP pip row's rough footprint
const BAR_H = 5;

export function createStaminaBar() {
  if (container) return;
  container = document.createElement('div');
  container.id = 'stamina-bar';
  Object.assign(container.style, {
    position: 'fixed',
    left: '50%',
    // Sits above the HP pips (those are at bottom 20 + 12 tall).
    bottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    width: `${BAR_W}px`,
    height: `${BAR_H}px`,
    borderRadius: '3px',
    border: '1px solid rgba(150, 180, 200, 0.30)',
    background: 'rgba(8, 12, 16, 0.5)',
    boxShadow: 'inset 0 0 4px rgba(0,0,0,0.7)',
    overflow: 'hidden',
    zIndex: '10',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.45s ease-out',
  } as Partial<CSSStyleDeclaration>);

  fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    transformOrigin: 'left center',
    background: 'linear-gradient(180deg, rgba(150, 195, 215, 0.92), rgba(70, 110, 140, 0.92))',
    boxShadow: '0 0 6px rgba(120, 180, 210, 0.35)',
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(fill);
  document.body.appendChild(container);

  // Exhausted flash — a brief red pulse on the whole bar when the player
  // bottoms out, so a gated dash / shot reads as "you're gassed" rather than
  // an unresponsive tap. Injected once.
  if (!document.getElementById('stamina-flash-kf')) {
    const style = document.createElement('style');
    style.id = 'stamina-flash-kf';
    style.textContent =
      '@keyframes staminaGassed{0%{box-shadow:0 0 0 1px rgba(230,90,70,0)}' +
      '35%{box-shadow:0 0 8px 2px rgba(230,90,70,0.85)}' +
      '100%{box-shadow:0 0 0 1px rgba(230,90,70,0)}}';
    document.head.appendChild(style);
  }

  bind(staminaStore, render);
}

/** Re-pulse the gassed flash imperatively. Called when a committal action
 *  (dash / shot) is gated because the bar's empty, so the rejected tap reads
 *  as "you're out" right then, not just from the ambient red. */
export function flashStaminaBar(): void {
  if (!container) return;
  container.style.opacity = '1';
  container.style.animation = 'none';
  // Force reflow so re-assigning the same animation restarts it.
  void container.offsetWidth;
  container.style.animation = 'staminaGassed 0.5s ease-out';
}

function render({ frac, rested, exhausted }: StaminaState) {
  if (!container || !fill) return;
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  // Tint red when nearly empty so a dry meter reads as "you can't" at a
  // glance, not just "low".
  fill.style.background = frac < 0.2
    ? 'linear-gradient(180deg, rgba(210, 110, 90, 0.92), rgba(150, 50, 40, 0.92))'
    : 'linear-gradient(180deg, rgba(150, 195, 215, 0.92), rgba(70, 110, 140, 0.92))';
  // Gassed pulse — restart the animation each time we (re-)enter exhausted by
  // toggling the property off then on.
  container.style.animation = exhausted ? 'staminaGassed 0.5s ease-out' : 'none';
  // Stay visible while gassed even if somehow rested, so the flash is seen.
  container.style.opacity = rested && !exhausted ? '0' : '1';
}
