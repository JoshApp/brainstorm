// Patch log viewer — opens from the title screen. Renders PATCHLOG
// (src/content/patchlog.ts) newest-first: a version header + date,
// then each change as a tagged line.
//
// PURELY FACTUAL for now. When the LLM layer lands, a sibling view
// can render the same data through the announcer voice; this one
// stays the plain record (the "wiki / source-of-truth" view).

import { openScreen, closeScreen } from './screen-manager';
import { PATCHLOG, type PatchTag } from '../content/patchlog';

const SCREEN_ID = 'patchlog';

let root: HTMLDivElement | null = null;

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
  if (root) return;

  root = document.createElement('div');
  root.id = 'patchlog-screen';
  Object.assign(root.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(680px, 92vw)',
    maxHeight: '92vh',
    overflowY: 'auto',
    padding: '24px 28px',
    background: 'linear-gradient(180deg, rgba(20, 14, 10, 0.96), rgba(10, 6, 4, 0.98))',
    border: '1px solid rgba(170, 130, 80, 0.35)',
    borderRadius: '3px',
    boxShadow: '0 10px 36px rgba(0,0,0,0.7)',
    color: 'rgba(220, 180, 140, 0.92)',
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    opacity: '0',
    transition: 'opacity 220ms ease',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  // Header.
  const header = document.createElement('div');
  header.textContent = 'Dispatches';
  Object.assign(header.style, {
    fontSize: '22px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(230, 180, 110, 0.92)',
    textAlign: 'center',
    marginBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(header);

  // Sub-header — sets expectation that this is the raw record.
  const sub = document.createElement('div');
  sub.textContent = 'what has changed in the dungeon';
  Object.assign(sub.style, {
    fontSize: '11px',
    fontStyle: 'italic',
    letterSpacing: '0.06em',
    color: 'rgba(180, 140, 100, 0.6)',
    textAlign: 'center',
    marginBottom: '22px',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(sub);

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
    root.appendChild(vHeader);

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

      root.appendChild(row);
    }
  }

  // Close hint.
  const closeHint = document.createElement('div');
  closeHint.textContent = 'tap outside to close';
  Object.assign(closeHint.style, {
    marginTop: '22px',
    textAlign: 'center',
    fontSize: '10px',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'rgba(160, 120, 80, 0.45)',
    fontFamily: 'system-ui, sans-serif',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(closeHint);

  document.body.appendChild(root);
  openScreen({
    id: SCREEN_ID,
    root,
    // 'title' layer so this renders above the start screen (same
    // pattern as the codex viewer).
    policy: { pausesWorld: true, needsBackdrop: true, layer: 'title' },
    onDismissRequest: dismiss,
  });
  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
  });
}

function dismiss() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 240);
  closeScreen(SCREEN_ID);
}
