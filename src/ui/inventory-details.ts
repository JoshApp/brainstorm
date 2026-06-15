import { equipFromInventory, unequipSlot, getEquipment, getSlotAffixes } from '../player/equipment';
import { addItemSilently, removeItem } from '../player/inventory';
import { getPlayerHp, getPlayerMaxHp, healPlayer } from '../player/health';
import { RARITY_COLORS, type ItemSpec, type WeaponClass } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import { SETS } from '../content/sets';
import { BUFFS } from '../content/buffs';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { getItemThumbnail } from './item-thumbnail';
import { playEquipClick, playHealSlurp, playBuffApply } from '../audio/sfx';
import { formatModifier, formatPassive, formatBuffEffect, formatOnHit, formatSetBonus, formatCombatVerb, formatChargedEffect } from './item-format';
import { resolveWeaponStats, STAGGER_POWER_BY_CLASS, weaponScalingSummary } from '../content/weapon-classes';
import { getCharacter, proficiencyTier } from '../state/character';
import { hexCss } from '../style/color-utils';
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
    // Resolved-vs-base stat rows: what YOU bring (proficiency + Might/
    // Finesse/Lore) is tinted gold over the item's white base — "this is
    // bigger because you're good with its class." Plus the class tier bar.
    lines.push(...buildWeaponStats(item));
    if (item.weapon.onHit) lines.push(detailLine(formatOnHit(item.weapon.onHit)));
    // Reactive verbs + charged signature — so a duellist's blade that hastes
    // on a perfect dodge, or a hammer that fires force on a charged release,
    // actually SAYS what it does instead of hiding it in the data.
    if (item.weapon.onRiposte) lines.push(detailLine(formatCombatVerb('On riposte', item.weapon.onRiposte)));
    if (item.weapon.onPerfectDodge) lines.push(detailLine(formatCombatVerb('On perfect dodge', item.weapon.onPerfectDodge)));
    if (item.weapon.onEmpoweredHit) lines.push(detailLine(formatCombatVerb('On empowered hit', item.weapon.onEmpoweredHit)));
    if (item.weapon.chargedEffect) lines.push(detailLine(formatChargedEffect(item.weapon.chargedEffect)));
  }
  // Item-level on-hit — armour/amulets/rings that proc a status on every
  // melee swing (e.g. the Acid Tongue amulet's poison). This is SEPARATE
  // from weapon.onHit; without it, accessory procs went undescribed.
  if (item.onHit) lines.push(detailLine(formatOnHit(item.onHit)));
  if (item.modifiers && item.modifiers.length) {
    for (const m of item.modifiers) lines.push(detailLine(formatModifier(m)));
  }
  // Conditional modifiers — the berserker / last-stand fantasy ("Below 30%
  // HP: +1 Damage"). Prefix each block with its HP condition so the trade is
  // legible.
  if (item.conditionalModifiers && item.conditionalModifiers.length) {
    for (const block of item.conditionalModifiers) {
      const c = block.condition;
      const pct = Math.round(c.value * 100);
      const cond = c.kind === 'below-hp-pct' ? `Below ${pct}% HP` : `Above ${pct}% HP`;
      for (const m of block.modifiers) lines.push(detailLine(`${cond}: ${formatModifier(m)}`));
    }
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
  // Unlabelled phials — a permanent run mutation, unknown until the first
  // taste. We DON'T spoil which; we just tell the player it's a commitment,
  // not a heal (the UNKNOWN transaction family).
  if (item.consumableMutation) {
    lines.push(detailLine('On use: an unknown, permanent change', /*dim*/ true));
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

// The warm gold of the proficiency bars — "mastery" tint for any bonus
// the player brings to a weapon over its intrinsic base.
const MASTERY_GOLD = 'rgba(255, 200, 130, 0.95)';

/** Build the weapon stat rows (base + gold bonus) + the class tier bar. */
function buildWeaponStats(item: ItemSpec): HTMLDivElement[] {
  const w = item.weapon!;
  const cls = w.class ?? 'sword';
  const r = resolveWeaponStats(w);   // resolved with the CURRENT character
  const ranged = !!w.ranged;
  const out: HTMLDivElement[] = [];

  const trimNum = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  out.push(statRow('Damage', w.damage, r.damage - w.damage, trimNum));
  const baseCrit = w.critChance ?? 0.05;
  out.push(statRow('Crit', baseCrit * 100, (r.critChance - baseCrit) * 100, (n) => `${Math.round(n)}%`));
  if (!ranged) {
    const baseStagger = w.staggerPower ?? STAGGER_POWER_BY_CLASS[cls];
    out.push(statRow('Stagger', baseStagger, r.staggerPower - baseStagger, trimNum));
  }
  // Melee reach is derived from the weapon model at load, so w.reach is set; fall back to resolved.
  const baseReach = w.reach ?? r.reach;
  out.push(statRow(ranged ? 'Range' : 'Reach', baseReach, r.reach - baseReach, (n) => `${trimNum(n)}m`));

  // Which attribute powers this weapon (playtest: scaling wasn't explained).
  const scaleRow = detailLine(`Scales ${weaponScalingSummary(w)}`, /*dim*/ true);
  scaleRow.style.marginTop = '2px';
  out.push(scaleRow);

  out.push(buildTierBar(cls));
  return out;
}

/** A "Label  base  +bonus" row; the bonus (if any) reads gold. */
function statRow(label: string, base: number, bonus: number, fmt: (n: number) => string): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'baseline', gap: '8px',
    fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.04em',
  } as Partial<CSSStyleDeclaration>);
  const l = document.createElement('span');
  l.textContent = label;
  Object.assign(l.style, { color: TEXT_DIM, minWidth: '64px' } as Partial<CSSStyleDeclaration>);
  const v = document.createElement('span');
  v.textContent = fmt(base);
  v.style.color = TEXT_PRIMARY;
  row.append(l, v);
  if (bonus > 0.05) {
    const b = document.createElement('span');
    b.textContent = `+${fmt(bonus)}`;
    Object.assign(b.style, { color: MASTERY_GOLD, fontWeight: '600' } as Partial<CSSStyleDeclaration>);
    row.append(b);
  }
  return row;
}

/** Class proficiency tier line + progress bar (gold). */
function buildTierBar(cls: WeaponClass): HTMLDivElement {
  const pts = getCharacter().proficiencies[cls];
  const tier = proficiencyTier(pts);
  const clsName = cls.charAt(0).toUpperCase() + cls.slice(1);

  const wrap = document.createElement('div');
  Object.assign(wrap.style, { marginTop: '6px' } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  Object.assign(label.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: '11px', letterSpacing: '0.06em', marginBottom: '3px',
  } as Partial<CSSStyleDeclaration>);
  const left = document.createElement('span');
  left.innerHTML = `${clsName} · <span style="color:${MASTERY_GOLD};font-weight:700">${tier.name.toUpperCase()}</span>`;
  left.style.color = TEXT_DIM;
  const right = document.createElement('span');
  right.textContent = tier.nextAt === null ? 'mastered' : `${pts} → ${tier.nextAt}`;
  right.style.color = TEXT_FAINT;
  label.append(left, right);

  const track = document.createElement('div');
  Object.assign(track.style, {
    height: '4px', background: 'rgba(40, 28, 18, 0.85)', borderRadius: '2px', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    height: '100%', width: `${Math.round(tier.progress * 100)}%`,
    background: 'linear-gradient(to right, rgba(180, 130, 90, 0.95), rgba(255, 200, 130, 0.95))',
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(fill);

  wrap.append(label, track);
  return wrap;
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
