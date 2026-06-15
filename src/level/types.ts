// Declarative level data. A level is just JSON-ish — could be hand-authored,
// loaded from a file, or procedurally generated. The buildLevel() function in
// builder.ts consumes one of these and produces the live scene.
//
// All coordinates are world-space XZ unless otherwise noted. Y is computed
// from props' implicit shapes (floors at y=0, ceilings at level height, etc.).

import type { FittingKind, Edge } from './opening';

export type Vec2 = { x: number; z: number };

/**
 * ASCII tile-map representation of a floor. Each character is one 1m × 1m
 * cell. See src/level/tilemap.ts for the dictionary + parseTileMap().
 */
export type TileMap = readonly string[];

/** Axis-aligned XZ rectangle, defined by center + extents. */
export type WalkableRect = {
  x: number;
  z: number;
  w: number;  // X extent (full width)
  d: number;  // Z extent (full depth)
};

/** Circular obstacle inside a walkable region (pillars, altars approximate to this). */
export type ObstacleCircle = {
  x: number;
  z: number;
  r: number;  // radius
};

/** Per-shape collision attached to a 'model' prop. Each shape may
 *  carry an optional offset relative to the prop's local origin;
 *  the offset is rotated by the prop's rotY at build time.
 *
 *  `height` (m above floor) is OPTIONAL: omitted = full-height blocker
 *  (columns, buttresses — block movement AND every projectile). Set it on
 *  a LOW structural prop (a kerb, a fallen beam) so shots fly over it
 *  (height-aware projectile pass — see WalkableRegion.containsProjectile).
 *  Movement always collides regardless of height. */
export type PropCollision =
  | { kind: 'circle'; r: number; ox?: number; oz?: number; height?: number }
  | { kind: 'aabb'; halfW: number; halfD: number; ox?: number; oz?: number; height?: number };

/** Declarative facing directive for a prop. Resolves to a
 *  concrete rotY at compose time via src/level/facing.ts. The
 *  resolver knows about room rects + the prop's position, so
 *  authoring is "what should this prop's FRONT do" instead of
 *  "what angle in radians".
 *
 *  Convention: a prop's FRONT is its local +Z direction at rotY=0.
 *  At rotY=0 the prop's front points world +Z (south). The
 *  resolver rotates the prop so its front lines up with the
 *  named target.
 *
 *  Variants:
 *    fixed         — explicit rotY; equivalent to setting rotY directly.
 *    wall-away     — front faces AWAY from the nearest wall of the
 *                    containing room (back of the prop against that
 *                    wall). The chest's natural placement.
 *    wall-toward   — front faces the nearest wall (sconces, paintings).
 *    point-away    — front points away from a world XZ point
 *                    (corpse sprawled away from a trap).
 *    point-toward  — front points at a world XZ point (corpse
 *                    reaching for an altar; bone shrine facing
 *                    a fountain). */
export type PropFacing =
  | { kind: 'fixed'; rotY: number }
  | { kind: 'wall-away' }
  | { kind: 'wall-toward' }
  | { kind: 'point-away'; x: number; z: number }
  | { kind: 'point-toward'; x: number; z: number };

