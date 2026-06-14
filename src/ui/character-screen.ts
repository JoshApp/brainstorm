import { isScreenOpen } from './screen-manager';
import { createSheet, type Sheet } from './menu-shell';
import {
  getCharacter,
  onCharacterChanged,
  type AttributeKind,
  type ProficiencyKind,
} from '../state/character';
import { getRunState } from '../state/run-state';
import { ATTR_DEFS } from './attribute-defs';

// CHARACTER screen — the "who is this delver becoming" page.
//
// Opens from the tome pillar (STUDY), desktop 'C' key, + the settings
// menu. This is REVIEW ONLY: the book reflects your build, it never
// changes it. Raising attributes happens at a bonfire (REST → the
// level-up menu, ui/levelup-menu.ts) — the fire grows you, the book
// remembers you. Unspent points show here as a nudge toward the fire.

const SCREEN_ID = 'character';

interface AttributeRow {
  kind: AttributeKind;
  label: string;
  effect: string;
  valueEl: HTMLDivElement;
}

interface ProficiencyRow {
  kind: ProficiencyKind;
  label: string;
  fillEl: HTMLDivElement;
  valueEl: HTMLDivElement;
}

const PROF_GROUPS: Array<{ heading: string; rows: Array<{ kind: ProficiencyKind; label: string }> }> = [
  {
    heading: 'COMBAT',
    rows: [
      { kind: 'sword',  label: 'sword'  },
      { kind: 'dagger', label: 'dagger' },
      { kind: 'hammer', label: 'hammer' },
    ],
  },
  {
    heading: 'DEFENSIVE',
    rows: [
      { kind: 'block',     label: 'block'     },
      { kind: 'toughness', label: 'toughness' },
    ],
  },
  {
    heading: 'UTILITY',
    rows: [
      { kind: 'alchemy',   label: 'alchemy'   },
      { kind: 'tinkering', label: 'tinkering' },
      { kind: 'greed',     label: 'greed'     },
      { kind: 'profanity', label: 'profanity' },
      { kind: 'survival',  label: 'survival'  },
    ],
  },
  {
    heading: 'META',
    rows: [
      { kind: 'descent', label: 'descent' },
    ],
  },
];

let sheet: Sheet | null = null;
let summaryEl: HTMLDivElement | null = null;
let unspentLabel: HTMLSpanElement | null = null;
let attrRows: AttributeRow[] = [];
let profRows: ProficiencyRow[] = [];

// Empirical cap for proficiency bar fill — bars saturate at this
// value so a 100-hit sword run doesn't make a 5-greed run look empty
// by comparison.
const PROF_BAR_MAX = 50;

/** Build the character body (summary + attributes | proficiencies) into
 *  a div, wire the reactive refresh, and return it + a dispose hook.
 *  Reusable as a tab in the unified game menu and by the standalone
 *  sheet below. */
export function buildCharacterContent(): { el: HTMLDivElement; dispose: () => void } {
  const el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: '8px' } as Partial<CSSStyleDeclaration>);

  // ── Summary ───────────────────────────────────────────────────────
  summaryEl = document.createElement('div');
  Object.assign(summaryEl.style, {
    fontStyle: 'italic',
    fontSize: '13px',
    color: 'rgba(180, 140, 110, 0.72)',
    textAlign: 'center',
    marginBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(summaryEl);

  // ── Two columns: attributes | proficiencies ───────────────────────
  // flex-wrap means they sit side-by-side when there's width (landscape)
  // and stack when there isn't — responsive with no JS breakpoint (the
  // old window.innerWidth check fired once and never re-evaluated).
  const cols = document.createElement('div');
  Object.assign(cols.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px 28px',
  } as Partial<CSSStyleDeclaration>);

  const colHeader = (text: string): HTMLDivElement => {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, {
      fontSize: '11px', letterSpacing: '0.30em',
      color: 'rgba(220, 180, 140, 0.65)',
      borderBottom: '1px solid rgba(180, 130, 90, 0.25)',
      paddingBottom: '6px', marginBottom: '10px',
    } as Partial<CSSStyleDeclaration>);
    return h;
  };

  // Left column — attributes.
  const attrCol = document.createElement('div');
  Object.assign(attrCol.style, { flex: '1 1 260px', minWidth: '240px' } as Partial<CSSStyleDeclaration>);
  const attrHeader = colHeader('');
  Object.assign(attrHeader.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as Partial<CSSStyleDeclaration>);
  const attrTitle = document.createElement('span');
  attrTitle.textContent = 'ATTRIBUTES';
  const unspentSpan = document.createElement('span');
  unspentSpan.style.color = 'rgba(255, 220, 130, 0.90)';
  attrHeader.append(attrTitle, unspentSpan);
  attrCol.appendChild(attrHeader);
  unspentLabel = unspentSpan;
  attrRows = ATTR_DEFS.map((def) => buildAttributeRow(def, attrCol));
  cols.appendChild(attrCol);

  // Right column — proficiencies, grouped.
  const profCol = document.createElement('div');
  Object.assign(profCol.style, { flex: '1 1 260px', minWidth: '240px' } as Partial<CSSStyleDeclaration>);
  profCol.appendChild(colHeader('PROFICIENCIES'));
  profRows = [];
  for (const group of PROF_GROUPS) {
    const groupHeading = document.createElement('div');
    groupHeading.textContent = group.heading;
    Object.assign(groupHeading.style, {
      fontSize: '10px', letterSpacing: '0.25em',
      color: 'rgba(180, 130, 90, 0.55)',
      marginTop: '14px', marginBottom: '6px',
    } as Partial<CSSStyleDeclaration>);
    profCol.appendChild(groupHeading);
    for (const row of group.rows) profRows.push(buildProficiencyRow(row, profCol));
  }
  cols.appendChild(profCol);
  el.appendChild(cols);

  const unsub = onCharacterChanged(rebuild);
  rebuild();
  return {
    el,
    dispose() {
      unsub();
      // Drop refs so a stale rebuild (shouldn't fire post-dispose) no-ops.
      summaryEl = null;
      unspentLabel = null;
      attrRows = [];
      profRows = [];
    },
  };
}

