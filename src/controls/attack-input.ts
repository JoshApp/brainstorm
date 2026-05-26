// Shared "attack pressed" flag. Multiple input sources can set it
// (right-side touch tap, on-screen button if shown, keyboard space).
// Game loop reads it once per frame via consumeAttackPressed().
//
// Attack input is INHIBITED while any menu is open — taps that would
// otherwise hit the right-side attack zone get dropped here so the
// player doesn't accidentally swing while reading their inventory.

import { isAnyMenuOpen } from './input-mode';

let pressed = false;

/** Called by any input source when the player asks to attack. */
export function triggerAttack() {
  if (isAnyMenuOpen()) return;   // menus pause gameplay input
  pressed = true;
}

/** Game-loop side: returns true at most once per press. */
export function consumeAttackPressed(): boolean {
  if (!pressed) return false;
  pressed = false;
  return true;
}
