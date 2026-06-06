import * as THREE from 'three';
import { getAllInteractables, getInRangeInteractable } from '../interactables/system';
import { worldToScreen } from './hud';

// Floating world labels — small italic NAME tags drawn over every
// interactable that declares a `nameLabel`. The "what's in this room"
// read at a glance, distinct from the in-range PROMPT overlay (verb +
// icon) which fires only on the focused target.
//
// Behaviour:
//   - Visible whenever the interactable is on-screen and within view
//     distance. Full opacity below FADE_BEGIN, easing to 0 by VIEW_DIST.
//   - Suppressed on the in-range target — the prompt overlay covers it
//     and a double label reads as noise.
//   - One DOM element per interactable, pooled by id; stale plates are
//     dropped each frame as their interactables go out of range or get
//     destroyed.
//
// DOM-based (same lane as damage-numbers / interact-label) — no Three.js
// objects to spend on a label.

const VIEW_DISTANCE = 14;   // metres beyond which the plate fades to nothing
const FADE_BEGIN    = 8;    // metres at and below which the plate is fully bright

const tmpVec = new THREE.Vector3();
const plates = new Map<string, HTMLDivElement>();
let containerEl: HTMLDivElement | null = null;

export function ensureWorldLabels(): void {
  if (containerEl) return;
  containerEl = document.createElement('div');
  containerEl.id = 'world-labels';
  Object.assign(containerEl.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    // Below the in-range prompt (z=11) so the prompt always wins when
    // both happen to overlap; above the canvas so the labels read.
    zIndex: '10',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(containerEl);
}

function createPlate(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    top: '0', left: '0',
    transform: 'translate(-50%, -50%)',
    color: 'rgba(220, 185, 145, 0.85)',
    fontFamily: '"Iowan Old Style", Palatino, serif',
    fontStyle: 'italic',
    fontSize: '11px',
    letterSpacing: '0.18em',
    textShadow: '0 0 6px rgba(0, 0, 0, 0.95), 0 1px 0 rgba(0, 0, 0, 0.8)',
    pointerEvents: 'none',
    opacity: '0',
    whiteSpace: 'nowrap',
    willChange: 'transform, opacity, left, top',
    // No transition — opacity is set every frame from a smooth distance
    // curve, so CSS easing would fight it and make the label lag the
    // camera.
  } as Partial<CSSStyleDeclaration>);
  return el;
}

/** Per-frame update. Walks every interactable with a nameLabel, projects
 *  to screen, manages a pool of DOM plates. Pass the camera + canvas. */
export function updateWorldLabels(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): void {
  if (!containerEl) return;
  const rect = canvas.getBoundingClientRect();
  const inRange = getInRangeInteractable();
  const camPos = camera.position;
  const live = new Set<string>();

  for (const it of getAllInteractables()) {
    if (!it.nameLabel) continue;
    if (it.destroyed) continue;
    // Empty promptLabel = interactable has been "used" (drained fountain,
    // taken pickup). Drop the name plate too — the thing is now a shell.
    if (!it.promptLabel) continue;
    // The in-range target's PROMPT overlay covers the name slot.
    if (it === inRange) continue;

    const dx = it.position.x - camPos.x;
    const dz = it.position.z - camPos.z;
    const d = Math.hypot(dx, dz);
    if (d > VIEW_DISTANCE) continue;

    // Float the name a bit above the prompt-label anchor so they don't
    // collide when the player happens to look from far enough away that
    // both end up sharing the same target.
    const offsetY = (it.labelOffsetY ?? 0.6) + 0.30;
    tmpVec.set(it.position.x, it.position.y + offsetY, it.position.z);
    const p = worldToScreen(tmpVec, camera, rect);
    if (p.behind) continue;

    let plate = plates.get(it.id);
    if (!plate) {
      plate = createPlate();
      plate.textContent = it.nameLabel;
      containerEl.appendChild(plate);
      plates.set(it.id, plate);
    } else if (plate.textContent !== it.nameLabel) {
      plate.textContent = it.nameLabel;
    }

    const alpha = d <= FADE_BEGIN
      ? 1
      : Math.max(0, 1 - (d - FADE_BEGIN) / (VIEW_DISTANCE - FADE_BEGIN));
    plate.style.left = `${p.x}px`;
    plate.style.top = `${p.y}px`;
    plate.style.opacity = alpha.toFixed(2);
    live.add(it.id);
  }

  // Drop plates whose interactables are no longer eligible (off-screen,
  // out of range, used, destroyed, or now the in-range target).
  for (const [id, plate] of plates) {
    if (!live.has(id)) {
      plate.remove();
      plates.delete(id);
    }
  }
}

/** Clear every plate. Called on scene rebuilds so a stale label can't
 *  flash for one frame before the per-frame pass culls it. */
export function clearWorldLabels(): void {
  for (const plate of plates.values()) plate.remove();
  plates.clear();
}
