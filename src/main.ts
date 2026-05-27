import * as THREE from 'three';
import { CONFIG } from './config';
import { updateTorchlight } from './scene/torchlight';
import { createTouchInput } from './controls/input';
import { createFirstPersonCamera, updateCamera, setCameraYaw } from './controls/camera';
import { createSword } from './player/sword';
import { attachLamp, tickLamp } from './player/handheld-lamp';
import { setSlot, onEquipmentChanged } from './player/equipment';
import { setCurrentWeapon } from './player/current-weapon';
import { ITEMS } from './content/items';
import { warmupContent } from './content/warmup';
import { createCombatSystem } from './combat/attack';
import { isFrozen } from './combat/hit-pause';
import { tickShake } from './combat/screen-shake';
import { onPlayerDeath } from './player/health';
import { triggerDeath, getTimeScale, tickDeath, isDying } from './player/death';
import { initAchievements } from './broadcast/achievements';
import { getStyle } from './style';
import { buildMaterials } from './style/materials';
import { initRenderPipeline, renderWithStyle } from './style/render-target';
import { createSettingsMenu } from './ui/settings-menu';
import { createInventoryPanel } from './ui/inventory-panel';
import { getSettings } from './settings/settings';
import { setMasterVolume, startAmbience, setTorchProximity } from './audio/sfx';
import { buildLevel, type LiveLevel } from './level/builder';
import { LEVEL_1, LEVELS } from './level/specs';
import { initLevelLoader, loadInitialLevel, loadLevel, tickPendingLoad } from './level/loader';
import { generateFloor } from './level/procgen';
import { generateSafeRoom } from './level/safe-room';
import { startNewRun, adoptSave, loadSave, clearSave, getRunState } from './state/run-state';
import { initRunStateListeners } from './state/run-state-listeners';
import { recordRunStart, resetRunDiscoveries } from './state/meta-state';
import { showStartScreen } from './ui/start-screen';
import { addItemSilently, clearInventory } from './player/inventory';
import { get as getEntity } from './ecs/world';
import type { EquipSlot } from './player/equipment';
import { getScenarioFromUrl, applyScenario } from './debug/scenarios';
import { isWorldFrozen } from './debug/freeze';
import { isWorldPausedByScreen, isAnyScreenOpen } from './ui/screen-manager';
import { spawn as spawnEntity } from './ecs/world';
import { tickAllBuffs } from './ecs/buffs';
import { initTriggerListener } from './ecs/triggers';
import { PASSIVES } from './content/passives';
import { setupPwaAutoUpdate } from './pwa-update';
import { tickInteractables, getInRangeInteractable, getAllInteractables } from './interactables/system';
import { findTapTarget } from './controls/tap-target';
import { triggerAttack, consumeAttackPressed } from './controls/attack-input';
import { initPickupLightPool } from './interactables/pickup';
import { initLightPool, tickLightPool } from './scene/light-pool';
import { initProjectilePool, tickProjectiles } from './combat/projectile-pool';
import { registerProjectiles } from './content/projectiles';
import { tickXpWisps, clearXpWisps } from './effects/xp-wisps';
import { tickGoldCoins, clearGoldCoins } from './effects/gold-coins';
import { updateOutline } from './interactables/outline';
import { ensureInteractLabel, updateInteractLabel } from './ui/interact-label';
import { createConsumableBar } from './controls/consumable-bar';
import { createHpBar, updateHpBar } from './ui/hp-bar';
import { createBuffBar, updateBuffBar } from './ui/buff-bar';
import { createPickupNotification } from './ui/pickup-notification';
import { createDepthCounter } from './ui/depth-counter';
import { createXpGoldHud, updateXpGoldHud } from './ui/xp-gold-hud';
import { tickLowHpPulse } from './ui/vignette';
import { getPlayerHp, getPlayerMaxHp } from './player/health';

// Best-effort landscape lock (no-op on iOS Safari and other unsupported envs).
try {
  const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
  so?.lock?.('landscape').catch(() => {});
} catch {
  // ignore — orientation API not supported here
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.PIXEL_RATIO_CAP));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.FOG_COLOR);
scene.fog = new THREE.Fog(CONFIG.FOG_COLOR, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);

const ambient = new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY);
scene.add(ambient);

// --- Art style ---
const style = getStyle();
const materials = buildMaterials(style);
initRenderPipeline(renderer);

