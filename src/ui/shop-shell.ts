// Shared PICKER-SHELL for the shop-like screens (merchant, relic-keeper, forge).
// One mobile layout, tuned to the research on mobile-shop UX:
//   - The PRIMARY action (BUY / TEMPER) is pinned in the bottom thumb-zone and
//     NEVER scrolls away — long item cards scroll INSIDE the detail pane while
//     the action bar stays put (the old bug: a long relic card pushed BUY off
//     the screen so you couldn't buy it).
//   - No wasteful chrome: the sheet's own ✕ closes it, so there's no bottom
//     LEAVE bar eating a row; the currency readout rides in the header.
//   - Landscape-first two-pane split (a tile grid + a detail pane), using CSS
//     grid `minmax(0, 1fr)` tracks so the scroll regions bound reliably.
// Both the shop and the forge build their content and hand it to this shell.

import { createSheet } from './menu-shell';
import { THEME, FONT_UI } from './theme';
import { playEquipClick } from '../audio/sfx';

export interface PickerTile {
  id: string;
  /** Item thumbnail data-URL (optional — a stat-less tile shows a glyph). */
  thumbUrl?: string;
  name: string;
  /** Rarity/domain accent (CSS colour) — frames the tile + tints the name. */
  accentHex: string;
  /** Small badge in the tile corner (a price, a forge level…). */
  badge?: Node | string;
  /** Dim + "spent" scrim (sold ware, maxed weapon). */
  spent?: boolean;
  spentLabel?: string;
}

export interface PickerAction {
  /** Button contents, re-read on every refresh (price + affordability, etc.).
   *  Receives the currently-selected tile id (null when nothing is selected). */
  render: (selectedId: string | null) => Node | string;
  enabled: (selectedId: string | null) => boolean;
}

export interface PickerOpts {
  id: string;
  title: string;
  /** Header-right node (a gold/keys readout). */
  headerRight?: Node;
  emptyLine?: string;
  tiles: () => PickerTile[];
  /** Build the detail card for a selected tile id. */
  renderDetail: (id: string) => Node;
  action: PickerAction;
  /** Fired when the pinned action button is pressed for the selected id. */
  onAct: (id: string) => void;
  /** Tile id to select on open (defaults to the first non-spent, else first). */
  initialId?: string;
}

export interface PickerHandle {
  /** Re-render tiles + detail + action after state changed (a buy, a temper). */
  refresh(): void;
  close(): void;
  selectedId(): string | null;
}

