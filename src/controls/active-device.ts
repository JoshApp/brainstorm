// Which input device is the player using RIGHT NOW — last one touched wins.
//
// isDesktopLike() (controls/platform.ts) answers a different question: what
// the device CAN do (it has a touchscreen or not). A Steam Deck or a touch
// laptop with a pad has a touchscreen and still wants the console HUD while a
// gamepad is in hand. The HUD follows this module; render quality and pointer
// lock stay on isDesktopLike.

import { isDesktopLike } from './platform';

export type InputDevice = 'touch' | 'keyboard-mouse' | 'gamepad';

let active: InputDevice | null = null;
const listeners = new Set<(d: InputDevice) => void>();

function note(d: InputDevice): void {
  if (active === d) return;
  active = d;
  for (const fn of listeners) fn(d);
}

export function noteGamepadActivity(): void { note('gamepad'); }
export function noteTouchActivity(): void { note('touch'); }
export function noteKeyboardMouseActivity(): void { note('keyboard-mouse'); }

/** The device used last, or null before any input. */
export function activeDevice(): InputDevice | null { return active; }

export function onActiveDeviceChange(fn: (d: InputDevice) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether the on-screen thumb controls (dodge, parry) should show: on touch,
 *  and on a touch-capable device before any input. A Steam Deck with the pad
 *  in hand, or a touch laptop on its keyboard, hides them until a finger
 *  lands on the glass again. */
export function touchControlsWanted(): boolean {
  return active === null ? !isDesktopLike() : active === 'touch';
}
