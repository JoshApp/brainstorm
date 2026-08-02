import { getEquipment, getSidearm, swapWeapons, type EquipSlot } from '../player/equipment';
import { getReliquary } from '../player/reliquary';
import { getEquippedRite, equipRite } from '../state/run-state';
import { RITES } from '../content/rites';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from '../style/color-utils';
import { EMPTY_BORDER, ACCENT, TEXT_DIM, CARD_BG, sectionLabel, type InventoryCtx } from './inventory-shared';

// EQUIPPED — three clear gear-slot TILES in a row (weapon · vestment · off-hand),
// not an anatomical paper-doll. With only three slots the figure was more murk
// than signal; a labelled tile strip reads instantly and leaves room for the bag.
// A filled tile shows the item thumbnail + rarity border; an empty one shows a
// slot-type glyph. Tapping a filled tile selects it (details / unequip).

type SlotDef = { slotId: EquipSlot; label: string };

// Gear slots, grouped by how they're worn (see buildEquippedSlots):
//   ARMS — both weapons (drawn + sidearm) side by side, the OFF-HAND beneath.
//   WORN — the two vestments (build-defining worn pieces) together on the right.
const WEAPON_SLOT:  SlotDef = { slotId: 'weapon',    label: 'WEAPON' };
const OFFHAND_SLOT: SlotDef = { slotId: 'offhand',   label: 'OFF-HAND' };
const VEST_SLOTS: SlotDef[] = [
  { slotId: 'vestment',  label: 'VESTMENT I' },
  { slotId: 'vestment2', label: 'VESTMENT II' },
];

// Slot-type glyph for an EMPTY slot — reads at a glance. 16px viewBox, stroked.
const VESTMENT_GLYPH = '<path d="M5 2 L8 4 L11 2 L13.5 4.5 L11.5 6.5 L11.5 14 L4.5 14 L4.5 6.5 L2.5 4.5 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>';
const SLOT_ICON: Record<EquipSlot, string> = {
  weapon: '<path d="M8 1.5 L8 10 M5.5 10 L10.5 10 M8 10 L8 14.5 M6.5 13 L9.5 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  vestment: VESTMENT_GLYPH,
  vestment2: VESTMENT_GLYPH,
  offhand: '<path d="M8 1.5 L13.5 3.5 L13.5 8 Q13.5 12.5 8 14.5 Q2.5 12.5 2.5 8 L2.5 3.5 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
};

/** The EQUIPPED slots — two grouped panels: ARMS (both weapons over the off-hand)
 *  on the left, WORN (the two vestments) on the right. The grouping reads the way
 *  the loadout is used — your hands vs. what you wear — instead of a flat strip. */
export function buildEquippedSlots(ctx: InventoryCtx): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, { display: 'flex', flexDirection: 'column', gap: '6px' } as Partial<CSSStyleDeclaration>);
  col.appendChild(sectionLabel('EQUIPPED'));

  const eq = getEquipment();
  const panels = document.createElement('div');
  Object.assign(panels.style, {
    display: 'grid', gridTemplateColumns: '1.08fr 1fr', gap: '10px', alignItems: 'center',
  } as Partial<CSSStyleDeclaration>);

  // ── ARMS — both weapons in a row, the off-hand beneath them. ──
  const arms = groupPanel('ARMS');
  const wpnRow = twoColRow();
  wpnRow.appendChild(buildSlotTile(WEAPON_SLOT, eq.weapon, ctx));   // drawn
  wpnRow.appendChild(buildSidearmTile(ctx));                        // sheathed
  arms.appendChild(wpnRow);
  arms.appendChild(buildSlotTile(OFFHAND_SLOT, eq.offhand, ctx));   // full-width beneath

  // ── WORN — the two vestments side by side. ──
  const worn = groupPanel('WORN');
  const vestRow = twoColRow();
  for (const def of VEST_SLOTS) vestRow.appendChild(buildSlotTile(def, eq[def.slotId], ctx));
  worn.appendChild(vestRow);

  panels.append(arms, worn);
  col.appendChild(panels);
  return col;
}

/** A labelled sub-group (ARMS / WORN) — a faint caption over a stack of tiles. */
function groupPanel(caption: string): HTMLDivElement {
  const p = document.createElement('div');
  Object.assign(p.style, { display: 'flex', flexDirection: 'column', gap: '6px' } as Partial<CSSStyleDeclaration>);
  const cap = document.createElement('div');
  cap.textContent = caption;
  Object.assign(cap.style, {
    fontSize: '8px', letterSpacing: '0.24em', color: TEXT_DIM, fontWeight: '600', paddingLeft: '1px',
  } as Partial<CSSStyleDeclaration>);
  p.appendChild(cap);
  return p;
}