export type RoomSpec = {
  id: string;
  /** The walkable rectangle for this room. Walls are built on its perimeter. */
  rect: WalkableRect;
  height: number;
  /**
   * Floor elevation in metres (default 0). Rooms are internally FLAT at
   * their elevation — combat, props, splats all live on one plane per
   * room (doors seal on combat, so a fight never spans two elevations).
   * A CORRIDOR between two rooms at different elevations becomes a ramp:
   * the elevation field (src/level/elevation.ts) lerps ground height
   * along its long axis, the camera/mobs/effects sample groundYAt(x,z),
   * and the builder lays a sloped floor. Collision stays 2D — height is
   * presentation + the ground-sample, never a movement gate.
   */
  elevation?: number;
  /**
   * CORRIDOR-ONLY explicit ramp endpoints, in world elevation. When the
   * composer knows which rooms a corridor connects (it always does — it
   * placed them), it stamps the elevation at the corridor's LOW-coord end
   * (`rampLoElev`) and HIGH-coord end (`rampHiElev`) along its long axis.
   * The elevation field uses these verbatim instead of guessing endpoints
   * by spatial probing — guessing lands on the nearest room by 2D
   * distance, which picks the WRONG room in dense/deep layouts and leaves
   * the corridor's far seam floating half a metre off the room floor.
   */
  rampLoElev?: number;
  rampHiElev?: number;
  /**
   * CORRIDOR-ONLY: which axis the ramp runs along, from the actual
   * connection (the two rooms' centre separation), NOT the rect's longer
   * side. A stubby wide corridor (length < width) has its long rect axis
   * PERPENDICULAR to travel; guessing the axis from `rect.w >= rect.d`
   * then ramps the wrong way and the seams float. The composer knows the
   * connection direction, so it stamps the truth.
   */
  rampAlongX?: boolean;
  /**
   * Ceiling shape. Default 'flat' (a plane at `height`). 'barrel' (curved
   * vault) and 'pitched' (A-frame) spring from the wall-top at `height` and
   * arch UP to height + ceilingRise at the crown, with the short-wall
   * lunettes filled so there's no gap. Adds verticality; still ONE ceiling
   * mesh, so no extra draw calls.
   */
  ceilingStyle?: 'flat' | 'barrel' | 'pitched';
  /** Crown rise above `height` for barrel/pitched ceilings (meters). */
  ceilingRise?: number;
  /**
   * Wall treatment. 'stone' (default) is the bare jittered wall. 'braced'
   * adds mine-shaft timber support frames (posts + lintels) at intervals,
   * merged into one mesh — the "dug tunnel" read.
   */
  wallVariant?: 'stone' | 'braced';
  /**
   * If true, the builder SKIPS shell generation (floor / ceiling /
   * walls) for this room. The rect is still used for ATTRIBUTION:
   * mob spawns find their roomId via findRoomContaining, arena
   * doors detect player-entry via the rect, room-clear events
   * fire per this room.
   *
   * Used by multi-room vault parsing — one main RoomSpec carries
   * the vault's geometry, and one logical-only sub-room per
   * flood-fill component carries the finer attribution.
   */
  logicalOnly?: boolean;
  /**
   * Declarative entrance/exit policy. When set, the builder installs the
   * matching fitting at EVERY external opening on this room's perimeter —
   * authors don't have to enumerate each doorway in `spec.doors`. Pairs
   * with the room's encounter (arena, boss, etc.) so visible seals appear
   * wherever the composer cuts an opening into this room.
   *
   *   'arena-portcullis' — every entrance is a portcullis whose
   *                        unlock kind is 'arena' + trigger 'offering'.
   *                        Activating the room's arena encounter slams
   *                        ALL of them; completing the encounter raises
   *                        ALL of them. The CHALLENGE ARENA's altar uses
   *                        this so a player can't slip in through a
   *                        side passage and skip the gate visual.
   *
   * Combat arenas (the trap with the alcove + 'D' tile gate) authored a
   * single explicit door; they don't need this. Set ONLY on rooms that
   * want every external opening to share one barrier behaviour.
   */
  perimeterFitting?: 'arena-portcullis' | 'arena-trap' | 'cobweb';
  /** Darkness tier (light doctrine): scales the room's ambient fill —
   *  'lit' ×1 (default), 'dim' ×0.55, 'dark' ×0. Corridors are always
   *  'dim' (threshold sconces carry their ends). */
  lightTier?: 'lit' | 'dim' | 'dark';
};

