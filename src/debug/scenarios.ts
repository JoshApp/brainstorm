import * as THREE from 'three';
import { ceilingFor, generateRoomShape, type Archetype } from '../level/room-shape';
import { polyRoomRect } from '../level/poly-room-shell';
import type { LevelSpec, EnemySpawnSpec, TorchSpec } from '../level/types';
import { buildElevationLab } from '../level/test-chambers';
import type { LiveLevel } from '../level/builder';
import type { WeaponViewmodel, SwingPhase } from '../player/viewmodel';
import { triggerDeath } from '../player/death';
import { setCameraYaw } from '../controls/camera';
import { setWorldFrozen } from './freeze';
import { generateFloor } from '../level/procgen';
import { generateSafeRoom } from '../level/safe-room';
import { buildStarterChamber } from '../level/starter-chamber';
import { ENEMIES } from '../content/enemies';
import { listMobs, listWeapons, listItems } from './authorables';
import { debugUseAll, debugTickAll } from '../interactables/system';
import { damagePlayer, setGodMode } from '../player/health';
import { setArenaEnemiesInvincible } from './arena-mode';
import { get as getEntity } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { ITEMS } from '../content/items';
import { BONFIRE } from '../content/bonfire';
import { buildModel } from '../ecs/build-model';
import { interpSync } from '../engine/render-interp';
import { setSlot, tryAutoEquip, setSidearm } from '../player/equipment';
import { addItem, removeItem } from '../player/inventory';
import { createPickup } from '../interactables/pickup';
import { spawnCardDrop } from '../interactables/card-drop';
import { spawnShroudedRelic } from '../interactables/shrouded-relic';
import { spawnGateOffering } from '../interactables/gate-offering';
import { spawnOfferingGroup } from '../interactables/offering';
import { grantEmber } from '../player/ember';
import type { ItemSpec } from '../content/items';
import { spawnChest } from '../interactables/chest';
import { openInventoryPanel, selectBagItem, selectRelicItem } from '../ui/inventory-panel';
import { openForgeSheetForDebug } from '../interactables/blacksmith';
import { grantGold } from '../state/run-state';
import { openCharacterScreen } from '../ui/character-screen';
import { buildItemCard } from '../ui/item-card';
import { itemFraming, applyDomainFrame } from '../ui/item-framing';
import { THEME } from '../ui/theme';
import { debugPlayAcquisitionBeat } from '../ui/acquisition-beat';
import { addRelic } from '../player/reliquary';

// DEV-only endless-sparring dummies for the gore-arena scenario. Each splits
// into the OTHER on death, so killing one respawns the next forever — and it
// alternates FLESH (ghoul: topple → melt into floor) with BONE (skeleton:
// crumble into debris), both severable, so every death effect is testable in a
// loop. Registered here (DEV) so they never reach the shipped enemy pool.
if (import.meta.env.DEV) {
  ENEMIES['arena-flesh'] = {
    ...ENEMIES.ghoul, id: 'arena-flesh', name: 'arena flesh', hp: 5,
    splitsInto: { enemyId: 'arena-bone', count: 1, radius: 0.4 },
  };
  ENEMIES['arena-bone'] = {
    ...ENEMIES.skeleton, id: 'arena-bone', name: 'arena bone', hp: 5,
    splitsInto: { enemyId: 'arena-flesh', count: 1, radius: 0.4 },
  };
}

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
  /** DEV: make the player invulnerable at startup (training/combat arenas). */
  godMode?: boolean;
  /** DEV: enemies never die (HP floors at 1) — endless sparring partners.
   *  Hit flash / poise / stagger / aggro all still fire. */
  enemiesInvincible?: boolean;
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
    /** Jump a multi-phase boss to this 0-based phase (settled pose, no
     *  collapse animation) — for snapping phase 2 (crawl) without grinding
     *  phase 1 down in combat. */
    bossPhase?: number;
    /** Impose FEAR for this many seconds through the REAL applyFear path — so
     *  the pose exercises the actual mechanism (rout → skull) instead of a
     *  hand-set state that only looks like it. */
    fear?: number;
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
  /** Several statuses at once, with stack counts — for posing the buff HUD.
   *  `stacks` re-applies the buff that many times, which is exactly what the
   *  game does, so the stack cap in the spec still binds. */
  applyPlayerBuffs?: Array<{ id: string; duration: number; stacks?: number }>;
  /** Equip a weapon by item id at startup (so snaps can show different viewmodels). */
  equipWeaponId?: string;
  /** Sheathe an alternate weapon by id (shows the loadout swap chip — #96). */
  sidearmId?: string;
  /** Add items to inventory and auto-equip rings/armor (for inventory-panel snaps). */
  giveItems?: string[];
  /** Programmatically open the inventory panel for the snap. */
  openInventoryPanel?: boolean;
  /** Open the blacksmith's forge sheet (temper + the scar offer) for the snap. */
  openForge?: boolean;
  /** Purse the delver starts the scenario with — so a shop sheet's action bar
   *  snaps in its AFFORDABLE state rather than greyed out. */
  giveGold?: number;
  /** Which tab the panel opens on (default 'gear'). */
  inventoryTab?: 'gear' | 'reliquary' | 'character' | 'codex' | 'settings';
  /** Pre-select an inventory item id so the details panel shows on snap. */
  selectItemId?: string;
  /** Select a collected relic in the RELIQUARY tab (snap scenarios). */
  selectRelicId?: string;
  /** Open the character sheet (for UI snaps). */
  openCharacterScreen?: boolean;
  /** Grant N points of EMBER (borrowed life) at startup — the temporary layer
   *  that absorbs damage before real health. */
  giveEmber?: number;
  /** Fill both weapon slots, then open the ground-equip SWAP-OR-LEAVE compare
   *  with a third found weapon (for snapping the equip-compare screen). */
  equipCompare?: boolean;
  /** Stand a TROVE up in front of the player — N offerings on plinths (or on the
   *  ground), take one and the rest withdraw. `cost` prices the whole group. */
  trove?: {
    itemIds: string[];
    style?: 'pedestal' | 'ground';
    /** Price for any pick: gold amount, or an item id (a key). */
    gold?: number;
    itemId?: string;
    /** Metres in front of the player the row is centred. Default 3.2. */
    dist?: number;
    /** Metres between plinths. Default 1.6. */
    spacing?: number;
  };
  /** Spawn pickups on the floor near the camera (for rarity-glow snaps). */
  spawnPickups?: Array<{ itemId: string; x: number; z: number }>;
  /** RAW PointLights added straight to the scene, BYPASSING the light pool —
   *  the lighting-node benchmark's tool: the pool caps bound lights at its
   *  slot budget, but perf-lights needs the lighting node itself to see N
   *  lights. DEV-scenario only; never use for real content (the pool is the
   *  director for a reason). */
  rawPointLights?: Array<{ x: number; y: number; z: number; color: number; intensity: number; distance: number; decay: number }>;
  /** Spawn fate-card drops on the floor near the camera (major-from-corpse). */
  spawnCards?: Array<{ cardId: string; x: number; z: number }>;
  /** Spawn shrouded relics (the cursed mystery gamble) near the camera. */
  spawnShrouded?: Array<{ x: number; z: number; depth?: number }>;
  /** Spawn a GATE OFFERING + chests sealed behind it (#74 event-gating test). */
  gatedLoot?: { gate: { x: number; z: number }; chests: Array<{ x: number; z: number }> };
  /**
   * Item viewer: float a single item's dropModel at eye level in front
   * of the camera, slowly rotating. For previewing weapon/armor/ring
   * geometry without committing it to inventory + squinting at the
   * tiny icon. Combine with inspect:true for flat lighting + clean
   * background. The URL param ?item=<id> overrides this so a single
   * 'item' scenario row can serve every item via snap arg.
   */
  previewItemId?: string;

  /**
   * Domain-framing showcase: render the FULL floating item-card (name, effects,
   * plus the domain frame/wash/watermark from ui/item-framing.ts) for each item
   * id as a fixed DOM grid over a black scrim. A deterministic snap fixture for
   * verifying the domain-framed preview treatment without needing an in-range
   * interactable. DEV only.
   */
  frameShowcase?: string[];

  /**
   * Acquisition-beat showcase: re-fire the living acquisition beat (fly-to-satchel
   * + domain flood + the deep's remark) for this item on a loop, so a snap catches
   * the flood/pop/chip mid-flight. DEV only.
   */
  acquireBeat?: string;

  /** Open the bug-report sheet on apply — verifies the frame-capture screenshot
   *  renders (not black on WebGPU). DEV only. */
  openBugReport?: boolean;

  /** Collapse every bonfire in the level to its CLAIMED/spent look on apply
   *  (fate-fire.debugSpendFlames), to snap the "already taken" read. DEV only. */
  spendFire?: boolean;

  /** Open the fate card reading and auto-claim on a loop, to snap the diegetic
   *  claim beat (card ignites + is drawn in + the deep speaks). DEV only. */
  cardClaimLoop?: boolean;

  /** Show this text through the READING channel (inscription.ts) on apply, to
   *  snap the register. DEV only. */
  inscription?: string;
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

/** Evenly space a list of enemy kinds around a ring at `radius` from the
 *  room centre — the combat-arena layout (you stand in the middle, they
 *  surround you). Repeats the kind list to fill `count` if needed. */
function ringSpawns(roomId: string, kinds: string[], radius: number): EnemySpawnSpec[] {
  const out: EnemySpawnSpec[] = [];
  const n = kinds.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ enemyId: kinds[i], x: Math.sin(a) * radius, z: Math.cos(a) * radius, roomId });
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

// ── Parameterized perf scenarios (the A/B isolation scenes) ──────────
// Unlike the static perf-* scenarios below (which throw "everything at
// once" at the runner), these isolate ONE cost and take a count via URL
// param, so `npm run perf:ab perf-creatures phone n=8 n=16` reads off the
// per-unit cost from the delta. Resolved by name in getScenarioFromUrl
// BEFORE the static SCENARIOS map, with the live URLSearchParams in hand.

/** perf-creatures: N creatures of one kind in an empty, TORCHLESS room (only
 *  the player lamp lights it) — isolates creature draw/tri cost + the lamp's
 *  shadow pass over them, with zero torch/projectile noise. `?n=`, `?kind=`. */
function buildCreaturesScenario(params: URLSearchParams): Scenario {
  const n = Math.max(1, Math.min(64, Number(params.get('n') ?? '16') || 16));
  const kindParam = params.get('kind') ?? 'ghoul';
  const kind = ENEMIES[kindParam] ? kindParam : 'ghoul';
  const half = 11;
  return {
    level: {
      id: 'perf-creatures', depth: 5, displayName: 'PERF creatures', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: half + 3, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: (half + 3) * 2, d: (half + 3) * 2 }, height: 4.5 }],
      corridors: [], props: [], torches: [],
      spawns: gridSpawns('r', n, half, [kind]),
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: half + 3, lookAt: { x: 0, z: 0, y: 1.0 } },
  };
}

