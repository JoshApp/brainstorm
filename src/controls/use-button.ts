// Interact button — bottom-left card combining icon + label. Tap to fire
// the currently-in-range interactable. Earlier this was just an emoji
// button plus a separate text prompt floating above; both have been
// merged here for a single tap target and clearer affordance.
//
// Three visual states:
//   hidden  — nothing in range, button fully transparent + pointer-inert
//   armed   — interactable in range AND unlocked; bright, gentle pulse
//   sealed  — interactable in range but locked (e.g. SEALED door); dimmed
//             gray lock icon, no tap response
//
// API (kept compatible with the existing main-loop call sites):
//   setUseButtonVisible(visible) — visibility toggle
//   setInteractAction(label)     — set label + icon; null hides the icon/text
//   consumeUsePressed()          — drain "pressed since last frame" flag

import { iconKindFromLabel, iconSvg } from '../ui/interact-icons';

let button: HTMLButtonElement | null = null;
let iconEl: HTMLDivElement | null = null;
let labelEl: HTMLDivElement | null = null;
let pressedFlag = false;
let currentLabel: string | null = null;
let armed = false;
let lastVisible = false;

const COLOR_ARMED   = 'rgba(255, 220, 180, 0.96)';
const COLOR_SEALED  = 'rgba(180, 160, 140, 0.55)';
const BG_ARMED      = 'rgba(40, 22, 12, 0.7)';
const BG_PRESSED    = 'rgba(90, 50, 22, 0.85)';
const BG_SEALED     = 'rgba(20, 18, 16, 0.55)';
const BORDER_ARMED  = '1px solid rgba(255, 190, 120, 0.55)';
const BORDER_SEALED = '1px solid rgba(120, 110, 100, 0.35)';
const SHADOW_ARMED  = '0 0 22px rgba(255, 160, 80, 0.30), 0 2px 10px rgba(0,0,0,0.5)';
const SHADOW_SEALED = '0 2px 10px rgba(0,0,0,0.5)';

export function createUseButton() {
  if (button) return;

  // Inject the pulse keyframes once. The armed button breathes gently to
  // attract the eye without strobing.
  if (!document.getElementById('interact-button-keyframes')) {
    const style = document.createElement('style');
    style.id = 'interact-button-keyframes';
    style.textContent = `
      @keyframes interactBtnPulse {
        0%, 100% { box-shadow: 0 0 22px rgba(255, 160, 80, 0.30), 0 2px 10px rgba(0,0,0,0.5); }
        50%      { box-shadow: 0 0 32px rgba(255, 200, 130, 0.50), 0 2px 10px rgba(0,0,0,0.5); }
      }
      @keyframes interactBtnPopIn {
        from { transform: translateY(8px) scale(0.92); opacity: 0; }
        to   { transform: translateY(0) scale(1);    opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  button = document.createElement('button');
  button.id = 'interact-button';
  button.setAttribute('aria-label', 'interact');
  Object.assign(button.style, {
    position: 'fixed',
    left: 'calc(20px + env(safe-area-inset-left, 0px))',
    bottom: 'calc(132px + env(safe-area-inset-bottom, 0px))',
    minWidth: '110px',
    height: '64px',
    padding: '0 18px 0 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    borderRadius: '32px',
    border: BORDER_ARMED,
    background: BG_ARMED,
    color: COLOR_ARMED,
    boxShadow: SHADOW_ARMED,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    zIndex: '12',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease-out, background 0.08s ease-out, opacity 0.18s ease-out, color 0.18s ease, border-color 0.18s ease',
    opacity: '0',
    pointerEvents: 'none',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);

  // Icon container — sits on the left of the card.
  iconEl = document.createElement('div');
  Object.assign(iconEl.style, {
    width: '34px',
    height: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
  });
  button.appendChild(iconEl);

  // Label — small caps, sits next to the icon.
  labelEl = document.createElement('div');
  Object.assign(labelEl.style, {
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    textShadow: '0 1px 0 rgba(0,0,0,0.7)',
    paddingTop: '1px',
  });
  button.appendChild(labelEl);

  const press = (e: Event) => {
    e.preventDefault();
    if (!armed || button!.style.opacity === '0') return;
    pressedFlag = true;
    button!.style.transform = 'scale(0.94)';
    button!.style.background = BG_PRESSED;
  };
  const release = () => {
    button!.style.transform = 'scale(1)';
    if (armed) button!.style.background = BG_ARMED;
    else       button!.style.background = BG_SEALED;
  };

  button.addEventListener('touchstart', press, { passive: false });
  button.addEventListener('touchend', release);
  button.addEventListener('touchcancel', release);
  button.addEventListener('mousedown', press);
  button.addEventListener('mouseup', release);
  button.addEventListener('mouseleave', release);

  document.body.appendChild(button);
}

/** Sets the current action — icon + label. Pass null to clear (the button
 *  hides via setUseButtonVisible). Sealed states (label === 'SEALED') get
 *  the locked/dimmed look automatically. */
export function setInteractAction(label: string | null) {
  if (!button || !iconEl || !labelEl) return;
  if (label === currentLabel) return;
  currentLabel = label;

  if (!label) {
    return;
  }

  const upper = label.toUpperCase();
  const isSealed = upper === 'SEALED';
  armed = !isSealed;

  const kind = iconKindFromLabel(label);
  iconEl.innerHTML = iconSvg(kind);
  // Set the SVG to inherit text color sizing.
  const svg = iconEl.firstElementChild as SVGElement | null;
  if (svg) {
    svg.setAttribute('width', '34');
    svg.setAttribute('height', '34');
  }
  labelEl.textContent = upper;

  // Style swap for sealed vs armed.
  if (isSealed) {
    button.style.color = COLOR_SEALED;
    button.style.background = BG_SEALED;
    button.style.border = BORDER_SEALED;
    button.style.boxShadow = SHADOW_SEALED;
    button.style.animation = 'none';
  } else {
    button.style.color = COLOR_ARMED;
    button.style.background = BG_ARMED;
    button.style.border = BORDER_ARMED;
    button.style.boxShadow = SHADOW_ARMED;
    button.style.animation = 'interactBtnPulse 2.2s ease-in-out infinite';
  }
}

/** Show/hide the button based on whether something is in range. The
 *  pop-in animation only fires on hidden → visible transitions so it
 *  doesn't restart every frame (which would freeze the button at the
 *  animation's start state). */
export function setUseButtonVisible(visible: boolean) {
  if (!button) return;
  button.style.opacity = visible ? '1' : '0';
  button.style.pointerEvents = visible && armed ? 'auto' : 'none';
  if (visible && !lastVisible) {
    // Hidden → visible: replay pop-in. Force a reflow so the animation
    // restarts cleanly.
    button.style.animation = 'none';
    void button.offsetWidth;
    button.style.animation = armed
      ? 'interactBtnPopIn 220ms ease-out, interactBtnPulse 2.2s ease-in-out infinite 220ms'
      : 'interactBtnPopIn 220ms ease-out';
  } else if (!visible && lastVisible) {
    // Visible → hidden: cancel any in-flight animations so the next
    // appearance pops in fresh.
    button.style.animation = 'none';
  }
  lastVisible = visible;
}

/** Consume the "use pressed since last frame" flag. */
export function consumeUsePressed(): boolean {
  if (!pressedFlag) return false;
  pressedFlag = false;
  return true;
}
