import { RARITY_COLORS } from './items';

// ── The TRANSACTION GRAMMAR ──────────────────────────────────────────
//
// Every place the dungeon trades with the player — blood altar, trial
// altar, fountains, merchant, tithe basin, future deals — speaks ONE
// visual + event language, so the player learns the dialect once and
// the systems (broadcast snark, epitaphs, the future attention meter)
// subscribe to ONE event stream instead of N bespoke hooks.
//
// The four families (docs/VISUAL-LANGUAGE.md, "color = meaning"):
//
//   PRICED  · gold   — LEGIBLE. You see the goods, you see the price,
//                      you choose. Merchant wares, displayed hoards,
//                      treasure with a stated cost. Show-and-tell.
//   BARGAIN · violet — CURSED DEAL. The goods are visible but wrong;
//                      the price is real and immediate (blood altar:
//                      max-HP-class pain for cursed power). Violet is
//                      the cursed-rarity tint — same warning, same hue.
//   TRIAL   · blood  — PAY IN DANGER. The cost is the fight itself
//                      (challenge arena, future gauntlets). Red is a
//                      promise of violence, never decoration.
//   UNKNOWN · pale   — THE DUNGEON DECIDES. Tithe basins, strange
//                      draughts, mercies. You commit first; the answer
//                      comes after. Pale moonlight: neither warm
//                      welcome nor red threat — indifference.
//
// Rule of thumb for new content: if the player can see exactly what
// they get AND what it costs, it's PRICED. Visible goods + hidden or
// painful strings → BARGAIN. Cost is combat → TRIAL. Outcome hidden →
// UNKNOWN. When in doubt, prefer show-and-tell (PRICED/BARGAIN —
// loot ON the altar) for most placements and save UNKNOWN for the
// places where dread is the point.

export type TransactionFamily = 'priced' | 'bargain' | 'trial' | 'unknown';

export interface FamilyTint {
  /** Light + glow color for the interactable's presentation. */
  light: number;
  /** Emissive accent (sigils, candle flames, liquid). */
  accent: number;
}

export const TRANSACTION_TINTS: Record<TransactionFamily, FamilyTint> = {
  priced:  { light: 0xffd060, accent: 0xffb347 },                 // gold (matches TORCH_GOLD / merchant lantern)
  bargain: { light: RARITY_COLORS.cursed, accent: 0x8a3fa0 },     // cursed violet
  trial:   { light: 0xff2410, accent: 0xff4818 },                 // ritual blood (matches challenge altar)
  unknown: { light: 0xa8c0d8, accent: 0x7a96b8 },                 // pale moonlight
};

// ── Event payloads (carried on the broadcast bus) ────────────────────
// offered  → the player has seen the deal (walked into range / opened
//            the panel). At most once per interactable.
// accepted → the player committed (drank, took, paid, lit the candles).
// resolved → the dungeon answered (item granted, mutation applied,
//            trial won, basin scorned the offering).

export interface TransactionPrice {
  hp?: number;
  gold?: number;
  /** Item given UP by the player (tithes). */
  itemId?: string;
  /** The price is the fight (trials). */
  danger?: boolean;
}

export interface TransactionOutcome {
  /** Item ids granted to the player. */
  itemIds?: string[];
  /** Permanent run mutation applied (content/tainted-mutations.ts). */
  mutationId?: string;
  /** Healing / harm actually applied, if the outcome is bodily. */
  hpDelta?: number;
  /** The dungeon gave nothing (the tithe was scorned). */
  scorned?: boolean;
  /** The deal woke something up. */
  hostile?: boolean;
}