export function openCharacterScreen(): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const content = buildCharacterContent();
  const s = createSheet({
    id: SCREEN_ID,
    title: 'CHARACTER',
    width: 720,
    layer: 'modal',
    policy: { hidesHud: true },
    onClose() {
      content.dispose();
      sheet = null;
    },
  });
  sheet = s;
  s.body.appendChild(content.el);
  s.open();
}

export function closeCharacterScreen(): void {
  sheet?.close();
}

export function isCharacterScreenOpen(): boolean {
  return isScreenOpen(SCREEN_ID);
}

function buildAttributeRow(def: typeof ATTR_DEFS[number], parent: HTMLElement): AttributeRow {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'baseline',
    gap: '12px',
    padding: '10px 0',
    borderBottom: '1px solid rgba(120, 90, 60, 0.15)',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.textContent = def.label;
  Object.assign(label.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.20em',
    color: 'rgba(255, 220, 180, 0.92)',
    minWidth: '88px',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(label);

  const effect = document.createElement('div');
  effect.textContent = def.effect;
  Object.assign(effect.style, {
    fontSize: '12px',
    fontStyle: 'italic',
    color: 'rgba(180, 140, 110, 0.70)',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(effect);

  const value = document.createElement('div');
  value.textContent = '0';
  Object.assign(value.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '16px',
    fontWeight: '700',
    color: 'rgba(220, 180, 140, 0.95)',
    minWidth: '24px',
    textAlign: 'right',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(value);

  parent.appendChild(row);
  return { kind: def.kind, label: def.label, effect: def.effect, valueEl: value };
}

function buildProficiencyRow(def: { kind: ProficiencyKind; label: string }, parent: HTMLElement): ProficiencyRow {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: '90px 1fr 40px',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 0',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.textContent = def.label;
  Object.assign(label.style, {
    fontSize: '13px',
    fontStyle: 'italic',
    color: 'rgba(220, 180, 140, 0.78)',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(label);

  // Bar track + fill.
  const track = document.createElement('div');
  Object.assign(track.style, {
    height: '6px',
    background: 'rgba(40, 28, 18, 0.85)',
    borderRadius: '2px',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    height: '100%',
    width: '0%',
    background: 'linear-gradient(to right, rgba(180, 130, 90, 0.95), rgba(255, 200, 130, 0.95))',
    transition: 'width 0.2s ease',
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(fill);
  row.appendChild(track);

  const value = document.createElement('div');
  value.textContent = '0';
  Object.assign(value.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    fontWeight: '600',
    color: 'rgba(220, 180, 140, 0.85)',
    textAlign: 'right',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(value);

  parent.appendChild(row);
  return { kind: def.kind, label: def.label, fillEl: fill, valueEl: value };
}

function rebuild(): void {
  if (!summaryEl || !unspentLabel) return;
  const c = getCharacter();
  const run = getRunState();

  // Summary line.
  const depth = run?.depth ?? 0;
  const kills = run?.kills ?? 0;
  const gold = run?.gold ?? 0;
  const itemsFound = run?.itemsFound.length ?? 0;
  summaryEl.textContent = `floor ${depth} · ${kills} slain · ${gold}g · ${itemsFound} found`;

  // Unspent points read as a nudge toward the fire — the book reviews,
  // it never spends. Raising happens at a bonfire (REST).
  unspentLabel.textContent = c.unspentPoints > 0
    ? `${c.unspentPoints} unspent — rest at a fire to rise`
    : '';
  for (const row of attrRows) {
    row.valueEl.textContent = String(c.attributes[row.kind]);
  }

  // Proficiencies.
  for (const row of profRows) {
    const v = c.proficiencies[row.kind];
    row.valueEl.textContent = String(v);
    const pct = Math.min(100, (v / PROF_BAR_MAX) * 100);
    row.fillEl.style.width = `${pct}%`;
  }
}
