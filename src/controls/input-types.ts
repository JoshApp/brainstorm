// Shared input contract — what every input scheme writes into and the
// callbacks it can fire. createTouchInput in input.ts orchestrates one
// or more schemes (touch, desktop keyboard+mouse, future gamepad) all
// feeding the same InputState.

export interface InputState {
  /** Movement axis values in [-1..1]. Deadzone already applied. */
  moveX: number;
  moveY: number;
  /** Look delta accumulated since last frame; consumer resets to 0. */
  lookDx: number;
  lookDy: number;
  /** Per-frame hook. Schemes register tick callbacks here for
   *  continuous behavior (e.g. hybrid-look injects rotation while a
   *  touch is held past the aim zone). */
  tickInput: (dt: number) => void;
}

/** Pluggable input scheme contract.
 *
 * A scheme attaches event listeners to the canvas (and window where
 * appropriate), writes into the shared InputState, and fires the
 * options callbacks for game-logic actions (tap-target, attack,
 * interact). The orchestrator can run multiple schemes simultaneously
 * — touch handlers only fire on touch devices, keyboard handlers only
 * on desktop, so they don't fight on hybrid hardware. */
export interface InputScheme {
  /** One-time setup. Return value is appended to the orchestrator's
   *  per-frame tick list (for hybrid-look continuous rotation, key-
   *  polling, etc.). Return null if no per-frame work is needed. */
  attach(ctx: SchemeContext): InputTick | null;
}

export interface SchemeContext {
  canvas: HTMLCanvasElement;
  state: InputState;
  options: InputOptions;
}

export interface InputOptions {
  /** Called for every tap-style input (short touch contact, mouse
   *  click, or possibly a gamepad confirm in the future). This is the
   *  SINGLE tap arbiter: it fully resolves the tap (interact / attack /
   *  nothing) and acts. `canAttack` tells it whether this tap is in a
   *  region where a swing is allowed — true for a desktop click and a
   *  touch on the right (combat) half; false for the touch joystick
   *  half (a direct tap on an object is still honoured, but the
   *  attack/interact FALLBACK is suppressed). The scheme does NOT add
   *  its own attack fallback — all of that logic lives behind this. */
  onTap?: (clientX: number, clientY: number, canAttack: boolean) => void;
  /** Fire when the player asks to interact (E key, gamepad A, etc.)
   *  without a screen coordinate. Schemes call this when "use the
   *  currently in-range interactable" is the intent. */
  onInteract?: () => void;
}

export type InputTick = (dt: number) => void;
