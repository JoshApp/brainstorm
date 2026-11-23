// Gamepad input scheme — the third InputScheme beside touch and desktop.
//
// Polls the first connected standard-layout pad each frame (the Gamepad API
// has no button events), reads it through the pure gamepad-read.ts and turns
// the result into the same calls the keyboard makes: movement and look into
// the shared InputState, verbs into the same action functions. Mapping:
// gamepad-bindings.ts; tuning: CONFIG.GAMEPAD.
//
// Coexists with the other schemes the way they coexist with each other: it
// only writes movement while its stick is out of the deadzone, and clears only
// the movement IT wrote, so a keyboard or touch input in the same frame wins.
//
// ONE POLL A FRAME, AND IT RUNS WHILE PAUSED. Opening a screen pauses the
// world, and the scheme's tick lives in the unpaused input system — so a
// gamepad that only polled there could open a menu and never close it (the
// keyboard never noticed: it is event-driven; the Gamepad API is not).
// pollGamepad() is its own 'always' system (engine/systems.ts), placed before
// input: it reads the pad once, keeps the button-edge state, and handles the
// menu verbs while a screen is open (A confirm, B / Start back, View
// inventory). The gameplay tick reads that frame instead of polling again, so
// a held button can't register as a fresh press across the menu boundary.

import { CONFIG } from '../config';
import { DEFAULT_PAD_BINDINGS, type GamepadAction } from './gamepad-bindings';
import { readPad, type PadSnapshot, type PadFrame } from './gamepad-read';
import type { InputScheme, SchemeContext, InputTick } from './input-types';
import { triggerAttack } from './attack-input';
import { triggerDash } from './dash-input';
import { setChargeFromHeldMs, setChargePosition, tryReleaseChargedAttack, cancelCharge, consumeDashSpentSwing } from './charge-input';
import { wantsHoldToCharge } from '../player/current-weapon';
import { useFirstConsumable, useConsumableSlot } from './consumable-bar';
import { toggleInventoryPanel } from '../ui/inventory-panel';
import { dismissTopScreen, confirmTopScreen, isAnyScreenOpen } from '../ui/screen-manager';
import { openSettings } from '../ui/settings-menu';
import { tryActivateRite } from '../combat/rites';
import { triggerWeaponSwap } from './weapon-swap-input';
import { setGamepadRunHeld } from './run-input';
import { HOLD_TO_RUN_MS } from './dodge-button';
import { dismissHint } from './hint-overlay';
import { noteGamepadActivity } from './active-device';
import { navTopFocus } from '../ui/kit/focus';

/** The first connected pad reporting the standard layout, or null. */
function firstPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p && p.connected && p.mapping === 'standard') return p;
  return null;
}

let prev: boolean[] = [];
/** This frame's read, or null when no pad is connected. */
let frame: PadFrame | null = null;
/** True when this frame's edges were spent on a menu. */
let menuOwnsFrame = false;
// EDGES ACCUMULATE UNTIL GAMEPLAY TAKES THEM. The poll runs every display
// refresh; gameplay runs at the frame cap (60). A press's edge exists in ONE
// poll, so a poll that ran with no gameplay frame after it lost the press —
// measured: 120 ms taps of RT and Y never reached gameplay on a 240 Hz screen,
// while a 600 ms B hold did. Gameplay consumes these once; a second input tick
// in the same frame finds them empty.
const pendingPressed = new Set<GamepadAction>();
const pendingReleased = new Set<GamepadAction>();

// DEV: `__pad()` — what the pad did lately: the last actions fired and whether
// a menu owned the frame. The way to check a real controller's mapping.
const fired: string[] = [];
function log(what: string): void {
  if (!import.meta.env.DEV) return;
  fired.push(`${Math.round(performance.now())} ${what}`);
  if (fired.length > 30) fired.shift();
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __pad?: () => unknown }).__pad = () => ({
    connected: !!frame, menuOwnsFrame, held: frame ? [...frame.held] : [], fired: fired.slice(),
  });
}

/** Per-frame poll — an 'always'-phase system, before input (see above). */
export function pollGamepad(): void {
  const pad = firstPad();
  if (!pad) { frame = null; prev = []; return; }
  const G = CONFIG.GAMEPAD;
  frame = readPad(pad as unknown as PadSnapshot, prev, DEFAULT_PAD_BINDINGS, {
    deadzone: G.STICK_DEADZONE, triggerThreshold: G.TRIGGER_THRESHOLD, lookCurve: G.LOOK_CURVE,
  });
  prev = frame.buttons;
  if (frame.active) noteGamepadActivity();
  menuOwnsFrame = isAnyScreenOpen();
  if (!menuOwnsFrame) {
    for (const a of frame.pressed) pendingPressed.add(a);
    for (const a of frame.released) pendingReleased.add(a);
  } else {
    pendingPressed.clear();
    pendingReleased.clear();
    for (const a of frame.pressed) log(`menu:${a}`);
    menuNav(frame);
    if (frame.pressed.has('interact')) confirmTopScreen();
    if (frame.pressed.has('dodge') || frame.pressed.has('menu')) dismissTopScreen();
    if (frame.pressed.has('inventory')) toggleInventoryPanel();
  }
}