// --- Camera ---
const camera = createFirstPersonCamera();
scene.add(camera); // required for the sword (camera child) to render

// --- Scenario (URL param ?scenario=...) ---
const scenario = getScenarioFromUrl();
const levelSpec = scenario?.level ?? LEVEL_1;

// --- Player entity (HP + buffs + passives live in the world) ---
// Spawn BEFORE buildLevel so enemies can already query player state during init.
spawnEntity({
  id: 'player',
  kind: 'player',
  hp: { base: CONFIG.PLAYER_HP_MAX, current: CONFIG.PLAYER_HP_MAX },
  buffs: [],
  // Reaper passive: kill an enemy → 2.7s of regen-pulse buff. Demonstrates
  // the trigger → effect → buff → buff-tick-effect chain working end-to-end.
  // Later this passive (or many like it) will come from equipped items.
  passives: [PASSIVES.reaper],
});
initTriggerListener('player');

// --- Level loader ----------------------------------------------------
// The loader owns the active LiveLevel. Stairs interact handlers schedule
// a load via the loader; tickPendingLoad applies it at the top of the
// next frame. Player state (HP, inventory, equipment, buffs) persists
// across loads — only the world is rebuilt.
//
// The active-level handle lives in `currentLevel` here so the main-loop
// tick code below can read it. Updated by the onLoaded callback below.
let currentLevel: LiveLevel & { checkRoomClear?: () => void } = null as unknown as LiveLevel;

initLevelLoader({
  scene,
  materials,
  camera,
  levels: LEVELS,
  onLoaded(level) {
    currentLevel = level as LiveLevel & { checkRoomClear?: () => void };
    setCameraYaw(level.playerSpawn.yaw);
  },
  // Procgen fallback — invoked when the stairs target a level id that's
  // not in the hand-authored LEVELS registry.
  //
  //   'safe-N'  → safe room AFTER floor N. Generated on demand; its
  //               stairs target depth-(N+1).
  //   anything else → the next procgen dungeon floor at depth N+1.
  //
  // Floors are seeded by the run start time so resume regenerates the
  // same floors. The safe room geometry is static so it doesn't need
  // a seed.
  generate(id, depth) {
    if (id.startsWith('safe-')) {
      // safe-N marks the safe room AFTER depth N. Pass N along so the
      // safe-room generator can wire its exit stairs to 'depth-N+1'.
      const prevDepth = parseInt(id.slice('safe-'.length), 10);
      return generateSafeRoom(Number.isFinite(prevDepth) ? prevDepth : depth - 1);
    }
    const run = getRunState();
    const runSeed = run?.startedAt ?? Date.now();
    // Procgen floors descend INTO a safe room first, not straight to
    // the next dungeon floor — the safe room's stairs do the second hop.
    const nextId = `safe-${depth}`;
    return generateFloor(depth, runSeed, nextId);
  },
});

// --- Player: held sword ---
const sword = createSword(camera);

// --- Player: handheld lamp ---
// Warm PointLight parented to the camera, offset to the off-hand
// position. Carries with the player everywhere and gives consistent
// near-field visibility — corners between torches no longer pitch-black.
attachLamp(camera);

// Sword viewmodel + combat stats are now driven REACTIVELY by the equipment
// slot system. Whenever the weapon slot changes (pickup, manual equip via
// the inventory panel, etc.), this listener swaps the visible model + the
// active stats. Single source of truth: equipment.
onEquipmentChanged((eq) => {
  if (eq.weapon?.viewmodel) sword.equip(eq.weapon.viewmodel);
  if (eq.weapon?.weapon) setCurrentWeapon(eq.weapon.weapon);
});

// --- Combat ---
// Combat queries enemies via a getter so the system follows level swaps —
// after descent the new floor's enemies become attackable without
// rewiring.
const combat = createCombatSystem(camera, sword, () => currentLevel.enemies);

// --- Player death wiring ---
onPlayerDeath(() => triggerDeath());

// --- Broadcast / DCC tribute layer ---
initAchievements();

