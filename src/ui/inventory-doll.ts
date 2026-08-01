import { getEquipment, type EquipSlot } from '../player/equipment';
import { getReliquary } from '../player/reliquary';
import { getEquippedRite, equipRite } from '../state/run-state';
import { RITES } from '../content/rites';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from '../style/color-utils';
import { EMPTY_BORDER, ACCENT, TEXT_DIM, sectionLabel, type InventoryCtx } from './inventory-shared';

// EQUIPPED column — anatomical paper doll. Slots are positioned around a
// hooded-figure silhouette; tapping a filled slot selects it (for unequip),
// tapping an empty one clears the selection.

type SlotDef = {
  /** Position on the doll container (percentages of container size). */
  top: string; left: string;
  /** Short label shown inside the slot when it's empty. */
  shortLabel: string;
  /** Long label shown in the details panel header. */
  longLabel: string;
  /** Active equipment slot id this position represents. */
  slotId: EquipSlot;
  /** Pixel size. */
  size: number;
};

// THREE gear slots (docs/BUILD-ECONOMY.md): the VESTMENT (one garment), the
// WEAPON, and the OFF-HAND. Relics aren't slots — they show in the reliquary row
// below (all collected, all active).
const SLOTS: SlotDef[] = [
  { slotId: 'vestment', top: '27%', left: '50%', size: 60, shortLabel: 'VEST', longLabel: 'VESTMENT' },
  { slotId: 'weapon',   top: '60%', left: '19%', size: 58, shortLabel: 'WPN',  longLabel: 'WEAPON' },
  { slotId: 'offhand',  top: '60%', left: '81%', size: 58, shortLabel: 'OFF',  longLabel: 'OFF-HAND' },
];

// A slot-type glyph shown when the slot is EMPTY — reads at a glance far better
// than a 9px "WPN"/"VEST"/"OFF" caption. Simple line icons, drawn in the dim
// slot-label colour. (16px viewBox, stroked.)
const SLOT_ICON: Record<EquipSlot, string> = {
  // A sword — point up, crossguard, grip.
  weapon: '<path d="M8 1.5 L8 10 M5.5 10 L10.5 10 M8 10 L8 14.5 M6.5 13 L9.5 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  // A tunic / vestment — shoulders + body.
  vestment: '<path d="M5 2 L8 4 L11 2 L13.5 4.5 L11.5 6.5 L11.5 14 L4.5 14 L4.5 6.5 L2.5 4.5 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  // A shield — off-hand.
  offhand: '<path d="M8 1.5 L13.5 3.5 L13.5 8 Q13.5 12.5 8 14.5 Q2.5 12.5 2.5 8 L2.5 3.5 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
};

