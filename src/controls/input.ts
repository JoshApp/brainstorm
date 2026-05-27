// Touch input model:
// - Left half of screen: virtual joystick for movement (visualized via joystick-hud)
// - Right half of screen: swipe to look + TAP to attack
//   (a brief contact with little movement counts as an attack;
//    sustained contact / drag is camera look.)
// Multi-touch handled — both can be active simultaneously.

import { showJoystick, moveJoystickKnob, hideJoystick } from './joystick-hud';
import { showFirstTimeHint, dismissHint } from './hint-overlay';
import { triggerAttack } from './attack-input';
import { getSettings } from '../settings/settings';

// Right-side tap detection thresholds. A "tap" is a brief contact that
// didn't drift much — anything beyond these is interpreted as a look-drag.
const TAP_MAX_MS = 220;
const TAP_MAX_PX = 18;

// Hybrid-look aim zone. Inside this radius from touchstart, dragging is
// delta-based (precise aiming). Outside this radius, the touch ALSO
// adds continuous rotation proportional to how far past the zone the
// finger is — joystick-style for fast 180° turns.
const AIM_ZONE_RADIUS = 70;
const HYBRID_ROTATE_PIXELS_PER_SEC = 600;  // overshoot pixels emitted as virtual lookDx/lookDy per second

const JOYSTICK_RADIUS = 80; // pixels of thumb travel = full-tilt input
const DEADZONE = 0.1;

export interface InputState {
  // Movement (-1..1 on each axis, deadzone applied)
  moveX: number;
  moveY: number;
  // Look delta since last frame, then reset
  lookDx: number;
  lookDy: number;
  /** Called once per frame by the main loop. Used by hybrid-look mode to
   *  inject continuous rotation while a touch is past the aim zone. */
  tickInput: (dt: number) => void;
}

interface TouchTracker {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  side: 'left' | 'right';
  startTime: number;
  /** Cumulative pixel distance moved since touchstart — used for tap detection. */
  totalMovement: number;
}

export interface TouchInputOptions {
  /** Called for every tap (short contact + little movement) on EITHER
   *  side of the screen, with the touch's pixel coords. Returns true
   *  if the tap was consumed (e.g. resolved to an interactable use or
   *  a target-aware attack). If false / undefined, input.ts falls back
   *  to the legacy tap-right-half = attack behavior. */
  onTap?: (clientX: number, clientY: number, side: 'left' | 'right') => boolean;
}

