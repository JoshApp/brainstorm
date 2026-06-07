import * as THREE from 'three';
import { buildLevel, type LiveLevel } from './builder';
import type { LevelSpec } from './types';
import type { StyleMaterials } from '../style/materials';
import { CONFIG } from '../config';
import { clearProjectiles } from '../combat/projectile-pool';
import { clearHazardFields } from '../combat/hazard-field';
import { resetBossEncounter } from '../mobs/boss-encounter';
import { resetBossEngagement } from '../ui/boss-engagement';
import { resetPlayerInvuln } from '../player/health';
import { resetJustDodge } from '../combat/just-dodge';
import { resetExhaustionFeedback } from '../combat/exhaustion-feedback';
import { clearBreath } from '../effects/breath';
import { resetCameraStumble } from '../combat/camera-stumble';
import { resetViewSway } from '../player/viewmodel-sway';
import { resetDashCooldown } from '../combat/dash';
import { cancelFogWalkthrough } from '../player/fog-walkthrough';
import { clearXpWisps } from '../effects/xp-wisps';
import { clearGoldCoins } from '../effects/gold-coins';
import { clearStatusVfx } from '../effects/status-vfx';
import { clearTutorialHints } from '../effects/tutorial-hints';
import { clearAlerts } from '../mobs/alerts';
import { clearDriftingMotes } from '../effects/drifting-motes';
import { clearShatterBurst } from '../effects/shatter-burst';
import { clearBloodBurst } from '../effects/blood-burst';
import { clearAllOutlines } from '../interactables/outline';
import { resetDarkAdaptation } from '../scene/dark-adaptation';
import { clearThresholdDrafts } from '../scene/threshold-draft';
import { fadeOut, fadeIn, showDescentTitle } from '../ui/descent-fade';
import { showSafeRoomTransition } from '../ui/safe-room-transition';
import { actForDepth } from './acts';
import { getActStats } from '../state/run-state';
import { getUpdateStatus, applyUpdate } from '../pwa-update';
import { getSettings } from '../settings/settings';

// Level loader = the seam between "we have a current level" and "let's swap
// it for a different one". main.ts holds the active level reference via the
// getter below; stairs interactables fire onDescend, which calls loadLevel
// and the swap happens at the start of the next frame.
//
// Why deferred (next-frame) rather than immediate: the stairs.onUse fires
// during interactables tick, which itself runs during the main loop. Tearing
// down the world mid-tick would invalidate iteration. We queue a request
// and apply at the top of the next frame.

let scene: THREE.Scene | null = null;
let materials: StyleMaterials | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let levels: Record<string, LevelSpec> = {};
let onLoaded: ((level: LiveLevel) => void) | null = null;

let activeLevel: LiveLevel | null = null;
let pendingLoadId: string | null = null;
let currentDepth = 1;

export interface LoaderConfig {
  scene: THREE.Scene;
  materials: StyleMaterials;
  camera: THREE.PerspectiveCamera;
  levels: Record<string, LevelSpec>;
  /** Called after a successful load — main.ts wires up systems that
   *  depend on the per-level data (combat system, walkable region refs). */
  onLoaded: (level: LiveLevel) => void;
  /**
   * Optional fallback for ids NOT in the static registry. Used by the
   * procgen system: when stairs descend to 'depth-3' and depth-3 isn't a
   * hand-authored entry, the generator produces a fresh LevelSpec.
   * Receives the depth implied by the id (parsed via parseDepth).
   */
  generate?: (id: string, depth: number) => LevelSpec | null;
}

let generate: LoaderConfig['generate'] = undefined;

/** One-time setup. After this, the loader owns the active level handle. */
export function initLevelLoader(cfg: LoaderConfig) {
  scene = cfg.scene;
  materials = cfg.materials;
  camera = cfg.camera;
  levels = cfg.levels;
  onLoaded = cfg.onLoaded;
  generate = cfg.generate;
}

/** Get the currently-active level. Null before the first load. */
export function getActiveLevel(): LiveLevel | null {
  return activeLevel;
}

export function getCurrentDepth(): number {
  return currentDepth;
}

/** Schedule a level load. Plays a brief fade-to-black FIRST so the
 *  camera angle + surroundings don't snap mid-frame, then sets the
 *  pending id — the next tickPendingLoad picks it up. The fade-IN
 *  is triggered from onLoaded once the new level is mounted. */
export function loadLevel(id: string) {
  fadeOut().then(() => {
    pendingLoadId = id;
  });
}

/**
 * Apply a pending load if any. Call at the TOP of the main loop, before
 * any tick that touches enemies / interactables / walkable.
 */
