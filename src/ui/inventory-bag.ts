import { getAllItems, removeItem, addItemSilently } from '../player/inventory';
import { equipFromInventory } from '../player/equipment';
import { playEquipClick } from '../audio/sfx';
import { ITEMS, RARITY_COLORS, type ItemSpec } from '../content/items';
import { itemImageUrl } from './item-thumbnail';
import { hexCss } from '../style/color-utils';
import { CARD_BG, TEXT_DIM, TEXT_FAINT, ACCENT, sectionLabel, type InventoryCtx } from './inventory-shared';
import { isNewInView } from './item-new-flag';
import { domainVisual, domainIconEl, CURSED_VISUAL } from './domain-icons';

// BAG column — every unequipped item, one per row (icon + full name).
// New pickups get a NEW badge and sort to the top. Tapping a cell selects
// it (showing details + an EQUIP/USE action).

export function buildBagColumn(ctx: InventoryCtx): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  col.appendChild(sectionLabel('BAG'));

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    // One item per row — bigger icons (recognise the item at a glance,
    // playtest ask) + room for the full name instead of "sc...". Scrolls.
    display: 'grid', gridTemplateColumns: '1fr',
    gap: '5px', alignContent: 'start',
    overflowY: 'auto', maxHeight: '230px',
    paddingRight: '4px',
  } as Partial<CSSStyleDeclaration>);

  const items = getAllItems().filter((i) => i.count > 0);
  // Just-picked-up items sort to the TOP so you see them first.
  items.sort((a, b) => (isNewInView(b.id) ? 1 : 0) - (isNewInView(a.id) ? 1 : 0));
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

  const isNew = isNewInView(item.id);
  const cell = document.createElement('div');
  Object.assign(cell.style, {
    position: 'relative',
    padding: '5px 7px',
    background: selected ? 'rgba(80, 50, 28, 0.85)' : CARD_BG,
    border: selected ? `2px solid ${ACCENT}` : `1.5px solid ${rarityHex}`,
    borderRadius: '3px',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '8px',
    alignItems: 'center',
    cursor: 'pointer',
    boxShadow: selected ? `0 0 12px ${ACCENT}` : `0 0 6px ${rarityHex}33`,
    minHeight: '54px',
  } as Partial<CSSStyleDeclaration>);

  // 3D thumbnail on the left — bigger + smooth (was a crunchy 32px). The
  // source render is 128px, so this stays crisp.
  const img = document.createElement('img');
  img.src = itemImageUrl(item);
  Object.assign(img.style, {
    width: '48px', height: '48px',
    objectFit: 'contain',
    flexShrink: '0', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(img);

  // NEW badge — top-right, only for items picked up since last bag view.
  if (isNew) {
    const badge = document.createElement('div');
    badge.textContent = 'NEW';
    Object.assign(badge.style, {
      position: 'absolute', top: '-6px', right: '-4px',
      padding: '1px 5px', borderRadius: '7px',
      background: 'rgba(255, 150, 70, 0.95)', color: 'rgba(20, 8, 4, 0.95)',
      fontSize: '8px', fontWeight: '700', letterSpacing: '0.08em',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    cell.appendChild(badge);
  }

  // Text block on the right.
  const text = document.createElement('div');
  Object.assign(text.style, {
    display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between' } as Partial<CSSStyleDeclaration>);

  const name = document.createElement('div');
  name.textContent = item.name;   // full name — the wide 1-per-row cell has room
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

  // Kind + domain — the visual language reads at a glance in the list too: a
  // domain icon (or the cursed chaos-mark) leads the kind, tinted to its colour.
  const kindLabel = document.createElement('div');
  Object.assign(kindLabel.style, {
    display: 'flex', alignItems: 'center', gap: '4px',
    fontSize: '9px', letterSpacing: '0.2em', color: TEXT_DIM,
  } as Partial<CSSStyleDeclaration>);
  if (rarity === 'cursed') {
    kindLabel.appendChild(domainIconEl(CURSED_VISUAL, 10));
  } else if (item.domain) {
    kindLabel.appendChild(domainIconEl(domainVisual(item.domain), 10));
  }
  const kindText = document.createElement('span');
  kindText.textContent = item.domain && rarity !== 'cursed'
    ? `${item.kind.toUpperCase()} · ${domainVisual(item.domain).label.toUpperCase()}`
    : rarity === 'cursed'
    ? `${item.kind.toUpperCase()} · CURSED`
    : item.kind.toUpperCase();
  kindLabel.appendChild(kindText);

  text.append(top, kindLabel);
  cell.appendChild(text);

  cell.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.select({ kind: 'bag', item });
  });

  // Double-click / double-tap = equip (skips select → tap EQUIP). Gear only;
  // consumables/keys/relics ignore it. Mirrors the EQUIP button's exact flow.
  cell.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (item.kind === 'weapon' || item.kind === 'offhand' || item.kind === 'vestment') {
      const previous = equipFromInventory(item);
      removeItem(item.id);
      if (previous) addItemSilently(previous.id);
      playEquipClick();
      ctx.select(null);
    }
  });

  return cell;
}
