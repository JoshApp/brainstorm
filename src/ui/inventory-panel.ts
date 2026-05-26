import {
  getEquipment, equipFromInventory, unequipSlot,
  onEquipmentChanged, type EquipSlot,
} from '../player/equipment';
import {
  getAllItems, addItemSilently, removeItem, onInventoryChanged,
} from '../player/inventory';
import { computeStats } from '../player/equipment-stats';
import { getPlayerHp, getPlayerMaxHp, healPlayer } from '../player/health';
import { ITEMS, RARITY_COLORS, type ItemSpec, type WeaponStats, type Rarity } from '../content/items';
import { getCurrentWeapon } from '../player/current-weapon';
import { BUFFS } from '../content/buffs';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { getItemThumbnail } from './item-thumbnail';
import { openScreen, closeScreen } from './screen-manager';
import { playEquipClick, playHealSlurp, playBuffApply } from '../audio/sfx';
import type { StatModifier } from '../combat/modifiers';
import type { PassiveSpec } from '../ecs/types';

// Inventory + character stat sheet.
//
// Horizontal three-column layout (mobile landscape):
//   LEFT    stats column      HP / damage / armor / multiplier readouts
//   CENTER  paper doll        Anatomical slots positioned around a
//                             hooded-figure silhouette. Tap a slot for
//                             item details + unequip.
//   RIGHT   bag grid          Every unequipped item, tap to select +
//                             see details (with EQUIP / USE button).
//
//   BOTTOM  details panel     Slides in when an item is selected (from
//                             bag or doll). Shows name / kind / full
//                             effects / contextual action button.
//
// Selecting an item is non-destructive — you see what it does BEFORE
// equipping. The EQUIP button commits; tap-outside or another item
// cancels. Equipped items can be unequipped via the doll except for the
// weapon slot (you always need a weapon).

// ── Anatomical paper-doll layout ─────────────────────────────────────
// Real equipment slots active in the current game. Slot id matches
// EquipSlot in player/equipment.ts (these go through equipFromInventory).
//
// Display-only slots (helmet, amulet, gloves, offhand, boots) are
// rendered as faint "future-slot" placeholders so the player can see
// the system expanding later; tapping them does nothing yet.

type SlotDef = {
  /** Position on the doll container (percentages of container size). */
  top: string; left: string;
  /** Short label shown inside the slot when it's empty. */
  shortLabel: string;
  /** Long label shown in the details panel header. */
  longLabel: string;
  /** Active equipment slot id this position represents. */
  slotId: EquipSlot;
  /** Pixel size. */
  size: number;
};

const SLOTS: SlotDef[] = [
  { slotId: 'helmet', top: '7%',  left: '50%', size: 38, shortLabel: 'HELM', longLabel: 'HELMET' },
  { slotId: 'amulet', top: '24%', left: '50%', size: 28, shortLabel: 'AMU',  longLabel: 'AMULET' },
  { slotId: 'armor',  top: '42%', left: '50%', size: 44, shortLabel: 'ARM',  longLabel: 'ARMOR' },
  { slotId: 'weapon', top: '52%', left: '14%', size: 44, shortLabel: 'WPN',  longLabel: 'WEAPON' },
  { slotId: 'offhand',top: '52%', left: '86%', size: 44, shortLabel: 'OFF',  longLabel: 'OFF-HAND' },
  { slotId: 'gloves', top: '70%', left: '14%', size: 34, shortLabel: 'GLV',  longLabel: 'GLOVES' },
  { slotId: 'ring1',  top: '70%', left: '38%', size: 30, shortLabel: 'R1',   longLabel: 'RING' },
  { slotId: 'ring2',  top: '70%', left: '62%', size: 30, shortLabel: 'R2',   longLabel: 'RING' },
  { slotId: 'boots',  top: '92%', left: '50%', size: 34, shortLabel: 'FEET', longLabel: 'BOOTS' },
];

