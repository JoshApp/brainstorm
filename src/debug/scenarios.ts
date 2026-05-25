import type * as THREE from 'three';
import type { LevelSpec } from '../level/types';
import type { LiveLevel } from '../level/builder';
import type { Sword, SwordPhase } from '../player/sword';
import { LEVEL_1 } from '../level/specs';
import { triggerDeath } from '../player/death';
import { setCameraYaw } from '../controls/camera';
import { setWorldFrozen } from './freeze';
import { debugUseAll, debugTickAll } from '../interactables/system';
import { damagePlayer } from '../player/health';
import { get as getEntity } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { ITEMS } from '../content/items';
import { setSlot } from '../player/equipment';

// Predefined game states loadable via ?scenario=name URL param.
// Used by the snap CLI (scripts/snap.ts) to produce deterministic screenshots,
// and useful for Josh to jump straight into a specific situation while playing.
//
// Scenarios apply AFTER buildLevel — they tweak post-construction state
// (camera pose, enemy AI phase, sword phase, etc.) and optionally swap the
// LevelSpec. Most freeze the world so screenshots are stable.

type EnemyDebugState = 'chasing' | 'winding' | 'striking' | 'recovering';

export interface Scenario {
  /** Replace the default level (otherwise LEVEL_1). */
  level?: LevelSpec;
  /** Freeze world updates after init — for deterministic screenshots. */
  freeze?: boolean;
  /**
   * Override player camera position + facing.
   * - `yaw` / `pitch` (radians) for explicit angle control, OR
   * - `lookAt: { x, z, y? }` to point the camera at a world position
   *   (yaw + pitch computed automatically — much easier to author).
   * `y` for the camera position defaults to PLAYER_HEIGHT; `y` for the
   * lookAt target defaults to 0 (floor level).
   */
  playerPos?: {
    x: number;
    z: number;
    y?: number;
    yaw?: number;
    pitch?: number;
    lookAt?: { x: number; z: number; y?: number };
  };
  /** Hide the player's held sword (for non-combat scenarios where it fills the frame). */
  hideSword?: boolean;
  /** Override one or more enemies' state by spawn index. */
  enemyOverrides?: Array<{
    index: number;
    pos?: { x: number; z: number };
    state?: EnemyDebugState;
    phaseTimer?: number;
  }>;
  /** Override the sword's phase + timer at startup. */
  swordPhase?: { phase: SwordPhase; phaseTimer: number };
  /** Trigger the death sequence at startup (vignette + epitaph + reload). */
  triggerDeath?: boolean;
  /** Fire onUse on every interactable then tick them by `chestOpenFastForwardSecs`. */
  openAllInteractables?: boolean;
  /** Seconds to fast-forward interactable animations after openAllInteractables. */
  tickInteractables?: number;
  /** Apply N points of damage to the player at startup (for HP-bar verification). */
  damagePlayerBy?: number;
  /** Apply a buff to the player at startup: id + duration. */
  applyPlayerBuff?: { id: string; duration: number };
  /** Equip a weapon by item id at startup (so snaps can show different viewmodels). */
  equipWeaponId?: string;
}

