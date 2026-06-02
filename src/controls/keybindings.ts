// Rebindable desktop key bindings.
//
// Maps abstract ACTIONS (move, attack, interact, …) to physical keys,
// addressed by KeyboardEvent.code ('KeyW', 'Space', 'Escape', …) rather
// than .key, so a binding is layout-independent — 'KeyW' is the same
// physical key on QWERTY and AZERTY, and doesn't shift when the player
// holds Shift. input-desktop resolves every keydown through here.
//
// Touch has no rebinding (the on-screen controls aren't keys); this is
// desktop-only. Numbered consumable slots (1-9) and the Tab inventory
// alias stay hardwired in input-desktop — they're positional, not
// rebindable verbs.

export type BindableAction =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'attack'
  | 'interact'
  | 'inventory'
  | 'quickUse'
  | 'character'
  | 'menu';

/** Display order for the settings UI — verbs grouped move / fight / ui. */
export const BINDABLE_ACTIONS: { id: BindableAction; label: string }[] = [
  { id: 'moveForward', label: 'MOVE FORWARD' },
  { id: 'moveBack',    label: 'MOVE BACK' },
  { id: 'moveLeft',    label: 'STRAFE LEFT' },
  { id: 'moveRight',   label: 'STRAFE RIGHT' },
  { id: 'attack',      label: 'ATTACK / CHARGE' },
  { id: 'interact',    label: 'INTERACT' },
  { id: 'inventory',   label: 'INVENTORY' },
  { id: 'quickUse',    label: 'QUICK USE' },
  { id: 'character',   label: 'CHARACTER' },
  { id: 'menu',        label: 'MENU / BACK' },
];

const DEFAULTS: Record<BindableAction, string> = {
  moveForward: 'KeyW',
  moveBack:    'KeyS',
  moveLeft:    'KeyA',
  moveRight:   'KeyD',
  attack:      'Space',
  interact:    'KeyE',
  inventory:   'KeyI',
  quickUse:    'KeyQ',
  character:   'KeyC',
  menu:        'Escape',
};

const STORAGE_KEY = 'delve-keybindings';

let bindings: Record<BindableAction, string> = load();
const listeners = new Set<() => void>();

function load(): Record<BindableAction, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<BindableAction, string>>;
    // Merge over defaults so a save from an older build (missing a
    // newer action) still resolves every verb.
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn();
}

/** The physical key code currently bound to an action. */
export function getBinding(action: BindableAction): string {
  return bindings[action];
}

/** Reverse lookup: which action (if any) a pressed key code triggers.
 *  Used by input-desktop to route a keydown without a per-action
 *  if-chain. */
export function actionForCode(code: string): BindableAction | null {
  for (const action of Object.keys(bindings) as BindableAction[]) {
    if (bindings[action] === code) return action;
  }
  return null;
}

/** Bind a code to an action. If the code is already used by another
 *  action, that other action is cleared to its... no — we swap, so no
 *  two verbs ever share a key (the old holder takes this action's old
 *  key). Keeps the set a clean bijection. */
export function setBinding(action: BindableAction, code: string): void {
  const prevCode = bindings[action];
  const clash = actionForCode(code);
  if (clash && clash !== action) {
    // Swap: the conflicting action inherits the key we're vacating.
    bindings[clash] = prevCode;
  }
  bindings[action] = code;
  persist();
}

export function resetBindings(): void {
  bindings = { ...DEFAULTS };
  persist();
}

export function onBindingsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Human-readable label for a key code, for the settings UI. Covers the
// codes a player is likely to bind; falls back to a tidied version of
// the raw code for anything exotic.
const CODE_LABELS: Record<string, string> = {
  Space: 'SPACE',
  Escape: 'ESC',
  Enter: 'ENTER',
  Tab: 'TAB',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT',
  AltRight: 'R-ALT',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function labelForCode(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);       // KeyW → W
  if (code.startsWith('Digit')) return code.slice(5);     // Digit1 → 1
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}