// --- Input ---
// Attack is now triggered by tapping anywhere on the right half of the
// screen (in addition to the spacebar on desktop). No more on-screen
// attack button — less intrusive UI, larger hit area.
const input = createTouchInput(canvas, {
  onTap(clientX, clientY) {
    // Don't tap-target anything during dying or while screens are open.
    if (isDying() || isAnyScreenOpen()) return false;
    if (!currentLevel) return false;
    const hit = findTapTarget(
      clientX, clientY, canvas, camera,
      currentLevel.enemies,
      getAllInteractables(),
    );
    if (!hit) return false;
    if (hit.kind === 'enemy') {
      // Tapped an enemy anywhere on screen → fire an attack. Combat's
      // cone check handles whether the swing actually lands; tap just
      // signals intent.
      triggerAttack();
      return true;
    }
    // Interactable: only if it's in range AND has an active prompt.
    // Range is owned by the interactables system via getInRangeInteractable;
    // anything else would let the player use a chest from across the room.
    const inRange = getInRangeInteractable();
    if (inRange && inRange.id === hit.interactable.id) {
      hit.interactable.onUse();
      return true;
    }
    // Out of range — let the tap fall through (right-side becomes a swing,
    // left-side does nothing). Some feedback "too far" would help here
    // later; ignoring is fine for V1.
    return false;
  },
  onInteract() {
    // E key (or future gamepad confirm) — use the currently in-range
    // interactable, no screen position needed. Same gate as the tap
    // path: not during dying or open screens.
    if (isDying() || isAnyScreenOpen()) return;
    const inRange = getInRangeInteractable();
    if (inRange) inRange.onUse();
  },
});
// Floating world-anchored interact label only — the corner USE button
// was removed. Interaction is now diegetic: tap the object directly
// (handled by tap-target raycast in the touch input handler).
ensureInteractLabel();
createConsumableBar();
// Backdrop and HUD-hide are now owned by the screen manager — created
// lazily when the first screen that needs them opens.
createSettingsMenu();
createInventoryPanel();

// Sync the master volume from persisted settings so saved volume is
// applied at boot (not just when the slider next moves).
setMasterVolume(getSettings().masterVolume);

// Start ambient loops (torch crackle bed + room drone) on the very first
// user gesture — AudioContext can't run before the user has touched the
// page, so we attach a one-shot listener that fires startAmbience once.
{
  const startOnce = () => {
    startAmbience();
    window.removeEventListener('pointerdown', startOnce);
    window.removeEventListener('touchstart', startOnce);
    window.removeEventListener('keydown', startOnce);
  };
  window.addEventListener('pointerdown', startOnce, { once: true });
  window.addEventListener('touchstart', startOnce, { once: true });
  window.addEventListener('keydown', startOnce, { once: true });
}

// Pre-warm: build/render every drop + enemy model once at boot so the first
// kill in-game doesn't pay shader-compile / JIT cost mid-fight. Also primes
// the item-thumbnail cache so the first inventory rebuild after a pickup is
// instant. Done after the renderer + level exist; before scenarios so an
// inventory-open scenario doesn't pay the cost on first frame.
warmupContent(renderer);

// Pre-allocate the pickup light pool. Lights live in the scene forever
// (idle = intensity 0, parked off-stage); pickups borrow and return them.
// This is what actually keeps drops lag-free: Three.js recompiles every
// material shader if the scene's light count changes mid-fight, but a
// fixed-count pool sidesteps that entirely.
// Global light pool — the perf-critical pool of N PointLight slots that
// every scene PointLight runs through. See src/scene/light-pool.ts.
// Must be initialized BEFORE any spawn that registers sources (torches,
// fountains, lamp, fill, etc.).
initLightPool(scene);
initPickupLightPool(scene);
// Projectile pool — pre-allocates the meshes + trail sprites that ranged
// enemies (and future spells/traps) rent at fire-time. Registers its own
// 'projectile' category lights into the light pool above. Projectile
// types are registered into a registry; register the built-in set now.
initProjectilePool(scene);
registerProjectiles();

// Run-state listeners — kill counter, items-found set, autosave on
// floor:loaded events. Wired before any level load so the initial
// floor entry is captured.
initRunStateListeners();

// PWA: poll for SW updates + auto-reload when a new SW takes over.
// Means a `git push` lands on Josh's installed home-screen app within a
// minute or two without him having to close and reopen it.
setupPwaAutoUpdate();

// --- HUD ---
createHpBar();
createBuffBar();
createPickupNotification();
createDepthCounter(1);  // hardcoded until floors system lands
createXpGoldHud();

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// --- Render loop ---
const clock = new THREE.Clock();
const shakeOffset = new THREE.Vector3();
const forwardScratch = new THREE.Vector3();