/** perf-items: a tight overlapping PILE of N ground pickups, no enemies, no
 *  torches — isolates the per-item draw cost + the additive disc/ring overdraw
 *  where they stack. `?n=` (pile size), `?item=` (which item). */
function buildItemsScenario(params: URLSearchParams): Scenario {
  const n = Math.max(1, Math.min(64, Number(params.get('n') ?? '12') || 12));
  const itemParam = params.get('item') ?? 'rusted-sword';
  const itemId = ITEMS[itemParam] ? itemParam : (Object.keys(ITEMS)[0] ?? 'rusted-sword');
  // Sunflower (golden-angle) spiral, deliberately tight so the discs OVERLAP —
  // overdraw is the cost we're hunting, and it only shows when they stack.
  const pickups: Array<{ itemId: string; x: number; z: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996323;
    const r = 0.16 * Math.sqrt(i);
    pickups.push({ itemId, x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return {
    level: {
      id: 'perf-items', depth: 5, displayName: 'PERF items', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 2.5, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 10, d: 10 }, height: 3.5 }],
      corridors: [], props: [], torches: [], spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 2.5, lookAt: { x: 0, z: 0, y: 0.1 } },
    spawnPickups: pickups,
  };
}

/** perf-lights: the LIGHTING-NODE benchmark. One big room, N raw PointLights
 *  in a ceiling grid (BYPASSING the pool's slot cap — the node must see all N),
 *  frozen world, camera overlooking the floor. Compare configs by URL:
 *    ?scenario=perf-lights&n=30              (default clustered Forward+)
 *    ?scenario=perf-lights&n=30&clustered=0  (tiled fallback loop)
 *  Measure the median render+compute GPU ms (window.__renderer +
 *  resolveTimestampsAsync, or scripts driving real Chrome). */
function buildLightBenchScenario(params: URLSearchParams): Scenario {
  const n = Math.max(1, Math.min(64, Number(params.get('n') ?? '14') || 14));
  const half = 10;   // 20×20 room — several fog-lengths of lit floor
  const lights: NonNullable<Scenario['rawPointLights']> = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const span = cols > 1 ? cols - 1 : 1;
  for (let i = 0; i < n; i++) {
    const x = ((i % cols) / span - 0.5) * 2 * (half - 1);
    const z = (Math.floor(i / cols) / span - 0.5) * 2 * (half - 1);
    // Torch-like: same color/intensity/falloff as CONFIG's torch pools.
    lights.push({ x, y: 2.2, z, color: 0xffaa55, intensity: 48, distance: 11, decay: 2 });
  }
  return {
    level: {
      id: 'perf-lights', depth: 5, displayName: 'PERF lights', fogColor: 0x000000,
      startPos: { x: 0, z: half - 1.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: half * 2, d: half * 2 }, height: 4.0 }],
      corridors: [], props: [], torches: [], spawns: [], doors: [], stairs: [],
    },
    // Explicit yaw 0 = face −Z (into the room), slight down-pitch for more lit
    // floor in frame. (lookAt lost a fight with startPos yaw here — explicit
    // angles are unambiguous.)
    playerPos: { x: 0, z: half - 1.5, yaw: 0, pitch: -0.14 },
    freeze: true,   // deterministic: no flicker/AI — the light count is the only variable
    rawPointLights: lights,
  };
}

/** Perf scenarios that need the live URL params (a count, a kind) to build.
 *  getScenarioFromUrl resolves these before the static SCENARIOS map. */