// Menu navigation: the D-pad steps the focused element (ui/kit/focus.ts); the
// left stick steps it too, with a held repeat, the way console menus scroll.
const MENU_NAV: Array<[GamepadAction, number, number]> = [
  ['slot1', 0, -1], ['slot2', 1, 0], ['slot3', 0, 1], ['slot4', -1, 0],
];
let stickDir = '';
let stickNext = 0;
function menuNav(f: PadFrame): void {
  for (const [a, dx, dy] of MENU_NAV) if (f.pressed.has(a)) navTopFocus(dx, dy);
  let dx = 0, dy = 0;
  if (Math.abs(f.moveX) > 0.55 || Math.abs(f.moveY) > 0.55) {
    if (Math.abs(f.moveX) > Math.abs(f.moveY)) dx = Math.sign(f.moveX); else dy = Math.sign(f.moveY);
  }
  const key = dx || dy ? `${dx},${dy}` : '';
  if (!key) { stickDir = ''; return; }
  const now = performance.now();
  if (key !== stickDir) { stickDir = key; stickNext = now + 320; navTopFocus(dx, dy); }
  else if (now >= stickNext) { stickNext = now + 120; navTopFocus(dx, dy); }
}

export const gamepadScheme: InputScheme = {
  attach(ctx: SchemeContext): InputTick | null {
    const { state, options } = ctx;
    let lastMoveX = 0, lastMoveY = 0;
    let chargeDown = false, chargeStart = 0;
    let dodgeDownAt = 0, dodgeDown = false;

    return (dt: number) => {
      const f = frame;
      if (!f) {
        if (lastMoveX !== 0 || lastMoveY !== 0) {
          if (state.moveX === lastMoveX && state.moveY === lastMoveY) { state.moveX = 0; state.moveY = 0; }
          lastMoveX = lastMoveY = 0;
        }
        setGamepadRunHeld(false);
        return;
      }
      const G = CONFIG.GAMEPAD;
      const inMenu = menuOwnsFrame || isAnyScreenOpen();

      // ── Movement + look ───────────────────────────────────────────
      if (!inMenu && (f.moveX !== 0 || f.moveY !== 0)) {
        state.moveX = f.moveX; state.moveY = f.moveY;
        lastMoveX = f.moveX; lastMoveY = f.moveY;
        dismissHint();
      } else if (lastMoveX !== 0 || lastMoveY !== 0) {
        if (state.moveX === lastMoveX && state.moveY === lastMoveY) { state.moveX = 0; state.moveY = 0; }
        lastMoveX = lastMoveY = 0;
      }
      if (!inMenu) {
        state.lookDx += f.lookX * G.LOOK_SPEED_X * dt;
        state.lookDy += f.lookY * G.LOOK_SPEED_Y * dt;
      }

      // A menu owns this frame's buttons (pollGamepad handled them).
      if (inMenu) {
        chargeDown = false; dodgeDown = false; setGamepadRunHeld(false);
        return;
      }

      // This frame's edges: everything pressed / released since gameplay last ran.
      const pressed = new Set(pendingPressed);
      const released = new Set(pendingReleased);
      pendingPressed.clear();
      pendingReleased.clear();
      for (const a of pressed) log(`play:${a}`);
      for (const a of released) log(`release:${a}`);

      // ── Attack: hold to charge on charge-class weapons ────────────
      if (pressed.has('attack')) {
        if (wantsHoldToCharge()) { chargeDown = true; chargeStart = performance.now(); }
        else triggerAttack();
      }
      if (chargeDown) {
        if (released.has('attack')) {
          chargeDown = false;
          const alreadySwung = consumeDashSpentSwing();
          tryReleaseChargedAttack();
          if (!alreadySwung) triggerAttack();
          cancelCharge();
        } else {
          setChargeFromHeldMs(performance.now() - chargeStart);
          setChargePosition(window.innerWidth / 2, window.innerHeight / 2);
        }
      }

      // ── B: a tap dodges, a hold runs (the phone dodge button's rule) ─
      if (pressed.has('dodge')) { dodgeDown = true; dodgeDownAt = performance.now(); }
      if (dodgeDown) {
        const heldMs = performance.now() - dodgeDownAt;
        if (released.has('dodge')) {
          dodgeDown = false;
          setGamepadRunHeld(false);
          if (heldMs < HOLD_TO_RUN_MS) triggerDash(state.moveX, state.moveY);
        } else {
          setGamepadRunHeld(heldMs >= HOLD_TO_RUN_MS);
        }
      }

      // ── One-shot verbs ────────────────────────────────────────────
      if (pressed.has('interact')) options.onInteract?.();
      if (pressed.has('quickUse')) useFirstConsumable();
      if (pressed.has('swapWeapon')) triggerWeaponSwap();
      if (pressed.has('rite')) tryActivateRite();
      if (pressed.has('inventory')) toggleInventoryPanel();
      if (pressed.has('menu')) openSettings();
      if (pressed.has('slot1')) useConsumableSlot(1);
      if (pressed.has('slot2')) useConsumableSlot(2);
      if (pressed.has('slot3')) useConsumableSlot(3);
      if (pressed.has('slot4')) useConsumableSlot(4);
    };
  },
};
