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
  // Auto-pickup pass FIRST (so a grabbed item is destroyed before the cleanup
  // loop below removes it — same-frame, no lingering mesh). Walk-over collection
  // for decision-free items (consumables flag autoPickup). No tap, no facing:
  // within AUTO_PICKUP_RADIUS + canUse() (a full bag leaves it on the floor, and
  // a flying item has no promptLabel yet so it isn't grabbed mid-arc). onUse
  // gives the normal pickup chime, so a collected potion still reads as an event.
  const autoR2 = CONFIG.AUTO_PICKUP_RADIUS * CONFIG.AUTO_PICKUP_RADIUS;
  for (const it of interactables) {
    if (!it.autoPickup || !it.promptLabel || it.destroyed) continue;
    if (it.canUse && !it.canUse()) continue;
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    if (dx * dx + dz * dz <= autoR2) it.onUse();
  }

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
        // Dispose the per-instance MATERIALS before detaching. buildModel mints
        // fresh materials (+ their shader programs / uniforms) per model, so
        // just removing the group leaked them every time a pickup was collected
        // or a destructible broke — invisible to the JS heap (GPU-side), but it
        // climbs all session and drags the renderer down until a context-loss
        // (tab-out) frees it. Geometry is left alone: buildModel SHARES pooled
        // primitives across instances, so disposing it would corrupt live models.
        it.built.group.traverse((o) => {
          const mm = o as THREE.Mesh;
          const mats = Array.isArray(mm.material) ? mm.material : (mm.material ? [mm.material] : []);
          for (const m of mats) m.dispose();
        });
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

  // Pick the BEST in-range + in-cone interactable, ranked by `priority` first
  // (pickup > descend > other — see INTERACT_PRIORITY), then by distance. This
  // is what makes a tap reach for loot over the stairs you're standing on.
  // Track the best ELIGIBLE one separately and prefer it: if a blocked item (a
  // full-carry potion) overlaps takeable loot, the prompt + auto-use should
  // point at the thing you can actually take. Fall back to the best of any kind
  // so a lone blocked item still prompts (and its onUse can explain itself).
  let best: Interactable | null = null;
  let bestPr = -Infinity, bestD = Infinity;
  let bestUsable: Interactable | null = null;
  let bestUsablePr = -Infinity, bestUsableD = Infinity;
  for (const it of interactables) {
    // Empty promptLabel = interactable is currently inert (e.g. an open chest
    // that was already used). Don't show its prompt or claim the USE button.
    if (!it.promptLabel) continue;
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    // Squared-distance reject first — the sqrt only runs for the handful of
    // items actually within reach (this loop runs every frame over all loot).
    const d2 = dx * dx + dz * dz;
    if (d2 > it.radius * it.radius) continue;
    const d = Math.sqrt(d2);
    if (useCone && d > 0.01) {
      const dot = (fx * dx + fz * dz) / d;
      if (dot < dotMin) continue;
    }
    const pr = it.priority ?? 0;
    // Higher priority wins; equal priority → the nearer one.
    if (pr > bestPr || (pr === bestPr && d < bestD)) {
      best = it; bestPr = pr; bestD = d;
    }
    if ((pr > bestUsablePr || (pr === bestUsablePr && d < bestUsableD))
        && (it.canUse ? it.canUse() : true)) {
      bestUsable = it; bestUsablePr = pr; bestUsableD = d;
    }
  }
  currentInRange = bestUsable ?? best;
}

/**
 * Given the interactable the player aimed at (a tap result, or the in-range
 * target), return the one to actually USE. If the aimed object is currently
 * ineligible (canUse() false — e.g. a carry-full potion), fall through to the
 * nearest ELIGIBLE interactable overlapping the same spot, so an item lying on
 * top can't trap the loot beneath it. If nothing else is eligible, returns the
 * aimed object unchanged (so its onUse can still surface feedback).
 */
export function resolveUsable(aimed: Interactable, playerPos: THREE.Vector3): Interactable {
  if (aimed.canUse ? aimed.canUse() : true) return aimed;
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const it of interactables) {
    if (it === aimed || !it.promptLabel) continue;
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > it.radius * it.radius) continue;
    if (it.canUse ? !it.canUse() : false) continue;
    if (d2 < bestD) { best = it; bestD = d2; }
  }
  return best ?? aimed;
}

/** Fire the current in-range interactable's onUse handler (called by the USE button). */
export function pressUse() {
  if (currentInRange) currentInRange.onUse();
}

/** Reset state — used by tests / scene rebuilds. */
export function clearInteractables() {
  // Level teardown: run each LIVE interactable's cleanup before dropping the
  // list. onDestroy is the owner's teardown hook (unsubscribe, unregister
  // lights, dispose meshes) — normally fired by tickInteractables when an
  // interactable marks itself destroyed mid-play. Anything STILL live at
  // descent (an unopened chest, an unchosen starter altar, a fountain) never
  // hit that path, so its cleanup leaked every floor — most visibly the
  // starter altar's `starter:chosen` subscription, retained forever. Iterate a
  // copy: an onDestroy may unregister another interactable.
  for (const it of [...interactables]) it.onDestroy?.();
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
