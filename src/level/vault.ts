import type { PropSpec, TileMap, TorchSpec, CellBoundEntity, CellKey } from './types';
import type { EncounterSpec } from '../content/encounters';
import type { PaletteV1 } from './palette';

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
  /** Optional wall treatment — 'braced' adds mine-shaft timber framing. */
  wallVariant?: 'stone' | 'braced';
  /**
   * Perimeter-fitting policy for the main room — see
   * RoomSpec.perimeterFitting. Set 'arena-portcullis' on a challenge-altar
   * vault to install a slammable portcullis at EVERY external opening the
   * composer cuts, so the seal is visible (and consistent) regardless of
   * how the floor connects to it.
   */
  perimeterFitting?: 'arena-portcullis' | 'arena-trap' | 'cobweb';
  /** Darkness tier — LIGHT DOCTRINE (every light has a reason). 'lit'
   *  keeps the full ambient fill; 'dim' halves it; 'dark' removes it
   *  (the room is torches + threshold sconces + your lamp). Default
   *  'lit'. Rhythm comes from VARIANCE: tag combat rooms dim and the
   *  grim set-pieces dark. */
  lightTier?: 'lit' | 'dim' | 'dark';
  /**
   * Optional encounter archetype. When set, the room's X spawn slots are
   * filled from ONE coherent depth-scaled pack (swarm / bruisers / caster-
   * pack / mixed) instead of rolled independently — so the fight reads as a
   * designed encounter. The spawn POINTS stay authored; only the roster rolls.
   */
  encounter?: EncounterSpec;
  /**
   * Chasm voids in VAULT-LOCAL coords (centre = 0,0). Each becomes a floor
   * hole + edge barrier + drop. Leave a walkable gap between two voids for a
   * bridge. The map cells under a void stay '.' — the void blocks them.
   */
  voids?: Array<{ x: number; z: number; w: number; d: number }>;
  /**
   * Optional per-vault torch tint override. When set, torches
   * mounted on this vault's walls use this colour instead of
   * the act default. Cheap way to vary room mood: a treasure
   * chamber can burn warm gold even inside an act whose default
   * torches are cool blue. The TONAL register of a room comes
   * from its torches, not from a floor spotlight.
   */
  torchTint?: number;
  /**
   * Sophisticated torch placement in VAULT-LOCAL coords. The ASCII
   * chars T/t/</> are the quick path — one default-everything torch
   * per cell on the indicated wall. When you want sub-cell position,
   * a specific hex tint, a non-default height, or a different wall
   * fixture (sconce / candle / cresset), drop a TorchSpec here.
   *
   * Both paths feed the same level torches array; sophisticated
   * torches just bypass the cell-locked default. Use the array when
   * a vault has signature lighting that defines the room
   * (gold-tinted sconces flanking a boss altar, blood-red wall
   * cressets in a ritual chamber). Use the ASCII chars for routine
   * "two torches in this combat room" placement.
   */
  torches?: TorchSpec[];

  /**
   * Cell-bound props (Format C). Each key is `${col},${row}`
   * referencing the ASCII grid; the value is an array of entries
   * that live in that cell — torches, spawns, decor, all stack
   * naturally under one key. The composer translates cell coords
   * into world coords and routes each entry to the right slot
   * (torches → torches, spawn → spawns, everything else → props).
   *
   * Use this for nearly everything in new vaults. The legacy
   * absolute-coord `props` array still works (and remains the
   * escape hatch for the rare sub-cell case that doesn't bind to
   * one cell — e.g. king-flanking sconces at x = ±2.5).
   */
  cellProps?: Partial<Record<CellKey, CellBoundEntity[]>>;

  /**
   * Per-vault palette override. Last layer of the cascade
   * (act → floor → boss → vault). Use for vaults that intentionally
   * differ from their act's defaults — e.g. a treasure room that
   * stays warm-gold even in a cool-blue act, or a ritual chamber
   * that wants 'dark' density even where the act is 'medium'.
   */
  palette?: PaletteV1;

  /**
   * Boss-arena fog wall. Position + rotation of the mist curtain
   * at this vault's threshold (vault-local coords, vault centre =
   * (0,0)). Only honoured when this vault is selected as the boss
   * arena for a floor; ignored for non-boss tag use. Colour comes
   * from BossSpec.mistColor (per-boss identity), not from here.
   */
  bossMist?: { x: number; z: number; rotY?: number };

  /**
   * INTENT ANCHORS — named "a thing reads well HERE" markers, the seam for the
   * content DIRECTOR (see vault-compose.ts). An anchor is NOT baked content: it
   * declares a good SPOT for a director-placed thing, with INTENT (`kind`), at a
   * grid cell. The director decides per-floor whether/how much to place (by its
   * content budget) and drops it at a matching anchor so it looks designed —
   * falling back to an open cell when no anchor fits. This is what lets us say
   * "fires don't appear unless the director wants one" while still landing them
   * on an authored dais. Distinct from `cellProps` (baked, always-present
   * set-pieces) — anchors are offers, cellProps are commitments.
   *
   *   kind 'fire'  — a bonfire reads well here (a dais, a nook off the path).
   *   kind 'spot'  — a DUMB content marker: the director may stage DEFINING
   *                  content here (a find, a deal), with the CATEGORY decided by
   *                  the room's role and the FLAVOR by its theme — never by the
   *                  marker (docs/FLOOR-DIRECTOR.md "the authoring model"). A
   *                  marker carries only WHERE + two optional geometry bits.
   */
  anchors?: VaultAnchor[];
}

export type VaultAnchorKind = 'fire' | 'spot';

export interface VaultAnchor {
  /** What the director may place here. */
  kind: VaultAnchorKind;
  /** Cell in the vault's ASCII grid (same coords as cellProps keys). */
  col: number;
  row: number;
  /** ('spot' only) Is this THE hero spot the room is built around (a dais)?
   *  The floor's defining find / the deal prefers a focal marker over an
   *  ordinary one. Optional — defaults to false (an ordinary spot). */
  focal?: boolean;
  /** ('spot' only) Yaw the placed content should face, radians. Optional —
   *  the fill defaults it toward the room entrance. Reserved; not yet consumed. */
  facing?: number;
}
