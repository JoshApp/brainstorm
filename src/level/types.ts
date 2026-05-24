// Declarative level data. A level is just JSON-ish — could be hand-authored,
// loaded from a file, or procedurally generated. The buildLevel() function in
// builder.ts consumes one of these and produces the live scene.
//
// All coordinates are world-space XZ unless otherwise noted. Y is computed
// from props' implicit shapes (floors at y=0, ceilings at level height, etc.).

export type Vec2 = { x: number; z: number };

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
  | { kind: 'altar'; x: number; z: number };

export type TorchSpec = {
  x: number;
  z: number;
  /** Height above the floor for the torch flame. */
  height: number;
  /** Which wall the torch is mounted on; determines bracket facing. */
  wall: 'N' | 'S' | 'E' | 'W';
};

export type EnemySpawnSpec = {
  type: 'shambler';  // future: 'skirmisher' etc.
  x: number;
  z: number;
};

export type LevelSpec = {
  id: string;
  /** Player spawn — position + initial yaw (radians). */
  startPos: { x: number; z: number; yaw: number };
  rooms: RoomSpec[];
  /** corridors share types with rooms — keeping separate field for future
   *  wall-skipping logic where corridors meet rooms. */
  corridors: RoomSpec[];
  props: PropSpec[];
  torches: TorchSpec[];
  spawns: EnemySpawnSpec[];
};
