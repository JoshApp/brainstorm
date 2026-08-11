// ── THE ARRIVAL THRESHOLD — you have arrived, but you have not started ───────
//
// The wake ceremony ends on a timer, and for that second or two the player is
// untouchable. Then it hands over to a room they have never seen, on a phone,
// with their thumbs not yet on the sticks. Anything that hits them there hit
// someone who wasn't playing yet, and a pack that aggros there is already
// mid-charge by the time they can answer. That's not indifference, it's a cheap
// shot, and the first thing it teaches a new floor is that arriving is
// dangerous in a way you cannot act on.
//
// So the safety doesn't end with the ceremony. It ends when the player DOES
// something — a step, a look, a swing, a use. Not on a clock: someone who needs
// six seconds to get their bearings on a bus gets six seconds. Nothing notices
// them and nothing can hurt them until they move first.
//
// ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
//
// It used to be four module-level lets inside arrival.ts, which is the EYELID
// CEREMONY — DOM, blur, lid geometry. Two different things: one is a rule about
// when the dungeon is allowed to notice you, the other is a transition effect.
// Nothing could test the rule without a document, so nothing did, and it had a
// bug that reads as "enemies ignore me" — see below.

/** Backstop only. If nothing ends the threshold by now, an end-call went
 *  missing somewhere and we would rather the player be mortal than immortal for
 *  a whole floor. Long enough never to fire during honest orientation. */
const THRESHOLD_CEILING_S = 45;

let threshold = false;
let thresholdAge = 0;

// ── THE BUG THIS FLAG EXISTS TO PREVENT ─────────────────────────────────────
//
// The ceremony USED to arm the threshold unconditionally when its clock ran
// out. But the player can act DURING the wake — movement is held, yet the stick
// is readable, and the input system calls end() the moment it reads one. That
// end landed on a threshold that had not been armed yet, so it did nothing, and
// then the ceremony armed it anyway. The player's action was discarded.
//
// What that looks like in play: you walk in, stop to look at the room, and
// nothing in it reacts to you — for up to 45 seconds, until you happen to move
// again. Which is exactly the report behind #173 ("enemies in one room track me
// but never charge, other rooms are fine"): the FIRST room you stop in is the
// one that ignores you, and moving on clears it for the rest of the floor.
//
// So an action is remembered. Arriving somewhere new is the only thing that
// forgets it.
let acted = false;

/** A new floor: the threshold is pending again and nothing has been done on it
 *  yet. Called when the wake ceremony begins (or is skipped). */
export function resetThreshold(): void {
  threshold = false;
  thresholdAge = 0;
  acted = false;
}

/** The wake ceremony finished. Hand over to the threshold — UNLESS the player
 *  already acted during the wake, in which case they have started and the
 *  dungeon is allowed to notice them. */
export function armThreshold(): void {
  threshold = !acted;
  thresholdAge = 0;
}

/** The player acted. Ends the threshold and keeps it ended; idempotent and
 *  cheap, so input handlers can call it unconditionally. */
export function endThreshold(): void {
  threshold = false;
  acted = true;
}

/** Age the backstop. Driven from the same tick as the ceremony. */
export function tickThreshold(dt: number): void {
  if (!threshold) return;
  thresholdAge += dt;
  if (thresholdAge >= THRESHOLD_CEILING_S) threshold = false;
}

/** Is the player still standing in the doorway, arrived but not yet started? */
export function inThreshold(): boolean {
  return threshold;
}
