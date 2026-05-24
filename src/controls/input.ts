// Touch input model:
// - Left half of screen: virtual joystick for movement
// - Right half of screen: swipe to look
// Multi-touch handled — both can be active simultaneously.

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
    }
  }

  function handleMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const tracker = touches.get(t.identifier);
      if (!tracker) continue;

      if (tracker.side === 'left') {
        // Joystick: offset from start point, normalized to ~80px radius
        const dx = t.clientX - tracker.startX;
        const dy = t.clientY - tracker.startY;
        const r = 80;
        let mx = Math.max(-1, Math.min(1, dx / r));
        let my = Math.max(-1, Math.min(1, dy / r));
        // Apply deadzone
        const mag = Math.hypot(mx, my);
        if (mag < 0.1) {
          mx = 0;
          my = 0;
        }
        state.moveX = mx;
        state.moveY = my;
      } else {
        // Look: accumulate delta
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
  window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  let mouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  canvas.addEventListener('mouseup', () => { mouseDown = false; });
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
      let kx = 0, ky = 0;
      if (keys['w']) ky -= 1;
      if (keys['s']) ky += 1;
      if (keys['a']) kx -= 1;
      if (keys['d']) kx += 1;
      if (kx !== 0 || ky !== 0) {
        const mag = Math.hypot(kx, ky);
        state.moveX = kx / mag;
        state.moveY = ky / mag;
      } else if (state.moveX !== 0 || state.moveY !== 0) {
        // Don't clobber touch input
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
