// Shared player movement INTENT — the current movement-direction bucket, set by
// the combat tick each frame (from the move stick, deadzoned via
// pickAttackDirection) and read by the viewmodel to PRIME the held weapon: while
// you move, the weapon leans toward the directional attack you'd get, so the
// loaded move is telegraphed (docs/MOVE-TIMELINE.md). Module-level so the view
// (weapon system) can read what combat computed the same frame — combat runs
// before the weapon in the frame order.

import type { MoveDir } from '../combat/move-timeline';

let intent: MoveDir = null;

export function setMoveIntent(d: MoveDir): void { intent = d; }
export function getMoveIntent(): MoveDir { return intent; }
