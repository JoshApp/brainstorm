// The merchant buy-panel. A mobile sheet (menu-shell) listing the stall's
// wares: name (rarity-tinted), price, BUY. Buying spends run gold and drops the
// item into the bag (the same addItem a pickup uses). Sold wares stay sold for
// the life of the stall (the ShopWare.sold flag the interactable holds).

import { createSheet, menuButton } from './menu-shell';
import { emit } from '../broadcast/event-bus';
import { getGold, spendGold, grantGold } from '../state/run-state';
import { addItem } from '../player/inventory';
import { wareItem, type ShopWare } from '../content/shop';
import { RARITY_COLORS, type Rarity } from '../content/items';
import { describeItem } from './inventory-details';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from '../style/color-utils';

const RARITY_TINT: Record<Rarity, string> = {
  mundane: '#b9b2a6',
  uncommon: '#6fcf7f',
  rare: '#5aa9ff',
  cursed: '#c07ad0',
  fabled: '#e8b84b',
};

export function openShopScreen(stock: ShopWare[]): void {
  const sheet = createSheet({
    id: 'merchant-shop',
    title: 'THE WANDERING MERCHANT',
    width: 480,
    policy: { pausesWorld: true, needsBackdrop: true },
  });

  // Gold on hand — kept current as you buy.
  const goldLine = document.createElement('div');
  Object.assign(goldLine.style, {
    textAlign: 'right', color: '#e8b84b', fontFamily: 'ui-monospace, monospace',
    fontSize: '13px', letterSpacing: '.08em', marginBottom: '10px',
  } as Partial<CSSStyleDeclaration>);
  const refreshGold = () => { goldLine.textContent = `${getGold()} gold`; };
  sheet.body.appendChild(goldLine);

  if (stock.length === 0) {
    const empty = document.createElement('div');
    Object.assign(empty.style, { color: '#6b727c', fontStyle: 'italic', padding: '12px 2px' } as Partial<CSSStyleDeclaration>);
    empty.textContent = 'the merchant has nothing for you.';
    sheet.body.appendChild(empty);
  }

  for (const ware of stock) sheet.body.appendChild(makeRow(ware, refreshGold));

  sheet.footer.appendChild(menuButton('LEAVE', () => sheet.close(), { primary: true }));
  refreshGold();
  sheet.open();
}

function makeRow(ware: ShopWare, refreshGold: () => void): HTMLElement {
  const item = wareItem(ware);
  // The row + its (collapsed) preview live in one wrapper so tapping the row
  // expands a stat panel BELOW it — "see what you buy before you buy it".
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { borderBottom: '1px solid #1c1e22' } as Partial<CSSStyleDeclaration>);

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 4px', cursor: item ? 'pointer' : 'default',
  } as Partial<CSSStyleDeclaration>);

  // Small rarity-framed thumbnail — the stall reads as wares, not a text list.
  const rarityHex = hexCss(RARITY_COLORS[ware.rarity]);
  const thumb = document.createElement('div');
  Object.assign(thumb.style, {
    width: '38px', height: '38px', flexShrink: '0',
    background: 'rgba(20, 14, 10, 0.7)', border: `1.5px solid ${rarityHex}`,
    borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as Partial<CSSStyleDeclaration>);
  if (item) {
    const img = document.createElement('img');
    img.src = getItemThumbnail(item);
    Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' } as Partial<CSSStyleDeclaration>);
    thumb.appendChild(img);
  }

  const info = document.createElement('div');
  info.style.flex = '1';
  info.style.minWidth = '0';
  const name = document.createElement('div');
  Object.assign(name.style, { color: RARITY_TINT[ware.rarity], fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as Partial<CSSStyleDeclaration>);
  name.textContent = ware.name;
  const sub = document.createElement('div');
  Object.assign(sub.style, { color: '#6b727c', fontSize: '11px', fontStyle: 'italic' } as Partial<CSSStyleDeclaration>);
  // A "tap to inspect" affordance replaces the flavour teaser — the full flavor
  // + stats live in the preview panel now.
  sub.textContent = item ? 'tap to inspect' : ware.rarity;
  info.append(name, sub);

  const price = document.createElement('div');
  Object.assign(price.style, { color: '#e8b84b', fontFamily: 'ui-monospace, monospace', fontSize: '13px', minWidth: '54px', textAlign: 'right' } as Partial<CSSStyleDeclaration>);
  price.textContent = `${ware.price}g`;

  // menuButton stops click propagation itself, so tapping BUY never toggles the row.
  const buyBtn = menuButton('BUY', () => buy(), { small: true });

  // ── Preview panel — thumbnail-backed stat readout, lazily built, toggled by
  //    tapping the row. Reuses describeItem so the shop speaks the SAME stat
  //    language (icons + lines) as the inventory. ──
  const preview = document.createElement('div');
  Object.assign(preview.style, {
    display: 'none', flexDirection: 'column', gap: '4px',
    padding: '2px 6px 12px 50px',   // indent under the thumbnail column
  } as Partial<CSSStyleDeclaration>);
  let previewBuilt = false;
  function buildPreview(): void {
    if (previewBuilt || !item) return;
    previewBuilt = true;
    if (item.flavor) {
      const fl = document.createElement('div');
      fl.textContent = item.flavor;
      Object.assign(fl.style, { color: '#8a7a68', fontSize: '11px', fontStyle: 'italic', fontFamily: 'Georgia, serif', lineHeight: '1.3', marginBottom: '3px' } as Partial<CSSStyleDeclaration>);
      preview.appendChild(fl);
    }
    for (const line of describeItem(item)) preview.appendChild(line);
  }
  let open = false;
  function toggle(): void {
    if (!item) return;
    open = !open;
    if (open) buildPreview();
    preview.style.display = open ? 'flex' : 'none';
    sub.textContent = open ? 'tap to close' : 'tap to inspect';
  }
  row.addEventListener('click', toggle);

  function setSold(): void {
    buyBtn.textContent = 'SOLD';
    buyBtn.disabled = true;
    buyBtn.style.opacity = '0.4';
    buyBtn.style.cursor = 'default';
    wrap.style.opacity = '0.45';
  }
  function deny(): void {
    // brief red flash on the price to say "can't".
    const prev = price.style.color;
    price.style.color = '#d05a5a';
    setTimeout(() => { price.style.color = prev; }, 350);
  }
  function buy(): void {
    if (ware.sold) return;
    if (getGold() < ware.price) { deny(); return; }
    spendGold(ware.price);
    // addItem can refuse a consumable that's at its carry cap — refund if so.
    if (!addItem(ware.itemId)) { grantGold(ware.price); deny(); return; }
    // Unified transaction stream: a purchase is the PRICED family —
    // goods visible, cost stated, no strings (content/transactions.ts).
    emit({ type: 'transaction:accepted', family: 'priced', id: `shop:${ware.itemId}`, price: { gold: ware.price } });
    emit({ type: 'transaction:resolved', family: 'priced', id: `shop:${ware.itemId}`, outcome: { itemIds: [ware.itemId] } });
    ware.sold = true;
    setSold();
    refreshGold();
  }

  if (ware.sold) setSold();
  row.append(thumb, info, price, buyBtn);
  wrap.append(row, preview);
  return wrap;
}