export type PropSpec =
  | { kind: 'pillar'; x: number; z: number; size?: number }
  | { kind: 'altar'; x: number; z: number }
  // Challenge-arena centrepiece: a chained reliquary. Interacting activates
  // the room's wave encounter (the gate seals as a reactor); surviving the
  // waves shatters the chains + yields a generous hoard. Placing one in an
  // arena room flips that room's arena gate to the 'offering' trigger (the
  // gate no longer slams on entry — you choose to start the trial).
  | { kind: 'challenge-offering'; x: number; z: number; rotY?: number }
  // 'model' = any ModelSpec placed in the world as static decoration.
  // Defaults to NO COLLISION — pure visuals. Use for relics, debris,
  // sigils, anything atmospheric that doesn't move or react.
  //
  // For structural decoration that should block the player (a stone
  // buttress, a broken column stub, the columns of an archway), set
  // `collision` to attach one or more walk-blockers. Two shapes:
  //   - circle: { kind: 'circle', r: 0.35 } at the prop's world XZ
  //   - aabb:   { kind: 'aabb', halfW: 0.4, halfD: 0.3 }, with the
  //             AABB rotated by the prop's rotY (for cardinal rotY
  //             the rotated rectangle is itself axis-aligned).
  // Each shape may carry optional local offsets (ox, oz) so a single
  // prop can express multiple obstacles — e.g. an archway has TWO
  // column blockers at (±1, 0). Offsets are rotated by the prop's
  // rotY before being added to the prop's world position.
  | {
      kind: 'model'; model: import('../ecs/model-types').ModelSpec;
      x: number; y: number; z: number;
      rotY?: number; rotX?: number; rotZ?: number;
      /** Uniform scale multiplier (default 1). Lets a single ModelSpec be
       *  placed at varied sizes — e.g. cobwebs / debris size jitter. */
      scale?: number;
      /** If set, the builder registers this prop's 'glow' material with the
       *  threshold system, which raises its warm emissive as the player nears
       *  (archways glowing to mark a passage). No-op if the model has no
       *  material id 'glow'. */
      proximityGlow?: boolean;
      collision?: PropCollision | PropCollision[];
      facing?: PropFacing;
      /** Debug provenance — which pipeline phase produced this prop
       *  (`vault:lattice`, `geometry-warp`, `surface-clutter`,
       *  `floor-decor`, `group:altar-ritual`). Stamped at creation;
       *  copied into the built group's userData by builder.ts so the
       *  debug capture tool can report what made the thing you're
       *  looking at. Purely diagnostic — ignored by gameplay. */
      _dbg?: string;
    }
  // 'chest' = an openable container. When the player interacts, the lid swings
  // up and an optional loot pickup spawns beside it.
  | {
      kind: 'chest';
      x: number;
      z: number;
      rotY?: number;
      facing?: PropFacing;
      loot?: import('../content/items').ItemSpec;
      /** Visual tier — supply = plain wood (default), iron = uncommon-
       *  green sealed, boss = ornate gold + amber emissive. Doesn't
       *  affect the open animation or hinge geometry; purely the
       *  silhouette and built-in materials. */
      tier?: 'supply' | 'iron' | 'boss';
      /** If true, this chest is a MIMIC in disguise. The interactable
       *  still renders as a chest of `tier` (so the player can't tell
       *  from a distance — see chest.ts for the subtle lid-jiggle
       *  tell), but on OPEN it spawns a mimic mob at this position
       *  instead of dropping loot. Procgen rolls this with a small
       *  per-tier probability. */
      mimic?: boolean;
      /** Set by the corridor-clearance post-process when a chest's
       *  position overlaps a corridor rect. Builder skips collision
       *  push for the chest so the player can walk through it — the
       *  alternative is being permanently stuck behind a chest the
       *  vault author placed in a narrow choke. Interactability is
       *  untouched: the OPEN prompt still fires when the player is
       *  in range. */
      noCollision?: boolean;
    }
  // 'stash-chest' = the meta-progression stash entry point. Lives in
  // the safe room. Interacting opens the stash UI (loot boxes saved
  // across runs).
  | { kind: 'stash-chest'; x: number; z: number; rotY?: number; facing?: PropFacing }
  // ── Non-combat encounters ────────────────────────────────────────
  // 'corpse' = a fallen delver (content/corpses.ts). Walk up: epitaph
  // whispers, and if they died holding something a glint marks it and SEARCH
  // takes it. `note` overrides the picked epitaph (a vault speaking a death).
  | { kind: 'corpse'; x: number; z: number; rotY?: number; facing?: PropFacing; note?: string }
  // 'wall-rune' = a glyph scratched into the wall, invisible until the lamp
  // finds it; its message whispers as you pass. `rotY` faces it into the room
  // (N=0, S=π, W=π/2, E=−π/2). `text` overrides the picked wall-mark; omit for
  // a depth-appropriate roll. `height` = metres up the wall (default 1.5).
  | { kind: 'wall-rune'; x: number; z: number; rotY?: number; height?: number;
      text?: string; glyph?: import('../content/wall-marks').RuneGlyph; tint?: number }
  // 'vase' = small destructible ceramic prop. Takes a hit from
  // the player's swing, shatters into a few stone-shard pieces,
  // and may drop a small reward (gold or potion). Tiny obstacle
  // until destroyed. Sprinkled rarely throughout combat /
  // treasure / encounter rooms so the player has a low-stakes
  // "swing something" target.
  | { kind: 'vase'; x: number; z: number }
  // 'vase-cluster' = a tight group of 2-4 vases jittered around
  // a point. Authored with the 'V' tile or composed by procgen;
  // the builder calls spawnVaseCluster which handles random
  // separation + variant selection per vase.
  | { kind: 'vase-cluster'; x: number; z: number }
  // 'cobweb' = a destructible web curtain plugging a passage. Blocks
  // movement until the player slashes through it (one swing); rotY aims
  // the curtain across the passage. A soft, diegetic gate cleared with
  // the weapon, not a hard wall. widthM sizes the curtain + its blocking
  // obstacle to the opening it plugs (defaults to a ~1.9m single doorway);
  // a multi-cell '%' run passes its full span so the web fills a wide maw.
  | { kind: 'cobweb'; x: number; z: number; rotY?: number; widthM?: number }
  // 'spike-trap' = pressure-plate hazard. Player steps on the plate;
  // brief telegraph (plate sinks, audible click); spikes shoot up and
  // damage. Resets after a cooldown.
  | { kind: 'spike-trap'; x: number; z: number; damage?: number; telegraphTime?: number }
  // 'fountain' = a basin of liquid.
  //   variant 'gamble'  (default, DUNGEON): DRINK — heals to full.
  //                                          Sickly green basin, but the
  //                                          dungeon is being kind today.
  //   variant 'rest'              (SAFE):    REST — heals to full, warm
  //                                          amber glow, clean refuge.
  //   variant 'tainted'           (SAFE):    DRINK — applies one permanent
  //                                          run-lifetime tainted mutation
  //                                          (TAINTED_MUTATIONS). The deliberate
  //                                          Faustian bargain between acts.
  // One-use per fountain.
  | { kind: 'fountain'; x: number; z: number; rotY?: number; facing?: PropFacing;
      variant?: 'gamble' | 'rest' | 'tainted' }
  // 'merchant' = the wandering hooded trader. Walk up to open the buy-panel
  // and spend run gold on wares rolled from the loot pool for the depth.
  | { kind: 'merchant'; x: number; z: number; rotY?: number }
  // 'tithe-basin' = the UNKNOWN-family altar: place blood/gold/your
  // weapon in the hollow, the dungeon decides what you were worth.
  | { kind: 'tithe-basin'; x: number; z: number }
  // 'reliquary' = locked show-and-tell (PRICED family): the prize
  // floats visible in an iron cage; a skeleton key opens it.
  | { kind: 'reliquary'; x: number; z: number }
  // 'tome-pillar' = a stone pedestal with an open ledger on top, pages
  // lit from within. Interacting opens the CHARACTER screen — the moment
  // to review your delver's shape before stepping deeper.
  | { kind: 'tome-pillar'; x: number; z: number; rotY?: number; facing?: PropFacing }
  | {
      kind: 'starter-altar';
      x: number;
      z: number;
      rotY?: number;
      /** Item id (from src/content/items.ts) to offer on this altar. */
      weaponId: string;
    }
  | {
      kind: 'blood-altar';
      x: number;
      z: number;
      rotY?: number;
      /** Item id (from src/content/items.ts) — the cursed offering. Vault
       *  authors may hand-pick; OMIT it to have the builder roll a cursed item
       *  by depth (rollCursedItem), so a ritual-altar drop scales with the run. */
      itemId?: string;
    }
  // 'hint' = an invisible tutorial trigger. When the player walks
  // within `triggerRadius`, italic in-world text fades in at the
  // trigger's position. Optional `dismissOn` event hook cuts the
  // hint short the moment the player performs the taught action.
  // See src/effects/tutorial-hints.ts.
  | {
      kind: 'hint';
      x: number;
      z: number;
      y?: number;
      text: string;
      triggerRadius?: number;
      lingerMs?: number;
      dismissOn?: 'attack:hit' | 'item:picked-up' | 'enemy:killed';
    }
  // 'group' = a named modular prefab from src/level/prop-groups.ts.
  // The composer looks up the group and expands it into individual
  // PropSpec children at compose time, applying clearance checks so
  // children that would clip into a wall are dropped. Use for
  // atmospheric setpieces (altar-ritual, fountain-shrine, etc.)
  // without forcing every vault to repeat the layout.
  | { kind: 'group'; groupId: string; x: number; z: number; rotY?: number }
  // Specific-mob spawn at a precise sub-cell position. Lets a vault
  // author drop a particular enemy (boss, mini-boss, theme-pinned
  // mob) without needing a per-id tile char in the ASCII map — the
  // tile-char dictionary is finite, this is not. Procgen's boss-slot
  // expansion (B tile) emits one of these per boss floor.
  | { kind: 'spawn'; enemyId: string; x: number; z: number; roomId?: string }
  // Boss-arena fog wall — vertical mist curtain at the threshold of
  // a boss vault. Walking through it seals the arena (the mist
  // becomes a collider) and engages the boss bar. Tinted per boss
  // via the `color` field. The composer places these automatically
  // on boss floors from the boss vault's `bossMist` declaration; a
  // test chamber can also drop one in its props array directly.
  // width/height size the curtain to its doorway so it fully fills the
  // carved gap (a curtain smaller than the opening looks wrong AND lets a
  // tap-raycast slip past it to the boss behind). Default ~3.4m × 4.6m.
  | { kind: 'boss-mist'; x: number; z: number; rotY?: number; color: number; width?: number; height?: number };

