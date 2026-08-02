// The merchant / relic-keeper shop — built on the shared picker-shell (a tile
// grid + a detail card with a PINNED buy action that never scrolls away). Buying
// spends run gold and routes the item (relics → reliquary, else → bag). Sold
// wares stay sold for the life of the stall (the ShopWare.sold flag).

import * as THREE from 'three';
import { openPickerScreen, coinGlyph, makeGoldReadout, type PickerTile } from './shop-shell';
import { emit } from '../broadcast/event-bus';
import { getGold, spendGold, grantGold } from '../state/run-state';
import { getCount, addItem } from '../player/inventory';
import { groundEquip } from '../player/ground-equip';
import { dropGearPickup } from '../interactables/pickup';
import { rollItemInstance } from '../player/item-instance';
import { wareItem, type ShopWare } from '../content/shop';
import { RARITY_COLORS, ITEMS } from '../content/items';
import { KEY_ID } from '../content/drop-tables';
import { buildItemCard } from './item-card';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from '../style/color-utils';

export interface ShopScreenOpts {
  title?: string;
  emptyLine?: string;
  /** Where a bought piece of gear equips FROM: buying a weapon/vestment routes
   *  through ground-equip (no bag), and any piece it displaces drops onto the
   *  floor here — the merchant's spot in the world. Omitted for the relic-keeper
   *  (relics collect, nothing is ever displaced). */
  gearDrop?: { scene: THREE.Object3D; pos: THREE.Vector3 };
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
      const spec = ITEMS[w.itemId];
      if (!spec) return;

      // Book the sale — spend, mark sold, emit the transaction + pickup beat,
      // refresh the stall. Shared by both routes below so the ledger reads the
      // same however the ware leaves the counter.
      const settle = () => {
        spendGold(w.price);
        emit({ type: 'transaction:accepted', family: 'priced', id: `shop:${w.itemId}`, price: { gold: w.price } });
        emit({ type: 'transaction:resolved', family: 'priced', id: `shop:${w.itemId}`, outcome: { itemIds: [w.itemId] } });
        w.sold = true;
        gold.update();
        handle.refresh();
      };

      if (spec.kind === 'consumable' || spec.kind === 'key') {
        // Pocketable ware → the bag (addItem fires its own pickup beat; carry
        // cap can refuse it, in which case no sale and no charge).
        if (!addItem(w.itemId)) return;
        settle();
        return;
      }

      // GEAR / RELIC → equips straight off the counter (no bag). An empty slot
      // takes it; a full loadout opens the swap-or-leave compare and the shed
      // piece drops at the merchant's feet. Payment settles ONLY when it lands
      // (onEquipped) — closing the compare without swapping costs nothing.
      const inst = rollItemInstance(spec);
      groundEquip({
        item: spec,
        affixes: inst.affixes,
        onEquipped: () => { emit({ type: 'item:picked-up', itemId: w.itemId }); settle(); },
        dropDisplaced: (dItem, dAff) => {
          if (opts.gearDrop) dropGearPickup(opts.gearDrop.scene, opts.gearDrop.pos, dItem, dAff);
        },
      });
    },
  });
}