function tick() {
  // Apply any pending level swap BEFORE any per-frame reads on the level.
  // Stairs interactables call loadLevel() during the previous frame's
  // interactables tick; the swap lands here at the top of the next frame.
  tickPendingLoad();

  const realDt = Math.min(clock.getDelta(), 0.1);

  tickDeath(realDt);
  const scaledDt = realDt * getTimeScale();

  if (isFrozen() || isWorldFrozen() || isWorldPausedByScreen()) {
    // Hit-pause OR scenario freeze OR any menu open: skip all game updates,
    // drain look input so it doesn't snap if/when we unfreeze.
    input.lookDx = 0;
    input.lookDy = 0;
  } else {
    if (!isDying()) {
      input.tickInput(scaledDt);   // hybrid-look continuous rotation, if enabled
      updateCamera(camera, input, scaledDt, currentLevel.walkable, currentLevel.enemies);
    } else {
      input.lookDx = 0;
      input.lookDy = 0;
    }

    for (const t of currentLevel.torches) updateTorchlight(t, scaledDt);

    // Ambient torch crackle volume — sum of (1 - dist/range) across all
    // torches in earshot.
    let prox = 0;
    const earRange = 6;
    for (const t of currentLevel.torches) {
      const dx = t.position.x - camera.position.x;
      const dz = t.position.z - camera.position.z;
      const d = Math.hypot(dx, dz);
      if (d < earRange) prox += 1 - d / earRange;
    }
    setTorchProximity(prox);

    const attackPressed = isDying() ? false : consumeAttackPressed();
    combat.tick(attackPressed);

    sword.update(scaledDt);
    // Handheld lamp flicker. realDt — flicker shouldn't slow during
    // hit-pause (a frozen lamp looks broken).
    tickLamp(realDt);
    // Enemy sleep: skip update() for enemies far from the player. They
    // can't influence gameplay outside their own perception range
    // anyway; ticking them is GC + AI work for no visible result.
    // Threshold = 25m, comfortably past the deepest perception ranges
    // (wraith sight 12m). Player damage path still works since
    // takeDamage doesn't go through update().
    const playerX = camera.position.x;
    const playerZ = camera.position.z;
    const sleepDist2 = 25 * 25;
    for (const enemy of currentLevel.enemies) {
      // Dying enemies still tick (their death animation drives the
      // dissolve + lift each frame). Far-away mobs sleep regardless.
      if (!enemy.alive && !enemy.dying) continue;
      const dx = enemy.group.position.x - playerX;
      const dz = enemy.group.position.z - playerZ;
      if (dx * dx + dz * dz > sleepDist2) continue;
      // Phasing mobs (ghosts) use the obstacle-free nav grid; everyone
      // else uses the standard one that routes around props.
      const nav = enemy.phasing ? currentLevel.navPhasing : currentLevel.nav;
      enemy.update(scaledDt, camera.position, currentLevel.walkable, nav);
    }

    // XP wisps — home in on the player and absorb on contact. Lives
    // outside the enemy loop so a wisp survives past its spawner's
    // full retirement (mob disappears, wisps continue to player).
    tickXpWisps(scaledDt, camera.position);
    // Gold coins — fall to the floor, rotate, and vacuum to the player
    // when they walk within pickup radius.
    tickGoldCoins(scaledDt, camera.position);

    // Projectiles — integrate active projectiles, hit-test the player +
    // walls, retire on contact/expiry. Lives outside the enemy loop so
    // a shot survives the shooter's death and so future non-enemy spawn
    // sources (player wand, trap dart) can plug in.
    tickProjectiles(scaledDt, camera.position, currentLevel.walkable);

    // Room-clear detection — fires room:cleared events when a tracked
    // room's alive count hits zero. Doors listen for this to flip from
    // SEALED to OPEN. Cheap: handful of enemies per level.
    currentLevel.checkRoomClear?.();

    // Tick active buffs on all entities (heal-over-time, future DoTs, etc.)
    tickAllBuffs(scaledDt);
  }

  // Interact tick + UI run OUTSIDE the freeze gate so the in-range
  // detection + icon button persist through hit-pauses + scenarios. We
  // pass dt=0 when the world is frozen so animations (chest lid, pickup
  // bob, trap spike rise) don't advance — only the "what's in range" pass
  // refreshes. While a menu is open the button hides; tap target should
  // not steal touches from the inventory panel.
  camera.getWorldDirection(forwardScratch);
  const interactDt = (isFrozen() || isWorldFrozen() || isWorldPausedByScreen()) ? 0 : scaledDt;
  tickInteractables(interactDt, camera.position, forwardScratch);
  // Determine the current in-range interactable. Hidden while any screen
  // is open so the label doesn't poke through a panel's backdrop.
  const inRange = (isDying() || isAnyScreenOpen()) ? null : getInRangeInteractable();
  // Floating world-anchored label over the interactable — the SOLE
  // interact UI now. Updated each frame so
  // it tracks the target as camera moves.
  updateInteractLabel(inRange, camera, canvas);
  // Outline highlight on the in-range interactable. realDt (not scaled)
  // so the pulse animates at real-time even during hit-pause / scenarios.
  updateOutline(inRange, realDt);

  // HUD — poll-based; cheap and always accurate. Runs even when the
  // world is paused so the player can see HP / buff state in menus
  // and during hit-pause flashes. The consumable bar rebuilds itself
  // on inventory changes (event-driven), so no per-frame tick.
  updateHpBar();
  updateBuffBar();
  updateXpGoldHud(realDt);

  // Low-HP breathing vignette — peripheral red signal at <30% HP. Uses
  // realDt so it keeps breathing during hit-pause / scaled time.
  const maxHp = getPlayerMaxHp();
  tickLowHpPulse(realDt, maxHp > 0 ? getPlayerHp() / maxHp : 0);

  tickShake(realDt, shakeOffset);
  camera.position.add(shakeOffset);

  // Bind the N nearest registered light sources to the pool's actual
  // PointLight slots. Runs every frame, regardless of world freeze —
  // the visible lighting must update with camera movement even during
  // hit-pause / menus.
  // LOS check culls through-wall sources from the slot ranking — a
  // torch in the next room can't waste a slot even if its raw distance
  // is small. The active level's walkable region carries the wall
  // segments and the segment-vs-segment check.
  const walkable = currentLevel?.walkable;
  const los = walkable
    ? (ax: number, az: number, bx: number, bz: number) =>
        walkable.hasLineOfSight(ax, az, bx, bz)
    : undefined;
  tickLightPool(camera, los);

  renderWithStyle(renderer, scene, camera, style);

  camera.position.sub(shakeOffset);

  requestAnimationFrame(tick);
}

