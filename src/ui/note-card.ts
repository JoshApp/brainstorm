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

export function showNote(text: string) {
  if (activeCard) dismiss();

  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) scale(0.94)',
    width: 'min(420px, 84vw)',
    maxWidth: '84vw',
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

  document.body.appendChild(card);
  activeCard = card;
  // Modal layer so notes stack ABOVE any panel that might be open. The
  // shared backdrop handles tap-to-dismiss via onDismissRequest below;
  // tap-on-card uses the listener wired just above.
  openScreen({
    id: NOTE_SCREEN_ID,
    root: card,
    policy: { layer: 'modal' },
    onDismissRequest: dismiss,
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
}
