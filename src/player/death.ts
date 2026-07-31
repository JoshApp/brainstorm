import * as THREE from 'three';
import { CONFIG } from '../config';
import { track } from '../telemetry/telemetry';
import { setPersistentVignette } from '../ui/vignette';
import { showDeathOverlay } from '../ui/death-overlay';
import { showEndScreen } from '../ui/end-screen';
import { getRunState, elapsedString, clearSave } from '../state/run-state';
import { recordRunDeath, getRunDiscoveries } from '../state/meta-state';
import { reportDeath } from '../net/delve-net';
import { recordDeath } from '../ai/player-profile';
import { speakDeath } from '../broadcast/voice';
import { captureRunTape } from '../net/run-sync';
import { DEV } from '../debug/dev';
import { dumpInteractTrace } from '../debug/interact-trace';
import { killingBlowLabel, getDamageRecap } from './damage-recap';
import { setGameMode } from '../state/game-mode';
import { tickWeaponDrops } from './weapon-drop';

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
// Fired once at the very start of the death sequence — main.ts wires this
// to fling the held weapon(s) out of the player's hands (weapon-drop.ts).
let onDeathStart: (() => void) | null = null;

/** Register the death-start hook (the hand-lets-go weapon drop). */
export function setOnDeathStart(fn: () => void): void {
  onDeathStart = fn;
}

const FALL_DURATION = 1.4;       // seconds to finish the camera collapse
const STILL_AT      = 2.0;       // seconds before time-scale hits zero
// Camera lies almost ON the floor at the end — eye height ~0.15m off
// the ground (the player is on their side, not face-down). The sword
// viewmodel attached to the camera stays in view as the "last sight"
// of your own hand on the floor before the dark takes over.
const FALL_PITCH    = -1.05;     // radians — head tilted sideways toward floor
const FALL_ROLL     = -0.55;     // radians — body collapses onto its side
const FALL_DROP     = 1.45;      // metres dropped during the collapse

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
  // Lifecycle → dying: input + viewmodel motion stop reading control;
  // the world coasts to a freeze via getTimeScale() below.
  setGameMode('dying');
  if (camera) {
    startPitch = camera.rotation.x;
    startHeight = camera.position.y;
  }
  // Let go of everything — the weapon tumbles from the hand to the floor
  // BEFORE the camera starts its collapse, so you watch your blade fall
  // away as you go down. Captured here (hands still up) so the spawn
  // transform is the held pose, not the collapsed one.
  onDeathStart?.();
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
  // Tell the living dungeon a delver fell here. Best-effort + fire-and-
  // forget — offline or unconnected, it no-ops. The row fans out to other
  // players as the "death elsewhere" feed (and persists as the async
  // bloodstain). Reported before clearSave so the run facts are intact.
  reportDeath({
    depth,
    x: camera?.position.x ?? 0,
    z: camera?.position.z ?? 0,
    runSeed: run?.startedAt ?? 0,
    killedBy: killingBlowLabel(),
  });
  // AI/voice layer (Phase-5 PROTOTYPE) — dev-only until the prod Worker ships,
  // gated here so it strips from the static deploy. Record the death into the
  // behavioral profile BEFORE the voice reads it, so the deep's remark reflects
  // this death too ("still feeding the fire"), then let the voice in the deep
  // remark (funnels to /api/ai — local shim in dev, a Worker in prod later;
  // best-effort, fire-and-forget). See src/ai/ and src/broadcast/voice.ts.
  if (DEV) {
    recordDeath({ depth, kills, killedBy: killingBlowLabel() });
    speakDeath({ depth, kills, killedBy: killingBlowLabel() });
  }
  // Funnel telemetry — where runs end + what kills (the bounce signal). No-op
  // until a telemetry endpoint is configured; no PII (just depth + cause).
  track('death', { depth, kills, killedBy: killingBlowLabel(), itemsFound, elapsedMs });
  // Queue the recorded run tape (deterministic fixed-step runs only) for
  // leaderboard verification — stored offline, uploaded on reconnect. The
  // tape was finalised by finishRun() at the top of the death sequence.
  void captureRunTape({ depth, kills });
  if (DEV) dumpInteractTrace(); // run summary: descents vs triggerInteract vs recorded
  // Lifetime stat bump: total play time + death count. Kept SEPARATE from
  // run-state.clearSave() so meta survives.
  recordRunDeath(elapsedMs);
  clearSave();
  // After the death sequence (camera collapse + world freeze + epitaph),
  // show the end screen + RISE AGAIN action.
  setTimeout(() => {
    setGameMode('dead');
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
        damageRecap: getDamageRecap(),
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

  // Weapon(s) tumbling to the floor — REAL dt so they land promptly
  // (within the first ~0.7s) and then lie still through the rest of the
  // collapse + freeze.
  tickWeaponDrops(realDt);

  if (camera) {
    // Camera collapse — pitch + roll + drop, all eased-out so the
    // fall starts fast and settles softly into the floor. The roll
    // collapses the body onto its SIDE; with the weapon already flung
    // from the hand (onDeathStart), the empty hand sinks to the floor
    // beside the dropped blade — the Dark-Souls-y "see your character
    // fall" beat, now with the loss of the weapon made literal.
    const t = Math.min(1, elapsed / FALL_DURATION);
    const eased = 1 - Math.pow(1 - t, 2);   // easeOutQuad
    camera.rotation.x = startPitch + (FALL_PITCH - startPitch) * eased;
    camera.position.y = startHeight + (-FALL_DROP) * eased;
    // Pronounced roll — the body buckling onto its side. Slightly
    // longer than the pitch so the head settles last.
    const rollT = Math.min(1, elapsed / (FALL_DURATION * 1.2));
    const rollEased = 1 - Math.pow(1 - rollT, 2);
    camera.rotation.z = FALL_ROLL * rollEased;
    // Once the camera has stopped (world frozen), apply a very
    // slight low-frequency drift to suggest the player's last
    // breath — barely perceptible.
    if (elapsed > STILL_AT) {
      const breath = Math.sin((elapsed - STILL_AT) * 1.2) * 0.004;
      camera.position.y = startHeight - FALL_DROP + breath;
    }
  }
}