// ── Styling helpers ──────────────────────────────────────────────────
const PANEL_BG = 'rgba(20, 14, 10, 0.96)';
const PANEL_BORDER = '1px solid rgba(180, 130, 90, 0.5)';
const CARD_BG = 'rgba(36, 26, 18, 0.7)';
const FILLED_BORDER = '1px solid rgba(220, 170, 110, 0.7)';
const EMPTY_BORDER = '1px dashed rgba(120, 90, 60, 0.4)';
const PLACEHOLDER_BORDER = '1px dotted rgba(80, 60, 40, 0.35)';
const TEXT_PRIMARY = 'rgba(230, 200, 170, 0.95)';
const TEXT_DIM = 'rgba(160, 130, 100, 0.85)';
const TEXT_FAINT = 'rgba(100, 80, 60, 0.6)';
const ACCENT = 'rgba(255, 160, 80, 0.85)';

// ── Module-level state ───────────────────────────────────────────────
let openButton: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let panelOpen = false;

/** Currently selected item — either from the bag (item) or a doll slot. */
type Selection =
  | { kind: 'bag'; item: ItemSpec }
  | { kind: 'slot'; slotId: EquipSlot; item: ItemSpec }
  | null;
let selection: Selection = null;

export function createInventoryPanel() {
  if (openButton) return;

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
    color: TEXT_PRIMARY,
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    zIndex: '95',  // above the menu backdrop (90), below panels (100)
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

  panel = document.createElement('div');
  panel.id = 'inventory-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(880px, 98vw)',
    maxHeight: '94vh',
    overflowY: 'auto',
    padding: '12px 14px',
    background: PANEL_BG,
    border: PANEL_BORDER,
    borderRadius: '4px',
    color: TEXT_PRIMARY,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.9)',
    zIndex: '100',
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);

  onInventoryChanged(() => { if (panelOpen) rebuildPanel(); });
  onEquipmentChanged(() => { if (panelOpen) rebuildPanel(); });

}

function togglePanel() { panelOpen ? closePanel() : openPanel(); }

/** Programmatic open — used by debug scenarios for snaps. */
export function openInventoryPanel() {
  openPanel();
}

/** Programmatically select a bag item by id (for snap scenarios). */
export function selectBagItem(itemId: string) {
  const item = ITEMS[itemId];
  if (!item) return;
  selection = { kind: 'bag', item };
  if (panelOpen) rebuildPanel();
}

function openPanel() {
  if (!panel) return;
  selection = null;
  rebuildPanel();
  panel.style.display = 'flex';
  panelOpen = true;
  // Default policy is fine for the inventory: pauses world, backdrop on,
  // panel layer. Dismiss request routes from a backdrop tap.
  openScreen({
    id: 'inventory',
    root: panel,
    onDismissRequest: () => { if (panelOpen) closePanel(); },
  });
}
function closePanel() {
  if (!panel) return;
  panel.style.display = 'none';
  panelOpen = false;
  selection = null;
  closeScreen('inventory');
}

function rebuildPanel() {
  if (!panel) return;
  panel.replaceChildren();

  panel.appendChild(buildHeader());
  panel.appendChild(buildFourColumns());
}

// ── Header ───────────────────────────────────────────────────────────
function buildHeader(): HTMLDivElement {
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid rgba(180, 130, 90, 0.3)', paddingBottom: '8px',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'INVENTORY';
  Object.assign(title.style, {
    fontSize: '13px', fontWeight: '600', letterSpacing: '0.30em',
    color: 'rgba(255, 200, 140, 0.95)',
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
  return header;
}

// ── Three columns: stats | doll | bag ────────────────────────────────
// Landscape-phone-friendly: every region is side-by-side so we never run
// out of vertical space. The details column on the far right is ALWAYS
// visible — EQUIP / UNEQUIP / USE buttons never get cut off the bottom.
function buildFourColumns(): HTMLDivElement {
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '0.55fr 0.9fr 1fr 1.25fr',
    gap: '10px',
    alignItems: 'stretch',
    flex: '1',
    minHeight: '0',
  } as Partial<CSSStyleDeclaration>);

  grid.appendChild(buildStatsColumn());
  grid.appendChild(buildDollColumn());
  grid.appendChild(buildBagColumn());
  grid.appendChild(buildDetailsColumn());
  return grid;
}

