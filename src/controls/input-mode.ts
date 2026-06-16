// Desktop control mode — the SINGLE source of truth for "who owns the
// keyboard right now," so game verbs and UI text entry can never fight over
// the same keystroke.
//
// It is DERIVED from live state (is a text field focused?), never a stored
// flag, so it cannot drift: a screen physically cannot forget to reset it.
// Focus a text input and the mode is 'text' automatically; blur it and
// we're back to 'game'. That's the property that makes a whole class of
// bugs — "typing fired the interact verb", "spacebar triggered a debug
// download" — structurally hard to reintroduce: there's nothing to keep in
// sync, and one predicate gates every global key handler.
//
//   'text' — a text field (<input>/<textarea>/contenteditable) is focused.
//            The keyboard belongs entirely to it; EVERY global key handler
//            (game verbs AND debug shortcuts) must bail.
//   'game' — the default: pointer-look, WASD, left-click-to-swing.
//
// Menu/cursor state (inventory, settings) is a separate concern owned by
// screen-manager, which already pauses the world. This module is precisely
// the text-vs-game seam that the old scattered focus checks kept getting
// wrong.

export type ControlMode = 'text' | 'game';

function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** The current control mode, derived fresh each call. */
export function controlMode(): ControlMode {
  return isEditableTarget() ? 'text' : 'game';
}

/** True while a text field owns the keyboard. Every global key listener —
 *  game controls AND debug shortcuts — gates on this so none can steal a
 *  keystroke meant for the field. This is THE guard for the bug class. */
export function isTextEntryMode(): boolean {
  return controlMode() === 'text';
}

/** True when raw game controls (look / move / swing / verbs) should act —
 *  the inverse of text mode. */
export function isGameControlMode(): boolean {
  return controlMode() === 'game';
}
