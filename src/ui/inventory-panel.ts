import { onEquipmentChanged } from '../player/equipment';
import satchelUrl from '../assets/ui/hud/satchel.webp?url';
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
import { getEquipped } from '../player/equipment';
import { attachHudPrompt } from './kit/prompts';

import { buildGearPane } from './inventory-bag';
import { buildDetailsColumn } from './inventory-details';
import { buildReliquaryContent, firstRelicShown } from './reliquary-screen';
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
  // The satchel mark (Lamplight art pass): a slumped leather bag with an iron
  // buckle, drawn by ChatGPT and keyed; it reads as "your things" at thumb size.
  openButton.innerHTML = `<img src="${satchelUrl}" alt="" draggable="false"
    style="display:block;width:30px;height:30px;margin:auto;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85));">`;
  Object.assign(openButton.style, {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top, 0px))',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '1px solid rgba(180, 130, 80, 0.55)',
    background: 'radial-gradient(circle at 50% 45%, rgba(40, 26, 16, 0.92), rgba(10, 6, 4, 0.85))',
    boxShadow: '0 0 14px rgba(255, 140, 50, 0.16), inset 0 -3px 8px rgba(0, 0, 0, 0.6)',
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
  // The satchel's button on keyboard / pad, tucked onto its rim (the bound
  // inventory key, View on a pad); nothing on touch.
  attachHudPrompt(openButton, { key: 'inventory', pad: 'inventory', corner: 'bl' });
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
export function openInventoryPanel(tab: Tab = 'gear') { open(tab); }

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
    // One fixed frame for every tab: the lists scroll inside their own panes
    // and the description slab keeps its size, so choosing an item or a tab
    // never resizes the menu (Josh: "for a game ui it should be more stable").
    height: 620,
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
  // The reliquary reads a relic, never the sword GEAR left chosen: open on
  // the first relic kept (in the order the reliquary shows them).
  if (selection?.kind !== 'relic') {
    const first = firstRelicShown();
    selection = first ? { kind: 'relic', item: first } : null;
  }
  const ctx: InventoryCtx = {
    selection,
    select(sel: Selection) { selection = sel; renderReliquary(); },
  };
  sheet.body.replaceChildren(buildReliquaryContent(ctx));
}

// ── GEAR: the tiles | the slab ────────────────────────────────────────
// The Lamplight draft blended with the game: what you wear and what you carry
// in one tile grid (inventory-bag.ts buildGearPane), the rite and reliquary as
// rows beneath it, and the scorched slab reading the chosen thing.
function buildColumns(): HTMLDivElement {
  const grid = document.createElement('div');
  // The slab is always there (the Lamplight draft): with nothing chosen (or a
  // relic still chosen from the reliquary) it tells the weapon in your hand.
  if (selection === null || selection.kind === 'relic') {
    const held = getEquipped('weapon');
    selection = held ? { kind: 'slot', slotId: 'weapon', item: held } : null;
  }
  // Two panes, the draft's proportions: the tiles | the slab. Each fills the
  // frame and scrolls on its own, so a choice never reflows the menu.
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
    gridTemplateRows: 'minmax(0, 1fr)',
    gap: '18px',
    alignItems: 'stretch',
    flex: '1 1 auto',
    minHeight: '0',
    // Room inside the frame: the sheet's corner brackets sat on the slab's
    // charred edge (Josh, 2026-11-24: "the right side is hidden behind").
    padding: '2px 10px 8px 0',
  } as Partial<CSSStyleDeclaration>);

  // The selection state lives here; panes read it + request changes through
  // ctx.select, which updates state and re-renders GEAR.
  const ctx: InventoryCtx = {
    selection,
    select(sel: Selection) { selection = sel; renderGear(); },
    openReliquary() { selectTab('reliquary'); },
  };
  grid.append(buildGearPane(ctx), buildDetailsColumn(ctx));
  return grid;
}
