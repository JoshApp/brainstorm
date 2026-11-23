// Codex — the lifetime memory of everything the player has discovered
// across all their runs. Opens from the title screen. Three sections:
// what you have SLAIN, what you have HELD, what you have READ.
//
// Tone: in-world voice. "What you remember." Undiscovered entries
// (things you've heard of but not seen) show as muted "???" so the
// player has a "gotta see them all" target — the meta-progression hook.

import { isScreenOpen } from './screen-manager';
import { createSheet, type Sheet } from './menu-shell';
import { getMeta } from '../state/meta-state';
import { ITEMS, RARITY_COLORS, type Rarity } from '../content/items';
import { ENEMIES } from '../content/enemies';
import { FONT_DISPLAY } from './theme';

const SCREEN_ID = 'codex';

let sheet: Sheet | null = null;

/** The codex body (lifetime stats line + Slain/Held/Read sections),
 *  reusable as a tab in the unified game menu as well as the standalone
 *  title-screen sheet. */
export function buildCodexContent(): HTMLDivElement {
  const meta = getMeta();
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    fontFamily: FONT_DISPLAY,
    color: 'rgba(220, 180, 140, 0.92)',
  } as Partial<CSSStyleDeclaration>);

  // Lifetime stats line.
  const sub = document.createElement('div');
  sub.textContent = `${meta.runsAttempted} descent${meta.runsAttempted === 1 ? '' : 's'}  ·  ${meta.totalKills} slain  ·  deepest ${meta.deepestDepth}`;
  Object.assign(sub.style, {
    fontSize: '11px',
    letterSpacing: '0.18em',
    color: 'rgba(180, 140, 100, 0.6)',
    fontFamily: 'system-ui, sans-serif',
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: '16px',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(sub);

  wrap.appendChild(buildEnemiesSection(meta.enemiesSlain));
  wrap.appendChild(buildItemsSection(meta.itemsFound));
  wrap.appendChild(buildNotesSection(meta.notesRead));
  return wrap;
}

export function showCodex() {
  if (isScreenOpen(SCREEN_ID)) return;
  const s = createSheet({
    id: SCREEN_ID,
    title: 'WHAT YOU REMEMBER',
    width: 720,
    layer: 'title',   // above the start screen (also 'title'; later stacks on top)
    onClose() { sheet = null; },
  });
  sheet = s;
  s.body.appendChild(buildCodexContent());
  s.open();
}

// ── Sections ────────────────────────────────────────────────────────

function sectionHeader(label: string, knownCount: number, totalCount: number): HTMLElement {
  const h = document.createElement('div');
  h.className = 'lk-head';
  Object.assign(h.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    marginTop: '18px', textTransform: 'uppercase',
  } as Partial<CSSStyleDeclaration>);
  const l = document.createElement('span');
  l.textContent = label;
  const c = document.createElement('span');
  c.textContent = `${knownCount} / ${totalCount}`;
  Object.assign(c.style, {
    fontFamily: 'system-ui, sans-serif', fontSize: '10px', letterSpacing: '0.12em',
    color: 'rgba(170, 135, 100, 0.7)',
  } as Partial<CSSStyleDeclaration>);
  h.append(l, c);
  return h;
}

function buildEnemiesSection(slainIds: readonly string[]): HTMLElement {
  const wrap = document.createElement('div');
  const allEnemies = Object.values(ENEMIES);
  wrap.appendChild(sectionHeader('Slain', slainIds.length, allEnemies.length));

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '6px',
  });
  for (const e of allEnemies) {
    const seen = slainIds.includes(e.id);
    grid.appendChild(makeEntry(
      seen ? e.name : '???',
      seen ? `hp ${e.hp}` : 'something below',
      seen ? 0xb09070 : 0x504030,
      seen,
    ));
  }
  wrap.appendChild(grid);
  return wrap;
}

function buildItemsSection(foundIds: readonly string[]): HTMLElement {
  const wrap = document.createElement('div');
  const allItems = Object.values(ITEMS);
  wrap.appendChild(sectionHeader('Held', foundIds.length, allItems.length));

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '8px',
  });
  for (const it of allItems) {
    const seen = foundIds.includes(it.id);
    const rarity: Rarity = it.rarity ?? 'mundane';
    grid.appendChild(makeEntry(
      seen ? it.name : '???',
      seen ? (it.flavor ?? '') : 'a name not yet learned',
      seen ? RARITY_COLORS[rarity] : 0x504030,
      seen,
    ));
  }
  wrap.appendChild(grid);
  return wrap;
}

function buildNotesSection(notes: readonly string[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.appendChild(sectionHeader('Read', notes.length, notes.length));  // open-ended

  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'no voices, yet.';
    Object.assign(empty.style, {
      fontStyle: 'italic',
      fontSize: '13px',
      color: 'rgba(150, 120, 90, 0.55)',
      textAlign: 'center',
      padding: '10px 0',
    });
    wrap.appendChild(empty);
    return wrap;
  }

  const list = document.createElement('div');
  Object.assign(list.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  });
  for (const n of notes) {
    const item = document.createElement('div');
    item.textContent = `"${n}${n.length >= 60 ? '…' : ''}"`;
    item.className = 'lk-row';
    item.dataset.focus = '';
    Object.assign(item.style, {
      fontStyle: 'italic',
      fontSize: '14px',
      color: 'rgba(214, 184, 146, 0.85)',
      padding: '6px 10px 6px 14px',
      background: 'rgba(24, 16, 11, 0.55)',
      borderLeft: '1px solid rgba(170, 130, 80, 0.45)',
      lineHeight: '1.4',
    });
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// An entry: quiet until chosen (Lamplight). What you have met carries its
// rarity as a thin mark at its edge and can be walked to with keys or a pad;
// the chosen one lights from its edge like the character rows. What you have
// not met stays a faint question.
function makeEntry(title: string, sub: string, accent: number, seen: boolean): HTMLElement {
  const el = document.createElement('div');
  const accentRgb = `rgb(${(accent >> 16) & 0xff}, ${(accent >> 8) & 0xff}, ${accent & 0xff})`;
  el.className = 'lk-row';
  if (seen) { el.dataset.focus = ''; el.dataset.fkey = `codex:${title}`; }
  Object.assign(el.style, {
    padding: '8px 10px 8px 14px',
    background: seen ? 'rgba(24, 16, 11, 0.55)' : 'transparent',
    borderBottom: '0',
    borderLeft: `1px solid ${seen ? accentRgb : 'rgba(80, 60, 40, 0.25)'}`,
    opacity: seen ? '1' : '0.45',
  } as Partial<CSSStyleDeclaration>);
  const t = document.createElement('div');
  t.textContent = title;
  t.className = 'lk-k';
  Object.assign(t.style, {
    fontSize: '14px',
    letterSpacing: '0.02em',
    color: seen ? 'rgba(236, 206, 166, 0.9)' : 'rgba(140, 120, 100, 0.7)',
    marginBottom: '2px',
    fontFamily: FONT_DISPLAY,
    fontStyle: seen ? 'normal' : 'italic',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(t);
  const s = document.createElement('div');
  s.textContent = sub;
  Object.assign(s.style, {
    fontSize: '13px',
    color: 'rgba(175, 145, 115, 0.7)',
    fontFamily: FONT_DISPLAY,
    fontStyle: 'italic',
    lineHeight: '1.3',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(s);
  return el;
}
