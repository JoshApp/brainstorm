// The merchant buy-panel. A mobile sheet (menu-shell) listing the stall's
// wares: name (rarity-tinted), price, BUY. Buying spends run gold and drops the
// item into the bag (the same addItem a pickup uses). Sold wares stay sold for
// the life of the stall (the ShopWare.sold flag the interactable holds).

import { createSheet, menuButton } from './menu-shell';
import { emit } from '../broadcast/event-bus';
import { getGold, spendGold, grantGold } from '../state/run-state';
import { addItem } from '../player/inventory';
import { wareItem, type ShopWare } from '../content/shop';
import type { Rarity } from '../content/items';

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
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 4px', borderBottom: '1px solid #1c1e22',
  } as Partial<CSSStyleDeclaration>);

  const info = document.createElement('div');
  info.style.flex = '1';
  info.style.minWidth = '0';
  const name = document.createElement('div');
  Object.assign(name.style, { color: RARITY_TINT[ware.rarity], fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as Partial<CSSStyleDeclaration>);
  name.textContent = ware.name;
  const sub = document.createElement('div');
  Object.assign(sub.style, { color: '#6b727c', fontSize: '11px', fontStyle: 'italic' } as Partial<CSSStyleDeclaration>);
  sub.textContent = item?.flavor ?? `${ware.rarity}${item ? ' · ' + item.kind : ''}`;
  info.append(name, sub);

  const price = document.createElement('div');
  Object.assign(price.style, { color: '#e8b84b', fontFamily: 'ui-monospace, monospace', fontSize: '13px', minWidth: '54px', textAlign: 'right' } as Partial<CSSStyleDeclaration>);
  price.textContent = `${ware.price}g`;

  const buyBtn = menuButton('BUY', () => buy(), { small: true });

  function setSold(): void {
    buyBtn.textContent = 'SOLD';
    buyBtn.disabled = true;
    buyBtn.style.opacity = '0.4';
    buyBtn.style.cursor = 'default';
    row.style.opacity = '0.45';
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
  row.append(info, price, buyBtn);
  return row;
}
