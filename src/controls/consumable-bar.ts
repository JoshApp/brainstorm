import { getCount, removeItem, onInventoryChanged } from '../player/inventory';
import { recordConsumableUse } from '../state/character';
import { healPlayer, getPlayerHp, getPlayerMaxHp } from '../player/health';
import { ITEMS, type ItemSpec } from '../content/items';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { playHealSlurp, playBuffApply } from '../audio/sfx';
import { showInWorldMessage } from '../ui/pickup-notification';
import { FONT_UI } from '../ui/hud';
import { isDesktopLike } from './platform';

// Consumable hotbar — left-thumb cluster, above the joystick zone.
//
// Mobile-first layout (dedicated-heal): the HEAL flask is one big primary
// button at the bottom (closest to the resting thumb) — the panic button you
// can hit without looking. Other consumables (berserk, future) are smaller
// satellites stacked above it, so the rare stuff never crowds the heal.
//
// Why these choices on touch:
//   - Heal dominates combat, so it gets the biggest, most reachable target.
//   - Fire-on-RELEASE (not press): a stray graze while dragging the joystick
//     won't waste a scarce potion.
//   - Clear states with no hover: live count, dimmed when empty (hidden),
//     warm "full" tint at the carry cap, drain pulse + haptic on use.
//
// Generic over consumable kind (consumableHeal -> heal, consumableBuff ->
// buff); a new ItemSpec entry needs no UI change. Desktop also gets number-
// key hotkeys (see useConsumableSlot) with a slot badge on each button.

interface ButtonHandle {
  itemId: string;
  el: HTMLButtonElement;
  countLabel: HTMLSpanElement;
  badge: HTMLDivElement | null;   // desktop slot-number hint
  isHeal: boolean;
}

const ROW_BOTTOM = 150;   // px above safe-area bottom — heal near the thumb,
                          // satellites rise but stay clear of the top-left
                          // depth counter on short landscape screens.
const HEAL_SIZE = 76;     // big primary heal button
const SEC_SIZE = 50;      // smaller secondary consumables
const GAP = 8;

const HEAL_TINT_FALLBACK = 0xff2233;

let container: HTMLDivElement | null = null;
const buttons = new Map<string, ButtonHandle>();
// Slot order for hotkeys + badges: [heal, ...secondaries]. Heal = slot 1.
let order: string[] = [];

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

const isHealItem = (i: ItemSpec) => i.consumableHeal != null;

