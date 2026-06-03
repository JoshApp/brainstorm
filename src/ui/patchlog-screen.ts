// Patch log viewer — opens from the title screen. Renders PATCHLOG
// (src/content/patchlog.ts) newest-first: a version header + date,
// then each change as a tagged line.
//
// PURELY FACTUAL for now. When the LLM layer lands, a sibling view
// can render the same data through the announcer voice; this one
// stays the plain record (the "wiki / source-of-truth" view).

import { isScreenOpen } from './screen-manager';
import { createSheet, type Sheet } from './menu-shell';
import { PATCHLOG, type PatchTag } from '../content/patchlog';

const SCREEN_ID = 'patchlog';

let sheet: Sheet | null = null;

// Tag → { label, colour }. Subtle, in-palette; the tag chips give the
// log a scannable structure without shouting.
const TAG_META: Record<PatchTag, { label: string; color: string }> = {
  add:     { label: 'NEW',     color: 'rgba(150, 210, 120, 0.92)' },
  content: { label: 'CONTENT', color: 'rgba(210, 170, 110, 0.92)' },
  fix:     { label: 'FIX',     color: 'rgba(150, 180, 230, 0.92)' },
  tune:    { label: 'TUNE',    color: 'rgba(210, 150, 200, 0.92)' },
  tech:    { label: 'TECH',    color: 'rgba(160, 160, 170, 0.85)' },
};

export function showPatchlog() {
  if (isScreenOpen(SCREEN_ID)) return;

  const s = createSheet({
    id: SCREEN_ID,
    title: 'DISPATCHES',
    width: 680,
    layer: 'title',   // above the start screen
    onClose() { sheet = null; },
  });
  sheet = s;

  // Sub-header — sets expectation that this is the raw record.
  const sub = document.createElement('div');
  sub.textContent = 'what has changed in the dungeon';
  Object.assign(sub.style, {
    fontSize: '11px',
    fontStyle: 'italic',
    letterSpacing: '0.06em',
    color: 'rgba(180, 140, 100, 0.6)',
    textAlign: 'center',
    marginBottom: '14px',
    fontFamily: '"Iowan Old Style", "Palatino", serif',
  } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(sub);

  for (const version of PATCHLOG) {
    // Version header row: label left, date right.
    const vHeader = document.createElement('div');
    Object.assign(vHeader.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginTop: '14px',
      marginBottom: '10px',
      borderBottom: '1px solid rgba(170, 130, 80, 0.25)',
      paddingBottom: '5px',
      fontFamily: 'system-ui, sans-serif',
    } as Partial<CSSStyleDeclaration>);

    const vLabel = document.createElement('div');
    vLabel.textContent = version.version;
    Object.assign(vLabel.style, {
      fontSize: '15px',
      fontWeight: '700',
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: 'rgba(230, 180, 110, 0.92)',
    } as Partial<CSSStyleDeclaration>);
    vHeader.appendChild(vLabel);

    const vDate = document.createElement('div');
    vDate.textContent = version.date;
    Object.assign(vDate.style, {
      fontSize: '11px',
      letterSpacing: '0.14em',
      color: 'rgba(160, 120, 80, 0.6)',
    } as Partial<CSSStyleDeclaration>);
    vHeader.appendChild(vDate);
    s.body.appendChild(vHeader);

    // Entries.
    for (const entry of version.entries) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        marginBottom: '9px',
      } as Partial<CSSStyleDeclaration>);

      const meta = TAG_META[entry.tag];
      const chip = document.createElement('span');
      chip.textContent = meta.label;
      Object.assign(chip.style, {
        flex: '0 0 auto',
        minWidth: '58px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '9px',
        fontWeight: '700',
        letterSpacing: '0.12em',
        color: meta.color,
        border: `1px solid ${meta.color}`,
        borderRadius: '3px',
        padding: '2px 0',
        opacity: '0.85',
      } as Partial<CSSStyleDeclaration>);
      row.appendChild(chip);

      const text = document.createElement('span');
      text.textContent = entry.text;
      Object.assign(text.style, {
        fontSize: '13px',
        lineHeight: '1.4',
        color: 'rgba(215, 185, 150, 0.9)',
      } as Partial<CSSStyleDeclaration>);
      row.appendChild(text);

      s.body.appendChild(row);
    }
  }

  s.open();
}
