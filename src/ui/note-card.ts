// Note card — an in-world reading overlay for corpse notes, scrawled
// messages, sigil inscriptions. Distinct from broadcastPop (which is the
// snarky cosmic broadcast tone) — this stays in the grimdark register
// per CLAUDE.md Tone Bible. Centered card, parchment-feel typography,
// tap anywhere (the shared backdrop) to dismiss.
//
// Calling pattern: showNote(text). Pauses the world via the screen
// manager — same pause rules as inventory/settings.

import { openScreen, closeScreen } from './screen-manager';

const NOTE_SCREEN_ID = 'note';

let activeCard: HTMLDivElement | null = null;
let notePointerHandler: ((e: PointerEvent) => void) | null = null;

export function showNote(text: string) {
  if (activeCard) dismiss();

  const card = document.createElement('div');
  card.id = 'note-card';
  Object.assign(card.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) scale(0.94)',
    width: 'min(420px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))',
    // Cap height to the viewport and scroll a long note rather than
    // letting it run off the top/bottom on a small screen. overflow-y
    // also opts this card + its descendants into touch-pan (see index.html).
    overflowY: 'auto',
    // Aged parchment palette — warm sepia on dark, not white-paper
    background: 'linear-gradient(180deg, rgba(46, 32, 20, 0.96), rgba(28, 20, 14, 0.96))',
    border: '1px solid rgba(170, 130, 80, 0.45)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.7), inset 0 0 20px rgba(180, 140, 80, 0.08)',
    borderRadius: '3px',
    padding: '22px 26px',
    color: '#d9c7a8',
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    fontSize: '15px',
    lineHeight: '1.55',
    letterSpacing: '0.01em',
    textAlign: 'center',
    pointerEvents: 'auto',
    transition: 'opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    opacity: '0',
  });
  // Bounded height: vh fallback, then dvh + safe-area (same pattern as
  // menu-shell) so a long note never runs off a short landscape screen.
  card.style.maxHeight = '84vh';
  card.style.maxHeight = 'calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';

  // Mark — a small inscribed sigil at the top of the note. Sets the tone
  // before any text is read.
  const sigil = document.createElement('div');
  sigil.textContent = '✠';
  Object.assign(sigil.style, {
    fontSize: '22px',
    color: 'rgba(200, 160, 100, 0.55)',
    marginBottom: '10px',
  });
  card.appendChild(sigil);

  const body = document.createElement('div');
  body.textContent = text;
  // Subtle italic for a "scratched into the page" feel.
  Object.assign(body.style, {
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap',
  });
  card.appendChild(body);

  const hint = document.createElement('div');
  hint.textContent = 'tap to close';
  Object.assign(hint.style, {
    marginTop: '18px',
    fontSize: '10px',
    letterSpacing: '0.2em',
    color: 'rgba(170, 130, 80, 0.55)',
    textTransform: 'uppercase',
    fontFamily: 'system-ui, sans-serif',
    fontStyle: 'normal',
  });
  card.appendChild(hint);

  // Tap ANYWHERE on the card itself dismisses too, not just on the
  // backdrop. The card has pointerEvents:'auto' (so swipes through
  // it don't pass to the world) which means tap-on-card would
  // otherwise just sit there — players reach for the visible
  // note to close it, this honours that instinct.
  card.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dismiss();
  });
  // Keyboard dismissal (Space / Enter / E / Esc) is owned by the ONE contained
  // input scheme (input-desktop.ts) via the screen manager: ESC → onDismissRequest,
  // the advance keys → onConfirm — both wired on the openScreen call below. No
  // per-card window keydown listener; that scattering was the leak.

  // Desktop pointer-lock case: clicks on the locked canvas fire
  // mousedown on the canvas (not the card / not the screen
  // backdrop), so neither the card's own pointerdown nor the
  // screen-manager's backdrop dismissal catches them. A
  // capture-phase window listener swallows the click + closes
  // the note. The card's own pointerdown still wins for
  // taps on the card; the screen backdrop still wins for
  // taps on the dimmed area; this handles "anywhere else".
  const onPointer = (e: PointerEvent) => {
    if (!activeCard) return;
    // Only left button (or any touch). Right-click reserved.
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  };
  window.addEventListener('pointerdown', onPointer, true);
  notePointerHandler = onPointer;

  document.body.appendChild(card);
  activeCard = card;
  // Modal layer so notes stack ABOVE any panel that might be open. The
  // shared backdrop handles tap-to-dismiss via onDismissRequest below;
  // tap-on-card uses the listener wired just above.
  openScreen({
    id: NOTE_SCREEN_ID,
    onForceClose: () => dismiss(),
    root: card,
    // needsCursor:false → stay in mouse-look while reading; tap-anywhere /
    // any-key dismisses (handled below), so dismissing returns straight to
    // FPS with no stray cursor. The window-capture handlers below catch
    // the click even while pointer-locked.
    policy: { layer: 'modal', needsCursor: false },
    onDismissRequest: dismiss,   // ESC / backdrop tap
    onConfirm: dismiss,          // Space / Enter / interact
  });

  // Slide-up + fade-in on next frame.
  requestAnimationFrame(() => {
    if (!activeCard) return;
    activeCard.style.opacity = '1';
    activeCard.style.transform = 'translate(-50%, -50%) scale(1)';
  });
}

function dismiss() {
  if (!activeCard) return;
  const card = activeCard;
  activeCard = null;
  card.style.opacity = '0';
  card.style.transform = 'translate(-50%, -50%) scale(0.94)';
  setTimeout(() => card.remove(), 240);
  closeScreen(NOTE_SCREEN_ID);
  // Tear down the global listeners so they don't linger past
  // dismissal and eat input outside note-reading state.
  if (notePointerHandler) {
    window.removeEventListener('pointerdown', notePointerHandler, true);
    notePointerHandler = null;
  }
}
