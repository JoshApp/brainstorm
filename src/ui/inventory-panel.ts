import { onEquipmentChanged } from '../player/equipment';
import { onInventoryChanged } from '../player/inventory';
import { onPlayerStatsChanged } from '../state/player-stats';
import { ITEMS } from '../content/items';
import { openScreen, closeScreen } from './screen-manager';
import { openSettings } from './settings-menu';
import { FONT_UI } from './hud';
import { PANEL_BG, PANEL_BORDER, TEXT_PRIMARY, type Selection, type InventoryCtx } from './inventory-shared';
import { buildStatsColumn } from './inventory-stats';
import { buildDollColumn } from './inventory-doll';
import { buildBagColumn } from './inventory-bag';
import { buildDetailsColumn } from './inventory-details';

// Inventory + character stat sheet — the orchestrator. Owns the open/close
// lifecycle + the selection state; each of the four columns is its own
// component (inventory-{stats,doll,bag,details}.ts), built fresh on every
// rebuild and handed an InventoryCtx to read the selection + request a new one.
//
// Horizontal four-column layout (mobile landscape):
//   stats | paper-doll | bag | details
// Selecting an item is non-destructive — you see what it does before
// committing via the details column's EQUIP / USE / UNEQUIP button.

// ── Module-level state ───────────────────────────────────────────────
let openButton: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let panelOpen = false;
let selection: Selection = null;

export function createInventoryPanel() {
  if (openButton) return;

  openButton = document.createElement('button');
  openButton.id = 'inventory-button';
  openButton.setAttribute('aria-label', 'inventory');
  // Satchel/bag SVG — fits the dungeon-delver register better than the
  // abstract ▦ grid glyph that was here before. Strap arc + body box
  // + clasp line.
  openButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linejoin="round" stroke-linecap="round" width="22" height="22"
         style="display:block;margin:auto;">
      <path d="M5 9 L5 19.5 Q5 21 6.5 21 L17.5 21 Q19 21 19 19.5 L19 9 Z" />
      <path d="M8 9 L8 7 Q8 4.5 12 4.5 Q16 4.5 16 7 L16 9" />
      <line x1="9" y1="13" x2="15" y2="13" />
    </svg>
  `;
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
    padding: '0',
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
  // Keyboard hint badge — only shown on pure desktop. Tiny letter in
  // the corner of the satchel icon so players who have a keyboard
  // discover the I shortcut without polluting the touch HUD.
  Promise.all([
    import('../controls/platform'),
    import('../controls/keybindings'),
  ]).then(([{ isDesktopLike }, { getBinding, labelForCode, onBindingsChanged }]) => {
    if (!isDesktopLike() || !openButton) return;
    const hint = document.createElement('div');
    hint.textContent = labelForCode(getBinding('inventory'));
    // Keep the badge in sync if the player rebinds inventory.
    onBindingsChanged(() => { hint.textContent = labelForCode(getBinding('inventory')); });
    Object.assign(hint.style, {
      position: 'absolute',
      bottom: '2px',
      right: '4px',
      fontFamily: FONT_UI,
      fontSize: '9px',
      fontWeight: '700',
      letterSpacing: '0.05em',
      color: 'rgba(180, 130, 90, 0.7)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    openButton.appendChild(hint);
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
    fontFamily: FONT_UI,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.9)',
    zIndex: '100',
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);

  onInventoryChanged(() => { if (panelOpen) rebuildPanel(); });
  onEquipmentChanged(() => { if (panelOpen) rebuildPanel(); });
  // Stat snapshot changes (proficiency gain, attribute spend, buff on/off)
  // refresh the open panel so the readout never goes stale. Fires only on a
  // real change, and only the panel-open case rebuilds.
  onPlayerStatsChanged(() => { if (panelOpen) rebuildPanel(); });
}

function togglePanel() { panelOpen ? closePanel() : openPanel(); }

/** Programmatic open — used by debug scenarios for snaps. */
export function openInventoryPanel() {
  openPanel();
}

/** Toggle open/close — used by the desktop 'I' hotkey + future
 *  controller binding. Opening via this path also releases pointer
 *  lock so the player can drive the panel with the mouse. */
export function toggleInventoryPanel() {
  togglePanel();
  if (panelOpen) {
    if (document.exitPointerLock) document.exitPointerLock();
  }
}

/** Whether the inventory panel is currently open. */
export function isInventoryPanelOpen(): boolean {
  return panelOpen;
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
  panel.appendChild(buildColumns());
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

  // Right side: gear (settings) + close. Gear sits inside the inventory
  // so the gameplay HUD doesn't carry a standalone settings button.
  const right = document.createElement('div');
  Object.assign(right.style, {
    display: 'flex', alignItems: 'center', gap: '4px',
  } as Partial<CSSStyleDeclaration>);

  const gear = document.createElement('button');
  gear.textContent = '⚙';
  gear.setAttribute('aria-label', 'settings');
  Object.assign(gear.style, {
    background: 'transparent', border: 'none',
    color: 'rgba(200, 160, 110, 0.7)', fontSize: '18px', cursor: 'pointer',
    padding: '4px 8px', lineHeight: '1',
  } as Partial<CSSStyleDeclaration>);
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
  });

  const close = document.createElement('button');
  close.textContent = '✕';
  Object.assign(close.style, {
    background: 'transparent', border: 'none',
    color: 'rgba(220, 180, 140, 0.7)', fontSize: '18px', cursor: 'pointer',
    padding: '4px 8px',
  } as Partial<CSSStyleDeclaration>);
  close.addEventListener('click', closePanel);

  right.append(gear, close);
  header.append(title, right);
  return header;
}

// ── Columns: stats | doll | bag | details ─────────────────────────────
// Landscape-phone-friendly: every region is side-by-side so we never run
// out of vertical space. The details column on the far right is ALWAYS
// visible — EQUIP / UNEQUIP / USE buttons never get cut off the bottom.
function buildColumns(): HTMLDivElement {
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '0.55fr 0.9fr 1fr 1.25fr',
    gap: '10px',
    alignItems: 'stretch',
    flex: '1',
    minHeight: '0',
  } as Partial<CSSStyleDeclaration>);

  // The selection state lives here; columns read it + request changes
  // through ctx.select, which updates state and rebuilds.
  const ctx: InventoryCtx = {
    selection,
    select(sel: Selection) { selection = sel; rebuildPanel(); },
  };

  grid.appendChild(buildStatsColumn());
  grid.appendChild(buildDollColumn(ctx));
  grid.appendChild(buildBagColumn(ctx));
  grid.appendChild(buildDetailsColumn(ctx));
  return grid;
}
