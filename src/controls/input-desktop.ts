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
import { useFirstConsumable } from './consumable-bar';
import { toggleInventoryPanel } from '../ui/inventory-panel';
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
      // Ignore repeats so holding a key doesn't refire one-shot actions.
      if (!e.repeat) keys[k] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        triggerAttack();
      }
      if (e.repeat) return;
      if (k === 'e') {
        e.preventDefault();
        options.onInteract?.();
      }
      // Inventory: I or TAB. Releases pointer lock so the mouse can
      // drive the panel.
      if (k === 'i' || k === 'tab') {
        e.preventDefault();
        toggleInventoryPanel();
      }
      // Quick-use the first consumable (healing potion if HP is low,
      // else whatever's on the bar).
      if (k === 'q') {
        e.preventDefault();
        useFirstConsumable();
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
    // per main-loop frame AFTER the touch scheme has run. On hybrid
    // devices the touch joystick may have written this frame; we
    // must not clobber it when keyboard is idle.
    //
    // The earlier `touchActive = state.moveX !== 0` check was
    // broken: when WASD wrote to state last frame and is released
    // this frame, state STILL has our own non-zero value from last
    // frame, the check returns true, and we never clear — so the
    // player walks forever after releasing the key.
    //
    // Fix: remember what THIS scheme wrote last frame. If state
    // still matches that, only WE wrote → clear. If state differs,
    // touch must have written different values → leave them.
    let lastKbMoveX = 0;
    let lastKbMoveY = 0;
    return (_dt: number) => {
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
        lastKbMoveX = state.moveX;
        lastKbMoveY = state.moveY;
        dismissHint();
      } else {
        // Keyboard idle. Clear our previous contribution UNLESS
        // state already differs from it (touch wrote this frame).
        if (state.moveX === lastKbMoveX && state.moveY === lastKbMoveY) {
          state.moveX = 0;
          state.moveY = 0;
        }
        lastKbMoveX = 0;
        lastKbMoveY = 0;
      }
    };
  },
};