// ── Cell-bound entities ───────────────────────────────────────────
// Cell-bound authoring (vault.cellProps) stores entries keyed by
// ASCII cell coords (`${col},${row}`). The x/z fields aren't needed
// in this form — the cell IS the position. Optional `offset` lets
// the author nudge a prop sub-cell (cell-local units, range ~±0.5).
//
// The composer drops the cellProps entries, computes world coords
// from the cell key + offset, and routes each entry to the right
// floor-spec slot by `kind`: 'torch' → torches, 'spawn' → spawns,
// everything else → props.
//
// Same expressive power as the absolute-coord props array, minus
// the world-coord math the author would otherwise have to do.

/** Distributive Omit so the discriminated union is preserved across
 *  each PropSpec variant — without this, `Omit<PropSpec, 'x'|'z'>`
 *  collapses to the shared keys (just `kind`) and the variant-
 *  specific fields like `enemyId` get lost. */
type DistributiveOmit<T, K extends PropertyKey> =
  T extends unknown ? Omit<T, K> : never;

export type CellBoundProp = DistributiveOmit<PropSpec, 'x' | 'z'> & {
  /** Sub-cell nudge in cell-LOCAL meters. (0, 0) = cell center;
   *  ±0.5 = cell edge. Default (0, 0). */
  offset?: [number, number];
};