// ?scenario=threat&enemy=<id> — a single killable foe dead ahead, no god/no
// invincibility. The harness threat probe (window.__sim.threatProbe) drives a
// passive punching-bag player here to measure RAW enemy offense (time-to-kill,
// DPS) per enemy type, swept across seeds. DEV-only.
function buildThreatScenario(params: URLSearchParams): Scenario {
  const enemy = params.get('enemy') ?? 'skeleton';
  return {
    level: {
      id: 'dbg-threat', depth: 3, displayName: 'THREAT PROBE', fogColor: 0x0c0c12,
      startPos: { x: 0, z: 0, yaw: Math.PI },
      rooms: [{ id: 'threat', rect: { x: 0, z: 0, w: 14, d: 14 }, height: 4.5 }],
      corridors: [],
      props: [],
      torches: [
        { x: -6.8, z: 0, height: 2.6, wall: 'W', colorTint: 0xffb066, intensityMul: 1.3 },
        { x:  6.8, z: 0, height: 2.6, wall: 'E', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: 0, z: -6.8, height: 2.6, wall: 'N', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: 0, z:  6.8, height: 2.6, wall: 'S', colorTint: 0xffb066, intensityMul: 1.3 },
      ],
      spawns: [{ enemyId: enemy, x: 0, z: -3.2, roomId: 'threat' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0, lookAt: { x: 0, z: -3.5, y: 1.2 } },
  };
}

// ?scenario=ai-lab[&mob=rat][&count=3] — the AI dissection bench. A clean, evenly
// lit open arena: player centred + INVULNERABLE, mobs INVINCIBLE (endless
// observation), the mob-AI readout + in-world facing gizmos auto-on (red=facing,
// green=velocity, blue=desired-face → see jitter spatially). Freeze + frame-step
// via window.__sim to inspect a tick at a time. DEV-only.
function buildAiLabScenario(params: URLSearchParams): Scenario {
  const mob = params.get('mob') ?? 'rat';
  const count = Math.max(1, Math.min(12, parseInt(params.get('count') ?? '1', 10) || 1));
  const spawns: EnemySpawnSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Fan them in an arc in front so they read individually as they close in.
    const a = count > 1 ? (i / (count - 1) - 0.5) * 1.7 : 0;
    const r = 4.5;
    spawns.push({ enemyId: mob, x: Math.sin(a) * r, z: -Math.cos(a) * r, roomId: 'lab' });
  }
  // Even perimeter light so the bodies read (the gizmos draw over everything).
  const spots: Array<[number, number, TorchSpec['wall']]> = [
    [-9, 0, 'W'], [9, 0, 'E'], [0, -9, 'N'], [0, 9, 'S'],
    [-9, -6, 'W'], [9, -6, 'E'], [-9, 6, 'W'], [9, 6, 'E'],
  ];
  const torches: TorchSpec[] = spots.map(([x, z, wall]) => ({
    x, z, wall, height: 2.6, colorTint: 0xffc27a, intensityMul: 1.15,
  }));
  return {
    level: {
      id: 'ai-lab', depth: 2, displayName: 'AI LAB', fogColor: 0x0e0e14,
      startPos: { x: 0, z: 0, yaw: Math.PI },
      rooms: [{ id: 'lab', rect: { x: 0, z: 0, w: 20, d: 20 }, height: 5 }],
      corridors: [], props: [],
      torches,
      spawns, doors: [], stairs: [],
    },
    godMode: true,
    enemiesInvincible: true,
    playerPos: { x: 0, z: 0, lookAt: { x: 0, z: -4, y: 1.2 } },
  };
}

const PERF_FACTORIES: Record<string, (params: URLSearchParams) => Scenario> = {
  'perf-creatures': buildCreaturesScenario,
  'perf-items': buildItemsScenario,
  'perf-lights': buildLightBenchScenario,
  'threat': buildThreatScenario,
  'ai-lab': buildAiLabScenario,
};

/**
 * A single generated polygon room you can walk around in, for judging a shape
 * from the inside. Torches are placed on the bounding box's mid-walls rather
 * than on the polygon, which is crude — but a lit room is the point, and torch
 * placement against arbitrary edges is the generator's job, not the preview's.
 */
function polyRoomScenario(kind: Archetype, wear?: number): Scenario {
  // A ruined room's collapsed patch goes on its LONGEST wall, and the default
  // viewpoint looks down the long axis — which puts that wall behind you, at
  // eleven metres, in the dark. Turn round and stand four metres off it: this
  // scenario exists to look at masonry, and masonry has to be within the lamp.
  const ruined = wear !== undefined;
  const rand = mulberryFor(kind);
  const w = 13 + rand() * 4;
  const d = 11 + rand() * 4;
  const poly = generateRoomShape(kind, { w, d, rand });
  const rect = polyRoomRect(poly);
  const ceil = ceilingFor(kind, w, d, rand());
  const T = (x: number, z: number, wall: 'N' | 'S' | 'E' | 'W') =>
    ({ x, z, height: 2.4, wall, colorTint: 0xffaa55, intensityMul: 1.15 });
  return {
    godMode: true,
    level: {
      id: `dbg-poly-${kind}`, depth: 3, displayName: kind.toUpperCase(), fogColor: 0x0c0c12,
      startPos: ruined
        ? { x: rect.x, z: rect.z + rect.d / 2 - 6.5, yaw: Math.PI }
        : { x: rect.x, z: rect.z + rect.d / 2 - 1.6, yaw: 0 },
      rooms: [{
        id: `poly-${kind}`, rect, height: ceil.height, poly, wear,
        ceilingStyle: ceil.style, ceilingRise: ceil.rise,
      }],
      corridors: [],
      props: [],
      spawns: [],
      // Eight torches, not four — a polygon room is wider than a rect one at the
      // corners, and the point of the scenario is to SEE the shape. Brighter
      // than the game's doctrine allows on purpose; this is a fitting room.
      torches: [
        T(rect.x - rect.w / 2 + 0.4, rect.z - rect.d * 0.25, 'W'),
        T(rect.x - rect.w / 2 + 0.4, rect.z + rect.d * 0.25, 'W'),
        T(rect.x + rect.w / 2 - 0.4, rect.z - rect.d * 0.25, 'E'),
        T(rect.x + rect.w / 2 - 0.4, rect.z + rect.d * 0.25, 'E'),
        T(rect.x - rect.w * 0.25, rect.z - rect.d / 2 + 0.4, 'N'),
        T(rect.x + rect.w * 0.25, rect.z - rect.d / 2 + 0.4, 'N'),
        T(rect.x - rect.w * 0.25, rect.z + rect.d / 2 - 0.4, 'S'),
        T(rect.x + rect.w * 0.25, rect.z + rect.d / 2 - 0.4, 'S'),
      ],
      doors: [], stairs: [],
    },
    // Stand just inside the near wall looking down the room's long axis, so the
    // first thing you see is the far wall and the shape between here and there.
    playerPos: ruined
      ? {
        x: rect.x, z: rect.z + rect.d / 2 - 6.5,
        lookAt: { x: rect.x, z: rect.z + rect.d / 2, y: 1.4 },
      }
      : {
        x: rect.x, z: rect.z + rect.d / 2 - 1.6,
        lookAt: { x: rect.x, z: rect.z - rect.d / 2, y: 1.4 },
      },
  };
}

/** Stable per-archetype seed so a given scenario is the same room every time. */
function mulberryFor(kind: string): () => number {
  let a = 0;
  for (let i = 0; i < kind.length; i++) a = (a * 31 + kind.charCodeAt(i)) | 0;
  a = (a + 0x6d2b79f5) | 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENARIOS: Record<string, Scenario> = {
  // ── THE BEAUTY CORNER — the control variable for art direction ────────────
  //
  // Josh: *"a small section like a scene ... and then we kinda rapidly
  // prototype against it since you can screenshot and snap etc."*
  //
  // This is that scene, and the ONE rule about it is that IT NEVER CHANGES.
  // Comparing two looks is only meaningful if everything except the look is
  // held still, so the moment someone "improves" the corner, every sheet shot
  // before that moment becomes incomparable. Change the presets, not this.
  //
  // It holds one of everything a look has to survive, because a style that
  // flatters a bare wall and falls apart on a creature is not a style:
  //
  //   · lit stone AND unlit stone (the value range the whole look rides on)
  //   · a framed doorway — the silhouette shape the game repeats most
  //   · a torch (warm, saturated — the "rhetoric" light) and a dark corner
  //   · a destructible + a chest: small forms, the ones that go to mush first
  //   · two creatures, one ABSORBED and one PAINTED (docs/VISUAL-LANGUAGE.md)
  //   · the viewmodel — it is a third of the frame on a phone and gets
  //     forgotten in every screenshot that isn't a real gameplay pose
  //
  // Frozen and posed from a standing eye at a slight down-pitch: the shot is
  // the shot the player actually gets, not a beauty angle no one will ever see.
  // Sister to look-lab, with a real ENCOUNTER standing in it. The reveal-ratio
  // experiment needs many creatures at once, and it needs them to be the
  // ACTUAL mobs — the lab's capsule stand-ins cannot answer whether a ghoul
  // reads as absorbed when a ghoul is the shape doing the reading.
  // THE READABLE BAND IS 1.5–7 METRES, and the first version of this scenario
  // ignored it. A 16×18 room with the camera at the south wall put every one of
  // ten creatures 8.4–15.7 m out; FOG_FAR is 9 and CAMERA_FAR is 10, so the
  // roster was inside the fog wall or clipped by the far plane outright. The
  // contact sheet came back as four identical empty rooms, which reads as "these
  // styles are indistinguishable" rather than "nothing was in frame" — the most
  // expensive kind of wrong. `window.__mobs()` exists now to catch exactly that
  // (it reports NDC + distance per creature); check it before believing a sheet.
  //
  // Restaged: a 9×10 room, camera 0.6 m off the south wall, three ranks at
  // ~2.6 / ~4.4 / ~6.2 m — near, mid, and just-before-the-fog. That spread IS
  // the experiment: a reveal mode has to survive falloff, not just look good at
  // arm's length.
  'look-mob': {
    level: {
      id: 'look-mob', depth: 3, displayName: 'MOB LAB', fogColor: 0x0a0a0c,
      startPos: { x: 0, z: 4.4, yaw: 0 },
      rooms: [{ id: 'lab', rect: { x: 0, z: 0, w: 9, d: 10 }, height: 4.0 }],
      corridors: [], props: [],
      // Close to the ranks on purpose — at the old 8 m standoff the torches lit
      // nothing but their own wall.
      torches: [
        { x: -4.4, z: 1.5, wall: 'W', height: 2.6, colorTint: 0xff9a40, intensityMul: 1.2 },
        { x: 4.4, z: -1.5, wall: 'E', height: 2.6, colorTint: 0x6690c0, intensityMul: 0.8 },
      ],
      // Order matters: the reveal ratio assigns modes BY INDEX (see dev-hooks),
      // and a ratio like 6:2:1:1 hands the last indices to the ACCENTS. So the
      // array is ordered by mode-group, not by position: indices 0–5 (the
      // absorbed majority) flank, and the accents at 6–9 land centre-near,
      // centre-far and mid — spread across depth instead of bunched on one side.
      // `dormant` on every spawn: no perception, no movement, no idle scan. The
      // sheet forces ?freeze=false, so without this the whole rank charges the
      // camera during the 1.6 s settle and the staging is gone.
      spawns: [
        { enemyId: 'ghoul', x: -1.4, z: 1.8, dormant: true },      // 0 near-left
        { enemyId: 'skirmisher', x: -2.5, z: 0.0, dormant: true }, // 1 mid-left
        { enemyId: 'spider', x: -2.0, z: -1.8, dormant: true },    // 2 far-left
        { enemyId: 'ghoul', x: 2.5, z: 0.0, dormant: true },       // 3 mid-right
        { enemyId: 'maggot', x: 2.0, z: -1.8, dormant: true },     // 4 far-right
        { enemyId: 'rat', x: 1.4, z: 1.8, dormant: true },         // 5 near-right
        // The two bone accents are deliberately a NEAR/FAR PAIR of the same
        // creature: whatever a reflected mob does at 3 m it has to still do at
        // 6.4 m, and one cell showing both is the only way to see that.
        { enemyId: 'skeleton', x: 0.0, z: 1.8, dormant: true },    // 6 near-centre
        { enemyId: 'skeleton', x: 0.0, z: -1.8, dormant: true },   // 7 far-centre
        { enemyId: 'acolyte', x: -0.9, z: 0.0, dormant: true },    // 8 mid-centre-L
        { enemyId: 'rat', x: 0.9, z: 0.0, dormant: true },         // 9 mid-centre-R
      ],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 4.4, yaw: 0, pitch: -0.10 },
    // The sword is identical in all four cells and covers the lower third. It
    // is not the art direction under test, so it goes; the LANTERN stays,
    // because the lamp is the baseline every reveal mode is judged against.
    hideSword: true,
    freeze: true, godMode: true, enemiesInvincible: true,
  },

  'look-lab': {
    level: {
      id: 'look-lab', depth: 3, displayName: 'LOOK LAB', fogColor: 0x0a0a0c,
      startPos: { x: 0, z: 7.4, yaw: 0 },
      rooms: [
        { id: 'lab', rect: { x: 0, z: 0, w: 14, d: 16 }, height: 4.6 },
        // The room BEYOND the doorway — so the frame has a lit near field, a
        // dark threshold, and something faintly readable past it. That depth
        // sandwich is where a fog colour either sings or dies.
        { id: 'beyond', rect: { x: 0, z: -13, w: 8, d: 10 }, height: 4.0 },
      ],
      corridors: [{ id: 'link', rect: { x: 0, z: -8.2, w: 2.6, d: 3.0 }, height: 3.0 }],
      props: [
        { kind: 'vase', x: -2.6, z: 1.4 },
        { kind: 'vase', x: -3.4, z: 0.2 },
        { kind: 'chest', x: 3.2, z: 0.4, rotY: -0.5, tier: 'wood' },
      ],
      torches: [
        // ONE warm source, off to one side. A centred pair flattens everything
        // and hides exactly the falloff a look has to be judged on.
        { x: -6.9, z: 1.0, wall: 'W', height: 2.7, colorTint: 0xff9a40, intensityMul: 1.15 },
        // A far, dim one past the threshold — gives the beyond-room a reason
        // to be faintly visible instead of a black hole.
        { x: 0, z: -17.8, wall: 'N', height: 2.6, colorTint: 0x6690c0, intensityMul: 0.7 },
      ],
      spawns: [
        { enemyId: 'husk', x: -1.4, z: -2.6 },      // ABSORBED — mundane, dark
        { enemyId: 'ooze-small', x: 1.8, z: -1.9 },  // the accent body
      ],
      doors: [], stairs: [],
    },
    // Standing eye, slight down-pitch — a real gameplay pose, not a beauty angle.
    // yaw 0 = facing -Z, INTO the room and down the threshold. (Authored as
    // Math.PI first, which points at +Z — the back wall — and produced a
    // sheet of a corner with no doorway, no creature and no depth in it.
    // Worth the comment: a beauty corner facing the wrong way silently
    // makes every look comparison meaningless.)
    playerPos: { x: 0, z: 7.4, yaw: 0, pitch: -0.10 },
    freeze: true,          // deterministic: the LOOK is the only variable
    godMode: true,
    enemiesInvincible: true,
  },

  // ── SUBSTRATE SLICE — the blood-drinker fun-check (docs/BUILD-ECONOMY.md) ──
  // Bleed weapon (bone-needle) + the two bleed relics + a clustered pack: hit
  // one, it bleeds, it dies, the burst CHAINS bleed to its neighbours, and every
  // bleeding kill FEEDS you. Is the machine fun? That's the whole question.
  'blood-drinker': {
    level: {
      id: 'blood-drinker', depth: 4, displayName: 'BLOOD DRINKER', fogColor: 0x0c0608,
      startPos: { x: 0, z: 6, yaw: Math.PI },
      rooms: [{ id: 'pit', rect: { x: 0, z: 0, w: 18, d: 18 }, height: 5 }],
      corridors: [], props: [],
      torches: [
        { x: -8, z: 0, wall: 'W', height: 2.6, colorTint: 0xd83828, intensityMul: 1.2 },
        { x:  8, z: 0, wall: 'E', height: 2.6, colorTint: 0xd83828, intensityMul: 1.2 },
        { x:  0, z: -8, wall: 'N', height: 2.6, colorTint: 0xd83828, intensityMul: 1.2 },
      ],
      // A clustered pack so the chain visibly propagates.
      spawns: Array.from({ length: 8 }, (_, i) => ({
        enemyId: 'ooze-small',
        x: (i % 4 - 1.5) * 1.7,
        z: -3.5 - Math.floor(i / 4) * 1.7,
        roomId: 'pit',
      })),
      doors: [], stairs: [],
    },
    equipWeaponId: 'harrow',   // the frenzy verb — swap to 'bone-needle' to A/B the feel
    // The whole Blood machine as relics: apply (splinter) → amplify (2nd tick)
    // → detonate (clot fetish chain) → feed (crimson leech). All accrete in the
    // reliquary; a bleed weapon or the splinter seeds the loop on the pack.
    giveItems: ['weeping-splinter', 'gorged-tick', 'clot-fetish', 'crimson-leech'],
    playerPos: { x: 0, z: 6, lookAt: { x: 0, z: -2, y: 1.2 } },
  },

  // ── RELIC LAB — every ITEM-GRAMMAR engine hook in one room ──────────
  // Poison applier → carrion-tongue (heal on poisoned kill) and burn applier →
  // ashen-psalm (fury on burning kill) exercise victim-conditions; deflect a
  // flash → chime heals + aegis hardens; perfect-dodge → untouched-oath fury;
  // gold showers feed the counting itch; 3× morningstar-chip shows hyperbolic
  // crit stacking (+4% → ~11.5%, not 12%); usurers-seal compounds.
  'relic-lab': {
    level: {
      id: 'relic-lab', depth: 4, displayName: 'RELIC LAB', fogColor: 0x0a0a0c,
      startPos: { x: 0, z: 6, yaw: Math.PI },
      rooms: [{ id: 'lab', rect: { x: 0, z: 0, w: 18, d: 18 }, height: 5 }],
      corridors: [], props: [],
      torches: [
        { x: -8, z: 0, wall: 'W', height: 2.6, colorTint: 0x86b33f, intensityMul: 1.1 },
        { x:  8, z: 0, wall: 'E', height: 2.6, colorTint: 0xd9772e, intensityMul: 1.1 },
      ],
      spawns: Array.from({ length: 8 }, (_, i) => ({
        enemyId: 'ooze-small',
        x: (i % 4 - 1.5) * 1.7,
        z: -3.5 - Math.floor(i / 4) * 1.7,
        roomId: 'lab',
      })),
      doors: [], stairs: [],
    },
    equipWeaponId: 'rusted-sword',
    giveItems: [
      'grave-mould-clump', 'carrion-tongue',          // poison → conditioned feed
      'vess-striker', 'ashen-psalm',                  // burn → conditioned fury
      'chime-of-still-air', 'patient-aegis',          // deflect payoffs
      'untouched-oath',                               // just-dodge payoff
      'counting-itch', 'usurers-seal',                // economy + compounding
      'morningstar-chip', 'morningstar-chip', 'morningstar-chip',  // hyperbolic
    ],
    playerPos: { x: 0, z: 6, lookAt: { x: 0, z: -2, y: 1.2 } },
  },

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


  // perf-vfx: the EFFECTS/OVERDRAW stress — everything additive, close to
  // the camera where it covers real screen area. A tight room ringed with
  // hot torches (flame-sprite stacks + bloom feeders at arm's length) and a
  // line of acolytes whose spit salvos fly INTO the camera (projectile
  // cores + trails + impact procs + status motes on the player). Crowd is
  // deliberately small so the sprite/bloom/projectile axis dominates, not
  // draw-call submission. Pair with ?god=1 and stand still in the salvo.
  'perf-vfx': {
    level: {
      id: 'perf-vfx', depth: 5, displayName: 'PERF vfx', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 5, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 14, d: 16 }, height: 3.6 }],
      corridors: [],
      props: [],
      torches: [
        // Ring around the player's end — flame stacks fill the view edges.
        { x: -6.5, z: 6.5, height: 1.9, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.6 },
        { x:  6.5, z: 6.5, height: 1.9, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.6 },
        { x: -6.5, z: 3.0, height: 1.9, wall: 'W', colorTint: 0xff7733, intensityMul: 1.6 },
        { x:  6.5, z: 3.0, height: 1.9, wall: 'E', colorTint: 0xff7733, intensityMul: 1.6 },
        { x: -6.5, z: -0.5, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.4 },
        { x:  6.5, z: -0.5, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.4 },
        // Far wall pair behind the acolytes — bloom sources in frame centre.
        { x: -3.0, z: -7.5, height: 2.2, wall: 'N', colorTint: 0xff5533, intensityMul: 1.8 },
        { x:  3.0, z: -7.5, height: 2.2, wall: 'N', colorTint: 0xff5533, intensityMul: 1.8 },
      ],
      spawns: [
        // A firing line of ranged casters — constant spit toward the player.
        { enemyId: 'acolyte', x: -4.5, z: -5.5, roomId: 'r' },
        { enemyId: 'acolyte', x: -2.7, z: -6.0, roomId: 'r' },
        { enemyId: 'acolyte', x: -0.9, z: -6.3, roomId: 'r' },
        { enemyId: 'acolyte', x:  0.9, z: -6.3, roomId: 'r' },
        { enemyId: 'acolyte', x:  2.7, z: -6.0, roomId: 'r' },
        { enemyId: 'acolyte', x:  4.5, z: -5.5, roomId: 'r' },
      ],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 5, lookAt: { x: 0, z: -6, y: 1.2 } },
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
    giveItems: ['flask-draught', 'flask-draught', 'berserk-potion', 'berserk-potion'],
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

  // ── COMBAT ARENA — the training dojo ───────────────────────────────
  // A fighting-game practice room: you stand at centre, a ring of mixed
  // attackers surrounds you, YOU are invulnerable (godMode) and THEY never
  // die (enemiesInvincible — HP floors at 1, but they still flash, take
  // poise/stagger, and keep attacking). Endless sparring to drill parry /
  // dodge / slow-mo / the AI read. Two melee deflectable kinds to parry
  // (ghoul, skeleton, skirmisher), a pair of rats to watch the pack weave,
  // and an acolyte for a ranged threat to dodge. No stairs — you stay.
  //   ?scenario=arena
  arena: {
    godMode: true,
    enemiesInvincible: true,
    level: {
      id: 'dbg-arena', depth: 5, displayName: 'TRAINING ARENA', fogColor: 0x0c0c12,
      startPos: { x: 0, z: 0, yaw: Math.PI },
      rooms: [{ id: 'arena', rect: { x: 0, z: 0, w: 18, d: 18 }, height: 4.5 }],
      corridors: [],
      props: [],
      // Torches on all four walls, brighter than usual — a dojo you can SEE
      // your sparring partners in (the periphery normally swallows them).
      torches: [
        { x: -8.8, z: -5, height: 2.6, wall: 'W', colorTint: 0xffb066, intensityMul: 1.3 },
        { x:  8.8, z: -5, height: 2.6, wall: 'E', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: -8.8, z:  5, height: 2.6, wall: 'W', colorTint: 0xffb066, intensityMul: 1.3 },
        { x:  8.8, z:  5, height: 2.6, wall: 'E', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: -5, z: -8.8, height: 2.6, wall: 'N', colorTint: 0xffb066, intensityMul: 1.3 },
        { x:  5, z: -8.8, height: 2.6, wall: 'N', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: -5, z:  8.8, height: 2.6, wall: 'S', colorTint: 0xffb066, intensityMul: 1.3 },
        { x:  5, z:  8.8, height: 2.6, wall: 'S', colorTint: 0xffb066, intensityMul: 1.3 },
      ],
      spawns: ringSpawns('arena', ['ghoul', 'skeleton', 'skirmisher', 'rat', 'rat', 'acolyte'], 5.5),
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0, lookAt: { x: 0, z: -5.5, y: 1.2 } },
  },

  // Killable sparring pit — like the arena, but enemies DIE and HIT BACK (no
  // enemiesInvincible, no godMode), so the headless bot can fight a round to a
  // real win/loss. A tight ring of three close melee foes the dumb pilot can
  // reach without exploration. Driven by scripts/sweep.ts across many seeds to
  // sample combat outcomes (clear time, deaths, damage taken). DEV-only.
  spar: {
    level: {
      id: 'dbg-spar', depth: 3, displayName: 'SPARRING PIT', fogColor: 0x0c0c12,
      startPos: { x: 0, z: 0, yaw: Math.PI },
      rooms: [{ id: 'spar', rect: { x: 0, z: 0, w: 14, d: 14 }, height: 4.5 }],
      corridors: [],
      props: [],
      torches: [
        { x: -6.8, z: 0, height: 2.6, wall: 'W', colorTint: 0xffb066, intensityMul: 1.3 },
        { x:  6.8, z: 0, height: 2.6, wall: 'E', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: 0, z: -6.8, height: 2.6, wall: 'N', colorTint: 0xffb066, intensityMul: 1.3 },
        { x: 0, z:  6.8, height: 2.6, wall: 'S', colorTint: 0xffb066, intensityMul: 1.3 },
      ],
      // A single foe dead ahead (player faces −Z): a clean 1v1 DUEL — the unit a
      // balance sweep varies by seed (clear time / damage taken). The reactive
      // pilot fights one moving target fine; a 3-way melee needs smarter AI.
      spawns: [
        { enemyId: 'skeleton', x: 0, z: -3.2, roomId: 'spar' },
      ],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0, lookAt: { x: 0, z: -3.5, y: 1.2 } },
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

  // COLOR-LEGEND LAB — one wide room with the three most separable mood
  // tints on different walls (blood W / gold E / violet N) and a PAINTED-
  // mode skirmisher centre as a live colour-meter. Purpose: A/B the post
  // chain (amber tint, dark-adapt, quantize) against the room colour
  // legend — if the moods stop being distinguishable in THIS frame, the
  // post chain is crushing the legend (docs/VISUAL-LANGUAGE.md).
  'tint-lab': {
    freeze: true,
    level: {
      id: 'tint-lab', depth: 3, displayName: 'TINT LAB', fogColor: 0x000000,
      startPos: { x: 0, z: 0.5, yaw: Math.PI },
      rooms: [
        { id: 'lab', rect: { x: 0, z: -4, w: 12, d: 10 }, height: 3.4 },
      ],
      corridors: [],
      props: [],
      torches: [
        { x: -5.5, z: -2.5, height: 2.0, wall: 'W', colorTint: 0xff5040, intensityMul: 1.2 },
        { x: -5.5, z: -5.5, height: 2.0, wall: 'W', colorTint: 0xff5040, intensityMul: 1.2 },
        { x:  5.5, z: -2.5, height: 2.0, wall: 'E', colorTint: 0xffd060, intensityMul: 1.2 },
        { x:  5.5, z: -5.5, height: 2.0, wall: 'E', colorTint: 0xffd060, intensityMul: 1.2 },
        { x: -1.5, z: -8.5, height: 2.0, wall: 'N', colorTint: 0xa080ff, intensityMul: 1.3 },
        { x:  1.5, z: -8.5, height: 2.0, wall: 'N', colorTint: 0xa080ff, intensityMul: 1.3 },
      ],
      spawns: [{ enemyId: 'skirmisher', x: 0, z: -4.5, roomId: 'lab' }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 0.5, lookAt: { x: 0, z: -8, y: 1.2 } },
  },

  // ELEVATION LAB — the verticality probe (two flat rooms 1.4m apart, a
  // sloped corridor between). Frozen view from the high room looking down
  // the ramp into the low room: floor grade, wall coverage, torch heights,
  // and the ghoul standing on the LOW plateau should all read level-true.
  // Unfrozen (pilot / phone via the test-chamber picker) the ghoul chases
  // up the ramp.
  'elevation-lab': {
    freeze: true,
    level: buildElevationLab(),
    // At the ramp's mouth looking down into the low room — the grade,
    // the low plateau, and the ghoul all inside fog range.
    playerPos: { x: 0, z: 1.6, lookAt: { x: 0, z: -6, y: -1.0 } },
  },

  // STAIRWELL LAB — an unsealed descent up close, camera at the parapet
  // looking down the well: steps, landing, the round arch, the fire
  // beyond it (ember at rest — walk into range unfrozen to see it wake).
  'stairwell-lab': {
    freeze: true,
    level: {
      // Spawn OFF-AXIS so the auto-placed threshold bonfire lands out of
      // the camera's sightline down the well.
      id: 'stairwell-lab', depth: 1, startPos: { x: 3.2, z: -3.5, yaw: Math.PI },
      rooms: [{ id: 'sw', rect: { x: 0, z: 0, w: 8, d: 10 }, height: 3.2 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.95, z: -1.5, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x: 3.95, z: -1.5, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [], doors: [],
      stairs: [{ x: 0, z: 0.6, rotY: 0, targetLevel: 'depth-2' }],
    },
    playerPos: { x: 0, z: -0.2, lookAt: { x: 0, z: 2.4, y: -2.1 } },
  },

  // BOSS-WARD LAB — a sealed boss descent up close, for iterating on
  // the ward rig (chains + padlock + membrane, stairs.ts). The boss is
  // ALIVE (encounter never completes here), so the seal stays up.
  'boss-ward': {
    freeze: true,
    level: {
      id: 'boss-ward', depth: 3, displayName: 'WARD LAB', fogColor: 0x000000,
      startPos: { x: 0, z: 2.5, yaw: Math.PI },
      rooms: [
        { id: 'r', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 3.4 },
      ],
      corridors: [],
      props: [],
      torches: [
        { x: -3.5, z: -1, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.2 },
        { x:  3.5, z: -1, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.2 },
      ],
      spawns: [], doors: [],
      stairs: [{ x: 0, z: -2.5, targetLevel: 'none', unlock: { kind: 'boss-defeated', color: 0x66e08a } }],
    },
    playerPos: { x: 0, z: 0.6, lookAt: { x: 0, z: -2.5, y: 0.35 } },
  },

  // DEAL LAB — every transaction verb in one room, for iterating on
  // the grammar (content/transactions.ts): tithe basin (UNKNOWN·pale),
  // merchant (PRICED·gold), fountains. Blood altar + challenge altar
  // spawn via their vaults; this lab covers the standalone verbs.
  'deal-lab': {
    freeze: true,
    level: {
      id: 'deal-lab', depth: 4, displayName: 'DEAL LAB', fogColor: 0x000000,
      startPos: { x: 0, z: 0.5, yaw: Math.PI },
      rooms: [
        { id: 'lab', rect: { x: 0, z: -2, w: 14, d: 10 }, height: 3.4 },
      ],
      corridors: [],
      props: [
        { kind: 'tithe-basin', x: -4, z: -4 },
        { kind: 'merchant', x: 4, z: -4, rotY: 0.4 },
        { kind: 'fountain', x: 0, z: -5.5, variant: 'tainted' },
        { kind: 'reliquary', x: 0, z: -2.5 },
      ],
      torches: [
        { x: -6.5, z: -4, height: 2.0, wall: 'W', colorTint: 0xa8c0d8, intensityMul: 1.1 },
        { x:  6.5, z: -4, height: 2.0, wall: 'E', colorTint: 0xffd060, intensityMul: 1.1 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 1.2, lookAt: { x: 0, z: -2.5, y: 0.9 } },
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

  // NOTE: the frozen single-weapon previews (viewmodel-rusted-sword,
  // -iron-maul, -bent-sickle, … one per weapon) are AUTO-GENERATED from the
  // item registry — see buildWeaponPreviewScenario below. Don't hand-write them.
  // The entries that remain here are the ones that AREN'T plain previews:
  // un-frozen combat-review poses (spear/crossbow/wand fire at a posed mob) and
  // the nose-to-wall clip test.

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
      { itemId: 'the-long-hunger',      x:  1.1, z: -1.5 }, // cursed (violet)
      { itemId: 'bone-amulet',          x:  2.2, z: -1.5 }, // rare (blue)
    ],
    spawnCards: [
      { cardId: 'the-hollow-saint', x: -1.7, z: -2.1 }, // major fate drops (bone)
      { cardId: 'red-thirst',       x:  0.0, z: -2.2 }, // blood
      { cardId: 'the-wanderer',     x:  1.7, z: -2.1 }, // wonder (violet)
    ],
  },

  // Domain-framing showcase — the floating item cards for one item per domain
  // family, dressed in their domain frame/wash/watermark. `delve snap frame-lab`.
  'frame-lab': {
    freeze: true,
    hideSword: true,
    hudOnly: true,
    frameShowcase: [
      'ring-of-bloodthirst', // blood
      'bone-amulet',         // bone
      'the-long-hunger',     // cursed / chaos
    ],
  },

  // Bug-report screenshot check — opens the report sheet over a live floor so a
  // snap confirms the frame-capture preview isn't black. `delve snap report-lab`.
  'report-lab': {
    level: {
      id: 'report-lab', depth: 2, displayName: 'REPORT LAB', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 6, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 14, d: 14 }, height: 5 }],
      corridors: [], props: [],
      torches: [
        { x: -6, z: 0, wall: 'W', height: 2.6, colorTint: 0xd9772e, intensityMul: 1.1 },
        { x:  6, z: 0, wall: 'E', height: 2.6, colorTint: 0xd9772e, intensityMul: 1.1 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 6, lookAt: { x: 0, z: -4, y: 1.2 } },
    openBugReport: true,
  },

  // Acquisition-beat showcase — the living pickup beat (fly-to-satchel + domain
  // flood + the deep's word) looped over a live floor. `delve snap acquire-lab`.
  'acquire-lab': {
    level: {
      id: 'acquire-lab', depth: 4, displayName: 'ACQUIRE LAB', fogColor: 0x0c0608,
      startPos: { x: 0, z: 6, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 14, d: 14 }, height: 5 }],
      corridors: [], props: [],
      torches: [
        { x: -6, z: 0, wall: 'W', height: 2.6, colorTint: 0xd83828, intensityMul: 1.1 },
        { x:  6, z: 0, wall: 'E', height: 2.6, colorTint: 0xd83828, intensityMul: 1.1 },
      ],
      spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 6, lookAt: { x: 0, z: -2, y: 1.2 } },
    acquireBeat: 'ring-of-marrow',   // a cursed blood relic — flood + narration
  },

  // Card-claim — loops the fate reading + auto-claim so a snap catches the
  // diegetic claim beat (ignite + drawn-in + the deep speaks). `delve snap card-claim`.
  'card-claim': {
    freeze: true,
    hideSword: true,
    level: {
      id: 'card-claim', depth: 3, displayName: 'CARD CLAIM', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 4, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 12, d: 12 }, height: 5 }],
      corridors: [], props: [], torches: [], spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 4, lookAt: { x: 0, z: 0, y: 1.2 } },
    cardClaimLoop: true,
  },

  // Inscription — the READING channel over a live floor. `delve snap inscription`.
  'inscription': {
    freeze: true,
    level: {
      id: 'inscription', depth: 2, displayName: 'INSCRIPTION', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 5, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 12, d: 12 }, height: 5 }],
      corridors: [],
      torches: [{ x: -6, z: 0, wall: 'W', height: 2.6, colorTint: 0xd9772e, intensityMul: 1.1 }],
      spawns: [], doors: [], stairs: [], props: [],
    },
    playerPos: { x: 0, z: 5, lookAt: { x: 0, z: 0, y: 1.2 } },
    inscription: 'Worn on the hand that held the knife. Each kill fed him steadier than the meat did.',
  },

  // Spent-fire — a single CLAIMED/spent bonfire, to check the "already taken"
  // read against the lit title fire. `delve snap spent-fire`.
  'spent-fire': {
    freeze: true,
    hideSword: true,
    level: {
      id: 'spent-fire', depth: 2, displayName: 'SPENT FIRE', fogColor: 0x0a0a0e,
      startPos: { x: 0, z: 4, yaw: Math.PI },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 12, d: 12 }, height: 5 }],
      corridors: [],
      props: [{ kind: 'model', model: BONFIRE, x: 0, y: 0, z: 0 }],
      torches: [], spawns: [], doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 4, lookAt: { x: 0, z: 0, y: 0.5 } },
    spendFire: true,
  },

  // Preview-check — player posed CLOSE (~0.8m) to a relic + a potion, facing
  // them, so the see-before-you-take overlay is in range. `delve snap preview-check`.
  'preview-check': {
    freeze: true,
    hideSword: true,
    playerPos: { x: 0, z: 1.0, lookAt: { x: 0, z: -3, y: 0.4 } },
    enemyOverrides: [
      { index: 0, pos: { x: -12, z: -12 } },
      { index: 1, pos: { x: 12, z: -12 } },
      { index: 2, pos: { x: -12, z: 12 } },
    ],
    spawnPickups: [
      { itemId: 'ring-of-marrow', x: 0, z: 0.2 },   // relic, ~0.8m ahead
    ],
  },

  // Settings screen (the ⚙ tab of the unified menu) — for the settings-menu
  // crispness snap. `delve snap settings`.
  settings: {
    freeze: true,
    hideSword: true,
    openInventoryPanel: true,
    inventoryTab: 'settings',
    enemyOverrides: [
      { index: 0, pos: { x: -14, z: -14 } },
      { index: 1, pos: { x: 14, z: -14 } },
      { index: 2, pos: { x: -14, z: 14 } },
    ],
  },

  // Relic BILLBOARD showcase — a few arted relics dropped on the floor, viewed
  // from ~2m back (out of pickup range, so no preview card occludes them), to
  // eyeball the curved-lit 2.5D billboards standing in the world.
  // `delve snap relic-drop`.
  'relic-drop': {
    freeze: true,
    hideSword: true,
    playerPos: { x: 0, z: 1.9, lookAt: { x: 0, z: 0, y: 0.28 } },
    enemyOverrides: [
      { index: 0, pos: { x: -14, z: -14 } },
      { index: 1, pos: { x: 14, z: -14 } },
      { index: 2, pos: { x: -14, z: 14 } },
    ],
    spawnPickups: [
      { itemId: 'ring-of-marrow', x: -0.55, z: 0.15 },
      { itemId: 'vess-striker', x: 0.55, z: 0.15 },
    ],
  },

  // GATE OFFERING + sealed chests (#74). The two chests wear the violet seal;
  // taking the offering (centre) releases them. `delve snap gated-loot`.
  'gated-loot': {
    freeze: true,
    hideSword: true,
    playerPos: { x: 0, z: 3.4, lookAt: { x: 0, z: 0, y: 0.4 } },
    gatedLoot: {
      gate: { x: 0, z: 0 },
      chests: [{ x: -1.7, z: -0.4 }, { x: 1.7, z: -0.4 }],
    },
    enemyOverrides: [
      { index: 0, pos: { x: -14, z: -14 } },
      { index: 1, pos: { x: 14, z: -14 } },
      { index: 2, pos: { x: -14, z: 14 } },
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
  // THE STATUS HUD, POSED. Four statuses at once, two of them compounding —
  // which is the case the old buff bar rendered identically to a single stack
  // while the player took several times the damage. `delve snap status-lab`.
  'status-lab': {
    freeze: true,
    hideSword: true,
    applyPlayerBuffs: [
      { id: 'bleed', duration: 9, stacks: 4 },
      { id: 'poison', duration: 14, stacks: 2 },
      { id: 'burn', duration: 5 },
      { id: 'berserk', duration: 11 },
    ],
    enemyOverrides: [
      { index: 0, pos: { x: -12, z: -12 } },
      { index: 1, pos: { x: 12, z: -12 } },
      { index: 2, pos: { x: -12, z: 12 } },
    ],
  },

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
      'heretics-hood', 'bone-amulet', 'tattered-cloak', 'leather-gloves',
      'shroud-step-boots', 'wooden-shield',
      'ring-of-vigor', 'ring-of-ember',
      'ring-of-bloodthirst', 'the-long-hunger',
      'scimitar',
      'flask-draught', 'flask-draught', 'berserk-potion',
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
      'heretics-hood', 'bone-amulet', 'tattered-cloak', 'leather-gloves',
      'shroud-step-boots', 'wooden-shield',
      'ring-of-vigor', 'ring-of-ember',
      'ring-of-bloodthirst', 'the-long-hunger',
      'scimitar',
      'flask-draught', 'flask-draught', 'berserk-potion',
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
  // THE EMBER — borrowed life sitting above the hearts. Amber lozenges, spent
  // before your own blood. `delve snap hud-ember`.
  'hud-ember': {
    freeze: true,
    hudOnly: true,
    giveEmber: 6,
    damagePlayerBy: 2,
  },
  // THE EMBER ON THE FLOOR — the world object, not the HUD chip. Two of them:
  // one at arm's length to LOOK at, one under the player's feet so the
  // walk-over grant fires on the first tick. Not frozen — auto-pickup runs in
  // the interactable tick, so a frozen world never collects anything.
  //   delve snap ember-drop        (see it)
  //   delve snap ember-drop --frames=4 --duration=1   (watch it get taken)
  'ember-drop': {
    hideSword: true,
    playerPos: { x: 0, z: 0.6, lookAt: { x: 0, z: -1.4, y: 0.2 } },
    spawnPickups: [
      { itemId: 'guttering-ember', x: 0, z: -1.4 },
      { itemId: 'guttering-ember', x: 0, z: 0.6 },
    ],
  },
  // THE FORGE, with the scar offer open — the temper line, then the two things
  // the fire will do to the blade instead. `delve snap forge-scars`.
  'forge-scars': {
    freeze: true,
    hudOnly: true,
    giveGold: 400,
    openForge: true,
  },
  // Consumable hotbar with a healthy stack of consumables — the flask +
  // satellite icons + count badges visible.
  'hud-hotbar': {
    freeze: true,
    hudOnly: true,
    giveItems: ['flask-draught', 'flask-draught', 'berserk-potion', 'berserk-potion'],
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
      'heretics-hood', 'bone-amulet', 'tattered-cloak', 'leather-gloves',
      'shroud-step-boots', 'wooden-shield',
      'ring-of-vigor', 'ring-of-ember',
      'ring-of-bloodthirst', 'the-long-hunger',
      'scimitar', 'flask-draught', 'flask-draught', 'berserk-potion',
    ],
    openInventoryPanel: true,
    selectItemId: 'ring-of-bloodthirst',
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // THE STARTER ALTARS — the first thing every player sees, and now an OFFERING
  // group like any other (one shared groupId; taking one closes its siblings).
  // Goes through the real builder prop path, so this is the regression guard on
  // the starter chamber. `delve snap starter-choice`.
  'starter-choice': {
    freeze: true,
    // THE REAL CHAMBER, not a copy of it. This used to be a hand-restated 11×11
    // box with three altars in it — which meant the scenario kept passing while
    // the actual first room of the game changed underneath it. It now builds the
    // shipping spec, so what you snap is what the player walks into: the apse
    // polygon, its ceiling, its sconces, the sealed stair.
    level: buildStarterChamber('depth-1', 4242),
    playerPos: { x: 0, z: 5.0, lookAt: { x: 0, z: 0, y: 1.1 } },
  },


  // THE TROVE (the offering system) — three relics on plinths, take one and the
  // other two withdraw. `delve snap trove`. Swap `style: 'ground'` to see the
  // low-slab presentation instead.
  trove: {
    freeze: true,
    trove: {
      itemIds: ['gorged-tick', 'weeping-splinter', 'sanguine-ring'],
      style: 'pedestal',
    },
    enemyOverrides: [
      { index: 0, pos: { x: -20, z: -20 } },
      { index: 1, pos: { x:  20, z: -20 } },
      { index: 2, pos: { x: -20, z:  20 } },
    ],
  },

  // The ground-equip SWAP-OR-LEAVE compare (#97): two weapons carried, a third
  // found → the sheet opens to choose which to shed. `delve snap equip-compare`.
  'equip-compare': {
    freeze: true,
    equipCompare: true,
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x:  10, z: -10 } },
      { index: 2, pos: { x: -10, z:  10 } },
    ],
  },

  // The RELIQUARY tab populated across domains, with duplicate stacks —
  // the oddities-collection snap. Relics route to the reliquary through
  // the same tryAutoEquip path real pickups use.
  reliquary: {
    freeze: true,
    giveItems: [
      'gorged-tick', 'gorged-tick', 'gorged-tick',
      'weeping-splinter', 'sanguine-ring', 'drowned-heart',
      'ring-of-vigor', 'ring-of-iron', 'thornring', 'ring-of-marrow',
      'ring-of-ember',
      'jeweler-band', 'split-iris-amulet',
      'the-long-hunger',
      'ring-of-quickening',
      // Provenance sets — Vess 2/3 (set bonus live), Maren 1/3 (progress view).
      'vess-striker', 'vess-oil-phial',
      'maren-thimble',
    ],
    openInventoryPanel: true,
    inventoryTab: 'reliquary',
    selectRelicId: 'vess-striker',
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

  // Traces of the lost — fallen-delver bodies + lamp-revealed wall-runes.
  // Player stands close so the runes bloom + a corpse glint reads. Walk closer
  // on a phone to watch them brighten; ?scenario=traces.
  // Estus flask drink — hurt player + draughts in the bag, world LIVE so the
  // drink channel runs, in a bare safe room (no mobs — the channel is the
  // subject). Tap the flask (or press 1) and watch the raise → sip → lower;
  // attack/dodge mid-drink to test the cancel.
  flask: {
    freeze: false,
    damagePlayerBy: 5,
    giveItems: ['flask-draught', 'flask-draught'],
    level: {
      id: 'dbg-flask',
      depth: 1,
      displayName: 'The Flask',
      fogColor: 0x0a0a0c,
      startPos: { x: 0, z: -0.6, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 3.2 }],
      corridors: [],
      props: [],
      torches: [{ x: 0, z: 3.8, height: 2.2, wall: 'N' }],
      spawns: [], doors: [], stairs: [],
    },
  },

  traces: {
    // Walkable — sweep your lamp along the walls to bloom the runes, walk up to
    // the bodies to SEARCH. (freeze:true is only for posed snaps.)
    freeze: false,
    level: {
      id: 'dbg-traces',
      depth: 2,
      displayName: 'Traces',
      fogColor: 0x0a0a0c,
      startPos: { x: 0, z: -0.6, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 3.2 }],
      corridors: [],
      props: [
        // Own bonfire in a back corner so the auto-threshold fire doesn't land
        // dead-centre in the demo shot.
        { kind: 'model', model: BONFIRE, x: 3.2, y: 0, z: 3.2, rotY: 0 },
        { kind: 'corpse', x: -1.4, z: -1.6, rotY: 0.7 },
        { kind: 'corpse', x: 1.6, z: -2.2, rotY: -0.7 },
        { kind: 'wall-rune', x: -1.2, z: -3.94, rotY: 0, text: 'turn back', tint: 0x8a3b2c },
        { kind: 'wall-rune', x: 1.4, z: -3.94, rotY: 0, text: 'we were so many' },
        { kind: 'wall-rune', x: -3.94, z: -0.5, rotY: Math.PI / 2, text: 'do not kneel at the basin', tint: 0x5f7355 },
      ],
      torches: [
        { x: -3.4, z: 3.0, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.5 },
      ],
      spawns: [],
      doors: [],
      stairs: [],
    },
    playerPos: { x: 0, z: -0.6, lookAt: { x: 0, z: -3.94, y: 1.4 } },
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
      id: 'dbg-marrow-sovereign', depth: 7, displayName: 'marrow sovereign', fogColor: 0x140806,
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

  // Marrow Sovereign PHASE 2 (the crawl) — same arena, but the boss is
  // jumped straight to phase 2 (legs + scythe gone, torso lowered) via the
  // bossPhase override, so the crawl pose can be inspected without fighting
  // phase 1 down. lookAt aimed lower since he's on the floor now.
  'marrow-sovereign-crawl': {
    freeze: true,
    level: {
      id: 'dbg-marrow-crawl', depth: 7, displayName: 'marrow sovereign — crawl', fogColor: 0x140806,
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
    playerPos: { x: 0, z: 3.0, lookAt: { x: 0, z: -2, y: 0.5 } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -2 }, state: 'chasing', bossPhase: 1 }],
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
  // ── THE LAMP TEST ────────────────────────────────────────────────────────
  //
  // The two distances a creature actually has to survive, in one frame:
  //
  //   NEAR (~3 m)  the player's lamp is full on it. This is where a dark body
  //                stops being dark — the lamp lifts every rough surface to the
  //                same value as the floor, which is why "make it darker" has
  //                never fixed anything.
  //   FAR  (~6 m)  past the lamp, inside the torch falloff, just short of the
  //                fog (FOG_FAR 9). This is where silhouette is the ONLY read.
  //
  // A creature that works at one and dies at the other is not done. `?mob=<id>`
  // swaps the subject, so this is the bench for the whole roster, not one mob.
  // Deliberately warm-lit, from the side, with a plain floor under it: no mood
  // lighting to flatter the model, and no second creature to hide behind.
  'lamp-test': {
    freeze: true, hideSword: true, godMode: true, enemiesInvincible: true,
    level: (() => {
      const mob = new URLSearchParams(location.search).get('mob') ?? 'ghoul';
      return {
        id: 'lamp-test', depth: 3, displayName: 'LAMP TEST', fogColor: 0x0a0a0c,
        startPos: { x: 0, z: 4.6, yaw: 0 },
        rooms: [{ id: 'r', rect: { x: 0, z: -1, w: 8, d: 14 }, height: 4.2 }],
        corridors: [], props: [],
        // One warm source, off to one side and BEHIND the near subject, so the
        // near body is lit by the lamp and the far one is rim-lit by the room.
        torches: [{ x: -3.9, z: -2.0, height: 2.6, wall: 'W', colorTint: 0xff9a40, intensityMul: 1.15 }],
        spawns: [
          { enemyId: mob, x: -0.75, z: 1.7, roomId: 'r', dormant: true },   // ≈3.0 m
          { enemyId: mob, x: 0.95, z: -1.3, roomId: 'r', dormant: true },   // ≈6.0 m
        ],
        doors: [], stairs: [],
      };
    })(),
    playerPos: { x: 0, z: 4.6, yaw: 0, pitch: -0.06 },
  },

  // The Hollow Choir, staged for a LOOK — one dim cool torch far behind it, so
  // what you see is the thing's own light rather than a lit statue.
  'mob-wraith': {
    freeze: true, hideSword: true,
    level: {
      id: 'dbg-wraith', depth: 6, displayName: 'wraith', fogColor: 0x06080c,
      startPos: { x: 0, z: 4.2, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 8, d: 10 }, height: 4.6 }],
      corridors: [], props: [],
      // Two real torches, not one dim one. A near-black room makes the exposure
      // lift until the walls read pale grey, which is the opposite of the frame
      // this thing has to be judged in — the wraith must be a light in a dark
      // room, not a pale shape in a lit one.
      torches: [
        { x: -3.9, z: -3.6, height: 2.6, wall: 'W', colorTint: 0x6688b0, intensityMul: 0.9 },
        { x: 3.9, z: 2.0, height: 2.6, wall: 'E', colorTint: 0xff9a40, intensityMul: 1.0 },
      ],
      spawns: [{ enemyId: 'wraith', x: 0, z: -0.6, roomId: 'r', dormant: true }],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 4.2, lookAt: { x: 0, z: -0.6, y: 1.6 } },
    godMode: true, enemiesInvincible: true,
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

  // ROOM SHAPE v2 — walk a generated polygon room. The whole point of #131:
  // the shapes have only ever been looked at from above, and "does it feel
  // right in first person" is the one question a contact sheet cannot answer.
  //
  //   ?scenario=polyroom            (rotunda — the most different silhouette)
  //   ?scenario=polyroom-tomb       (niches you can step into)
  //   ?scenario=polyroom-cavern     (carved, no straight through-line)
  //   ?scenario=polyroom-hall
  //
  // Sealed by design — no openings yet (level/poly-room-shell.ts), so this is a
  // room to stand in, not a floor to traverse.
  polyroom: polyRoomScenario('rotunda'),
  'polyroom-tomb': polyRoomScenario('tomb'),
  'polyroom-cavern': polyRoomScenario('cavern'),
  'polyroom-hall': polyRoomScenario('hall'),
  'polyroom-ell': polyRoomScenario('ell'),
  'polyroom-wedge': polyRoomScenario('wedge'),
  // The ruined end of the shell's range, forced rather than waited for. Roughly
  // a third of real rooms come out this way; without a scenario that PINS it,
  // checking the collapsed patch means rebuilding floors until one shows up.
  'polyroom-ruined': polyRoomScenario('hall', 0.9),

  // FEAR — two of the same creature side by side, one frightened and one not,
  // because a status tell is only as good as the CONTRAST with its absence. The
  // fear is imposed through the real applyFear path (not a posed state), so what
  // you see is the actual rout + skull the mechanic produces.
  //   ?scenario=fear
  fear: {
    godMode: true,
    level: {
      id: 'dbg-fear', depth: 3, displayName: 'FEAR', fogColor: 0x0c0c12,
      startPos: { x: 0, z: 4.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 12, d: 12 }, height: 3.6 }],
      corridors: [],
      props: [],
      torches: [
        { x: -5.8, z: -1, height: 2.4, wall: 'W', colorTint: 0xffaa55, intensityMul: 1.1 },
        { x:  5.8, z: -1, height: 2.4, wall: 'E', colorTint: 0xffaa55, intensityMul: 1.1 },
      ],
      spawns: [
        { enemyId: 'skeleton', x: -1.6, z: -1.0, roomId: 'r' },   // frightened
        { enemyId: 'skeleton', x:  1.6, z: -1.0, roomId: 'r' },   // calm — the control
      ],
      doors: [], stairs: [],
    },
    playerPos: { x: 0, z: 3.2, lookAt: { x: 0, z: -1.0, y: 1.2 } },
    enemyOverrides: [
      { index: 0, pos: { x: -1.6, z: -1.0 }, fear: 30 },
      { index: 1, pos: { x:  1.6, z: -1.0 }, state: 'chasing' },
    ],
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
        { kind: 'chest', x: -2.4, z: -1.5, rotY: 0, tier: 'wood', mimic: true },
        { kind: 'chest', x:  0.0, z: -1.5, rotY: 0, tier: 'silver', mimic: true },
        { kind: 'chest', x:  2.4, z: -1.5, rotY: 0, tier: 'gold',   mimic: true },
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
  // toward the bonfire + descent. For verifying the V5 layout (the
  // bonfire is the centrepiece you REST at; tome/fountain on the front
  // flanks).
  'safe-room': {
    freeze: true,
    hideSword: true,
    level: generateSafeRoom(3),  // safe room after Act I (boss depth 3)
    playerPos: { x: 0, z: 4.0, lookAt: { x: 0, z: 0.3, y: 0.8 } },
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

  // GORE ARENA (DEV) — endless sparring for testing death effects. Player is
  // invulnerable; one enemy spawns, and killing it spawns the next forever
  // (via the arena dummies' splitsInto), ALTERNATING flesh ↔ bone so you cycle
  // topple-melt, crumble, and head/arm/leg dismember on every kill. A bonfire
  // lights the room (and you can REST to level). Runs LIVE (no freeze).
  'gore-arena': {
    godMode: true,
    level: {
      id: 'gore-arena',
      depth: 3,
      displayName: 'GORE ARENA',
      fogColor: 0x140b08,
      startPos: { x: 0, z: 3.5, yaw: 0 },
      rooms: [{ id: 'arena', rect: { x: 0, z: 0, w: 11, d: 11 }, height: 3.0 }],
      corridors: [],
      props: [
        { kind: 'model', model: BONFIRE, x: 0, y: 0, z: 0, rotY: 0.5, scale: 1.2 },
      ],
      torches: [
        { x: -5.45, z:  0.0, height: 2.2, wall: 'W', colorTint: 0xffa860, intensityMul: 1.0 },
        { x:  5.45, z:  0.0, height: 2.2, wall: 'E', colorTint: 0xffa860, intensityMul: 1.0 },
        { x:  0.0,  z: -5.45, height: 2.2, wall: 'N', colorTint: 0xffb070, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: 'arena-flesh', x: 0, z: -3.5, roomId: 'arena' }],
      doors: [],
      stairs: [],
    },
    playerPos: { x: 0, z: 3.5, lookAt: { x: 0, z: -3.0, y: 1.0 } },
  },
};

