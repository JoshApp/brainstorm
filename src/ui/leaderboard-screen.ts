// Deepest-descent leaderboard — "how deep before the dark took you."
//
// Derived from the death table (every death records the depth reached), so
// no dedicated backend. Trust-but-verify for the alpha: depths are
// self-reported on death; server-side replay-verification comes later. The
// board is built fresh each open from the live death cache.

import { createSheet, menuButton } from './menu-shell';
import { THEME, FONT_DISPLAY, FONT_UI } from './theme';
import { getLeaderboard, type LeaderEntry } from '../net/delve-net';

export function showLeaderboard(): void {
  const sheet = createSheet({ id: 'leaderboard', title: 'DEEPEST DESCENTS', width: 440, layer: 'title' });
  const entries = getLeaderboard();

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'The dark keeps no record yet.';
    Object.assign(empty.style, {
      fontFamily: FONT_DISPLAY,
      fontStyle: 'italic',
      fontSize: '14px',
      color: THEME.dim,
      textAlign: 'center',
      padding: '28px 8px',
      lineHeight: '1.5',
    } as Partial<CSSStyleDeclaration>);
    sheet.body.appendChild(empty);
  } else {
    const list = document.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '0' } as Partial<CSSStyleDeclaration>);
    entries.forEach((e, i) => list.appendChild(makeRow(i + 1, e)));
    sheet.body.appendChild(list);

    const note = document.createElement('div');
    note.textContent = 'Deepest reached before the dark took them. Self-reported — the dungeon trusts you, for now.';
    Object.assign(note.style, {
      fontFamily: FONT_UI,
      fontSize: '10px',
      letterSpacing: '0.05em',
      color: THEME.faint,
      textAlign: 'center',
      marginTop: '14px',
      lineHeight: '1.5',
    } as Partial<CSSStyleDeclaration>);
    sheet.body.appendChild(note);
  }

  sheet.footer.appendChild(menuButton('CLOSE', () => sheet.close()));
  sheet.open();
}

function makeRow(rank: number, e: LeaderEntry): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    padding: '8px 10px',
    background: e.own ? 'rgba(255, 150, 60, 0.10)' : 'transparent',
    borderLeft: `2px solid ${e.own ? THEME.ember : 'transparent'}`,
    borderBottom: `1px solid ${THEME.rule}`,
  } as Partial<CSSStyleDeclaration>);

  const rk = document.createElement('span');
  rk.textContent = String(rank);
  Object.assign(rk.style, {
    fontFamily: FONT_UI,
    fontSize: '12px',
    fontWeight: '700',
    color: rank <= 3 ? THEME.amber : THEME.faint,
    minWidth: '22px',
    textAlign: 'right',
  } as Partial<CSSStyleDeclaration>);

  const name = document.createElement('span');
  name.textContent = e.name + (e.own ? '  (you)' : '');
  Object.assign(name.style, {
    fontFamily: FONT_DISPLAY,
    fontSize: '16px',
    letterSpacing: '0.04em',
    color: e.own ? THEME.amber : THEME.text,
    flex: '1 1 auto',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);

  const falls = document.createElement('span');
  falls.textContent = e.deaths === 1 ? '1 fall' : `${e.deaths} falls`;
  Object.assign(falls.style, {
    fontFamily: FONT_UI,
    fontSize: '10px',
    letterSpacing: '0.1em',
    color: THEME.faint,
  } as Partial<CSSStyleDeclaration>);

  const depth = document.createElement('span');
  depth.textContent = `depth ${e.depth}`;
  Object.assign(depth.style, {
    fontFamily: FONT_UI,
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    color: THEME.amber,
    minWidth: '64px',
    textAlign: 'right',
  } as Partial<CSSStyleDeclaration>);

  row.append(rk, name, falls, depth);
  return row;
}
