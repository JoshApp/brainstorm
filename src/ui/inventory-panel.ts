import {
  getEquipment, equipFromInventory, unequipSlot,
  onEquipmentChanged, type EquipSlot,
} from '../player/equipment';
import {
  getAllItems, addItemSilently, removeItem, onInventoryChanged,
} from '../player/inventory';
import { computeStats } from '../player/equipment-stats';
import { getPlayerHp, getPlayerMaxHp } from '../player/health';
import { ITEMS, type ItemSpec } from '../content/items';
import { getCurrentWeapon } from '../player/current-weapon';

// Inventory + character stat sheet panel.
//
// Tap the bag icon (top-right) to open. Layout (mobile-first):
//   [equipped slots row]    weapon | armor | ring1 | ring2
//   [stats block]           HP / damage / armor
//   [inventory grid]        every unequipped item, tap to equip
//
// Tap behaviors:
//   - Inventory item:  equip into appropriate slot. Old slot occupant
//                      (if any) pushed back to the bag.
//   - Equipped slot:   unequip back to the bag (weapon slot can't unequip —
//                      you always need a weapon).

const PANEL_BG = 'rgba(20, 14, 10, 0.95)';
const BORDER = '1px solid rgba(180, 130, 90, 0.5)';
const SLOT_BG = 'rgba(40, 28, 20, 0.7)';
const SLOT_BORDER_EMPTY = '1px dashed rgba(120, 90, 60, 0.4)';
const SLOT_BORDER_FILLED = '1px solid rgba(220, 170, 110, 0.7)';

let openButton: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let panelOpen = false;

export function createInventoryPanel() {
  if (openButton) return;

  // The bag button — top-right (mirror of the settings gear top-left).
  openButton = document.createElement('button');
  openButton.id = 'inventory-button';
  openButton.setAttribute('aria-label', 'inventory');
  openButton.textContent = '▦';
  Object.assign(openButton.style, {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top, 0px))',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '1px solid rgba(180, 130, 90, 0.5)',
    background: 'rgba(20, 14, 10, 0.75)',
    color: 'rgba(220, 180, 140, 0.9)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    zIndex: '15',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  openButton.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });
  document.body.appendChild(openButton);

  // Panel — hidden by default, content rebuilt on each open + on changes.
  panel = document.createElement('div');
  panel.id = 'inventory-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(380px, 92vw)',
    maxHeight: '85vh',
    overflowY: 'auto',
    padding: '20px 22px',
    background: PANEL_BG,
    border: BORDER,
    borderRadius: '4px',
    color: 'rgba(230, 200, 170, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.85)',
    zIndex: '100',
    display: 'none',
    flexDirection: 'column',
    gap: '18px',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);

  // Rebuild contents whenever inventory or equipment changes (catches the
  // case where the panel is OPEN and the player picks something up).
  onInventoryChanged(() => { if (panelOpen) rebuildPanel(); });
  onEquipmentChanged(() => { if (panelOpen) rebuildPanel(); });

  // Tap outside the panel to close.
  document.addEventListener('click', (e) => {
    if (!panelOpen) return;
    if (panel!.contains(e.target as Node)) return;
    if (openButton!.contains(e.target as Node)) return;
    closePanel();
  });
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

function openPanel() {
  if (!panel) return;
  rebuildPanel();
  panel.style.display = 'flex';
  panelOpen = true;
}

function closePanel() {
  if (!panel) return;
  panel.style.display = 'none';
  panelOpen = false;
}

