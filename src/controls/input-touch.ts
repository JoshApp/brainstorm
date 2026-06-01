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
import { setChargeFromHeldMs, tryReleaseChargedAttack, cancelCharge } from './charge-input';
import { getSettings } from '../settings/settings';
import { wantsHoldToCharge } from '../player/current-weapon';
import type { InputScheme, SchemeContext, InputTick } from './input-types';

const TAP_MAX_MS = 220;
const TAP_MAX_PX = 18;
const AIM_ZONE_RADIUS = 70;
const HYBRID_ROTATE_PIXELS_PER_SEC = 600;
const JOYSTICK_RADIUS = 80;
const DEADZONE = 0.1;
/** Left zone width as a fraction of viewport. 0.4 = 40% move, 60% look. */
const LEFT_ZONE_FRACTION = 0.4;

interface TouchTracker {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  side: 'left' | 'right';
  startTime: number;
  totalMovement: number;
  /** Right-side only: is this touch still ELIGIBLE for a charged
   *  attack? Set false the moment the player drags past the tap
   *  movement threshold; once false it never re-arms during this
   *  touch. Drag-cancel keeps look-around feeling instant. */
  chargeArmed: boolean;
}

export const touchScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const touches: Map<number, TouchTracker> = new Map();
    let activeJoystickId: number | null = null;

    showFirstTimeHint();

    const screenMid = () => window.innerWidth * LEFT_ZONE_FRACTION;

    function handleStart(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const side: 'left' | 'right' = t.clientX < screenMid() ? 'left' : 'right';
        touches.set(t.identifier, {
          id: t.identifier,
          startX: t.clientX, startY: t.clientY,
          lastX: t.clientX,  lastY: t.clientY,
          side, startTime: performance.now(), totalMovement: 0,
          chargeArmed: side === 'right' && wantsHoldToCharge(),
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
          // Charge intent dies the moment a touch drags past the tap
          // movement threshold — looking around always wins. Once
          // disarmed it stays disarmed for the rest of this touch.
          if (tracker.chargeArmed && tracker.totalMovement >= TAP_MAX_PX) {
            tracker.chargeArmed = false;
            cancelCharge();
          }
        }
      }
    }

    function handleEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const tracker = touches.get(t.identifier);
        if (!tracker) continue;
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
          if (!consumed && tracker.side === 'right') triggerAttack();
        } else if (tracker.side === 'right' && tracker.chargeArmed && tracker.totalMovement < TAP_MAX_PX) {
          // Held still past the tap window — a charged release. If the
          // charge had built any progress (>= CHARGE_RAMP_START_MS) the
          // charge-input module queues a charged attack; otherwise this
          // is a no-op and the touch is treated as nothing happened.
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
      for (const tracker of touches.values()) {
        if (tracker.side === 'right' && tracker.chargeArmed) {
          const held = now - tracker.startTime;
          if (held > bestHeldMs) bestHeldMs = held;
        }
      }
      if (bestHeldMs > 0) setChargeFromHeldMs(bestHeldMs);

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
