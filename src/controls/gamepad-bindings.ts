// Gamepad mapping — which button is which verb, as DATA.
//
// Indices are the W3C "standard" gamepad layout (navigator.getGamepads with
// mapping === 'standard'): Xbox / PlayStation / Steam Deck controllers all
// report it. Default is the Souls convention, because that is what a player of
// this genre already has in their hands:
//
//   RT attack (hold to charge)   B dodge          A interact / confirm
//   X quick use (flask)          Y weapon swap    LB rite
//   Start menu                   View inventory   D-pad consumable slots 1-4
//
// In a menu, A confirms and B goes back (the screen manager's own verbs).
// Parry has no button yet: its design is parked (docs/OPEN-ITEMS.md).

export type GamepadAction =
  | 'attack' | 'dodge' | 'interact' | 'quickUse' | 'swapWeapon' | 'rite'
  | 'menu' | 'inventory' | 'slot1' | 'slot2' | 'slot3' | 'slot4';

/** Standard-layout button indices. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, START: 9, LS: 10, RS: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
} as const;

export const DEFAULT_PAD_BINDINGS: Record<GamepadAction, number> = {
  attack: PAD.RT,
  dodge: PAD.B,
  interact: PAD.A,
  quickUse: PAD.X,
  swapWeapon: PAD.Y,
  rite: PAD.LB,
  menu: PAD.START,
  inventory: PAD.VIEW,
  slot1: PAD.DPAD_UP,
  slot2: PAD.DPAD_RIGHT,
  slot3: PAD.DPAD_DOWN,
  slot4: PAD.DPAD_LEFT,
};

/** Standard-layout axes: left stick (0,1), right stick (2,3). */
export const AXIS = { LX: 0, LY: 1, RX: 2, RY: 3 } as const;
