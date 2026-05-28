import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Interactable } from './types';

// Interactable runtime. Holds the live list of interactables; each frame, the
// main loop calls tick() with the player position + forward direction. The
// system computes which interactable (if any) is currently in range AND in
// the player's forward cone, and exposes it for the prompt overlay + use-
// button handler. Facing matters: the player shouldn't get a TAKE prompt for
// loot directly behind them.

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

/** Read-only snapshot of the live interactables list. Used by tap-target
 *  resolution to know what's eligible for a screen-tap raycast. */
export function getAllInteractables(): readonly Interactable[] {
  return interactables;
}

/**
 * Run each frame. Ticks per-interactable animation, removes destroyed ones,
 * and updates currentInRange based on player position AND forward direction.
 * @param playerForward unit XZ direction the camera is looking (Y ignored).
 */
export function tickInteractables(dt: number, playerPos: THREE.Vector3, playerForward: THREE.Vector3) {
  // Tick + collect surviving
  let i = 0;
  while (i < interactables.length) {
    const it = interactables[i];
    it.tick?.(dt, playerPos);
    if (it.destroyed) {
      // 1) Owner-supplied cleanup (obstacles, subscriptions, lights, etc.).
      //    Runs BEFORE the auto-remove of built.group so the callback can
      //    still see the live scene-graph if it needs to.
      it.onDestroy?.();
      // 2) Auto-remove the visible mesh tree, UNLESS the owner asked to
      //    keep some of it standing (e.g. starter altars: the stone
      //    block stays as a monument after the weapon offer is taken).
      if (it.built && !it.keepBuiltOnDestroy) {
        const parent = it.built.group.parent;
        parent?.remove(it.built.group);
      }
      interactables.splice(i, 1);
    } else {
      i++;
    }
  }

  // Forward direction projected onto the XZ plane (Y ignored for the cone check).
  const fxRaw = playerForward.x;
  const fzRaw = playerForward.z;
  const fLen = Math.hypot(fxRaw, fzRaw);
  // If the player is looking straight up/down (rare), don't filter by cone —
  // they'd just never be "facing" any interactable.
  const useCone = fLen > 0.01;
  const fx = useCone ? fxRaw / fLen : 0;
  const fz = useCone ? fzRaw / fLen : 0;
  const dotMin = Math.cos(CONFIG.INTERACT_CONE_HALF_ANGLE);

  // Pick the closest in-range that's ALSO in the forward cone.
  let nearest: Interactable | null = null;
  let nearestD = Infinity;
  for (const it of interactables) {
    // Empty promptLabel = interactable is currently inert (e.g. an open chest
    // that was already used). Don't show its prompt or claim the USE button.
    if (!it.promptLabel) continue;
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    const d = Math.hypot(dx, dz);
    if (d > it.radius) continue;
    if (useCone && d > 0.01) {
      const dot = (fx * dx + fz * dz) / d;
      if (dot < dotMin) continue;
    }
    if (d < nearestD) {
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

/** Debug-only: advance all interactable animations by `seconds` (single big step).
 *  Player pos defaults to origin for the debug path — most ticks don't read it. */
export function debugTickAll(seconds: number) {
  const origin = new THREE.Vector3();
  for (const it of interactables) it.tick?.(seconds, origin);
}
