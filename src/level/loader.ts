import * as THREE from 'three';
import { buildLevel, type LiveLevel } from './builder';
import type { LevelSpec } from './types';
import type { StyleMaterials } from '../style/materials';
import { CONFIG } from '../config';
import { clearProjectiles } from '../combat/projectile-pool';
import { clearXpWisps } from '../effects/xp-wisps';
import { clearGoldCoins } from '../effects/gold-coins';
import { clearTutorialHints } from '../effects/tutorial-hints';
import { fadeOut, fadeIn } from '../ui/descent-fade';

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
  // the depth-to-be (currentDepth + 1) so the generator can scale
  // difficulty without needing extra params.
  let spec = levels[id];
  if (!spec && generate) {
    const targetDepth = currentDepth + 1;
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
    clearXpWisps();
    clearGoldCoins();
    clearTutorialHints();
    activeLevel.teardown();
    activeLevel = null;
  }

  // Build the new level into the same scene.
  const level = buildLevel(scene, spec, materials, (target) => loadLevel(target));
  activeLevel = level;
  currentDepth += 1;

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

  onLoaded(level);
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
  // tickPendingLoad will increment, so we set one below the target.
  currentDepth = startingDepth - 1;
  tickPendingLoad();
}
