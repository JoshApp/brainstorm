import { getEquipment, type EquipSlot } from '../player/equipment';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import { getItemThumbnail } from './item-thumbnail';
import { hexCss } from './item-format';
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

const SLOTS: SlotDef[] = [
  { slotId: 'helmet', top: '7%',  left: '50%', size: 38, shortLabel: 'HELM', longLabel: 'HELMET' },
  { slotId: 'amulet', top: '24%', left: '50%', size: 28, shortLabel: 'AMU',  longLabel: 'AMULET' },
  { slotId: 'armor',  top: '42%', left: '50%', size: 44, shortLabel: 'ARM',  longLabel: 'ARMOR' },
  { slotId: 'weapon', top: '52%', left: '14%', size: 44, shortLabel: 'WPN',  longLabel: 'WEAPON' },
  { slotId: 'offhand',top: '52%', left: '86%', size: 44, shortLabel: 'OFF',  longLabel: 'OFF-HAND' },
  { slotId: 'gloves', top: '70%', left: '14%', size: 34, shortLabel: 'GLV',  longLabel: 'GLOVES' },
  { slotId: 'ring1',  top: '70%', left: '38%', size: 30, shortLabel: 'R1',   longLabel: 'RING' },
  { slotId: 'ring2',  top: '70%', left: '62%', size: 30, shortLabel: 'R2',   longLabel: 'RING' },
  { slotId: 'boots',  top: '92%', left: '50%', size: 34, shortLabel: 'FEET', longLabel: 'BOOTS' },
];

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
  return col;
}

function buildSilhouette(): SVGSVGElement {
  // Stylized hooded humanoid. Simple shapes — reads as a person without
  // distracting from the slot indicators overlaid on top.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 320');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  Object.assign(svg.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    opacity: '0.85',
  } as Partial<CSSStyleDeclaration>);

  svg.innerHTML = `
    <!-- Hood drape -->
    <path d="M 50 75 Q 100 20 150 75 L 145 110 Q 100 95 55 110 Z"
          fill="rgba(20, 14, 10, 0.95)" stroke="rgba(80, 55, 35, 0.5)" stroke-width="1"/>
    <!-- Head -->
    <ellipse cx="100" cy="68" rx="28" ry="32" fill="rgba(30, 22, 16, 0.95)"/>
    <!-- Body torso -->
    <path d="M 62 110 L 138 110 L 152 215 Q 100 225 48 215 Z"
          fill="rgba(28, 20, 14, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <!-- Arms -->
    <rect x="32" y="115" width="22" height="110" rx="10"
          fill="rgba(26, 18, 12, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <rect x="146" y="115" width="22" height="110" rx="10"
          fill="rgba(26, 18, 12, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <!-- Legs -->
    <rect x="68" y="218" width="25" height="92" rx="6"
          fill="rgba(24, 16, 10, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
    <rect x="107" y="218" width="25" height="92" rx="6"
          fill="rgba(24, 16, 10, 0.95)" stroke="rgba(80, 55, 35, 0.4)" stroke-width="1"/>
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
    const label = document.createElement('div');
    label.textContent = def.shortLabel;
    Object.assign(label.style, {
      fontSize: '9px', fontWeight: '500',
      color: TEXT_DIM, letterSpacing: '0.15em', textAlign: 'center',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(label);
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.select(item ? { kind: 'slot', slotId: def.slotId, item } : null);
  });

  return wrap;
}
