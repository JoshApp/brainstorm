import * as THREE from 'three';
import type { Interactable } from '../interactables/types';
import { iconKindFromLabel, iconSvg } from './interact-icons';

// Floating interact label — projects an icon + label OVER the world
// position of the currently in-range interactable. Reads diegetically:
// you look at the chest, the OPEN icon appears just above the chest.
//
// Works alongside the corner button (still primary tap target for
// players who reach there). The label is a SECONDARY visual cue —
// pointerEvents:none so it never steals taps, and it sits at modest
// opacity so it doesn't obscure the object's outline+ring.
//
// Implementation: one DOM element pinned to a screen coord computed
// each frame from the target's world position via camera.project.

const VERTICAL_OFFSET_WORLD = 0.6;  // raise the label this many meters
                                    // above the interactable's pivot in
                                    // world space, so it floats ABOVE
                                    // the object's silhouette.

let labelEl: HTMLDivElement | null = null;
let iconEl: HTMLDivElement | null = null;
let textEl: HTMLDivElement | null = null;
let currentLabel: string | null = null;

const tmpVec = new THREE.Vector3();

export function ensureInteractLabel(): void {
  if (labelEl) return;
  labelEl = document.createElement('div');
  labelEl.id = 'interact-label';
  Object.assign(labelEl.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    transform: 'translate(-50%, -100%)',  // anchor below the label's
                                          // bottom-center so it floats
                                          // ABOVE the target point
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    padding: '4px 10px 5px',
    background: 'rgba(20, 12, 8, 0.5)',
    border: '1px solid rgba(255, 200, 130, 0.4)',
    borderRadius: '4px',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    color: 'rgba(255, 220, 180, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    textShadow: '0 1px 0 rgba(0,0,0,0.8)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
    zIndex: '11',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 180ms ease-out',
    willChange: 'transform, opacity, left, top',
  } as Partial<CSSStyleDeclaration>);

  iconEl = document.createElement('div');
  Object.assign(iconEl.style, {
    width: '22px',
    height: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  labelEl.appendChild(iconEl);

  textEl = document.createElement('div');
  Object.assign(textEl.style, {
    fontSize: '10px',
    lineHeight: '1',
  });
  labelEl.appendChild(textEl);

  document.body.appendChild(labelEl);
}

/** Per-frame update. Pass the current in-range interactable + camera +
 *  canvas. Pass null to hide. */
export function updateInteractLabel(
  target: Interactable | null,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): void {
  if (!labelEl || !iconEl || !textEl) return;
  if (!target || !target.promptLabel) {
    if (labelEl.style.opacity !== '0') labelEl.style.opacity = '0';
    return;
  }

  // Refresh icon + text only on label change so we don't thrash innerHTML.
  if (target.promptLabel !== currentLabel) {
    currentLabel = target.promptLabel;
    const kind = iconKindFromLabel(target.promptLabel);
    iconEl.innerHTML = iconSvg(kind);
    const svg = iconEl.firstElementChild as SVGElement | null;
    if (svg) {
      svg.setAttribute('width', '22');
      svg.setAttribute('height', '22');
    }
    textEl.textContent = target.promptLabel.toUpperCase();
    // SEALED gets a muted gray scheme to match the outline + corner
    // button visual language.
    if (target.promptLabel.toUpperCase() === 'SEALED') {
      labelEl.style.color = 'rgba(180, 160, 140, 0.7)';
      labelEl.style.borderColor = 'rgba(140, 130, 120, 0.35)';
      labelEl.style.background = 'rgba(20, 18, 16, 0.45)';
    } else {
      labelEl.style.color = 'rgba(255, 220, 180, 0.95)';
      labelEl.style.borderColor = 'rgba(255, 200, 130, 0.4)';
      labelEl.style.background = 'rgba(20, 12, 8, 0.5)';
    }
  }

  // Project the target's world position to screen-space NDC.
  tmpVec.set(target.position.x, target.position.y + VERTICAL_OFFSET_WORLD, target.position.z);
  tmpVec.project(camera);
  // If behind the camera (z > 1 after project), hide.
  if (tmpVec.z > 1) {
    if (labelEl.style.opacity !== '0') labelEl.style.opacity = '0';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const sx = (tmpVec.x * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (-tmpVec.y * 0.5 + 0.5) * rect.height + rect.top;
  labelEl.style.left = `${sx}px`;
  labelEl.style.top = `${sy}px`;
  if (labelEl.style.opacity !== '1') labelEl.style.opacity = '1';
}
