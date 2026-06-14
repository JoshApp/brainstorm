// Touch input scheme.
//
//   Left  zone (~40% of screen width): virtual joystick for movement.
//   Right zone (~60%): swipe to look + tap to attack / interact.
//
// Multi-touch is supported (one finger per zone). Hybrid-look: a touch
// past the aim-zone radius adds continuous rotation proportional to
// overshoot so the player can do 180s without re-positioning the
// finger. Hybrid is gated by the settings toggle.

import { showJoystick, moveJoystickKnob, hideJoystick } from './joystick-hud';
import { showFirstTimeHint, dismissHint } from './hint-overlay';
import { triggerAttack } from './attack-input';
import { triggerDash } from './dash-input';
import { setChargeFromHeldMs, tryReleaseChargedAttack, cancelCharge, setChargePosition } from './charge-input';
import { getSettings } from '../settings/settings';
import { wantsHoldToCharge } from '../player/current-weapon';
import type { InputScheme, SchemeContext, InputTick } from './input-types';
import { markTouchActivity } from './touch-activity';

const TAP_MAX_MS = 320;
const TAP_MAX_PX = 18;
const AIM_ZONE_RADIUS = 70;
const HYBRID_ROTATE_PIXELS_PER_SEC = 600;
const JOYSTICK_RADIUS = 80;
const DEADZONE = 0.1;
/** Left zone width as a fraction of viewport. 0.4 = 40% move, 60% look. */
const LEFT_ZONE_FRACTION = 0.4;
// Aligned with CHARGE_RAMP_START_MS in charge-input. A right-side
// touch held STILL for this long commits to a charge; once committed,
// subsequent drag aims the camera instead of cancelling the charge.
const CHARGE_COMMIT_MS = 320;
// DASH / DODGE gestures (settings.dashGesture). Both resolve direction at the
// moment they fire (live intent, like Elden Ring), and a sub-deadzone gesture
// becomes a neutral backstep.
//   flick     — a fast swipe on the move side; the swipe vector IS the dash
//               direction. Must be quick + travel far enough to distinguish it
//               from a slow joystick drag.
//   doubleTap — two quick taps; the SECOND touch is a steerable aim (drag it to
//               pick a direction, or release in place to backstep). The aim
//               touch does not drive movement.
const FLICK_MAX_MS = 200;      // a flick must complete within this
const FLICK_MIN_PX = 40;       // …and travel at least this far
const DOUBLE_TAP_MS = 280;     // gap between the two taps of a double-tap
const DASH_DEADZONE_PX = 24;   // drag below this = no clear direction = backstep

/** Resolve a screen-space gesture delta into a camera-relative dash direction
 *  (same convention as the joystick: +x right, +y backward). Returns (0,0) when
 *  the gesture is inside the deadzone — the dash system reads that as a
 *  backstep. */
function dashDirFromDelta(dx: number, dy: number): { mx: number; my: number } {
  const dist = Math.hypot(dx, dy);
  if (dist < DASH_DEADZONE_PX) return { mx: 0, my: 0 };
  return { mx: dx / dist, my: dy / dist };
}

interface TouchTracker {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  side: 'left' | 'right';
  startTime: number;
  totalMovement: number;
  /** Right-side only: is this touch eligible to START charging at all?
   *  Set at touchstart when the player has a charge-class weapon
   *  equipped. Once disarmed (drag before commit) it never re-arms. */
  chargeEligible: boolean;
  /** Right-side only: has the touch already crossed the commit
   *  threshold without dragging? Once true, drag becomes AIM instead
   *  of cancel — looking around mid-charge is intentional. */
  chargeCommitted: boolean;
  /** Left-side only, doubleTap dash mode: this touch is the second tap of a
   *  double-tap — a steerable dash aim, not a joystick. Drag picks the dodge
   *  direction; it does NOT drive movement. */
  dashAim: boolean;
  /** Left-side only, flick dash: a trailing ring of recent {x,y,t} samples
   *  (pruned to the last ~FLICK_MAX_MS). The flick is detected from the
   *  velocity in this window at release — NOT from the touch's total duration
   *  — so a swipe-and-release works even when you were already holding the
   *  joystick to move. */
  flickSamples: { x: number; y: number; t: number }[];
}

