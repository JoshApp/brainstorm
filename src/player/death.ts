import * as THREE from 'three';
import { CONFIG } from '../config';
import { setPersistentVignette } from '../ui/vignette';
import { showDeathOverlay } from '../ui/death-overlay';
import { showEndScreen } from '../ui/end-screen';
import { getRunState, elapsedString, clearSave } from '../state/run-state';
import { recordRunDeath, getRunDiscoveries } from '../state/meta-state';

// Death sequence — Dark-Souls-esque collapse + world freeze.
//
//   Phase 1 (0.0s → 1.2s)  CAMERA FALL
//     The camera pitches forward over ~1.2s (the player's body
//     buckling face-first toward the floor) and drops in height
//     by ~0.7m (collapsing onto their knees, then the ground).
//     Time-scale eases from 1.0 → 0.25 over the first 0.5s so the
//     world reads "slowed but not stopped" while the camera
//     dramatically tips.
//
//   Phase 2 (1.2s → 1.8s)  WORLD STILLS
//     Time-scale eases from 0.25 → 0 — the moment the camera
//     finishes its fall, the world freezes. Enemies in mid-swing
//     pause. The red vignette darkens. The epitaph fades in.
//
//   Phase 3 (1.8s → DEATH_SEQUENCE_DURATION)  HOLD
//     Black hold on the frozen frame with the epitaph readable.
//     End screen + RISE AGAIN action appears at the end.
//
// Owns a camera reference (registered via initDeath) so the
// per-frame tick can mutate camera pitch + position directly.

let dying = false;
let elapsed = 0;
let camera: THREE.PerspectiveCamera | null = null;
let startPitch = 0;
let startHeight = 0;

const FALL_DURATION = 1.2;       // seconds to finish the camera collapse
const STILL_AT      = 1.8;       // seconds before time-scale hits zero
const FALL_PITCH    = -1.25;     // radians — face-down (-π/2.5)
const FALL_DROP     = 0.7;       // metres dropped during the collapse

// Epitaph fallback list (mirrored from death-overlay.ts so the
// end screen can show one even if the overlay was skipped).
const EPITAPH_FALLBACKS = [
  'forgotten on depth 1.',
  'she was unmade in the first dark.',
  'the dungeon does not remember your name.',
  'a brief descent.',
  'unremarkable, even to the worms.',
];

export function isDying(): boolean {
  return dying;
}

/** Register the player's camera so the death tick can drive it.
 *  Called once at startup from main.ts. */
export function initDeath(playerCamera: THREE.PerspectiveCamera): void {
  camera = playerCamera;
}

/** Time-scale multiplier the main tick applies to its dt. Eases
 *  from 1 → 0.25 over the first 0.5s of dying, then from 0.25
 *  → 0 between FALL_DURATION and STILL_AT. */
export function getTimeScale(): number {
  if (!dying) return 1;
  if (elapsed < 0.5) {
    // First 0.5s — ease into slow-mo.
    const t = elapsed / 0.5;
    return 1 - (1 - CONFIG.DEATH_SLOWMO_SCALE) * t;
  }
  if (elapsed < FALL_DURATION) {
    return CONFIG.DEATH_SLOWMO_SCALE;
  }
  if (elapsed < STILL_AT) {
    // Ease down to a full freeze as the camera finishes its
    // collapse.
    const t = (elapsed - FALL_DURATION) / (STILL_AT - FALL_DURATION);
    return CONFIG.DEATH_SLOWMO_SCALE * (1 - t);
  }
  return 0;   // world frozen
}

export function triggerDeath() {
  if (dying) return;
  dying = true;
  elapsed = 0;
  if (camera) {
    startPitch = camera.rotation.x;
    startHeight = camera.position.y;
  }
  setPersistentVignette(1, CONFIG.DEATH_VIGNETTE_DARKEN_MS);
  const epitaph = showDeathOverlay();
  // Snapshot the run BEFORE clearing save so the recap shows real numbers.
  const run = getRunState();
  const depth = run?.depth ?? 1;
  const kills = run?.kills ?? 0;
  const itemsFound = run?.itemsFound.length ?? 0;
  const time = elapsedString();
  const elapsedMs = run ? Date.now() - run.startedAt : 0;
  const discoveries = getRunDiscoveries();
  // Lifetime stat bump: total play time + death count. Kept SEPARATE from
  // run-state.clearSave() so meta survives.
  recordRunDeath(elapsedMs);
  clearSave();
  // After the death sequence (camera collapse + world freeze + epitaph),
  // show the end screen + RISE AGAIN action.
  setTimeout(() => {
    showEndScreen(
      {
        depth,
        kills,
        itemsFound,
        elapsed: time,
        epitaph: epitaph ?? EPITAPH_FALLBACKS[0],
        discoveries: {
          enemies: discoveries.enemies,
          items: discoveries.items,
          notes: discoveries.notes.length,
          newDepthRecord: discoveries.newDepthRecord,
        },
      },
      () => window.location.reload(),
    );
  }, CONFIG.DEATH_SEQUENCE_DURATION * 1000);
}

/** Advance the death timer. Always uses REAL dt (not scaled) so
 *  the sequence itself doesn't slow down with the world. */
export function tickDeath(realDt: number) {
  if (!dying) return;
  elapsed += realDt;

  if (camera) {
    // Camera collapse — pitch forward + drop in height. Both
    // ease-out so the fall starts fast and settles softly into
    // the floor. After FALL_DURATION, we hold at the final
    // collapsed pose for the rest of the sequence.
    const t = Math.min(1, elapsed / FALL_DURATION);
    const eased = 1 - Math.pow(1 - t, 2);   // easeOutQuad
    camera.rotation.x = startPitch + (FALL_PITCH - startPitch) * eased;
    camera.position.y = startHeight + (-FALL_DROP) * eased;
    // Subtle roll as the body twists. Small magnitude so it
    // reads as "the head fell sideways" without nausea.
    const rollT = Math.min(1, elapsed / (FALL_DURATION * 1.4));
    const rollEased = 1 - Math.pow(1 - rollT, 2);
    camera.rotation.z = -0.18 * rollEased;
    // Once the camera has stopped (world frozen), apply a very
    // slight low-frequency drift to suggest the player's last
    // breath — barely perceptible.
    if (elapsed > STILL_AT) {
      const breath = Math.sin((elapsed - STILL_AT) * 1.2) * 0.004;
      camera.position.y = startHeight - FALL_DROP + breath;
    }
  }
}
