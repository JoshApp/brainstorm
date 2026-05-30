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
import { openCharacterScreen, isCharacterScreenOpen, closeCharacterScreen } from '../ui/character-screen';
import { dismissTopScreen, isAnyScreenOpen } from '../ui/screen-manager';
import { openSettings } from '../ui/settings-menu';
import type { InputScheme, SchemeContext, InputTick } from './input-types';
import { LEFT_ZONE_FRACTION } from './input-touch';

const TAP_MAX_MS = 220;
const TAP_MAX_PX = 18;

// Pointer-lock movementX/Y is a per-event delta in device pixels. Even a
// hard, fast flick at 60Hz stays well under ~200px/event. The pointer-lock
// API, though, intermittently emits a single spurious delta in the thousands
// (a known Chrome/Windows bug) and ALSO fires a large centring "warp" delta
// on the first move right after lock engages — either one spins yaw or slams
// pitch to its limit for a frame (the rare sharp camera flip). Drop any single
// event beyond this magnitude as spurious; legit motion never reaches it.
const LOOK_SPIKE_PX = 400;

export const desktopScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const keys: Record<string, boolean> = {};
    let pointerLocked = false;
    // The first mousemove after lock engages carries the cursor→centre warp
    // delta; swallow it so the view doesn't jump on lock.
    let swallowNextMove = false;

    // ── Pointer lock state ──────────────────────────────────────────
    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === canvas;
      if (nowLocked && !pointerLocked) swallowNextMove = true;
      pointerLocked = nowLocked;
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
      // Character screen — visible mid-run for status check. Spend
      // buttons enable only at safe rooms.
      if (k === 'c') {
        e.preventDefault();
        if (isCharacterScreenOpen()) closeCharacterScreen();
        else openCharacterScreen();
      }
      // Escape: close the topmost open panel (mirrors the backdrop-tap
      // gesture on touch). If nothing is open, open the settings menu
      // — desktop's pause-equivalent of the touch inventory-gear flow.
      // Note: the browser also intercepts Escape to release pointer
      // lock. When locked, the first Escape unlocks (no keydown fires
      // here); a second Escape then reaches us and dismisses/opens.
      if (e.key === 'Escape') {
        e.preventDefault();
        if (dismissTopScreen()) return;
        // No dismissible top screen. Only open settings if nothing
        // else is on screen — title and end-screen are non-dismissible
        // and sit on a higher layer, so opening settings behind them
        // would just be invisible churn.
        if (!isAnyScreenOpen()) openSettings();
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
        // movementX/Y come straight from the pointer-lock API — raw deltas
        // in pixels. Swallow the post-lock centring warp, and drop spurious
        // spike events (see LOOK_SPIKE_PX) so the camera never flips.
        if (swallowNextMove) {
          swallowNextMove = false;
          return;
        }
        if (Math.abs(e.movementX) > LOOK_SPIKE_PX || Math.abs(e.movementY) > LOOK_SPIKE_PX) {
          return;
        }
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
