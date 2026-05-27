// Desktop input scheme: WASD to move, mouse to look (pointer lock),
// Space to attack, E to interact, ESC to release pointer lock.
//
// Click the canvas to request pointer lock — after that, mouse movement
// rotates the camera without the player needing to hold the button.
// Click while locked = left-click = attack. To interact, walk into
// range and press E (the interactable's onUse fires). The same
// raycast-on-tap path runs on first click before pointer lock acquires,
// so a click that happens to land on an in-range object still uses it.

import { dismissHint } from './hint-overlay';
import { triggerAttack } from './attack-input';
import type { InputScheme, SchemeContext, InputTick } from './input-types';
import { LEFT_ZONE_FRACTION } from './input-touch';

const TAP_MAX_MS = 220;
const TAP_MAX_PX = 18;

export const desktopScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const keys: Record<string, boolean> = {};
    let pointerLocked = false;

    // ── Pointer lock state ──────────────────────────────────────────
    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === canvas;
    });

    // ── Keyboard ────────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        triggerAttack();
      }
      if (k === 'e') {
        e.preventDefault();
        options.onInteract?.();
      }
    });
    window.addEventListener('keyup', (e) => {
      keys[e.key.toLowerCase()] = false;
    });

    // ── Mouse ───────────────────────────────────────────────────────
    let mouseDownAt = 0;
    let mouseDownX = 0;
    let mouseDownY = 0;
    let mouseMovement = 0;

    canvas.addEventListener('mousedown', (e) => {
      mouseDownAt = performance.now();
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      mouseMovement = 0;
      dismissHint();
    });

    canvas.addEventListener('mouseup', (e) => {
      const elapsed = performance.now() - mouseDownAt;
      const isTap = elapsed < TAP_MAX_MS && mouseMovement < TAP_MAX_PX;
      if (!isTap) return;

      // Tap-route: even with pointer lock, the FIRST click is interpreted
      // as a possible raycast tap. If it doesn't resolve to anything,
      // and we're not locked yet, request pointer lock to start the
      // "play with mouse look" mode.
      const side: 'left' | 'right' =
        e.clientX < window.innerWidth * LEFT_ZONE_FRACTION ? 'left' : 'right';
      const consumed = options.onTap?.(e.clientX, e.clientY, side) ?? false;
      if (consumed) return;

      // Not consumed by an in-world object. If we're already locked,
      // treat as an attack. If not, request lock — the player is asking
      // to switch into mouse-look gameplay mode.
      if (pointerLocked) {
        triggerAttack();
      } else {
        canvas.requestPointerLock?.();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (pointerLocked) {
        // movementX/Y come straight from the pointer-lock API — no need
        // to track previous coords. They're raw deltas in pixels.
        state.lookDx += e.movementX;
        state.lookDy += e.movementY;
      } else {
        // Pre-lock: still allow drag-to-look so the player can survey
        // before clicking to lock in. Tracks movement so the click-on-
        // release tap detector still works.
        mouseMovement += Math.hypot(e.movementX || 0, e.movementY || 0);
      }
    });

    void mouseDownX; void mouseDownY;  // reserved for future use

    // ── Per-frame WASD polling ─────────────────────────────────────
    // Returned as the scheme's tick. The orchestrator calls it once
    // per main-loop frame. WASD only steers when no touch is active
    // (avoids fighting the joystick on hybrid devices).
    return (_dt: number) => {
      // If the touch scheme has written non-zero move axes this frame,
      // don't clobber it.
      const touchActive = state.moveX !== 0 || state.moveY !== 0;
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
      } else if (!touchActive) {
        // Only zero out if touch ISN'T driving. Otherwise leave the
        // joystick's reading alone.
        state.moveX = 0;
        state.moveY = 0;
      }
    };
  },
};
