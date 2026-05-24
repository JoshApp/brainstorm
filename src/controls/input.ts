// Touch input model:
// - Left half of screen: virtual joystick for movement (visualized via joystick-hud)
// - Right half of screen: swipe to look
// Multi-touch handled — both can be active simultaneously.

import { showJoystick, moveJoystickKnob, hideJoystick } from './joystick-hud';
import { showFirstTimeHint, dismissHint } from './hint-overlay';

const JOYSTICK_RADIUS = 80; // pixels of thumb travel = full-tilt input
const DEADZONE = 0.1;

export interface InputState {
  // Movement (-1..1 on each axis, deadzone applied)
  moveX: number;
  moveY: number;
  // Look delta since last frame, then reset
  lookDx: number;
  lookDy: number;
}

interface TouchTracker {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  side: 'left' | 'right';
}

export function createTouchInput(canvas: HTMLCanvasElement): InputState {
  const state: InputState = { moveX: 0, moveY: 0, lookDx: 0, lookDy: 0 };
  const touches: Map<number, TouchTracker> = new Map();
  let activeJoystickId: number | null = null;

  showFirstTimeHint();

  const screenMid = () => window.innerWidth / 2;

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
        state.lookDx += t.clientX - tracker.lastX;
        state.lookDy += t.clientY - tracker.lastY;
        tracker.lastX = t.clientX;
        tracker.lastY = t.clientY;
      }
    }
  }

  function handleEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      const tracker = touches.get(t.identifier);
      if (!tracker) continue;
      if (tracker.side === 'left') {
        state.moveX = 0;
        state.moveY = 0;
        if (t.identifier === activeJoystickId) {
          hideJoystick();
          activeJoystickId = null;
        }
      }
      touches.delete(t.identifier);
    }
  }

  canvas.addEventListener('touchstart', handleStart, { passive: false });
  canvas.addEventListener('touchmove', handleMove, { passive: false });
  canvas.addEventListener('touchend', handleEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleEnd, { passive: false });

  // Desktop fallback for development: WASD + mouse drag
  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  let mouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    dismissHint();
  });
  canvas.addEventListener('mouseup', () => {
    mouseDown = false;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (mouseDown) {
      state.lookDx += e.clientX - lastMouseX;
      state.lookDy += e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });

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

  return state;
}