// ── Run start ──────────────────────────────────────────────────────────
// All the systems above are wired; we just don't have an active level
// (or a render loop) yet. The start screen owns the next step: either
// DESCEND (fresh run on depth-1) or CONTINUE (resume the saved floor).
//
// Scenario URLs (debug) bypass the title and jump straight into the
// requested level.

function applyState(saveData: ReturnType<typeof loadSave>) {
  // Reset inventory.
  clearInventory();
  // Hydrate inventory from save (or empty for new run).
  if (saveData) {
    for (const [id, count] of Object.entries(saveData.inventory)) {
      for (let i = 0; i < count; i++) addItemSilently(id);
    }
  }
  // Equipment — set saved slots, OR default starter weapon for new runs.
  if (saveData) {
    for (const [slot, itemId] of Object.entries(saveData.equipment)) {
      if (itemId && ITEMS[itemId]) setSlot(slot as EquipSlot, ITEMS[itemId]);
    }
    // Safety: if save somehow has no weapon, fall back so the player
    // isn't unarmed (would render as no held viewmodel).
    if (!saveData.equipment.weapon) setSlot('weapon', ITEMS['rusted-sword']);
  } else {
    setSlot('weapon', ITEMS['rusted-sword']);
  }
  // HP — restore to saved value, or full for new run.
  const player = getEntity('player');
  if (player?.hp) {
    player.hp.current = saveData ? saveData.hp : player.hp.base;
  }
}