// ── Vault inspector previews (DEV only) ─────────────────────────────────
// The per-vault preview scenarios (`?scenario=vault-<id>` / `palette-<id>`)
// lived here. They previewed a single hand-authored ASCII vault with its real
// treatment, which was the right tool while vaults were what a floor was made
// of. The vault library is retired — polygon rooms are the only floor now — so
// there is no vault to preview. Room-shape work uses `?scenario=` on a real
// floor, or `delve reach` / `delve snap` against a seed.

// ── Auto-generated subject previews ──────────────────────────────────
// Every mob/weapon/item in the registries gets a preview scenario for free,
// derived from src/debug/authorables.ts. This is what makes `npm run snap
// mob-<anyid>` / `viewmodel-<id>` / `item-<id>` work for EVERY subject without
// hand-authoring a block each (the dozens of near-identical entries above used
// to be copy-pasted). Hand-authored scenarios WIN — we only fill ids that
// don't already have a tuned entry — so the bespoke ones (mob-mimic's three
// chests, the burrower's buried/emerging states, etc.) are preserved.

/** The repeated "single mob, lit, posed facing the camera" room. lookAt height
 *  tracks the mob's own aim point × scale so tall casters and low hounds both
 *  frame sensibly without a hand-tuned camera per mob. */
function buildMobPreviewScenario(id: string): Scenario {
  const spec = ENEMIES[id];
  // Frame at ~mid-body. Creature enemies measure their own height, so use the
  // authored proportion height; legacy mobs use aimHeight × scale.
  const eyeY = spec?.creature
    ? (spec.creature.proportions?.height ?? 1.6) * 0.55 * (spec?.scale ?? 1)
    : (spec?.aimHeight ?? 0.6) * (spec?.scale ?? 1);
  return {
    freeze: true,
    hideSword: true,
    level: {
      id: `dbg-mob-${id}`,
      depth: 6,
      displayName: spec?.bossName ?? spec?.name ?? id,
      fogColor: 0x14100a,
      startPos: { x: 0, z: 2.5, yaw: 0 },
      rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 6, d: 6 }, height: 3.0 }],
      corridors: [],
      props: [],
      torches: [
        { x: -3.0, z: -2.5, height: 2.2, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
        { x: 3.0, z: -2.5, height: 2.2, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      ],
      spawns: [{ enemyId: id, x: 0, z: -1.0, roomId: 'r' }],
      doors: [],
      stairs: [],
    },
    playerPos: { x: 0, z: 1.5, lookAt: { x: 0, z: -1.0, y: eyeY } },
    enemyOverrides: [{ index: 0, pos: { x: 0, z: -1.0 }, state: 'chasing' }],
  };
}

