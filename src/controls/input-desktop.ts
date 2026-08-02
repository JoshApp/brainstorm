// Desktop input scheme: WASD to move, mouse to look (pointer lock),
// left-click to attack (hold to charge), E to interact, ESC to release
// pointer lock. Attack defaults to mouse-only — the keyboard attack slot is
// unbound by default (a player can still bind one in settings).
//
// All action keys (and WASD) are REBINDABLE — see controls/keybindings.ts.
// Every keydown resolves through actionForCode(e.code); movement polls
// the bound codes each frame. Numbered consumable slots (1-9) and the
// Tab inventory alias stay hardwired — they're positional, not verbs.
//
// Click the canvas to request pointer lock — after that, mouse movement
// rotates the camera without the player needing to hold the button.
// Click while locked = left-click = attack. HOLD the click (or the
// attack key) to charge a charge-class weapon, release to loose it —
// the desktop mirror of touch hold-to-charge. To interact, walk into
// range and press the interact key. The same raycast-on-tap path runs
// on first click before pointer lock acquires, so a click that happens
// to land on an in-range object still uses it.

import { dismissHint } from './hint-overlay';
import { triggerAttack } from './attack-input';
import { touchWasRecent } from './touch-activity';
import { triggerDash } from './dash-input';
import { isTextEntryMode } from './input-mode';
import {
  setChargeFromHeldMs,
  setChargePosition,
  tryReleaseChargedAttack,
  cancelCharge,
} from './charge-input';
import { wantsHoldToCharge } from '../player/current-weapon';
import { actionForCode, getBinding } from './keybindings';
import { useFirstConsumable, useConsumableSlot } from './consumable-bar';
import { toggleInventoryPanel } from '../ui/inventory-panel';
import { openCharacterScreen, isCharacterScreenOpen, closeCharacterScreen } from '../ui/character-screen';
import { dismissTopScreen, confirmTopScreen, isAnyScreenOpen, setReacquireFocusHandler } from '../ui/screen-manager';
import { isDesktopLike } from './platform';
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
    // Physical keys currently held, by KeyboardEvent.code. Movement
    // polls this against the bound codes each frame.
    const codesDown = new Set<string>();
    let pointerLocked = false;
    // The first mousemove after lock engages carries the cursor→centre warp
    // delta; swallow it so the view doesn't jump on lock.
    let swallowNextMove = false;

    // ── Charge state (mouse + key) ──────────────────────────────────
    // A held attack key or mouse button ramps a charge each frame, then
    // looses it on release. Eligibility is captured at press time so a
    // mid-charge weapon swap can't change the gesture's meaning.
    let keyChargeDown = false;
    let keyChargeStart = 0;
    let mouseChargeDown = false;
    let mouseChargeEligible = false;

    // ── Pointer lock state ──────────────────────────────────────────
    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === canvas;
      if (nowLocked && !pointerLocked) swallowNextMove = true;
      pointerLocked = nowLocked;
    });

    // Coherent menu ↔ mouse-look: when the screen manager reports the LAST
    // cursor-needing menu has closed (back to gameplay), re-grab the pointer so
    // play resumes in mouse-look — no more closing a panel and being left with
    // a free cursor until you click the world (which would also swing). The
    // close itself (✕ click / I,C,Esc) is the user gesture the browser needs to
    // grant the lock. Desktop only; skip a touch-synthesized ghost.
    setReacquireFocusHandler(() => {
      if (!isDesktopLike() || touchWasRecent()) return;
      canvas.requestPointerLock?.();
    });

    // ── Keyboard ────────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
      // Typing into a text field (e.g. the name-entry screen) owns the
      // keyboard — don't let game verbs steal 'E', WASD, digits, etc.
      if (isTextEntryMode()) return;
      if (!e.repeat) codesDown.add(e.code);

      // Prompt ADVANCE/CONFIRM — a modal prompt (note card, transition card)
      // that registered onConfirm takes Space / Enter / the interact key to
      // advance-or-dismiss. Routed HERE, through the ONE contained input scheme,
      // so prompts don't each bolt a global keydown listener on the window. ESC
      // routes to dismissTopScreen (the 'menu' verb below) — the back/cancel half.
      if (!e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space'
          || actionForCode(e.code) === 'interact')) {
        if (confirmTopScreen()) { e.preventDefault(); return; }
      }

      // DASH (debug desktop) — Shift dodges in the current move direction, or
      // backsteps if standing still. Movement is polled into state each frame,
      // so moveX/moveY are live here.
      if (!e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
        e.preventDefault();
        triggerDash(state.moveX, state.moveY);
        return;
      }

      const action = actionForCode(e.code);
      if (action) {
        // ATTACK — hold-to-charge on charge-class weapons, instant
        // otherwise. Charge ramps in the per-frame tick; the swing
        // looses on keyup.
        if (action === 'attack') {
          e.preventDefault();
          if (!e.repeat) {
            if (wantsHoldToCharge()) {
              keyChargeDown = true;
              keyChargeStart = performance.now();
            } else {
              triggerAttack();
            }
          }
          return;
        }
        // Movement keys are polled in the tick — nothing to do on the
        // edge except let codesDown carry the held state.
        if (action === 'moveForward' || action === 'moveBack' || action === 'moveLeft' || action === 'moveRight') {
          dismissHint();
          return;
        }
        if (e.repeat) return;   // remaining verbs are one-shot
        if (action === 'interact') {
          e.preventDefault();
          options.onInteract?.();
          return;
        }
        if (action === 'inventory') {
          e.preventDefault();
          toggleInventoryPanel();
          return;
        }
        if (action === 'quickUse') {
          e.preventDefault();
          useFirstConsumable();
          return;
        }
        if (action === 'character') {
          e.preventDefault();
          if (isCharacterScreenOpen()) closeCharacterScreen();
          else openCharacterScreen();
          return;
        }
        if (action === 'menu') {
          // Close the topmost open panel (mirrors the backdrop-tap
          // gesture on touch). If nothing is open, open settings —
          // desktop's pause-equivalent. Note: when bound to Escape and
          // pointer-locked, the browser eats the first press to release
          // lock (no keydown fires); a second press reaches us.
          e.preventDefault();
          if (dismissTopScreen()) return;
          if (!isAnyScreenOpen()) openSettings();
          return;
        }
      }

      if (e.repeat) return;

      // ── Non-bindable extras (only if no verb claimed the key) ──────
      // Tab: inventory alias. Number keys: consumable hotbar slots.
      if (e.code === 'Tab') {
        e.preventDefault();
        toggleInventoryPanel();
        return;
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) {
          e.preventDefault();
          useConsumableSlot(n);
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (isTextEntryMode()) return;
      codesDown.delete(e.code);
      // Attack-key release: loose the charge (charged if it cooked, a
      // plain swing if it never reached the ramp).
      if (keyChargeDown && actionForCode(e.code) === 'attack') {
        keyChargeDown = false;
        tryReleaseChargedAttack();
        triggerAttack();
        cancelCharge();
      }
    });

    // ── Mouse ───────────────────────────────────────────────────────
    let mouseDownAt = 0;
    let mouseDownX = 0;
    let mouseDownY = 0;
    let mouseMovement = 0;

    // Only the LEFT button is the blade. Right/middle do nothing in-game
    // (and we swallow the right-click context menu over the canvas so it
    // doesn't pop mid-fight).
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // Ignore the ghost mouse events a touch device synthesizes after a tap —
      // the touch scheme already handled the tap; acting again here double-
      // fires (a tapped-open chest also requesting pointer-lock → later taps
      // re-run onTap → phantom swing).
      if (touchWasRecent()) return;
      mouseDownAt = performance.now();
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      mouseMovement = 0;
      mouseChargeDown = true;
      // Only charge once we're in mouse-look mode (locked) and the
      // weapon supports it. A first click that's still acquiring lock
      // never charges.
      mouseChargeEligible = pointerLocked && wantsHoldToCharge();
      dismissHint();
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (touchWasRecent()) return;   // touch-synthesized ghost — the touch scheme owns this tap
      const elapsed = performance.now() - mouseDownAt;
      const wasChargeHold = mouseChargeDown && mouseChargeEligible;
      mouseChargeDown = false;
      const isTap = elapsed < TAP_MAX_MS && mouseMovement < TAP_MAX_PX;

      if (isTap) {
        // NOT locked yet → this click's only job is to enter mouse-look.
        // Request pointer lock (never gate it on the tap arbiter — that's what
        // broke re-focusing after Esc: an empty tap now "consumes" without a
        // target, so the old !consumed branch skipped the lock request). A
        // focusing click never attacks. But pointer lock IS mouse-look, so only
        // on a DESKTOP-like device: a touch-synthesized ghost mouseup that slips
        // past touchWasRecent() must never fire the cursor-lock request on a
        // phone (it pops a browser pointer-lock banner mid-run — reported on
        // relic pickup). isDesktopLike is false whenever the device has touch.
        if (!pointerLocked) {
          if (isDesktopLike()) canvas.requestPointerLock?.();
          cancelCharge();
          return;
        }
        // Locked → hand the click to the single tap arbiter (interact /
        // attack / nothing). canAttack=true: a desktop click anywhere is
        // a combat zone (no joystick). No separate attack fallback here —
        // the arbiter owns that, so a just-dismissed-screen tap can be
        // fully suppressed (no stray swing).
        // Desktop clicks are NOT deliberate aims at objects — the
        // crosshair is always centre-screen, so a distant interactable
        // under it must not swallow an attack click. interactEligible=false:
        // left-click is attack-only on PC; the `E` key owns interaction.
        options.onTap?.(e.clientX, e.clientY, true, false, false);
        cancelCharge();
        return;
      }

      // Held past the tap window. On a charge-eligible weapon, loose the
      // charge — fire either way so a hold that never reached the ramp
      // still swings. (A non-eligible long hold does nothing, as before.)
      if (wasChargeHold) {
        tryReleaseChargedAttack();
        triggerAttack();
      }
      cancelCharge();
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

    // ── Per-frame: WASD polling + charge ramp ──────────────────────
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
      if (codesDown.has(getBinding('moveForward'))) ky -= 1;
      if (codesDown.has(getBinding('moveBack')))    ky += 1;
      if (codesDown.has(getBinding('moveLeft')))    kx -= 1;
      if (codesDown.has(getBinding('moveRight')))   kx += 1;
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

      // Charge ramp — feed the longest-held active charge (key or
      // mouse) to the charge module. The ring anchors to screen centre,
      // where the pointer-locked crosshair sits.
      const now = performance.now();
      let heldMs = 0;
      if (keyChargeDown) heldMs = Math.max(heldMs, now - keyChargeStart);
      if (mouseChargeDown && mouseChargeEligible) heldMs = Math.max(heldMs, now - mouseDownAt);
      if (heldMs > 0) {
        setChargeFromHeldMs(heldMs);
        setChargePosition(window.innerWidth / 2, window.innerHeight / 2);
      }
    };
  },
};