export function buildDollColumn(ctx: InventoryCtx): HTMLDivElement {
  const col = document.createElement('div');
  Object.assign(col.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  col.appendChild(sectionLabel('EQUIPPED'));

  const dollContainer = document.createElement('div');
  Object.assign(dollContainer.style, {
    position: 'relative',
    width: '100%',
    aspectRatio: '0.62',  // tighter than before so it fits landscape phones
    maxHeight: '230px',
    background: 'radial-gradient(circle at 50% 45%, rgba(60, 40, 25, 0.35) 0%, rgba(20, 14, 10, 0.1) 70%)',
    border: '1px solid rgba(80, 60, 40, 0.3)',
    borderRadius: '4px',
  } as Partial<CSSStyleDeclaration>);

  // SVG silhouette behind the slot indicators.
  dollContainer.appendChild(buildSilhouette());

  // Slot indicators on top of the silhouette.
  const eq = getEquipment();
  for (const def of SLOTS) {
    dollContainer.appendChild(buildDollSlot(def, eq[def.slotId], ctx));
  }

  col.appendChild(dollContainer);
  col.appendChild(buildRiteSlot(ctx));
  col.appendChild(buildRelicLink(ctx));
  return col;
}

// The rite picker defaults COLLAPSED — the doll column was a wall of every-rite
// chips even though only ONE is active. Collapsed shows the equipped rite as a
// single line; tapping reveals the full chip list to change it. Module-level so
// the state survives the panel's rebuild-on-select. (docs/BUILD-ECONOMY.md: the
// rite is your one ACTIVE, fired with Hunger.)
let riteExpanded = false;

/** The RITE slot — compact by default (current rite + a change affordance),
 *  expanding to the full chip list on tap. Cheap = often, dear = a big, rare
 *  erupt; all are selectable here until rites are FOUND in the deep. */
function buildRiteSlot(ctx: InventoryCtx): HTMLDivElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' } as Partial<CSSStyleDeclaration>);
  const equipped = getEquippedRite();
  const spec = equipped ? RITES[equipped] : undefined;

  // Header row: label + a right-aligned expand/collapse toggle.
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
    // Full picker — every rite as a chip, tap to equip/clear.
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
    // Collapsed — just the equipped rite, one line, tap to open the picker.
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

/** One-line RELIQUARY summary — count + jump to the full collection tab.
 *  The collection itself lives on its own tab (reliquary-screen.ts); the
 *  gear column just points at it. */
function buildRelicLink(ctx: InventoryCtx): HTMLButtonElement {
  const relics = getReliquary();
  const btn = document.createElement('button');
  btn.textContent = relics.length
    ? `RELIQUARY · ${relics.length} ›`
    : 'RELIQUARY · empty ›';
  Object.assign(btn.style, {
    marginTop: '6px', minHeight: '32px', padding: '6px 10px',
    fontSize: '10px', letterSpacing: '0.18em', textAlign: 'left',
    fontFamily: 'serif', cursor: 'pointer', borderRadius: '3px',
    border: '1px solid rgba(80,60,40,0.4)',
    background: 'rgba(20,14,10,0.5)',
    color: relics.length ? '#f0d8c0' : TEXT_DIM,
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.openReliquary?.();
  });
  return btn;
}

function buildSilhouette(): SVGSVGElement {
  // Stylized hooded humanoid. Simple shapes — reads as a person without
  // distracting from the slot indicators overlaid on top.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 320');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  Object.assign(svg.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    opacity: '0.9',
  } as Partial<CSSStyleDeclaration>);

  // A GUIDE, not a mass: faint fill + a clear warm outline so it reads as a
  // hooded figure the slots hang on, without competing with them (the old near-
  // opaque dark blob swallowed the slots). Warm hairline stroke = the leather
  // register of the rest of the HUD.
  const fill = 'rgba(34, 24, 16, 0.4)';
  const line = 'rgba(120, 88, 56, 0.7)';
  svg.innerHTML = `
    <!-- Hood drape -->
    <path d="M 50 75 Q 100 20 150 75 L 145 110 Q 100 95 55 110 Z"
          fill="${fill}" stroke="${line}" stroke-width="1.4"/>
    <!-- Head -->
    <ellipse cx="100" cy="68" rx="28" ry="32" fill="${fill}" stroke="${line}" stroke-width="1.4"/>
    <!-- Body torso -->
    <path d="M 62 110 L 138 110 L 152 215 Q 100 225 48 215 Z"
          fill="${fill}" stroke="${line}" stroke-width="1.4"/>
    <!-- Arms -->
    <rect x="32" y="115" width="22" height="110" rx="10" fill="${fill}" stroke="${line}" stroke-width="1.4"/>
    <rect x="146" y="115" width="22" height="110" rx="10" fill="${fill}" stroke="${line}" stroke-width="1.4"/>
    <!-- Legs -->
    <rect x="68" y="218" width="25" height="92" rx="6" fill="${fill}" stroke="${line}" stroke-width="1.4"/>
    <rect x="107" y="218" width="25" height="92" rx="6" fill="${fill}" stroke="${line}" stroke-width="1.4"/>
  `;
  return svg;
}

function buildDollSlot(def: SlotDef, item: ItemSpec | null, ctx: InventoryCtx): HTMLDivElement {
  const wrap = document.createElement('div');
  const filled = !!item;
  const rarityHex = item ? hexCss(RARITY_COLORS[item.rarity ?? 'mundane']) : null;
  const isSelected = ctx.selection?.kind === 'slot' && ctx.selection.slotId === def.slotId;

  Object.assign(wrap.style, {
    position: 'absolute',
    top: def.top, left: def.left,
    width: `${def.size}px`, height: `${def.size}px`,
    transform: 'translate(-50%, -50%)',
    borderRadius: '4px',
    background: filled ? 'rgba(40, 28, 20, 0.9)' : 'rgba(20, 14, 10, 0.7)',
    border: isSelected
      ? `2px solid ${ACCENT}`
      : filled ? `1.5px solid ${rarityHex}` : EMPTY_BORDER,
    boxShadow: isSelected ? `0 0 14px ${ACCENT}`
              : filled    ? `0 0 8px ${rarityHex}55`
                          : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.08s, border 0.15s, box-shadow 0.15s',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  if (filled && item) {
    const img = document.createElement('img');
    img.src = getItemThumbnail(item);
    Object.assign(img.style, {
      width: '100%', height: '100%',
      objectFit: 'contain',
      imageRendering: 'pixelated',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(img);
  } else {
    // Empty: a slot-type glyph (reads instantly) over a tiny caption.
    const stack = document.createElement('div');
    Object.assign(stack.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
      color: TEXT_DIM, pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '22'); icon.setAttribute('height', '22');
    icon.innerHTML = SLOT_ICON[def.slotId];
    icon.style.opacity = '0.75';
    const label = document.createElement('div');
    label.textContent = def.shortLabel;
    Object.assign(label.style, {
      fontSize: '7.5px', fontWeight: '600',
      letterSpacing: '0.14em', textAlign: 'center',
    } as Partial<CSSStyleDeclaration>);
    stack.append(icon, label);
    wrap.appendChild(stack);
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    // Toggle a filled slot's details pane; an empty slot just clears.
    ctx.select(item && !isSelected ? { kind: 'slot', slotId: def.slotId, item } : null);
  });

  return wrap;
}