// ── Stats column ─────────────────────────────────────────────────────
function buildStatsColumn(): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
  } as Partial<CSSStyleDeclaration>);

  col.appendChild(sectionLabel('STATS'));

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: CARD_BG, padding: '8px 10px', borderRadius: '3px',
    border: '1px solid rgba(120, 90, 60, 0.3)',
    display: 'flex', flexDirection: 'column', gap: '4px',
    flex: '1',
  } as Partial<CSSStyleDeclaration>);

  const stats = computeStats();
  const weapon = getCurrentWeapon();
  const baseDamage = weapon.damage;
  const totalDamage = (baseDamage + stats.weaponDamageBonus) * stats.damageMultiplier;
  const damageStr = stats.damageMultiplier !== 1
    ? `${totalDamage.toFixed(1)}  (${baseDamage}+${stats.weaponDamageBonus} ×${stats.damageMultiplier.toFixed(2)})`
    : stats.weaponDamageBonus > 0
      ? `${totalDamage.toFixed(1)}  (${baseDamage}+${stats.weaponDamageBonus})`
      : `${totalDamage}`;

  addStatRow(card, 'HP',         `${getPlayerHp()} / ${getPlayerMaxHp()}`);
  addStatRow(card, 'DAMAGE',     damageStr);
  addStatRow(card, 'PHYS ARM',   `${stats.physicalArmor}`);
  addStatRow(card, 'MAG ARM',    `${stats.magicArmor}`);
  addStatRow(card, 'REACH',      `${weapon.reach.toFixed(1)}m`);

  col.appendChild(card);
  return col;
}

function addStatRow(parent: HTMLElement, label: string, value: string) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);
  const l = document.createElement('span');
  l.textContent = label;
  Object.assign(l.style, {
    color: TEXT_DIM, letterSpacing: '0.15em', fontSize: '10px',
  } as Partial<CSSStyleDeclaration>);
  const v = document.createElement('span');
  v.textContent = value;
  Object.assign(v.style, {
    color: TEXT_PRIMARY, fontFamily: 'monospace',
  } as Partial<CSSStyleDeclaration>);
  row.append(l, v);
  parent.appendChild(row);
}

// ── Doll column ──────────────────────────────────────────────────────
function buildDollColumn(): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  col.appendChild(sectionLabel('EQUIPPED'));

  const dollContainer = document.createElement('div');
  Object.assign(dollContainer.style, {
    position: 'relative',
    width: '100%',
    aspectRatio: '0.62',  // tighter than before so it fits landscape phones
    maxHeight: '230px',
    background: 'radial-gradient(circle at 50% 45%, rgba(60, 40, 25, 0.35) 0%, rgba(20, 14, 10, 0.1) 70%)',
    border: '1px solid rgba(80, 60, 40, 0.3)',
    borderRadius: '4px',
  } as Partial<CSSStyleDeclaration>);

  // SVG silhouette behind the slot indicators.
  dollContainer.appendChild(buildSilhouette());

  // Slot indicators on top of the silhouette.
  const eq = getEquipment();
  for (const def of SLOTS) {
    dollContainer.appendChild(buildDollSlot(def, eq[def.slotId]));
  }

  col.appendChild(dollContainer);
  return col;
}

function buildSilhouette(): SVGSVGElement {
  // Stylized hooded humanoid. Simple shapes — reads as a person without
  // distracting from the slot indicators overlaid on top.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 320');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  Object.assign(svg.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    opacity: '0.85',
  } as Partial<CSSStyleDeclaration>);

  svg.innerHTML = `
    <!-- Hood drape -->
    <path d="M 50 75 Q 100 20 150 75 L 145 110 Q 100 95 55 110 Z"
          fill="rgba(20, 14, 10, 0.95)" stroke="rgba(80, 55, 35, 0.5)" stroke-width="1"/>
    <!-- Head -->
    <ellipse cx="100" cy="68" rx="28" ry="32" fill="rgba(30, 22, 16, 0.95)"/>
    <!-- Body torso -->
    <path d="M 62 110 L 138 110 L 152 215 Q 100 225 48 215 Z"
          fill="rgba(28, 20, 14, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <!-- Arms -->
    <rect x="32" y="115" width="22" height="110" rx="10"
          fill="rgba(26, 18, 12, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <rect x="146" y="115" width="22" height="110" rx="10"
          fill="rgba(26, 18, 12, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <!-- Legs -->
    <rect x="68" y="218" width="25" height="92" rx="6"
          fill="rgba(24, 16, 10, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <rect x="107" y="218" width="25" height="92" rx="6"
          fill="rgba(24, 16, 10, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
  `;
  return svg;
}

