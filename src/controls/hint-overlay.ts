// One-time tutorial hint shown at game start. Two ghostly lines on the bottom,
// one per screen half, telling the player how to move and look. Dismissed on
// first interaction (touch, keypress, or mouse) and never returned to.

let hint: HTMLDivElement | null = null;
let dismissed = false;

export function showFirstTimeHint() {
  if (hint || dismissed) return;

  hint = document.createElement('div');
  hint.id = 'hint-overlay';
  Object.assign(hint.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '5',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: '0 32px calc(20vh + env(safe-area-inset-bottom, 0px)) 32px',
    color: 'rgba(255, 200, 140, 0.55)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    textShadow: '0 0 8px rgba(0,0,0,0.9)',
    transition: 'opacity 0.6s ease-out',
    opacity: '1',
  });

  const left = document.createElement('div');
  left.textContent = 'touch left · move';
  const right = document.createElement('div');
  right.textContent = 'swipe right · look';

  hint.appendChild(left);
  hint.appendChild(right);
  document.body.appendChild(hint);

  // Auto-fade after a few seconds even if no interaction.
  setTimeout(() => {
    if (!dismissed) dismissHint();
  }, 6000);
}

export function dismissHint() {
  if (dismissed || !hint) return;
  dismissed = true;
  hint.style.opacity = '0';
  setTimeout(() => {
    hint?.remove();
    hint = null;
  }, 700);
}
