import { getAllItems, removeItem, addItemSilently } from '../player/inventory';
import { equipFromInventory, getEquipment, getSidearm, swapWeapons } from '../player/equipment';
import { getReliquary } from '../player/reliquary';
import { getEquippedRite, equipRite, getCarriedRites } from '../state/run-state';
import { RITES } from '../content/rites';
import { itemFraming } from './item-framing';
import { injectKitStyles } from './kit/style';
import { playEquipClick } from '../audio/sfx';
import { ITEMS, RARITY_COLORS, type ItemSpec } from '../content/items';
import { itemImageUrl } from './item-thumbnail';
import { type InventoryCtx, type Selection } from './inventory-shared';
import { isNewInView } from './item-new-flag';

// GEAR's left pane (Lamplight, the draft blended with the game): ONE grid of
// square tiles, what you wear first (each with a wax seal), then everything in
// the bag; the item's art large, its rarity or domain a quiet edge, the chosen
// tile lit. Under the grid, the rite and the reliquary as two quiet rows.
// Tap or confirm a tile to read it in the slab; double-tap gear to wear it.

export function buildGearPane(ctx: InventoryCtx): HTMLDivElement {
  injectKitStyles();
  const pane = document.createElement('div');
  Object.assign(pane.style, {
    display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0', minHeight: '0', overflowY: 'auto', paddingRight: '4px',
  } as Partial<CSSStyleDeclaration>);

  const items = getAllItems().filter((i) => i.count > 0);
  // Just-picked-up items sort to the front so you see them first.
  items.sort((a, b) => (isNewInView(b.id) ? 1 : 0) - (isNewInView(a.id) ? 1 : 0));

  const head = document.createElement('div');
  head.className = 'lk-head lk-reading-head';
  const hl = document.createElement('span'); hl.textContent = 'Satchel';
  const hc = document.createElement('span'); hc.className = 'lk-reading-count';
  hc.textContent = `${items.reduce((n, i) => n + i.count, 0)} carried`;
  head.append(hl, hc);
  pane.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'lk-tilegrid';
  const weapon = getEquipment().weapon;
  if (weapon) grid.appendChild(buildTile(weapon, 1, ctx, { kind: 'slot', slotId: 'weapon', item: weapon }, 'WIELDED'));
  const side = getSidearm();
  if (side) grid.appendChild(buildTile(side, 1, ctx, null, 'SIDEARM'));
  for (const { id, count } of items) {
    const item = ITEMS[id];
    if (!item) continue;
    grid.appendChild(buildTile(item, count, ctx, { kind: 'bag', item }));
  }
  // A few empty tiles keep the grid's shape when the bag is light.
  const filled = grid.childElementCount;
  for (let i = filled; i < 10; i++) {
    const e = document.createElement('div');
    e.className = 'lk-tile empty';
    grid.appendChild(e);
  }
  pane.appendChild(grid);

  pane.append(buildRiteRow(ctx), buildRelicRow(ctx));
  return pane;
}