function buildDollSlot(def: SlotDef, item: ItemSpec | null): HTMLDivElement {
  const wrap = document.createElement('div');
  const filled = !!item;
  const rarityHex = item ? hexCss(RARITY_COLORS[item.rarity ?? 'mundane']) : null;
  const isSelected = selection?.kind === 'slot' && selection.slotId === def.slotId;

  Object.assign(wrap.style, {
    position: 'absolute',
    top: def.top, left: def.left,
    width: `${def.size}px`, height: `${def.size}px`,
    transform: 'translate(-50%, -50%)',
    borderRadius: '4px',
    background: filled ? 'rgba(40, 28, 20, 0.9)' : 'rgba(20, 14, 10, 0.7)',
    border: isSelected
      ? `2px solid ${ACCENT}`
      : filled ? `1.5px solid ${rarityHex}` : EMPTY_BORDER,
    boxShadow: isSelected ? `0 0 14px ${ACCENT}`
              : filled    ? `0 0 8px ${rarityHex}55`
                          : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.08s, border 0.15s, box-shadow 0.15s',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  if (filled && item) {
    const img = document.createElement('img');
    img.src = getItemThumbnail(item);
    Object.assign(img.style, {
      width: '100%', height: '100%',
      objectFit: 'contain',
      imageRendering: 'pixelated',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(img);
  } else {
    const label = document.createElement('div');
    label.textContent = def.shortLabel;
    Object.assign(label.style, {
      fontSize: '9px', fontWeight: '500',
      color: TEXT_DIM, letterSpacing: '0.15em', textAlign: 'center',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(label);
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    if (item) {
      selection = { kind: 'slot', slotId: def.slotId, item };
    } else {
      selection = null;
    }
    rebuildPanel();
  });

  return wrap;
}

// ── Bag column ───────────────────────────────────────────────────────
function buildBagColumn(): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  col.appendChild(sectionLabel('BAG'));

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '5px', alignContent: 'start',
    overflowY: 'auto', maxHeight: '230px',
    paddingRight: '4px',
  } as Partial<CSSStyleDeclaration>);

  const items = getAllItems().filter((i) => i.count > 0);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'EMPTY';
    Object.assign(empty.style, {
      gridColumn: '1 / -1', padding: '14px', textAlign: 'center',
      color: TEXT_FAINT, fontSize: '11px',
      letterSpacing: '0.25em', fontStyle: 'italic',
    } as Partial<CSSStyleDeclaration>);
    grid.appendChild(empty);
    col.appendChild(grid);
    return col;
  }

  for (const { id, count } of items) {
    const item = ITEMS[id];
    if (!item) continue;
    grid.appendChild(buildBagCell(item, count));
  }

  col.appendChild(grid);
  return col;
}

