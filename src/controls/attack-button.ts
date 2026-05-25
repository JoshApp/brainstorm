// Bottom-right circular attack button. DOM overlay above the canvas.
//
// NOTE: as of the controls rework, this button is NOT created on game start
// — the right half of the screen is a tap-to-attack zone. The module is
// kept for desktop/dev use if needed, and now routes its press through the
// shared attack-input module so the rest of the game doesn't care where
// the attack input originated.

import { triggerAttack } from './attack-input';

let button: HTMLButtonElement | null = null;

export function createAttackButton() {
  if (button) return;

  button = document.createElement('button');
  button.id = 'attack-button';
  button.setAttribute('aria-label', 'attack');
  button.textContent = '⚔';
  Object.assign(button.style, {
    position: 'fixed',
    right: 'calc(24px + env(safe-area-inset-right, 0px))',
    bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
    width: '88px',
    height: '88px',
    borderRadius: '50%',
    border: '2px solid rgba(255, 200, 140, 0.5)',
    background: 'rgba(40, 20, 10, 0.55)',
    color: 'rgba(255, 220, 180, 0.85)',
    fontSize: '36px',
    lineHeight: '1',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 0 18px rgba(255, 140, 60, 0.25)',
    textShadow: '0 0 8px rgba(0,0,0,0.8)',
    zIndex: '12',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, background 0.08s ease-out',
  });

  const press = (e: Event) => {
    e.preventDefault();
    triggerAttack();
    button!.style.transform = 'scale(0.92)';
    button!.style.background = 'rgba(80, 40, 20, 0.8)';
  };
  const release = () => {
    button!.style.transform = 'scale(1)';
    button!.style.background = 'rgba(40, 20, 10, 0.55)';
  };

  button.addEventListener('touchstart', press, { passive: false });
  button.addEventListener('touchend', release);
  button.addEventListener('touchcancel', release);
  button.addEventListener('mousedown', press);
  button.addEventListener('mouseup', release);
  button.addEventListener('mouseleave', release);

  document.body.appendChild(button);
}

