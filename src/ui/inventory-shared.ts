import type { ItemSpec } from '../content/items';
import type { EquipSlot } from '../player/equipment';

// Shared contract + styling for the inventory panel's column components.
// The panel owns the selection state + rebuild; each column receives an
// InventoryCtx so it can read the current selection (for highlighting) and
// request a new one on tap. Keeping this in its own module avoids a cycle
// between the panel and its columns.

/** Currently selected item — from the bag, or an equipped doll slot. */
export type Selection =
  | { kind: 'bag'; item: ItemSpec }
  | { kind: 'slot'; slotId: EquipSlot; item: ItemSpec }
  | null;

export interface InventoryCtx {
  /** Selection at the time this column was built. */
  selection: Selection;
  /** Set the selection and rebuild the panel. */
  select(sel: Selection): void;
}

// ── Styling tokens ───────────────────────────────────────────────────────
export const PANEL_BG = 'rgba(20, 14, 10, 0.96)';
export const PANEL_BORDER = '1px solid rgba(180, 130, 90, 0.5)';
export const CARD_BG = 'rgba(36, 26, 18, 0.7)';
export const EMPTY_BORDER = '1px dashed rgba(120, 90, 60, 0.4)';
export const TEXT_PRIMARY = 'rgba(230, 200, 170, 0.95)';
export const TEXT_DIM = 'rgba(160, 130, 100, 0.85)';
export const TEXT_FAINT = 'rgba(100, 80, 60, 0.6)';
export const ACCENT = 'rgba(255, 160, 80, 0.85)';

/** Small uppercase column header ("STATS", "BAG", …). */
export function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    fontSize: '10px', fontWeight: '500', letterSpacing: '0.25em',
    color: TEXT_DIM,
    borderBottom: '1px solid rgba(120, 90, 60, 0.3)',
    paddingBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  return el;
}
