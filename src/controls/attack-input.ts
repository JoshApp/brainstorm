// Shared "attack pressed" flag. Multiple input sources can set it
// (right-side touch tap, on-screen button if shown, keyboard space).
// Game loop reads it once per frame via consumeAttackPressed().

let pressed = false;

/** Called by any input source when the player asks to attack. */
export function triggerAttack() {
  pressed = true;
}

/** Game-loop side: returns true at most once per press. */
export function consumeAttackPressed(): boolean {
  if (!pressed) return false;
  pressed = false;
  return true;
}
