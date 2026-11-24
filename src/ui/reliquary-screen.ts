import { getReliquary } from '../player/reliquary';
import { DOMAIN_IDS, getDomain, type DomainId } from '../content/domains';
import { type ItemSpec } from '../content/items';
import { itemImageUrl } from './item-thumbnail';
import { buildDetailsColumn } from './inventory-details';
import { type InventoryCtx } from './inventory-shared';
import { domainVisual } from './domain-icons';
import { injectKitStyles } from './kit/style';

// RELIQUARY tab — the oddities collection. Relics are the belongings of dead
// delvers; they accrete UNCAPPED and all apply, so this screen is a ledger of
// what you've become, not a loadout to manage. Lamplight: the game's painted
// relic art as square tiles flowing across the pane, grouped by DOMAIN under
// the domain's carved mark and name (the draft's grammar), duplicates as one
// tile with ×N; the chosen relic is read in the same slab as GEAR's. Nothing to
// unequip: what is taken is not returned.

type Stack = { spec: ItemSpec; count: number };

const RANK: Record<string, number> = { fabled: 0, cursed: 1, rare: 2, uncommon: 3, mundane: 4 };

/** Stacks grouped by domain in the canonical dark→light order (keepsakes
 *  last), heaviest finds first within a domain. */
function groupedStacks(): Array<[DomainId | 'keepsake', Stack[]]> {
  const stacks = new Map<string, Stack>();
  for (const e of getReliquary()) {
    const s = stacks.get(e.spec.id);
    if (s) s.count += 1;
    else stacks.set(e.spec.id, { spec: e.spec, count: 1 });
  }
  const byDomain = new Map<DomainId | 'keepsake', Stack[]>();
  for (const s of stacks.values()) {
    const key = s.spec.domain ?? 'keepsake';
    const list = byDomain.get(key);
    if (list) list.push(s);
    else byDomain.set(key, [s]);
  }
  const out: Array<[DomainId | 'keepsake', Stack[]]> = [];
  for (const key of [...DOMAIN_IDS, 'keepsake'] as Array<DomainId | 'keepsake'>) {
    const list = byDomain.get(key);
    if (!list?.length) continue;
    list.sort((a, b) =>
      (RANK[a.spec.rarity ?? 'mundane'] - RANK[b.spec.rarity ?? 'mundane']) || a.spec.name.localeCompare(b.spec.name));
    out.push([key, list]);
  }
  return out;
}

/** The relic the tab opens on: the first one it shows. */
export function firstRelicShown(): ItemSpec | null {
  return groupedStacks()[0]?.[1][0]?.spec ?? null;
}

export function buildReliquaryContent(ctx: InventoryCtx): HTMLDivElement {
  injectKitStyles();
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
    gridTemplateRows: 'minmax(0, 1fr)',
    gap: '18px', alignItems: 'stretch', flex: '1 1 auto', minHeight: '0',
    padding: '2px 10px 8px 0',   // clear of the sheet's corner brackets
  } as Partial<CSSStyleDeclaration>);
  grid.append(buildCollectionPane(ctx), buildDetailsColumn(ctx));
  return grid;
}

function buildCollectionPane(ctx: InventoryCtx): HTMLDivElement {
  const pane = document.createElement('div');
  Object.assign(pane.style, {
    display: 'flex', flexDirection: 'column', minWidth: '0', minHeight: '0', overflowY: 'auto', paddingRight: '4px',
  } as Partial<CSSStyleDeclaration>);

  const n = getReliquary().length;
  const head = document.createElement('div');
  head.className = 'lk-head lk-reading-head';
  const hl = document.createElement('span'); hl.textContent = 'Reliquary';
  const hc = document.createElement('span'); hc.className = 'lk-reading-count'; hc.textContent = n ? `${n} kept` : '';
  head.append(hl, hc);
  pane.appendChild(head);
  const epigraph = document.createElement('div');
  epigraph.className = 'lk-d-note';
  epigraph.textContent = 'What you take becomes you.';
  epigraph.style.margin = '-2px 0 12px';
  pane.appendChild(epigraph);

  const groups = groupedStacks();
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'lk-d-note';
    empty.textContent = 'Nothing gathered. The dead keep their things, for now.';
    Object.assign(empty.style, { margin: 'auto', textAlign: 'center' } as Partial<CSSStyleDeclaration>);
    pane.appendChild(empty);
    return pane;
  }
  for (const [key, stacks] of groups) {
    const pieces = stacks.reduce((m, s) => m + s.count, 0);
    const hex = key === 'keepsake' ? 0xa08264 : getDomain(key).register.color;
    const dh = document.createElement('div');
    dh.className = 'lk-domhead';
    dh.style.setProperty('--rc', `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`);
    if (key !== 'keepsake') {
      const art = domainVisual(key).art;
      if (art) { const img = document.createElement('img'); img.src = art; img.alt = ''; dh.appendChild(img); }
    }
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = key === 'keepsake' ? 'KEEPSAKES' : getDomain(key).name.toUpperCase();
    const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = `${pieces}`;
    dh.append(nm, ct);
    pane.appendChild(dh);
    const tiles = document.createElement('div');
    tiles.className = 'lk-tilegrid';
    for (const s of stacks) tiles.appendChild(buildRelicTile(s, hex, ctx));
    pane.appendChild(tiles);
  }
  return pane;
}

function buildRelicTile(stack: Stack, domainHex: number, ctx: InventoryCtx): HTMLDivElement {
  const { spec, count } = stack;
  const chosen = ctx.selection?.kind === 'relic' && ctx.selection.item.id === spec.id;
  const tile = document.createElement('div');
  tile.className = chosen ? 'lk-tile chosen' : 'lk-tile';
  const rc = spec.rarity === 'cursed' ? 0xc05bd6 : domainHex;
  tile.style.setProperty('--rc', `${(rc >> 16) & 255}, ${(rc >> 8) & 255}, ${rc & 255}`);
  tile.title = spec.name;
  tile.dataset.focus = '';
  tile.dataset.fkey = `relic:${spec.id}`;
  const img = document.createElement('img');
  img.src = itemImageUrl(spec);
  img.alt = '';
  img.style.imageRendering = 'pixelated';
  tile.appendChild(img);
  if (count > 1) {
    const b = document.createElement('span'); b.className = 'lk-tile-n'; b.textContent = `×${count}`;
    tile.appendChild(b);
  }
  tile.addEventListener('click', (e) => { e.stopPropagation(); ctx.select({ kind: 'relic', item: spec }); });
  return tile;
}
