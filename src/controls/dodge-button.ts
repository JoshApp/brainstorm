import { triggerDash } from './dash-input';
import { getSettings } from '../settings/settings';
import { isDesktopLike } from './platform';
import { isGameControlMode } from './input-mode';

// THE DODGE BUTTON — and the sprint that shares it.
//
// Both existing dodge gestures (flick, double-tap) ask the LEFT thumb — the one
// steering — to stop steering and perform an aim-and-release. That is hard to do
// mid-fight, it is the pattern the mobile-controls literature specifically warns
// against, and it is what Josh reported struggling with on the phone.
//
// Every shipped action game on a phone answers this the same way: movement stick
// on the left, camera drag on the right, and DISCRETE ACTION BUTTONS in the
// right thumb arc. Genshin's Evade sits bottom-right and doubles as sprint on
// hold. That is exactly this.
//
// Two things fall out of it that a gesture cannot give:
//
//   MASHABLE. A button can be pressed again immediately. An aim-and-release
//   cannot. That is the difference between "you can chain vaults" being a thing
//   the player does and a thing they discover by accident once.
//
//   SPRINT FOR FREE. DELVE has no sprint at all. Hold-to-run on the button
//   already in your thumb costs no new control and no new screen real estate.
//
// DESKTOP GETS NOTHING. Keys are already bound and a HUD button on a machine
// with a keyboard is clutter; `isDesktopLike` gates the whole thing.

/** Held longer than this and the press is a SPRINT, not a dodge. Short enough
 *  that a panic-tap never accidentally runs, long enough that a deliberate hold
 *  never accidentally dodges. */
const HOLD_TO_RUN_MS = 180;

let btn: HTMLButtonElement | null = null;
let pressedAt = 0;
let holding = false;
let sprinting = false;
/** Set by the input scheme each frame so the button can dodge the way the stick
 *  is already pointing — the whole point of not asking the thumb to aim. */
let heldX = 0, heldY = 0;

/** The move stick's current direction, camera-relative. Called by the input
 *  scheme; (0,0) means neutral, which dodges as a backstep. */
export function setDodgeButtonAim(x: number, y: number): void {
  heldX = x; heldY = y;
}

/**
 * Is the player holding the button down to run? Read by the movement code.
 *
 * Also gated on the game actually having control. A menu or a screen opening
 * over a held button swallows the pointerup, so `holding` would stay true and
 * the player would come back sprinting forever. Asking the control mode is
 * cheaper and more robust than trying to catch every way a press can be
 * interrupted.
 */
export function isSprinting(): boolean {
  return sprinting && isGameControlMode();
}

export function createDodgeButton(): void {
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'dodge-button';
  Object.assign(btn.style, {
    position: 'fixed',
    right: 'max(20px, env(safe-area-inset-right, 0px))',
    bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
    width: '74px', height: '74px', borderRadius: '50%',
    border: '2px solid #4a4038',
    background: 'radial-gradient(circle at 50% 38%, rgba(60,52,44,0.55), rgba(18,15,12,0.62))',
    color: '#cbb89c', fontFamily: 'serif', fontSize: '10px', fontWeight: '700',
    letterSpacing: '0.12em', textTransform: 'uppercase',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    touchAction: 'none', zIndex: '41', userSelect: 'none', cursor: 'pointer',
    boxShadow: '0 3px 12px rgba(0,0,0,0.5)',
    // The look side sits under this; without it a press that drifts would drag
    // the camera as well as dodge.
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);
  btn.textContent = 'DODGE';

  const down = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    pressedAt = performance.now();
    holding = true;
    btn!.style.borderColor = '#7d6a52';
  };
  const up = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!holding) return;
    holding = false;
    sprinting = false;
    btn!.style.borderColor = '#4a4038';
    // A SHORT press is the dodge. A long one was a run, and releasing a run
    // must not fling you — otherwise every sprint ends in a dodge you did not
    // ask for, which is worse than having no sprint.
    if (performance.now() - pressedAt < HOLD_TO_RUN_MS) triggerDash(heldX, heldY);
  };

  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
  document.body.appendChild(btn);
}

/** Per-frame: show/hide by setting, and promote a long press to a sprint. */
export function tickDodgeButton(): void {
  if (!btn) return;
  const on = !isDesktopLike() && getSettings().dashGesture === 'button';
  btn.style.display = on ? 'flex' : 'none';
  if (!on) { holding = false; sprinting = false; return; }
  sprinting = holding && performance.now() - pressedAt >= HOLD_TO_RUN_MS;
  btn.style.color = sprinting ? '#e8d8b8' : '#cbb89c';
}

/** Drop any held state (death, level load, menu). */
export function resetDodgeButton(): void {
  holding = false;
  sprinting = false;
  if (btn) btn.style.borderColor = '#4a4038';
}
