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

export type RoomSpec = {
  id: string;
  /** The walkable rectangle for this room. Walls are built on its perimeter. */
  rect: WalkableRect;
  height: number;
};

export type PropSpec =
  | { kind: 'pillar'; x: number; z: number; size?: number }
  | { kind: 'altar'; x: number; z: number }
  // 'model' = any ModelSpec placed in the world as static decoration. No
  // collision, no behavior — just visuals. Use for relics, debris, sigils,
  // anything atmospheric that doesn't move or react.
  | { kind: 'model'; model: import('../ecs/model-types').ModelSpec; x: number; y: number; z: number; rotY?: number; rotX?: number; rotZ?: number }
  // 'chest' = an openable container. When the player interacts, the lid swings
  // up and an optional loot pickup spawns beside it.
  | { kind: 'chest'; x: number; z: number; rotY?: number; loot?: import('../content/items').ItemSpec }
  // ── Non-combat encounters ────────────────────────────────────────
  // 'corpse' = a slumped body with a note. Walk up, read it. Pure
  // atmosphere + (later) LLM-pluggable lore. The note text is short
  // and in the in-world grimdark tone.
  | { kind: 'corpse'; x: number; z: number; rotY?: number; note: string }
  // 'spike-trap' = pressure-plate hazard. Player steps on the plate;
  // brief telegraph (plate sinks, audible click); spikes shoot up and
  // damage. Resets after a cooldown.
  | { kind: 'spike-trap'; x: number; z: number; damage?: number; telegraphTime?: number }
  // 'fountain' = a basin of suspect liquid. DRINK to gamble: half the
  // time it heals to full; half the time it curses you (lasting debuff
  // for the rest of the run). One-use per fountain.
  | { kind: 'fountain'; x: number; z: number; rotY?: number };

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
   * Extra wall segments BEYOND the auto-generated room-perimeter walls.
   * Used by the tile-map parser to express interior walls (between '#'
   * cells and walkable cells). Each segment becomes a rendered wall
   * plane AND a collision segment. Segments must be axis-aligned.
   */
  extraWalls?: Array<{ ax: number; az: number; bx: number; bz: number; height?: number }>;
};
