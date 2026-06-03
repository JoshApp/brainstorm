import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Enemy } from '../mobs/enemy';
import type { Interactable } from '../interactables/types';

// Tap-target resolver.
//
// On phone, players REACH for what they see — many testers tap directly
// on a chest / corpse / fountain / enemy expecting it to react, ignoring
// the side-of-screen tap zone. This module raycasts from the screen tap
// into the scene and returns what the player intended:
//
//   - 'interactable' → use that thing (must be in range)
//   - 'enemy'        → attack toward it
//   - null           → fall through to the legacy tap-side behavior
//
// Callers (input.ts touchend, attack-input mouse click) feed in the
// touch's pixel coords + canvas; we convert to NDC and run a single
// raycast against the candidate roots.
//
// Two-pass resolution: (1) precise raycast against actual mesh
// geometry — best for hit-targeting; (2) if the raycast misses, a
// screen-space proximity fallback for interactables (NOT enemies)
// finds the closest interactable's projected position within
// CONFIG.INTERACT_TAP_PROXIMITY_PX. The fallback is what makes thin
// floating weapons (starter-altar daggers etc.) tappable without
// pixel-perfect aim. The caller gates the result on the interactable's
// own range, so this just answers "what did the player aim at".

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpVec = new THREE.Vector3();

export type TapTarget =
  | { kind: 'enemy'; enemy: Enemy }
  | { kind: 'interactable'; interactable: Interactable };

export function findTapTarget(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  enemies: readonly Enemy[],
  interactables: readonly Interactable[],
): TapTarget | null {
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width)  * 2 - 1,
    -((clientY - rect.top)  / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  // Collect candidate roots — alive enemies + all registered interactable
  // built.groups. Interactables without geometry (rare; bare prompts)
  // are skipped.
  const enemyRoots: THREE.Object3D[] = [];
  for (const e of enemies) {
    // A dormant boss (asleep behind its fog gate) is NOT a tap-attack
    // target — a tap aimed at the gate must reach the gate, not swing at
    // the boss looming behind the curtain.
    if (e.alive && !e.dormant) enemyRoots.push(e.group);
  }
  const interactableRoots: Array<{ root: THREE.Object3D; it: Interactable }> = [];
  for (const it of interactables) {
    if (it.destroyed) continue;
    if (!it.built?.group) continue;
    // Don't allow tap-use on locked doors or unsettled pickups.
    if (!it.promptLabel) continue;
    interactableRoots.push({ root: it.built.group, it });
  }
  if (enemyRoots.length + interactableRoots.length === 0) return null;
  const candidates: THREE.Object3D[] = [
    ...enemyRoots,
    ...interactableRoots.map(r => r.root),
  ];
  const hits = raycaster.intersectObjects(candidates, true);

  if (hits.length > 0) {
    // The first hit is the closest. Walk parents until we find a known
    // root and resolve to enemy or interactable.
    const hitObj = hits[0].object;
    // Check enemies first — tap-on-enemy almost always means "attack
    // this thing", even if it overlaps an interactable visually.
    for (const e of enemyRoots) {
      if (isDescendantOrSelf(hitObj, e)) {
        const enemy = enemies.find(en => en.group === e);
        if (enemy) return { kind: 'enemy', enemy };
      }
    }
    for (const r of interactableRoots) {
      if (isDescendantOrSelf(hitObj, r.root)) {
        return { kind: 'interactable', interactable: r.it };
      }
    }
  }

  // ── Screen-space proximity fallback for interactables ─────────────
  // Thin floating viewmodels (starter-altar daggers, rapiers etc.)
  // miss the precise raycast above on most taps. Project each
  // interactable's position to screen space and pick the closest
  // within PROXIMITY_PX of the tap. Enemies are NOT included here —
  // tap-near-enemy could mistakenly swing at a far foe.
  const tapPxX = clientX - rect.left;
  const tapPxY = clientY - rect.top;
  let bestProx: Interactable | null = null;
  let bestProxDist2 = CONFIG.INTERACT_TAP_PROXIMITY_PX * CONFIG.INTERACT_TAP_PROXIMITY_PX;
  for (const r of interactableRoots) {
    // Project the interactable's anchor (use position rather than the
    // mesh group origin, so a tilted/rotated viewmodel doesn't shift
    // the tap target away from its visible centre).
    tmpVec.copy(r.it.position);
    // Raise to the labelOffsetY so the projection lands near the
    // prompt label / visible weapon centre, not the floor.
    tmpVec.y += r.it.labelOffsetY ?? 0.6;
    tmpVec.project(camera);
    // Behind the camera → z>1; skip.
    if (tmpVec.z > 1 || tmpVec.z < -1) continue;
    const screenX = (tmpVec.x * 0.5 + 0.5) * rect.width;
    const screenY = (-tmpVec.y * 0.5 + 0.5) * rect.height;
    const dx = screenX - tapPxX;
    const dy = screenY - tapPxY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestProxDist2) {
      bestProxDist2 = d2;
      bestProx = r.it;
    }
  }
  if (bestProx) return { kind: 'interactable', interactable: bestProx };

  return null;
}

function isDescendantOrSelf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}
