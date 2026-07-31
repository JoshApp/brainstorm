// The RITE button — the active lane's one thumb control. A circular button in
// the right thumb-zone (opposite the consumable bar) whose fill is your HUNGER
// charging toward the equipped rite's cost; tap when full to erupt. Hidden
// entirely when no rite is slotted, so builds without one keep a clean HUD.

import { getHunger, getEquippedRite } from '../state/run-state';
import { RITES } from '../content/rites';
import { tryActivateRite } from '../combat/rites';

let btn: HTMLButtonElement | null = null;
let label: HTMLSpanElement | null = null;

export function createRiteButton(): void {
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'rite-button';
  Object.assign(btn.style, {
    position: 'fixed',
    right: 'max(20px, env(safe-area-inset-right, 0px))',
    bottom: 'calc(110px + env(safe-area-inset-bottom, 0px))',
    width: '66px', height: '66px', borderRadius: '50%',
    border: '2px solid #5e120d',
    color: '#f0d8c0', fontFamily: 'serif', fontSize: '11px', fontWeight: '700',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    touchAction: 'manipulation', zIndex: '40', userSelect: 'none', cursor: 'pointer',
    boxShadow: '0 3px 12px rgba(0,0,0,0.5)',
  } as Partial<CSSStyleDeclaration>);
  label = document.createElement('span');
  label.textContent = 'RITE';
  btn.appendChild(label);
  // Fire on tap; tryActivateRite no-ops if Hunger is short, so a tap is never wasted.
  const fire = (ev: Event) => { ev.preventDefault(); tryActivateRite(); };
  btn.addEventListener('click', fire);
  document.body.appendChild(btn);
}

/** Refresh the button each frame: visibility (rite slotted?), the Hunger fill
 *  arc toward the rite's cost, and a "ready" brighten. Cheap; early-outs hidden. */
export function tickRiteButton(): void {
  if (!btn) return;
  const id = getEquippedRite();
  const spec = id ? RITES[id] : undefined;
  if (!spec) { btn.style.display = 'none'; return; }
  btn.style.display = 'flex';

  const frac = Math.min(1, getHunger() / spec.hungerCost);
  const ready = frac >= 1;
  const deg = frac * 360;
  const lit = ready ? '#d8392a' : '#8a1a12';
  btn.style.background = `conic-gradient(${lit} ${deg}deg, rgba(36,8,6,0.9) ${deg}deg)`;
  btn.style.opacity = ready ? '1' : '0.72';
  btn.style.borderColor = ready ? '#d8392a' : '#5e120d';
}
