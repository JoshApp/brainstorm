// Shop stock + pricing — the pure, testable core of the merchant sink.
// rollShopStock draws a few wares from the SAME central loot roller drops use
// (so a shop's offerings fit the depth + the run), and prices them by rarity.
// No THREE, no DOM, no run-state mutation — just data in, wares out — so it's
// unit-testable and the UI / interactable just present what this returns.

import { ITEMS, type ItemSpec, type Rarity } from './items';
import { rollLoot } from './loot';
import { gameRng } from '../engine/rng';

export interface ShopWare {
  itemId: string;
  name: string;
  rarity: Rarity;
  price: number;
  /** Mutated by the buy-panel once purchased so the stall remembers. */
  sold?: boolean;
}

// Base price per rarity band (gold). Tuned so a mundane is a few kills'
// worth and a fabled is a serious commitment of a run's hoard.
const RARITY_BASE: Record<Rarity, number> = {
  mundane: 12,
  uncommon: 28,
  rare: 60,
  cursed: 40,    // cheaper — cursed gear is a gamble, the discount is the bait
  fabled: 150,
};

/** Price an item for sale at a depth: rarity base, nudged up with depth so
 *  late-floor stock costs more, rounded to a clean multiple of 5. */
export function priceFor(item: ItemSpec, depth: number): number {
  const base = RARITY_BASE[item.rarity ?? 'mundane'];
  const scaled = base * (1 + Math.max(0, depth - 1) * 0.07);
  return Math.max(5, Math.round(scaled / 5) * 5);
}

/** Roll a merchant's stock for a depth — `count` distinct wares from the loot
 *  pool, priced. `rand` is injectable so tests are deterministic; gameplay
 *  passes the run RNG so a run's shops are reproducible from its seed. */
export function rollShopStock(depth: number, count = 3, rand: () => number = gameRng): ShopWare[] {
  const wares: ShopWare[] = [];
  const seen = new Set<string>();
  // Bias 2 = "mid richness" so a shop skews a touch better than a floor drop
  // without handing out fabled gear cheaply. Over-roll a little to fill `count`
  // distinct ids even when the roller repeats.
  for (let attempts = 0; attempts < count * 6 && wares.length < count; attempts++) {
    const item = rollLoot({ depth, bias: 2 }, rand);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    wares.push({
      itemId: item.id,
      name: item.name ?? item.id,
      rarity: item.rarity ?? 'mundane',
      price: priceFor(item, depth),
    });
  }
  return wares;
}

/** Resolve a ware's full item spec (for the panel to show flavor/kind). */
export function wareItem(ware: ShopWare): ItemSpec | undefined {
  return ITEMS[ware.itemId];
}
