import * as THREE from 'three';
import type { Interactable } from '../interactables/types';
import { iconKindFromLabel, iconSvg } from './interact-icons';
import { worldToScreen } from './hud';
import { isDesktopLike } from '../controls/platform';
import { getBinding, labelForCode, onBindingsChanged } from '../controls/keybindings';

// Floating interact label — projects an icon + label OVER the world
// position of the currently in-range interactable. Reads diegetically:
// you look at the chest, the OPEN icon appears just above the chest.
//
// On TOUCH the label is ALSO a tap target: tapping it uses the in-range
// interactable (handler registered via setInteractLabelTapHandler). So
// the player has two reliable, deliberate ways to interact — tap the
// object's model, or tap this prompt — without the old whole-screen
// "any in-range tap grabs it" breadth. pointerEvents is toggled with
// visibility so a hidden/stale label never eats a tap.
//
// On DESKTOP there is no cursor (pointer-lock owns the mouse for
// looking), so the prompt can't be tapped — instead it wears a keycap
// badge showing the bound interact key ("E" by default). The prompt
// reads "<E> OPEN": you press the key, you don't click the world. Native
// FPS split — left-click swings, E uses. The keycap follows rebinds.
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
let keycapEl: HTMLDivElement | null = null;  // desktop-only "E" badge
let currentLabel: string | null = null;
let shown = false;  // mirrors opacity 1/0 so we can toggle pointerEvents
let tapHandler: (() => void) | null = null;

const tmpVec = new THREE.Vector3();

/** Register what happens when the floating prompt is tapped. main.ts wires
 *  this to "use the currently in-range interactable" (same gating + the
 *  blocked-loot fall-through as the model-tap path). */
export function setInteractLabelTapHandler(fn: () => void): void {
  tapHandler = fn;
}

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
    // Roomy padding so the prompt is a comfortable thumb-sized tap target,
    // not a pixel-thin strip.
    padding: '9px 16px 10px',
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
    pointerEvents: 'none',  // toggled to 'auto' only while visible
    touchAction: 'manipulation',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 180ms ease-out',
    willChange: 'transform, opacity, left, top',
  } as Partial<CSSStyleDeclaration>);

  // Tap/click the prompt → fire the registered handler. pointerup covers
  // both touch and mouse; stop propagation so the canvas swing handler
  // underneath doesn't also fire.
  const fire = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    tapHandler?.();
  };
  labelEl.addEventListener('pointerup', fire);
  labelEl.addEventListener('click', (e) => { e.stopPropagation(); });

  iconEl = document.createElement('div');
  Object.assign(iconEl.style, {
    width: '22px',
    height: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  labelEl.appendChild(iconEl);

  // Action row: [keycap] VERB. On touch the keycap is absent and the row
  // is just the verb; on desktop the keycap leads so the prompt reads
  // "<E> OPEN".
  const actionRow = document.createElement('div');
  Object.assign(actionRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  } as Partial<CSSStyleDeclaration>);

  if (isDesktopLike()) {
    keycapEl = document.createElement('div');
    Object.assign(keycapEl.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '16px',
      height: '16px',
      padding: '0 4px',
      border: '1px solid rgba(255, 200, 130, 0.6)',
      borderRadius: '3px',
      background: 'rgba(255, 200, 130, 0.12)',
      // Subtle inset shadow reads as a physical key cap.
      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.4)',
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0.04em',
      lineHeight: '1',
    } as Partial<CSSStyleDeclaration>);
    const refreshKeycap = () => {
      if (keycapEl) keycapEl.textContent = labelForCode(getBinding('interact'));
    };
    refreshKeycap();
    onBindingsChanged(refreshKeycap);  // follow a rebind of 'interact'
    actionRow.appendChild(keycapEl);
  }

  textEl = document.createElement('div');
  Object.assign(textEl.style, {
    fontSize: '10px',
    lineHeight: '1',
  });
  actionRow.appendChild(textEl);

  labelEl.appendChild(actionRow);

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
    hide();
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
    // Show the verb text under every icon, including TAKE — the hand
    // icon reads on its own but Josh prefers the explicit label so the
    // action stays diegetic-but-readable.
    textEl.textContent = target.promptLabel.toUpperCase();
    textEl.style.display = 'block';
    // SEALED gets a muted gray scheme to match the outline + corner
    // button visual language.
    const sealed = target.promptLabel.toUpperCase() === 'SEALED';
    if (sealed) {
      labelEl.style.color = 'rgba(180, 160, 140, 0.7)';
      labelEl.style.borderColor = 'rgba(140, 130, 120, 0.35)';
      labelEl.style.background = 'rgba(20, 18, 16, 0.45)';
    } else {
      labelEl.style.color = 'rgba(255, 220, 180, 0.95)';
      labelEl.style.borderColor = 'rgba(255, 200, 130, 0.4)';
      labelEl.style.background = 'rgba(20, 12, 8, 0.5)';
    }
    // The keycap promises a key DOES something — hide it on SEALED (the
    // bound key won't open a locked door), show + tint it otherwise.
    if (keycapEl) {
      keycapEl.style.display = sealed ? 'none' : 'inline-flex';
      keycapEl.style.borderColor = 'rgba(255, 200, 130, 0.6)';
      keycapEl.style.background = 'rgba(255, 200, 130, 0.12)';
    }
  }

  // Project the target's world position to screen-space NDC. Use the
  // per-interactable label offset if set; otherwise default to 0.6m
  // above the pivot (chest-height for floor objects).
  const offsetY = target.labelOffsetY ?? VERTICAL_OFFSET_WORLD;
  tmpVec.set(target.position.x, target.position.y + offsetY, target.position.z);
  const p = worldToScreen(tmpVec, camera, canvas.getBoundingClientRect());
  // If behind the camera, hide.
  if (p.behind) {
    hide();
    return;
  }
  labelEl.style.left = `${p.x}px`;
  labelEl.style.top = `${p.y}px`;
  if (!shown) {
    shown = true;
    labelEl.style.opacity = '1';
    labelEl.style.pointerEvents = 'auto';  // tappable only while visible
  }
}

/** Hide + make the (now stale-positioned) label inert to taps. */
function hide(): void {
  if (!labelEl || !shown) return;
  shown = false;
  labelEl.style.opacity = '0';
  labelEl.style.pointerEvents = 'none';
}
