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
// Re-exported from the central UI theme (src/ui/theme.ts) so the inventory
// columns, the menu shell, settings, and the title screen all read from ONE
// palette. Kept under their historical names so existing imports don't churn.
import { THEME, sectionLabel as themeSectionLabel } from './theme';

export const PANEL_BG = THEME.panel;
export const PANEL_BORDER = `1px solid ${THEME.ruleStrong}`;
export const CARD_BG = THEME.raised;
export const EMPTY_BORDER = `1px dashed ${THEME.faint}`;
export const TEXT_PRIMARY = THEME.text;
export const TEXT_DIM = THEME.dim;
export const TEXT_FAINT = THEME.faint;
export const ACCENT = THEME.ember;

/** Small uppercase column header ("STATS", "BAG", …). */
export const sectionLabel = themeSectionLabel;
