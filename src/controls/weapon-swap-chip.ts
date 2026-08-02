import { getSidearm, onEquipmentChanged } from '../player/equipment';
import { getItemThumbnail, itemImageUrl } from '../ui/item-thumbnail';

// WEAPON-SWAP CHIP — the one-thumb loadout control (task #96).
//
// A small button on the RIGHT (weapon-hand) side of the thumb zone showing the
// SHEATHED alternate weapon — tap it to draw that weapon and sheathe the current
// one. Only appears when you actually carry a second weapon; otherwise it's out
// of the way. It's a `.game-hud` button, a separate DOM node above the canvas, so
// the right-side attack tap-zone (bound to the canvas) never sees taps that land
// on it — same coexistence the flask relies on.
//
// The chip is pure presentation + input: the actual swap (and its combat-state
// guard) lives at the call site (main.ts), passed in as onSwap.

let el: HTMLButtonElement | null = null;
let iconImg: HTMLImageElement | null = null;

/** Build the swap chip and wire its tap to `onSwap`. Idempotent. */
export function createWeaponSwapChip(onSwap: () => void): void {
  if (el || typeof document === 'undefined') return;

  el = document.createElement('button');
  el.id = 'weapon-swap-chip';
  el.classList.add('game-hud');
  el.setAttribute('aria-label', 'swap weapon');
  Object.assign(el.style, {
    position: 'fixed',
    right: 'calc(22px + env(safe-area-inset-right, 0px))',
    bottom: 'calc(150px + env(safe-area-inset-bottom, 0px))',   // above the attack thumb-rest, mirrors the flask height
    width: '58px', height: '58px', borderRadius: '14px',
    border: '2px solid rgba(255, 200, 140, 0.42)',
    background: 'rgba(30, 18, 10, 0.62)',
    boxShadow: '0 0 14px rgba(255, 140, 60, 0.18), inset 0 1px 2px rgba(255,220,180,0.12)',
    padding: '0', overflow: 'visible',
    display: 'none',   // hidden until a sidearm exists
    alignItems: 'center', justifyContent: 'center',
    zIndex: '12', touchAction: 'manipulation', userSelect: 'none',
    WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, background 0.08s ease-out',
  } as Partial<CSSStyleDeclaration>);

  iconImg = document.createElement('img');
  Object.assign(iconImg.style, {
    width: '84%', height: '84%', objectFit: 'contain',
    imageRendering: 'pixelated', pointerEvents: 'none',
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.7))',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(iconImg);

  // A small swap glyph in the corner so the chip reads as "switch to this",
  // not "a weapon sitting here".
  const glyph = document.createElement('div');
  glyph.textContent = '⇄';
  Object.assign(glyph.style, {
    position: 'absolute', top: '-8px', left: '-8px',
    width: '22px', height: '22px', borderRadius: '50%',
    background: 'rgba(20, 12, 7, 0.92)', border: '1px solid rgba(255,200,140,0.5)',
    color: 'rgba(255, 220, 180, 0.95)', fontSize: '13px', lineHeight: '20px',
    textAlign: 'center', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(glyph);

  // Fire on release, with a press-scale + cancel-on-drag (a graze during an
  // attack swipe shouldn't swap).
  let pressed = false;
  const down = (e: Event) => { e.preventDefault(); pressed = true; el!.style.transform = 'scale(0.9)'; };
  const up = (e: Event) => {
    e.preventDefault();
    el!.style.transform = 'scale(1)';
    if (!pressed) return;
    pressed = false;
    onSwap();
  };
  const cancel = () => { pressed = false; if (el) el.style.transform = 'scale(1)'; };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', cancel);

  document.body.appendChild(el);

  // Keep the icon + visibility in sync with the sheathed weapon.
  onEquipmentChanged(() => refresh());
  refresh();
}

/** A short pulse on the chip when a swap fires — the draw reads as a beat. */
export function pulseWeaponSwapChip(): void {
  if (!el || el.style.display === 'none') return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(1)' }],
    { duration: 220, easing: 'ease-out' },
  );
}

function refresh(): void {
  if (!el || !iconImg) return;
  const alt = getSidearm();
  if (!alt) { el.style.display = 'none'; return; }
  // The icon is best-effort — a thumbnail rig that isn't ready (or a headless
  // snap) must NOT hide the chip; the ⇄ glyph alone still reads as "swap".
  let src: string | null = null;
  try { src = itemImageUrl(alt) ?? getItemThumbnail(alt); } catch { src = null; }
  iconImg.src = src ?? '';
  iconImg.style.display = src ? 'block' : 'none';
  el.style.display = 'flex';
}
