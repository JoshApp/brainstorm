import * as THREE from 'three';
import { on } from '../broadcast/event-bus';
import { worldToScreen } from '../ui/hud';

// Diegetic tutorial hints — small italic in-world text that fades in
// as the player approaches a teaching trigger, holds briefly, then
// fades out. Tonally adjacent to Souls floor messages: the previous
// delver's marginalia, not a "TAP HERE TO ATTACK" arrow.
//
// Each hint is a DOM element positioned via camera.project each
// frame. No backdrops, no buttons — just italic text floating at the
// trigger's world location.
//
// Lifecycle:
//   IDLE         — player far. Element opacity 0, invisible.
//   FADING_IN    — player entered the trigger radius. Lerp opacity up.
//   VISIBLE      — held at full opacity for `lingerMs` (or until the
//                  dismiss event fires).
//   FADING_OUT   — player left, or linger / dismiss expired. Fade to 0.
//   DONE         — never shows again. Element stays in the DOM at 0
//                  opacity so we can decide to revive on a re-trigger
//                  if needed later (V1: one-shot only).
//
// Dismiss events: hooked into the global event bus so a hint near the
// training rat ("strike. it will not strike back forever.") vanishes
// the moment the player lands their first hit.

export type HintDismissEvent =
  | 'attack:hit'
  | 'item:picked-up'
  | 'enemy:killed';

export interface HintOptions {
  /** XZ position in world space. */
  x: number;
  z: number;
  /** Height above the floor the text floats at. Default 1.4m
   *  (head-height of a standing humanoid). */
  y?: number;
  /** Italic text shown. Keep short, lowercase, world-voiced. */
  text: string;
  /** Distance from player at which the fade-in starts. Default 2.6m. */
  triggerRadius?: number;
  /** How long the hint stays at full opacity before fading out. Default 4.5s. */
  lingerMs?: number;
  /** If set, fading-out kicks in immediately when this event fires
   *  (overrides the linger timer). */
  dismissOn?: HintDismissEvent;
}

interface Hint {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  triggerRadius2: number;
  lingerMs: number;
  dismissOn?: HintDismissEvent;
  state: 'idle' | 'fading-in' | 'visible' | 'fading-out' | 'done';
  /** Time spent in the current phase, ms. */
  phaseMs: number;
}

const hints: Hint[] = [];

const FADE_IN_MS = 600;
const FADE_OUT_MS = 900;

export function spawnTutorialHint(opts: HintOptions): void {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    transform: 'translate(-50%, -50%)',
    color: 'rgba(220, 180, 140, 0.92)',
    fontFamily: '"Iowan Old Style", Palatino, "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(13px, 2.6vw, 15px)',
    letterSpacing: '0.04em',
    textShadow: '0 0 6px rgba(0,0,0,0.95), 0 0 14px rgba(80, 40, 10, 0.6)',
    pointerEvents: 'none',
    zIndex: '9',  // below the menu HUD (10) but above the world canvas
    opacity: '0',
    maxWidth: 'min(70vw, 440px)',
    textAlign: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'opacity 600ms ease-out',
    willChange: 'transform, opacity, left, top',
  } as Partial<CSSStyleDeclaration>);
  el.textContent = opts.text;
  document.body.appendChild(el);

  hints.push({
    el,
    worldPos: new THREE.Vector3(opts.x, opts.y ?? 1.4, opts.z),
    triggerRadius2: (opts.triggerRadius ?? 2.6) ** 2,
    lingerMs: opts.lingerMs ?? 4500,
    dismissOn: opts.dismissOn,
    state: 'idle',
    phaseMs: 0,
  });
}

// One-time listener wiring — registered on first hint spawn so we
// don't subscribe with nothing to dismiss.
let listenersWired = false;
function ensureListeners(): void {
  if (listenersWired) return;
  listenersWired = true;
  on((e) => {
    for (const h of hints) {
      if (h.state !== 'visible' && h.state !== 'fading-in') continue;
      if (!h.dismissOn) continue;
      if (e.type === h.dismissOn) {
        h.state = 'fading-out';
        h.phaseMs = 0;
      }
    }
  });
}

/** Per-frame update. Pass the camera + canvas so the hint's screen
 *  position is recomputed each frame and stays anchored to the
 *  trigger's world location. */
export function tickTutorialHints(
  dt: number,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  playerPos: THREE.Vector3,
): void {
  if (hints.length === 0) return;
  ensureListeners();

  const dtMs = dt * 1000;
  const rect = canvas.getBoundingClientRect();

  for (const h of hints) {
    if (h.state === 'done') continue;
    h.phaseMs += dtMs;

    // State machine first.
    switch (h.state) {
      case 'idle': {
        const dx = playerPos.x - h.worldPos.x;
        const dz = playerPos.z - h.worldPos.z;
        if (dx * dx + dz * dz < h.triggerRadius2) {
          h.state = 'fading-in';
          h.phaseMs = 0;
        }
        break;
      }
      case 'fading-in': {
        if (h.phaseMs >= FADE_IN_MS) {
          h.state = 'visible';
          h.phaseMs = 0;
        }
        break;
      }
      case 'visible': {
        if (h.phaseMs >= h.lingerMs) {
          h.state = 'fading-out';
          h.phaseMs = 0;
        }
        break;
      }
      case 'fading-out': {
        if (h.phaseMs >= FADE_OUT_MS) {
          h.state = 'done';
        }
        break;
      }
    }

    // Visibility + position. Done hints stop updating.
    if (h.state === 'done' || h.state === 'idle') {
      if (h.el.style.opacity !== '0') h.el.style.opacity = '0';
      continue;
    }

    // Project world pos to screen. If BEHIND the camera, hide it.
    const p = worldToScreen(h.worldPos, camera, rect);
    if (p.behind) {
      if (h.el.style.opacity !== '0') h.el.style.opacity = '0';
      continue;
    }
    h.el.style.left = `${p.x}px`;
    h.el.style.top = `${p.y}px`;

    // Opacity per phase.
    let opacity = 0;
    if (h.state === 'fading-in') {
      opacity = h.phaseMs / FADE_IN_MS;
    } else if (h.state === 'visible') {
      opacity = 1;
    } else if (h.state === 'fading-out') {
      opacity = Math.max(0, 1 - h.phaseMs / FADE_OUT_MS);
    }
    h.el.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  }
}

/** Retire every hint (DOM element removed). Called on level swap so
 *  tutorial hints don't linger into a regular floor. */
export function clearTutorialHints(): void {
  for (const h of hints) h.el.remove();
  hints.length = 0;
}
