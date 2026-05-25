// Bottom-center prompt overlay shown when the player is in range of an
// interactable. Just a small text label — "OPEN", "TAKE", etc. — that
// appears above the USE button area. Fades in/out smoothly.

let prompt: HTMLDivElement | null = null;
let currentLabel = '';

export function createInteractPrompt() {
  if (prompt) return;

  prompt = document.createElement('div');
  prompt.id = 'interact-prompt';
  Object.assign(prompt.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(220px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    color: 'rgba(255, 220, 180, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '18px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    textShadow: '0 0 8px rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.9)',
    padding: '8px 16px',
    background: 'rgba(20, 12, 8, 0.55)',
    border: '1px solid rgba(255, 180, 110, 0.35)',
    borderRadius: '4px',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '11',
    transition: 'opacity 0.2s ease-out',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  prompt.textContent = '';
  document.body.appendChild(prompt);
}

export function setInteractPrompt(label: string | null) {
  if (!prompt) return;
  if (label && label !== currentLabel) {
    prompt.textContent = label;
    currentLabel = label;
  }
  prompt.style.opacity = label ? '1' : '0';
}
