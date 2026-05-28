// Declarative level data. A level is just JSON-ish — could be hand-authored,
// loaded from a file, or procedurally generated. The buildLevel() function in
// builder.ts consumes one of these and produces the live scene.
//
// All coordinates are world-space XZ unless otherwise noted. Y is computed
// from props' implicit shapes (floors at y=0, ceilings at level height, etc.).

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
 *  the offset is rotated by the prop's rotY at build time. */
export type PropCollision =
  | { kind: 'circle'; r: number; ox?: number; oz?: number }
  | { kind: 'aabb'; halfW: number; halfD: number; ox?: number; oz?: number };

export type RoomSpec = {
  id: string;
  /** The walkable rectangle for this room. Walls are built on its perimeter. */
  rect: WalkableRect;
  height: number;
};

export type PropSpec =
  | { kind: 'pillar'; x: number; z: number; size?: number }
  | { kind: 'altar'; x: number; z: number }
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
      collision?: PropCollision | PropCollision[];
    }
  // 'chest' = an openable container. When the player interacts, the lid swings
  // up and an optional loot pickup spawns beside it.
  | { kind: 'chest'; x: number; z: number; rotY?: number; loot?: import('../content/items').ItemSpec }
  // 'stash-chest' = the meta-progression stash entry point. Lives in
  // the safe room. Interacting opens the stash UI (loot boxes saved
  // across runs).
  | { kind: 'stash-chest'; x: number; z: number; rotY?: number }
  // ── Non-combat encounters ────────────────────────────────────────
  // 'corpse' = a slumped body with a note. Walk up, read it. Pure
  // atmosphere + (later) LLM-pluggable lore. The note text is short
  // and in the in-world grimdark tone.
  | { kind: 'corpse'; x: number; z: number; rotY?: number; note: string }
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
  // 'spike-trap' = pressure-plate hazard. Player steps on the plate;
  // brief telegraph (plate sinks, audible click); spikes shoot up and
  // damage. Resets after a cooldown.
  | { kind: 'spike-trap'; x: number; z: number; damage?: number; telegraphTime?: number }
  // 'fountain' = a basin of suspect liquid. DRINK to gamble: half the
  // time it heals to full; half the time it curses you (lasting debuff
  // for the rest of the run). One-use per fountain.
  | { kind: 'fountain'; x: number; z: number; rotY?: number }
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
  | { kind: 'group'; groupId: string; x: number; z: number; rotY?: number };

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
   * 'cleared': all enemies in the listed rooms must be dead. Until then
   * the door shows no interact prompt (sealed / SEALED label).
   */
  unlock?:
    | { kind: 'cleared'; roomIds: string[] };
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
};

export type LevelSpec = {
  id: string;
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
  /** Stairs leading to other floors. */
  stairs?: StairsSpec[];
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
   */
  extraWalls?: Array<{ ax: number; az: number; bx: number; bz: number; height?: number }>;
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
