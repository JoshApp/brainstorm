// The ONE item card (docs/UI-CHARTER.md) — name, flavor, and the FULL effects
// list, never truncated. Composed from the inventory detail-panel renderers so a
// floor item, an altar reward, and an equipped item all read identically. The
// altar preview's old one-line formatStats (which silently dropped passives, set
// bonuses, on-hits…) is retired in favour of this.

import type { ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import { getEquipped, slotKindFor } from '../player/equipment';
import { buildDetailsHeader, buildFlavorLine, describeItem } from './inventory-details';
import { SCARS, SCAR_LANE_COLOR } from '../content/scars';
import { getScars } from '../state/weapon-scars';
import { THEME } from './theme';

export interface ItemCardOpts {
  affixes?: readonly AffixInstance[];
  /** Show a "replaces your equipped …" line for gear (the ground-swap decision). */
  compare?: boolean;
}

export function buildItemCard(item: ItemSpec, opts: ItemCardOpts = {}): HTMLDivElement {
  const card = document.createElement('div');
  Object.assign(card.style, { display: 'flex', flexDirection: 'column', gap: '5px' } as Partial<CSSStyleDeclaration>);

  card.appendChild(buildDetailsHeader(item));
  const flavor = buildFlavorLine(item);
  if (flavor) card.appendChild(flavor);
  for (const line of describeItem(item, opts.affixes ?? [])) card.appendChild(line);

  // WHAT THE BLADE REMEMBERS — the scars burned into THIS weapon (content/scars.ts).
  // It belongs on the card rather than only at the forge: the whole point of the
  // system is that by Depth 10 you can look at your weapon and name the three
  // decisions that made it yours.
  const scars = getScars(item.id);
  if (scars.length) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      marginTop: '3px', paddingTop: '4px', borderTop: `1px solid ${THEME.faint}`,
      display: 'flex', flexDirection: 'column', gap: '2px',
    } as Partial<CSSStyleDeclaration>);
    for (const id of scars) {
      const spec = SCARS[id];
      if (!spec) continue;
      const row = document.createElement('div');
      Object.assign(row.style, { fontSize: '11px', color: SCAR_LANE_COLOR[spec.klass] } as Partial<CSSStyleDeclaration>);
      row.textContent = `† ${spec.name}`;
      wrap.appendChild(row);
    }
    if (wrap.childElementCount) card.appendChild(wrap);
  }

  // Compare to what's equipped in the matching gear slot (weapon/offhand/vestment).
  // Relics don't compare — they all apply — so slotKindFor returns [] and we skip.
  if (opts.compare) {
    const slot = slotKindFor(item.kind)[0];
    if (slot) {
      const equipped = getEquipped(slot);
      const cmp = document.createElement('div');
      Object.assign(cmp.style, {
        marginTop: '3px', paddingTop: '4px', borderTop: `1px solid ${THEME.faint}`,
        fontSize: '10px', fontStyle: 'italic', color: THEME.dim,
      } as Partial<CSSStyleDeclaration>);
      cmp.textContent = equipped ? `Replaces: ${equipped.name}` : `Fills your empty ${slot} slot`;
      card.appendChild(cmp);
    }
  }
  return card;
}
