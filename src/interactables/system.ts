import * as THREE from 'three';
import type { Interactable } from './types';

// Interactable runtime. Holds the live list of interactables; each frame, the
// main loop calls tick() with the player position. The system computes which
// interactable (if any) is currently in range and exposes it for the prompt
// overlay + use-button handler.

const interactables: Interactable[] = [];
let currentInRange: Interactable | null = null;

export function registerInteractable(i: Interactable) {
  interactables.push(i);
}

export function unregisterInteractable(id: string) {
  const idx = interactables.findIndex((i) => i.id === id);
  if (idx >= 0) interactables.splice(idx, 1);
}

/** The nearest in-range interactable, or null. The HUD reads this. */
export function getInRangeInteractable(): Interactable | null {
  return currentInRange;
}

/**
 * Run each frame. Ticks per-interactable animation, removes destroyed ones,
 * and updates currentInRange based on the player's XZ position.
 */
export function tickInteractables(dt: number, playerPos: THREE.Vector3) {
  // Tick + collect surviving
  let i = 0;
  while (i < interactables.length) {
    const it = interactables[i];
    it.tick?.(dt);
    if (it.destroyed) {
      // Clean up meshes from the scene
      if (it.built) {
        const parent = it.built.group.parent;
        parent?.remove(it.built.group);
      }
      interactables.splice(i, 1);
    } else {
      i++;
    }
  }

  // Pick the closest in-range
  let nearest: Interactable | null = null;
  let nearestD = Infinity;
  for (const it of interactables) {
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    const d = Math.hypot(dx, dz);
    if (d <= it.radius && d < nearestD) {
      nearest = it;
      nearestD = d;
    }
  }
  currentInRange = nearest;
}

/** Fire the current in-range interactable's onUse handler (called by the USE button). */
export function pressUse() {
  if (currentInRange) currentInRange.onUse();
}

/** Reset state — used by tests / scene rebuilds. */
export function clearInteractables() {
  interactables.length = 0;
  currentInRange = null;
}

/** Debug-only: fire onUse on every interactable. Used by scenarios. */
export function debugUseAll() {
  for (const it of interactables) it.onUse();
}

/** Debug-only: advance all interactable animations by `seconds` (single big step). */
export function debugTickAll(seconds: number) {
  for (const it of interactables) it.tick?.(seconds);
}