/** Equip a weapon and freeze — the first-person viewmodel fills the lower frame.
 *  Pair with `?phase=windup|strike|recover` to scrub the swing. No inspect: the
 *  held viewmodel is camera-anchored, so the studio reframe would fight it. The
 *  arena's default mobs get shoved to the corners so they don't clutter the
 *  shot (this is what the old per-weapon literals hand-wrote, now free for
 *  every weapon). For geometry/grip iteration prefer `delve bench viewmodel-<id>
 *  --hand --ortho --debug` — no game, multi-view, slot markers. */
function buildWeaponPreviewScenario(id: string): Scenario {
  return {
    freeze: true,
    equipWeaponId: id,
    enemyOverrides: [
      { index: 0, pos: { x: -10, z: -10 } },
      { index: 1, pos: { x: 10, z: -10 } },
      { index: 2, pos: { x: -10, z: 10 } },
    ],
  };
}

/** Float the item's drop-model, studio-lit and slowly rotating (see the
 *  previewItemId handler in applyScenario). Subject-only so the room falls away.*/
function buildItemPreviewScenario(id: string): Scenario {
  return { freeze: true, hideSword: true, inspect: true, inspectSubjectOnly: true, previewItemId: id };
}

if (import.meta.env.DEV) {
  for (const a of listMobs()) {
    if (!SCENARIOS[a.scenario]) SCENARIOS[a.scenario] = buildMobPreviewScenario(a.id);
  }
  for (const a of listWeapons()) {
    if (!SCENARIOS[a.scenario]) SCENARIOS[a.scenario] = buildWeaponPreviewScenario(a.id);
  }
  for (const a of listItems()) {
    if (!SCENARIOS[a.scenario]) SCENARIOS[a.scenario] = buildItemPreviewScenario(a.id);
  }
}

