import type * as THREE from 'three';
import type { ModelSpec } from '../ecs/model-types';
import type { EntityId } from '../ecs/types';
import type { BuiltModel } from '../ecs/build-model';

// An interactable is anything the player can walk up to and "use" — chest,
// door, altar, lever, pickup item. Each has a position, a trigger radius,
// a prompt label ("OPEN" / "TAKE" / "PRAY"), and an onUse callback that
// runs when the player presses the use button while in range.

export interface Interactable {
  /** Stable id (used to look up state across frames). */
  id: EntityId;
  /** World position of the interactable's pivot. */
  position: THREE.Vector3;
  /** Player must be within this distance (XZ-plane) to interact — both the
   *  walk-up prompt and a tap (direct or near-miss) gate on this. */
  radius: number;
  /** Short verb shown on the prompt: 'OPEN' / 'TAKE' / 'USE' / etc. */
  promptLabel: string;
  /** Called when the player presses USE while in range. */
  onUse: () => void;
  /**
   * Optional eligibility check. When it returns false the object is "in
   * the way but can't be taken right now" — e.g. a consumable when the
   * carry slot is full. Selection + tap resolution prefer an ELIGIBLE
   * interactable at the same spot, so a blocked item lying on top of
   * loot can't trap the item beneath it. Omitted = always usable.
   */
  canUse?: () => boolean;
  /**
   * Optional: called every frame. Receives dt + the current player XZ
   * position so proximity-driven interactables (traps, pressure plates,
   * auras) can react without importing the camera.
   */
  tick?: (dt: number, playerPos: THREE.Vector3) => void;
  /** If true, the interactable is gone (removed from the system at the next tick). */
  destroyed?: boolean;
  /** Optional: live mesh model for cleanup on destroy. */
  built?: BuiltModel;
  /**
   * Cleanup hook fired when the system observes destroyed=true. Runs
   * BEFORE the auto-removal of built.group (if any). Use for state
   * that lives OUTSIDE built.group: collision-obstacle entries the
   * builder pushed into the level's obstacles array, event-bus
   * subscriptions, registered lights, etc.
   *
   * If you ALSO want to keep some of the built.group children visible
   * after destruction (e.g. the stone altar stays as a monument even
   * though the floating weapon offer is gone), set keepBuiltOnDestroy
   * and remove the specific children yourself in onDestroy.
   */
  onDestroy?: () => void;
  /**
   * If true, the system does NOT auto-remove built.group on destroy.
   * Pair with onDestroy to perform a partial removal yourself.
   */
  keepBuiltOnDestroy?: boolean;
  /**
   * Optional multiplier for the in-range outline scale (default 1.07).
   * Tiny items (a ring on the floor) need ~1.4 to read; large objects
   * (a door panel) are fine at the default.
   */
  outlineScale?: number;
  /**
   * Optional vertical offset (in metres) above `position.y` where the
   * floating interact label should appear. Defaults to 0.6 — fine for
   * chest-height objects (loot, chests, altar). Override for tall
   * things like doors (≈ 1.4) and stairs (≈ 0.8) so the label sits
   * over the object's middle, not at its feet.
   */
  labelOffsetY?: number;
  /**
   * Optional floating-NAME label drawn over this interactable at all
   * times while it's on-screen and within view distance (handled by
   * src/ui/world-labels.ts). Reads as "what is this thing" at a glance
   * — distinct from `promptLabel` (the verb shown when in range +
   * focused). Fades with distance, suppressed while this is the
   * in-range target (the prompt overlay covers it).
   *
   * Use short, terse names — "FOUNTAIN", "STASH", "TOME". The label is
   * italic serif and small; long strings will dwarf the silhouette.
   *
   * Omit for interactables that don't read well as static labels —
   * pickups (already have an item card), corpses (the note IS the
   * payload), doors (the room is the read).
   */
  nameLabel?: string;
}

/** Spec for a level-spec-placed interactable. Engine-agnostic data. */
export interface InteractableSpec {
  kind: 'chest' | 'pickup';
  /** The visual model for this interactable. */
  model: ModelSpec;
  x: number;
  y: number;
  z: number;
  rotY?: number;
  /** For 'chest': what loot model to spawn beside it when opened. */
  loot?: ModelSpec;
}