export const touchScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const touches: Map<number, TouchTracker> = new Map();
    let activeJoystickId: number | null = null;
    // doubleTap dash: time of the last quick left-side tap, so the next touch
    // landing within DOUBLE_TAP_MS is armed as a steerable dash aim.
    let lastLeftTapMs = 0;

    showFirstTimeHint();

    const screenMid = () => window.innerWidth * LEFT_ZONE_FRACTION;

    function handleStart(e: TouchEvent) {
      markTouchActivity();   // beacon: suppress the ghost mouse events this tap will synthesize
      for (const t of Array.from(e.changedTouches)) {
        const side: 'left' | 'right' = t.clientX < screenMid() ? 'left' : 'right';
        // doubleTap dash: a left touch landing right after a quick tap is the
        // aim for the dodge — steerable, and it must NOT grab the joystick.
        const dashAim =
          side === 'left' &&
          getSettings().dashGesture === 'doubleTap' &&
          performance.now() - lastLeftTapMs < DOUBLE_TAP_MS;
        touches.set(t.identifier, {
          id: t.identifier,
          startX: t.clientX, startY: t.clientY,
          lastX: t.clientX,  lastY: t.clientY,
          side, startTime: performance.now(), totalMovement: 0,
          chargeEligible: side === 'right' && wantsHoldToCharge(),
          chargeCommitted: false,
          dashAim,
          flickSamples: side === 'left' ? [{ x: t.clientX, y: t.clientY, t: performance.now() }] : [],
        });
        if (side === 'left' && !dashAim && activeJoystickId === null) {
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
          tracker.lastX = t.clientX;
          tracker.lastY = t.clientY;
          tracker.totalMovement = Math.hypot(dx, dy);
          // A dash-aim touch (doubleTap second tap) only steers the dodge —
          // it does not move the player or animate the joystick.
          if (tracker.dashAim) continue;
          // Feed the flick velocity window: record this sample and prune the
          // ones older than FLICK_MAX_MS (keep ≥2 so a sub-frame-fast flick
          // still has a reference). At release we measure the swipe across this
          // trailing window, so a flick reads even after a long hold.
          const now = performance.now();
          tracker.flickSamples.push({ x: t.clientX, y: t.clientY, t: now });
          while (tracker.flickSamples.length > 2 && now - tracker.flickSamples[0].t > FLICK_MAX_MS) {
            tracker.flickSamples.shift();
          }
          let mx = Math.max(-1, Math.min(1, dx / JOYSTICK_RADIUS));
          let my = Math.max(-1, Math.min(1, dy / JOYSTICK_RADIUS));
          const mag = Math.hypot(mx, my);
          if (mag < DEADZONE) { mx = 0; my = 0; }
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
          // Pre-commit drag cancels the charge — that touch was a
          // look swipe all along. POST-commit drag keeps the charge
          // alive and just aims the camera, so ranged players can
          // adjust where the charged shot lands.
          if (
            tracker.chargeEligible &&
            !tracker.chargeCommitted &&
            tracker.totalMovement >= TAP_MAX_PX
          ) {
            tracker.chargeEligible = false;
            cancelCharge();
          }
        }
      }
    }

    function handleEnd(e: TouchEvent) {
      markTouchActivity();   // refresh the beacon so the post-tap ghost click is ignored
      for (const t of Array.from(e.changedTouches)) {
        const tracker = touches.get(t.identifier);
        if (!tracker) continue;
        const elapsed = performance.now() - tracker.startTime;
        const isTap = elapsed < TAP_MAX_MS && tracker.totalMovement < TAP_MAX_PX;
        const dxFromStart = t.clientX - tracker.startX;
        const dyFromStart = t.clientY - tracker.startY;
        if (tracker.side === 'left' && t.identifier === activeJoystickId) {
          state.moveX = 0;
          state.moveY = 0;
          hideJoystick();
          activeJoystickId = null;
        }
        // DASH / DODGE resolution (move side). Direction is read live HERE, at
        // release — never stale. A sub-deadzone gesture backsteps.
        let dashed = false;
        if (tracker.side === 'left') {
          const gesture = getSettings().dashGesture;
          if (tracker.dashAim) {
            // doubleTap: the second (aim) touch fired — dodge where it was
            // dragged, or backstep if released in place.
            const { mx, my } = dashDirFromDelta(dxFromStart, dyFromStart);
            triggerDash(mx, my);
            lastLeftTapMs = 0;
            dashed = true;
          } else if (gesture === 'flick') {
            // flick: a fast swipe measured over the trailing velocity window
            // (not the whole touch), so it fires whether you flicked from rest
            // OR were already holding the joystick and swiped before lifting.
            // Direction = that recent swipe vector, not the displacement from
            // touch-start (which, after a hold, points where you walked).
            const ref = tracker.flickSamples[0];
            const swDx = t.clientX - ref.x;
            const swDy = t.clientY - ref.y;
            const swDt = performance.now() - ref.t;
            if (swDt <= FLICK_MAX_MS * 1.5 && Math.hypot(swDx, swDy) >= FLICK_MIN_PX) {
              const { mx, my } = dashDirFromDelta(swDx, swDy);
              triggerDash(mx, my);
              dashed = true;
            }
          } else if (gesture === 'doubleTap' && isTap) {
            // First quick tap — arm the next touch as a dash aim.
            lastLeftTapMs = performance.now();
          }
        }
        if (isTap && !dashed) {
          // Single arbiter handles interact/attack/nothing. canAttack =
          // right (combat) half only — the left half is the joystick.
          // interactEligible=true: a finger is the only way to use an object
          // on touch, so a tap may interact (unlike a desktop left-click).
          options.onTap?.(t.clientX, t.clientY, tracker.side === 'right', true, true);
        } else if (tracker.side === 'right' && tracker.chargeCommitted) {
          // Committed-charge release. Drag may have happened post-
          // commit (the player was aiming) — that's fine, the charge
          // is still in flight. tryReleaseChargedAttack queues the
          // attack with the captured progress level.
          const fired = tryReleaseChargedAttack();
          if (fired) triggerAttack();
        }
        // Any touch that ended without firing a charge release leaves
        // the visible ring at zero — cancelCharge is idempotent.
        cancelCharge();
        touches.delete(t.identifier);
      }
    }

    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleEnd, { passive: false });

    // Per-frame tick — hybrid-look continuous rotation + charge ramp.
    return (dt: number) => {
      const now = performance.now();
      // Find the highest-progressing armed right-side hold and feed
      // its elapsed time to the charge module. If no eligible touch
      // is held this frame, the module's progress decays via release/
      // cancel calls — we don't reset it here.
      let bestHeldMs = 0;
      let bestTracker: TouchTracker | null = null;
      for (const tracker of touches.values()) {
        if (tracker.side !== 'right' || !tracker.chargeEligible) continue;
        const held = now - tracker.startTime;
        // Promote to committed once the threshold is crossed without
        // an early drag-cancel. After this, drag aims instead of
        // cancels (the look update still runs in handleMove every
        // frame regardless — we just don't disarm).
        if (
          !tracker.chargeCommitted &&
          held >= CHARGE_COMMIT_MS &&
          tracker.totalMovement < TAP_MAX_PX
        ) {
          tracker.chargeCommitted = true;
        }
        if (held > bestHeldMs) {
          bestHeldMs = held;
          bestTracker = tracker;
        }
      }
      if (bestHeldMs > 0) setChargeFromHeldMs(bestHeldMs);
      // Anchor the charge ring to the live thumb position — it
      // follows along as the player adjusts aim while charging.
      // Uses START position before commit (the thumb hasn't moved
      // yet); after commit the ring locks to the touchstart point
      // so post-commit aim drag doesn't drag the ring around with
      // it — feedback stays where the gesture was COMMITTED.
      if (bestTracker) {
        const anchorX = bestTracker.chargeCommitted ? bestTracker.startX : bestTracker.lastX;
        const anchorY = bestTracker.chargeCommitted ? bestTracker.startY : bestTracker.lastY;
        setChargePosition(anchorX, anchorY);
      }

      // Hybrid-look continuous rotation (existing behaviour).
      if (!getSettings().hybridLook) return;
      for (const tracker of touches.values()) {
        if (tracker.side !== 'right') continue;
        const dx = tracker.lastX - tracker.startX;
        const dy = tracker.lastY - tracker.startY;
        const dist = Math.hypot(dx, dy);
        if (dist <= AIM_ZONE_RADIUS) continue;
        const overshoot = dist - AIM_ZONE_RADIUS;
        const inv = 1 / dist;
        state.lookDx += dx * inv * overshoot * HYBRID_ROTATE_PIXELS_PER_SEC * dt / AIM_ZONE_RADIUS;
        state.lookDy += dy * inv * overshoot * HYBRID_ROTATE_PIXELS_PER_SEC * dt / AIM_ZONE_RADIUS;
      }
    };
  },
};

// Re-exported so input.ts can fall back to right-zone tap if onTap doesn't
// consume — kept here so the touch logic + desktop logic share the same
// "is this on the look/attack side?" math.
export { LEFT_ZONE_FRACTION };
