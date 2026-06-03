import * as THREE from 'three';
import type { LevelSpec, EnemySpawnSpec, TorchSpec } from '../level/types';
import type { LiveLevel } from '../level/builder';
import type { WeaponViewmodel, SwingPhase } from '../player/viewmodel';
import { triggerDeath } from '../player/death';
import { setCameraYaw } from '../controls/camera';
import { setWorldFrozen } from './freeze';
import { generateFloor } from '../level/procgen';
import { generateSafeRoom } from '../level/safe-room';
import { buildVaultPreview } from '../level/vault-compose';
import { VAULTS } from '../level/vault-library';
import { debugUseAll, debugTickAll } from '../interactables/system';
import { damagePlayer } from '../player/health';
import { get as getEntity } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { ITEMS } from '../content/items';
import { buildModel } from '../ecs/build-model';
import { setSlot, tryAutoEquip } from '../player/equipment';
import { addItem, removeItem } from '../player/inventory';
import { createPickup } from '../interactables/pickup';
import { spawnShroudedRelic } from '../interactables/shrouded-relic';
import { openInventoryPanel, selectBagItem } from '../ui/inventory-panel';
import { openCharacterScreen } from '../ui/character-screen';

// Predefined game states loadable via ?scenario=name URL param.
// Used by the snap CLI (scripts/snap.ts) to produce deterministic screenshots,
// and useful for Josh to jump straight into a specific situation while playing.
//
// Scenarios apply AFTER buildLevel — they tweak post-construction state
// (camera pose, enemy AI phase, sword phase, etc.) and optionally swap the
// LevelSpec. Most freeze the world so screenshots are stable.

type EnemyDebugState = 'chasing' | 'winding' | 'striking' | 'recovering';

export interface Scenario {
  /** Replace the default level (otherwise the boot placeholder). */
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
  /**
   * Inspection mode (vault-preview snaps): suppress the floor title card and
   * flood the scene with bright, flat ambient + far fog so AUTHORED GEOMETRY
   * reads clearly regardless of torch placement. Trades grimdark mood for
   * legibility — only meant for `vault-<id>` previews, never gameplay.
   */
  inspect?: boolean;
  /**
   * HUD-only mode: hide the 3D canvas entirely (a flat mid backdrop sits
   * behind it via the .hud-only body class). For inspecting HUD widgets —
   * inventory panel, HP bar, hotbar, broadcast pop, boss bar — without the
   * dungeon scene fighting the read. Pair with the existing field that
   * mounts the widget (giveItems / openInventoryPanel / damagePlayerBy /
   * applyPlayerBuff / etc.).
   */
  hudOnly?: boolean;
  /**
   * In inspect mode: hide every child of currentLevel.root EXCEPT
   * meshes tagged userData.inspectSubject (the previewed mob /
   * item / model). Used for subject-only previews (mob-*, item-*,
   * model-*) where the dungeon room around the subject reads as
   * noise. Vault previews leave this off — the room IS the subject.
   */
  inspectSubjectOnly?: boolean;
  /** Override one or more enemies' state by spawn index. */
  enemyOverrides?: Array<{
    index: number;
    pos?: { x: number; z: number };
    state?: EnemyDebugState;
    phaseTimer?: number;
  }>;
  /** Override the sword's phase + timer at startup. */
  swordPhase?: { phase: SwingPhase; phaseTimer: number };
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
  /** Add items to inventory and auto-equip rings/armor (for inventory-panel snaps). */
  giveItems?: string[];
  /** Programmatically open the inventory panel for the snap. */
  openInventoryPanel?: boolean;
  /** Pre-select an inventory item id so the details panel shows on snap. */
  selectItemId?: string;
  /** Open the character sheet (for UI snaps). */
  openCharacterScreen?: boolean;
  /** Spawn pickups on the floor near the camera (for rarity-glow snaps). */
  spawnPickups?: Array<{ itemId: string; x: number; z: number }>;
  /** Spawn shrouded relics (the cursed mystery gamble) near the camera. */
  spawnShrouded?: Array<{ x: number; z: number; depth?: number }>;
  /**
   * Item viewer: float a single item's dropModel at eye level in front
   * of the camera, slowly rotating. For previewing weapon/armor/ring
   * geometry without committing it to inventory + squinting at the
   * tiny icon. Combine with inspect:true for flat lighting + clean
   * background. The URL param ?item=<id> overrides this so a single
   * 'item' scenario row can serve every item via snap arg.
   */
  previewItemId?: string;
}

// ── Perf stress helpers ──────────────────────────────────────────────
// Used by the `perf-*` stress scenarios below. These deliberately push
// far past normal gameplay density so the headless perf runner
// (scripts/perf.ts) can read worst-case structural load — draw calls,
// triangles, active lights — off renderer.info. Run UNFROZEN (the runner
// passes ?freeze=false) so AI, projectiles, and light binding all tick.

/** Grid of enemy spawns filling a square room, cycling a kind mix so
 *  melee bodies + ranged projectile pools are both exercised. Skips a
 *  clear radius around the origin so nothing spawns on the camera. */
