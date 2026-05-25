// Bottom-left circular USE button. Mirror of the attack button on the right.
// Only visible while an interactable is in range — fades in when the prompt
// overlay shows, fades out when it disappears. Tap to fire the current
// in-range interactable's onUse.

let button: HTMLButtonElement | null = null;
let pressedFlag = false;

export function createUseButton() {
  if (button) return;

  button = document.createElement('button');
  button.id = 'use-button';
  button.setAttribute('aria-label', 'use');
  button.textContent = '✋';
  Object.assign(button.style, {
    position: 'fixed',
    left: 'calc(24px + env(safe-area-inset-left, 0px))',
    bottom: 'calc(140px + env(safe-area-inset-bottom, 0px))',  // above the joystick area
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    border: '2px solid rgba(255, 200, 140, 0.5)',
    background: 'rgba(40, 20, 10, 0.55)',
    color: 'rgba(255, 220, 180, 0.95)',
    fontSize: '28px',
    lineHeight: '1',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 0 18px rgba(255, 140, 60, 0.25)',
    textShadow: '0 0 8px rgba(0,0,0,0.8)',
    zIndex: '12',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, background 0.08s ease-out, opacity 0.18s ease-out',
    opacity: '0',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);

  const press = (e: Event) => {
    e.preventDefault();
    if (button!.style.opacity === '0') return;  // ignore presses while hidden
    pressedFlag = true;
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

/** Show/hide the button based on whether something is in range. */
export function setUseButtonVisible(visible: boolean) {
  if (!button) return;
  button.style.opacity = visible ? '1' : '0';
  button.style.pointerEvents = visible ? 'auto' : 'none';
}

/** Consume the "use pressed since last frame" flag. Returns true at most once per press. */
export function consumeUsePressed(): boolean {
  if (!pressedFlag) return false;
  pressedFlag = false;
  return true;
}
