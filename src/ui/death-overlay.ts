// "She was forgotten on Depth 1." — the grimdark epitaph that appears during
// the death sequence. Per CLAUDE.md Tone Bible: terse, archaic, cruel,
// indifferent. No exclamation points. No "you died." or "game over."
//
// In-world text only — the snarky broadcast-layer version (achievement pops
// etc.) lands in Phase 4-5, separate from this UI.

const EPITAPHS = [
  'forgotten on depth 1.',
  'she was unmade in the first dark.',
  'the dungeon does not remember your name.',
  'a brief descent.',
  'unremarkable, even to the worms.',
];

let overlay: HTMLDivElement | null = null;

export function showDeathOverlay(): string | undefined {
  if (overlay) return undefined;

  const epitaph = EPITAPHS[Math.floor(Math.random() * EPITAPHS.length)];

  overlay = document.createElement('div');
  overlay.id = 'death-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: '20',
    color: 'rgba(220, 180, 160, 0.85)',
    fontFamily: 'system-ui, -apple-system, serif',
    fontSize: '22px',
    letterSpacing: '0.15em',
    textTransform: 'lowercase',
    textShadow: '0 0 10px rgba(0,0,0,0.95), 0 0 22px rgba(140, 30, 20, 0.4)',
    opacity: '0',
    transition: 'opacity 1.6s ease-in',
    textAlign: 'center',
    padding: '0 24px',
  });
  overlay.textContent = epitaph;
  document.body.appendChild(overlay);

  // Fade in after one frame.
  requestAnimationFrame(() => {
    if (overlay) overlay.style.opacity = '1';
  });
  return epitaph;
}
