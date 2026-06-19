import { onEquipmentChanged } from '../player/equipment';
import { onInventoryChanged } from '../player/inventory';
import { onPlayerStatsChanged } from '../state/player-stats';
import { ITEMS } from '../content/items';
import { on as onEvent } from '../broadcast/event-bus';
import { markItemNew, openInventoryView } from './item-new-flag';
import { createSheet, type Sheet } from './menu-shell';
import { buildSettingsContent } from './settings-menu';
import { buildCharacterContent } from './character-screen';
import { buildCodexContent } from './codex-screen';
import { FONT_UI } from './hud';
import { TEXT_PRIMARY, TEXT_DIM, type Selection, type InventoryCtx } from './inventory-shared';
import { buildStatsColumn } from './inventory-stats';
import { buildDollColumn } from './inventory-doll';
import { buildBagColumn } from './inventory-bag';
import { buildDetailsColumn } from './inventory-details';

// The unified in-game menu — one satchel button opens ONE sheet with a
// tab row: GEAR · CHARACTER · CODEX (+ a settings gear). Character is no
// longer buried three taps deep behind inventory→settings. Built on the
// mobile-first menu shell (menu-shell.ts): fixed header (tabs + ✕),
// scrolling body, safe-area + dvh bounds. GEAR is the old four-column
// inventory; CHARACTER / CODEX reuse the content builders from their
// screens so the standalone entry points still work too.

type Tab = 'gear' | 'character' | 'codex' | 'settings';
const TAB_LABELS: Record<Tab, string> = {
  gear: 'GEAR', character: 'CHARACTER', codex: 'CODEX', settings: '⚙',
};
const TABS: readonly Tab[] = ['gear', 'character', 'codex', 'settings'];

// ── Module-level state ───────────────────────────────────────────────
let openButton: HTMLButtonElement | null = null;
let sheet: Sheet | null = null;
let activeTab: Tab = 'gear';
let selection: Selection = null;
let charDispose: (() => void) | null = null;
const tabButtons: Partial<Record<Tab, HTMLButtonElement>> = {};