/** A two-column tile row (weapons; vestments). */
function twoColRow(): HTMLDivElement {
  const r = document.createElement('div');
  Object.assign(r.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' } as Partial<CSSStyleDeclaration>);
  return r;
}

/** The SIDEARM tile — the sheathed second weapon of the loadout (task #96).
 *  Shows it beside the drawn weapon; tapping SWAPS the two (draws the sidearm),
 *  the same one-tap swap as the HUD chip. Empty when you carry only one weapon. */
function buildSidearmTile(ctx: InventoryCtx): HTMLDivElement {
  const item = getSidearm();
  const tile = document.createElement('div');
  const filled = !!item;
  const rarityHex = item ? hexCss(RARITY_COLORS[item.rarity ?? 'mundane']) : null;
  Object.assign(tile.style, {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    padding: '7px 4px 5px', borderRadius: '4px', cursor: filled ? 'pointer' : 'default',
    position: 'relative',
    background: filled ? CARD_BG : 'rgba(20, 14, 10, 0.45)',
    border: filled ? `1.5px solid ${rarityHex}` : EMPTY_BORDER,
    boxShadow: filled ? `0 0 7px ${rarityHex}44` : 'none',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);

  const face = document.createElement('div');
  Object.assign(face.style, { width: '100%', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '0' } as Partial<CSSStyleDeclaration>);
  if (filled && item) {
    const img = document.createElement('img');
    img.src = getItemThumbnail(item);
    Object.assign(img.style, { width: '92%', height: '92%', objectFit: 'contain', pointerEvents: 'none', opacity: '0.9' } as Partial<CSSStyleDeclaration>);
    face.appendChild(img);
    // A ⇄ swap hint in the corner.
    const swap = document.createElement('div');
    swap.textContent = '⇄';
    Object.assign(swap.style, { position: 'absolute', top: '3px', right: '5px', fontSize: '11px', color: ACCENT, opacity: '0.85' } as Partial<CSSStyleDeclaration>);
    tile.appendChild(swap);
  } else {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('width', '26'); icon.setAttribute('height', '26');
    icon.innerHTML = SLOT_ICON.weapon;
    icon.style.color = TEXT_DIM; icon.style.opacity = '0.5';
    face.appendChild(icon);
  }
  tile.appendChild(face);

  const label = document.createElement('div');
  label.textContent = filled ? 'SIDEARM · SWAP' : 'SIDEARM';
  Object.assign(label.style, {
    fontSize: '7.5px', fontWeight: '600', letterSpacing: '0.10em',
    color: filled ? rarityHex! : TEXT_DIM, textAlign: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
  } as Partial<CSSStyleDeclaration>);
  tile.appendChild(label);

  if (filled) {
    tile.addEventListener('click', (e) => { e.stopPropagation(); swapWeapons(); ctx.select(null); });
  }
  return tile;
}

function buildSlotTile(def: SlotDef, item: ItemSpec | null, ctx: InventoryCtx): HTMLDivElement {
  const tile = document.createElement('div');
  const filled = !!item;
  const rarityHex = item ? hexCss(RARITY_COLORS[item.rarity ?? 'mundane']) : null;
  const selected = ctx.selection?.kind === 'slot' && ctx.selection.slotId === def.slotId;

  Object.assign(tile.style, {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    padding: '7px 4px 5px', borderRadius: '4px', cursor: 'pointer',
    background: filled ? CARD_BG : 'rgba(20, 14, 10, 0.45)',
    border: selected ? `2px solid ${ACCENT}` : filled ? `1.5px solid ${rarityHex}` : EMPTY_BORDER,
    boxShadow: selected ? `0 0 12px ${ACCENT}` : filled ? `0 0 7px ${rarityHex}44` : 'none',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);

  // The thumbnail / glyph area — a fixed compact height so all three tiles align
  // AND the left column stays short enough that the rite + reliquary sit above
  // the fold on a landscape phone.
  const face = document.createElement('div');
  Object.assign(face.style, {
    width: '100%', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '0',
  } as Partial<CSSStyleDeclaration>);
  if (filled && item) {
    const img = document.createElement('img');
    img.src = getItemThumbnail(item);
    Object.assign(img.style, { width: '92%', height: '92%', objectFit: 'contain', pointerEvents: 'none' } as Partial<CSSStyleDeclaration>);
    face.appendChild(img);
  } else {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('width', '26'); icon.setAttribute('height', '26');
    icon.innerHTML = SLOT_ICON[def.slotId];
    icon.style.color = TEXT_DIM; icon.style.opacity = '0.7';
    face.appendChild(icon);
  }
  tile.appendChild(face);

  const label = document.createElement('div');
  label.textContent = def.label;
  Object.assign(label.style, {
    fontSize: '7.5px', fontWeight: '600', letterSpacing: '0.12em',
    color: filled ? rarityHex! : TEXT_DIM, textAlign: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
  } as Partial<CSSStyleDeclaration>);
  tile.appendChild(label);

  tile.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.select(item && !selected ? { kind: 'slot', slotId: def.slotId, item } : null);
  });
  return tile;
}

// The rite picker defaults COLLAPSED — the doll column was a wall of every-rite
// chips even though only ONE is active. Collapsed shows the equipped rite as a
// single line; tapping reveals the full chip list. Module-level so the state
// survives the panel's rebuild-on-select.
let riteExpanded = false;

/** The RITE slot — compact by default (current rite + a change affordance),
 *  expanding to the full chip list on tap. */
export function buildRiteSlot(ctx: InventoryCtx): HTMLDivElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '5px' } as Partial<CSSStyleDeclaration>);
  const equipped = getEquippedRite();
  const spec = equipped ? RITES[equipped] : undefined;

  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' } as Partial<CSSStyleDeclaration>);
  head.appendChild(sectionLabel('RITE · THE ACTIVE'));
  const toggle = document.createElement('button');
  toggle.textContent = riteExpanded ? 'done' : 'change';
  Object.assign(toggle.style, {
    fontSize: '9px', letterSpacing: '0.14em', padding: '2px 6px', borderRadius: '3px',
    border: '1px solid rgba(80,60,40,0.4)', background: 'transparent', color: TEXT_DIM,
    cursor: 'pointer', touchAction: 'manipulation', flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  toggle.addEventListener('click', (e) => { e.stopPropagation(); riteExpanded = !riteExpanded; ctx.select(ctx.selection); });
  head.appendChild(toggle);
  wrap.appendChild(head);

  if (riteExpanded) {
    const chips = document.createElement('div');
    Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' } as Partial<CSSStyleDeclaration>);
    for (const s of Object.values(RITES)) {
      const isOn = s.id === equipped;
      const chip = document.createElement('button');
      chip.textContent = `${s.name} · ${s.hungerCost}`;
      chip.title = s.fate;
      Object.assign(chip.style, {
        fontSize: '10px', padding: '3px 7px', borderRadius: '3px', cursor: 'pointer',
        fontFamily: 'serif', letterSpacing: '0.03em', touchAction: 'manipulation',
        border: `1px solid ${isOn ? ACCENT : 'rgba(80,60,40,0.4)'}`,
        background: isOn ? 'rgba(120,30,20,0.35)' : 'rgba(20,14,10,0.5)',
        color: isOn ? '#f0d8c0' : TEXT_DIM,
      } as Partial<CSSStyleDeclaration>);
      chip.addEventListener('click', () => { equipRite(isOn ? null : s.id); ctx.select(ctx.selection); });
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);
  } else {
    const current = document.createElement('button');
    current.textContent = spec ? `${spec.name} · ${spec.hungerCost} hunger` : 'none — the meter goes quiet';
    Object.assign(current.style, {
      textAlign: 'left', fontSize: '11px', fontFamily: 'serif', letterSpacing: '0.03em',
      padding: '5px 8px', borderRadius: '3px', cursor: 'pointer', touchAction: 'manipulation',
      border: `1px solid ${spec ? ACCENT : 'rgba(80,60,40,0.4)'}`,
      background: spec ? 'rgba(120,30,20,0.28)' : 'rgba(20,14,10,0.5)',
      color: spec ? '#f0d8c0' : TEXT_DIM,
    } as Partial<CSSStyleDeclaration>);
    current.addEventListener('click', (e) => { e.stopPropagation(); riteExpanded = true; ctx.select(ctx.selection); });
    wrap.appendChild(current);
  }

  const fate = document.createElement('div');
  fate.textContent = spec ? `"${spec.fate}"` : '';
  Object.assign(fate.style, { fontSize: '10px', fontStyle: 'italic', color: TEXT_DIM, lineHeight: '1.35' } as Partial<CSSStyleDeclaration>);
  if (spec) wrap.appendChild(fate);
  return wrap;
}

/** One-line RELIQUARY summary — count + jump to the full collection tab. */
export function buildRelicLink(ctx: InventoryCtx): HTMLButtonElement {
  const relics = getReliquary();
  const btn = document.createElement('button');
  btn.textContent = relics.length ? `RELIQUARY · ${relics.length} ›` : 'RELIQUARY · empty ›';
  Object.assign(btn.style, {
    minHeight: '32px', padding: '6px 10px',
    fontSize: '10px', letterSpacing: '0.18em', textAlign: 'left',
    fontFamily: 'serif', cursor: 'pointer', borderRadius: '3px',
    border: '1px solid rgba(80,60,40,0.4)', background: 'rgba(20,14,10,0.5)',
    color: relics.length ? '#f0d8c0' : TEXT_DIM, touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  btn.addEventListener('click', (e) => { e.stopPropagation(); ctx.openReliquary?.(); });
  return btn;
}