export function tickPendingLoad() {
  if (!pendingLoadId) return;
  const id = pendingLoadId;
  pendingLoadId = null;

  if (!scene || !materials || !camera || !onLoaded) {
    // eslint-disable-next-line no-console
    console.warn('Level loader not initialized');
    return;
  }
  // Resolve the spec: registry first, then procgen fallback. We compute
  // the depth-to-be so the generator can scale difficulty without needing
  // extra params. Regular floors increment from current; safe rooms inherit
  // the boss-depth they sit after (encoded in the id, e.g. 'safe-3' → 3).
  const isSafeRoom = id.startsWith('safe-');
  let spec = levels[id];
  if (!spec && generate) {
    const targetDepth = isSafeRoom ? currentDepth : currentDepth + 1;
    const generated = generate(id, targetDepth);
    if (generated) {
      spec = generated;
      // Cache the generated spec in the registry so a stairs.targetLevel
      // that references THIS floor (e.g. for hypothetical future
      // back-tracking) finds it. Also makes repeated descents idempotent.
      levels[id] = generated;
    }
  }
  if (!spec) {
    // eslint-disable-next-line no-console
    console.warn(`Unknown level id: ${id}`);
    return;
  }

  // Tear down current level if any. Player + UI + inventory persist.
  // Also retire any in-flight projectiles + soul wisps so they don't
  // survive into the new floor's scene graph.
  if (activeLevel) {
    clearProjectiles();
    clearHazardFields();
    clearXpWisps();
    clearGoldCoins();
    clearStatusVfx();
    clearTutorialHints();
    clearAlerts();
    clearDriftingMotes();
    clearShatterBurst();
    clearBloodBurst();
    clearAllOutlines();
    resetDarkAdaptation();
    clearThresholdDrafts();
    activeLevel.teardown();
    activeLevel = null;
  }

  // Advance currentDepth BEFORE buildLevel so the level:loaded event
  // (emitted from inside buildLevel) sees the correct depth. The
  // run-state listener calls getCurrentDepth() to snapshot the save's
  // depth field; without this ordering, every save records a depth
  // one less than the player's actual floor, and Continue Run then
  // regenerates the WRONG floor (one shallower than where they were).
  //
  // Safe rooms don't advance depth — they're the breath between acts,
  // not a dungeon floor. The depth counter / title both read the
  // unchanged currentDepth, which matches the boss the player just beat.
  if (!isSafeRoom) currentDepth += 1;
  // Reset the boss encounter + fog-wall flags BEFORE building — the build
  // registers the boss + its fog gate's completion listener, so resetting
  // afterward (the old resetBossBar timing) would wipe them.
  resetBossEncounter();
  resetBossEngagement();
  resetPlayerInvuln();
  resetJustDodge();         // clear any in-flight counter window / slow-mo
  resetExhaustionFeedback(); // clear breath phase / heave on a fresh floor
  clearBreath();            // hide any in-flight breath puffs
  resetCameraStumble();     // clear any in-flight stumble lurch
  resetDashCooldown();      // a fresh floor starts dodge-ready
  cancelFogWalkthrough();   // never carry a half-played gate walk into a new level
  // Build the new level into the same scene.
  const level = buildLevel(scene, spec, materials, (target) => loadLevel(target));
  activeLevel = level;

  // Reposition player to new spawn — and resolve against the walkable
  // region. Authored spawns are normally fine, but if a designer (or
  // procgen) places the spawn inside an obstacle (e.g. on the new
  // floor's stair footprint), this nudges the player to the nearest
  // free spot so they don't start stuck. ~0.30m matches the typical
  // player collision radius used elsewhere.
  const resolved = level.walkable.resolveSpawn(
    level.playerSpawn.x,
    level.playerSpawn.z,
    0.30,
  );
  camera.position.set(resolved.x, CONFIG.PLAYER_HEIGHT, resolved.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = level.playerSpawn.yaw;
  // Floor-load camera jump shouldn't fling the lamp on respawn.
  resetViewSway();

  onLoaded(level);

  // Title card: "Depth N" + act name. Safe rooms get the transition
  // card instead — a longer in-world beat with stats from the act
  // the player just survived. The descent-title's brief flash would
  // step on the transition card's slower entry, so we skip it.
  if (isSafeRoom) {
    const act = actForDepth(currentDepth);
    const stats = getActStats();
    // Show the card AFTER the world fades in — the player lands in
    // the safe room, gets the camera oriented, then the card rises
    // over it. Tap-to-dismiss. The fade-in delay below matches the
    // descent-fade's 320ms fade-out + a beat for the world to settle.
    window.setTimeout(() => {
      showSafeRoomTransition({
        actName: act.name,
        depth: currentDepth,
        kills: stats.kills,
        xp:    stats.xp,
      });
    }, 600);
  } else {
    const act = actForDepth(currentDepth);
    showDescentTitle(`Depth ${currentDepth}`, act.name);
  }

  // Pending service-worker update? The world is still hidden (fadeOut
  // ran before we got here) — the perfect moment to take it. The reload
  // happens during the black, the new bundle reads the save we just
  // committed (commitFloorEntry fires from the level:loaded event
  // emitted inside buildLevel above), and the player lands on the same
  // floor we were about to reveal — except running new code. From their
  // POV: tapped DESCEND, world loaded. Invisible.
  if (getSettings().autoUpdate && getUpdateStatus() === 'pending') {
    void applyUpdate();    // reload is coming; skip fadeIn
    return;
  }

  // Reveal the new level once its first frame has rendered.
  fadeIn();
}

/**
 * Bootstrap the FIRST level — same as loadLevel + tickPendingLoad in one
 * call. Optional startingDepth for resume: a save at depth 3 hydrates
 * currentDepth=3 instead of 1.
 */
export function loadInitialLevel(id: string, startingDepth: number = 1) {
  pendingLoadId = id;
  // tickPendingLoad increments for regular loads but not for safe rooms;
  // mirror that here so the post-load currentDepth equals startingDepth
  // either way.
  currentDepth = id.startsWith('safe-') ? startingDepth : startingDepth - 1;
  tickPendingLoad();
}
