// Codex — the lifetime memory of everything the player has discovered
// across all their runs. Opens from the title screen. Three sections:
// what you have SLAIN, what you have HELD, what you have READ.
//
// Tone: in-world voice. "What you remember." What is not yet met is one faint
// count per section ("14 not yet met") beside the section's tally, so the
// player still has a "gotta see them all" target — the meta-progression hook —
// without a wall of question marks.

import { isScreenOpen } from './screen-manager';
import { createSheet, type Sheet } from './menu-shell';
import { getMeta } from '../state/meta-state';
import { ITEMS } from '../content/items';
import { ENEMIES } from '../content/enemies';
import { isIncluded } from '../content/content-status';
import { itemFraming } from './item-framing';
import { buildReadingView, type ReadingRow, type ReadingSection } from './kit/reading';

const SCREEN_ID = 'codex';

let sheet: Sheet | null = null;

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** One faint row standing for everything in a section not yet met: a count,
 *  not a wall of question marks. */
function unknownRow(key: string, n: number, what: string, text: string): ReadingRow {
  return { key, label: `${n} ${what}`, value: '', faint: true, title: 'Not yet', text };
}

/** The codex (Lamplight): what you have SLAIN, HELD and READ across every
 *  descent, as a reading view — the entry chosen is told in the slab. Only
 *  content that is in the game counts toward the totals. Reusable as the
 *  satchel's CODEX tab and the title-screen sheet. */
export function buildCodexContent(): HTMLDivElement {
  const meta = getMeta();
  const wrap = document.createElement('div');

  const sub = document.createElement('div');
  sub.className = 'lk-reading-count';
  sub.textContent = `${meta.runsAttempted} descent${meta.runsAttempted === 1 ? '' : 's'}  ·  ${meta.totalKills} slain  ·  deepest ${meta.deepestDepth}`;
  Object.assign(sub.style, { textAlign: 'center', marginBottom: '14px' } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(sub);

  const sections: ReadingSection[] = [];

  // SLAIN
  const enemies = Object.values(ENEMIES).filter((e) => isIncluded(e));
  const slain = enemies.filter((e) => meta.enemiesSlain.includes(e.id));
  const slainRows: ReadingRow[] = slain.map((e) => ({
    key: `enemy:${e.id}`,
    label: cap(e.bossName ?? e.name),
    value: e.isBoss ? 'Boss' : e.miniboss ? 'Elder' : '',
    kind: e.isBoss ? 'A master of a floor' : e.miniboss ? 'Older than the rest' : 'Of the deep',
    text: `It takes ${e.hp} wound${e.hp === 1 ? '' : 's'} to put down, and it strikes for ${e.attackDamage}.`,
  }));
  const unmet = enemies.length - slain.length;
  if (unmet > 0) slainRows.push(unknownRow('enemy:unknown', unmet, 'not yet met', 'Something below you has not shown itself yet. It will.'));
  sections.push({ heading: 'Slain', count: `${slain.length} / ${enemies.length}`, rows: slainRows });

  // HELD
  const items = Object.values(ITEMS).filter((it) => isIncluded(it));
  const held = items.filter((it) => meta.itemsFound.includes(it.id));
  const heldRows: ReadingRow[] = held.map((it) => {
    const f = itemFraming(it);
    const rarity = it.rarity ?? 'mundane';
    return {
      key: `item:${it.id}`,
      label: it.name,
      value: cap(it.kind),
      kind: `${cap(rarity)} · ${cap(it.kind)}${f && rarity !== 'cursed' ? ` · ${f.label}` : ''}`,
      text: it.flavor ?? 'It says nothing about itself.',
    };
  });
  const unheld = items.length - held.length;
  if (unheld > 0) heldRows.push(unknownRow('item:unknown', unheld, 'never held', 'Names you have not learned yet. Most of them are deeper.'));
  sections.push({ heading: 'Held', count: `${held.length} / ${items.length}`, rows: heldRows });

  // READ
  const notes = meta.notesRead;
  const readRows: ReadingRow[] = notes.map((n, i) => ({
    key: `note:${i}`,
    label: n.length > 34 ? `${n.slice(0, 34).trimEnd()}…` : n,
    value: '',
    title: 'A note',
    text: `"${n}${n.length >= 60 ? '…' : ''}"`,
  }));
  if (readRows.length === 0) readRows.push({ key: 'note:none', label: 'No voices, yet.', value: '', faint: true, title: 'Read', text: 'The dead leave notes. You have not stopped to read one.' });
  sections.push({ heading: 'Read', count: `${notes.length}`, rows: readRows });

  wrap.appendChild(buildReadingView(sections));
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
