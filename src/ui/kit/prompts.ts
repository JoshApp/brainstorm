// PROMPTS — the button for an action, drawn in the glyph of the device in
// your hands. One definition per intent; the glyph follows
// controls/active-device.ts, so a Deck shows the pad's A where a laptop shows
// Enter and a phone shows nothing (the tap is the action).
//
// Mark an element `data-key="confirm"` (or another intent) inside a root and
// call bindPrompts(root): it fills the glyph now and refills it whenever the
// active device changes.

import { activeDevice, onActiveDeviceChange, type InputDevice } from '../../controls/active-device';
import { isDesktopLike } from '../../controls/platform';
import { PAD, DEFAULT_PAD_BINDINGS, type GamepadAction } from '../../controls/gamepad-bindings';
import { getBinding, labelForCode, onBindingsChanged, type BindableAction } from '../../controls/keybindings';
import { injectKitStyles } from './style';

export type PromptIntent = 'confirm' | 'back' | 'tabPrev' | 'tabNext' | 'hold';

const GLYPHS: Record<PromptIntent, Partial<Record<InputDevice, string>>> = {
  confirm: { gamepad: '<kbd class="lk-pad lk-a">A</kbd>', 'keyboard-mouse': '<kbd class="lk-key">Enter</kbd>' },
  back: { gamepad: '<kbd class="lk-pad lk-b">B</kbd>', 'keyboard-mouse': '<kbd class="lk-key">Esc</kbd>' },
  tabPrev: { gamepad: '<kbd class="lk-key">LB</kbd>', 'keyboard-mouse': '<kbd class="lk-key">Q</kbd>' },
  tabNext: { gamepad: '<kbd class="lk-key">RB</kbd>', 'keyboard-mouse': '<kbd class="lk-key">E</kbd>' },
  hold: { gamepad: '<kbd class="lk-pad lk-a">hold A</kbd>', 'keyboard-mouse': '<kbd class="lk-key">hold Enter</kbd>' },
};

/** The device prompts are drawn for: the last one used, or a guess before any input. */
export function promptDevice(): InputDevice {
  return activeDevice() ?? (isDesktopLike() ? 'keyboard-mouse' : 'touch');
}

export function glyphHtml(intent: PromptIntent, device: InputDevice = promptDevice()): string {
  return GLYPHS[intent][device] ?? '';
}

/** Fill every [data-key] under root and keep it current. Returns an unbinder. */
export function bindPrompts(root: HTMLElement): () => void {
  const fill = (d: InputDevice): void => {
    root.dataset.device = d;
    for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
      el.innerHTML = glyphHtml(el.dataset.key as PromptIntent, d);
    }
  };
  fill(promptDevice());
  return onActiveDeviceChange(fill);
}

// ── HUD action prompts ───────────────────────────────────────────────────────
// The button for a HUD control, tucked onto its rim the way console games do
// (a small carved keycap at a corner, overlapping the edge, never a label
// floating beside it). Keyboard shows the bound key and follows rebinds; a
// pad shows the bound face/shoulder button; touch shows nothing, because the
// thumb presses the control itself.

const PAD_GLYPH: Record<number, { t: string; cls: string }> = {
  [PAD.A]: { t: 'A', cls: 'lk-pad lk-a' }, [PAD.B]: { t: 'B', cls: 'lk-pad lk-b' },
  [PAD.X]: { t: 'X', cls: 'lk-pad lk-x' }, [PAD.Y]: { t: 'Y', cls: 'lk-pad lk-y' },
  [PAD.LB]: { t: 'LB', cls: 'lk-key' }, [PAD.RB]: { t: 'RB', cls: 'lk-key' },
  [PAD.LT]: { t: 'LT', cls: 'lk-key' }, [PAD.RT]: { t: 'RT', cls: 'lk-key' },
  [PAD.VIEW]: { t: '⧉', cls: 'lk-key' }, [PAD.START]: { t: '≡', cls: 'lk-key' },
  [PAD.DPAD_UP]: { t: '↑', cls: 'lk-key' }, [PAD.DPAD_RIGHT]: { t: '→', cls: 'lk-key' },
  [PAD.DPAD_DOWN]: { t: '↓', cls: 'lk-key' }, [PAD.DPAD_LEFT]: { t: '←', cls: 'lk-key' },
};

export interface HudPromptOpts {
  key?: BindableAction;
  pad?: GamepadAction;
  /** Which corner of the host the cap sits on. Default bottom-right. */
  corner?: 'br' | 'bl' | 'tr' | 'tl';
}

/** Tuck a device-following button glyph onto `host` (which must be a
 *  positioned element). Returns an unbinder. */
export function attachHudPrompt(host: HTMLElement, opts: HudPromptOpts): () => void {
  injectKitStyles();
  const cap = document.createElement('kbd');
  cap.className = 'lk-hudkey';
  cap.dataset.corner = opts.corner ?? 'br';
  host.appendChild(cap);
  const fill = (): void => {
    const d = promptDevice();
    if (d === 'gamepad' && opts.pad) {
      const g = PAD_GLYPH[DEFAULT_PAD_BINDINGS[opts.pad]];
      cap.className = `lk-hudkey ${g?.cls ?? 'lk-key'}`;
      cap.textContent = g?.t ?? '';
      cap.style.display = g ? '' : 'none';
    } else if (d === 'keyboard-mouse' && opts.key) {
      cap.className = 'lk-hudkey lk-key';
      cap.textContent = labelForCode(getBinding(opts.key));
      cap.style.display = '';
    } else {
      cap.style.display = 'none';
    }
  };
  fill();
  const offDevice = onActiveDeviceChange(fill);
  const offBind = onBindingsChanged(fill);
  return () => { offDevice(); offBind(); cap.remove(); };
}
