// Ground-equip — the ONE path a piece of gear takes from the world onto the
// delver's body. DELVE has NO gear bag: a weapon or vestment is never pocketed
// for later — you wear it now or you leave it on the stone.
//
//   • Empty slot  → it slides straight in (instant, no prompt).
//   • Slots full  → a COMPARE opens: the found piece beside each thing it could
//                   replace, one tap to SWAP. The piece you displace drops back
//                   onto the floor where you're standing, so nothing is lost —
//                   it's a swap, not a sacrifice. Or close the sheet to LEAVE it.
//   • Relic       → collects into the reliquary (the build), never a slot.
//
// Callers (floor pickups, the blood altar, a bought ware) hand us the item, its
// rolled affixes, an `onEquipped` to fire when it lands in a slot (play the feel,
// consume the source), and a `dropDisplaced` bound to their own scene + world
// position so the ejected piece re-enters the world at the right spot.

import type { ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import { RARITY_COLORS } from '../content/items';
import {
  getEquipped, getSidearm, getSidearmAffixes, getSlotAffixes,
  setSlotWithAffixes, setSidearm,
  replaceSlotReturning, replaceSidearmReturning,
  type EquipSlot,
} from './equipment';
import { addRelic } from './reliquary';
import { openPickerScreen } from '../ui/shop-shell';
import { buildItemCard } from '../ui/item-card';
import { getItemThumbnail } from '../ui/item-thumbnail';
import { hexCss } from '../style/color-utils';
import { THEME } from '../ui/theme';

export interface GroundEquipCtx {
  item: ItemSpec;
  affixes: AffixInstance[];
  /** Fired the moment the item enters a slot (or the reliquary): the caller
   *  plays the pickup feel + destroys the world source. Never fires on LEAVE. */
  onEquipped: () => void;
  /** Re-drop a displaced piece into the world. Bound by the caller to its own
   *  scene + the source's world position (see pickup.dropGearPickup). */
  dropDisplaced: (item: ItemSpec, affixes: readonly AffixInstance[]) => void;
}

/** One thing the incoming piece could replace: a currently-occupied slot,
 *  with a label and a swap that ejects the old occupant. */
interface Occupant {
  key: string;
  label: string;
  item: ItemSpec;
  affixes: readonly AffixInstance[];
  /** Install `item` here, return the piece it displaced (+ its affixes). */
  swapIn: (item: ItemSpec, affixes: AffixInstance[]) => { item: ItemSpec | null; affixes: readonly AffixInstance[] };
}

/** Route a piece of found gear onto the body. See module header. */
export function groundEquip(ctx: GroundEquipCtx): void {
  const { item, affixes } = ctx;

  // Relics never take a slot — they collect into the reliquary and all apply.
  if (item.kind === 'relic') {
    addRelic(item, affixes);
    ctx.onEquipped();
    return;
  }

  // Fill an empty slot instantly — no compare, no ceremony.
  if (fillEmpty(item, affixes)) {
    ctx.onEquipped();
    return;
  }

  // No room: the slots for this kind are all full. Open the swap-or-leave compare.
  openCompare(ctx, occupantsFor(item));
}

/** Try to slot the item into a free slot for its kind. Weapons prefer the
 *  drawn hand, then the sheathed slot; vestments take either free slot. */
function fillEmpty(item: ItemSpec, affixes: AffixInstance[]): boolean {
  // One weapon, no sidearm, no vestments (all cut). A weapon just replaces the
  // one you hold; the off-hand still fills if empty. Everything else is a no-op.
  switch (item.kind) {
    case 'weapon':
      setSlotWithAffixes('weapon', item, affixes);
      return true;
    case 'offhand':
      if (!getEquipped('offhand')) { setSlotWithAffixes('offhand', item, affixes); return true; }
      return false;
    default:
      return false;
  }
}

/** The occupants the incoming piece could replace (both weapons, both
 *  vestments, the one offhand). */
function occupantsFor(item: ItemSpec): Occupant[] {
  const slotOcc = (slot: EquipSlot, label: string): Occupant | null => {
    const it = getEquipped(slot);
    if (!it) return null;
    return {
      key: slot, label, item: it, affixes: getSlotAffixes(slot),
      swapIn: (ni, na) => replaceSlotReturning(slot, ni, na),
    };
  };
  switch (item.kind) {
    case 'weapon': {
      const out: Occupant[] = [];
      const drawn = slotOcc('weapon', 'DRAWN');
      if (drawn) out.push(drawn);
      const side = getSidearm();
      if (side) out.push({
        key: 'sidearm', label: 'SHEATHED', item: side, affixes: getSidearmAffixes(),
        swapIn: (ni, na) => replaceSidearmReturning(ni, na),
      });
      return out;
    }
    case 'offhand': {
      const o = slotOcc('offhand', 'OFFHAND');
      return o ? [o] : [];
    }
    case 'vestment': {
      const out: Occupant[] = [];
      const a = slotOcc('vestment', 'WORN · I');
      const b = slotOcc('vestment2', 'WORN · II');
      if (a) out.push(a);
      if (b) out.push(b);
      return out;
    }
    default:
      return [];
  }
}

/** The swap-or-leave compare sheet: the found piece beside each thing it could
 *  replace. Built on the shared picker-shell (pinned SWAP action, scrolling
 *  cards). Closing the sheet without acting = LEAVE (source stays in the world). */
function openCompare(ctx: GroundEquipCtx, occupants: Occupant[]): void {
  const { item, affixes } = ctx;

  // Degenerate guard: nothing to replace (shouldn't happen — we only reach here
  // when slots are full). Fall back to a silent leave rather than a broken sheet.
  if (occupants.length === 0) return;

  const handle = openPickerScreen({
    id: 'equip-compare',
    title: 'EQUIP — SWAP OR LEAVE',
    emptyLine: 'Nothing to swap.',
    tiles: () => occupants.map((o) => ({
      id: o.key,
      name: o.item.name,
      accentHex: hexCss(RARITY_COLORS[o.item.rarity ?? 'mundane']),
      thumbUrl: getItemThumbnail(o.item),
      badge: o.label,
    })),
    renderDetail: (id) => {
      const o = occupants.find((x) => x.key === id);
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '8px' } as Partial<CSSStyleDeclaration>);

      // FOUND — the incoming piece, its full card (with rolled affixes).
      wrap.appendChild(sectionRule('YOU FOUND'));
      wrap.appendChild(buildItemCard(item, { affixes }));

      if (o) {
        // REPLACES — the occupant this tile represents.
        wrap.appendChild(sectionRule(`SWAP FOR YOUR ${o.label}`));
        wrap.appendChild(buildItemCard(o.item, { affixes: [...o.affixes] }));
      }
      return wrap;
    },
    action: {
      render: () => 'SWAP',
      enabled: () => true,
    },
    onAct: (id) => {
      const o = occupants.find((x) => x.key === id);
      if (!o) return;
      const prev = o.swapIn(item, affixes);
      if (prev.item) ctx.dropDisplaced(prev.item, prev.affixes);
      ctx.onEquipped();
      handle.close();
    },
  });
}

/** A hairline section label used to separate FOUND from SWAP-FOR in the compare. */
function sectionRule(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    fontSize: '9px', letterSpacing: '0.24em', color: THEME.amber,
    borderBottom: `1px solid ${THEME.rule}`, paddingBottom: '3px', marginTop: '2px',
    fontFamily: 'ui-monospace, monospace',
  } as Partial<CSSStyleDeclaration>);
  return el;
}