export type CellBoundTorch = Omit<TorchSpec, 'x' | 'z'> & {
  /** Discriminant so cellProps entries can dispatch by kind. */
  kind: 'torch';
  offset?: [number, number];
};

export type CellBoundEntity = CellBoundProp | CellBoundTorch;

/** Cell key: `${col},${row}`. Whitespace is tolerated by the parser
 *  ("3, 1" works the same as "3,1") so LLM output that wanders into
 *  spaces still resolves. */
export type CellKey = `${number},${number}`;

/** Wall-mounted lit fixture. Variant picked at emission time from
 *  the wall-fixture pool (torch or wall cresset). All variants share
 *  the torch-class light spec so the light pool treats them
 *  identically. */
export type WallFixtureKind = 'torch' | 'wall-cresset' | 'wall-stub';

export type TorchSpec = {
  x: number;
  z: number;
  /** Height above the floor for the torch flame. */
  height: number;
  /** Which wall the torch is mounted on; determines bracket facing. */
  wall: 'N' | 'S' | 'E' | 'W';
  /** Optional hex color override for this torch's light + flame (defaults to CONFIG.TORCH_COLOR). */
  colorTint?: number;
  /** Optional intensity multiplier (defaults to 1). Use 0.5 for a dying/dim torch. */
  intensityMul?: number;
  /** Which wall fixture model to build. Defaults to 'torch' for
   *  every emission path that hasn't rolled the pool yet (legacy
   *  vault parsers, tests). */
  fixtureKind?: WallFixtureKind;
  /** True for torches added by the procedural lighting sprinkler
   *  (lighting-pass.ts). The per-room light budget drops these first
   *  when a room is over-lit; authored torches are never dropped. */
  procedural?: boolean;
};

