// Note card — an in-world reading overlay for corpse notes, scrawled
// messages, sigil inscriptions. Distinct from broadcastPop (which is the
// snarky cosmic broadcast tone) — this stays in the grimdark register
// per CLAUDE.md Tone Bible. Centered card, parchment-feel typography,
// tap anywhere to dismiss.
//
// Calling pattern: showNote(text). Returns the dismiss function; we
// auto-pause the world while a note is open (uses the input-mode menu
// stack so it follows the existing pause rules).

import { openMenu, closeMenu } from '../controls/input-mode';

const NOTE_MENU_ID = 'note';

let activeCard: HTMLDivElement | null = null;
let backdropClick: ((e: Event) => void) | null = null;

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
    zIndex: '110',
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

  document.body.appendChild(card);
  activeCard = card;
  openMenu(NOTE_MENU_ID);  // pauses the world via the menu stack

  // Slide-up + fade-in on next frame.
  requestAnimationFrame(() => {
    if (!activeCard) return;
    activeCard.style.opacity = '1';
    activeCard.style.transform = 'translate(-50%, -50%) scale(1)';
  });

  // Dismiss on any tap anywhere. We listen on the WHOLE document so users
  // don't have to hit the card itself.
  backdropClick = (e: Event) => {
    // Ignore the initial synthetic touch that may fire as the note opens.
    e.stopPropagation();
    dismiss();
  };
  // Delay attach by one frame so the touch that opened the note doesn't
  // immediately close it.
  setTimeout(() => {
    if (backdropClick) {
      document.addEventListener('pointerdown', backdropClick, { capture: true });
    }
  }, 60);
}

function dismiss() {
  if (!activeCard) return;
  const card = activeCard;
  activeCard = null;
  if (backdropClick) {
    document.removeEventListener('pointerdown', backdropClick, { capture: true });
    backdropClick = null;
  }
  card.style.opacity = '0';
  card.style.transform = 'translate(-50%, -50%) scale(0.94)';
  setTimeout(() => card.remove(), 240);
  closeMenu(NOTE_MENU_ID);
}
