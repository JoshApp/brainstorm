import { equipFromInventory, unequipSlot, getEquipment, getSlotAffixes } from '../player/equipment';
import { addItemSilently, removeItem } from '../player/inventory';
import { getPlayerHp, getPlayerMaxHp, healPlayer } from '../player/health';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import { SETS } from '../content/sets';
import { BUFFS } from '../content/buffs';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { getItemThumbnail } from './item-thumbnail';
import { playEquipClick, playHealSlurp, playBuffApply } from '../audio/sfx';
import { formatWeapon, formatModifier, formatPassive, formatBuffEffect, formatOnHit, formatSetBonus, hexCss } from './item-format';
import {
  CARD_BG, TEXT_PRIMARY, TEXT_DIM, TEXT_FAINT, sectionLabel,
  type Selection, type InventoryCtx,
} from './inventory-shared';

// DETAILS column — always-visible 4th column. Shows the selected item's
// thumbnail, name/meta, flavor, full effects, and a contextual action button
// (EQUIP / USE / UNEQUIP). Actions mutate inventory/equipment then clear the
// selection via ctx.select(null), which rebuilds the panel.

export function buildDetailsColumn(ctx: InventoryCtx): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);
  col.appendChild(sectionLabel('DETAILS'));

  const card = document.createElement('div');
  Object.assign(card.style, {
    flex: '1',
    minHeight: '0',
    background: CARD_BG,
    border: '1px solid rgba(120, 90, 60, 0.4)',
    borderRadius: '3px',
    padding: '8px 10px',
    display: 'flex', flexDirection: 'column', gap: '6px',
    overflowY: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const selection = ctx.selection;
  if (!selection) {
    const hint = document.createElement('div');
    hint.textContent = 'TAP AN ITEM TO INSPECT';
    Object.assign(hint.style, {
      color: TEXT_FAINT, fontSize: '10px',
      letterSpacing: '0.22em', textAlign: 'center',
      padding: '40px 0', margin: 'auto',
    } as Partial<CSSStyleDeclaration>);
    card.appendChild(hint);
    col.appendChild(card);
    return col;
  }

  const item = selection.item;

  // Top row: small thumbnail + name+meta side-by-side.
  const top = document.createElement('div');
  Object.assign(top.style, {
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px',
    alignItems: 'center',
  } as Partial<CSSStyleDeclaration>);

  const thumb = document.createElement('div');
  Object.assign(thumb.style, {
    width: '50px', height: '50px',
    background: 'rgba(20, 14, 10, 0.7)',
    border: `1.5px solid ${hexCss(RARITY_COLORS[item.rarity ?? 'mundane'])}`,
    borderRadius: '3px',
    boxShadow: `0 0 8px ${hexCss(RARITY_COLORS[item.rarity ?? 'mundane'])}55`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = getItemThumbnail(item);
  Object.assign(img.style, {
    width: '100%', height: '100%',
    objectFit: 'contain', imageRendering: 'pixelated',
  } as Partial<CSSStyleDeclaration>);
  thumb.appendChild(img);

  top.append(thumb, buildDetailsHeader(item));
  card.appendChild(top);

  const flavor = buildFlavorLine(item);
  if (flavor) card.appendChild(flavor);

  // Rolled affixes are tracked per equipped slot (the bag doesn't carry
  // instance data in V1), so we can only show them for a 'slot' selection.
  const slotAffixes = selection.kind === 'slot' ? getSlotAffixes(selection.slotId) : [];
  for (const line of describeItem(item, slotAffixes)) card.appendChild(line);

  // Spacer + action at the bottom. Pinning the button to the bottom of
  // the column means it's always in the same place (predictable target).
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  card.appendChild(spacer);

  card.appendChild(buildDetailsAction(selection, ctx));
  col.appendChild(card);
  return col;
}

function buildDetailsHeader(item: ItemSpec): HTMLDivElement {
  // Stacked vertical: rarity·kind meta on top, name underneath. Sits
  // beside the thumbnail in the narrow details column.
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', flexDirection: 'column', gap: '2px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  const rarity = item.rarity ?? 'mundane';
  const rarityHex = hexCss(RARITY_COLORS[rarity]);

  const meta = document.createElement('div');
  meta.textContent = `${rarity.toUpperCase()} · ${item.kind.toUpperCase()}`;
  Object.assign(meta.style, {
    fontSize: '9px', color: TEXT_DIM, letterSpacing: '0.22em',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);

  const name = document.createElement('div');
  name.textContent = item.name;
  Object.assign(name.style, {
    fontSize: '13px', color: rarityHex,
    fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic',
    fontWeight: '500', lineHeight: '1.2',
  } as Partial<CSSStyleDeclaration>);

  wrap.append(meta, name);
  return wrap;
}

/** Italic in-world flavor line — rendered between the header row and the effects bullets. */
function buildFlavorLine(item: ItemSpec): HTMLDivElement | null {
  if (!item.flavor) return null;
  const flavor = document.createElement('div');
  flavor.textContent = item.flavor;
  Object.assign(flavor.style, {
    fontSize: '11px', color: TEXT_DIM, fontStyle: 'italic',
    fontFamily: 'Georgia, "Times New Roman", serif',
    lineHeight: '1.3',
    borderTop: '1px solid rgba(120, 90, 60, 0.3)', paddingTop: '4px',
  } as Partial<CSSStyleDeclaration>);
  return flavor;
}

function buildDetailsAction(sel: NonNullable<Selection>, ctx: InventoryCtx): HTMLButtonElement {
  const btn = document.createElement('button');
  let label: string;
  let onClick: () => void;

  if (sel.kind === 'bag') {
    if (sel.item.kind === 'consumable') {
      label = 'USE';
      onClick = () => {
        const item = sel.item;
        if (item.consumableHeal != null) {
          if (getPlayerHp() < getPlayerMaxHp()) {
            healPlayer(item.consumableHeal);
            playHealSlurp();
            removeItem(item.id);
          }
        } else if (item.consumableBuff) {
          const player = get('player');
          if (player) applyBuff(player, item.consumableBuff.buffId, item.consumableBuff.duration);
          playBuffApply();
          removeItem(item.id);
        }
        ctx.select(null);
      };
    } else {
      label = 'EQUIP';
      onClick = () => {
        const item = sel.item;
        const previous = equipFromInventory(item);
        removeItem(item.id);
        if (previous) addItemSilently(previous.id);
        playEquipClick();
        ctx.select(null);
      };
    }
  } else {
    // sel.kind === 'slot'
    if (sel.slotId === 'weapon') {
      label = 'WEAPON LOCKED';
      onClick = () => {};
    } else {
      label = 'UNEQUIP';
      onClick = () => {
        const unequipped = unequipSlot(sel.slotId);
        if (unequipped) addItemSilently(unequipped.id);
        playEquipClick();
        ctx.select(null);
      };
    }
  }

  btn.textContent = label;
  Object.assign(btn.style, {
    width: '100%',
    padding: '12px 14px',
    background: label === 'WEAPON LOCKED' ? 'rgba(60, 40, 20, 0.4)' : 'rgba(160, 90, 40, 0.85)',
    border: label === 'WEAPON LOCKED' ? '1px solid rgba(120, 80, 50, 0.3)' : '1px solid rgba(255, 200, 120, 0.85)',
    borderRadius: '3px',
    color: 'rgba(255, 235, 210, 0.97)',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.25em',
    cursor: label === 'WEAPON LOCKED' ? 'default' : 'pointer',
    opacity: label === 'WEAPON LOCKED' ? '0.5' : '1',
    touchAction: 'manipulation',
    boxShadow: label === 'WEAPON LOCKED' ? 'none' : '0 0 12px rgba(255, 160, 80, 0.4)',
  } as Partial<CSSStyleDeclaration>);
  if (label !== 'WEAPON LOCKED') {
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  return btn;
}

// Turn an ItemSpec into a list of human-readable description lines.
function describeItem(item: ItemSpec, affixes: readonly AffixInstance[] = []): HTMLDivElement[] {
  const lines: HTMLDivElement[] = [];

  if (item.weapon) {
    lines.push(detailLine(formatWeapon(item.weapon)));
    if (item.weapon.onHit) lines.push(detailLine(formatOnHit(item.weapon.onHit)));
  }
  if (item.modifiers && item.modifiers.length) {
    for (const m of item.modifiers) lines.push(detailLine(formatModifier(m)));
  }
  // Rolled affixes (equipped items only) — show each rolled bonus so a
  // "searing" / "venom-etched" weapon's behavioral on-hit is visible, not
  // just baked invisibly into the stats. Suffix labels which affix it is.
  for (const a of affixes) {
    for (const m of a.modifiers) lines.push(detailLine(`${formatModifier(m)}  · ${a.suffix}`));
    if (a.onHit) lines.push(detailLine(`${formatOnHit(a.onHit)}  · ${a.suffix}`));
  }
  if (item.passives && item.passives.length) {
    for (const p of item.passives) lines.push(detailLine(formatPassive(p)));
  }
  if (item.consumableHeal != null) {
    lines.push(detailLine(`Restores ${item.consumableHeal} HP`));
  }
  if (item.consumableBuff) {
    const spec = BUFFS[item.consumableBuff.buffId];
    const buffDesc = spec
      ? formatBuffEffect(spec.id, item.consumableBuff.duration)
      : item.consumableBuff.buffId;
    lines.push(detailLine(`On use: ${buffDesc}`));
  }
  // Set membership — show the set name, current equipped count, and each
  // tier's bonus, dimming tiers not yet met. Lets the player SEE why
  // keeping a matched piece over a strictly-better loose drop pays off.
  if (item.setId) {
    const set = SETS[item.setId];
    if (set) {
      const have = countEquippedInSet(item.setId);
      lines.push(detailLine(`${set.name}  (${have} worn)`));
      for (const b of set.bonuses) {
        lines.push(detailLine(formatSetBonus(b), /*dim*/ have < b.pieces));
      }
    }
  }
  if (lines.length === 0) {
    lines.push(detailLine('No effects.', /*dim*/ true));
  }
  return lines;
}

/** How many currently-equipped items belong to the given set. */
function countEquippedInSet(setId: string): number {
  let n = 0;
  for (const slot of Object.values(getEquipment())) {
    if (slot?.setId === setId) n++;
  }
  return n;
}

function detailLine(text: string, dim = false): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = '· ' + text;
  Object.assign(el.style, {
    fontSize: '12px',
    color: dim ? TEXT_DIM : TEXT_PRIMARY,
    letterSpacing: '0.04em',
    lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>);
  return el;
}
