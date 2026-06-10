// Cinematic boss beats — the world REACTING to a boss, no cutscenes, control
// never leaves the player (Dark Souls / mobile-safe: look is aim, so we never
// take the camera). Two moments, both off the boss lifecycle:
//
//   ENGAGE (boss:engaged — crossing the fog gate / aggro):
//     - the boss music bed blooms in the instant you commit
//     - the boss's ROOM floods with its signature colour. Combined with the
//       "Painted" materials, your own bone hands + every bone in the room
//       drink that hue — the space becomes the boss's domain.
//     (The boss's physical ENTRANCE — e.g. the king's ceiling-drop — lives in
//      enemy.ts, driven by the spec's `entrance`, timed to the engage grace.)
//
//   DEATH (boss:defeated):
//     - a brief slow-mo on the killing blow + a heavy quake
//     - the room's colour DRAINS back to neutral (its hold breaks)
//     (The descent ward shatters on this same hook; music eases out as combat
//      heat drops on room:cleared.)

import { on } from '../broadcast/event-bus';
import { setRoomMood } from '../level/room-mood';
import { setMusicState } from '../audio/music';
import { kickShake } from '../combat/screen-shake';
import { triggerBossSlowmo } from '../combat/boss-slowmo';

interface BossPresentation {
  /** Room the boss owns — flooded with `color` on engage, drained on death. */
  roomId: string | null;
  /** The boss's signature colour (its eye/emissive glow), from the builder. */
  color: number;
}

let presentation: BossPresentation | null = null;

/** Set (or clear) the current floor's boss presentation. The builder calls
 *  this per floor: a boss floor passes its room + colour; other floors pass
 *  null so a stale presentation can't bleed across floors. */
export function setBossPresentation(p: BossPresentation | null): void {
  presentation = p;
}

let wired = false;

/** Subscribe the cinematic beats to the boss lifecycle. Call once at boot. */
export function setupBossCinematics(): void {
  if (wired) return;
  wired = true;
  on((e) => {
    if (e.type === 'boss:engaged') {
      setMusicState('boss');   // the bed blooms the instant you commit
      if (presentation?.roomId != null) {
        setRoomMood(presentation.roomId, presentation.color, 0.8);
      }
    } else if (e.type === 'boss:defeated') {
      triggerBossSlowmo();
      kickShake(0.5, 0.5);
      // The boss's hold on the room breaks — its colour drains back to neutral.
      if (presentation?.roomId != null) {
        setRoomMood(presentation.roomId, null, 2.2);
      }
    }
  });
}
