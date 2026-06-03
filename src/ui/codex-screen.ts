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

const SCREEN_ID = 'codex';

let sheet: Sheet | null = null;

/** The codex body (lifetime stats line + Slain/Held/Read sections),
 *  reusable as a tab in the unified game menu as well as the standalone
 *  title-screen sheet. */
export function buildCodexContent(): HTMLDivElement {
  const meta = getMeta();
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    fontFamily: '"Iowan Old Style", "Palatino", serif',
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
  Object.assign(h.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: '14px',
    marginBottom: '8px',
    borderBottom: '1px solid rgba(170, 130, 80, 0.25)',
    paddingBottom: '4px',
    fontFamily: 'system-ui, sans-serif',
  });
  const l = document.createElement('div');
  l.textContent = label;
  Object.assign(l.style, {
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'rgba(220, 170, 110, 0.85)',
  });
  const c = document.createElement('div');
  c.textContent = `${knownCount} / ${totalCount}`;
  Object.assign(c.style, {
    fontSize: '11px',
    color: 'rgba(160, 130, 100, 0.65)',
    letterSpacing: '0.1em',
  });
  h.appendChild(l);
  h.appendChild(c);
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
    gap: '8px',
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
    Object.assign(item.style, {
      fontStyle: 'italic',
      fontSize: '12px',
      color: 'rgba(200, 170, 130, 0.78)',
      padding: '6px 10px',
      background: 'rgba(40, 28, 18, 0.4)',
      borderLeft: '2px solid rgba(170, 130, 80, 0.35)',
      lineHeight: '1.4',
    });
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

function makeEntry(title: string, sub: string, accent: number, seen: boolean): HTMLElement {
  const el = document.createElement('div');
  const accentRgb = `rgb(${(accent >> 16) & 0xff}, ${(accent >> 8) & 0xff}, ${accent & 0xff})`;
  Object.assign(el.style, {
    padding: '8px 10px',
    background: seen ? 'rgba(30, 22, 16, 0.55)' : 'rgba(20, 15, 10, 0.35)',
    border: `1px solid ${seen ? accentRgb : 'rgba(80, 60, 40, 0.25)'}`,
    borderRadius: '2px',
    opacity: seen ? '1' : '0.5',
  });
  const t = document.createElement('div');
  t.textContent = title;
  Object.assign(t.style, {
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.04em',
    color: seen ? accentRgb : 'rgba(140, 120, 100, 0.7)',
    marginBottom: '2px',
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    fontStyle: seen ? 'normal' : 'italic',
  });
  el.appendChild(t);
  const s = document.createElement('div');
  s.textContent = sub;
  Object.assign(s.style, {
    fontSize: '10px',
    letterSpacing: '0.06em',
    color: 'rgba(170, 140, 110, 0.55)',
    fontFamily: 'system-ui, sans-serif',
    fontStyle: 'italic',
    lineHeight: '1.3',
  });
  el.appendChild(s);
  return el;
}
