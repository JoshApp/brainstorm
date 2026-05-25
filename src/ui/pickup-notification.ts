import { on } from '../broadcast/event-bus';
import { ITEMS } from '../content/items';

// Brief upper-center label that fades in and out when an item is picked up.
// Stays warm/dim (in-world register, not broadcast register) so it doesn't
// compete with achievement toasts in the upper-right.

const SHOW_MS = 2200;
const FADE_MS = 280;

let label: HTMLDivElement | null = null;
let hideTimer: number | undefined;

export function createPickupNotification() {
  if (label) return;

  label = document.createElement('div');
  label.id = 'pickup-notification';
  Object.assign(label.style, {
    position: 'fixed',
    left: '50%',
    top: 'calc(48px + env(safe-area-inset-top, 0px))',
    transform: 'translateX(-50%) translateY(-6px)',
    padding: '10px 18px',
    color: 'rgba(255, 220, 180, 0.95)',
    background: 'rgba(20, 12, 8, 0.7)',
    border: '1px solid rgba(255, 180, 110, 0.45)',
    borderRadius: '3px',
    fontFamily: 'Georgia, "Times New Roman", serif',  // in-world voice = serif
    fontStyle: 'italic',
    fontSize: '15px',
    textShadow: '0 0 6px rgba(0,0,0,0.9)',
    letterSpacing: '0.04em',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '11',
    transition: `opacity ${FADE_MS}ms ease-out, transform ${FADE_MS}ms ease-out`,
    maxWidth: 'min(420px, 80vw)',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(label);

  on((event) => {
    if (event.type !== 'item:picked-up') return;
    show(ITEMS[event.itemId]?.name ?? event.itemId);
  });
}

function show(text: string) {
  if (!label) return;
  label.textContent = text;
  label.style.opacity = '1';
  label.style.transform = 'translateX(-50%) translateY(0)';
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!label) return;
    label.style.opacity = '0';
    label.style.transform = 'translateX(-50%) translateY(-6px)';
  }, SHOW_MS);
}
