// ── FATE GATE — the harbor's big fire must deal your fate before you descend ──
//
// A floor's "big fire" (the harbor / safe-room bonfire) seals the stairs until
// you've drawn from it. Small fires (vault bonfires) don't gate — they're optional
// fates. One module-level flag per floor; the builder arms it when it places a big
// undrawn fire and clears it when that fire is drawn (or at the next floor build).
// The stairs' unlock predicate ANDs with isFateGateClear().

let gated = false;

/** Arm the gate — descent is sealed until the big fire deals a fate. */
export function armFateGate(): void { gated = true; }

/** Clear the gate — the fate was dealt (or no big fire on this floor). */
export function clearFateGate(): void { gated = false; }

/** Stairs are free to descend (w.r.t. fate) when this is true. */
export function isFateGateClear(): boolean { return !gated; }
