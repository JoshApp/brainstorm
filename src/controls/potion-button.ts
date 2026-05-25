import { getCount, removeItem } from '../player/inventory';
import { healPlayer, getPlayerHp, getPlayerMaxHp } from '../player/health';
import { ITEMS } from '../content/items';

// Small potion button on the left edge of the screen, above the joystick
// zone. Shows current potion count. Tap to drink one (consumes inventory,
// heals the player). Greyed out when count = 0 or when HP is at max.
//
// Single button for now — when more consumables exist we'll either cycle
// them, or replace with a small hotbar (3 slots).

const POTION_ID = 'healing-potion';

let button: HTMLButtonElement | null = null;
let countLabel: HTMLSpanElement | null = null;
let lastCount = -1;
let lastHpAtMax = false;

export function createPotionButton() {
  if (button) return;

  button = document.createElement('button');
  button.id = 'potion-button';
  button.setAttribute('aria-label', 'drink potion');
  Object.assign(button.style, {
    position: 'fixed',
    left: 'calc(24px + env(safe-area-inset-left, 0px))',
    bottom: 'calc(220px + env(safe-area-inset-bottom, 0px))',  // above joystick + use button
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    border: '2px solid rgba(255, 100, 100, 0.55)',
    background: 'rgba(50, 12, 14, 0.7)',
    color: 'rgba(255, 200, 200, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '22px',
    lineHeight: '1',
    boxShadow: '0 0 14px rgba(255, 60, 60, 0.30)',
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
    zIndex: '12',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, opacity 0.2s ease-out',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1px',
  } as Partial<CSSStyleDeclaration>);

  const icon = document.createElement('span');
  icon.textContent = '🜢';   // alchemical-ish symbol (no emoji — fits the tone)
  icon.style.fontSize = '20px';
  icon.style.lineHeight = '1';

  countLabel = document.createElement('span');
  countLabel.textContent = '0';
  countLabel.style.fontSize = '11px';
  countLabel.style.fontWeight = '700';
  countLabel.style.letterSpacing = '0.05em';
  countLabel.style.opacity = '0.8';

  button.appendChild(icon);
  button.appendChild(countLabel);

  const press = (e: Event) => {
    e.preventDefault();
    if (button!.style.opacity === '0.35') return;  // disabled state
    const item = ITEMS[POTION_ID];
    if (!item || !item.consumableHeal) return;
    if (getCount(POTION_ID) <= 0) return;
    if (getPlayerHp() >= getPlayerMaxHp()) return;

    healPlayer(item.consumableHeal);
    removeItem(POTION_ID);

    button!.style.transform = 'scale(0.92)';
  };
  const release = () => {
    button!.style.transform = 'scale(1)';
  };
  button.addEventListener('touchstart', press, { passive: false });
  button.addEventListener('touchend', release);
  button.addEventListener('touchcancel', release);
  button.addEventListener('mousedown', press);
  button.addEventListener('mouseup', release);
  button.addEventListener('mouseleave', release);

  document.body.appendChild(button);
}

/** Call each frame — keeps the count label + enabled state in sync. */
export function updatePotionButton() {
  if (!button || !countLabel) return;
  const count = getCount(POTION_ID);
  const hpAtMax = getPlayerHp() >= getPlayerMaxHp();

  if (count !== lastCount) {
    countLabel.textContent = String(count);
    lastCount = count;
  }

  const disabled = count <= 0 || hpAtMax;
  // Only mutate DOM when state changes to avoid layout thrash.
  if (disabled !== (lastHpAtMax || lastCount === 0)) {
    button.style.opacity = disabled ? '0.35' : '1';
    button.style.pointerEvents = disabled ? 'none' : 'auto';
  }
  lastHpAtMax = hpAtMax;
}