function startRun(floorId: string, startDepth: number = 1) {
  loadInitialLevel(floorId, startDepth);
  camera.position.set(currentLevel.playerSpawn.x, CONFIG.PLAYER_HEIGHT, currentLevel.playerSpawn.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = currentLevel.playerSpawn.yaw;
  camera.rotation.x = 0;
  tick();
}

// Debug: `?fakemeta=1` seeds meta progress so title shows records +
// the CODEX/STASH buttons without requiring real playthrough.
if (new URLSearchParams(window.location.search).get('fakemeta') === '1') {
  localStorage.setItem('delve:meta', JSON.stringify({
    version: 2,
    runsAttempted: 7, runsDied: 6, deepestDepth: 4, totalKills: 31,
    totalPlayMs: 4 * 60 * 1000,
    enemiesSlain: ['rat', 'skirmisher', 'ghoul'],
    itemsFound: ['rusted-sword', 'scimitar', 'healing-potion', 'leather-gloves',
                 'worn-boots', 'ring-of-vigor', 'iron-coif'],
    notesRead: [
      'I came for the blade. I should have come for the door.',
      'They told us it was one floor. They counted wrong.',
    ],
    achievementsUnlocked: ['first-blood', 'untouched', 'depth-3-reached'],
    stash: [
      { id: 'a1', tier: 'uncommon', source: 'Untouched' },
      { id: 'a2', tier: 'rare', source: 'The Dungeon Notices' },
      { id: 'a3', tier: 'fabled', source: 'Magic Bypass' },
    ],
  }));
}
// Debug: `?fakesave=1` seeds a save so the title shows CONTINUE for snaps.
if (new URLSearchParams(window.location.search).get('fakesave') === '1') {
  localStorage.setItem('delve:save', JSON.stringify({
    version: 1, floorId: 'depth-2', depth: 2, hp: 4,
    inventory: { 'healing-potion': 2 },
    equipment: { weapon: 'scimitar' },
    startedAt: Date.now() - 240000, kills: 7, itemsFound: ['scimitar', 'healing-potion'],
  }));
}
// Debug hook for snapping the end screen — `?showEnd=1` skips game
// entirely, shows the end-screen with mocked stats.
if (new URLSearchParams(window.location.search).get('showEnd') === '1') {
  import('./ui/end-screen').then(({ showEndScreen }) => {
    showEndScreen(
      {
        depth: 2, kills: 7, itemsFound: 5, elapsed: '4:12',
        epitaph: 'she was unmade in the first dark.',
        discoveries: {
          enemies: ['wraith'],
          items: ['heartburn', 'bone-amulet'],
          notes: 2,
          newDepthRecord: true,
        },
      },
      () => window.location.reload(),
    );
  });
} else if (new URLSearchParams(window.location.search).get('showCodex') === '1') {
  import('./ui/codex-screen').then(({ showCodex }) => showCodex());
} else if (new URLSearchParams(window.location.search).get('showStash') === '1') {
  import('./ui/stash-screen').then(({ showStash }) => showStash());
} else if (scenario) {
  // Debug scenario — bypass title. Scenario may override the level
  // spec or use the default LEVEL_1.
  const floorId = scenario.level?.id ?? LEVEL_1.id;
  if (scenario.level) LEVELS[scenario.level.id] = scenario.level;
  setSlot('weapon', ITEMS['rusted-sword']);
  startRun(floorId);
  // Scenarios may want to mutate enemies / give items / open panels.
  // Runs AFTER startRun so currentLevel is populated.
  applyScenario(scenario, { level: currentLevel, sword, camera });
} else {
  // Normal boot — title screen, then DESCEND or CONTINUE.
  const save = loadSave();
  showStartScreen({
    hasSave: !!save,
    saveDepth: save?.depth,
    onDescend() {
      clearSave();
      startNewRun(LEVEL_1.id);
      recordRunStart();
      resetRunDiscoveries();
      applyState(null);
      startRun(LEVEL_1.id, 1);
    },
    onContinue() {
      const s = loadSave();
      if (!s) {
        // Save vanished between title render + click. Fall back to fresh.
        clearSave();
        startNewRun(LEVEL_1.id);
        recordRunStart();
        resetRunDiscoveries();
        applyState(null);
        startRun(LEVEL_1.id, 1);
        return;
      }
      adoptSave(s);
      // CONTINUE doesn't reset discoveries — it picks up where the
      // mid-run discovery tracking left off. (resetRunDiscoveries is
      // also implicitly fresh on first load since the module-level
      // discoveries object starts empty.)
      applyState(s);
      startRun(s.floorId, s.depth);
    },
  });
}
