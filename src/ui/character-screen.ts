import { isScreenOpen } from './screen-manager';
import { createSheet, type Sheet } from './menu-shell';
import {
  getCharacter,
  onCharacterChanged,
  spendAttributePoint,
  type AttributeKind,
  type ProficiencyKind,
} from '../state/character';
import { getRunState } from '../state/run-state';
import { getActiveLevel } from '../level/loader';

// CHARACTER screen — the "who is this delver becoming" page.
//
// Opens from desktop 'C' key + a button in the settings menu.
// Visible mid-run for status check; the SPEND action on attributes
// only enables at a safe room (between acts). The spend gate keeps
// build choices tied to the Souls-bonfire pacing beat — you fought
// the act, you sit by the fire, you commit.

const SCREEN_ID = 'character';

interface AttributeRow {
  kind: AttributeKind;
  label: string;
  effect: string;
  valueEl: HTMLDivElement;
  spendBtn: HTMLButtonElement;
}

interface ProficiencyRow {
  kind: ProficiencyKind;
  label: string;
  fillEl: HTMLDivElement;
  valueEl: HTMLDivElement;
}

const ATTR_DEFS: Array<{ kind: AttributeKind; label: string; effect: string }> = [
  { kind: 'might',   label: 'MIGHT',   effect: 'heavy weapons · stagger · +1% all damage' },
  { kind: 'finesse', label: 'FINESSE', effect: 'light & ranged · +2% crit chance' },
  { kind: 'lore',    label: 'LORE',    effect: 'arcane · stronger afflictions · +1% all damage' },
  { kind: 'grit',    label: 'GRIT',    effect: 'armour scaling · +3 max HP' },
];

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
let unsubscribe: (() => void) | null = null;

// Empirical cap for proficiency bar fill — bars saturate at this
// value so a 100-hit sword run doesn't make a 5-greed run look empty
// by comparison.
const PROF_BAR_MAX = 50;

/** True if the player is currently at a safe room (or the starter
 *  chamber, which is also a "between things" rest moment). Spend
 *  buttons enable only here. */
function atRestPoint(): boolean {
  const level = getActiveLevel();
  if (!level) return false;
  const id = level.spec.id;
  return id.startsWith('safe-') || id === 'starter';
}

export function openCharacterScreen(): void {
  if (isScreenOpen(SCREEN_ID)) return;

  const s = createSheet({
    id: SCREEN_ID,
    title: 'CHARACTER',
    width: 720,
    layer: 'modal',
    policy: { hidesHud: true },
    onClose() {
      unsubscribe?.();
      unsubscribe = null;
      sheet = null;
    },
  });
  sheet = s;

  // ── Summary ───────────────────────────────────────────────────────
  summaryEl = document.createElement('div');
  Object.assign(summaryEl.style, {
    fontStyle: 'italic',
    fontSize: '13px',
    color: 'rgba(180, 140, 110, 0.72)',
    textAlign: 'center',
    marginBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(summaryEl);

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

  s.body.appendChild(cols);

  s.open();

  // Reactive — character changes during the run (proficiency ticks)
  // reflect immediately without re-opening.
  unsubscribe = onCharacterChanged(rebuild);
  rebuild();
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
    gridTemplateColumns: 'auto 1fr auto auto',
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

  const spendBtn = document.createElement('button');
  spendBtn.textContent = '+';
  spendBtn.setAttribute('aria-label', `raise ${def.label}`);
  Object.assign(spendBtn.style, {
    width: '44px',
    height: '44px',
    background: 'rgba(40, 24, 14, 0.85)',
    border: '1px solid rgba(180, 130, 90, 0.45)',
    color: 'rgba(255, 220, 130, 0.95)',
    fontSize: '18px',
    fontWeight: '700',
    borderRadius: '3px',
    cursor: 'pointer',
    padding: '0',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  spendBtn.addEventListener('click', () => {
    if (spendAttributePoint(def.kind)) {
      // notify() in character.ts will trigger rebuild via the
      // listener — no manual refresh needed here.
    }
  });
  row.appendChild(spendBtn);

  parent.appendChild(row);
  return { kind: def.kind, label: def.label, effect: def.effect, valueEl: value, spendBtn };
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
  if (!sheet || !summaryEl || !unspentLabel) return;
  const c = getCharacter();
  const run = getRunState();
  const restPoint = atRestPoint();

  // Summary line.
  const depth = run?.depth ?? 0;
  const kills = run?.kills ?? 0;
  const gold = run?.gold ?? 0;
  const itemsFound = run?.itemsFound.length ?? 0;
  summaryEl.textContent = `floor ${depth} · ${kills} slain · ${gold}g · ${itemsFound} found`;

  // Unspent points label + spend-button enable.
  if (c.unspentPoints > 0) {
    unspentLabel.textContent = restPoint
      ? `${c.unspentPoints} unspent`
      : `${c.unspentPoints} unspent (find a safe room)`;
  } else {
    unspentLabel.textContent = '';
  }
  const canSpend = restPoint && c.unspentPoints > 0;
  for (const row of attrRows) {
    row.valueEl.textContent = String(c.attributes[row.kind]);
    row.spendBtn.disabled = !canSpend;
    row.spendBtn.style.opacity = canSpend ? '1' : '0.30';
    row.spendBtn.style.cursor = canSpend ? 'pointer' : 'not-allowed';
  }

  // Proficiencies.
  for (const row of profRows) {
    const v = c.proficiencies[row.kind];
    row.valueEl.textContent = String(v);
    const pct = Math.min(100, (v / PROF_BAR_MAX) * 100);
    row.fillEl.style.width = `${pct}%`;
  }
}
