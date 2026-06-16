// Is the user currently typing into an editable field?
//
// Global keyboard handlers (game controls, debug keys) consult this and
// bail when it's true, so they don't steal keystrokes from a focused
// <input>/<textarea>/contenteditable — e.g. the name-entry screen, where
// pressing 'E' must type an 'e', not fire the interact verb.
export function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}