function rebuildPanel() {
  if (!panel) return;
  panel.replaceChildren();

  // --- Header row with close button ---
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid rgba(180, 130, 90, 0.3)', paddingBottom: '8px',
  } as Partial<CSSStyleDeclaration>);
  const title = document.createElement('div');
  title.textContent = 'INVENTORY';
  Object.assign(title.style, {
    fontSize: '13px', fontWeight: '600', letterSpacing: '0.28em',
    color: 'rgba(255, 200, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);
  const close = document.createElement('button');
  close.textContent = '✕';
  Object.assign(close.style, {
    background: 'transparent', border: 'none',
    color: 'rgba(220, 180, 140, 0.7)', fontSize: '18px', cursor: 'pointer',
    padding: '4px 8px',
  } as Partial<CSSStyleDeclaration>);
  close.addEventListener('click', closePanel);
  header.append(title, close);
  panel.appendChild(header);

  // --- Equipped slots row ---
  panel.appendChild(buildSectionLabel('EQUIPPED'));
  const slotsRow = document.createElement('div');
  Object.assign(slotsRow.style, {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  const eq = getEquipment();
  slotsRow.appendChild(buildSlotCell('weapon', 'WPN', eq.weapon, /* unequippable */ false));
  slotsRow.appendChild(buildSlotCell('armor',  'ARM', eq.armor,  true));
  slotsRow.appendChild(buildSlotCell('ring1',  'R1',  eq.ring1,  true));
  slotsRow.appendChild(buildSlotCell('ring2',  'R2',  eq.ring2,  true));
  panel.appendChild(slotsRow);

  // --- Stats block ---
  panel.appendChild(buildSectionLabel('STATS'));
  panel.appendChild(buildStatsBlock());

  // --- Inventory grid ---
  panel.appendChild(buildSectionLabel('BAG'));
  panel.appendChild(buildInventoryGrid());
}

function buildSectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    fontSize: '11px', fontWeight: '500', letterSpacing: '0.22em',
    color: 'rgba(180, 140, 100, 0.85)',
    borderBottom: '1px solid rgba(120, 90, 60, 0.3)',
    paddingBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  return el;
}

function buildSlotCell(slot: EquipSlot, label: string, item: ItemSpec | null, canUnequip: boolean): HTMLDivElement {
  const cell = document.createElement('div');
  Object.assign(cell.style, {
    minHeight: '64px', padding: '6px',
    background: SLOT_BG,
    border: item ? SLOT_BORDER_FILLED : SLOT_BORDER_EMPTY,
    borderRadius: '3px',
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    cursor: item && canUnequip ? 'pointer' : 'default',
  } as Partial<CSSStyleDeclaration>);

  const slotLabel = document.createElement('div');
  slotLabel.textContent = label;
  Object.assign(slotLabel.style, {
    fontSize: '9px', letterSpacing: '0.2em',
    color: 'rgba(140, 110, 80, 0.7)',
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(slotLabel);

  const itemLabel = document.createElement('div');
  itemLabel.textContent = item ? shortName(item) : '—';
  Object.assign(itemLabel.style, {
    fontSize: '11px',
    color: item ? 'rgba(230, 200, 170, 0.95)' : 'rgba(120, 90, 70, 0.5)',
    fontWeight: '500',
    lineHeight: '1.2',
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(itemLabel);

  if (item && canUnequip) {
    cell.addEventListener('click', () => {
      const unequipped = unequipSlot(slot);
      if (unequipped) addItemSilently(unequipped.id);
    });
  }

  return cell;
}

function buildStatsBlock(): HTMLDivElement {
  const block = document.createElement('div');
  Object.assign(block.style, {
    background: SLOT_BG, padding: '8px 12px', borderRadius: '3px',
    border: '1px solid rgba(120, 90, 60, 0.3)',
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);

  const stats = computeStats();
  const weapon = getCurrentWeapon();
  const baseDamage = weapon.damage;
  const totalDamage = baseDamage + stats.weaponDamageBonus;

  addStatRow(block, 'HP', `${getPlayerHp()} / ${getPlayerMaxHp()}`);
  addStatRow(block, 'DAMAGE', stats.weaponDamageBonus > 0
    ? `${totalDamage}  (${baseDamage} + ${stats.weaponDamageBonus})`
    : `${totalDamage}`);
  addStatRow(block, 'PHYS ARM', `${stats.physicalArmor}`);
  addStatRow(block, 'MAG ARM', `${stats.magicArmor}`);
  addStatRow(block, 'REACH', `${weapon.reach.toFixed(1)}m`);

  return block;
}

function addStatRow(parent: HTMLElement, label: string, value: string) {
  const l = document.createElement('div');
  l.textContent = label;
  Object.assign(l.style, {
    color: 'rgba(160, 130, 100, 0.85)', letterSpacing: '0.15em', fontSize: '10px',
  } as Partial<CSSStyleDeclaration>);
  const v = document.createElement('div');
  v.textContent = value;
  Object.assign(v.style, {
    color: 'rgba(230, 200, 170, 0.95)', fontFamily: 'monospace',
  } as Partial<CSSStyleDeclaration>);
  parent.append(l, v);
}

function buildInventoryGrid(): HTMLDivElement {
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px',
  } as Partial<CSSStyleDeclaration>);

  const items = getAllItems().filter((i) => i.count > 0);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'EMPTY';
    Object.assign(empty.style, {
      gridColumn: '1 / -1', padding: '14px', textAlign: 'center',
      color: 'rgba(120, 90, 70, 0.5)', fontSize: '11px',
      letterSpacing: '0.25em', fontStyle: 'italic',
    } as Partial<CSSStyleDeclaration>);
    grid.appendChild(empty);
    return grid;
  }

  for (const { id, count } of items) {
    const item = ITEMS[id];
    if (!item) continue;

    const cell = document.createElement('div');
    Object.assign(cell.style, {
      padding: '8px 10px',
      background: SLOT_BG,
      border: SLOT_BORDER_FILLED,
      borderRadius: '3px',
      display: 'flex', flexDirection: 'column', gap: '2px',
      cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>);

    const labelRow = document.createElement('div');
    Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between' } as Partial<CSSStyleDeclaration>);
    const name = document.createElement('div');
    name.textContent = shortName(item);
    Object.assign(name.style, {
      fontSize: '11px', color: 'rgba(230, 200, 170, 0.95)', fontWeight: '500',
    } as Partial<CSSStyleDeclaration>);
    const countLbl = document.createElement('div');
    countLbl.textContent = count > 1 ? `×${count}` : '';
    Object.assign(countLbl.style, {
      fontSize: '10px', color: 'rgba(180, 140, 100, 0.7)',
      fontFamily: 'monospace',
    } as Partial<CSSStyleDeclaration>);
    labelRow.append(name, countLbl);
    cell.appendChild(labelRow);

    const kind = document.createElement('div');
    kind.textContent = item.kind.toUpperCase();
    Object.assign(kind.style, {
      fontSize: '9px', letterSpacing: '0.2em', color: 'rgba(140, 110, 80, 0.65)',
    } as Partial<CSSStyleDeclaration>);
    cell.appendChild(kind);

    // Tap to equip (equipment kinds only — consumables are used via the
    // bottom-left potion button, not by tapping here).
    if (item.kind !== 'consumable') {
      cell.addEventListener('click', () => {
        const previous = equipFromInventory(item);
        removeItem(item.id);
        if (previous) addItemSilently(previous.id);
      });
    } else {
      cell.style.cursor = 'default';
      cell.style.opacity = '0.85';
    }

    grid.appendChild(cell);
  }

  return grid;
}

// Take the item's display name and strip leading article (a/an) to fit
// the cramped panel cell. "A scimitar, curved and stained" -> "scimitar, curved..."
function shortName(item: ItemSpec): string {
  return item.name.replace(/^(A |An )/, '').slice(0, 30);
}
