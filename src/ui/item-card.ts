// The ONE item card (docs/UI-CHARTER.md) — name, flavor, and the FULL effects
// list, never truncated. Composed from the inventory detail-panel renderers so a
// floor item, an altar reward, and an equipped item all read identically. The
// altar preview's old one-line formatStats (which silently dropped passives, set
// bonuses, on-hits…) is retired in favour of this.

import type { ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import { getEquipped, slotKindFor } from '../player/equipment';
import { buildDetailsHeader, buildFlavorLine, describeItem } from './inventory-details';
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