function buildBagCell(item: ItemSpec, count: number): HTMLDivElement {
  const selected = selection?.kind === 'bag' && selection.item.id === item.id;
  const rarity = item.rarity ?? 'mundane';
  const rarityHex = hexCss(RARITY_COLORS[rarity]);

  const cell = document.createElement('div');
  Object.assign(cell.style, {
    padding: '4px 6px',
    background: selected ? 'rgba(80, 50, 28, 0.85)' : CARD_BG,
    border: selected ? `2px solid ${ACCENT}` : `1.5px solid ${rarityHex}`,
    borderRadius: '3px',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px',
    alignItems: 'center',
    cursor: 'pointer',
    boxShadow: selected ? `0 0 12px ${ACCENT}` : `0 0 6px ${rarityHex}33`,
    minHeight: '38px',
  } as Partial<CSSStyleDeclaration>);

  // 3D thumbnail on the left.
  const img = document.createElement('img');
  img.src = getItemThumbnail(item);
  Object.assign(img.style, {
    width: '32px', height: '32px',
    objectFit: 'contain', imageRendering: 'pixelated',
    flexShrink: '0', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(img);

  // Text block on the right.
  const text = document.createElement('div');
  Object.assign(text.style, {
    display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between' } as Partial<CSSStyleDeclaration>);

  const name = document.createElement('div');
  name.textContent = abbrev(item);
  Object.assign(name.style, {
    fontSize: '11px', color: rarityHex, fontWeight: '500',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);

  const cnt = document.createElement('div');
  cnt.textContent = count > 1 ? `×${count}` : '';
  Object.assign(cnt.style, {
    fontSize: '10px', color: TEXT_DIM, fontFamily: 'monospace', flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  top.append(name, cnt);

  const kindLabel = document.createElement('div');
  kindLabel.textContent = item.kind.toUpperCase();
  Object.assign(kindLabel.style, {
    fontSize: '9px', letterSpacing: '0.2em', color: TEXT_DIM,
  } as Partial<CSSStyleDeclaration>);

  text.append(top, kindLabel);
  cell.appendChild(text);

  cell.addEventListener('click', (e) => {
    e.stopPropagation();
    selection = { kind: 'bag', item };
    rebuildPanel();
  });

  return cell;
}

// ── Details column (selected item) ────────────────────────────────────
// 4th column on the right — vertical layout so it fits landscape phone
// without exceeding the panel height. Always visible (with a hint when
// nothing is selected). Layout top-to-bottom:
//
//   [section label "DETAILS"]
//   [big thumbnail]   [name+meta]
//   [flavor text]
//   [bulleted effects]
//   [EQUIP / UNEQUIP / USE button]   <- always at the bottom
function buildDetailsColumn(): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);
  col.appendChild(sectionLabel('DETAILS'));

  const card = document.createElement('div');
  Object.assign(card.style, {
    flex: '1',
    minHeight: '0',
    background: CARD_BG,
    border: '1px solid rgba(120, 90, 60, 0.4)',
    borderRadius: '3px',
    padding: '8px 10px',
    display: 'flex', flexDirection: 'column', gap: '6px',
    overflowY: 'auto',
  } as Partial<CSSStyleDeclaration>);

  if (!selection) {
    const hint = document.createElement('div');
    hint.textContent = 'TAP AN ITEM TO INSPECT';
    Object.assign(hint.style, {
      color: TEXT_FAINT, fontSize: '10px',
      letterSpacing: '0.22em', textAlign: 'center',
      padding: '40px 0', margin: 'auto',
    } as Partial<CSSStyleDeclaration>);
    card.appendChild(hint);
    col.appendChild(card);
    return col;
  }

  const item = selection.item;

  // Top row: small thumbnail + name+meta side-by-side.
  const top = document.createElement('div');
  Object.assign(top.style, {
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px',
    alignItems: 'center',
  } as Partial<CSSStyleDeclaration>);

  const thumb = document.createElement('div');
  Object.assign(thumb.style, {
    width: '50px', height: '50px',
    background: 'rgba(20, 14, 10, 0.7)',
    border: `1.5px solid ${hexCss(RARITY_COLORS[item.rarity ?? 'mundane'])}`,
    borderRadius: '3px',
    boxShadow: `0 0 8px ${hexCss(RARITY_COLORS[item.rarity ?? 'mundane'])}55`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = getItemThumbnail(item);
  Object.assign(img.style, {
    width: '100%', height: '100%',
    objectFit: 'contain', imageRendering: 'pixelated',
  } as Partial<CSSStyleDeclaration>);
  thumb.appendChild(img);

  top.append(thumb, buildDetailsHeader(item));
  card.appendChild(top);

  const flavor = buildFlavorLine(item);
  if (flavor) card.appendChild(flavor);

  for (const line of describeItem(item)) card.appendChild(line);

  // Spacer + action at the bottom. Pinning the button to the bottom of
  // the column means it's always in the same place (predictable target).
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  card.appendChild(spacer);

  card.appendChild(buildDetailsAction(selection));
  col.appendChild(card);
  return col;
}

function buildDetailsHeader(item: ItemSpec): HTMLDivElement {
  // Stacked vertical: rarity·kind meta on top, name underneath. Sits
  // beside the thumbnail in the narrow details column.
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', flexDirection: 'column', gap: '2px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  const rarity = item.rarity ?? 'mundane';
  const rarityHex = hexCss(RARITY_COLORS[rarity]);

  const meta = document.createElement('div');
  meta.textContent = `${rarity.toUpperCase()} · ${item.kind.toUpperCase()}`;
  Object.assign(meta.style, {
    fontSize: '9px', color: TEXT_DIM, letterSpacing: '0.22em',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);

  const name = document.createElement('div');
  name.textContent = item.name;
  Object.assign(name.style, {
    fontSize: '13px', color: rarityHex,
    fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic',
    fontWeight: '500', lineHeight: '1.2',
  } as Partial<CSSStyleDeclaration>);

  wrap.append(meta, name);
  return wrap;
}

/** Italic in-world flavor line — rendered between the header row and the effects bullets. */
function buildFlavorLine(item: ItemSpec): HTMLDivElement | null {
  if (!item.flavor) return null;
  const flavor = document.createElement('div');
  flavor.textContent = item.flavor;
  Object.assign(flavor.style, {
    fontSize: '11px', color: TEXT_DIM, fontStyle: 'italic',
    fontFamily: 'Georgia, "Times New Roman", serif',
    lineHeight: '1.3',
    borderTop: '1px solid rgba(120, 90, 60, 0.3)', paddingTop: '4px',
  } as Partial<CSSStyleDeclaration>);
  return flavor;
}

function buildDetailsAction(sel: NonNullable<Selection>): HTMLButtonElement {
  const btn = document.createElement('button');
  let label: string;
  let onClick: () => void;

  if (sel.kind === 'bag') {
    if (sel.item.kind === 'consumable') {
      label = 'USE';
      onClick = () => {
        const item = sel.item;
        if (item.consumableHeal != null) {
          if (getPlayerHp() < getPlayerMaxHp()) {
            healPlayer(item.consumableHeal);
            playHealSlurp();
            removeItem(item.id);
          }
        } else if (item.consumableBuff) {
          const player = get('player');
          if (player) applyBuff(player, item.consumableBuff.buffId, item.consumableBuff.duration);
          playBuffApply();
          removeItem(item.id);
        }
        selection = null;
        rebuildPanel();
      };
    } else {
      label = 'EQUIP';
      onClick = () => {
        const item = sel.item;
        const previous = equipFromInventory(item);
        removeItem(item.id);
        if (previous) addItemSilently(previous.id);
        playEquipClick();
        selection = null;
        rebuildPanel();
      };
    }
  } else {
    // sel.kind === 'slot'
    if (sel.slotId === 'weapon') {
      label = 'WEAPON LOCKED';
      onClick = () => {};
    } else {
      label = 'UNEQUIP';
      onClick = () => {
        const unequipped = unequipSlot(sel.slotId);
        if (unequipped) addItemSilently(unequipped.id);
        playEquipClick();
        selection = null;
        rebuildPanel();
      };
    }
  }

  btn.textContent = label;
  Object.assign(btn.style, {
    width: '100%',
    padding: '12px 14px',
    background: label === 'WEAPON LOCKED' ? 'rgba(60, 40, 20, 0.4)' : 'rgba(160, 90, 40, 0.85)',
    border: label === 'WEAPON LOCKED' ? '1px solid rgba(120, 80, 50, 0.3)' : '1px solid rgba(255, 200, 120, 0.85)',
    borderRadius: '3px',
    color: 'rgba(255, 235, 210, 0.97)',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.25em',
    cursor: label === 'WEAPON LOCKED' ? 'default' : 'pointer',
    opacity: label === 'WEAPON LOCKED' ? '0.5' : '1',
    touchAction: 'manipulation',
    boxShadow: label === 'WEAPON LOCKED' ? 'none' : '0 0 12px rgba(255, 160, 80, 0.4)',
  } as Partial<CSSStyleDeclaration>);
  if (label !== 'WEAPON LOCKED') {
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  return btn;
}

// ── Item description ─────────────────────────────────────────────────
// Turn an ItemSpec into a list of human-readable description lines.
function describeItem(item: ItemSpec): HTMLDivElement[] {
  const lines: HTMLDivElement[] = [];

  if (item.weapon) {
    lines.push(detailLine(formatWeapon(item.weapon)));
  }
  if (item.modifiers && item.modifiers.length) {
    for (const m of item.modifiers) lines.push(detailLine(formatModifier(m)));
  }
  if (item.passives && item.passives.length) {
    for (const p of item.passives) lines.push(detailLine(formatPassive(p)));
  }
  if (item.consumableHeal != null) {
    lines.push(detailLine(`Restores ${item.consumableHeal} HP`));
  }
  if (item.consumableBuff) {
    const spec = BUFFS[item.consumableBuff.buffId];
    const buffDesc = spec
      ? formatBuffEffect(spec.id, item.consumableBuff.duration)
      : item.consumableBuff.buffId;
    lines.push(detailLine(`On use: ${buffDesc}`));
  }
  if (lines.length === 0) {
    lines.push(detailLine('No effects.', /*dim*/ true));
  }
  return lines;
}

function detailLine(text: string, dim = false): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = '· ' + text;
  Object.assign(el.style, {
    fontSize: '12px',
    color: dim ? TEXT_DIM : TEXT_PRIMARY,
    letterSpacing: '0.04em',
    lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>);
  return el;
}

function formatWeapon(w: WeaponStats): string {
  return `Base Damage ${w.damage}  ·  Reach ${w.reach.toFixed(1)}m  ·  Arc ${(w.coneHalfAngle * 180 / Math.PI).toFixed(0)}°`;
}

function formatModifier(m: StatModifier): string {
  switch (m.kind) {
    case 'max-hp':           return signed(m.amount) + ' Max HP';
    case 'weapon-damage':    return signed(m.amount) + ' Damage';
    case 'damage-multiplier':return `×${m.amount.toFixed(2)} Damage`;
    case 'physical-armor':   return signed(m.amount) + ' Physical Armor';
    case 'magic-armor':      return signed(m.amount) + ' Magic Armor';
  }
}

function formatPassive(p: PassiveSpec): string {
  const triggerLabel = ({
    hit: 'On hit',
    killed: 'On kill',
    damaged: 'When damaged',
    died: 'On death',
    interval: 'Periodically',
  } as const)[p.trigger.on];

  const effects = p.trigger.effects.map((e) => {
    if (e.type === 'damage')   return `${e.amount} damage`;
    if (e.type === 'heal')     return `heal ${e.amount} HP`;
    if (e.type === 'apply-buff' && e.buffId) {
      return formatBuffEffect(e.buffId, e.duration ?? 0);
    }
    return e.type;
  });
  return `${triggerLabel}: ${effects.join(', ')}`;
}

function formatBuffEffect(buffId: string, duration: number): string {
  const spec = BUFFS[buffId];
  if (!spec) return `${buffId} for ${duration}s`;
  const name = spec.displayName ?? buffId;

  const parts: string[] = [];
  if (spec.modifiers) {
    for (const m of spec.modifiers) parts.push(formatModifier(m));
  }
  if (spec.tickInterval && spec.tickEffect) {
    const e = spec.tickEffect;
    if (e.type === 'heal') parts.push(`+${e.amount} HP every ${spec.tickInterval}s`);
    if (e.type === 'damage') parts.push(`-${e.amount} HP every ${spec.tickInterval}s`);
  }
  const effectStr = parts.length ? ` (${parts.join(', ')})` : '';
  return `${name}${effectStr} for ${duration}s`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

// ── Misc helpers ─────────────────────────────────────────────────────
function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    fontSize: '10px', fontWeight: '500', letterSpacing: '0.25em',
    color: TEXT_DIM,
    borderBottom: '1px solid rgba(120, 90, 60, 0.3)',
    paddingBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  return el;
}

function abbrev(item: ItemSpec): string {
  const name = item.name.replace(/^(A |An |The )/, '');
  return name.length > 22 ? name.slice(0, 20) + '…' : name;
}

/** "0xff7722" -> "rgb(255, 119, 34)" — for inline CSS color strings. */
function hexCss(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