function gridSpawns(
  roomId: string,
  count: number,
  halfExtent: number,
  kinds: string[] = ['ghoul', 'skeleton', 'acolyte', 'spider'],
): EnemySpawnSpec[] {
  const out: EnemySpawnSpec[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const span = cols > 1 ? cols - 1 : 1;
  for (let i = 0; i < count; i++) {
    const x = ((i % cols) / span - 0.5) * 2 * halfExtent;
    const z = (Math.floor(i / cols) / span - 0.5) * 2 * halfExtent;
    if (Math.hypot(x, z) < 2.5) continue;
    out.push({ enemyId: kinds[i % kinds.length], x, z, roomId });
  }
  return out;
}

/** Grid of wall torches blanketing a room — saturates the environment
 *  light pool (10 slots) several times over so the LOS/frustum cull and
 *  per-frame slot rebinding run at worst case. */
function gridTorches(count: number, halfExtent: number): TorchSpec[] {
  const out: TorchSpec[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const span = cols > 1 ? cols - 1 : 1;
  for (let i = 0; i < count; i++) {
    const x = ((i % cols) / span - 0.5) * 2 * halfExtent;
    const z = (Math.floor(i / cols) / span - 0.5) * 2 * halfExtent;
    out.push({ x, z, height: 2.0, wall: 'N', colorTint: 0xffaa55, intensityMul: 0.9 });
  }
  return out;
}

export const SCENARIOS: Record<string, Scenario> = {
  // ── PERF STRESS SCENARIOS ──────────────────────────────────────────
  // perf-horde: a packed mob fight — many animated enemies + projectiles
  // in view at once. The dynamic-entity draw-call stress.
  'perf-horde': {
    level: {
      id: 'perf-horde', depth: 5, displayName: 'PERF horde', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 14, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 34, d: 34 }, height: 4.5 }],
      corridors: [],
      props: [],
      torches: gridTorches(8, 14),
      spawns: gridSpawns('r', 32, 14),
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 14, lookAt: { x: 0, z: 0, y: 1.0 } },
  },

  // diag-rooms: a straight chain of 4 rooms (the last one boss-sized) down
  // -Z, the player at the near end looking down the whole sightline. Repro
  // for "draw calls double when looking through several rooms toward the
  // boss room" — the far rooms sit 18-32m away, past FOG_FAR (9m), so they're
  // fogged-invisible yet still inside the 50m camera frustum and drawn.
  'diag-rooms': {
    freeze: true,
    level: {
      id: 'diag-rooms', depth: 3, displayName: 'DIAG rooms', fogColor: 0x000000,
      startPos: { x: 0, z: 4, yaw: Math.PI },
      rooms: [
        { id: 'r0', rect: { x: 0, z: 0,   w: 6, d: 6 }, height: 3.2 },
        { id: 'r1', rect: { x: 0, z: -9,  w: 6, d: 6 }, height: 3.2 },
        { id: 'r2', rect: { x: 0, z: -18, w: 6, d: 6 }, height: 3.2 },
        { id: 'r3', rect: { x: 0, z: -28, w: 8, d: 8 }, height: 4.0 },
      ],
      corridors: [
        { id: 'c0', rect: { x: 0, z: -4.5,  w: 1.6, d: 3 }, height: 3.0 },
        { id: 'c1', rect: { x: 0, z: -13.5, w: 1.6, d: 3 }, height: 3.0 },
        { id: 'c2', rect: { x: 0, z: -22.5, w: 1.6, d: 3 }, height: 3.0 },
      ],
      props: [],
      torches: [
        { x: -2.5, z: 0,   height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x:  2.5, z: 0,   height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x: -2.5, z: -9,  height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x:  2.5, z: -9,  height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x: -2.5, z: -18, height: 2.0, wall: 'W', colorTint: 0xff5533, intensityMul: 1.0 },
        { x:  2.5, z: -18, height: 2.0, wall: 'E', colorTint: 0xff5533, intensityMul: 1.0 },
        { x: -3.5, z: -28, height: 2.5, wall: 'W', colorTint: 0x55ff88, intensityMul: 1.4 },
        { x:  3.5, z: -28, height: 2.5, wall: 'E', colorTint: 0x55ff88, intensityMul: 1.4 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 4, lookAt: { x: 0, z: -28, y: 1.2 } },
  },

  // diag-behind: room B sits behind A's east wall (within the 13m far plane,
  // inside the view cone) but is reachable only via a side corridor (cV→cH)
  // whose doorway is OUT of the eastward view. Frustum culling can't hide B
  // (it's in the cone); portal culling should, because no visible doorway
  // leads to it. The case behind "draws go up when I face a corridor wall".
  'diag-behind': {
    freeze: true,
    level: {
      id: 'diag-behind', depth: 3, displayName: 'DIAG behind', fogColor: 0x000000,
      startPos: { x: -2, z: 0, yaw: -Math.PI / 2 },
      rooms: [
        { id: 'A', rect: { x: 0,   z: 0,   w: 6, d: 6 }, height: 3.2 },
        { id: 'B', rect: { x: 9.8, z: 4.5, w: 6, d: 6 }, height: 3.2 },
      ],
      corridors: [
        { id: 'cV', rect: { x: 0,   z: 4.5, w: 1.6, d: 3 },   height: 3.0 },
        { id: 'cH', rect: { x: 3.8, z: 4.5, w: 6,   d: 1.6 }, height: 3.0 },
      ],
      props: [],
      torches: [
        { x: -2.5, z: -2.5, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x:  2.5, z: -2.5, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.0 },
        // B's torches — bright, so if B leaks through (it shouldn't) it's obvious.
        { x:  7.5, z:  2.5, height: 2.2, wall: 'W', colorTint: 0x55ff88, intensityMul: 1.4 },
        { x: 12.0, z:  6.5, height: 2.2, wall: 'E', colorTint: 0x55ff88, intensityMul: 1.4 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: -2, z: 0, lookAt: { x: 20, z: 0, y: 1.2 } },
  },

  // diag-cross: a central room with rooms on all 4 sides, camera facing NORTH.
  // Expected visible with portal culling: {C, cN, N}. South (behind), East,
  // West (sides) must cull — the test for "does it render rooms behind me".
  'diag-cross': {
    freeze: true,
    level: {
      id: 'diag-cross', depth: 3, displayName: 'DIAG cross', fogColor: 0x000000,
      startPos: { x: 0, z: 0, yaw: Math.PI },
      rooms: [
        { id: 'C', rect: { x: 0,  z: 0,  w: 6, d: 6 }, height: 3.2 },
        { id: 'N', rect: { x: 0,  z: -9, w: 6, d: 6 }, height: 3.2 },
        { id: 'S', rect: { x: 0,  z: 9,  w: 6, d: 6 }, height: 3.2 },
        { id: 'E', rect: { x: 9,  z: 0,  w: 6, d: 6 }, height: 3.2 },
        { id: 'W', rect: { x: -9, z: 0,  w: 6, d: 6 }, height: 3.2 },
      ],
      corridors: [
        { id: 'cN', rect: { x: 0,    z: -4.5, w: 1.6, d: 3 }, height: 3.0 },
        { id: 'cS', rect: { x: 0,    z: 4.5,  w: 1.6, d: 3 }, height: 3.0 },
        { id: 'cE', rect: { x: 4.5,  z: 0,    w: 3,   d: 1.6 }, height: 3.0 },
        { id: 'cW', rect: { x: -4.5, z: 0,    w: 3,   d: 1.6 }, height: 3.0 },
      ],
      props: [],
      torches: [
        { x: 0, z: -8.5, height: 2.0, wall: 'N', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x: 0, z:  8.5, height: 2.0, wall: 'S', colorTint: 0xff5555, intensityMul: 1.2 },
        { x: 8.5, z: 0,  height: 2.0, wall: 'E', colorTint: 0x55aaff, intensityMul: 1.2 },
        { x: -8.5, z: 0, height: 2.0, wall: 'W', colorTint: 0x55ff88, intensityMul: 1.2 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0, lookAt: { x: 0, z: -20, y: 1.2 } },
  },

  // perf-lights: blanket of torches — saturates the light pool many times
  // over to stress the per-frame cull + slot rebinding, and maxes the
  // count of lit materials in view.
  'perf-lights': {
    level: {
      id: 'perf-lights', depth: 5, displayName: 'PERF lights', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 16, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 36, d: 36 }, height: 4.5 }],
      corridors: [],
      props: [],
      torches: gridTorches(48, 15),
      spawns: [],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 16, lookAt: { x: 0, z: 0, y: 1.0 } },
  },

  // perf-max: combined worst case — packed horde AND a torch blanket in
  // one big arena. The number to watch for "do we have headroom".
  'perf-max': {
    level: {
      id: 'perf-max', depth: 5, displayName: 'PERF max', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 16, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 38, d: 38 }, height: 4.5 }],
      corridors: [],
      props: [],
      torches: gridTorches(40, 16),
      spawns: gridSpawns('r', 40, 16),
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 16, lookAt: { x: 0, z: 0, y: 1.0 } },
  },


  // Default spawn view, frozen so the snap captures the deterministic frame.
  spawn: { freeze: true },

  // Isolated open archway — room + abutting corridor (a real wall gap), player
  // standing right before it. For reviewing the threshold dust + proximity haze.
  archway: {
    freeze: true,
    hideSword: true,
    level: {
      id: 'dbg-archway', depth: 0, displayName: 'archway', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 0.5, yaw: 0 },
      rooms: [{ id: 'arch-room', rect: { x: 0, z: 1, w: 5, d: 4 }, height: 3.2 }],
      corridors: [{ id: 'arch-cor', rect: { x: 0, z: -2.5, w: 1.6, d: 3 }, height: 3.0 }],
      props: [],
      torches: [
        { x: -2.55, z: 2.0, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.7 },
        { x:  2.55, z: 2.0, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.7 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0.5, lookAt: { x: 0, z: -4, y: 1.1 } },
  },

  // Narrow opening — a 1m doorway between room + corridor. Below the 1.6m
  // archway threshold, so it gets the light DOORFRAME instead. For reviewing
  // the doorframe model (jambs + lintel + void-cap) framing a thin wall.
  doorframe: {
    freeze: true,
    hideSword: true,
    level: {
      id: 'dbg-doorframe', depth: 0, displayName: 'doorframe', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 0.5, yaw: 0 },
      rooms: [{ id: 'df-room', rect: { x: 0, z: 1, w: 5, d: 4 }, height: 3.2 }],
      corridors: [{ id: 'df-cor', rect: { x: 0, z: -2.5, w: 1.0, d: 3 }, height: 3.0 }],
      props: [],
      torches: [
        // Flank the opening so the doorframe is clearly lit for review.
        { x: -2.0, z: -0.9, height: 2.0, wall: 'N', colorTint: 0xffaa55, intensityMul: 1.0 },
        { x:  2.0, z: -0.9, height: 2.0, wall: 'N', colorTint: 0xffaa55, intensityMul: 1.0 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0.5, lookAt: { x: 0, z: -4, y: 1.1 } },
  },

  // Consumable hotbar review — full heal stack + a berserk, gameplay HUD up.
  consumables: {
    freeze: true,
    level: {
      id: 'dbg-consumables', depth: 0, displayName: 'consumables', fogColor: 0x14100a,
      startPos: { x: 0, z: 0, yaw: 0 },
      rooms: [{ id: 'cb-room', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.2 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.05, z: -1.5, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.05, z: -1.5, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    giveItems: ['healing-potion', 'healing-potion', 'healing-potion', 'healing-potion', 'healing-potion', 'berserk-potion', 'berserk-potion'],
  },

  // Boss (the wraith, now scaled + named) up close — for size/silhouette
  // review. The boss bar itself only ticks in live play (driven by the
  // enemies system), so it won't show in this frozen pose.
  boss: {
    freeze: true,
    hideSword: true,
    level: {
      id: 'dbg-boss', depth: 0, displayName: 'boss', fogColor: 0x140a0a,
      startPos: { x: 0, z: 3.5, yaw: 0 },
      rooms: [{ id: 'boss-room', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 4.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -4.05, z: -2.0, height: 2.4, wall: 'W', colorTint: 0xff5a44, intensityMul: 1.0 },
        { x:  4.05, z: -2.0, height: 2.4, wall: 'E', colorTint: 0xff5a44, intensityMul: 1.0 },
      ],
      spawns: [{ enemyId: 'wraith', x: 0, z: -1.5, roomId: 'boss-room' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 3.5, lookAt: { x: 0, z: -1.5, y: 1.3 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.5 }, state: 'chasing' }],
  },

  // Skeleton up close in a small lit room — for silhouette review.
  skeleton: {
    freeze: true,
    level: {
      id: 'dbg-skeleton', depth: 0, displayName: 'skeleton', fogColor: 0x14100a,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'sk-room', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.2 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.05, z: -1.5, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.05, z: -1.5, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'skeleton', x: 0, z: -1.5, roomId: 'sk-room' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.6, lookAt: { x: 0, z: -1.5, y: 0.9 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.5 }, state: 'chasing' }],
  },

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
  // Snap script waits longer for this scenario. Equips a weapon so the
  // on-death hand-drop (weapon tumbles to the floor) is exercised.
  death: {
    equipWeaponId: 'rusted-sword',
    triggerDeath: true,
  },

  // ('empty-room' scenario removed alongside LEVEL_1 — use any
  // vault-<id> preview for room-architecture inspection.)

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
      x: 0, z: 3.0,
      lookAt: { x: 0, z: 12, y: 1.2 },  // close to chamber door to see SEALED prompt
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
  // New weapon viewmodels — scythe / whip / throwing knives.
  'viewmodel-scythe': {
    freeze: true,
    equipWeaponId: 'reapers-toll',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  'viewmodel-whip': {
    freeze: true,
    equipWeaponId: 'penitents-chain',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  'viewmodel-knives': {
    freeze: true,
    equipWeaponId: 'cord-of-knives',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  // Mundane base starters — sickle (sweep) / pike (reach).
  'viewmodel-sickle': {
    freeze: true,
    equipWeaponId: 'bent-sickle',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  'viewmodel-pike': {
    freeze: true,
    equipWeaponId: 'pilgrims-pike',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  // Spear viewmodel — equip the reach weapon to review the thrust →
  // thrust → lunge combo against a posed enemy.
  'viewmodel-spear': {
    equipWeaponId: 'spear',
    enemyOverrides: [
      { index: 0, pos: { x: 0, z: -8 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  // Ranged viewmodels — equip the crossbow / wand so the fire + reload
  // (crossbow) and gather + cast (wand) poses can be reviewed by firing
  // at the posed enemies.
  'viewmodel-crossbow': {
    equipWeaponId: 'crossbow',
    enemyOverrides: [
      { index: 0, pos: { x: 0, z: -8 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  'viewmodel-wand': {
    equipWeaponId: 'wand',
    enemyOverrides: [
      { index: 0, pos: { x: 0, z: -8 } },
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

  // Shrouded relics — the cursed mystery gamble. Three veiled relics
  // floating in violet light ahead of the player. Walk up + TAKE to
  // reveal which curse you bought. NOT frozen (the bob/rotate + grant
  // need to run). depth 6 so the deeper cursed items are eligible.
  shrouded: {
    playerPos: {
      x: 0, z: 1.0,
      lookAt: { x: 0, z: -2, y: 0.4 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -12, z: -12 } },
      { index: 1, pos: { x:  12, z: -12 } },
      { index: 2, pos: { x: -12, z:  12 } },
    ],
    spawnShrouded: [
      { x: -1.4, z: -1.6, depth: 6 },
      { x:  0.0, z: -2.0, depth: 6 },
      { x:  1.4, z: -1.6, depth: 6 },
    ],
  },

  // Pickup floor glow — one of each rarity on the ground in front of the
  // player so you can see the rarity-tinted disc + light at a glance.
  pickups: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 0.5,
      lookAt: { x: 0, z: -2, y: 0.3 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
    spawnPickups: [
      { itemId: 'rusted-sword',         x: -2.2, z: -1.5 }, // mundane (gray)
      { itemId: 'scimitar',             x: -1.1, z: -1.5 }, // uncommon (green)
      { itemId: 'ring-of-bloodthirst',  x:  0.0, z: -1.5 }, // rare (blue)
      { itemId: 'ring-of-frenzy',       x:  1.1, z: -1.5 }, // cursed (violet)
      { itemId: 'bone-amulet',          x:  2.2, z: -1.5 }, // rare (blue)
    ],
  },

  // Antechamber wraith — looking through the corridor at the boss.
  wraith: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 9,
      lookAt: { x: 0, z: 12.3, y: 1.0 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },     // ghoul out of the way
      { index: 1, pos: { x:  10, z: -10 } },     // skirmisher out of the way
      { index: 2, pos: { x: -10, z:  10 } },     // rat out of the way
      // wraith is index 3 — leave it where the level spec placed it.
    ],
  },

  // Wraith mid-windup so the magic eye flare reads.
  'wraith-windup': {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 10.5,
      lookAt: { x: 0, z: 12.3, y: 1.5 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
      { index: 3, pos: { x: 0, z: 12.3 }, state: 'winding', phaseTimer: 0.7 },
    ],
  },

  // Heartburn (fabled) lying on the floor — show off the fabled rarity
  // pickup glow.
  heartburn: {
    freeze: true,
    hideSword: true,
    playerPos: {
      // Stand right next to the dropped Heartburn so the in-range
      // pickup ring + outline are visible.
      x: 0, z: -0.7,
      lookAt: { x: 0, z: -1.5, y: 0.3 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
    spawnPickups: [
      { itemId: 'heartburn', x: 0, z: -1.5 },
    ],
  },

  // Inventory panel populated with a representative loadout — for the
  // paper-doll + stats + bag UI snap.
  inventory: {
    freeze: true,
    giveItems: [
      'iron-coif', 'bone-amulet', 'tattered-cloak', 'leather-gloves',
      'worn-boots', 'wooden-shield',
      'ring-of-vigor', 'ring-of-predation',
      'ring-of-bloodthirst', 'ring-of-frenzy',
      'scimitar',
      'healing-potion', 'healing-potion', 'berserk-potion',
    ],
    openInventoryPanel: true,
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },
  // Inventory panel with the violet-stoned (cursed) ring selected — shows
  // the details panel populated with name + rarity + flavor + modifiers.
  // ── Item viewer ─────────────────────────────────────────────────
  // One-row template — the actual item id is set via the &item=
  // URL param (snap.ts converts `item-<id>` into that automatically).
  // Empty 6×6 room; camera looks at the spin position (0, 1.4, 0)
  // from the south so the item rotates head-on. inspect:true gives
  // flat lighting; freeze halts world ticks but NOT the spin (the
  // spin runs off performance.now() in onBeforeRender).
  item: {
    inspect: true,
    freeze: true,
    hideSword: true,
    level: {
      id: 'dbg-item', depth: 1, displayName: 'item viewer', fogColor: 0x000000,
      startPos: { x: 0, z: 1.5, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [],
      spawns: [],
      doors: [], stairs: [],
    },
    // Camera close (~0.5m) so a ring fills the frame; large items
    // like a sword are necessarily bigger than the gameplay read but
    // that's an inspection trade. Slight 3/4 angle so the silhouette
    // has depth instead of reading head-on flat.
    playerPos: { x: 0.30, z: 0.40, y: 1.50, lookAt: { x: 0, z: 0, y: 1.4 } },
  },

  // ── HUD-only inspection scenarios ────────────────────────────────
  // Same setup as the gameplay-context scenarios above (give items,
  // damage the player, etc.) but with `hudOnly: true` so the 3D
  // canvas is hidden behind a flat backdrop — pure widget review.
  // snap.ts auto-applies hudOnly for any scenario named hud-*; the
  // explicit field here keeps the page reachable via the URL too.
  'hud-inventory': {
    freeze: true,
    hudOnly: true,
    giveItems: [
      'iron-coif', 'bone-amulet', 'tattered-cloak', 'leather-gloves',
      'worn-boots', 'wooden-shield',
      'ring-of-vigor', 'ring-of-predation',
      'ring-of-bloodthirst', 'ring-of-frenzy',
      'scimitar',
      'healing-potion', 'healing-potion', 'berserk-potion',
    ],
    openInventoryPanel: true,
  },
  // HP bar at one pip — verify the low-health red treatment + the
  // damage-flash decay. Damage applied at startup; freeze stops the
  // regen-tick from creeping it back up.
  'hud-hp-low': {
    freeze: true,
    hudOnly: true,
    damagePlayerBy: 7,
  },
  // Consumable hotbar with a healthy stack of potions — slot icons +
  // count badges + selected-slot indicator visible.
  'hud-hotbar': {
    freeze: true,
    hudOnly: true,
    giveItems: ['healing-potion', 'healing-potion', 'healing-potion', 'healing-potion', 'berserk-potion', 'berserk-potion'],
  },
  // Boss bar mid-fight. Spawns a boss in chasing state so the boss-
  // bar engagement check fires; doesn't damage it (the bar starts
  // full). Useful for verifying the bar layout + the name above it
  // + the intro card timing (NOT frozen — let the card play out).
  'hud-boss-bar': {
    hudOnly: true,
    level: {
      id: 'dbg-hud-boss', depth: 12, displayName: 'boss', fogColor: 0x080f05,
      startPos: { x: 0, z: 3.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 9, d: 9 }, height: 3.6 }],
      corridors: [],
      props: [],
      torches: [],
      spawns: [{ enemyId: 'boiling-king', x: 0, z: -1.5, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.5, lookAt: { x: 0, z: -1.5, y: 1.2 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.5 }, state: 'chasing' }],
  },

  'inventory-detail': {
    freeze: true,
    giveItems: [
      'iron-coif', 'bone-amulet', 'tattered-cloak', 'leather-gloves',
      'worn-boots', 'wooden-shield',
      'ring-of-vigor', 'ring-of-predation',
      'ring-of-bloodthirst', 'ring-of-frenzy',
      'scimitar', 'healing-potion', 'healing-potion', 'berserk-potion',
    ],
    openInventoryPanel: true,
    selectItemId: 'ring-of-bloodthirst',
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

  // Look at the NW corpse up close — verifies the slumped body model.
  corpse: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: -2.5, z: -2.5,
      lookAt: { x: -3.2, z: -3.2, y: 0.2 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // Look at the cursed fountain in the antechamber.
  fountain: {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: -1.0, z: 11.5,
      lookAt: { x: -2.0, z: 11.5, y: 0.85 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
      { index: 3, pos: { x:  10, z:  10 } },
    ],
  },

  // ── Procgen previews ────────────────────────────────────────────
  // One scenario per template in src/level/templates.ts. Each generates
  // the same template with a fixed seed so snaps are deterministic.
  // Use freeze:true for clean static screenshots.
  'procgen-1': {
    freeze: true,
    hideSword: true,
    level: generateFloor(1, 4242, 'depth-2'),  // template index 0
  },
  'procgen-2': {
    freeze: true,
    hideSword: true,
    level: generateFloor(2, 4242, 'depth-3'),  // template index 1
  },
  'procgen-3': {
    freeze: true,
    hideSword: true,
    level: generateFloor(3, 4242, 'depth-4'),  // template index 2
  },
  'procgen-4': {
    freeze: true,
    hideSword: true,
    level: generateFloor(4, 4242, 'depth-5'),  // template index 3
  },

  // Boiling King — Act III boss preview. Drops you in a small lit arena
  // with the king slime spawned mid-room. Verifies model scale, palette,
  // and boss bar engagement.
  'marrow-sovereign': {
    freeze: true,
    level: {
      id: 'dbg-marrow-sovereign', depth: 7, displayName: 'marrow sovereign', fogColor: 0x100806,
      startPos: { x: 0, z: 4.5, yaw: 0 },
      rooms: [{ id: 'ms-room', rect: { x: 0, z: 0, w: 10, d: 11 }, height: 10 }],
      corridors: [],
      props: [],
      torches: [
        { x: -4.95, z: -4.5, height: 2.4, wall: 'W', colorTint: 0xff6030, intensityMul: 0.9 },
        { x:  4.95, z: -4.5, height: 2.4, wall: 'E', colorTint: 0xff6030, intensityMul: 0.9 },
        { x: -4.95, z:  4.5, height: 2.4, wall: 'W', colorTint: 0xff6030, intensityMul: 0.9 },
        { x:  4.95, z:  4.5, height: 2.4, wall: 'E', colorTint: 0xff6030, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'marrow-sovereign', x: 0, z: -2, roomId: 'ms-room' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 3.0, lookAt: { x: 0, z: -2, y: 2.0 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -2 }, state: 'chasing' }],
  },

  'boiling-king': {
    freeze: true,
    level: {
      id: 'dbg-boiling-king', depth: 12, displayName: 'boiling king', fogColor: 0x080f05,
      startPos: { x: 0, z: 3.5, yaw: 0 },
      rooms: [{ id: 'bk-room', rect: { x: 0, z: 0, w: 9, d: 9 }, height: 3.6 }],
      corridors: [],
      props: [],
      torches: [
        { x: -4.45, z: -3.5, height: 2.4, wall: 'W', colorTint: 0x88ff44, intensityMul: 0.9 },
        { x:  4.45, z: -3.5, height: 2.4, wall: 'E', colorTint: 0x88ff44, intensityMul: 0.9 },
        { x: -4.45, z:  3.5, height: 2.4, wall: 'W', colorTint: 0x88ff44, intensityMul: 0.9 },
        { x:  4.45, z:  3.5, height: 2.4, wall: 'E', colorTint: 0x88ff44, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'boiling-king', x: 0, z: -1.5, roomId: 'bk-room' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.5, lookAt: { x: 0, z: -1.5, y: 1.2 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.5 }, state: 'chasing' }],
  },

  // Mob variety pass previews — small lit room with one mob spawned
  // mid-room, frozen, camera angled to catch the silhouette.
  'mob-plague-spore': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-spore', depth: 6, displayName: 'plague spore', fogColor: 0x080f05,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.0, z: -2.5, height: 2.2, wall: 'W', colorTint: 0xa8d870, intensityMul: 0.9 },
        { x:  3.0, z: -2.5, height: 2.2, wall: 'E', colorTint: 0xa8d870, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'plague-spore', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.5, lookAt: { x: 0, z: -1.0, y: 0.4 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  },
  'mob-sump-wisp': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-wisp', depth: 6, displayName: 'sump wisp', fogColor: 0x080a14,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.0, z: -2.5, height: 2.2, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.9 },
        { x:  3.0, z: -2.5, height: 2.2, wall: 'E', colorTint: 0x88aaff, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'sump-wisp', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.5, lookAt: { x: 0, z: -1.0, y: 1.0 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  },
  'mob-carrion-hound': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-hound', depth: 4, displayName: 'carrion hound', fogColor: 0x14100a,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.0, z: -2.5, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.0, z: -2.5, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'carrion-hound', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.5, lookAt: { x: 0, z: -1.0, y: 0.3 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  },

  // Mimic — three chests in a row, one of each tier, each one a
  // mimic. Lets us preview the disguise (chest sees-as-chest), the
  // subtle breathing tell, the reveal animation, and the mob model
  // post-reveal in one scenario. NOT frozen so you can walk up and
  // open them.
  'mob-mimic': {
    hideSword: false,
    level: {
      id: 'dbg-mimic', depth: 1, displayName: 'mimic', fogColor: 0x14100a,
      startPos: { x: 0, z: 4, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 9, d: 9 }, height: 3.2 }],
      corridors: [],
      props: [
        { kind: 'chest', x: -2.4, z: -1.5, rotY: 0, tier: 'supply', mimic: true },
        { kind: 'chest', x:  0.0, z: -1.5, rotY: 0, tier: 'iron',   mimic: true },
        { kind: 'chest', x:  2.4, z: -1.5, rotY: 0, tier: 'boss',   mimic: true },
      ],
      torches: [
        { x: -4.45, z: -3.5, height: 2.4, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  4.45, z: -3.5, height: 2.4, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x: -4.45, z:  3.5, height: 2.4, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  4.45, z:  3.5, height: 2.4, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.5, lookAt: { x: 0, z: -1.5, y: 0.3 } },
  },

  // Pit moth — small lit room with a single moth floating mid-room.
  // Used for silhouette + wing + eye-glow review.
  'mob-pit-moth': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-moth', depth: 6, displayName: 'pit moth', fogColor: 0x14100a,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.0, z: -2.5, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.0, z: -2.5, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'pit-moth', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.5, lookAt: { x: 0, z: -1.0, y: 1.5 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  },

  // Pit moth swarm — five moths in the same room to verify the
  // "swarm" silhouette read + that the noPlayerCollision lets the
  // player move through them.
  'mob-pit-moth-swarm': {
    level: {
      id: 'dbg-moth-swarm', depth: 6, displayName: 'pit moth swarm', fogColor: 0x14100a,
      startPos: { x: 0, z: 3.0, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -4.0, z: -3.5, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  4.0, z: -3.5, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x: -4.0, z:  3.5, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  4.0, z:  3.5, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [
        { enemyId: 'pit-moth', x: -1.5, z: -1.0, roomId: 'r' },
        { enemyId: 'pit-moth', x:  0.0, z: -1.5, roomId: 'r' },
        { enemyId: 'pit-moth', x:  1.5, z: -1.0, roomId: 'r' },
        { enemyId: 'pit-moth', x: -0.8, z: -2.2, roomId: 'r' },
        { enemyId: 'pit-moth', x:  0.8, z: -2.2, roomId: 'r' },
      ],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.5, lookAt: { x: 0, z: -1.5, y: 1.4 } },
  },

  // Burrower (buried) — verify the dirt-mound tell is visible on
  // the floor with the creature hidden below. Player stands far
  // enough away that the emerge doesn't fire mid-snap.
  'mob-burrower-buried': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-burrower-buried', depth: 6, displayName: 'burrower (buried)', fogColor: 0x14100a,
      startPos: { x: 0, z: 3.0, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 7, d: 7 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.5, z: -3.0, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.5, z: -3.0, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      // Burrower stays buried — playerPos sits at z=2.5, mob at
      // z=-1.0, distance 3.5m > triggerDistance 2.0m.
      spawns: [{ enemyId: 'burrower', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.5, lookAt: { x: 0, z: -1.0, y: 0.0 } },
  },

  // Burrower (emerged) — walk-in distance triggers the emerge.
  // hideSword off, NOT frozen, so the animation actually plays. Use
  // --frames=6 on this to capture the full emerge.
  'mob-burrower-emerging': {
    level: {
      id: 'dbg-burrower-emerging', depth: 6, displayName: 'burrower (emerging)', fogColor: 0x14100a,
      startPos: { x: 0, z: 1.5, yaw: 0 },   // ~2.5m from the burrower
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 7, d: 7 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.5, z: -3.0, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.5, z: -3.0, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'burrower', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    // Player just inside the trigger ring (2m), so emerge fires
    // immediately on world tick.
    playerPos: { x: 0, z: 0.8, lookAt: { x: 0, z: -1.0, y: 0.8 } },
  },

  // Lasher — stationary long-reach plant. Camera angled to catch
  // the bulb, the stalk, and the maw on the whip arm.
  'mob-lasher': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-lasher', depth: 6, displayName: 'lasher', fogColor: 0x14100a,
      startPos: { x: 0, z: 3.0, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 7, d: 7 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.5, z: -3.0, height: 2.2, wall: 'W', colorTint: 0xa8d870, intensityMul: 0.9 },
        { x:  3.5, z: -3.0, height: 2.2, wall: 'E', colorTint: 0xa8d870, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'lasher', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.0, lookAt: { x: 0, z: -1.0, y: 0.7 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  },

  // Mimic, frozen camera angle on the post-reveal mob — useful for
  // screenshotting the silhouette. Spawns a real mimic mob (not a
  // chest) so the toothy maw and legs are visible.
  'mob-mimic-revealed': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-mimic-revealed', depth: 4, displayName: 'mimic (revealed)', fogColor: 0x14100a,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.0, z: -2.5, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x:  3.0, z: -2.5, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'mimic', x: 0, z: -1.0, roomId: 'r' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.5, lookAt: { x: 0, z: -1.0, y: 0.2 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  },

  // Safe room — overview from the spawn end looking down the chamber
  // toward the hearth + descent. For verifying the V3 layout (smaller +
  // warmer + central brazier).
  'safe-room': {
    freeze: true,
    hideSword: true,
    level: generateSafeRoom(3),  // safe room after Act I (boss depth 3)
    playerPos: { x: 0, z: 4.0, lookAt: { x: 0, z: -2.0, y: 0.8 } },
  },

  // TEMP: cobweb-gate verification (the captured d4 seed → encounter-nest
  // in vault-1). Player in the alcove looking south through the 2-wide web
  // gate. Confirms no wall-face stands in the doorway + the opening reads
  // wide enough to walk through.
  'cobweb-gate-repro': {
    freeze: true,
    hideSword: true,
    level: generateFloor(4, 1780177907387, 'depth-5'),
    playerPos: { x: 1.0, z: 7.4, lookAt: { x: 1.0, z: 9.0, y: 1.0 } },
  },

  // Mid-corridor looking down at the spike trap plate.
  'spike-trap': {
    freeze: true,
    hideSword: true,
    playerPos: {
      x: 0, z: 6.2,
      lookAt: { x: 0, z: 7.0, y: -0.02 },
    },
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
      { index: 3, pos: { x:  10, z:  10 } },
    ],
  },
};

// ── Vault inspector previews (DEV only) ─────────────────────────────────
// One scenario per vault — `?scenario=vault-<id>` (snap: `npm run snap
// vault-<id>`). Builds the single vault with its REAL treatment (ceiling
// style via ceilingFor, wallVariant, voids) and frames it from an elevated
// interior camera, so authored geometry can be inspected directly instead of
// walking a whole floor hunting for the room. DEV-gated so it never runs (or
// bloats) the production bundle.

/** Build a single-vault preview LevelSpec by vault id, or null if unknown.
 *  Delegates to the composer's faithful per-vault build (resolves X enemies,
 *  expands prop groups, resolves facings) so previews + piloting match what
 *  the room is in-game. The freeze lives on the SCENARIO, not the spec, so the
 *  same spec loads frozen (inspector snap) or unfrozen (pilot). */
export function buildVaultPreviewLevel(id: string): LevelSpec | null {
  return buildVaultPreview(id);
}

if (import.meta.env.DEV) {
  for (const v of VAULTS) {
    const innerD = Math.max(0, v.map.length - 2);
    SCENARIOS[`vault-${v.id}`] = {
      freeze: true,
      hideSword: true,
      inspect: true,
      level: buildVaultPreview(v.id) ?? undefined,
      // Elevated interior view from the south edge, looking north across the
      // room — shows floor layout, walls, the ceiling underside, and any void.
      playerPos: { x: 0, z: innerD / 2 - 0.5, y: 2.3, lookAt: { x: 0, z: 0, y: 1.3 } },
    };
    // Palette / pass demo: re-snap each vault at depth=1 (Act I's
    // sparse-amber palette) so the procedural lighting pass output
    // is visible. Compare `palette-<id>` vs `vault-<id>` to see what
    // the cascade added.
    SCENARIOS[`palette-${v.id}`] = {
      freeze: true,
      hideSword: true,
      inspect: true,
      level: buildVaultPreview(v.id, 1) ?? undefined,
      playerPos: { x: 0, z: innerD / 2 - 0.5, y: 2.3, lookAt: { x: 0, z: 0, y: 1.3 } },
    };
  }
}

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
  const inspectOverride = params.get('inspect');
  const hudOnlyOverride = params.get('hudOnly');
  let result: Scenario = base;
  if (freezeOverride !== null) {
    result = { ...result, freeze: freezeOverride === 'true' };
  }
  if (inspectOverride !== null) {
    result = { ...result, inspect: inspectOverride === 'true' };
  }
  if (hudOnlyOverride !== null) {
    result = { ...result, hudOnly: hudOnlyOverride === 'true' };
  }
  const itemOverride = params.get('item');
  if (itemOverride) {
    result = { ...result, previewItemId: itemOverride };
  }
  const subjectOnlyOverride = params.get('inspectSubjectOnly');
  if (subjectOnlyOverride !== null) {
    result = { ...result, inspectSubjectOnly: subjectOnlyOverride === 'true' };
  }
  return result;
}

export function applyScenario(
  scenario: Scenario,
  ctx: { level: LiveLevel; weapon: WeaponViewmodel; camera: THREE.Camera },
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
    ctx.weapon.group.visible = false;
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
    ctx.weapon.setDebugPhase(scenario.swordPhase.phase, scenario.swordPhase.phaseTimer);
  }

  // Equip BEFORE triggerDeath so the death sequence sees the held weapon
  // (the on-death hand-drop reads the equipped weapon at the instant of
  // death) — and so generally "you die holding your gear".
  if (scenario.equipWeaponId) {
    const item = ITEMS[scenario.equipWeaponId];
    if (item) {
      // Use the equipment system so viewmodel + stats both update via the
      // main.ts listener — same code path as a real pickup.
      setSlot('weapon', item);
    }
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

  if (scenario.giveItems) {
    for (const id of scenario.giveItems) {
      const item = ITEMS[id];
      if (!item) continue;
      addItem(id);
      // Auto-equip anything that has a slot (weapons go through equipFromInventory
      // since they always swap; the rest auto-equip into an empty matching slot).
      if (item.kind !== 'consumable' && item.kind !== 'weapon') {
        if (tryAutoEquip(item)) removeItem(id);
      }
    }
  }

  if (scenario.spawnPickups) {
    const scene = ctx.camera.parent as THREE.Scene;
    for (const p of scenario.spawnPickups) {
      const item = ITEMS[p.itemId];
      if (!item) continue;
      createPickup(scene, new THREE.Vector3(p.x, 0, p.z), item);
    }
  }

  if (scenario.spawnShrouded) {
    const scene = ctx.camera.parent as THREE.Scene;
    for (const s of scenario.spawnShrouded) {
      spawnShroudedRelic(scene, new THREE.Vector3(s.x, 0, s.z), s.depth ?? 5);
    }
  }

  if (scenario.openInventoryPanel) {
    openInventoryPanel();
  }
  if (scenario.selectItemId) {
    selectBagItem(scenario.selectItemId);
  }
  if (scenario.openCharacterScreen) {
    openCharacterScreen();
  }

  // ── Item viewer ───────────────────────────────────────────────────
  // Float the item's dropModel at (0, 1.4, 0) and slowly rotate it
  // around Y so a single snap captures the silhouette and a frames-
  // grid (`npm run snap item-<id> --frames=8 --duration=4`) captures
  // a full 360° turn. Auto-pair with inspect:true on the scenario
  // for the flat-lit backdrop. onBeforeRender drives the spin from
  // performance.now() so a frozen world doesn't stop the rotation
  // (we want freeze:true to halt mob/world ticks, NOT the preview).
  if (scenario.previewItemId) {
    const item = ITEMS[scenario.previewItemId];
    if (item && item.dropModel) {
      const built = buildModel(item.dropModel);
      built.group.position.set(0, 1.4, 0);
      // Tag for inspect mode — main.ts hides level siblings (walls,
      // floor, decor) but keeps anything tagged inspectSubject.
      built.group.userData.inspectSubject = true;
      const startMs = performance.now();
      built.group.onBeforeRender = () => {
        const elapsed = (performance.now() - startMs) / 1000;
        built.group.rotation.y = elapsed * 0.6;  // ~57°/s — full turn ≈ 6.3s
      };
      ctx.level.root.add(built.group);
    } else if (!item) {
      // eslint-disable-next-line no-console
      console.warn(`Unknown previewItemId: ${scenario.previewItemId}`);
    }
  }

  if (scenario.freeze) {
    setWorldFrozen(true);
  }
}
