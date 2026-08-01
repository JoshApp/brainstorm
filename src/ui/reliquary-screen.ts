import { getReliquary } from '../player/reliquary';
import { DOMAIN_IDS, getDomain, type DomainId } from '../content/domains';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import { itemImageUrl } from './item-thumbnail';
import { hexCss } from '../style/color-utils';
import { buildDetailsColumn } from './inventory-details';
import { ACCENT, TEXT_DIM, TEXT_FAINT, sectionLabel, type InventoryCtx } from './inventory-shared';
import { itemFraming, applyDomainFrame } from './item-framing';

// RELIQUARY tab — the oddities collection. Relics are the belongings of dead
// delvers; they accrete UNCAPPED and all apply, so this screen is a ledger of
// what you've become, not a loadout to manage. Stacks group by DOMAIN (the
// nine abstracts, dark→light), each section headed in its register colour;
// duplicates collapse into one cell with a ×N badge. Tapping a relic shows
// its provenance in the shared details column — no actions, nothing to
// unequip: what is taken is not returned.

type Stack = { spec: ItemSpec; count: number };

export function buildReliquaryContent(ctx: InventoryCtx): HTMLDivElement {
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr',
    gap: '10px',
    alignItems: 'stretch',
    minHeight: '0',
  } as Partial<CSSStyleDeclaration>);

  grid.appendChild(buildCollectionColumn(ctx));
  grid.appendChild(buildDetailsColumn(ctx));
  return grid;
}

function buildCollectionColumn(ctx: InventoryCtx): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  const entries = getReliquary();
  col.appendChild(sectionLabel(`RELIQUARY${entries.length ? ` · ${entries.length}` : ''}`));

  // The collector's epigraph — the premise, stated where the collection lives.
  const epigraph = document.createElement('div');
  epigraph.textContent = 'What you take becomes you.';
  Object.assign(epigraph.style, {
    fontSize: '10px', fontStyle: 'italic', color: TEXT_FAINT,
    letterSpacing: '0.06em', marginTop: '-4px',
  } as Partial<CSSStyleDeclaration>);
  col.appendChild(epigraph);

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'Nothing gathered. The dead keep their things — for now.';
    Object.assign(empty.style, {
      color: TEXT_DIM, fontSize: '11px', fontStyle: 'italic',
      padding: '32px 8px', textAlign: 'center', margin: 'auto',
    } as Partial<CSSStyleDeclaration>);
    col.appendChild(empty);
    return col;
  }

  // Collapse duplicates into stacks, keyed by spec id (relics stack — the
  // second gorged tick is MORE gorged tick, not a separate belonging).
  const stacks = new Map<string, Stack>();
  for (const e of entries) {
    const s = stacks.get(e.spec.id);
    if (s) s.count += 1;
    else stacks.set(e.spec.id, { spec: e.spec, count: 1 });
  }

  // Group stacks by domain, in the canonical dark→light order; anything
  // without a domain gathers at the end as keepsakes.
  const byDomain = new Map<DomainId | 'keepsake', Stack[]>();
  for (const s of stacks.values()) {
    const key = s.spec.domain ?? 'keepsake';
    const list = byDomain.get(key);
    if (list) list.push(s);
    else byDomain.set(key, [s]);
  }

  const scroll = document.createElement('div');
  Object.assign(scroll.style, {
    display: 'flex', flexDirection: 'column', gap: '10px',
    overflowY: 'auto', minHeight: '0', paddingRight: '2px',
  } as Partial<CSSStyleDeclaration>);

  const order: Array<DomainId | 'keepsake'> = [...DOMAIN_IDS, 'keepsake'];
  for (const key of order) {
    const list = byDomain.get(key);
    if (!list || list.length === 0) continue;
    scroll.appendChild(buildDomainSection(key, list, ctx));
  }

  col.appendChild(scroll);
  return col;
}

