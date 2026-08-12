import { isDesktopLike } from './platform';
import { isGameControlMode } from './input-mode';
import { deflectOpportunityActive } from '../combat/reactive-defense';

// THE PARRY BUTTON.
//
// This is NOT a new verb — it is two existing verbs being un-merged. Parry used
// to share the attack tap: `resolveTap` rule 0 returned `deflect` whenever any
// enemy was flashing a deflectable strike, so the same finger did both and the
// arbiter had to guess intent at exactly the moment intent matters most.
//
// Three things were wrong with that, and all three go away here:
//
//   YOU COULD NOT CHOOSE TO TRADE. While anything flashed white, every tap in
//   the combat zone parried. There was no way to say "I'll eat this and swing
//   anyway" — a legitimate read, and one the player had no input for.
//
//   IT COULD DEADLOCK. A leaked deflect opportunity (a mob killed mid-flash)
//   left the count stuck true, and every tap dead-routed to a no-op parry while
//   the player mashed a button that no longer swung. The codebase carries scar
//   tissue about this in several comments.
//
//   PARRY COULD NOT HAVE AN ANIMATION. A shared input can't be animated on
//   press, because the game doesn't yet know which action it is. A dedicated
//   press can raise a guard immediately — see viewmodel.parryGuard.
//
// PLACEMENT. Right thumb arc, above the dodge pad — matching the priority every
// mobile action game converges on (dodge biggest and closest, parry second).
// Deliberately SMALLER than dodge (58 vs 74px) and spaced clear of it: two
// same-sized circles under one thumb is a mis-tap at the exact moment a mis-tap
// is fatal. Size encodes priority as well as reach.
//
// ALWAYS VISIBLE, brightening when a deflect is live. A button that only
// appeared when parryable would make this a QTE prompt — you'd react to the
// button instead of reading the enemy. It stays put so the thumb learns it, and
// the glow teaches the timing without becoming the thing you watch.
//
// DESKTOP GETS NOTHING — keys are bound and a HUD button beside a keyboard is
// clutter. Same gate as the dodge button.

let btn: HTMLButtonElement | null = null;
let onPress: (() => void) | null = null;
let flashing = false;

/** Wire the press. Called once at boot with the parry entry point. */
export function setParryHandler(fn: () => void): void {
  onPress = fn;
}

export function createParryButton(): void {
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'parry-button';
  Object.assign(btn.style, {
    position: 'fixed',
    // UP-AND-LEFT of the dodge pad, not directly above it. The right thumb
    // pivots from the corner in an ARC, so this sits on the natural sweep — and
    // stacking straight up would have collided with the weapon-swap chip, which
    // owns the vertical column at bottom 150px (58 tall → 150-208).
    //
    // The right rail, in full, so the next person adding a button can see it:
    //   dodge  right  20-94,  bottom  28-102  (74px, the biggest — most used)
    //   PARRY  right 108-164, bottom  46-102  (56px, second priority)
    //   swap   right  22-80,  bottom 150-208  (hidden until you carry a sidearm)
    //   rite   right  20-86,  bottom 110-176  (not created today)
    // 14px of clear air between dodge and parry at zero inset, widening on a
    // notched device since dodge tracks the inset and this adds to it.
    right: 'calc(108px + env(safe-area-inset-right, 0px))',
    bottom: 'calc(46px + env(safe-area-inset-bottom, 0px))',
    width: '56px', height: '56px', borderRadius: '50%',
    border: '2px solid #4a4038',
    background: 'radial-gradient(circle at 50% 38%, rgba(60,52,44,0.5), rgba(18,15,12,0.6))',
    color: '#cbb89c', fontFamily: 'serif', fontSize: '9px', fontWeight: '700',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    touchAction: 'none', zIndex: '41', userSelect: 'none', cursor: 'pointer',
    boxShadow: '0 3px 12px rgba(0,0,0,0.5)',
    transition: 'border-color 90ms linear, box-shadow 90ms linear',
    // The look side sits under this — without it, a press that drifts would
    // drag the camera as well as parry.
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);
  btn.textContent = 'PARRY';

  const down = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!isGameControlMode()) return;
    // Fires on DOWN, not up. A parry is a timing input measured against an
    // incoming blade; charging the player for their own release latency would
    // hand a chunk of the window to the hardware.
    onPress?.();
  };

  btn.addEventListener('pointerdown', down);
  document.body.appendChild(btn);
}

/** Per-frame: show on touch, and brighten while a deflectable strike is live. */
export function tickParryButton(): void {
  if (!btn) return;
  const on = !isDesktopLike();
  btn.style.display = on ? 'flex' : 'none';
  if (!on) return;
  const live = deflectOpportunityActive();
  if (live === flashing) return;          // only touch the DOM on a change
  flashing = live;
  btn.style.borderColor = live ? '#e8dcc0' : '#4a4038';
  btn.style.color = live ? '#fff4d8' : '#cbb89c';
  btn.style.boxShadow = live
    ? '0 0 14px rgba(232,220,192,0.55), 0 3px 12px rgba(0,0,0,0.5)'
    : '0 3px 12px rgba(0,0,0,0.5)';
}

/** Drop visual state (death, level load, menu). */
export function resetParryButton(): void {
  flashing = false;
  if (btn) {
    btn.style.borderColor = '#4a4038';
    btn.style.color = '#cbb89c';
    btn.style.boxShadow = '0 3px 12px rgba(0,0,0,0.5)';
  }
}
