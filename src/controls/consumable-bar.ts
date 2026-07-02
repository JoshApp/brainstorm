import { getCount, removeItem, onInventoryChanged } from '../player/inventory';
import { recordConsumableUse } from '../state/character';
import { healPlayer, getPlayerHp, getPlayerMaxHp } from '../player/health';
import { getFlask, addCharges, addCapacity, onFlaskChanged } from '../player/flask';
import { requestFlaskDrink, isDrinkingFlask, getDrinkProgress, hasSipLanded } from '../player/flask-drink';
import { ITEMS, type ItemSpec } from '../content/items';
import { applyBuff } from '../ecs/buffs';
import { phialMutationId } from '../state/phial-identities';
import { applyMutationWithFeedback } from '../player/apply-mutation';
import { emit } from '../broadcast/event-bus';
import { get } from '../ecs/world';
import { playHealSlurp, playBuffApply, playDenied, playFlaskUncork } from '../audio/sfx';
import { showInWorldMessage } from '../ui/pickup-notification';
import { FONT_UI } from '../ui/hud';
import { isDesktopLike } from './platform';
import { hexCss, hexRgba } from '../style/color-utils';

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
// The flask is GOLD — liquid light in the Elden Ring register, not medicine-red.
// Satellite potions keep their elixir tints (legacy heal red, berserk orange);
// the flask alone owns the warm gold so it reads as THE heal at a glance.
const ESTUS_GOLD = 0xffb43c;

const FLASK_ID = '__flask__';   // synthetic id for the always-present flask button

let container: HTMLDivElement | null = null;
const buttons = new Map<string, ButtonHandle>();
let flaskEl: HTMLButtonElement | null = null;
let flaskPips: HTMLDivElement | null = null;   // charge pips — one per capacity, lit while held
let flaskIcon: HTMLDivElement | null = null;   // re-rendered on charge change (liquid level)
let ringEl: SVGCircleElement | null = null;    // drink-progress ring (tickFlaskDrinkUi)
let ringCircumference = 0;
let ringWasDrinking = false;
let ringSawSip = false;
// Slot order for hotkeys + badges: [flask, ...secondaries]. Flask = slot 1.
let order: string[] = [];

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

export function createConsumableBar() {
  if (container) return;

  container = document.createElement('div');
  container.id = 'consumable-bar'; container.classList.add('game-hud');
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

  ensureFlaskButton();            // the always-present primary heal (the Estus flask)
  onFlaskChanged(updateFlaskButton);
  onInventoryChanged(rebuild);
  rebuild();
}