export const SCENARIOS: Record<string, Scenario> = {
  // Default spawn view, frozen so the snap captures the deterministic frame.
  spawn: { freeze: true },

  // Enemy mid-windup right next to the player — eyes flared, body tilted forward.
  'enemy-close': {
    freeze: true,
    enemyOverrides: [
      { index: 0, pos: { x: 0, z: -1.7 }, state: 'winding', phaseTimer: 0.4 },
    ],
  },

  // Enemy mid-strike, lunging at the player.
  'enemy-strike': {
    freeze: true,
    enemyOverrides: [
      { index: 0, pos: { x: 0, z: -1.7 }, state: 'striking', phaseTimer: 0.08 },
    ],
  },

  // Player's sword mid-strike — captures the chop frame for animation review.
  'sword-strike': {
    freeze: true,
    swordPhase: { phase: 'strike', phaseTimer: 0.04 },
  },

  // Sword mid-windup — captures the raised pose.
  'sword-windup': {
    freeze: true,
    swordPhase: { phase: 'windup', phaseTimer: 0.08 },
  },

  // Death sequence active. NOT frozen — needs time to ramp the vignette.
  // Snap script waits longer for this scenario.
  death: {
    triggerDeath: true,
  },

  // Empty room, no enemy. For inspecting room architecture in isolation.
  'empty-room': {
    freeze: true,
    level: { ...LEVEL_1, spawns: [] },
  },

  // Looking back at the south torch — orient the camera 180°.
  'south-torch': {
    freeze: true,
    playerPos: { x: 0, z: 0, yaw: Math.PI },
  },

  // Close-up of the scimitar relic on the altar. Demonstrates lathe (pommel)
  // + extrude (curved blade) geometry. lookAt the altar from west side.
  // (Altar is removed now — relic lives in chest — but kept as snapshot of
  // the pre-chest staging.)
  altar: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: -1.5, z: -2.78,
      lookAt: { x: 0, z: -2.78, y: 0.5 },  // look at altar top
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Looking south from spawn down the corridor toward the antechamber.
  // Verifies the wall-opening logic + corridor connectivity.
  corridor: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 0.5,
      lookAt: { x: 0, z: 12, y: 1.0 },  // toward antechamber center
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Rat in actual gameplay orientation — places rat near player and runs
  // faceTarget so the model is oriented like in normal play.
  'rat-gameplay': {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: -0.4,
      lookAt: { x: 0, z: -1.6, y: 0.15 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: 0, z: -1.6 }, state: 'chasing', phaseTimer: 0 },
    ],
  },

  // Extremely close enemy face view — debug the eye visibility.
  'enemy-face': {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: -1.0,
      lookAt: { x: 0, z: -1.7, y: 1.4 },  // very close to ghoul head
    },
    enemyOverrides: [
      { index: 0, pos: { x: 0, z: -1.7 }, state: 'chasing', phaseTimer: 0 },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Viewmodel snaps — empty room, player at spawn, weapon equipped.
  'viewmodel-rusted': {
    freeze: true,
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  'viewmodel-scimitar': {
    freeze: true,
    equipWeaponId: 'scimitar',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  // Player nose-to-wall — verifies the held weapon renders on top
  // (doesn't clip through the wall).
  'viewmodel-wall': {
    freeze: true,
    equipWeaponId: 'scimitar',
    playerPos: {
      x: -3.5, z: 0,
      lookAt: { x: -5, z: 0, y: 1.5 },  // facing the west wall up close
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Looking at the east wall of the chamber — shows the moonlight crack.
  moonlight: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: -0.5,
      lookAt: { x: 4, z: -0.5, y: 1.5 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Standing INSIDE the corridor (verifies the player can actually be at
  // z > 4 without the collision system snapping them back into the chamber).
  'in-corridor': {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 6.25,                    // mid-corridor
      lookAt: { x: 0, z: 12, y: 1.0 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Looking back from inside the antechamber toward the chamber.
  antechamber: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 11,
      lookAt: { x: 0, z: 0, y: 1.6 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Close-up of the chest (closed). lookAt does the math; we just say where
  // the chest is and where to stand.
  chest: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: -1.2, z: 1.3,
      lookAt: { x: -2.2, z: 2.6, y: 0.2 },  // chest now at (-2.2, _, 2.6)
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Chest after being opened — lid swung up, loot scimitar bobbing beside it.
  'chest-open': {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: -0.5, z: 0.6,
      lookAt: { x: -2.2, z: 2.6, y: 0.6 },  // higher target — the loot now stands upright
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
    openAllInteractables: true,
    tickInteractables: 0.8,
  },

  // HUD test: damage the player to 2/5 HP + apply the regen buff. Both the
  // HP bar and the buff bar should show the expected state.
  hud: {
    freeze: true,
    damagePlayerBy: 3,
    applyPlayerBuff: { id: 'regen-pulse', duration: 2.7 },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Close-up of the rat. Look at the rat directly — lookAt computes pitch
  // so the small-on-the-floor target is centered, no manual math.
  rat: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: -0.4,
      lookAt: { x: 0, z: -1.6, y: 0.15 },  // rat eye height ~0.15
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: 0, z: -1.6 }, state: 'chasing', phaseTimer: 0 },
    ],
  },
};

export function getScenarioFromUrl(): Scenario | null {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('scenario');
  if (!name) return null;
  const base = SCENARIOS[name];
  if (!base) {
    // eslint-disable-next-line no-console
    console.warn(`Unknown scenario: ${name}. Available:`, Object.keys(SCENARIOS));
    return null;
  }
  const freezeOverride = params.get('freeze');
  if (freezeOverride !== null) {
    return { ...base, freeze: freezeOverride === 'true' };
  }
  return base;
}

export function applyScenario(
  scenario: Scenario,
  ctx: { level: LiveLevel; sword: Sword; camera: THREE.Camera },
) {
  if (scenario.playerPos) {
    const pp = scenario.playerPos;
    ctx.camera.position.x = pp.x;
    ctx.camera.position.y = pp.y ?? 1.6;  // PLAYER_HEIGHT default
    ctx.camera.position.z = pp.z;
    ctx.camera.rotation.order = 'YXZ';

    if (pp.lookAt) {
      // Look at a world point. Three.js handles the math; we extract yaw/pitch
      // from the resulting quaternion (because rotation.order='YXZ' is set).
      const targetY = pp.lookAt.y ?? 0;
      ctx.camera.lookAt(pp.lookAt.x, targetY, pp.lookAt.z);
      setCameraYaw(ctx.camera.rotation.y);
    } else {
      const yaw = pp.yaw ?? 0;
      ctx.camera.rotation.y = yaw;
      ctx.camera.rotation.x = pp.pitch ?? 0;
      setCameraYaw(yaw);
    }
  }

  if (scenario.hideSword) {
    ctx.sword.group.visible = false;
  }

  if (scenario.enemyOverrides) {
    for (const ov of scenario.enemyOverrides) {
      const enemy = ctx.level.enemies[ov.index];
      if (!enemy) continue;
      if (ov.pos) enemy.setDebugPosition(ov.pos.x, ov.pos.z);
      if (ov.state) enemy.setDebugState(ov.state, ov.phaseTimer ?? 0);
      // Always make the repositioned enemy face the camera. Without this,
      // frozen scenarios show enemies at default rotation (looking world -Z)
      // regardless of where the camera is, so the rat appears to face
      // "backwards" relative to the camera angle.
      enemy.faceWorld(ctx.camera.position.x, ctx.camera.position.z);
    }
  }

  if (scenario.swordPhase) {
    ctx.sword.setDebugPhase(scenario.swordPhase.phase, scenario.swordPhase.phaseTimer);
  }

  if (scenario.triggerDeath) {
    triggerDeath();
  }

  if (scenario.openAllInteractables) {
    debugUseAll();
    if (scenario.tickInteractables) debugTickAll(scenario.tickInteractables);
  }

  if (scenario.damagePlayerBy) {
    damagePlayer(scenario.damagePlayerBy);
  }

  if (scenario.applyPlayerBuff) {
    const player = getEntity('player');
    if (player) applyBuff(player, scenario.applyPlayerBuff.id, scenario.applyPlayerBuff.duration);
  }

  if (scenario.equipWeaponId) {
    const item = ITEMS[scenario.equipWeaponId];
    if (item) {
      // Use the equipment system so viewmodel + stats both update via the
      // main.ts listener — same code path as a real pickup.
      setSlot('weapon', item);
    }
  }

  if (scenario.freeze) {
    setWorldFrozen(true);
  }
}