export function createInventoryPanel() {
  if (openButton) return;

  openButton = document.createElement('button');
  openButton.id = 'inventory-button'; openButton.classList.add('game-hud');
  openButton.setAttribute('aria-label', 'inventory');
  // Leather satchel — same visual register as the Minimal-style hearts:
  // filled dark-leather body, hairline gold edge, gold buckle as the
  // hot accent, drop shadow for weight. Replaces the earlier
  // pure-stroke glyph (which read flat next to the hearts).
  openButton.innerHTML = `
    <svg viewBox="0 0 24 24" width="22" height="22"
         style="display:block;margin:auto;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85));">
      <!-- Shoulder strap arc -->
      <path d="M8 9 L8 7 Q8 4 12 4 Q16 4 16 7 L16 9"
            fill="none"
            stroke="rgba(150, 100, 60, 0.95)"
            stroke-width="1.3"
            stroke-linejoin="round"
            stroke-linecap="round" />
      <!-- Body — filled dark leather, hairline gold edge -->
      <path d="M4.5 9.5 Q4.5 9 5 9 L19 9 Q19.5 9 19.5 9.5 L19.5 19.5 Q19.5 21 18 21 L6 21 Q4.5 21 4.5 19.5 Z"
            fill="rgba(40, 26, 18, 0.92)"
            stroke="rgba(200, 150, 80, 0.55)"
            stroke-width="1.1"
            stroke-linejoin="round" />
      <!-- Flap fold line across the top of the body -->
      <line x1="5" y1="13" x2="19" y2="13"
            stroke="rgba(200, 150, 80, 0.32)"
            stroke-width="0.8" />
      <!-- Buckle — gold accent, the hot spot -->
      <rect x="10.5" y="14.5" width="3" height="2.2" rx="0.4"
            fill="rgba(230, 180, 90, 0.95)"
            stroke="rgba(80, 50, 20, 0.85)"
            stroke-width="0.4" />
      <!-- Buckle prong -->
      <line x1="12" y1="14.5" x2="12" y2="16.7"
            stroke="rgba(60, 35, 15, 0.9)" stroke-width="0.5" />
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
    toggle();
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

  // A live GEAR tab refreshes when its data changes; other tabs don't care.
  const refreshGear = () => { if (sheet && activeTab === 'gear') renderGear(); };
  onInventoryChanged(refreshGear);
  onEquipmentChanged(refreshGear);
  onPlayerStatsChanged(refreshGear);
  // Flag picked-up items as NEW (badge + sort-first in the bag).
  onEvent((e) => { if (e.type === 'item:picked-up') markItemNew(e.itemId); });
}

function isOpen(): boolean { return !!sheet; }
function toggle() { isOpen() ? close() : open('gear'); }

/** Programmatic open — debug snaps + the I hotkey. */
export function openInventoryPanel() { open('gear'); }

/** Open straight to the CHARACTER tab (desktop C / settings button). */
export function openCharacterTab() { open('character'); }

/** Toggle — desktop I hotkey. Pointer-lock release on open + re-grab on close
 *  are owned by the screen manager now (this panel registers as a screen via
 *  menu-shell), so no manual lock handling here. */
export function toggleInventoryPanel() {
  toggle();
}

export function isInventoryPanelOpen(): boolean { return isOpen(); }

/** Select a bag item by id (snap scenarios). Switches to GEAR. */
export function selectBagItem(itemId: string) {
  const item = ITEMS[itemId];
  if (!item) return;
  selection = { kind: 'bag', item };
  activeTab = 'gear';
  if (sheet) { syncTabStyles(); renderTab(); }
}

// ── Open / close ─────────────────────────────────────────────────────
function open(tab: Tab) {
  if (sheet) { selectTab(tab); return; }
  activeTab = tab;
  selection = null;
  openInventoryView();   // promote pending-new items → this view (badge + sort)
  const s = createSheet({
    id: 'inventory',
    width: 940,                 // GEAR's four columns want room (clamps on mobile)
    onClose: teardown,
  });
  sheet = s;
  buildTabRow(s.header);
  renderTab();
  s.open();
}

function close() { sheet?.close(); }   // close() → onClose: teardown

function teardown() {
  charDispose?.();
  charDispose = null;
  sheet = null;
  selection = null;
  for (const k of Object.keys(tabButtons) as Tab[]) delete tabButtons[k];
}

// ── Tab row (lives in the sheet header) ──────────────────────────────
function buildTabRow(header: HTMLDivElement) {
  const titleEl = header.firstElementChild;   // the shell's (empty) title slot
  const row = document.createElement('div');
  Object.assign(row.style, {
    flex: '1 1 auto',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    minWidth: '0',
    overflowX: 'auto',
  } as Partial<CSSStyleDeclaration>);

  // Tabs, including SETTINGS (⚙) as a peer — tapping it swaps the body
  // to settings IN-PLACE, never a second overlay on top of the menu.
  TABS.forEach((t) => {
    const b = tabButton(TAB_LABELS[t], () => selectTab(t));
    tabButtons[t] = b;
    // The ⚙ tab floats to the right edge, set apart from the loadout tabs.
    if (t === 'settings') {
      b.style.marginLeft = 'auto';
      b.style.fontSize = '18px';
      b.style.letterSpacing = '0';
      b.setAttribute('aria-label', 'settings');
    }
    row.appendChild(b);
  });

  titleEl?.replaceWith(row);
  syncTabStyles();
}

function tabButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    flex: '0 0 auto',
    minHeight: '40px',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: TEXT_DIM,
    fontFamily: FONT_UI,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.18em',
    cursor: 'pointer',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function syncTabStyles() {
  for (const t of Object.keys(tabButtons) as Tab[]) {
    const b = tabButtons[t];
    if (!b) continue;
    const on = t === activeTab;
    b.style.color = on ? 'rgba(255, 200, 140, 0.95)' : TEXT_DIM;
    b.style.borderBottomColor = on ? 'rgba(255, 160, 80, 0.85)' : 'transparent';
  }
}

function selectTab(tab: Tab) {
  activeTab = tab;
  syncTabStyles();
  renderTab();
}

// ── Tab content ──────────────────────────────────────────────────────
function renderTab() {
  if (!sheet) return;
  charDispose?.();
  charDispose = null;
  sheet.body.replaceChildren();
  if (activeTab === 'gear') {
    renderGear();
  } else if (activeTab === 'character') {
    const c = buildCharacterContent();
    charDispose = c.dispose;
    sheet.body.appendChild(c.el);
  } else if (activeTab === 'codex') {
    sheet.body.appendChild(buildCodexContent());
  } else {
    sheet.body.appendChild(buildSettingsContent());
  }
}

function renderGear() {
  if (!sheet) return;
  sheet.body.replaceChildren(buildColumns());
}

// ── GEAR columns: stats | doll | bag | details ───────────────────────
// Landscape-friendly: side-by-side so we never run out of vertical space;
// the details column on the far right is always present (EQUIP / USE /
// UNEQUIP never get cut off).
function buildColumns(): HTMLDivElement {
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '0.55fr 0.9fr 1fr 1.25fr',
    gap: '10px',
    alignItems: 'stretch',
    minHeight: '0',
  } as Partial<CSSStyleDeclaration>);

  // The selection state lives here; columns read it + request changes
  // through ctx.select, which updates state and re-renders GEAR.
  const ctx: InventoryCtx = {
    selection,
    select(sel: Selection) { selection = sel; renderGear(); },
  };

  grid.appendChild(buildStatsColumn());
  grid.appendChild(buildDollColumn(ctx));
  grid.appendChild(buildBagColumn(ctx));
  grid.appendChild(buildDetailsColumn(ctx));
  return grid;
}