export function openPickerScreen(opts: PickerOpts): PickerHandle {
  const sheet = createSheet({
    id: opts.id,
    title: opts.title,
    width: 600,
    policy: { pausesWorld: true, needsBackdrop: true },
  });

  // Header-right readout (gold/keys) rides beside the title, before the ✕.
  if (opts.headerRight) {
    const closeBtn = sheet.header.querySelector('button');
    sheet.header.insertBefore(opts.headerRight, closeBtn);
  }

  // Body → a single full-height region (no bottom bar — the ✕ closes it).
  Object.assign(sheet.body.style, {
    padding: '10px 12px', display: 'grid', gridTemplateRows: '1fr',
    minHeight: '0', overflow: 'hidden', gap: '0',
  } as Partial<CSSStyleDeclaration>);

  let selected: string | null = null;

  const tiles = opts.tiles();
  if (tiles.length === 0) {
    const empty = document.createElement('div');
    Object.assign(empty.style, { color: THEME.dim, fontStyle: 'italic', padding: '18px 4px', fontFamily: 'Georgia, serif' } as Partial<CSSStyleDeclaration>);
    empty.textContent = opts.emptyLine ?? 'Nothing here for you.';
    sheet.body.appendChild(empty);
    sheet.open();
    return { refresh() {}, close: () => sheet.close(), selectedId: () => null };
  }

  // Two panes: tile GRID (left) + DETAIL (right). minmax(0,·) so both bound.
  const panes = document.createElement('div');
  Object.assign(panes.style, {
    display: 'grid', gridTemplateColumns: 'minmax(108px, 0.82fr) minmax(0, 1.18fr)',
    gap: '10px', minHeight: '0', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(panes);

  const gridPane = document.createElement('div');
  Object.assign(gridPane.style, {
    overflowY: 'auto', minHeight: '0', touchAction: 'pan-y',
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))',
    gridAutoRows: 'min-content', gap: '7px', alignContent: 'start', paddingRight: '2px',
  } as Partial<CSSStyleDeclaration>);
  panes.appendChild(gridPane);

  // Detail pane: a grid of [scrolling card | pinned action]. The action bar is
  // an `auto` row so it never leaves; the card is `minmax(0,1fr)` so it scrolls.
  const detailPane = document.createElement('div');
  Object.assign(detailPane.style, {
    display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', gap: '8px',
    minHeight: '0', padding: '10px', borderRadius: '3px',
    background: THEME.raised, border: `1px solid ${THEME.rule}`,
  } as Partial<CSSStyleDeclaration>);
  panes.appendChild(detailPane);

  const detailBody = document.createElement('div');
  Object.assign(detailBody.style, { overflowY: 'auto', minHeight: '0', touchAction: 'pan-y' } as Partial<CSSStyleDeclaration>);
  detailPane.appendChild(detailBody);

  // The pinned PRIMARY action — big, full-width, bottom thumb-zone.
  const actBtn = document.createElement('button');
  Object.assign(actBtn.style, {
    width: '100%', minHeight: '46px', padding: '12px', border: `1px solid ${THEME.ember}`,
    borderRadius: '3px', background: 'linear-gradient(180deg, rgba(70,38,16,0.9), rgba(40,22,10,0.92))',
    color: THEME.text, fontFamily: FONT_UI, fontSize: '15px', fontWeight: '700',
    letterSpacing: '0.10em', cursor: 'pointer', touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: '6px', boxShadow: THEME.emberGlow,
  } as Partial<CSSStyleDeclaration>);
  actBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selected && opts.action.enabled(selected)) opts.onAct(selected);
  });
  detailPane.appendChild(actBtn);

  // ── render passes ──
  const tileEls = new Map<string, { el: HTMLDivElement; frame: HTMLDivElement; name: HTMLDivElement; accent: string }>();

  function renderTiles(): void {
    gridPane.innerHTML = '';
    tileEls.clear();
    for (const t of opts.tiles()) {
      const el = document.createElement('div');
      Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: '3px', cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' } as Partial<CSSStyleDeclaration>);
      const frame = document.createElement('div');
      Object.assign(frame.style, {
        position: 'relative', width: '100%', aspectRatio: '1 / 1',
        background: 'radial-gradient(ellipse at 50% 35%, rgba(40,28,18,0.9), rgba(12,8,6,0.95))',
        border: `1.5px solid ${t.accentHex}`, borderRadius: '3px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        transition: 'box-shadow .12s ease, transform .12s ease',
      } as Partial<CSSStyleDeclaration>);
      if (t.thumbUrl) {
        const img = document.createElement('img');
        img.src = t.thumbUrl;
        Object.assign(img.style, { width: '82%', height: '82%', objectFit: 'contain', imageRendering: 'pixelated' } as Partial<CSSStyleDeclaration>);
        frame.appendChild(img);
      }
      if (t.badge != null) {
        const badge = document.createElement('div');
        Object.assign(badge.style, { position: 'absolute', right: '2px', bottom: '2px', display: 'flex', alignItems: 'center', gap: '2px', padding: '1px 4px', borderRadius: '2px', background: 'rgba(8,6,4,0.85)', color: THEME.amber, fontFamily: 'ui-monospace, monospace', fontSize: '10px', lineHeight: '1.2' } as Partial<CSSStyleDeclaration>);
        if (typeof t.badge === 'string') badge.textContent = t.badge; else badge.appendChild(t.badge);
        frame.appendChild(badge);
      }
      if (t.spent) {
        const scrim = document.createElement('div');
        Object.assign(scrim.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,4,3,0.66)', color: THEME.dim, fontFamily: FONT_UI, fontSize: '10px', letterSpacing: '.16em', fontWeight: '700' } as Partial<CSSStyleDeclaration>);
        scrim.textContent = t.spentLabel ?? 'SPENT';
        frame.appendChild(scrim);
        el.style.opacity = '0.6';
      }
      const name = document.createElement('div');
      Object.assign(name.style, { color: t.accentHex, fontFamily: FONT_UI, fontSize: '10px', lineHeight: '1.15', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', minHeight: '24px' } as Partial<CSSStyleDeclaration>);
      name.textContent = t.name;
      el.append(frame, name);
      const id = t.id;
      el.addEventListener('click', (e) => { e.stopPropagation(); if (selected !== id) { selected = id; playEquipClick(); renderSelectionAndDetail(); } });
      gridPane.appendChild(el);
      tileEls.set(id, { el, frame, name, accent: t.accentHex });
    }
  }

  function renderSelectionAndDetail(): void {
    for (const [id, t] of tileEls) {
      const on = id === selected;
      t.frame.style.boxShadow = on ? `inset 0 0 0 2px ${THEME.amber}, 0 0 16px ${t.accent}66, 0 3px 8px rgba(0,0,0,0.5)` : 'none';
      t.frame.style.transform = on ? 'translateY(-2px)' : 'none';
      t.frame.style.background = on ? 'radial-gradient(ellipse at 50% 30%, rgba(70,48,24,0.95), rgba(16,10,6,0.95))' : 'radial-gradient(ellipse at 50% 35%, rgba(40,28,18,0.9), rgba(12,8,6,0.95))';
      t.name.style.opacity = on ? '1' : '0.72';
      t.name.style.fontWeight = on ? '600' : '400';
    }
    detailBody.innerHTML = '';
    if (selected) detailBody.appendChild(opts.renderDetail(selected));
    detailBody.scrollTop = 0;
    renderAction();
  }

  function renderAction(): void {
    const enabled = !!selected && opts.action.enabled(selected);
    actBtn.innerHTML = '';
    const c = opts.action.render(selected);
    if (typeof c === 'string') actBtn.textContent = c; else actBtn.appendChild(c);
    actBtn.disabled = !enabled;
    actBtn.style.opacity = enabled ? '1' : '0.5';
    actBtn.style.cursor = enabled ? 'pointer' : 'default';
  }

  renderTiles();
  const list = opts.tiles();
  selected = opts.initialId ?? (list.find((t) => !t.spent)?.id ?? list[0]?.id ?? null);
  renderSelectionAndDetail();
  sheet.open();

  return {
    refresh() { renderTiles(); renderSelectionAndDetail(); },
    close: () => sheet.close(),
    selectedId: () => selected,
  };
}

/** A small inline coin glyph — the shop currency read, matching the gold HUD. */
export function coinGlyph(size = 12): HTMLElement {
  const s = document.createElement('span');
  Object.assign(s.style, {
    display: 'inline-block', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 30%, #ffe08a, #d59a2a 70%, #9c6a15)',
    boxShadow: 'inset 0 0 1px rgba(0,0,0,0.5)', verticalAlign: '-1px', flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  return s;
}

/** Header-right currency readout: gold (+ keys when carried). Re-render via the
 *  returned update(). */
export function makeGoldReadout(getGold: () => number, getKeys?: () => number): { el: HTMLElement; update: () => void } {
  const el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', alignItems: 'center', gap: '10px', marginRight: '10px', fontFamily: 'ui-monospace, monospace', fontSize: '13px', color: THEME.amber, letterSpacing: '.04em' } as Partial<CSSStyleDeclaration>);
  const keyWrap = document.createElement('span');
  Object.assign(keyWrap.style, { display: 'flex', alignItems: 'center', gap: '3px', color: 'rgba(210,185,130,0.92)' } as Partial<CSSStyleDeclaration>);
  const keyVal = document.createElement('span');
  keyWrap.append('🔑', keyVal);
  const goldWrap = document.createElement('span');
  Object.assign(goldWrap.style, { display: 'flex', alignItems: 'center', gap: '4px' } as Partial<CSSStyleDeclaration>);
  const goldVal = document.createElement('span');
  goldWrap.append(coinGlyph(13), goldVal);
  el.append(keyWrap, goldWrap);
  const update = () => {
    const k = getKeys ? getKeys() : 0;
    keyWrap.style.display = k > 0 ? 'flex' : 'none';
    keyVal.textContent = `${k}`;
    goldVal.textContent = `${getGold()}`;
  };
  update();
  return { el, update };
}
