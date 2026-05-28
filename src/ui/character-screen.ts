import { openScreen, closeScreen, isScreenOpen } from './screen-manager';
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
  { kind: 'vigor',   label: 'VIGOR',   effect: '+1 max HP per point' },
  { kind: 'resolve', label: 'RESOLVE', effect: '+0.5 armour (both kinds) per point' },
  { kind: 'acuity',  label: 'ACUITY',  effect: '+2% crit chance per point' },
  { kind: 'lore',    label: 'LORE',    effect: 'narrator signal (no mechanical effect yet)' },
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

let root: HTMLDivElement | null = null;
let summaryEl: HTMLDivElement | null = null;
let unspentLabel: HTMLDivElement | null = null;
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

  root = document.createElement('div');
  root.id = 'character-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'radial-gradient(ellipse at center, rgba(20, 14, 10, 0.95) 0%, rgba(6, 4, 2, 0.98) 70%)',
    padding: '32px 24px',
    overflowY: 'auto',
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.92)',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  // ── Title ─────────────────────────────────────────────────────────
  const title = document.createElement('div');
  title.textContent = 'CHARACTER';
  Object.assign(title.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    letterSpacing: '0.40em',
    color: 'rgba(220, 180, 140, 0.75)',
    marginBottom: '6px',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(title);

  // ── Summary ───────────────────────────────────────────────────────
  summaryEl = document.createElement('div');
  Object.assign(summaryEl.style, {
    fontStyle: 'italic',
    fontSize: '14px',
    color: 'rgba(180, 140, 110, 0.72)',
    marginBottom: '24px',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(summaryEl);

  // ── Body — two-column responsive ──────────────────────────────────
  const body = document.createElement('div');
  Object.assign(body.style, {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
    gap: '36px',
    maxWidth: '760px',
    width: '100%',
  } as Partial<CSSStyleDeclaration>);
  // Collapse to single column on narrow viewports.
  body.style.gridTemplateColumns = window.innerWidth < 720 ? '1fr' : 'minmax(280px, 1fr) minmax(280px, 1fr)';
  root.appendChild(body);

  // Left column — attributes.
  const attrCol = document.createElement('div');
  const attrHeader = document.createElement('div');
  Object.assign(attrHeader.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.30em',
    color: 'rgba(220, 180, 140, 0.65)',
    marginBottom: '12px',
    borderBottom: '1px solid rgba(180, 130, 90, 0.25)',
    paddingBottom: '6px',
  } as Partial<CSSStyleDeclaration>);
  const attrTitle = document.createElement('span');
  attrTitle.textContent = 'ATTRIBUTES';
  unspentLabel = document.createElement('span');
  Object.assign(unspentLabel.style, {
    color: 'rgba(255, 220, 130, 0.90)',
  } as Partial<CSSStyleDeclaration>);
  attrHeader.appendChild(attrTitle);
  attrHeader.appendChild(unspentLabel);
  attrCol.appendChild(attrHeader);

  attrRows = ATTR_DEFS.map((def) => buildAttributeRow(def, attrCol));
  body.appendChild(attrCol);

  // Right column — proficiencies, grouped.
  const profCol = document.createElement('div');
  const profHeader = document.createElement('div');
  profHeader.textContent = 'PROFICIENCIES';
  Object.assign(profHeader.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.30em',
    color: 'rgba(220, 180, 140, 0.65)',
    marginBottom: '12px',
    borderBottom: '1px solid rgba(180, 130, 90, 0.25)',
    paddingBottom: '6px',
  } as Partial<CSSStyleDeclaration>);
  profCol.appendChild(profHeader);

  profRows = [];
  for (const group of PROF_GROUPS) {
    const groupHeading = document.createElement('div');
    groupHeading.textContent = group.heading;
    Object.assign(groupHeading.style, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '10px',
      letterSpacing: '0.25em',
      color: 'rgba(180, 130, 90, 0.55)',
      marginTop: '14px',
      marginBottom: '6px',
    } as Partial<CSSStyleDeclaration>);
    profCol.appendChild(groupHeading);
    for (const row of group.rows) {
      profRows.push(buildProficiencyRow(row, profCol));
    }
  }
  body.appendChild(profCol);

  // ── Close button ──────────────────────────────────────────────────
  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  Object.assign(close.style, {
    marginTop: '28px',
    padding: '10px 28px',
    background: 'rgba(40, 24, 14, 0.85)',
    border: '1px solid rgba(180, 130, 90, 0.45)',
    color: 'rgba(220, 180, 140, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.30em',
    borderRadius: '3px',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  close.addEventListener('click', closeCharacterScreen);
  root.appendChild(close);

  document.body.appendChild(root);
  openScreen({
    id: SCREEN_ID,
    root,
    policy: { pausesWorld: true, hidesHud: true, dimsScene: false, layer: 'modal' },
    onDismissRequest: closeCharacterScreen,
  });

  // Reactive — character changes during the run (proficiency ticks)
  // should reflect immediately without re-opening.
  unsubscribe = onCharacterChanged(rebuild);
  rebuild();
}

export function closeCharacterScreen(): void {
  if (!root) return;
  unsubscribe?.();
  unsubscribe = null;
  root.remove();
  root = null;
  closeScreen(SCREEN_ID);
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
  Object.assign(spendBtn.style, {
    width: '28px',
    height: '28px',
    background: 'rgba(40, 24, 14, 0.85)',
    border: '1px solid rgba(180, 130, 90, 0.45)',
    color: 'rgba(255, 220, 130, 0.95)',
    fontSize: '16px',
    fontWeight: '700',
    borderRadius: '3px',
    cursor: 'pointer',
    padding: '0',
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
  if (!root || !summaryEl || !unspentLabel) return;
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