export type EnemySpawnSpec = {
  /** ID into the ENEMIES content registry (src/content/enemies.ts). */
  enemyId: string;
  x: number;
  z: number;
  /**
   * Optional room association. If provided, the builder uses this directly;
   * otherwise it auto-assigns based on which room rect contains (x,z) at
   * spawn time. Drives "this door opens when ROOM is cleared" gating.
   */
  roomId?: string;
  /**
   * Modifier tag ids (see src/content/modifiers.ts). Stack stat tweaks
   * on this individual spawn — "fierce", "swift", "tough", etc. Empty
   * or absent = no modifiers. Authored levels set them explicitly;
   * procgen rolls them per spawn based on depth.
   */
  modifiers?: string[];
  /**
   * If true, this spawn starts in the `dormant` aiState — no
   * perception, no movement, no idle scan, no vocalisation. Stays
   * dormant until the boss-engagement flag flips (the fog wall is
   * crossed). Used for boss-floor spawns so the boss doesn't aggro
   * the moment the player enters the level; only when they cross
   * into the arena. Debug scenarios that spawn a boss directly
   * leave this off so the bar engages on legacy aggro.
   */
  dormant?: boolean;
};

/**
 * A door — geometry that sits in a doorway, blocks movement while closed,
 * swings open on interaction or when its unlock condition is satisfied.
 *
 * The door is anchored to a wall segment defined by (ax,az)→(bx,bz). The
 * segment must be axis-aligned (either ax==bx or az==bz). Builder centers
 * the door panel on the segment and hinges it on one end.
 */
export type DoorSpec = {
  id: string;
  ax: number; az: number;
  bx: number; bz: number;
  /** Height of the door panel. Defaults to the containing room height. */
  height?: number;
  /**
   * Which end is the hinge — 'a' (the (ax,az) end) or 'b'. Determines swing
   * direction. Default 'a'.
   */
  hinge?: 'a' | 'b';
  /**
   * Which way the door swings open relative to the wall normal. +1 swings
   * one way, -1 the other. Default +1. Tweak per-door if the wrong side
   * opens into a wall.
   */
  swingDir?: 1 | -1;
  /**
   * Unlock condition. If absent, the door opens on first interact.
   *
   * 'cleared': sealed from spawn until every enemy in the listed
   *            rooms is dead.
   * 'arena':   STARTS open + passable; per-tick checks the player's
   *            position against the listed rooms' rects. The moment
   *            the player crosses into one of them the door slams
   *            shut (a closing animation + audio sting). It then
   *            behaves like a cleared-unlock door — opens again
   *            when the rooms are empty. Lock-on-enter behaviour.
   */
  unlock?:
    | { kind: 'cleared'; roomIds: string[] }
    | { kind: 'arena'; roomIds: string[]; trigger?: 'cross' | 'offering' };
};