function rebuild() {
  if (!container) return;
  // The FLASK is the always-present primary heal (its own button, driven by
  // player/flask.ts). Every held consumable — buffs, phials, and any legacy
  // healing-potions — is a smaller SATELLITE above it. (Stage 2 of the Estus
  // pass retires the potion into refill-draughts + shards; until then it still
  // works as a one-off through useConsumable.)
  const secondary = Object.values(ITEMS).filter(
    (i) => i.kind === 'consumable' && getCount(i.id) > 0,
  );
  order = [FLASK_ID, ...secondary.map((i) => i.id)];   // flask = slot 1
  const wanted = new Set(secondary.map((i) => i.id));

  // Drop buttons for items no longer held.
  for (const [id, handle] of buttons) {
    if (!wanted.has(id)) {
      handle.el.remove();
      buttons.delete(id);
    }
  }

  // Ensure + update satellite buttons; assign slot badges (flask is slot 1, so
  // satellites start at slot 2).
  secondary.forEach((item, idx) => {
    let handle = buttons.get(item.id);
    if (!handle) {
      handle = createButton(item, false);
      buttons.set(item.id, handle);
    }
    const count = getCount(item.id);
    handle.countLabel.textContent = String(count);
    const full = item.carryLimit != null && count >= item.carryLimit;
    handle.el.style.borderColor = full ? 'rgba(255, 210, 120, 0.9)' : tintBorder(readElixirTint(item));
    handle.countLabel.style.color = full ? 'rgba(255, 224, 150, 0.95)' : 'rgba(255, 220, 200, 0.92)';
    if (handle.badge) handle.badge.textContent = String(idx + 2);
  });

  // DOM order: satellites first, flask LAST so it pins to the bottom of the
  // column (nearest the resting thumb). Re-appending an existing node moves it.
  for (const item of secondary) {
    const handle = buttons.get(item.id);
    if (handle) container.appendChild(handle.el);
  }
  if (flaskEl) container.appendChild(flaskEl);
  updateFlaskButton();
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

// ── The Flask — always-present primary heal (Estus), bound to player/flask.ts ──
function ensureFlaskButton(): void {
  if (flaskEl || !container) return;
  const tint = ESTUS_GOLD;
  const el = document.createElement('button');
  el.setAttribute('aria-label', 'drink healing flask');
  Object.assign(el.style, {
    position: 'relative', width: `${HEAL_SIZE}px`, height: `${HEAL_SIZE}px`,
    borderRadius: '50%', border: `2px solid ${tintBorder(tint)}`, background: tintBackground(tint),
    boxShadow: `0 0 18px ${tintShadow(tint)}`, touchAction: 'manipulation',
    userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, opacity 0.2s ease-out, border-color 0.2s',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0',
  } as Partial<CSSStyleDeclaration>);

  const icon = document.createElement('div');
  icon.style.lineHeight = '0';
  el.appendChild(icon);
  flaskIcon = icon;

  // Drink-progress ring — an SVG circle riding the button rim, revealed only
  // while the channel runs. Gold before the sip (still cancelable/refundable),
  // brightening once the sip lands. Driven per-frame by tickFlaskDrinkUi().
  const R = HEAL_SIZE / 2 - 3;
  const C = 2 * Math.PI * R;
  const ringWrap = document.createElement('div');
  ringWrap.innerHTML = `<svg viewBox="0 0 ${HEAL_SIZE} ${HEAL_SIZE}" width="${HEAL_SIZE}" height="${HEAL_SIZE}" aria-hidden="true" style="transform: rotate(-90deg)">
    <circle cx="${HEAL_SIZE / 2}" cy="${HEAL_SIZE / 2}" r="${R}" fill="none"
      stroke="${hexRgba(ESTUS_GOLD, 0.95)}" stroke-width="3" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"/>
  </svg>`;
  Object.assign(ringWrap.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0', lineHeight: '0',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(ringWrap);
  ringEl = ringWrap.querySelector('circle');
  ringCircumference = C;

  // Charge PIPS instead of a number — one ember per charge, dark when spent.
  // Reads at a glance like the Souls HUD, and capacity growth (shards) is
  // visible as the row itself growing.
  const pips = document.createElement('div');
  Object.assign(pips.style, {
    position: 'absolute', bottom: '6px', left: '0', right: '0',
    display: 'flex', justifyContent: 'center', gap: '4px',
    pointerEvents: 'none', lineHeight: '0',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(pips);

  if (isDesktopLike()) {
    const badge = document.createElement('div');
    badge.textContent = '1';   // flask is always slot 1
    Object.assign(badge.style, {
      position: 'absolute', top: '1px', left: '4px', fontFamily: FONT_UI,
      fontSize: '9px', fontWeight: '700', color: 'rgba(190, 150, 110, 0.75)', pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(badge);
  }

  // Fire-on-release (a graze during a joystick drag can't waste a charge).
  let pressed = false;
  const down = (e: Event) => { e.preventDefault(); pressed = true; el.style.transform = 'scale(0.9)'; };
  const up = (e: Event) => {
    e.preventDefault();
    el.style.transform = 'scale(1)';
    if (!pressed) return;
    pressed = false;
    drinkFlaskWithFeedback();
  };
  const cancel = () => { pressed = false; el.style.transform = 'scale(1)'; };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', cancel);

  container.appendChild(el);
  flaskEl = el;
  flaskPips = pips;
  updateFlaskButton();
}

/** Redraw the flask — the icon stays bare glass; the PIPS carry the charge
 *  count and the border/glow warms with how charged it is. */
function updateFlaskButton(): void {
  if (!flaskEl || !flaskPips) return;
  const { charges, capacity } = getFlask();
  const frac = capacity > 0 ? charges / capacity : 0;
  if (flaskIcon && !flaskIcon.innerHTML) flaskIcon.innerHTML = estusFlaskSvg(42);
  // One pip per capacity: a lit gold ember while the charge is held, a dark
  // hollow once it's spent. Shards growing capacity grow the row.
  const lit = `background:${hexCss(ESTUS_GOLD)};box-shadow:0 0 4px ${hexRgba(ESTUS_GOLD, 0.9)};border:1px solid rgba(255,224,150,0.9)`;
  const spent = 'background:rgba(20,16,12,0.75);border:1px solid rgba(190,150,110,0.45)';
  let html = '';
  for (let i = 0; i < capacity; i++) {
    html += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;${i < charges ? lit : spent}"></span>`;
  }
  flaskPips.innerHTML = html;
  const empty = charges <= 0;
  const full = charges >= capacity;
  flaskEl.style.opacity = empty ? '0.5' : '1';
  // The flask glows warmer the fuller it is — lit gold when charged, cold glass when spent.
  flaskEl.style.boxShadow = `0 0 ${(8 + frac * 18).toFixed(0)}px ${hexRgba(ESTUS_GOLD, 0.15 + frac * 0.4)}`;
  flaskEl.style.borderColor = full ? 'rgba(255, 224, 150, 0.95)' : tintBorder(ESTUS_GOLD);
}

/** Tap the flask: start the DRINK CHANNEL (player/flask-drink.ts), or lower it
 *  if one is already running. The heal itself lands mid-channel at the sip —
 *  this function only maps the request result to button feedback. */
function drinkFlaskWithFeedback(): void {
  switch (requestFlaskDrink()) {
    case 'started':    hapticVibrate(8); break;   // the uncork sound carries it
    case 'lowered':    hapticVibrate(8); break;   // deliberate cancel — quiet
    case 'empty':      denyFlask('The flask runs dry.'); break;
    case 'full':       denyFlask('Already whole.'); break;
    case 'suppressed': denyFlask('The thirst refuses it.'); break;
    case 'busy':       denyFlask('Your hands are full.'); break;
  }
}

/** Per-frame HUD tick for the drink channel: reveal + fill the progress ring,
 *  and fire the button's bright pulse the moment the sip lands. Early-outs to
 *  a single boolean check while no drink is in flight. */
export function tickFlaskDrinkUi(): void {
  const drinking = isDrinkingFlask();
  if (!drinking && !ringWasDrinking) return;
  const wrap = ringEl?.parentElement?.parentElement ?? null;   // svg → wrapper div
  if (drinking) {
    const p = getDrinkProgress();
    if (ringEl) {
      ringEl.style.strokeDashoffset = String(ringCircumference * (1 - p));
      ringEl.style.stroke = hexRgba(ESTUS_GOLD, hasSipLanded() ? 1 : 0.8);
    }
    if (wrap) wrap.style.opacity = '1';
    if (!ringSawSip && hasSipLanded()) {
      ringSawSip = true;
      flaskEl?.animate(
        [{ filter: 'brightness(2.0)', transform: 'scale(1.08)' }, { filter: 'brightness(1)', transform: 'scale(1)' }],
        { duration: 320, easing: 'ease-out' },
      );
    }
  } else {
    if (wrap) wrap.style.opacity = '0';
    if (ringEl) ringEl.style.strokeDashoffset = String(ringCircumference);
    ringSawSip = false;
  }
  ringWasDrinking = drinking;
}

/** Shake the flask + murmur a line so a withheld drink reads as withheld, not
 *  a broken button. */
function denyFlask(msg: string): void {
  flaskEl?.animate(
    [
      { transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' },
    ],
    { duration: 240, easing: 'ease-out' },
  );
  showInWorldMessage(msg);
  playDenied();
  hapticVibrate(8);
}

/** Quick-use: the flask when hurt, else the first held consumable. Desktop 'Q'. */
export function useFirstConsumable() {
  if (getPlayerHp() < getPlayerMaxHp() && getFlask().charges > 0) { drinkFlaskWithFeedback(); return; }
  const all = Object.values(ITEMS).filter(
    (i) => i.kind === 'consumable' && getCount(i.id) > 0,
  );
  if (all.length > 0) useConsumable(all[0]);
}

/** Use the item in slot N (1-indexed; slot 1 = the flask). Desktop number-key
 *  hotkeys. No-op for an empty slot. */
export function useConsumableSlot(slot: number) {
  const id = order[slot - 1];
  if (!id) return;
  if (id === FLASK_ID) { drinkFlaskWithFeedback(); return; }
  const item = ITEMS[id];
  if (item) useConsumable(item);
}

function useConsumable(item: ItemSpec) {
  if (getCount(item.id) <= 0) return;

  // Flask draught — poured INTO the flask (+charges), never drunk directly.
  // At a full flask it's withheld: the pour would spill.
  if (item.consumableFlaskCharges != null) {
    const { charges, capacity } = getFlask();
    if (charges >= capacity) { denyFlask('The flask is full.'); return; }
    addCharges(item.consumableFlaskCharges);
    playFlaskUncork();
    hapticVibrate(12);
    drainPulse(item.id);
    removeItem(item.id);
    recordConsumableUse();
    return;
  }

  // Flask shard — fused into the flask: +capacity, and the new charge arrives
  // filled so the find is immediately felt.
  if (item.consumableFlaskCapacity != null) {
    addCapacity(item.consumableFlaskCapacity, true);
    showInWorldMessage('The flask grows deeper.');
    playBuffApply();
    hapticVibrate(16);
    drainPulse(item.id);
    removeItem(item.id);
    recordConsumableUse();
    return;
  }

  // Healing — at full HP, don't burn a scarce potion. Give clear feedback
  // (the silent no-op read as a broken button) instead.
  if (item.consumableHeal != null) {
    if (getPlayerHp() >= getPlayerMaxHp()) {
      denyHealFeedback();
      return;
    }
    healPlayer(item.consumableHeal, 'passive');   // item heal — a TRANSFORM may suppress it
    playHealSlurp();
    hapticVibrate(12);
    drainPulse(item.id);
    removeItem(item.id);
    recordConsumableUse();
    return;
  }

  // Phials — permanent run mutation behind a per-run color identity
  // (state/phial-identities.ts). UNKNOWN transaction family: you
  // commit, then the dungeon answers.
  if (item.consumableMutation) {
    emit({ type: 'transaction:accepted', family: 'unknown', id: `phial:${item.id}`, price: {} });
    const mutationId = phialMutationId(item.id);
    applyMutationWithFeedback(mutationId);
    emit({ type: 'transaction:resolved', family: 'unknown', id: `phial:${item.id}`, outcome: { mutationId } });
    hapticVibrate(16);
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
  playDenied();
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
  const liquid = hexCss(tint);
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

// ── The Estus flask icon — an EMPTY round-bottomed apothecary flask with an
// IRON collar. The glass is deliberately bare: the charge PIPS below the icon
// carry the count, and the button's gold border/glow (updateFlaskButton)
// carries the "how charged" read — the icon is the vessel, not the gauge.
function estusFlaskSvg(px: number): string {
  const glass = 'rgba(220,226,236,0.50)';
  const glassFill = 'rgba(220,226,236,0.07)';
  // Round-bottomed bulb; the clip keeps the iron band inside the glass.
  const bulb = 'M9.6 8 L14.4 8 C16 11 20 13 20 18.5 C20 23 16.4 26.5 12 26.5 C7.6 26.5 4 23 4 18.5 C4 13 8 11 9.6 8 Z';
  const uid = 'estus-clip';
  return `<svg viewBox="0 0 24 28" width="${px}" height="${(px * 28) / 24}" aria-hidden="true">
    <defs><clipPath id="${uid}"><path d="${bulb}"/></clipPath></defs>
    <rect x="9" y="0.5" width="6" height="3.2" rx="0.8" fill="#5a3d22" stroke="#3a2614" stroke-width="0.4"/>
    <rect x="9.7" y="3.4" width="4.6" height="4.8" fill="${glassFill}" stroke="${glass}" stroke-width="0.7"/>
    <path d="${bulb}" fill="${glassFill}" stroke="${glass}" stroke-width="0.9"/>
    <rect x="3.5" y="16.6" width="17" height="2.6" fill="rgba(28,24,22,0.92)" clip-path="url(#${uid})"/>
    <circle cx="6.6" cy="17.9" r="0.55" fill="rgba(160,150,140,0.85)" clip-path="url(#${uid})"/>
    <circle cx="17.4" cy="17.9" r="0.55" fill="rgba(160,150,140,0.85)" clip-path="url(#${uid})"/>
    <path d="M8.2 9.6 C7.1 12 6.9 14.5 7.3 17" stroke="rgba(255,255,255,0.4)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Pull the elixir's emissive color from the item's drop model so the button
// matches the in-world potion glow (red = heal, orange = berserk).
function readElixirTint(item: ItemSpec): number {
  const mat = item.dropModel.materials['elixir'];
  if (mat && mat.emissive != null) return mat.emissive;
  return HEAL_TINT_FALLBACK;
}

function tintBorder(tint: number): string { return hexRgba(tint, 0.55); }
function tintBackground(tint: number): string { return hexRgba(tint, 0.18); }
function tintShadow(tint: number): string { return hexRgba(tint, 0.30); }
