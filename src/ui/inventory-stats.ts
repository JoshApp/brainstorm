import { getPlayerHp } from '../player/health';
import { getPlayerSnapshot } from '../state/player-stats';
import { CARD_BG, TEXT_DIM, TEXT_PRIMARY, sectionLabel } from './inventory-shared';

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

  addStatRow(card, 'HP',         `${getPlayerHp()} / ${snap.maxHp}`);
  addStatRow(card, 'DAMAGE',     damageStr);
  addStatRow(card, 'PHYS ARM',   `${snap.physicalArmor}`);
  addStatRow(card, 'MAG ARM',    `${snap.magicArmor}`);
  addStatRow(card, 'REACH',      `${snap.weaponReach.toFixed(1)}m`);

  col.appendChild(card);
  return col;
}

function addStatRow(parent: HTMLElement, label: string, value: string) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);
  const l = document.createElement('span');
  l.textContent = label;
  Object.assign(l.style, {
    color: TEXT_DIM, letterSpacing: '0.15em', fontSize: '10px',
  } as Partial<CSSStyleDeclaration>);
  const v = document.createElement('span');
  v.textContent = value;
  Object.assign(v.style, {
    color: TEXT_PRIMARY, fontFamily: 'monospace',
  } as Partial<CSSStyleDeclaration>);
  row.append(l, v);
  parent.appendChild(row);
}