/**
 * Unified wall-opening fitting (see src/level/opening.ts). One spec for every
 * "thing installed in a doorway" — archway, door, portcullis, boss fog-gate,
 * cobweb — so they share placement + a single seal path instead of each
 * re-deriving coordinates. Position is WORLD-space center + wall-line rotY +
 * gap width; the `kind` selects the behaviour/visual.
 *
 * The ax/az/bx/bz endpoints are carried alongside (computed from the centre +
 * rotY + width) during the migration off DoorSpec, so the door builder's
 * segment math keeps working unchanged; they collapse away once everything is
 * on this spec.
 */
export type OpeningSpec = {
  id: string;
  kind: FittingKind;
  x: number; z: number;        // world centre of the gap
  rotY: number;                // wall-line orientation
  widthM: number;              // span of the gap
  height?: number;             // opening height (frame/lintel); default room height
  edge?: Edge;                 // provenance — which vault edge (fog-gate needs it)
  /** Segment endpoints (transitional — derived from centre/rotY/width). */
  ax?: number; az?: number; bx?: number; bz?: number;
  /** Portcullis unlock condition (gate-cleared / gate-arena). For an arena,
   *  `trigger` selects what seals it: 'cross' (default — the trap, player
   *  walks in) or 'offering' (the challenge — a loot offering activates it). */
  unlock?:
    | { kind: 'cleared'; roomIds: string[] }
    | { kind: 'arena'; roomIds: string[]; trigger?: 'cross' | 'offering' };
  /** Fog-gate tint (per-boss identity). */
  color?: number;
  /** Hinged-door swing config. */
  hinge?: 'a' | 'b';
  swingDir?: 1 | -1;
};

/**
 * Stairs descending to another level. On interact, the engine fades out
 * the current level and loads `targetLevel` from the LEVELS registry.
 * Player state (HP, inventory, equipment, buffs) carries forward; the
 * world is rebuilt.
 */
export type StairsSpec = {
  id?: string;
  x: number;
  z: number;
  rotY?: number;
  /** Key into LEVELS registry (src/level/specs.ts). */
  targetLevel: string;
  /**
   * Unlock gate. If absent, stairs are always usable.
   *
   * 'has-equipment': stairs show a SEALED prompt and reject use until
   * the player has something equipped in the named slot. Used by the
   * starter chamber to enforce "pick a weapon before descending."
   *
   * 'boss-defeated': the descent is SEALED until the floor's boss
   * encounter completes. While sealed it gives off no warm invite — a
   * taut ward in `color` (the boss's signature hue) caps the mouth; the
   * kill shatters it and the welcoming light blooms. Auto-applied to a
   * boss floor's descent by the builder.
   */
  unlock?:
    | { kind: 'has-equipment'; slot: 'weapon' | 'offhand' }
    | { kind: 'boss-defeated'; color?: number };
};

/**
 * A nav gate — the passable band of a framed opening (archway columns /
 * doorframe jambs), registered by whoever emits the frame. Pathfinding
 * treats the CENTRE as a guaranteed waypoint (funnel point): paths are
 * snapped through it instead of grazing the columns, and a mob whose
 * radius exceeds halfBand is honestly refused. A 0.5m sampling grid
 * cannot represent a 1.3m gap between columns reliably; the gate is the
 * ground truth the grid lacks.
 */
