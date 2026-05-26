import { getCount, removeItem, onInventoryChanged } from '../player/inventory';
import { healPlayer, getPlayerHp, getPlayerMaxHp } from '../player/health';
import { ITEMS, type ItemSpec } from '../content/items';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { playHealSlurp, playBuffApply } from '../audio/sfx';

// Consumable hotbar — small horizontal row of buttons on the left edge of
// the screen, above the joystick zone. One button per consumable type the
// player currently holds; tap to drink/use one. Hides automatically when
// you have none of that type.
//
// Generic over consumable kind:
//   - consumableHeal -> healPlayer + remove from inventory
//   - consumableBuff -> applyBuff to player + remove from inventory
//
// Adding a new consumable type (mana potion, antidote, throwing knife) is
// a new ItemSpec entry — no UI changes needed.

interface ButtonHandle {
  itemId: string;
  el: HTMLButtonElement;
  countLabel: HTMLSpanElement;
}

const ROW_BOTTOM = 220;  // px above safe-area bottom — same band the original potion button used
const BTN_SIZE = 60;     // matches the use-button vertical zone
const BTN_GAP = 8;

let container: HTMLDivElement | null = null;
const buttons = new Map<string, ButtonHandle>();

export function createConsumableBar() {
  if (container) return;

  container = document.createElement('div');
  container.id = 'consumable-bar';
  Object.assign(container.style, {
    position: 'fixed',
    left: 'calc(24px + env(safe-area-inset-left, 0px))',
    bottom: `calc(${ROW_BOTTOM}px + env(safe-area-inset-bottom, 0px))`,
    display: 'flex',
    gap: `${BTN_GAP}px`,
    zIndex: '12',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(container);

  // Inventory changes -> rebuild the row so newly-acquired consumables get
  // a button, and emptied stacks have theirs removed.
  onInventoryChanged(rebuild);
  rebuild();
}

function rebuild() {
  if (!container) return;
  const consumables = Object.values(ITEMS).filter(
    (i) => i.kind === 'consumable' && getCount(i.id) > 0,
  );
  const wanted = new Set(consumables.map((i) => i.id));

  // Remove buttons for items the player no longer holds.
  for (const [id, handle] of buttons) {
    if (!wanted.has(id)) {
      handle.el.remove();
      buttons.delete(id);
    }
  }

  // Add buttons for newly-held consumables; update counts on existing ones.
  for (const item of consumables) {
    let handle = buttons.get(item.id);
    if (!handle) {
      handle = createButton(item);
      buttons.set(item.id, handle);
      container.appendChild(handle.el);
    }
    handle.countLabel.textContent = String(getCount(item.id));
  }
}

function createButton(item: ItemSpec): ButtonHandle {
  const el = document.createElement('button');
  el.setAttribute('aria-label', `use ${item.name}`);

  // Tint color comes from the elixir color hint in the item's drop model
  // — find the most-saturated material. Currently both potions have an
  // 'elixir' material — read its emissive as the button color.
  const tint = readElixirTint(item);

  Object.assign(el.style, {
    width: `${BTN_SIZE}px`,
    height: `${BTN_SIZE}px`,
    borderRadius: '50%',
    border: `2px solid ${tintBorder(tint)}`,
    background: `${tintBackground(tint)}`,
    color: 'rgba(255, 220, 200, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '22px',
    lineHeight: '1',
    boxShadow: `0 0 14px ${tintShadow(tint)}`,
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
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
  icon.textContent = '🜢';   // alchemical-ish — same glyph for now, color differs
  icon.style.fontSize = '20px';
  icon.style.lineHeight = '1';

  const countLabel = document.createElement('span');
  countLabel.textContent = '0';
  countLabel.style.fontSize = '11px';
  countLabel.style.fontWeight = '700';
  countLabel.style.letterSpacing = '0.05em';
  countLabel.style.opacity = '0.8';

  el.appendChild(icon);
  el.appendChild(countLabel);

  const press = (e: Event) => {
    e.preventDefault();
    useConsumable(item);
    el.style.transform = 'scale(0.92)';
  };
  const release = () => {
    el.style.transform = 'scale(1)';
  };
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('touchend', release);
  el.addEventListener('touchcancel', release);
  el.addEventListener('mousedown', press);
  el.addEventListener('mouseup', release);
  el.addEventListener('mouseleave', release);

  return { itemId: item.id, el, countLabel };
}

function useConsumable(item: ItemSpec) {
  if (getCount(item.id) <= 0) return;

  // Healing — don't consume if already at max HP (would waste a potion).
  if (item.consumableHeal != null) {
    if (getPlayerHp() >= getPlayerMaxHp()) return;
    healPlayer(item.consumableHeal);
    playHealSlurp();
    removeItem(item.id);
    return;
  }

  // Buff potions — apply the buff to the player entity, consume.
  if (item.consumableBuff) {
    const player = get('player');
    if (player) {
      applyBuff(player, item.consumableBuff.buffId, item.consumableBuff.duration);
    }
    playBuffApply();
    removeItem(item.id);
    return;
  }
}

// Pull the elixir's emissive color from the item's drop model. Most
// consumable models declare an 'elixir' material; use its emissive as
// the button's accent color so the player can tell potions apart at a
// glance (red = heal, orange = berserk).
function readElixirTint(item: ItemSpec): number {
  const mat = item.dropModel.materials['elixir'];
  if (mat && mat.emissive != null) return mat.emissive;
  return 0xff5544; // fallback red
}

function tintBorder(tint: number): string  { return `rgba(${rgba(tint, 0.55)})`; }
function tintBackground(tint: number): string { return `rgba(${rgba(tint, 0.18)})`; }
function tintShadow(tint: number): string  { return `rgba(${rgba(tint, 0.30)})`; }

function rgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `${r}, ${g}, ${b}, ${alpha.toFixed(2)}`;
}