export function createConsumableBar() {
  if (container) return;

  container = document.createElement('div');
  container.id = 'consumable-bar';
  Object.assign(container.style, {
    position: 'fixed',
    left: 'calc(24px + env(safe-area-inset-left, 0px))',
    bottom: `calc(${ROW_BOTTOM}px + env(safe-area-inset-bottom, 0px))`,
    display: 'flex',
    flexDirection: 'column',  // stack vertically; heal pinned to the bottom
    alignItems: 'center',     // satellites centre over the big heal flask
    gap: `${GAP}px`,
    zIndex: '12',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(container);

  onInventoryChanged(rebuild);
  rebuild();
}

function rebuild() {
  if (!container) return;
  const held = Object.values(ITEMS).filter(
    (i) => i.kind === 'consumable' && getCount(i.id) > 0,
  );
  const heal = held.filter(isHealItem);
  const secondary = held.filter((i) => !isHealItem(i));
  const ordered = [...heal, ...secondary];   // heal = slot 1
  order = ordered.map((i) => i.id);
  const wanted = new Set(order);

  // Drop buttons for items no longer held.
  for (const [id, handle] of buttons) {
    if (!wanted.has(id)) {
      handle.el.remove();
      buttons.delete(id);
    }
  }

  // Ensure + update buttons; assign slot badges.
  ordered.forEach((item, idx) => {
    let handle = buttons.get(item.id);
    if (!handle) {
      handle = createButton(item, isHealItem(item));
      buttons.set(item.id, handle);
    }
    const count = getCount(item.id);
    handle.countLabel.textContent = String(count);
    const full = item.carryLimit != null && count >= item.carryLimit;
    handle.el.style.borderColor = full ? 'rgba(255, 210, 120, 0.9)' : tintBorder(readElixirTint(item));
    handle.countLabel.style.color = full ? 'rgba(255, 224, 150, 0.95)' : 'rgba(255, 220, 200, 0.92)';
    if (handle.badge) handle.badge.textContent = String(idx + 1);
  });

  // Re-order DOM so satellites sit ABOVE the heal flask (heal = last child =
  // bottom of the column). Re-appending an existing node just moves it.
  for (const item of [...secondary, ...heal]) {
    const handle = buttons.get(item.id);
    if (handle) container.appendChild(handle.el);
  }
}

function createButton(item: ItemSpec, isHeal: boolean): ButtonHandle {
  const size = isHeal ? HEAL_SIZE : SEC_SIZE;
  const tint = readElixirTint(item);

  const el = document.createElement('button');
  el.setAttribute('aria-label', `use ${item.name}`);
  Object.assign(el.style, {
    position: 'relative',
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    border: `2px solid ${tintBorder(tint)}`,
    background: tintBackground(tint),
    boxShadow: `0 0 ${isHeal ? 18 : 12}px ${tintShadow(tint)}`,
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, opacity 0.2s ease-out, border-color 0.2s',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
  } as Partial<CSSStyleDeclaration>);

  const icon = document.createElement('div');
  icon.innerHTML = flaskSvg(tint, isHeal ? 34 : 24);
  icon.style.lineHeight = '0';
  el.appendChild(icon);

  // Count badge — bottom-right, on the rim.
  const countLabel = document.createElement('span');
  countLabel.textContent = '0';
  Object.assign(countLabel.style, {
    position: 'absolute',
    bottom: isHeal ? '-2px' : '-4px',
    right: isHeal ? '2px' : '-2px',
    fontFamily: FONT_UI,
    fontSize: isHeal ? '13px' : '11px',
    fontWeight: '700',
    letterSpacing: '0.04em',
    color: 'rgba(255, 220, 200, 0.92)',
    textShadow: '0 0 5px rgba(0,0,0,0.95)',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(countLabel);

  // Desktop: a slot-number hint (top-left) — press the number to use.
  let badge: HTMLDivElement | null = null;
  if (isDesktopLike()) {
    badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'absolute',
      top: '1px',
      left: '4px',
      fontFamily: FONT_UI,
      fontSize: '9px',
      fontWeight: '700',
      color: 'rgba(190, 150, 110, 0.75)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(badge);
  }

  // Fire-on-release: press scales down for feedback; the actual use fires on
  // release, and a leave/cancel aborts — so a graze during a joystick drag
  // can't waste a potion.
  let pressed = false;
  const down = (e: Event) => { e.preventDefault(); pressed = true; el.style.transform = 'scale(0.9)'; };
  const up = (e: Event) => {
    e.preventDefault();
    el.style.transform = 'scale(1)';
    if (!pressed) return;
    pressed = false;
    useConsumable(item);
  };
  const cancel = () => { pressed = false; el.style.transform = 'scale(1)'; };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', cancel);

  return { itemId: item.id, el, countLabel, badge, isHeal };
}

/** Quick-use the FIRST consumable the player holds. Desktop 'Q' hotkey /
 *  future controller binding. Prefers healing when at sub-max HP. */
export function useFirstConsumable() {
  const all = Object.values(ITEMS).filter(
    (i) => i.kind === 'consumable' && getCount(i.id) > 0,
  );
  if (all.length === 0) return;
  const heal = all.find(isHealItem);
  const pick = heal && getPlayerHp() < getPlayerMaxHp() ? heal : all[0];
  useConsumable(pick);
}

/** Use the consumable in slot N (1-indexed; slot 1 = heal). Desktop number-
 *  key hotkeys. No-op for an empty slot. */
export function useConsumableSlot(slot: number) {
  const id = order[slot - 1];
  if (!id) return;
  const item = ITEMS[id];
  if (item) useConsumable(item);
}

function useConsumable(item: ItemSpec) {
  if (getCount(item.id) <= 0) return;

  // Healing — at full HP, don't burn a scarce potion. Give clear feedback
  // (the silent no-op read as a broken button) instead.
  if (item.consumableHeal != null) {
    if (getPlayerHp() >= getPlayerMaxHp()) {
      denyHealFeedback();
      return;
    }
    healPlayer(item.consumableHeal);
    playHealSlurp();
    hapticVibrate(12);
    drainPulse(item.id);
    removeItem(item.id);
    recordConsumableUse();
    return;
  }

  // Buff potions — apply to the player entity, consume.
  if (item.consumableBuff) {
    const player = get('player');
    if (player) applyBuff(player, item.consumableBuff.buffId, item.consumableBuff.duration);
    playBuffApply();
    hapticVibrate(12);
    drainPulse(item.id);
    removeItem(item.id);
    recordConsumableUse();
  }
}

/** "Already whole." — shake the heal flask + in-world line + soft double tap
 *  so the player learns the potion was withheld, not the button broken. */
function denyHealFeedback() {
  const heal = [...buttons.values()].find((b) => b.isHeal);
  heal?.el.animate(
    [
      { transform: 'translateX(0) scale(1)' },
      { transform: 'translateX(-4px) scale(1)' },
      { transform: 'translateX(4px) scale(1)' },
      { transform: 'translateX(-2px) scale(1)' },
      { transform: 'translateX(0) scale(1)' },
    ],
    { duration: 240, easing: 'ease-out' },
  );
  showInWorldMessage('Already whole.');
  hapticVibrate(8);
}

/** Brief bright pulse on use — reads as the flask draining. */
function drainPulse(itemId: string) {
  const h = buttons.get(itemId);
  h?.el.animate(
    [{ filter: 'brightness(1.8)', transform: 'scale(1.06)' }, { filter: 'brightness(1)', transform: 'scale(1)' }],
    { duration: 240, easing: 'ease-out' },
  );
}

// ── Flask icon ────────────────────────────────────────────────────────────
// A small glass flask with tinted liquid — reads as a potion at a glance, far
// clearer than the old alchemical glyph. Liquid colour = the item's elixir
// tint (red = heal, orange = berserk), so types are distinguishable instantly.
function flaskSvg(tint: number, px: number): string {
  const liquid = rgbCss(tint);
  const glass = 'rgba(220,226,236,0.55)';
  const glassFill = 'rgba(220,226,236,0.10)';
  return `<svg viewBox="0 0 24 28" width="${px}" height="${(px * 28) / 24}" aria-hidden="true">
    <rect x="9" y="1" width="6" height="3" rx="1" fill="#5a3d22"/>
    <rect x="9.6" y="3.6" width="4.8" height="4.4" fill="${glassFill}" stroke="${glass}" stroke-width="0.7"/>
    <path d="M9.6 8 L14.4 8 C15 11 19 13 19 18 C19 22.4 16 25.5 12 25.5 C8 25.5 5 22.4 5 18 C5 13 9 11 9.6 8 Z"
      fill="${glassFill}" stroke="${glass}" stroke-width="0.9"/>
    <path d="M6.1 14.5 C5.4 15.6 5 16.8 5 18 C5 22.4 8 25.5 12 25.5 C16 25.5 19 22.4 19 18 C19 16.8 18.6 15.6 17.9 14.5 Z"
      fill="${liquid}" opacity="0.92"/>
    <ellipse cx="12" cy="14.5" rx="6" ry="1.2" fill="${liquid}"/>
    <path d="M8.4 9.5 C7.3 12 7 14.5 7.4 17" stroke="rgba(255,255,255,0.45)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Pull the elixir's emissive color from the item's drop model so the button
// matches the in-world potion glow (red = heal, orange = berserk).
function readElixirTint(item: ItemSpec): number {
  const mat = item.dropModel.materials['elixir'];
  if (mat && mat.emissive != null) return mat.emissive;
  return HEAL_TINT_FALLBACK;
}

function tintBorder(tint: number): string { return rgbaCss(tint, 0.55); }
function tintBackground(tint: number): string { return rgbaCss(tint, 0.18); }
function tintShadow(tint: number): string { return rgbaCss(tint, 0.30); }

function rgbCss(hex: number): string {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
function rgbaCss(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
