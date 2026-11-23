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