function buildTile(item: ItemSpec, count: number, ctx: InventoryCtx, sel: NonNullable<Selection> | null, tag?: string): HTMLDivElement {
  const rarity = item.rarity ?? 'mundane';
  const f = itemFraming(item);
  const rc = f ? f.hex : RARITY_COLORS[rarity];
  const chosen = !!sel && ctx.selection?.kind === sel.kind && ctx.selection.item.id === item.id;
  const tile = document.createElement('div');
  tile.className = `lk-tile${sel?.kind === 'slot' || !sel ? ' worn' : ''}${chosen ? ' chosen' : ''}`;
  tile.style.setProperty('--rc', `${(rc >> 16) & 255}, ${(rc >> 8) & 255}, ${rc & 255}`);
  tile.title = item.name;
  tile.dataset.focus = '';
  tile.dataset.fkey = `tile:${sel?.kind ?? 'side'}:${item.id}`;
  const img = document.createElement('img');
  img.src = itemImageUrl(item);
  img.alt = '';
  tile.appendChild(img);
  if (count > 1) {
    const n = document.createElement('span'); n.className = 'lk-tile-n'; n.textContent = `×${count}`;
    tile.appendChild(n);
  }
  if (tag) {
    const t = document.createElement('span'); t.className = 'lk-tile-tag'; t.textContent = tag;
    tile.appendChild(t);
  }
  if (sel?.kind === 'bag' && isNewInView(item.id)) {
    const nb = document.createElement('span'); nb.className = 'lk-tile-new'; nb.textContent = 'NEW';
    tile.appendChild(nb);
  }

  tile.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!sel) { swapWeapons(); ctx.select(null); return; }   // the sidearm: draw it
    ctx.select(sel);
  });
  // Double-click / double-tap = wear it (gear only), the EQUIP button's flow.
  if (sel?.kind === 'bag') {
    tile.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (item.kind === 'weapon' || item.kind === 'offhand' || item.kind === 'vestment') {
        const previous = equipFromInventory(item);
        removeItem(item.id);
        if (previous) addItemSilently(previous.id);
        playEquipClick();
        ctx.select(null);
      }
    });
  }
  return tile;
}

// The rite: one quiet row (what is armed); choosing it opens the rites you
// carry as lit words to arm. Module-level so it survives the pane's rebuild.
let riteOpen = false;

function buildRiteRow(ctx: InventoryCtx): HTMLDivElement {
  const wrap = document.createElement('div');
  const armed = getEquippedRite();
  const spec = armed ? RITES[armed] : undefined;
  const row = document.createElement('div');
  row.className = 'lk-row lk-reading-row';
  row.dataset.focus = '';
  row.dataset.fkey = 'row:rite';
  const k = document.createElement('span'); k.className = 'lk-k'; k.textContent = 'Rite';
  const v = document.createElement('span'); v.className = 'lk-v';
  v.textContent = spec ? `${spec.name} · ${spec.hungerCost} hunger` : 'none';
  row.append(k, v);
  row.addEventListener('click', (e) => { e.stopPropagation(); riteOpen = !riteOpen; ctx.select(ctx.selection); });
  wrap.appendChild(row);
  if (riteOpen) {
    const carried = getCarriedRites().map((id) => RITES[id]).filter(Boolean);
    const words = document.createElement('div');
    words.className = 'lk-choice';
    Object.assign(words.style, { flexWrap: 'wrap', padding: '4px 0 2px 10px' } as Partial<CSSStyleDeclaration>);
    if (!carried.length) {
      const none = document.createElement('div');
      none.className = 'lk-d-note';
      none.textContent = 'You carry no rites. The deep keeps them.';
      words.appendChild(none);
    }
    for (const r of carried) {
      const w = document.createElement('span');
      w.textContent = r.name.toUpperCase();
      w.title = r.fate;
      if (r.id === armed) w.classList.add('on');
      w.dataset.focus = '';
      w.addEventListener('click', (e) => { e.stopPropagation(); equipRite(r.id === armed ? null : r.id); ctx.select(ctx.selection); });
      words.appendChild(w);
    }
    wrap.appendChild(words);
  }
  if (spec) {
    const fate = document.createElement('div');
    fate.className = 'lk-d-note';
    fate.textContent = spec.fate;
    fate.style.padding = '2px 0 0 16px';
    wrap.appendChild(fate);
  }
  return wrap;
}

function buildRelicRow(ctx: InventoryCtx): HTMLDivElement {
  const n = getReliquary().length;
  const row = document.createElement('div');
  row.className = 'lk-row lk-reading-row';
  row.dataset.focus = '';
  row.dataset.fkey = 'row:reliquary';
  const k = document.createElement('span'); k.className = 'lk-k'; k.textContent = 'Reliquary';
  const v = document.createElement('span'); v.className = 'lk-v'; v.textContent = n ? `${n} kept ›` : 'empty ›';
  row.append(k, v);
  row.addEventListener('click', (e) => { e.stopPropagation(); ctx.openReliquary?.(); });
  return row;
}
