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
  /** Player must be within this distance (XZ-plane) to interact. */
  radius: number;
  /** Short verb shown on the prompt: 'OPEN' / 'TAKE' / 'USE' / etc. */
  promptLabel: string;
  /** Called when the player presses USE while in range. */
  onUse: () => void;
  /** Optional: called every frame (for animation like the chest lid swinging). */
  tick?: (dt: number) => void;
  /** If true, the interactable is gone (removed from the system at the next tick). */
  destroyed?: boolean;
  /** Optional: live mesh model for cleanup on destroy. */
  built?: BuiltModel;
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
