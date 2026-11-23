// READING VIEW — rows to choose on the left, the chosen one explained on the
// right in the scorched slab (the Lamplight draft's CHARACTER and CODEX).
//
// A row is a name and a value. Choosing it (keys, a pad, the mouse passing
// over, a tap) lights it and burns its explanation into the slab: what it is,
// a line of prose, and an optional small note. The first row is explained
// when the view opens, so a touch player who never chooses still reads one.
//
// Data in, DOM out: a screen builds ReadingRow[] from live state and hands
// them here; it never styles a row itself.

import { injectKitStyles } from './style';

export interface ReadingRow {
  /** Stable id: focus survives a rebuild by it. */
  key: string;
  label: string;
  value: string;
  /** The slab's heading. Default: the label. */
  title?: string;
  /** Small caps over the heading ("Relic · Bone"). */
  kind?: string;
  /** The explanation, one or two sentences. */
  text: string;
  /** A quieter line under it (counts, what comes next). */
  note?: string;
  /** A faint row (an unknown codex entry): choosable, dimmed. */
  faint?: boolean;
}

export interface ReadingSection {
  /** Heading over the rows, with an optional count at the right. */
  heading?: string;
  count?: string;
  rows: ReadingRow[];
}

export function buildReadingView(sections: ReadingSection[]): HTMLElement {
  injectKitStyles();
  const view = document.createElement('div');
  view.className = 'lk-reading';
  const list = document.createElement('div');
  list.className = 'lk-reading-rows';
  const slab = document.createElement('div');
  slab.className = 'lk-detail lk-reading-slab';
  const kindEl = document.createElement('div'); kindEl.className = 'lk-rd-kind';
  const titleEl = document.createElement('div'); titleEl.className = 'lk-rd-title';
  const rule = document.createElement('div'); rule.className = 'lk-rd-rule';
  const textEl = document.createElement('div'); textEl.className = 'lk-rd-text';
  const noteEl = document.createElement('div'); noteEl.className = 'lk-rd-note';
  slab.append(kindEl, titleEl, rule, textEl, noteEl);
  view.append(list, slab);

  let shown: string | null = null;
  const rowEls = new Map<string, HTMLElement>();
  const explain = (r: ReadingRow): void => {
    if (shown === r.key) return;
    shown = r.key;
    // The explained row stays lit, also on touch where nothing is focused.
    for (const [key, el] of rowEls) el.classList.toggle('chosen', key === r.key);
    kindEl.textContent = r.kind ?? '';
    kindEl.style.display = r.kind ? '' : 'none';
    titleEl.textContent = r.title ?? r.label;
    textEl.textContent = r.text;
    noteEl.textContent = r.note ?? '';
    noteEl.style.display = r.note ? '' : 'none';
    // Burn the heading in afresh, and let the prose settle after it.
    for (const el of [titleEl, textEl]) {
      el.classList.remove('lk-burn', 'lk-ash');
      void el.offsetWidth;
    }
    titleEl.classList.add('lk-burn');
    textEl.classList.add('lk-ash');
  };

  let first: ReadingRow | null = null;
  for (const sec of sections) {
    if (sec.heading) {
      const h = document.createElement('div');
      h.className = 'lk-head lk-reading-head';
      const l = document.createElement('span'); l.textContent = sec.heading;
      h.appendChild(l);
      if (sec.count) { const c = document.createElement('span'); c.className = 'lk-reading-count'; c.textContent = sec.count; h.appendChild(c); }
      list.appendChild(h);
    }
    for (const r of sec.rows) {
      first ??= r;
      const row = document.createElement('div');
      row.className = r.faint ? 'lk-row lk-reading-row faint' : 'lk-row lk-reading-row';
      row.dataset.focus = '';
      row.dataset.fkey = `read:${r.key}`;
      const k = document.createElement('span'); k.className = 'lk-k'; k.textContent = r.label;
      const v = document.createElement('span'); v.className = 'lk-v'; v.textContent = r.value;
      row.append(k, v);
      rowEls.set(r.key, row);
      // Keys, a pad, the mouse: whatever the focus kit lights is explained.
      new MutationObserver(() => { if (row.classList.contains('is-focused')) explain(r); })
        .observe(row, { attributes: true, attributeFilter: ['class'] });
      // A tap explains without needing focus (touch never focuses).
      row.addEventListener('click', () => explain(r));
      list.appendChild(row);
    }
  }
  if (first) explain(first);
  else { view.classList.add('empty'); }
  return view;
}
