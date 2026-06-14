import * as THREE from 'three';
import { on } from '../broadcast/event-bus';
import { kickShake, kickJolt } from '../combat/screen-shake';
import { playGateSlam, playGateRaise } from '../audio/sfx';
import { spawnDustPuff } from '../effects/dust-puff';

// Encounter feedback — the ONE place that turns encounter-lifecycle EVENTS
// into multi-sensory stingers (sound + screen shake + dust + haptic). The
// in-world systems (door.ts, and later the arena light arc) just EMIT what
// happened; they know nothing about shake amplitudes or dust counts. This
// subscriber owns the choreography, so the feel of a threshold sealing lives
// in one legible file and the same event stream can also feed the broadcast
// snark / voice in the deep.
//
// The power of a stinger is SYNCHRONY — every channel fires on the same frame
// off one event. Keeping them together here is what guarantees that.

let sceneRef: THREE.Object3D | null = null;
let subscribed = false;

/** Pocket vibration, guarded. No-op on desktop / unsupported browsers. */
function haptic(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

/** Wire the feedback subscriber once at boot. `scene` is the persistent root
 *  the dust sprites attach to (cleared per level alongside the other effect
 *  pools). Idempotent — safe to call more than once. */
export function initEncounterFeedback(scene: THREE.Object3D) {
  sceneRef = scene;
  if (subscribed) return;
  subscribed = true;

  on((e) => {
    switch (e.type) {
      // GATE SLAM — the heavy beat. A downward jolt (the floor heaves under
      // the grate's mass) + a low rattle for grit + a wide dust skirt at the
      // base + a strong haptic. The slam OWNS the moment: you're sealed in.
      case 'gate:slam': {
        playGateSlam({ x: e.x, y: e.y, z: e.z });
        kickJolt(0, -1, 0, 0.14, 0.42, 7);   // punch down, ring out ~3 bounces
        kickShake(0.05, 0.45);                // low rattle riding under the jolt
        haptic(60);
        if (sceneRef) {
          spawnDustPuff(sceneRef, e.x, e.y + 0.08, e.z, {
            count: 12, spread: 1.1, size: 0.5, rise: 1.1, life: 0.8,
          });
        }
        break;
      }

      // GATE RAISE — the gentle inverse. The winch grind, a faint haptic, and
      // deliberately NO shake: this beat returns agency, it doesn't steal it.
      case 'gate:raise': {
        playGateRaise({ x: e.x, y: e.y, z: e.z });
        haptic(25);
        break;
      }

      // GATE SETTLE — the grate reaches the top. A soft tick of feedback: a
      // small settle shake + a thin dust wisp, no sound (the raise grind has
      // already tapered out, and that IS the audio resolution).
      case 'gate:settle': {
        kickShake(0.02, 0.16);
        haptic(15);
        if (sceneRef) {
          spawnDustPuff(sceneRef, e.x, e.y + 1.6, e.z, {
            count: 4, spread: 0.5, size: 0.3, rise: 0.5, life: 0.6,
          });
        }
        break;
      }
    }
  });
}