export function getScenarioFromUrl(): Scenario | null {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('scenario');
  if (!name) return null;
  // Parameterized perf scenarios build from the live URL params (count/kind);
  // everything else is a static entry in SCENARIOS.
  const base = PERF_FACTORIES[name] ? PERF_FACTORIES[name](params) : SCENARIOS[name];
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
  // Pose the held weapon at a swing phase — lets a snap capture any equipped
  // weapon mid-strike (animation review), not just the idle pose. `&phase=strike`
  // grabs the struck-through pose; windup/recover available too.
  const phaseOverride = params.get('phase');
  if (phaseOverride === 'windup' || phaseOverride === 'strike' || phaseOverride === 'recover') {
    // strike → a big phaseTimer clamps getPhaseProgress to ~1 (the struck pose).
    const phaseTimer = phaseOverride === 'strike' ? 0.2 : phaseOverride === 'windup' ? 0.1 : 0.02;
    result = { ...result, swordPhase: { phase: phaseOverride, phaseTimer } };
  }
  return result;
}

export function applyScenario(
  scenario: Scenario,
  ctx: { level: LiveLevel; weapon: WeaponViewmodel; camera: THREE.Camera },
) {
  // Combat-arena setup flags (DEV — both setters AND with DEV internally).
  if (scenario.godMode) setGodMode(true);
  if (scenario.enemiesInvincible) setArenaEnemiesInvincible(true);

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
    // Scenario poses are a HARD TELEPORT outside the sim step — same class as the
    // descent teleport: without a re-seed, interpRestore snaps the camera back to
    // its stale pre-scenario pose, and a frozen preview never runs the sim to
    // settle it, so every mob-/item- snap framed the SPAWN instead of the subject.
    interpSync([ctx.camera]);
  }

  if (scenario.hideSword) {
    ctx.weapon.group.visible = false;
  }

  if (scenario.enemyOverrides) {
    for (const ov of scenario.enemyOverrides) {
      const enemy = ctx.level.enemies[ov.index];
      if (!enemy) continue;
      if (ov.pos) enemy.setDebugPosition(ov.pos.x, ov.pos.z);
      if (ov.bossPhase !== undefined) enemy.setDebugBossPhase(ov.bossPhase);
      if (ov.state) enemy.setDebugState(ov.state, ov.phaseTimer ?? 0);
      if (ov.fear) enemy.applyFear(ov.fear);
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

  // Sheathe an alternate weapon so the swap chip shows (loadout preview #96).
  if (scenario.sidearmId) {
    const alt = ITEMS[scenario.sidearmId];
    if (alt) setSidearm(alt);
  }

  if (scenario.triggerDeath) {
    triggerDeath();
  }

  if (scenario.openAllInteractables) {
    debugUseAll();
    if (scenario.tickInteractables) debugTickAll(scenario.tickInteractables);
  }

  // Ember BEFORE damage — borrowed life must exist for the blow to eat it.
  if (scenario.giveEmber) grantEmber(scenario.giveEmber);

  if (scenario.damagePlayerBy) {
    damagePlayer(scenario.damagePlayerBy);
  }

  if (scenario.applyPlayerBuffs) {
    const player = getEntity('player');
    if (player) {
      for (const b of scenario.applyPlayerBuffs) {
        for (let i = 0; i < (b.stacks ?? 1); i++) applyBuff(player, b.id, b.duration);
      }
    }
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

  if (scenario.rawPointLights) {
    const scene = ctx.camera.parent as THREE.Scene;
    for (const l of scenario.rawPointLights) {
      const light = new THREE.PointLight(l.color, l.intensity, l.distance, l.decay);
      light.position.set(l.x, l.y, l.z);
      scene.add(light);
    }
  }

  if (scenario.spawnCards) {
    const scene = ctx.camera.parent as THREE.Scene;
    for (const c of scenario.spawnCards) {
      spawnCardDrop(scene, new THREE.Vector3(c.x, 0, c.z), c.cardId);
    }
  }

  if (scenario.spawnShrouded) {
    const scene = ctx.camera.parent as THREE.Scene;
    for (const s of scenario.spawnShrouded) {
      spawnShroudedRelic(scene, new THREE.Vector3(s.x, 0, s.z), s.depth ?? 5);
    }
  }

  if (scenario.gatedLoot) {
    const scene = ctx.camera.parent as THREE.Scene;
    const gateId = 'gated-loot-test';
    // Offering first so the chests read the encounter as sealed at spawn.
    spawnGateOffering(scene, new THREE.Vector3(scenario.gatedLoot.gate.x, 0, scenario.gatedLoot.gate.z), 0, gateId);
    for (const c of scenario.gatedLoot.chests) {
      spawnChest(scene, new THREE.Vector3(c.x, 0, c.z), 0, { items: [ITEMS['flask-draught']].filter(Boolean), gold: 40 }, 'silver', false, undefined, gateId);
    }
  }

  if (scenario.openInventoryPanel) {
    openInventoryPanel(scenario.inventoryTab ?? 'gear');
  }
  if (scenario.giveGold) grantGold(scenario.giveGold);
  if (scenario.openForge) {
    openForgeSheetForDebug();
  }
  if (scenario.selectItemId) {
    selectBagItem(scenario.selectItemId);
  }
  if (scenario.selectRelicId) {
    selectRelicItem(scenario.selectRelicId);
  }
  if (scenario.openCharacterScreen) {
    openCharacterScreen();
  }

  if (scenario.trove) {
    // Stand a row of offerings in front of the player, facing them. Take one and
    // the rest withdraw, leaving bare stone. `delve snap trove`.
    const t = scenario.trove;
    const dist = t.dist ?? 3.2;
    const spacing = t.spacing ?? 2.8;
    const items = t.itemIds.map((id) => ITEMS[id]).filter((i): i is ItemSpec => !!i);
    const cost = t.gold != null ? { gold: t.gold } : t.itemId ? { itemId: t.itemId } : undefined;
    // Lay the row out along the camera's actual FORWARD (flattened to the floor)
    // rather than assuming −Z, so the trove is in view whatever the spawn faces.
    const p = ctx.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); else fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);   // fwd rotated +90° on Y
    const faceCamera = Math.atan2(-fwd.x, -fwd.z);       // offerings look back at you
    const offerings = items.map((item, i) => {
      const lateral = (i - (items.length - 1) / 2) * spacing;
      return {
        item,
        pos: new THREE.Vector3(
          p.x + fwd.x * dist + right.x * lateral,
          0,
          p.z + fwd.z * dist + right.z * lateral,
        ),
        rotY: faceCamera,
      };
    });
    spawnOfferingGroup({
      kind: 'trove',
      scene: ctx.level.root,
      materials: ctx.level.materials,
      style: t.style ?? 'pedestal',
      cost,
      family: cost ? 'priced' : undefined,
      offerings,
    });
  }

  if (scenario.equipCompare) {
    // Pose the swap-or-leave compare: two weapons already carried, a third
    // found → the sheet opens choosing which to shed. DEV snap only.
    void Promise.all([import('../player/ground-equip'), import('../content/items')])
      .then(([{ groundEquip }, { ITEMS }]) => {
        const weps = Object.values(ITEMS).filter((i) => i.kind === 'weapon');
        setSlot('weapon', weps[0]);
        setSidearm(weps[1]);
        groundEquip({ item: weps[2], affixes: [], onEquipped: () => {}, dropDisplaced: () => {} });
      });
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

  if (scenario.frameShowcase) {
    renderFrameShowcase(scenario.frameShowcase);
  }

  if (scenario.spendFire) {
    void import('../level/fate-fire').then((m) => m.debugSpendFlames(ctx.level.root));
  }

  if (scenario.inscription) {
    const text = scenario.inscription;
    void import('../ui/inscription').then(({ showInscription }) => {
      showInscription(text, { holdMs: 999999 });   // hold so a snap catches it
    });
  }

  if (scenario.cardClaimLoop) {
    void import('../ui/card-reading').then(({ openCardReading, autoPickFirstCard }) => {
      const loop = () => {
        openCardReading({ arcana: 'major', onDone: () => setTimeout(loop, 500) });
        setTimeout(() => autoPickFirstCard(), 900);   // deal + flip, then claim → burn beat
      };
      loop();
    });
  }

  if (scenario.openBugReport) {
    // Delay so the floor has rendered a real frame before the capture fires.
    setTimeout(() => { void import('../report/bug-report').then((m) => m.openBugReport()); }, 400);
  }

  if (scenario.acquireBeat) {
    const item = ITEMS[scenario.acquireBeat];
    if (item) {
      // Seed the reliquary so the affliction count reads >0, then loop the beat
      // so a snap captures the flood/pop/chip regardless of when it fires.
      if (item.kind === 'relic') addRelic(item);
      const fire = () => debugPlayAcquisitionBeat(item);
      fire();
      setInterval(fire, 1600);
    }
  }

  if (scenario.freeze) {
    setWorldFrozen(true);
  }
}

/** DEV fixture: lay out the full framed item cards side by side over a scrim, so
 *  a snap can verify the domain frame/wash/watermark treatment deterministically. */
function renderFrameShowcase(ids: string[]): void {
  const scrim = document.createElement('div');
  Object.assign(scrim.style, {
    position: 'fixed', inset: '0', zIndex: '80',
    background: 'radial-gradient(ellipse at center, rgba(14,9,6,0.92), rgba(4,3,2,0.98))',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px',
    flexWrap: 'wrap', padding: '24px', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  for (const id of ids) {
    const item = ITEMS[id];
    if (!item) continue;
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      maxWidth: 'min(320px, 40vw)', width: 'max-content',
      padding: '9px 13px', borderRadius: '5px',
      background: THEME.panel, border: `1px solid ${THEME.ruleStrong}`,
      color: THEME.text, fontFamily: 'serif', fontSize: '12px', lineHeight: '1.4',
      boxShadow: '0 4px 18px rgba(0,0,0,0.6)',
    } as Partial<CSSStyleDeclaration>);
    panel.appendChild(buildItemCard(item, { compare: false }));
    const f = itemFraming(item);
    if (f) applyDomainFrame(panel, f);
    scrim.appendChild(panel);
  }
  document.body.appendChild(scrim);
}
