import * as THREE from 'three';
import type { Interactable } from '../interactables/types';
import { iconKindFromLabel, iconSvg } from './interact-icons';
import { worldToScreen } from './hud';
import { isDesktopLike } from '../controls/platform';
import { getBinding, labelForCode, onBindingsChanged } from '../controls/keybindings';

// Prompt colour by KIND — mirrors the transaction grammar so the prompt agrees
// with the altar's own glow (content/transactions.ts: bargain=violet/cursed,
// trial=blood-red, unknown=pale moonlight). 'neutral' is the safe amber default;
// 'sealed' is the muted locked-gray. The player reads the stakes at a glance.
const PROMPT_TINTS: Record<string, { color: string; border: string; bg: string; keycapBg: string }> = {
  neutral: { color: 'rgba(255, 220, 180, 0.95)', border: 'rgba(255, 200, 130, 0.40)', bg: 'rgba(20, 12, 8, 0.50)',  keycapBg: 'rgba(255, 200, 130, 0.12)' },
  bargain: { color: 'rgba(214, 150, 232, 0.97)', border: 'rgba(180, 110, 210, 0.50)', bg: 'rgba(22, 10, 26, 0.55)', keycapBg: 'rgba(190, 120, 220, 0.14)' },
  trial:   { color: 'rgba(255, 132, 110, 0.98)', border: 'rgba(230, 70, 50, 0.55)',   bg: 'rgba(28, 8, 6, 0.55)',   keycapBg: 'rgba(255, 90, 70, 0.14)' },
  unknown: { color: 'rgba(184, 208, 228, 0.96)', border: 'rgba(150, 185, 215, 0.45)', bg: 'rgba(12, 16, 22, 0.52)', keycapBg: 'rgba(170, 200, 225, 0.12)' },
  sealed:  { color: 'rgba(180, 160, 140, 0.70)', border: 'rgba(140, 130, 120, 0.35)', bg: 'rgba(20, 18, 16, 0.45)', keycapBg: 'rgba(160, 150, 140, 0.10)' },
};

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
  labelEl.id = 'interact-label'; labelEl.classList.add('game-hud');
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
    // Colour the prompt by its KIND so the player reads the stakes before
    // committing — a cursed bargain or a blood trial mustn't look like a plain
    // TAKE. SEALED stays its own muted gray (derived from the label, not a
    // kind). See Interactable.promptKind + the transaction grammar.
    const sealed = target.promptLabel.toUpperCase() === 'SEALED';
    const tintKind = sealed ? 'sealed' : (target.promptKind ?? 'neutral');
    const tint = PROMPT_TINTS[tintKind] ?? PROMPT_TINTS.neutral;
    labelEl.style.color = tint.color;
    labelEl.style.borderColor = tint.border;
    labelEl.style.background = tint.bg;
    // The keycap promises a key DOES something — hide it on SEALED (the
    // bound key won't open a locked door), show + tint it to match otherwise.
    if (keycapEl) {
      keycapEl.style.display = sealed ? 'none' : 'inline-flex';
      keycapEl.style.borderColor = tint.border;
      keycapEl.style.background = tint.keycapBg;
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
