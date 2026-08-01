import { getSettings, updateSettings } from '../settings/settings';
import { isDesktopLike } from '../controls/platform';

// ── THE WICK RITUAL — diegetic brightness calibration ────────────────
//
// The gold-standard "adjust until the symbol is barely visible"
// calibration screen, wearing the dungeon's skin. Three runes surface
// out of black; the player turns the wick until the second is barely
// there and the third stays drowned. The value re-targets the DARK
// (settings.wick → post-chain floor lift + ambient fill scaling), not
// a gamma wash — pools and signals keep their authored levels.
//
// Reachable wherever a bonfire burns (TEND), and first met in the
// tutorial. Mobile reality: the same phone plays in a midnight bed
// and a sunny train — recalibration is a two-tap ritual, not a
// settings dive.

// Per-rune base luminance, chosen against the LUX bands: rune one sits
// in the lit band (always readable), rune two at the dim floor (the
// "barely there" target), rune three below the dark band (must drown).
const RUNE_BASE = [0.13, 0.045, 0.012];
const RUNES = ['ᚠ', 'ᚷ', 'ᛉ'];

let root: HTMLDivElement | null = null;

/** Mirror of the shader's darkness-weighted lift, for the DOM preview. */
function previewLuma(base: number, wick: number): number {
  const dark = 1 - base;
  const w = wick - 1;
  let l = base + Math.max(w, 0) * 0.033 * dark;
  l *= 1 + w * 0.45 * dark;
  return Math.max(0, Math.min(1, l));
}

function lumaToHex(l: number): string {
  // The band lumas are ALREADY display-referred (they come from the
  // LUX bands, which measure the rendered frame) — encoding them
  // through sRGB again floored the third rune at rgb(34): visible on
  // any screen, so it could never drown. Straight to 8-bit.
  const v = Math.round(Math.max(0, Math.min(1, l)) * 255);
  return `rgb(${v},${v},${v})`;
}

export function openWickRitual(onClose?: () => void): void {
  if (root) return;
  root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '10000',
    background: '#000',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: '4vh',
    fontFamily: 'Georgia, serif',
    touchAction: 'none',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'T E N D   T H E   L A M P';
  Object.assign(title.style, {
    color: 'rgba(214, 188, 150, 0.85)', fontSize: '16px', letterSpacing: '0.3em',
  } as Partial<CSSStyleDeclaration>);

  const copy = document.createElement('div');
  copy.textContent = 'turn the wick. the second rune should barely surface. the third should stay drowned.';
  Object.assign(copy.style, {
    color: 'rgba(160, 140, 115, 0.7)', fontSize: '13px', fontStyle: 'italic',
    maxWidth: '70vw', textAlign: 'center', lineHeight: '1.6',
  } as Partial<CSSStyleDeclaration>);

  const runeRow = document.createElement('div');
  Object.assign(runeRow.style, {
    display: 'flex', gap: '12vw', fontSize: '64px', lineHeight: '1',
    userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  const runeEls = RUNES.map((r) => {
    const el = document.createElement('div');
    el.textContent = r;
    runeRow.appendChild(el);
    return el;
  });

  const paint = (wick: number) => {
    runeEls.forEach((el, i) => { el.style.color = lumaToHex(previewLuma(RUNE_BASE[i], wick)); });
  };

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0.7'; slider.max = '1.4'; slider.step = '0.01';
  slider.value = String(getSettings().wick);
  Object.assign(slider.style, {
    width: 'min(70vw, 420px)', accentColor: 'rgba(255, 170, 85, 0.9)', cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  slider.addEventListener('input', () => {
    const w = parseFloat(slider.value);
    paint(w);
    // Live: the world behind is mid-ritual black, but applying as the
    // slider moves means closing the sheet shows the result instantly.
    updateSettings({ wick: w });
  });
  paint(parseFloat(slider.value));

  const confirm = document.createElement('button');
  confirm.textContent = 'the eye learns';
  Object.assign(confirm.style, {
    background: 'transparent', color: 'rgba(214, 188, 150, 0.8)',
    border: '1px solid rgba(180, 150, 110, 0.4)', borderRadius: '3px',
    padding: '10px 26px', fontFamily: 'Georgia, serif', fontStyle: 'italic',
    fontSize: '14px', cursor: 'pointer', marginTop: '1vh',
  } as Partial<CSSStyleDeclaration>);
  confirm.addEventListener('click', () => closeWickRitual(onClose));

  root.append(title, runeRow, copy, slider, confirm);
  document.body.appendChild(root);
  // Desktop: the game holds pointer lock for mouselook — release it so
  // the cursor can reach the slider (same contract as the menus).
  document.exitPointerLock?.();
}

export function closeWickRitual(onClose?: () => void): void {
  if (!root) return;
  root.remove();
  root = null;
  // Desktop: hand focus straight back to the game. The confirm click is a user
  // gesture, so the relock is permitted. DESKTOP ONLY — on mobile the request
  // fires the browser's "to show your cursor…" banner over the game.
  if (isDesktopLike()) document.querySelector('canvas')?.requestPointerLock?.();
  onClose?.();
}

export function isWickRitualOpen(): boolean {
  return root !== null;
}
