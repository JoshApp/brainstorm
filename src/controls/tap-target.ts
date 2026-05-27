import * as THREE from 'three';
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

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

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
    if (e.alive) enemyRoots.push(e.group);
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
  if (hits.length === 0) return null;

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
