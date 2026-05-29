import { getAllItems } from '../player/inventory';
import { ITEMS, RARITY_COLORS, type ItemSpec } from '../content/items';
import { getItemThumbnail } from './item-thumbnail';
import { abbrev, hexCss } from './item-format';
import { CARD_BG, TEXT_DIM, TEXT_FAINT, ACCENT, sectionLabel, type InventoryCtx } from './inventory-shared';

// BAG column — every unequipped item, two-per-row. Tapping a cell selects it
// (showing details + an EQUIP/USE action).

export function buildBagColumn(ctx: InventoryCtx): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  col.appendChild(sectionLabel('BAG'));

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '5px', alignContent: 'start',
    overflowY: 'auto', maxHeight: '230px',
    paddingRight: '4px',
  } as Partial<CSSStyleDeclaration>);

  const items = getAllItems().filter((i) => i.count > 0);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'EMPTY';
    Object.assign(empty.style, {
      gridColumn: '1 / -1', padding: '14px', textAlign: 'center',
      color: TEXT_FAINT, fontSize: '11px',
      letterSpacing: '0.25em', fontStyle: 'italic',
    } as Partial<CSSStyleDeclaration>);
    grid.appendChild(empty);
    col.appendChild(grid);
    return col;
  }

  for (const { id, count } of items) {
    const item = ITEMS[id];
    if (!item) continue;
    grid.appendChild(buildBagCell(item, count, ctx));
  }

  col.appendChild(grid);
  return col;
}

function buildBagCell(item: ItemSpec, count: number, ctx: InventoryCtx): HTMLDivElement {
  const selected = ctx.selection?.kind === 'bag' && ctx.selection.item.id === item.id;
  const rarity = item.rarity ?? 'mundane';
  const rarityHex = hexCss(RARITY_COLORS[rarity]);

  const cell = document.createElement('div');
  Object.assign(cell.style, {
    padding: '4px 6px',
    background: selected ? 'rgba(80, 50, 28, 0.85)' : CARD_BG,
    border: selected ? `2px solid ${ACCENT}` : `1.5px solid ${rarityHex}`,
    borderRadius: '3px',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px',
    alignItems: 'center',
    cursor: 'pointer',
    boxShadow: selected ? `0 0 12px ${ACCENT}` : `0 0 6px ${rarityHex}33`,
    minHeight: '38px',
  } as Partial<CSSStyleDeclaration>);

  // 3D thumbnail on the left.
  const img = document.createElement('img');
  img.src = getItemThumbnail(item);
  Object.assign(img.style, {
    width: '32px', height: '32px',
    objectFit: 'contain', imageRendering: 'pixelated',
    flexShrink: '0', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(img);

  // Text block on the right.
  const text = document.createElement('div');
  Object.assign(text.style, {
    display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between' } as Partial<CSSStyleDeclaration>);

  const name = document.createElement('div');
  name.textContent = abbrev(item);
  Object.assign(name.style, {
    fontSize: '11px', color: rarityHex, fontWeight: '500',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);

  const cnt = document.createElement('div');
  cnt.textContent = count > 1 ? `×${count}` : '';
  Object.assign(cnt.style, {
    fontSize: '10px', color: TEXT_DIM, fontFamily: 'monospace', flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  top.append(name, cnt);

  const kindLabel = document.createElement('div');
  kindLabel.textContent = item.kind.toUpperCase();
  Object.assign(kindLabel.style, {
    fontSize: '9px', letterSpacing: '0.2em', color: TEXT_DIM,
  } as Partial<CSSStyleDeclaration>);

  text.append(top, kindLabel);
  cell.appendChild(text);

  cell.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.select({ kind: 'bag', item });
  });

  return cell;
}
