// Arena registry — the shared handshake between an arena GATE (door.ts) and
// its WAVE CONTROLLER (arena-waves.ts), kept in a tiny module so neither has
// to import the other.
//
// Flow:
//   - builder registers each arena room with its controller's start fn.
//   - the gate, on SLAM (player committed), calls startArena(roomId).
//   - the controller runs its waves; when the last wave is cleared it calls
//     markArenaComplete(roomId).
//   - the gate's unlock check is gated on isArenaComplete — so it stays down
//     through the inter-wave lulls (when the room is momentarily empty) and
//     only winches up once the whole gauntlet is done. This is the fix for
//     "gate slams then immediately reopens": an arena room is never considered
//     clear just because no mob is currently alive.

interface ArenaEntry {
  started: boolean;
  complete: boolean;
  start: () => void;
}

const arenas = new Map<string, ArenaEntry>();

/** Register a room as an arena. `start` kicks off the wave controller. */
export function registerArena(roomId: string, start: () => void): void {
  arenas.set(roomId, { started: false, complete: false, start });
}

export function isArenaRoom(roomId: string): boolean {
  return arenas.has(roomId);
}

/** A non-arena room reports "complete" (true) so the gate falls back to its
 *  normal room-empty check; an arena room reports its real gauntlet state. */
export function isArenaComplete(roomId: string): boolean {
  return arenas.get(roomId)?.complete ?? true;
}

/** Fire the controller once (idempotent). Called by the gate on slam. */
export function startArena(roomId: string): void {
  const a = arenas.get(roomId);
  if (a && !a.started) {
    a.started = true;
    a.start();
  }
}

export function markArenaComplete(roomId: string): void {
  const a = arenas.get(roomId);
  if (a) a.complete = true;
}

/** Wipe on level teardown so a new floor's rooms start fresh. */
export function clearArenas(): void {
  arenas.clear();
}
