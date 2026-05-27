import type { PropSpec, TileMap } from './types';

// Vault system — pre-authored room chunks the procgen composer
// stitches into multi-room floors. Each vault is a small ASCII map
// (the structural skeleton: walls, simple tile-based props, enemy
// slots) plus an optional `props` list for sub-cell precision
// placements (a fountain offset 0.3m from cell centre, an altar
// rotated 0.6 rad, etc.). The hybrid keeps ASCII's strengths
// (visual scanning, LLM-authorability, git-diff-friendly) without
// forcing every property into a tile char.
//
// A floor is a CHAIN of vaults. Typical sequence:
//
//   start → combat → combat → ... → exit
//
// The composer picks vaults by depth + tags, lays them out along the
// world Z axis with corridors between, and emits a single LevelSpec
// the existing builder consumes. No engine changes needed past parse-
// time.
//
// Each vault declares which TAG SLOTS it can fill (a 'combat' vault
// goes in a combat slot, a 'boss' vault in a boss slot, etc.) plus a
// depth range and weight. The composer's pick is depth-weighted so
// deeper floors lean toward harder content.

export type VaultTag =
  | 'start'        // First in the chain. Has the player spawn 'S'.
  | 'combat'       // Regular fight room.
  | 'treasure'     // Loot-focused. Light combat or none.
  | 'encounter'    // Non-combat — fountain, altar, lore corpse, etc.
  | 'boss'         // Boss antechamber. Last vault on deep floors.
  | 'exit';        // Last vault. Contains the stairs '/'.

export interface Vault {
  /** Stable id (used for debugging / future "remember this vault" rules). */
  id: string;
  /** ASCII tilemap. Same dictionary as src/level/tilemap.ts. */
  map: TileMap;
  /**
   * Optional precise-placement props in VAULT-LOCAL world coordinates
   * (vault centre = (0, 0)). The composer translates them to floor-
   * space by adding the vault's world offset. Use this for anything
   * the 1m grid can't place precisely: rotated fountains, altars off
   * grid centre, decorative model props, hint triggers, etc.
   */
  props?: PropSpec[];
  /** Slot(s) this vault can fill in the composer chain. */
  tags: VaultTag[];
  /** Minimum floor depth. Default 1. */
  minDepth?: number;
  /** Maximum floor depth. Default 999. */
  maxDepth?: number;
  /** Procgen pick weight inside its tag pool. Default 1. */
  weight?: number;
  /** Optional ceiling height override (m). */
  roomHeight?: number;
}
