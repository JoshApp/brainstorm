// The merchant shop — a proper mobile shop HUD (not a text list). Two panes:
// a rarity-framed WARES GRID (tap a tile to select) and a PREVIEW panel that
// shows the selected ware's full card (the same buildItemCard the inventory +
// pickups use) with a big BUY action stating the price + your gold. Buying
// spends run gold and routes the item (relics → reliquary, else → bag). Sold
// wares stay sold for the life of the stall (the ShopWare.sold flag).

import { createSheet, menuButton } from './menu-shell';
import { emit } from '../broadcast/event-bus';
import { getGold, spendGold, grantGold } from '../state/run-state';
import { addItem } from '../player/inventory';
import { addRelic } from '../player/reliquary';
import { wareItem, type ShopWare } from '../content/shop';
import { RARITY_COLORS, ITEMS } from '../content/items';
import { buildItemCard } from './item-card';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from '../style/color-utils';
import { THEME, FONT_UI } from './theme';
import { playEquipClick } from '../audio/sfx';

export interface ShopScreenOpts {
  /** Sheet title — the vendor's name (defaults to the wandering merchant). */
  title?: string;
  /** Empty-stall line, in the vendor's voice. */
  emptyLine?: string;
}

export function openShopScreen(stock: ShopWare[], opts: ShopScreenOpts = {}): void {
  const sheet = createSheet({
    id: 'merchant-shop',
    title: opts.title ?? 'THE WANDERING MERCHANT',
    width: 560,
    policy: { pausesWorld: true, needsBackdrop: true },
  });

  // ── Gold on hand — a header strip, kept current as you buy. ──
  const goldStrip = document.createElement('div');
  Object.assign(goldStrip.style, {
    flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '6px', color: THEME.amber, fontFamily: 'ui-monospace, monospace',
    fontSize: '13px', letterSpacing: '.06em', marginBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  const goldVal = document.createElement('span');
  goldStrip.append(coinGlyph(), goldVal);
  const refreshGold = () => { goldVal.textContent = `${getGold()}`; };
  sheet.body.appendChild(goldStrip);

  if (stock.length === 0) {
    const empty = document.createElement('div');
    Object.assign(empty.style, { color: THEME.dim, fontStyle: 'italic', padding: '18px 2px', fontFamily: 'Georgia, serif' } as Partial<CSSStyleDeclaration>);
    empty.textContent = opts.emptyLine ?? 'The stall is bare. Nothing here is for you.';
    sheet.body.appendChild(empty);
    sheet.footer.appendChild(menuButton('LEAVE', () => sheet.close(), { primary: true }));
    refreshGold();
    sheet.open();
    return;
  }

  // The body owns no scroll — the two panes each scroll internally so the BUY
  // action stays pinned in view no matter how tall a card is (a long weapon
  // card must not push BUY below the fold on a short landscape screen).
  sheet.body.style.overflowY = 'hidden';

  // ── Two panes: wares grid (left) + preview (right). Wraps to stacked on a
  //    very narrow screen; side-by-side on landscape (uses the width). ──
  const panes = document.createElement('div');
  Object.assign(panes.style, {
    flex: '1 1 auto', minHeight: '0', display: 'flex', flexWrap: 'wrap',
    gap: '12px', alignItems: 'stretch', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(panes);

  // GRID pane — scrolls its tiles if the stall is large.
  const gridPane = document.createElement('div');
  Object.assign(gridPane.style, {
    flex: '1 1 190px', minWidth: '150px', minHeight: '0', overflowY: 'auto', touchAction: 'pan-y',
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))',
    gridAutoRows: 'min-content', gap: '8px', alignContent: 'start',
  } as Partial<CSSStyleDeclaration>);
  panes.appendChild(gridPane);

  // PREVIEW pane — card scrolls, BUY pinned at the bottom.
  const previewPane = document.createElement('div');
  Object.assign(previewPane.style, {
    flex: '1 1 230px', minWidth: '200px', minHeight: '0', display: 'flex', flexDirection: 'column',
    gap: '8px', padding: '10px', borderRadius: '3px',
    background: THEME.raised, border: `1px solid ${THEME.rule}`,
  } as Partial<CSSStyleDeclaration>);
  panes.appendChild(previewPane);

  const previewBody = document.createElement('div');
  Object.assign(previewBody.style, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', touchAction: 'pan-y' } as Partial<CSSStyleDeclaration>);
  const buyBtn = menuButton('BUY', () => buySelected(), { primary: true });
  buyBtn.style.width = '100%';
  previewPane.append(previewBody, buyBtn);

  // ── Selection state ──
  interface Tile { el: HTMLDivElement; ware: ShopWare; markSold: () => void; setSelected: (on: boolean) => void }
  const tiles: Tile[] = [];
  let selected: ShopWare | null = null;

  function renderPreview(): void {
    previewBody.innerHTML = '';
    if (!selected) {
      const hint = document.createElement('div');
      Object.assign(hint.style, { color: THEME.dim, fontStyle: 'italic', fontSize: '12px', padding: '8px 2px', fontFamily: 'Georgia, serif' } as Partial<CSSStyleDeclaration>);
      hint.textContent = 'Choose a ware to inspect it.';
      previewBody.appendChild(hint);
      buyBtn.style.display = 'none';
      return;
    }
    const item = wareItem(selected);
    if (item) previewBody.appendChild(buildItemCard(item, { compare: true }));
    buyBtn.style.display = 'block';
    refreshBuy();
  }

  function refreshBuy(): void {
    if (!selected) return;
    const afford = getGold() >= selected.price;
    if (selected.sold) {
      buyBtn.textContent = 'SOLD';
      buyBtn.disabled = true; buyBtn.style.opacity = '0.45';
    } else {
      buyBtn.innerHTML = '';
      buyBtn.append('BUY  ·  ', coinGlyph(), ` ${selected.price}`);
      buyBtn.disabled = !afford;
      buyBtn.style.opacity = afford ? '1' : '0.5';
    }
  }

  function select(ware: ShopWare): void {
    if (selected === ware) return;
    selected = ware;
    for (const t of tiles) t.setSelected(t.ware === ware);
    playEquipClick();
    renderPreview();
  }

  function buySelected(): void {
    const ware = selected;
    if (!ware || ware.sold) return;
    if (getGold() < ware.price) { flashDenied(buyBtn); return; }
    spendGold(ware.price);
    const spec = ITEMS[ware.itemId];
    if (spec?.kind === 'relic') {
      addRelic(spec);
      emit({ type: 'item:picked-up', itemId: ware.itemId });
    } else if (!addItem(ware.itemId)) {
      grantGold(ware.price); flashDenied(buyBtn); return;   // refused at carry cap — refund
    }
    emit({ type: 'transaction:accepted', family: 'priced', id: `shop:${ware.itemId}`, price: { gold: ware.price } });
    emit({ type: 'transaction:resolved', family: 'priced', id: `shop:${ware.itemId}`, outcome: { itemIds: [ware.itemId] } });
    ware.sold = true;
    for (const t of tiles) if (t.ware === ware) t.markSold();
    refreshGold();
    refreshBuy();
  }

  // Build the tiles.
  for (const ware of stock) {
    const tile = makeTile(ware, () => select(ware));
    tiles.push(tile);
    gridPane.appendChild(tile.el);
  }

  sheet.footer.appendChild(menuButton('LEAVE', () => sheet.close(), { primary: true }));

  // Open with the first still-available ware previewed (or the first ware).
  select(stock.find((w) => !w.sold) ?? stock[0]);
  refreshGold();
  sheet.open();
}

// ── A single ware TILE — rarity-framed thumbnail, price badge, name, sold state. ──
function makeTile(ware: ShopWare, onSelect: () => void): { el: HTMLDivElement; ware: ShopWare; markSold: () => void; setSelected: (on: boolean) => void } {
  const item = wareItem(ware);
  const rarityHex = hexCss(RARITY_COLORS[ware.rarity]);

  const el = document.createElement('div');
  Object.assign(el.style, {
    display: 'flex', flexDirection: 'column', gap: '3px', cursor: 'pointer',
    userSelect: 'none', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);

  // Thumbnail frame.
  const frame = document.createElement('div');
  Object.assign(frame.style, {
    position: 'relative', width: '100%', aspectRatio: '1 / 1',
    background: 'radial-gradient(ellipse at 50% 35%, rgba(40,28,18,0.9), rgba(12,8,6,0.95))',
    border: `1.5px solid ${rarityHex}`, borderRadius: '3px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    transition: 'box-shadow .12s ease, transform .12s ease',
  } as Partial<CSSStyleDeclaration>);
  if (item) {
    const img = document.createElement('img');
    img.src = getItemThumbnail(item);
    Object.assign(img.style, { width: '82%', height: '82%', objectFit: 'contain', imageRendering: 'pixelated' } as Partial<CSSStyleDeclaration>);
    frame.appendChild(img);
  }
  // Price badge, bottom-right of the frame.
  const badge = document.createElement('div');
  Object.assign(badge.style, {
    position: 'absolute', right: '2px', bottom: '2px',
    display: 'flex', alignItems: 'center', gap: '2px',
    padding: '1px 4px', borderRadius: '2px',
    background: 'rgba(8,6,4,0.85)', color: THEME.amber,
    fontFamily: 'ui-monospace, monospace', fontSize: '10px', lineHeight: '1.2',
  } as Partial<CSSStyleDeclaration>);
  badge.append(coinGlyph(9), `${ware.price}`);
  frame.appendChild(badge);
  // SOLD scrim.
  const scrim = document.createElement('div');
  Object.assign(scrim.style, {
    position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(6,4,3,0.66)', color: THEME.dim, fontFamily: FONT_UI,
    fontSize: '11px', letterSpacing: '.18em', fontWeight: '700',
  } as Partial<CSSStyleDeclaration>);
  scrim.textContent = 'SOLD';
  frame.appendChild(scrim);

  // Name under the tile.
  const name = document.createElement('div');
  Object.assign(name.style, {
    color: rarityHex, fontFamily: FONT_UI, fontSize: '10px', lineHeight: '1.15',
    textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
    display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', minHeight: '24px',
  } as Partial<CSSStyleDeclaration>);
  name.textContent = ware.name;

  el.append(frame, name);
  el.addEventListener('click', (e) => { e.stopPropagation(); onSelect(); });

  const markSold = () => { scrim.style.display = 'flex'; el.style.opacity = '0.6'; };
  const setSelected = (on: boolean) => {
    // Selected reads three ways so it's unambiguous at every rarity (a gray
    // mundane glow alone is too faint on the dark slab): an amber SELECT ring
    // over the rarity border, a lift, and a warm background wash.
    frame.style.boxShadow = on
      ? `inset 0 0 0 2px ${THEME.amber}, 0 0 16px ${rarityHex}66, 0 3px 8px rgba(0,0,0,0.5)`
      : 'none';
    frame.style.transform = on ? 'translateY(-2px)' : 'none';
    frame.style.background = on
      ? `radial-gradient(ellipse at 50% 30%, rgba(70,48,24,0.95), rgba(16,10,6,0.95))`
      : 'radial-gradient(ellipse at 50% 35%, rgba(40,28,18,0.9), rgba(12,8,6,0.95))';
    name.style.opacity = on ? '1' : '0.72';
    name.style.fontWeight = on ? '600' : '400';
  };
  if (ware.sold) markSold();
  setSelected(false);

  return { el, ware, markSold, setSelected };
}

// A small inline coin glyph (matches the gold HUD's currency read).
function coinGlyph(size = 11): HTMLElement {
  const s = document.createElement('span');
  Object.assign(s.style, {
    display: 'inline-block', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 30%, #ffe08a, #d59a2a 70%, #9c6a15)',
    boxShadow: 'inset 0 0 1px rgba(0,0,0,0.5)', verticalAlign: '-1px', flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  return s;
}

function flashDenied(btn: HTMLButtonElement): void {
  const prev = btn.style.color;
  btn.style.color = '#e07070';
  setTimeout(() => { btn.style.color = prev; }, 320);
}
