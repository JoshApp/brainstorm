import { getPlayerHp } from '../player/health';
import { getPlayerSnapshot } from '../state/player-stats';
import { CARD_BG, TEXT_DIM, TEXT_PRIMARY, sectionLabel } from './inventory-shared';
import { statModifierIcon, statIconEl } from './stat-icons';
import type { StatModifier } from '../combat/modifiers';

// STATS column — read-only readout of the player snapshot. No selection
// state, so it takes no context.

export function buildStatsColumn(): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
  } as Partial<CSSStyleDeclaration>);

  col.appendChild(sectionLabel('STATS'));

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: CARD_BG, padding: '8px 10px', borderRadius: '3px',
    border: '1px solid rgba(120, 90, 60, 0.3)',
    display: 'flex', flexDirection: 'column', gap: '4px',
    flex: '1',
  } as Partial<CSSStyleDeclaration>);

  // Single source of truth: the player snapshot folds proficiency + equipment
  // into one weaponDamage, so this readout can't drift from the combat number.
  const snap = getPlayerSnapshot();
  const baseDamage = snap.weaponBaseDamage;
  const totalDamage = snap.weaponDamage;
  const damageStr = snap.damageMultiplier !== 1
    ? `${totalDamage.toFixed(1)}  (${baseDamage.toFixed(1)}+${snap.weaponDamageBonus} ×${snap.damageMultiplier.toFixed(2)})`
    : snap.weaponDamageBonus > 0
      ? `${totalDamage.toFixed(1)}  (${baseDamage.toFixed(1)}+${snap.weaponDamageBonus})`
      : `${totalDamage.toFixed(1)}`;

  addStatRow(card, 'max-hp',        'HP',       `${getPlayerHp()} / ${snap.maxHp}`);
  addStatRow(card, 'weapon-damage', 'DAMAGE',   damageStr);
  addStatRow(card, 'physical-armor','PHYS ARM', `${snap.physicalArmor}`);
  addStatRow(card, 'magic-armor',   'MAG ARM',  `${snap.magicArmor}`);
  addStatRow(card, null,            'REACH',    `${snap.weaponReach.toFixed(1)}m`);

  col.appendChild(card);
  return col;
}

// A stat row led by its CATEGORY ICON (heart/blade/shield…) tinted to the
// category, so the readout speaks the same visual language as the item cards.
function addStatRow(parent: HTMLElement, kind: StatModifier['kind'] | null, label: string, value: string) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);
  // Icon + label never clip (this column is narrow); the value takes the rest
  // and wraps if the breakdown is long, so "DAMAGE" can't get chewed to "DAM".
  const left = document.createElement('div');
  Object.assign(left.style, { display: 'flex', alignItems: 'center', gap: '5px', flexShrink: '0' } as Partial<CSSStyleDeclaration>);
  if (kind) left.appendChild(statIconEl(statModifierIcon(kind), 11));
  const l = document.createElement('span');
  l.textContent = label;
  Object.assign(l.style, {
    color: TEXT_DIM, letterSpacing: '0.15em', fontSize: '10px', whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);
  left.appendChild(l);
  const v = document.createElement('span');
  v.textContent = value;
  Object.assign(v.style, {
    color: TEXT_PRIMARY, fontFamily: 'monospace', textAlign: 'right',
    minWidth: '0', lineHeight: '1.25',
  } as Partial<CSSStyleDeclaration>);
  row.append(left, v);
  parent.appendChild(row);
}
