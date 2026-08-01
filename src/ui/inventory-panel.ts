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
import { buildReliquaryContent } from './reliquary-screen';
import { onReliquaryChanged } from '../player/reliquary';

// The unified in-game menu — one satchel button opens ONE sheet with a
// tab row: GEAR · CHARACTER · CODEX (+ a settings gear). Character is no
// longer buried three taps deep behind inventory→settings. Built on the
// mobile-first menu shell (menu-shell.ts): fixed header (tabs + ✕),
// scrolling body, safe-area + dvh bounds. GEAR is the old four-column
// inventory; CHARACTER / CODEX reuse the content builders from their
// screens so the standalone entry points still work too.

type Tab = 'gear' | 'reliquary' | 'character' | 'codex' | 'settings';
const TAB_LABELS: Record<Tab, string> = {
  gear: 'GEAR', reliquary: 'RELIQUARY', character: 'CHARACTER', codex: 'CODEX', settings: '⚙',
};
const TABS: readonly Tab[] = ['gear', 'reliquary', 'character', 'codex', 'settings'];

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
  // Leather MESSENGER SATCHEL — wide body + a big fold-over FLAP with a front
  // buckle, straps splitting to the SIDES. The old version had a centred strap
  // ARC over the body, which read as a padlock SHACKLE ("feature locked"). A
  // dominant flap + side straps is unmistakably a bag. Same leather/gold palette
  // as the Minimal hearts (filled dark leather, hairline gold edge, gold buckle).
  openButton.innerHTML = `
    <svg viewBox="0 0 24 24" width="22" height="22"
         style="display:block;margin:auto;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85));">
      <!-- Carry straps — split to the sides (NOT a centred shackle arc) -->
      <path d="M5.2 10 Q3.8 7.6 4.6 5.4" fill="none"
            stroke="rgba(150, 100, 60, 0.9)" stroke-width="1.2" stroke-linecap="round" />
      <path d="M18.8 10 Q20.2 7.6 19.4 5.4" fill="none"
            stroke="rgba(150, 100, 60, 0.9)" stroke-width="1.2" stroke-linecap="round" />
      <!-- Body — wider than tall, rounded base -->
      <path d="M4.5 10.5 L19.5 10.5 L19.5 18 Q19.5 20.5 17 20.5 L7 20.5 Q4.5 20.5 4.5 18 Z"
            fill="rgba(40, 26, 18, 0.92)"
            stroke="rgba(200, 150, 80, 0.5)" stroke-width="1.1" stroke-linejoin="round" />
      <!-- Flap folding over the front, dipping to a point in the middle -->
      <path d="M3.8 8 Q3.8 6.9 5 6.9 L19 6.9 Q20.2 6.9 20.2 8 L20.2 11.6 Q20.2 12.6 19.4 13 L12 15 L4.6 13 Q3.8 12.6 3.8 11.6 Z"
            fill="rgba(52, 34, 22, 0.95)"
            stroke="rgba(200, 150, 80, 0.6)" stroke-width="1.1" stroke-linejoin="round" />
      <!-- Buckle strap from flap down to the body -->
      <rect x="10.9" y="12.6" width="2.2" height="4" rx="0.4"
            fill="rgba(34, 22, 15, 0.95)" stroke="rgba(200, 150, 80, 0.35)" stroke-width="0.5" />
      <!-- Buckle — gold accent, the hot spot -->
      <rect x="10.4" y="14" width="3.2" height="2.2" rx="0.4"
            fill="rgba(230, 180, 90, 0.95)" stroke="rgba(80, 50, 20, 0.85)" stroke-width="0.4" />
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
  // The RELIQUARY tab (and GEAR's summary line) track the collection live.
  onReliquaryChanged(() => {
    if (!sheet) return;
    if (activeTab === 'reliquary') renderReliquary();
    else if (activeTab === 'gear') renderGear();
  });
  // Flag picked-up items as NEW (badge + sort-first in the bag).
  onEvent((e) => { if (e.type === 'item:picked-up') markItemNew(e.itemId); });
}

function isOpen(): boolean { return !!sheet; }
function toggle() { isOpen() ? close() : open('gear'); }

/** Programmatic open — debug snaps + the I hotkey. */
export function openInventoryPanel(tab: 'gear' | 'reliquary' = 'gear') { open(tab); }

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

/** Select a collected relic by id (snap scenarios). Switches to RELIQUARY. */
export function selectRelicItem(itemId: string) {
  const item = ITEMS[itemId];
  if (!item) return;
  selection = { kind: 'relic', item };
  activeTab = 'reliquary';
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
  } else if (activeTab === 'reliquary') {
    renderReliquary();
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

// ── RELIQUARY: the oddities collection (domain-grouped stacks | details) ──
function renderReliquary() {
  if (!sheet) return;
  const ctx: InventoryCtx = {
    selection,
    select(sel: Selection) { selection = sel; renderReliquary(); },
  };
  sheet.body.replaceChildren(buildReliquaryContent(ctx));
}

// ── GEAR columns: stats | doll | bag [ | details ] ───────────────────
// Landscape-friendly: side-by-side so we never run out of vertical space.
// The DETAILS column is REVEALED on selection, not always present — the
// resting state (browsing) is three roomy columns; tapping an item slides
// the details+action pane in as a fourth. That keeps a phone from showing
// four dense panes at once when there's nothing to inspect yet. Acting
// (EQUIP/USE/UNEQUIP) clears the selection and the pane folds back away.
function buildColumns(): HTMLDivElement {
  const grid = document.createElement('div');
  const showDetails = selection !== null;
  Object.assign(grid.style, {
    display: 'grid',
    // Resting: 3 columns, BAG gets the freed room. Selected: 4, DETAILS widest.
    gridTemplateColumns: showDetails ? '0.5fr 0.82fr 1fr 1.35fr' : '0.62fr 1fr 1.28fr',
    gap: '10px',
    alignItems: 'stretch',
    minHeight: '0',
  } as Partial<CSSStyleDeclaration>);

  // The selection state lives here; columns read it + request changes
  // through ctx.select, which updates state and re-renders GEAR.
  const ctx: InventoryCtx = {
    selection,
    select(sel: Selection) { selection = sel; renderGear(); },
    openReliquary() { selectTab('reliquary'); },
  };

  grid.appendChild(buildStatsColumn());
  grid.appendChild(buildDollColumn(ctx));
  grid.appendChild(buildBagColumn(ctx));
  if (showDetails) grid.appendChild(buildDetailsColumn(ctx));
  return grid;
}
