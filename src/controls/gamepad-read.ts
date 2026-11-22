// Pure gamepad reading: one pad snapshot (+ last frame's buttons) in, the
// frame's movement, look rate and action edges out. No DOM, no game state —
// tests/gamepad-read.test.ts drives it with plain objects.

import { AXIS, type GamepadAction } from './gamepad-bindings';

export interface PadSnapshot {
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
}

export interface PadTuning {
  deadzone: number;
  triggerThreshold: number;
  lookCurve: number;
}

export interface PadFrame {
  /** Left stick after the radial deadzone, rescaled so the edge of the
   *  deadzone reads 0 (no jump). x right, y screen-style (forward is -1). */
  moveX: number;
  moveY: number;
  /** Right stick after deadzone + response curve, in [-1, 1]. */
  lookX: number;
  lookY: number;
  /** Actions whose button went down this frame / up this frame / is held. */
  pressed: Set<GamepadAction>;
  released: Set<GamepadAction>;
  held: Set<GamepadAction>;
  /** Raw button state this frame, to pass back in as `prevButtons` next frame. */
  buttons: boolean[];
  /** Any stick out of its deadzone or any button down: the pad is being used. */
  active: boolean;
}

/** Radial deadzone with rescale: |v| < dz → 0; beyond, mapped to (0..1]. */
export function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz || m === 0) return [0, 0];
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return [(x / m) * scaled, (y / m) * scaled];
}

export function readPad(
  pad: PadSnapshot,
  prevButtons: readonly boolean[],
  bindings: Record<GamepadAction, number>,
  t: PadTuning,
): PadFrame {
  const ax = (i: number): number => pad.axes[i] ?? 0;
  // Standard layout: stick-up is NEGATIVE y, and so is the game's forward
  // (InputState.moveY: moveForward writes -1). No flip.
  const [mx, my] = radialDeadzone(ax(AXIS.LX), ax(AXIS.LY), t.deadzone);
  let [lx, ly] = radialDeadzone(ax(AXIS.RX), ax(AXIS.RY), t.deadzone);
  const curve = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), t.lookCurve);
  lx = curve(lx); ly = curve(ly);

  const buttons = pad.buttons.map((b) => b.pressed || b.value > t.triggerThreshold);
  const pressed = new Set<GamepadAction>();
  const released = new Set<GamepadAction>();
  const held = new Set<GamepadAction>();
  for (const [action, idx] of Object.entries(bindings) as Array<[GamepadAction, number]>) {
    const now = buttons[idx] ?? false;
    const was = prevButtons[idx] ?? false;
    if (now) held.add(action);
    if (now && !was) pressed.add(action);
    if (!now && was) released.add(action);
  }
  const active = mx !== 0 || my !== 0 || lx !== 0 || ly !== 0 || buttons.some(Boolean);
  return { moveX: mx, moveY: my, lookX: lx, lookY: ly, pressed, released, held, buttons, active };
}
