// THE INSCRIPTION — the environment's quiet reading voice. When you take a relic
// or a fate, you READ what you took: a line of parchment-serif text fades up
// centred on the screen, holds, and fades — no pause, no dismissal, the way a
// wall-scrawl or a note reads. This is the READING register (the same parchment
// feel as note-card.ts), deliberately SEPARATE from broadcastPop (the deep's
// snarky voice, top of screen) and from pickup-notification (the terse "what you
// got" toast). Three channels, three jobs: the place speaks HERE; the deep speaks
// in the pop; the HUD labels the grab in the toast.
//
//   showInscription("Worn on the hand that held the knife…");
//
// Non-blocking (pointer-events off, never opens a screen), so it layers over
// gameplay. Latest wins — a new inscription replaces one still fading.

let el: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensure(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'inscription';
  el.classList.add('game-hud');
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    top: '38%',
    transform: 'translate(-50%, -6px)',
    // Clear of the depth header (top) and the pinned item-preview (bottom).
    maxWidth: 'min(560px, 82vw)',
    textAlign: 'center',
    // The reading register — aged parchment serif, warm sepia, italic. Matches
    // note-card.ts so a read line feels like the same hand across the game.
    fontFamily: '"Iowan Old Style", "Palatino Linotype", "Palatino", "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(15px, 2.6vw, 20px)',
    lineHeight: '1.5',
    letterSpacing: '0.01em',
    color: 'rgba(226, 205, 168, 0.96)',
    textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 0 22px rgba(0,0,0,0.7)',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '34',
    opacity: '0',
    transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.2,0.8,0.2,1)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

/** Read a line into the world — fades up centred, holds, fades away. Hold time
 *  scales with length (a longer inscription lingers). */
export function showInscription(text: string, opts: { holdMs?: number } = {}): void {
  if (!text) return;
  const node = ensure();
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  node.textContent = text;
  // Reset then fade up on the next frame so a replacement re-animates.
  node.style.transition = 'none';
  node.style.opacity = '0';
  node.style.transform = 'translate(-50%, 8px)';
  void node.offsetWidth;
  node.style.transition = 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.2,0.8,0.2,1)';
  node.style.opacity = '1';
  node.style.transform = 'translate(-50%, -6px)';

  const hold = opts.holdMs ?? Math.min(5200, 1900 + text.length * 32);
  hideTimer = setTimeout(() => {
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -18px)';
  }, hold);
}