function buildDomainSection(
  key: DomainId | 'keepsake',
  stacks: Stack[],
  ctx: InventoryCtx,
): HTMLDivElement {
  const section = document.createElement('div');
  Object.assign(section.style, {
    display: 'flex', flexDirection: 'column', gap: '5px',
  } as Partial<CSSStyleDeclaration>);

  const pieces = stacks.reduce((n, s) => n + s.count, 0);
  const name = key === 'keepsake' ? 'KEEPSAKES' : getDomain(key).name.toUpperCase();
  const color = key === 'keepsake' ? TEXT_DIM : hexCss(getDomain(key).register.color);

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'baseline', gap: '6px',
  } as Partial<CSSStyleDeclaration>);
  const title = document.createElement('span');
  title.textContent = name;
  Object.assign(title.style, {
    fontSize: '10px', fontWeight: '600', letterSpacing: '0.22em', color,
  } as Partial<CSSStyleDeclaration>);
  const count = document.createElement('span');
  count.textContent = `· ${pieces}`;
  Object.assign(count.style, {
    fontSize: '9px', color: TEXT_FAINT, letterSpacing: '0.1em',
  } as Partial<CSSStyleDeclaration>);
  header.append(title, count);
  section.appendChild(header);

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', flexWrap: 'wrap', gap: '5px', alignContent: 'flex-start',
  } as Partial<CSSStyleDeclaration>);
  // Sort within a domain: heaviest finds first (cursed/fabled → mundane),
  // stable by name inside a tier.
  const RANK: Record<string, number> = { fabled: 0, cursed: 1, rare: 2, uncommon: 3, mundane: 4 };
  stacks.sort((a, b) =>
    (RANK[a.spec.rarity ?? 'mundane'] - RANK[b.spec.rarity ?? 'mundane']) ||
    a.spec.name.localeCompare(b.spec.name));
  for (const s of stacks) row.appendChild(buildRelicCell(s, ctx));
  section.appendChild(row);
  return section;
}

// A relic reads as a 2.5D PLATE — a portrait card dressed in its domain (framed
// border + wash + the domain sigil watermarked behind the relic art). Assembled
// from parts we already have (the item thumbnail + the domain frame), so relics
// get a distinct collected-oddity identity now, with NO external art pipeline —
// a promoted FLUX/2.5D sprite can later swap in for the thumbnail per relic.
const PLATE_W = 54, PLATE_H = 68;

function buildRelicCell(stack: Stack, ctx: InventoryCtx): HTMLDivElement {
  const { spec, count } = stack;
  const rarityHex = hexCss(RARITY_COLORS[spec.rarity ?? 'mundane']);
  const isSelected = ctx.selection?.kind === 'relic' && ctx.selection.item.id === spec.id;

  const cell = document.createElement('div');
  Object.assign(cell.style, {
    position: 'relative',
    width: `${PLATE_W}px`, height: `${PLATE_H}px`, borderRadius: '4px',
    border: `1px solid ${rarityHex}`,
    boxShadow: `0 0 6px ${rarityHex}44`,
    background: 'linear-gradient(180deg, rgba(30,20,14,0.85), rgba(14,9,6,0.9))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', cursor: 'pointer',
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  cell.title = spec.name;

  const thumb = document.createElement('img');
  thumb.src = itemImageUrl(spec);
  Object.assign(thumb.style, {
    width: `${PLATE_W - 8}px`, height: `${PLATE_W - 8}px`,
    objectFit: 'contain', imageRendering: 'pixelated', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(thumb);

  if (count > 1) {
    const badge = document.createElement('div');
    badge.textContent = `×${count}`;
    Object.assign(badge.style, {
      position: 'absolute', bottom: '1px', right: '3px', zIndex: '3',
      fontSize: '9px', fontWeight: '700', color: '#f0d8c0',
      textShadow: '0 1px 2px rgba(0,0,0,0.95)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    cell.appendChild(badge);
  }

  // Dress the plate in its domain — the sigil watermark clips inside the plate,
  // sitting BEHIND the relic art (a small consecrated card). Selection overrides
  // the frame with the ember accent so the picked plate still reads as chosen.
  const framing = itemFraming(spec);
  if (framing) applyDomainFrame(cell, framing, { intensity: 1.1 });
  if (isSelected) {
    cell.style.border = `2px solid ${ACCENT}`;
    cell.style.boxShadow = `0 0 12px ${ACCENT}`;
  }

  cell.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.select(isSelected ? null : { kind: 'relic', item: spec });
  });
  return cell;
}
