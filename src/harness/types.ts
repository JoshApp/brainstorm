// Shared types for the harness.
//
// The Observation / Action / ActionResult types are the public contract
// between the in-game module (this file's neighbours) and external
// drivers (devtools console, scripts/play.ts, future LLM client).
//
// Kept in one file so the contract is reviewable at a glance.

import type { BudgetEndReason } from './pause';

// ── Observation ───────────────────────────────────────────────────────

export type Direction8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type EntityState =
  | 'idle' | 'alert' | 'chasing' | 'winding' | 'striking'
  | 'recovering' | 'searching' | 'returning' | 'dying' | 'dead';

export interface ObservedEnemy {
  id: string;
  kind: string;
  pos: { x: number; z: number };
  /** Metres from player camera (XZ plane). */
  distance: number;
  /** Bearing relative to player facing, radians. 0 = ahead, +π/2 = right. */
  bearing: number;
  /** Compass direction from player, world-space. */
  compass: Direction8;
  state: EntityState | string;
  hp: { current: number; max: number };
  /** Omniscient flags — drivers can self-restrict for fair-play questions. */
  inLight: boolean;
  inSight: boolean;
  inCone: boolean;
}

export interface ObservedInteractable {
  id: string;
  kind: string;
  pos: { x: number; z: number };
  distance: number;
  bearing: number;
  compass: Direction8;
  state: string;
  inRange: boolean;
  inSight: boolean;
}

export interface ObservedPickup {
  id: string;
  kind: string;
  pos: { x: number; z: number };
  distance: number;
  bearing: number;
  compass: Direction8;
  inSight: boolean;
}

export interface Observation {
  /** Monotonic action count since boot. */
  turn: number;
  /** Accumulated unpaused game-time seconds since boot. */
  tickClock: number;
  depth: number;
  floorId: string;
  roomId: string | null;
  pausedReason: 'harness' | 'hit' | 'screen' | 'debug' | 'transition' | null;

  player: {
    pos: { x: number; z: number; y: number };
    facingYaw: number;
    /** Radians of yaw per unit of look input (= the look sensitivity). A driver
     *  turns `dTheta` radians by issuing lookDx = dTheta / lookRadiansPerUnit;
     *  without it a bot can't know how hard to turn (raw lookDx is a pixel-ish
     *  delta whose scale depends on the player's sensitivity setting). */
    lookRadiansPerUnit: number;
    hp: { current: number; max: number };
    buffs: string[];
    equipped: Record<string, string | null>;
  };

  light: {
    /** 0..1 sum of attenuated active sources at the player position. */
    atPlayer: number;
    /** Count of registered light sources within reach (not just bound). */
    nearbySources: number;
  };

  visible: {
    enemies: ObservedEnemy[];
    interactables: ObservedInteractable[];
    pickups: ObservedPickup[];
  };

  geometry: {
    /** Raycast wall distance per 8-cardinal, metres. Infinity = no wall in reach. */
    walls8: Record<Direction8, number>;
  };
}

// ── Action ────────────────────────────────────────────────────────────

export type Action =
  | { kind: 'move'; dir: Direction8; seconds?: number }
  | { kind: 'turn'; angle: number }                       // relative radians
  | { kind: 'face'; target: Direction8 | { id: string } }
  | { kind: 'attack' }
  | { kind: 'interact' }
  | { kind: 'use'; slot: number }
  | { kind: 'wait'; seconds: number }
  | { kind: 'inspect'; id: string };

export interface ActionResult {
  ok: boolean;
  /** Reason for !ok or for early termination. */
  reason?: string;
  /** How the underlying tick budget ended (timeout / predicate / cancelled). */
  budgetEnd?: BudgetEndReason;
  /** Real seconds the world ran for this action. */
  elapsed: number;
  /** Post-action snapshot. Always present, even on !ok. */
  observation: Observation;
}

// ── Screenshot ────────────────────────────────────────────────────────

export interface Annotation {
  id: string;
  kind: string;
  label: string;
  /** Pixel-space bounding box on the rendered frame. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Was this entity considered visible (LOS, cone, lit)? */
  visible: boolean;
}

export interface Screenshot {
  /** PNG data URL of the (optionally annotated) frame. */
  pngDataUrl: string;
  /** Width × height in CSS pixels. */
  size: { w: number; h: number };
  /** Camera state at capture. */
  camera: { pos: { x: number; y: number; z: number }; yaw: number; pitch: number };
  annotations: Annotation[];
}

// ── Public API surface (for typing window.harness) ────────────────────

export interface HarnessApi {
  /** Resolves once the harness is fully wired into a live level. */
  ready: Promise<void>;
  observe(): Observation;
  act(action: Action): Promise<ActionResult>;
  screenshot(opts?: { annotated?: boolean }): Promise<Screenshot>;
  /** Read-only inspection helpers — no time cost, never unpause. */
  state(): {
    booted: boolean;
    turn: number;
    tickClock: number;
    paused: boolean;
  };
  /** Flood-fill the live walkable region from spawn (real collision radius)
   *  and report whether each stair is reachable — faithful soft-lock check. */
  reachability(): { ok: boolean; reachableCells: number; stairs: Array<{ x: number; z: number; reachable: boolean; minDist: number }> };
  /** Force-pause (default) / force-unpause without running an action. */
  pause(): void;
  resume(): void;
  /** PWA update status: 'pending' = a new SW is installed and waiting
   *  to activate. Reads through to src/pwa-update.ts. */
  updateStatus(): 'none' | 'pending';
  /** Apply a pending PWA update (SKIP_WAITING + reload). The CLI driver
   *  calls this between episodes when it's safe to take a new build. */
  applyUpdate(): Promise<void>;
  /** Built-in dumb-AI bot — runs autonomous loops, yields control on
   *  conditions you care about. See src/harness/bot.ts for the
   *  RunOpts shape. */
  bot: {
    step(obs: Observation): Action;
    run(opts?: {
      maxTurns?: number;
      until?: (obs: Observation, result: ActionResult, turn: number) => boolean | string;
      onStep?: (obs: Observation, result: ActionResult, turn: number) => void | Promise<void>;
    }): Promise<{ turns: number; stopReason: string; transcript: ActionResult[] }>;
  };
}
