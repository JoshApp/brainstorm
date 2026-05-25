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
  /** Override player camera position + yaw (and optional pitch in radians, negative = look down). */
  playerPos?: { x: number; z: number; yaw: number; pitch?: number };
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
  // + extrude (curved blade) geometry. Camera looks at the altar from the
  // west side so the relic's profile is visible against the torchlight.
  altar: {
    freeze: true,
    playerPos: { x: -1.5, z: -2.78, yaw: -Math.PI / 2 },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } }, // ghoul out of view
      { index: 1, pos: { x:  10, z: -10 } }, // skirmisher out of view
      { index: 2, pos: { x: -10, z:  10 } }, // rat out of view
    ],
  },

  // Close-up of the chest (closed). Camera south of spawn looking at the
  // chest, tilted down slightly so the small chest fills the lower frame.
  chest: {
    freeze: true,
    playerPos: { x: 0.2, z: 1.0, yaw: Math.PI, pitch: -0.3 },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Chest after being opened — lid swung up, loot scimitar bobbing beside it.
  // Programmatically fires onUse + fast-forwards the open animation.
  'chest-open': {
    freeze: true,
    playerPos: { x: 0.2, z: 1.0, yaw: Math.PI, pitch: -0.3 },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
    openAllInteractables: true,
    tickInteractables: 0.8,  // longer than chest open duration (0.55s)
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

  // Close-up of the rat. Quadruped silhouette built from primitives.
  // Player at spawn looking north; rat between player and the north torch
  // (where the light actually reaches) so the silhouette + glowing eyes read.
  rat: {
    freeze: true,
    playerPos: { x: 0, z: -0.4, yaw: 0 },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } }, // ghoul out of view
      { index: 1, pos: { x:  10, z: -10 } }, // skirmisher out of view
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
    ctx.camera.position.x = scenario.playerPos.x;
    ctx.camera.position.z = scenario.playerPos.z;
    setCameraYaw(scenario.playerPos.yaw);
    // Apply rotation directly so frozen scenarios render with the right yaw
    // (updateCamera won't run while frozen).
    ctx.camera.rotation.order = 'YXZ';
    ctx.camera.rotation.y = scenario.playerPos.yaw;
    ctx.camera.rotation.x = scenario.playerPos.pitch ?? 0;
  }

  if (scenario.enemyOverrides) {
    for (const ov of scenario.enemyOverrides) {
      const enemy = ctx.level.enemies[ov.index];
      if (!enemy) continue;
      if (ov.pos) enemy.setDebugPosition(ov.pos.x, ov.pos.z);
      if (ov.state) enemy.setDebugState(ov.state, ov.phaseTimer ?? 0);
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

  if (scenario.freeze) {
    setWorldFrozen(true);
  }
}
