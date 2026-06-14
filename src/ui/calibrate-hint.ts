import { getSettings, updateSettings } from '../settings/settings';
import { openWickRitual } from './wick-ritual';

// First-run calibrate nudge — a one-time, NON-BLOCKING pointer toward the
// brightness ritual (which now lives in Settings, not on the bonfire). A
// phone plays in a midnight bed and a sunny train; a new player should be
// told, once, that the dark is tunable — without a forced gate before the
// game (they land in the world first, per the design call).
//
// It's a tappable pill in the voice-in-the-deep register (the thing that
// watches, teasing): tap it to calibrate now, or ignore it and find it in
// Settings later. Shows exactly once, ever — gated by settings.calibrateHintSeen.

let pill: HTMLDivElement | null = null;
let hideTimer: number | undefined;

const SHOW_DELAY_MS = 1400;   // let the arrival wake (blink/blur) settle first
const LINGER_MS = 11000;      // generous — a new player reads slowly
const FADE_MS = 400;

/** Show the calibrate nudge once. No-op if already seen or already on
 *  screen. Call at a calm arrival moment (first gameplay floor). */
export function maybeShowCalibrateHint(): void {
  if (pill) return;
  if (getSettings().calibrateHintSeen) return;
  // Mark seen immediately — even if the player ignores or misses it, we
  // promised "once". They can always reach it in Settings.
  updateSettings({ calibrateHintSeen: true });

  window.setTimeout(mount, SHOW_DELAY_MS);
}

function mount(): void {
  if (pill) return;
  pill = document.createElement('div');
  Object.assign(pill.style, {
    position: 'fixed',
    left: '50%',
    top: '30%',
    transform: 'translateX(-50%) translateY(-8px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '12px 20px',
    maxWidth: 'min(440px, 84vw)',
    textAlign: 'center',
    background: 'rgba(16, 10, 7, 0.82)',
    border: '1px solid rgba(255, 170, 90, 0.5)',
    borderRadius: '4px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.8), 0 0 22px rgba(180, 90, 30, 0.2)',
    opacity: '0',
    cursor: 'pointer',
    zIndex: '40',
    transition: `opacity ${FADE_MS}ms ease-out, transform ${FADE_MS}ms ease-out`,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);

  // Voice line — the thing in the deep, teasing.
  const voice = document.createElement('div');
  voice.textContent = 'Your eyes are not made for my dark.';
  Object.assign(voice.style, {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: '15px',
    color: 'rgba(255, 222, 184, 0.96)',
    textShadow: '0 0 6px rgba(0,0,0,0.9)',
    letterSpacing: '0.03em',
  } as Partial<CSSStyleDeclaration>);

  // Action affordance — tap to calibrate, or find it later.
  const action = document.createElement('div');
  action.textContent = 'Tend the lamp — tap here, or later in Settings.';
  Object.assign(action.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(255, 190, 110, 0.82)',
  } as Partial<CSSStyleDeclaration>);

  pill.append(voice, action);
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
    openWickRitual();
  });
  document.body.appendChild(pill);

  requestAnimationFrame(() => {
    if (!pill) return;
    pill.style.opacity = '1';
    pill.style.transform = 'translateX(-50%) translateY(0)';
  });

  hideTimer = window.setTimeout(dismiss, LINGER_MS);
}

function dismiss(): void {
  if (!pill) return;
  if (hideTimer !== undefined) { clearTimeout(hideTimer); hideTimer = undefined; }
  const el = pill;
  pill = null;
  el.style.opacity = '0';
  el.style.transform = 'translateX(-50%) translateY(-8px)';
  window.setTimeout(() => el.remove(), FADE_MS + 40);
}
