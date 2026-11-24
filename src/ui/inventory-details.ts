import { equipFromInventory, unequipSlot, getEquipment, getSlotAffixes } from '../player/equipment';
import { addItemSilently, removeItem } from '../player/inventory';
import { getPlayerHp, getPlayerMaxHp, healPlayer } from '../player/health';
import { getFlask, addCharges, addCapacity } from '../player/flask';
import { ITEMS, RARITY_COLORS, type ItemSpec, type WeaponClass } from '../content/items';
import { getReliquary } from '../player/reliquary';
import type { AffixInstance } from '../content/affixes';
import { SETS } from '../content/sets';
import { BUFFS } from '../content/buffs';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { itemImageUrl } from './item-thumbnail';
import { playEquipClick, playHealSlurp, playBuffApply, playFlaskUncork } from '../audio/sfx';
import { formatModifier, formatPassive, formatBuffEffect, formatOnHit, formatSetBonus, formatCombatVerb, formatChargedEffect } from './item-format';
import { statModifierIcon, statIconEl } from './stat-icons';
import { domainVisual, domainIconEl, CURSED_VISUAL } from './domain-icons';
import { itemFraming, applyDomainFrame } from './item-framing';
import type { StatModifier } from '../combat/modifiers';
import { resolveWeaponStats, STAGGER_POWER_BY_CLASS, weaponScalingSummary } from '../content/weapon-classes';
import { getDomain } from '../content/domains';
import { getCharacter, proficiencyTier } from '../state/character';
import { hexCss } from '../style/color-utils';
import { FONT_TITLE, FONT_DISPLAY } from './theme';
import { injectKitStyles } from './kit/style';
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
    display: 'flex', flexDirection: 'column', minWidth: '0', minHeight: '0',
  } as Partial<CSSStyleDeclaration>);

  // The scorched slab (docs/UI-SYSTEM.md, Lamplight), filled in the draft's
  // grammar: what it is (and that you wear it), its art and name burnt in,
  // its flavour, an ember rule, the numbers in one line, what it does as lit
  // bars, and the one thing you can do with it at the bottom right.
  injectKitStyles();
  const card = document.createElement('div');
  card.className = 'lk-detail';
  Object.assign(card.style, {
    flex: '1', minHeight: '0', padding: '16px 18px',
    display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const selection = ctx.selection;
  if (!selection) {
    const hint = document.createElement('div');
    hint.className = 'lk-d-note';
    hint.textContent = 'Choose something to read it.';
    Object.assign(hint.style, { margin: 'auto', textAlign: 'center' } as Partial<CSSStyleDeclaration>);
    card.appendChild(hint);
    col.appendChild(card);
    return col;
  }

  const item = selection.item;
  const rarity = item.rarity ?? 'mundane';

  // What it is: rarity in its colour · kind · the domain's carved mark and name.
  const kind = document.createElement('div');
  kind.className = 'lk-d-kind';
  const r = document.createElement('span');
  r.textContent = rarity;
  r.style.color = rarity === 'cursed' ? CURSED_VISUAL.color : hexCss(RARITY_COLORS[rarity]);
  kind.append(r, ` · ${item.kind}`);
  if (item.domain && rarity !== 'cursed') {
    const dv = domainVisual(item.domain);
    kind.append(' · ', domainIconEl(dv, 12));
    const d = document.createElement('span');
    d.textContent = dv.label;
    d.style.color = dv.color;
    kind.appendChild(d);
  }
  if (selection.kind === 'slot') {
    const eq = document.createElement('span');
    eq.className = 'eq';
    eq.textContent = 'worn';
    kind.appendChild(eq);
  }
  card.appendChild(kind);

  // Its art beside its name, the name burnt in.
  const head = document.createElement('div');
  head.className = 'lk-d-head';
  const img = document.createElement('img');
  img.src = itemImageUrl(item);
  img.alt = '';
  const name = document.createElement('div');
  name.className = 'lk-d-name lk-burn';
  name.textContent = item.name;
  head.append(img, name);
  card.appendChild(head);

  if (item.flavor) {
    const flavor = document.createElement('div');
    flavor.className = 'lk-ash';
    flavor.textContent = item.flavor;
    Object.assign(flavor.style, {
      font: `italic 17px/1.4 ${FONT_DISPLAY}`, color: '#f1dcc2',
    } as Partial<CSSStyleDeclaration>);
    card.appendChild(flavor);
  }
  const rule = document.createElement('div');
  rule.className = 'lk-d-rule';
  card.appendChild(rule);

  // A weapon's numbers in one line, then what the hand has learned of it.
  if (item.weapon) {
    card.appendChild(buildWeaponStatLine(item));
    card.appendChild(buildTierBar(item.weapon.class ?? 'sword'));
  }

  // What it does, as lit bars.
  const fx = document.createElement('div');
  fx.className = 'lk-d-fx';
  // Rolled affixes are tracked per equipped slot (the bag doesn't carry
  // instance data in V1), so we can only show them for a 'slot' selection.
  const slotAffixes = selection.kind === 'slot' ? getSlotAffixes(selection.slotId) : [];
  for (const line of describeItem(item, slotAffixes, { weaponStats: false })) {
    // A bar needs no list dot; a weapon's numbers already say it does something.
    const t = line.firstChild;
    if (t && t.nodeType === Node.TEXT_NODE && t.textContent?.startsWith('· ')) t.textContent = t.textContent.slice(2);
    if (item.weapon && line.textContent === 'No effects.') continue;
    fx.appendChild(line);
  }
  if (fx.childElementCount) card.appendChild(fx);

  // The one thing you can do with it, bottom right: always the same place.
  card.appendChild(buildDetailsAction(selection, ctx));

  // Its domain only tints the slab's edge; the slab keeps its own light.
  const framing = itemFraming(item);
  if (framing) applyDomainFrame(card, framing, { chromeOnly: true, intensity: 0.6 });

  col.appendChild(card);
  return col;
}

/** A weapon's numbers in one line (the draft): value then name, with what
 *  YOU bring over the item's base (mastery) as a gold +bonus. */
function buildWeaponStatLine(item: ItemSpec): HTMLDivElement {
  const w = item.weapon!;
  const cls = w.class ?? 'sword';
  const r = resolveWeaponStats(w);
  const ranged = !!w.ranged;
  const trim = (n: number): string => n.toFixed(1).replace(/\.0$/, '');
  const line = document.createElement('div');
  line.className = 'lk-d-stats';
  const stat = (label: string, base: number, bonus: number, fmt: (n: number) => string): void => {
    const s = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = fmt(base);
    if (bonus > 0.05) { const e = document.createElement('em'); e.textContent = `+${fmt(bonus)}`; b.appendChild(e); }
    const i = document.createElement('i');
    i.textContent = label;
    s.append(b, i);
    line.appendChild(s);
  };
  stat('damage', w.damage, r.damage - w.damage, trim);
  const baseCrit = w.critChance ?? 0.05;
  stat('crit', baseCrit * 100, (r.critChance - baseCrit) * 100, (n) => `${Math.round(n)}%`);
  if (!ranged) {
    const baseStagger = w.staggerPower ?? STAGGER_POWER_BY_CLASS[cls];
    stat('stagger', baseStagger, r.staggerPower - baseStagger, trim);
  }
  const baseReach = w.reach ?? r.reach;
  stat(ranged ? 'range' : 'reach', baseReach, r.reach - baseReach, (n) => `${trim(n)} m`);
  // Only Lore can still rise (reading notes); nothing grants Might or Finesse
  // any more, so "Scales with Might B" promised a growth that never comes.
  const scaling = weaponScalingSummary(w);
  if (/Lore/.test(scaling)) {
    const sc = document.createElement('span');
    const i = document.createElement('i');
    i.textContent = `scales ${scaling}`;
    sc.appendChild(i);
    line.appendChild(sc);
  }
  return line;
}


export function buildDetailsHeader(item: ItemSpec): HTMLDivElement {
  // Stacked vertical: rarity·kind meta on top, name underneath. Sits
  // beside the thumbnail in the narrow details column.
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', flexDirection: 'column', gap: '2px',
    minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  const rarity = item.rarity ?? 'mundane';
  const rarityHex = hexCss(RARITY_COLORS[rarity]);

  // Meta line, now in the shared VISUAL LANGUAGE: rarity in its rarity colour
  // (cursed gets the violet chaos-mark + label — "something is wrong with this"),
  // kind, then the domain as its icon + name in the domain's register colour.
  // One coherent legend across type / rarity / domain.
  const meta = document.createElement('div');
  Object.assign(meta.style, {
    display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap',
    fontSize: '9px', color: TEXT_DIM, letterSpacing: '0.20em', minWidth: '0',
  } as Partial<CSSStyleDeclaration>);
  if (rarity === 'cursed') {
    meta.appendChild(domainIconEl(CURSED_VISUAL, 11));
    const r = document.createElement('span');
    r.textContent = 'CURSED';
    r.style.color = CURSED_VISUAL.color;
    r.style.fontWeight = '700';
    meta.appendChild(r);
  } else {
    const r = document.createElement('span');
    r.textContent = rarity.toUpperCase();
    r.style.color = rarityHex;
    meta.appendChild(r);
  }
  const kindEl = document.createElement('span');
  kindEl.textContent = `· ${item.kind.toUpperCase()}`;
  meta.appendChild(kindEl);
  if (item.domain) {
    const dv = domainVisual(item.domain);
    const sep = document.createElement('span'); sep.textContent = '·';
    meta.appendChild(sep);
    meta.appendChild(domainIconEl(dv, 11));
    const d = document.createElement('span');
    d.textContent = dv.label.toUpperCase();
    d.style.color = dv.color;
    meta.appendChild(d);
  }

  const name = document.createElement('div');
  name.textContent = item.name;
  name.className = 'lk-burn';
  Object.assign(name.style, {
    fontSize: '16px', color: rarityHex,
    fontFamily: FONT_TITLE, fontWeight: '600', letterSpacing: '0.03em', lineHeight: '1.2',
    textShadow: '0 0 12px rgba(255, 168, 88, 0.25)',
  } as Partial<CSSStyleDeclaration>);

  wrap.append(meta, name);
  return wrap;
}

/** Italic in-world flavor line — rendered between the header row and the effects bullets. */
export function buildFlavorLine(item: ItemSpec): HTMLDivElement | null {
  if (!item.flavor) return null;
  const flavor = document.createElement('div');
  flavor.textContent = item.flavor;
  flavor.className = 'lk-ash';
  Object.assign(flavor.style, {
    fontSize: '14px', color: 'rgba(234, 210, 180, 0.95)', fontStyle: 'italic',
    fontFamily: FONT_DISPLAY,
    lineHeight: '1.35',
    paddingBottom: '8px',
    backgroundImage: 'linear-gradient(90deg, rgba(140, 80, 40, 0), rgba(140, 80, 40, 0.75) 18%, rgba(140, 80, 40, 0.75) 82%, rgba(140, 80, 40, 0))',
    backgroundSize: '100% 1px', backgroundRepeat: 'no-repeat', backgroundPosition: 'bottom',
  } as Partial<CSSStyleDeclaration>);
  return flavor;
}

function buildDetailsAction(sel: NonNullable<Selection>, ctx: InventoryCtx): HTMLElement {
  // Relics have NO action — they are permanent. The line states the rule
  // instead of offering a dead button.
  if (sel.kind === 'relic') {
    const kept = document.createElement('div');
    kept.className = 'lk-d-note';
    kept.textContent = 'Kept. What is taken is not returned.';
    Object.assign(kept.style, { marginTop: 'auto', textAlign: 'right' } as Partial<CSSStyleDeclaration>);
    return kept;
  }

  const btn = document.createElement('button');
  let label: string;
  let onClick: () => void;

  if (sel.kind === 'bag') {
    if (sel.item.kind === 'consumable') {
      label = 'USE';
      onClick = () => {
        const item = sel.item;
        if (item.consumableFlaskCharges != null) {
          // Draught — pours into the flask; withheld when it's already full.
          const { charges, capacity } = getFlask();
          if (charges < capacity) {
            addCharges(item.consumableFlaskCharges);
            playFlaskUncork();
            removeItem(item.id);
          }
        } else if (item.consumableFlaskCapacity != null) {
          // Shard — fused into the flask, the new charge arrives filled.
          addCapacity(item.consumableFlaskCapacity, true);
          playBuffApply();
          removeItem(item.id);
        } else if (item.consumableHeal != null) {
          if (getPlayerHp() < getPlayerMaxHp()) {
            healPlayer(item.consumableHeal, 'passive');   // item heal — a TRANSFORM may suppress it
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
  btn.type = 'button';
  const inert = label === 'WEAPON LOCKED';
  btn.className = inert ? 'lk-d-act inert' : 'lk-d-act';
  if (!inert) {
    btn.dataset.focus = '';
    btn.dataset.fkey = `act:${label}`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  } else {
    btn.disabled = true;
  }
  return btn;
}

// Turn an ItemSpec into a list of human-readable description lines.
export function describeItem(
  item: ItemSpec,
  affixes: readonly AffixInstance[] = [],
  /** weaponStats: false when the caller draws the numbers itself (the satchel
   *  slab's one-line stats); the verbs below still describe. */
  opts: { weaponStats?: boolean } = {},
): HTMLDivElement[] {
  const lines: HTMLDivElement[] = [];

  if (item.weapon) {
    // Resolved-vs-base stat rows: what YOU bring (proficiency + Might/
    // Finesse/Lore) is tinted gold over the item's white base — "this is
    // bigger because you're good with its class." Plus the class tier bar.
    if (opts.weaponStats !== false) lines.push(...buildWeaponStats(item));
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
    for (const m of item.modifiers) lines.push(modifierLine(m));
  }
  // Conditional modifiers — the berserker / last-stand fantasy ("Below 30%
  // HP: +1 Damage"). Prefix each block with its HP condition so the trade is
  // legible.
  if (item.conditionalModifiers && item.conditionalModifiers.length) {
    for (const block of item.conditionalModifiers) {
      const c = block.condition;
      const pct = Math.round(c.value * 100);
      const cond = c.kind === 'below-hp-pct' ? `Below ${pct}% HP` : `Above ${pct}% HP`;
      for (const m of block.modifiers) lines.push(modifierLine(m, `${cond}: `));
    }
  }
  // Rolled affixes (equipped items only) — show each rolled bonus so a
  // "searing" / "venom-etched" weapon's behavioral on-hit is visible, not
  // just baked invisibly into the stats. Suffix labels which affix it is.
  for (const a of affixes) {
    for (const m of a.modifiers) lines.push(modifierLine(m, '', `  · ${a.suffix}`));
    if (a.onHit) lines.push(detailLine(`${formatOnHit(a.onHit)}  · ${a.suffix}`));
  }
  if (item.passives && item.passives.length) {
    for (const p of item.passives) lines.push(detailLine(formatPassive(p)));
  }
  if (item.consumableHeal != null) {
    lines.push(detailLine(`Restores ${item.consumableHeal} HP`));
  }
  if (item.consumableFlaskCharges != null) {
    lines.push(detailLine(`Refills ${item.consumableFlaskCharges} flask charge${item.consumableFlaskCharges > 1 ? 's' : ''}`));
  }
  if (item.consumableFlaskCapacity != null) {
    lines.push(detailLine(`The flask holds ${item.consumableFlaskCapacity} more, forever`));
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
      const total = Object.values(ITEMS).filter((i) => i.setId === item.setId).length;
      lines.push(detailLine(`${set.name} · ${have} of ${total} gathered`));
      // Whose these were — the provenance line under the set name.
      if (set.owner) lines.push(detailLine(set.owner, /*dim*/ true));
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

/** How many pieces of the set the player holds — equipped gear plus
 *  DISTINCT relics in the reliquary (duplicates never advance a set). */
function countEquippedInSet(setId: string): number {
  let n = 0;
  for (const slot of Object.values(getEquipment())) {
    if (slot?.setId === setId) n++;
  }
  const seen = new Set<string>();
  for (const r of getReliquary()) {
    if (r.spec.setId === setId && !seen.has(r.spec.id)) {
      seen.add(r.spec.id);
      n++;
    }
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
  // Only Lore can still rise (reading notes); nothing grants Might or Finesse
  // any more, so "Scales with Might B" promised a growth that never comes.
  const scaling = weaponScalingSummary(w);
  if (/Lore/.test(scaling)) {
    const scaleRow = detailLine(`Scales ${scaling}`, /*dim*/ true);
    scaleRow.style.marginTop = '2px';
    out.push(scaleRow);
  }

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

/** What the hand has learned of this class: tier, progress as an ember bar. */
function buildTierBar(cls: WeaponClass): HTMLDivElement {
  const pts = getCharacter().proficiencies[cls];
  const tier = proficiencyTier(pts);
  const clsName = cls.charAt(0).toUpperCase() + cls.slice(1).replace('-', ' ');

  const wrap = document.createElement('div');
  const label = document.createElement('div');
  Object.assign(label.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    font: '11px/1.3 system-ui, sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px',
  } as Partial<CSSStyleDeclaration>);
  const left = document.createElement('span');
  left.style.color = '#a88c6c';
  left.append(`${clsName} · `);
  const t = document.createElement('span');
  t.textContent = tier.name;
  Object.assign(t.style, { color: MASTERY_GOLD, fontWeight: '700' } as Partial<CSSStyleDeclaration>);
  left.appendChild(t);
  const right = document.createElement('span');
  right.textContent = tier.nextAt === null ? 'mastered' : `${pts} of ${tier.nextAt}`;
  right.style.color = TEXT_FAINT;
  label.append(left, right);

  const track = document.createElement('div');
  track.className = 'lk-ember';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(tier.progress * 100)}%`;
  track.appendChild(fill);
  wrap.append(label, track);
  return wrap;
}

function detailLine(text: string, dim = false): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = '· ' + text;
  if (dim) el.classList.add('dim');
  Object.assign(el.style, {
    fontSize: '12px',
    color: dim ? TEXT_DIM : TEXT_PRIMARY,
    letterSpacing: '0.04em',
    lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>);
  return el;
}

/** A stat-modifier line led by its CATEGORY ICON (heart/blade/shield/…) instead
 *  of a bare bullet, so life/damage/armour read at a glance. `prefix` carries a
 *  condition tag ("Below 30% HP: "); `suffix` an affix label. */
function modifierLine(m: StatModifier, prefix = '', suffix = ''): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '5px',
    fontSize: '12px', color: TEXT_PRIMARY, letterSpacing: '0.04em', lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(statIconEl(statModifierIcon(m.kind)));
  const text = document.createElement('span');
  text.textContent = prefix + formatModifier(m) + suffix;
  row.appendChild(text);
  return row;
}
