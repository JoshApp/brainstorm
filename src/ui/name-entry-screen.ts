// Name entry — "name yourself" before the first descent.
//
// The first time a player commits to a descent, the dark asks for a
// name. It's stored in meta-state (getPlayerName) and, from Phase 4 on,
// rides along with leaderboard + trace submissions keyed to the
// player's identity. See docs/ALPHA-AND-BACKEND.md. Returning delvers
// (a name is already set) never see this — onDescend skips straight past.
//
// Tone: this is the watching voice addressing you directly — ominous,
// terse, no jokes. It wants something to write on your bones.

import { openScreen, closeScreen } from './screen-manager';
import {
  THEME, FONT_DISPLAY, FONT_UI,
  applyCarvedFrame, carvedRule, displayHeading, injectThemeKeyframes,
} from './theme';

const SCREEN_ID = 'name-entry';
const MAX_LEN = 18;

let root: HTMLDivElement | null = null;

/** Show the name-entry screen. `onConfirm` fires with the trimmed name
 *  once the player commits; the screen tears itself down first. */
export function showNameEntry(onConfirm: (name: string) => void): void {
  if (root) return;
  injectThemeKeyframes();

  root = document.createElement('div');
  root.id = 'name-entry-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: THEME.void,
    zIndex: '9000',
    opacity: '0',
    transition: 'opacity 0.4s ease',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  // The carved slab.
  const slab = document.createElement('div');
  Object.assign(slab.style, {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    width: 'min(440px, 86vw)',
    padding: '34px 30px 30px',
    background: THEME.panel,
    border: `1px solid ${THEME.rule}`,
    boxShadow: THEME.shadow,
  } as Partial<CSSStyleDeclaration>);
  applyCarvedFrame(slab);

  slab.appendChild(displayHeading('NAME YOURSELF', { size: 17, glow: true }));

  const sub = document.createElement('div');
  sub.textContent = 'Something must mark the bones. Choose what the dark remembers you by.';
  Object.assign(sub.style, {
    fontFamily: FONT_DISPLAY,
    fontStyle: 'italic',
    fontSize: '13px',
    lineHeight: '1.55',
    color: THEME.dim,
    textAlign: 'center',
    maxWidth: '320px',
  } as Partial<CSSStyleDeclaration>);
  slab.appendChild(sub);

  slab.appendChild(carvedRule({ glyph: true, margin: '2px 0' }));

  // The input well — serif, centred, lit amber on focus.
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = MAX_LEN;
  input.placeholder = 'enter a name';
  input.autocomplete = 'off';
  input.autocapitalize = 'words';
  input.spellcheck = false;
  input.inputMode = 'text';
  input.enterKeyHint = 'go';
  Object.assign(input.style, {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    minHeight: '48px',
    textAlign: 'center',
    background: THEME.sunken,
    border: `1px solid ${THEME.ruleStrong}`,
    borderRadius: '4px',
    color: THEME.text,
    fontFamily: FONT_DISPLAY,
    fontSize: '20px',
    letterSpacing: '0.12em',
    outline: 'none',
    caretColor: THEME.amber,
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  input.addEventListener('focus', () => { input.style.borderColor = THEME.amber; });
  input.addEventListener('blur', () => { input.style.borderColor = THEME.ruleStrong; });
  slab.appendChild(input);

  // Confirm — the carved ember pill, mirroring the title's DESCEND so the
  // beat reads as the same commitment. Inert until a name is typed.
  const confirm = document.createElement('button');
  confirm.textContent = 'DESCEND';
  Object.assign(confirm.style, {
    marginTop: '4px',
    padding: '13px 40px',
    minWidth: '200px',
    minHeight: '48px',
    borderRadius: '36px',
    border: '1px solid rgba(255, 190, 120, 0.65)',
    background: 'linear-gradient(180deg, rgba(86, 46, 24, 0.9), rgba(52, 26, 11, 0.9))',
    color: 'rgba(255, 232, 202, 0.98)',
    fontFamily: FONT_UI,
    fontSize: '16px',
    fontWeight: '700',
    letterSpacing: '0.24em',
    cursor: 'default',
    boxShadow: '0 0 26px rgba(255, 150, 60, 0.30), 0 2px 10px rgba(0,0,0,0.6)',
    transition: 'transform 0.08s ease, opacity 0.15s ease',
    opacity: '0.4',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  slab.appendChild(confirm);

  const valid = () => input.value.trim().length > 0;
  const refresh = () => {
    const ok = valid();
    confirm.style.opacity = ok ? '1' : '0.4';
    confirm.style.cursor = ok ? 'pointer' : 'default';
  };
  input.addEventListener('input', refresh);

  const submit = () => {
    const name = input.value.trim();
    if (!name) return;
    dismiss();
    onConfirm(name);
  };
  confirm.addEventListener('pointerdown', () => { if (valid()) confirm.style.transform = 'scale(0.96)'; });
  confirm.addEventListener('pointerup', () => { confirm.style.transform = 'scale(1)'; });
  confirm.addEventListener('pointerleave', () => { confirm.style.transform = 'scale(1)'; });
  confirm.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  root.appendChild(slab);
  document.body.appendChild(root);

  openScreen({
    id: SCREEN_ID,
    onForceClose: () => dismiss(),
    root,
    policy: {
      pausesWorld: true,
      hidesHud: true,
      dimsScene: true,
      needsBackdrop: false,   // owns its own full-screen scrim
      layer: 'title',
      needsCursor: true,
    },
  });

  // Fade in + try to summon the mobile keyboard within the tap gesture.
  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
    input.focus();
  });
}

function dismiss() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 400);
  closeScreen(SCREEN_ID);
}