export type NavGate = {
  x: number;
  z: number;
  /** Wall-line orientation (same convention as OpeningSpec.rotY): the
   *  gate's band runs along its local +X. */
  rotY: number;
  /** Half of the passable width between the frame's blockers. */
  halfBand: number;
};

export type LevelSpec = {
  id: string;
  /**
   * Deterministic per-floor seed for build-time randomness (geometry jitter,
   * prop variants, loot placement). Procgen sets it from its floor seed;
   * hand-authored floors leave it undefined and the builder derives a stable
   * seed from the id. Makes a seeded run's floors reproducible.
   */
  seed?: number;
  /** Player spawn — position + initial yaw (radians). */
  startPos: { x: number; z: number; yaw: number };
  /**
   * 1-based floor depth. Feeds the difficulty-scaling pipeline
   * (src/content/modifiers.ts) which multiplies mob HP / damage /
   * reward at spawn time. Hand-authored floors set this explicitly;
   * procgen sets it from the generation seed input. Defaults to 1.
   */
  depth?: number;
  /**
   * Optional display name for the floor — shown in a brief title card on
   * descent. Leave undefined to skip the title card.
   */
  displayName?: string;
  rooms: RoomSpec[];
  /** corridors share types with rooms — keeping separate field for future
   *  wall-skipping logic where corridors meet rooms. */
  corridors: RoomSpec[];
  props: PropSpec[];
  torches: TorchSpec[];
  spawns: EnemySpawnSpec[];
  /** Doors that block passage until interacted with or unlocked. */
  doors?: DoorSpec[];
  /** Unified wall-opening fittings (archway / door / portcullis / fog-gate /
   *  cobweb). Migrating target for `doors` + the boss-mist/cobweb props. */
  openings?: OpeningSpec[];
  /** Stairs leading to other floors. */
  stairs?: StairsSpec[];
  /**
   * Provenance map: room id (`vault-0`, `branch-2`) → the vault TEMPLATE
   * name that generated it (`lattice`, `blood-altar-chamber`). Populated
   * by the vault composer; absent on hand-authored floors. Read by the
   * debug capture tool to report which vault the player is standing in.
   */
  roomVaults?: Record<string, string>;
  /**
   * Optional per-floor fog tint. Overrides the global CONFIG.FOG_COLOR.
   * Reinforces the floor's identity at distance: blood crypt = red-
   * tinted fog, drowned hall = teal, etc. Cheap atmospheric depth.
   */
  fogColor?: number;
  /**
   * Extra wall segments BEYOND the auto-generated room-perimeter walls.
   * Used by the tile-map parser to express interior walls (between '#'
   * cells and walkable cells). Each segment becomes a rendered wall
   * plane AND a collision segment. Segments must be axis-aligned.
   *
   * `baseY` lifts the plane off the floor — used for a LINTEL across the
   * top of a doorway. An elevated segment (baseY > 0) is VISUAL ONLY (no
   * collision): the gap below it stays walkable so you can pass through
   * the door, but the opening is framed instead of an empty slot to the
   * ceiling.
   */
  extraWalls?: Array<{ ax: number; az: number; bx: number; bz: number; height?: number; baseY?: number }>;
  /**
   * Chasm voids — rectangular floor holes the player can't cross (the floor
   * is cut, an edge barrier blocks entry, and drop geometry shows the abyss).
   * A flat playfield reads as vertical without any player-Y simulation: you
   * skirt the void, or cross a bridge (an ordinary walkable floor gap between
   * two voids). World coords. See builder.ts + ensureStairsReachable.
   */
  voids?: WalkableRect[];
  /** Framed-opening funnel points for pathfinding — pushed by every
   *  frame emitter alongside its prop. See NavGate. */
  navGates?: NavGate[];
  /**
   * Procgen decoration data — populated tilemap grid + seeded RNG state +
   * tint. Builder calls decorateFloor with this if present, producing
   * InstancedMesh batches of sigils / cracks / rubble. Hand-authored
   * levels leave this undefined.
   */
  procgenDecor?: {
    grid: TileMap;
    seed: number;
    tint: number;
  };
};
