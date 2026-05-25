import type { ModelSpec } from '../ecs/model-types';

// The pickup module needs to swap the wielded weapon when a weapon item is
// taken, but it shouldn't import the sword controller directly (and the
// sword controller is created with the camera, not globally accessible).
// Same shape as the player-death callback pattern.

type Handler = (spec: ModelSpec) => void;

let handler: Handler | null = null;

export function onEquipWeapon(fn: Handler) {
  handler = fn;
}

export function equipWeapon(spec: ModelSpec) {
  handler?.(spec);
}
