// Safe-room transition card.
//
// Shown ONCE when the player descends from a boss floor into a safe room
// (level id `safe-N`). Sits over the world for a beat — title + terse
// beat + small stat strip — then dismisses on tap or auto-fades.
//
// Tone: in-world, NOT broadcast-snark. The Tone Bible's voice — terse,
// archaic, indifferent. The DCC broadcast layer (achievement pops) can
// still fire during or after; this card is the dungeon speaking.

import { openScreen, closeScreen } from './screen-manager';

const SCREEN_ID = 'safe-room-transition';
const AUTO_DISMISS_MS = 6000;
const FADE_IN_MS = 600;
const FADE_OUT_MS = 500;
// The card pops over the world the instant the player crosses into the
// safe room — often mid-tap from whatever they were just doing. Swallow
// dismiss input until it has fully faded in (plus a beat), so a stray
// tap on spawn can't blow past the moment. Auto-dismiss is unaffected.
const DISMISS_GRACE_MS = FADE_IN_MS + 350;

export interface SafeRoomTransitionStats {
  /** Act name that the player has just survived (e.g. 'The Old Refectory'). */
  actName: string;
  /** Dungeon depth the player just left (the boss-floor's depth). */
  depth: number;
  /** Enemies killed during the act. */
  kills: number;
  /** XP earned during the act. */
  xp: number;
}

let root: HTMLDivElement | null = null;
let suppressNext = false;

/** Suppress the next showSafeRoomTransition call. Used by debug
 *  scenarios that drop the player straight into a safe room — the
 *  card would obscure the geometry the scenario wants to show. */
export function suppressNextSafeRoomTransition(): void {
  suppressNext = true;
}

export function showSafeRoomTransition(stats: SafeRoomTransitionStats): void {
  if (root) return;
  if (suppressNext) { suppressNext = false; return; }

  root = document.createElement('div');
  root.id = 'safe-room-transition';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    background: 'radial-gradient(ellipse at center, rgba(20, 10, 4, 0.88) 0%, rgba(0, 0, 0, 0.96) 80%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '18px',
    fontFamily: 'Georgia, "Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(232, 200, 160, 0.92)',
    pointerEvents: 'auto',
    opacity: '0',
    transition: `opacity ${FADE_IN_MS}ms ease`,
    padding: '0 24px',
    textAlign: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);

  // Title — "The Old Refectory yields." Big italic serif.
  const title = document.createElement('div');
  title.textContent = `${stats.actName} yields.`;
  Object.assign(title.style, {
    fontSize: 'clamp(24px, 6vw, 44px)',
    fontStyle: 'italic',
    fontWeight: '300',
    color: 'rgba(240, 210, 170, 0.95)',
    letterSpacing: '0.06em',
    textShadow: '0 0 24px rgba(180, 90, 30, 0.35)',
    maxWidth: '720px',
    lineHeight: '1.25',
  });
  root.appendChild(title);

  // Beat — terse line, smaller, the in-world voice.
  const beat = document.createElement('div');
  beat.textContent = 'You did well. The dungeon does not sleep.';
  Object.assign(beat.style, {
    fontSize: 'clamp(14px, 3vw, 18px)',
    fontStyle: 'italic',
    color: 'rgba(200, 170, 130, 0.78)',
    letterSpacing: '0.10em',
    maxWidth: '500px',
    lineHeight: '1.5',
  });
  root.appendChild(beat);

  // Faint divider.
  const rule = document.createElement('div');
  Object.assign(rule.style, {
    width: '60px',
    height: '1px',
    background: 'rgba(180, 130, 80, 0.35)',
    margin: '10px 0 4px 0',
  });
  root.appendChild(rule);

  // Stat strip — small, dim, no celebration. Clerk's tally.
  const strip = document.createElement('div');
  strip.textContent = `Depth ${stats.depth}  ·  ${stats.kills} slain  ·  ${stats.xp} xp`;
  Object.assign(strip.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    letterSpacing: '0.22em',
    color: 'rgba(170, 140, 105, 0.65)',
  });
  root.appendChild(strip);

  // Tap-to-continue prompt. Fades in late so it doesn't compete with
  // the title's arrival.
  const hint = document.createElement('div');
  hint.textContent = 'tap to rest';
  Object.assign(hint.style, {
    marginTop: '28px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.32em',
    textTransform: 'uppercase',
    color: 'rgba(180, 150, 115, 0.5)',
    opacity: '0',
    transition: 'opacity 800ms ease 1200ms',
  });
  root.appendChild(hint);

  document.body.appendChild(root);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    hideSafeRoomTransition();
  };

  // True once the grace window has elapsed — only then does player input
  // dismiss the card. Before that the input is swallowed (the handler fires but
  // no-ops) so it doesn't leak to the paused canvas; the card just stays up.
  const openedAt = performance.now();
  const pastGrace = () => performance.now() - openedAt >= DISMISS_GRACE_MS;

  openScreen({
    id: SCREEN_ID,
    onForceClose: () => hideSafeRoomTransition(),
    root,
    policy: {
      pausesWorld: true,
      hidesHud: true,
      dimsScene: false,   // the card IS the full backdrop
      needsBackdrop: false,
      layer: 'title',
      // Do NOT free the cursor: this card dismisses via the capture-phase
      // pointerdown below (which works while pointer-locked) + ESC/timer, so it
      // never needs a cursor. Keeping the lock HELD across the descent means the
      // screen-manager doesn't release-then-reacquire it on close — which is
      // exactly what popped the browser's "press ESC / reclaim your cursor"
      // banner on every descent (desktop). Menus that truly need clicks keep the
      // default needsCursor:true.
      needsCursor: false,
    },
    // Keyboard is CONTAINED in the one input scheme: ESC → onDismissRequest,
    // Space/Enter/interact → onConfirm (both gated by the grace window). No
    // per-card window keydown listener — that scattering (and its missing
    // stopPropagation, which double-opened the menu) was the leak.
    onDismissRequest: () => { if (pastGrace()) dismiss(); },
    onConfirm: () => { if (pastGrace()) dismiss(); },
  });

  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
    if (hint) hint.style.opacity = '1';
  });

  // Tap/click ANYWHERE to dismiss — the overlay's own pointer affordance (a
  // full-bleed card with no shared backdrop). Capture-phase so it beats any
  // pointer-locked canvas handler. Keyboard is the screen manager's job now.
  const onPointer = (e: Event) => { e.preventDefault(); if (pastGrace()) dismiss(); };
  window.addEventListener('pointerdown', onPointer, { capture: true });

  // Auto-dismiss after a beat — players who want to soak in the moment
  // can, but the card never strands a distracted player.
  const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);

  // Tear down listeners on close. We attach this AFTER openScreen so
  // the close hook stays local to this call.
  const teardown = () => {
    window.removeEventListener('pointerdown', onPointer, { capture: true } as AddEventListenerOptions);
    window.clearTimeout(timer);
  };
  // Stash so hideSafeRoomTransition can call it.
  pendingTeardown = teardown;
}

let pendingTeardown: (() => void) | null = null;

export function hideSafeRoomTransition(): void {
  if (!root) return;
  const r = root;
  root = null;
  r.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
  r.style.opacity = '0';
  if (pendingTeardown) { pendingTeardown(); pendingTeardown = null; }
  closeScreen(SCREEN_ID);
  window.setTimeout(() => r.remove(), FADE_OUT_MS + 50);
}