export function createTouchInput(canvas: HTMLCanvasElement, options: TouchInputOptions = {}): InputState {
  // tickInput is assigned below; the placeholder satisfies the type.
  const state: InputState = { moveX: 0, moveY: 0, lookDx: 0, lookDy: 0, tickInput: () => {} };
  const touches: Map<number, TouchTracker> = new Map();
  let activeJoystickId: number | null = null;

  showFirstTimeHint();

  // Boundary between the LEFT (move) zone and the RIGHT (look + attack)
  // zone. Earlier this was 50/50; in playtest the move zone barely
  // needed half the screen but right-side look/attack felt cramped on a
  // phone, especially when reaching for an enemy or interactable on the
  // right edge. Move now gets ~40%, right gets ~60%.
  const LEFT_ZONE_FRACTION = 0.4;
  const screenMid = () => window.innerWidth * LEFT_ZONE_FRACTION;

  function handleStart(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      const side: 'left' | 'right' = t.clientX < screenMid() ? 'left' : 'right';
      touches.set(t.identifier, {
        id: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        side,
        startTime: performance.now(),
        totalMovement: 0,
      });
      if (side === 'left' && activeJoystickId === null) {
        activeJoystickId = t.identifier;
        showJoystick(t.clientX, t.clientY);
      }
      dismissHint();
    }
  }

  function handleMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const tracker = touches.get(t.identifier);
      if (!tracker) continue;

      if (tracker.side === 'left') {
        const dx = t.clientX - tracker.startX;
        const dy = t.clientY - tracker.startY;
        let mx = Math.max(-1, Math.min(1, dx / JOYSTICK_RADIUS));
        let my = Math.max(-1, Math.min(1, dy / JOYSTICK_RADIUS));
        const mag = Math.hypot(mx, my);
        if (mag < DEADZONE) {
          mx = 0;
          my = 0;
        }
        state.moveX = mx;
        state.moveY = my;

        if (t.identifier === activeJoystickId) {
          moveJoystickKnob(tracker.startX, tracker.startY, dx, dy, JOYSTICK_RADIUS);
        }
      } else {
        const ddx = t.clientX - tracker.lastX;
        const ddy = t.clientY - tracker.lastY;
        state.lookDx += ddx;
        state.lookDy += ddy;
        tracker.totalMovement += Math.hypot(ddx, ddy);
        tracker.lastX = t.clientX;
        tracker.lastY = t.clientY;
      }
    }
  }

  function handleEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      const tracker = touches.get(t.identifier);
      if (!tracker) continue;
      // Tap detection runs on EITHER side now — short contact + little
      // movement counts as a tap, then we resolve via raycast (chest,
      // corpse, enemy on the left side all get to trigger). If the
      // raycast finds nothing, we fall back to the legacy contract:
      // right-side tap = attack, left-side tap = no-op.
      const elapsed = performance.now() - tracker.startTime;
      const isTap = elapsed < TAP_MAX_MS && tracker.totalMovement < TAP_MAX_PX;

      if (tracker.side === 'left') {
        state.moveX = 0;
        state.moveY = 0;
        if (t.identifier === activeJoystickId) {
          hideJoystick();
          activeJoystickId = null;
        }
      }

      if (isTap) {
        const consumed = options.onTap?.(t.clientX, t.clientY, tracker.side) ?? false;
        if (!consumed && tracker.side === 'right') {
          triggerAttack();
        }
      }
      touches.delete(t.identifier);
    }
  }

  canvas.addEventListener('touchstart', handleStart, { passive: false });
  canvas.addEventListener('touchmove', handleMove, { passive: false });
  canvas.addEventListener('touchend', handleEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleEnd, { passive: false });

  // Desktop fallback for development: WASD + mouse drag + Space to attack.
  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.code === 'Space') {
      e.preventDefault();
      triggerAttack();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  let mouseDown = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseStartTime = 0;
  let mouseMovement = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;
  canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartTime = performance.now();
    mouseMovement = 0;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    dismissHint();
  });
  canvas.addEventListener('mouseup', (e) => {
    mouseDown = false;
    // Mouse-tap equivalent to touch-tap: short contact + little drift.
    // Routes through the same onTap callback so desktop dev can click
    // on objects to interact, just like phone players tap.
    const elapsed = performance.now() - mouseStartTime;
    if (elapsed < TAP_MAX_MS && mouseMovement < TAP_MAX_PX) {
      const side: 'left' | 'right' = e.clientX < screenMid() ? 'left' : 'right';
      const consumed = options.onTap?.(e.clientX, e.clientY, side) ?? false;
      if (!consumed && side === 'right') triggerAttack();
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    if (mouseDown) {
      const ddx = e.clientX - lastMouseX;
      const ddy = e.clientY - lastMouseY;
      state.lookDx += ddx;
      state.lookDy += ddy;
      mouseMovement += Math.hypot(ddx, ddy);
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });
  // Suppress an unused-warning for vars set by tap detection on touch.
  void mouseStartX; void mouseStartY;

  // Keyboard movement (desktop only)
  function pollKeyboard() {
    if (touches.size === 0) {
      let kx = 0;
      let ky = 0;
      if (keys['w']) ky -= 1;
      if (keys['s']) ky += 1;
      if (keys['a']) kx -= 1;
      if (keys['d']) kx += 1;
      if (kx !== 0 || ky !== 0) {
        const mag = Math.hypot(kx, ky);
        state.moveX = kx / mag;
        state.moveY = ky / mag;
        dismissHint();
      } else if (state.moveX !== 0 || state.moveY !== 0) {
        if (touches.size === 0) {
          state.moveX = 0;
          state.moveY = 0;
        }
      }
    }
    requestAnimationFrame(pollKeyboard);
  }
  pollKeyboard();

  // Hybrid-look tick — call once per frame from the main loop. If the
  // setting is enabled and any right-side touch is currently past the
  // aim zone, add virtual look-delta proportional to the overshoot so
  // the camera keeps rotating in that direction.
  state.tickInput = (dt: number) => {
    if (!getSettings().hybridLook) return;
    for (const tracker of touches.values()) {
      if (tracker.side !== 'right') continue;
      const dx = tracker.lastX - tracker.startX;
      const dy = tracker.lastY - tracker.startY;
      const dist = Math.hypot(dx, dy);
      if (dist <= AIM_ZONE_RADIUS) continue;
      const overshoot = dist - AIM_ZONE_RADIUS;
      const inv = 1 / dist;
      // Normalize direction; scale by overshoot fraction; emit as virtual
      // pixels/sec — the camera converts via lookSensitivity.
      state.lookDx += dx * inv * overshoot * HYBRID_ROTATE_PIXELS_PER_SEC * dt / AIM_ZONE_RADIUS;
      state.lookDy += dy * inv * overshoot * HYBRID_ROTATE_PIXELS_PER_SEC * dt / AIM_ZONE_RADIUS;
    }
  };

  return state;
}
