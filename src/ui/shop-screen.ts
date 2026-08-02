// The merchant / relic-keeper shop — built on the shared picker-shell (a tile
// grid + a detail card with a PINNED buy action that never scrolls away). Buying
// spends run gold and routes the item (relics → reliquary, else → bag). Sold
// wares stay sold for the life of the stall (the ShopWare.sold flag).

import { openPickerScreen, coinGlyph, makeGoldReadout, type PickerTile } from './shop-shell';
import { emit } from '../broadcast/event-bus';
import { getGold, spendGold, grantGold } from '../state/run-state';
import { getCount } from '../player/inventory';
import { addItem } from '../player/inventory';
import { addRelic } from '../player/reliquary';
import { wareItem, type ShopWare } from '../content/shop';
import { RARITY_COLORS, ITEMS } from '../content/items';
import { KEY_ID } from '../content/drop-tables';
import { buildItemCard } from './item-card';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from '../style/color-utils';

export interface ShopScreenOpts {
  title?: string;
  emptyLine?: string;
}

export function openShopScreen(stock: ShopWare[], opts: ShopScreenOpts = {}): void {
  const byId = new Map<string, ShopWare>();
  stock.forEach((w, i) => byId.set(`${i}:${w.itemId}`, w));

  const gold = makeGoldReadout(getGold, () => getCount(KEY_ID));

  const tileFor = (id: string, w: ShopWare): PickerTile => {
    const item = wareItem(w);
    const badge = document.createElement('span');
    badge.style.display = 'flex'; badge.style.alignItems = 'center'; badge.style.gap = '2px';
    badge.append(coinGlyph(9), `${w.price}`);
    return {
      id, name: w.name, accentHex: hexCss(RARITY_COLORS[w.rarity]),
      thumbUrl: item ? getItemThumbnail(item) : undefined,
      badge, spent: w.sold, spentLabel: 'SOLD',
    };
  };

  const handle = openPickerScreen({
    id: 'merchant-shop',
    title: opts.title ?? 'THE WANDERING MERCHANT',
    headerRight: gold.el,
    emptyLine: opts.emptyLine ?? 'The stall is bare. Nothing here is for you.',
    tiles: () => [...byId].map(([id, w]) => tileFor(id, w)),
    renderDetail: (id) => {
      const w = byId.get(id);
      const item = w && wareItem(w);
      return item ? buildItemCard(item, { compare: true }) : document.createElement('div');
    },
    action: {
      render: (id) => {
        const w = id ? byId.get(id) : null;
        if (!w) return 'BUY';
        if (w.sold) return 'SOLD';
        const wrap = document.createElement('span');
        wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '6px';
        wrap.append('BUY  ·  ', coinGlyph(13), ` ${w.price}`);
        return wrap;
      },
      enabled: (id) => {
        const w = id ? byId.get(id) : null;
        return !!w && !w.sold && getGold() >= w.price;
      },
    },
    onAct: (id) => {
      const w = byId.get(id);
      if (!w || w.sold || getGold() < w.price) return;
      spendGold(w.price);
      const spec = ITEMS[w.itemId];
      if (spec?.kind === 'relic') {
        addRelic(spec);
        emit({ type: 'item:picked-up', itemId: w.itemId });
      } else if (!addItem(w.itemId)) {
        grantGold(w.price); return;   // refused at carry cap — refund, no sale
      }
      emit({ type: 'transaction:accepted', family: 'priced', id: `shop:${w.itemId}`, price: { gold: w.price } });
      emit({ type: 'transaction:resolved', family: 'priced', id: `shop:${w.itemId}`, outcome: { itemIds: [w.itemId] } });
      w.sold = true;
      gold.update();
      handle.refresh();
    },
  });
}
