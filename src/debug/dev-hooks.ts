import * as THREE from 'three';
import { CONFIG } from '../config';
import type { DelveRenderer } from '../scene/create-renderer';
import type { LiveLevel } from '../level/builder';
import type { GameSystem } from '../engine/loop';
import { loadLevel } from '../level/loader';
import { setSimTurbo } from '../engine/frame-loop';
import { interpSync } from '../engine/render-interp';
import { initNavOverlay, setNavOverlay } from './nav-overlay';
import { stampSplat, stampSpray, emitGoreSplash } from '../scene/splat-map';
import { setGoreDebugEnabled } from './gore-debug';
import { bossEncounterDebug } from '../mobs/boss-encounter';
import { packTokenCount } from '../mobs/pack';
import { installBandedLightingWebGPU, setLeanLightingWebGPU } from '../style/banded-lighting-webgpu';
import { setPS1Scale } from '../style/render-frame';
import { setShadowMode } from '../scene/light-pool';
import { setOutlinesDisabled } from '../interactables/outline';
import { setGodMode } from '../player/health';
import { tryActivateRite } from '../combat/rites';
import { requestLux, showLuxCard, luxTour, LUX_BANDS } from './lux';
import { installPerfProbe } from './perf-probe';

// DEV-only console hooks + URL overrides — every window.__* inspection handle
// and DEV URL flag that used to live inline in main.ts. Called ONLY inside an
// `if (import.meta.env.DEV)` block, so the whole module (and everything only
// it imports) tree-shakes out of the production bundle.

export interface DevHookDeps {
  renderer: DelveRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  weapon: { getPhase: () => string; isStriking: boolean; isSwinging: boolean };
  systems: GameSystem[];
  getLevel: () => (LiveLevel & { checkRoomClear?: () => void }) | null;
  getRunSeed: () => number;
}

export function installDevHooks(deps: DevHookDeps): void {
  const { renderer, scene, camera, systems, getLevel, getRunSeed } = deps;
  const w = window as unknown as Record<string, unknown>;

  // ── URL overrides (snap/compare isolation) ────────────────────────────
  // ?ps1=0.3 forces the scene-render scale.
  const ps1 = Number(new URLSearchParams(window.location.search).get('ps1'));
  if (ps1 > 0) setPS1Scale(ps1);
  // ?shadows=off|hero|single|all forces a mode without touching the setting.
  const sm = new URLSearchParams(window.location.search).get('shadows');
  if (sm === 'off' || sm === 'hero' || sm === 'single' || sm === 'all') setShadowMode(sm);
  // ?nooutline=1 disables the interaction-outline system so a perf scenario can
  // isolate the rest of the frame from its inverted-hull overdraw.
  if (new URLSearchParams(window.location.search).get('nooutline') === '1') setOutlinesDisabled(true);
  // ?god=1 — invulnerable, for posing combat states without dying. setGodMode
  // itself is DEV-gated too (belt-and-suspenders).
  if (new URLSearchParams(window.location.search).get('god') === '1') setGodMode(true);
  // ?autodrink=1 — loop the flask drink forever (re-hurt, refill, drink) so a
  // headless `snap flask --frames=N` catches the raise/sip/lower without input.
  // Pair with ?scenario=flask.
  if (new URLSearchParams(window.location.search).get('autodrink') === '1') {
    void (async () => {
      const [{ requestFlaskDrink, isDrinkingFlask }, { refillFlask }, health] = await Promise.all([
        import('../player/flask-drink'),
        import('../player/flask'),
        import('../player/health'),
      ]);
      setInterval(() => {
        if (isDrinkingFlask()) return;
        refillFlask();
        if (health.getPlayerHp() >= health.getPlayerMaxHp()) health.damagePlayer(5, null, 'physical', true);
        requestFlaskDrink();
      }, 2000);
    })();
  }

  // ── GPU / material forensics ──────────────────────────────────────────
  // Per-stage GPU breakdown probe — prices bloom/shadow/grade by difference
  // against the native timestamp timer.
  w.__gpuBreakdown = () => import('./gpu-breakdown').then((m) => m.gpuBreakdown(renderer, scene));
  // Telemetry export — download the local play history (meta + event ring) as
  // JSON for offline balancing: `__telemetry()` then `npm run delve stats <file>`.
  w.__telemetry = () => import('./telemetry-export').then((m) => m.exportTelemetry());
  w.__telemetryClear = () => import('../telemetry/telemetry').then((m) => m.clearTelemetryLog());
  // Pooled-material counts — the pipeline-budget invariant (docs/PIPELINE-BUDGET.md):
  // these must PLATEAU as you descend, not climb per floor. Climbing = a `new Material`
  // leaking past the pools (stdMat for static, createMaterial for models).
  w.__floorMats = () => import('../style/material-registry').then((m) => ({ floor: m.floorMaterialCount(), total: m.totalMaterialCount() }));
  // Banded / lean lighting-model A/B. __setLean forces every node material to
  // recompile so the change is visible on the LIVE scene.
  w.__setBanded = (on: boolean) => installBandedLightingWebGPU(on);
  w.__setLean = (on: boolean) => {
    setLeanLightingWebGPU(on);
    scene.traverse((o) => {
      const mo = o as THREE.Mesh;
      const mats = mo.material ? (Array.isArray(mo.material) ? mo.material : [mo.material]) : [];
      mats.forEach((m) => { if ((m as { isNodeMaterial?: boolean }).isNodeMaterial) m.needsUpdate = true; });
    });
  };
  w.__renderer = renderer;   // program-cache forensics
  w.__scene = scene;         // raw scene access for live debugging
  // window.__perf for the headless perf runner (scripts/perf.ts).
  installPerfProbe(renderer);
  // Shader-warmup forensics. __progDiff() seeds a baseline of the CURRENT
  // compiled-pipeline cache on first call, then on every later call returns the
  // keys that compiled SINCE the seed — i.e. exactly what warmup MISSED. Pass
  // true to reseed. Pair with ?autobot=1: seed, let the bot play a few floors,
  // call again → the list is the precise warmup gap.
  {
    let baseline: Set<string> | null = null;
    const keysNow = (): string[] => {
      const caches = (renderer as unknown as { _pipelines?: { caches?: Map<string, unknown> } })._pipelines?.caches;
      return caches ? [...caches.keys()] : [];
    };
    w.__progDiff = (reseed = false) => {
      const now = keysNow();
      if (!baseline || reseed) {
        baseline = new Set(now);
        return { seeded: baseline.size };
      }
      const gap = now.filter((k) => !baseline!.has(k));
      const byType: Record<string, number> = {};
      for (const k of gap) { const t = k.split(',')[0]; byType[t] = (byType[t] ?? 0) + 1; }
      return { baseline: baseline.size, now: now.length, compiledSinceSeed: gap.length, byType, keys: gap };
    };
  }

  // ── World / repro hooks ───────────────────────────────────────────────
  // __descend() walks the run one floor down through the SAME loadLevel path
  // the stairs use.
  w.__descend = () => {
    const next = getLevel()?.spec.stairs?.[0]?.targetLevel;
    if (next) loadLevel(next);
    return next ?? null;
  };
  // __shop('merchant'|'reliquary') — open the shop HUD with rolled stock + a
  // purse of gold, for previewing the shop screen (snap) without walking a stall.
  w.__shop = async (table?: string) => {
    const [{ rollShopStock }, { openShopScreen }, { grantGold }] = await Promise.all([
      import('../content/shop'), import('../ui/shop-screen'), import('../state/run-state'),
    ]);
    grantGold(500);
    const t = table === 'reliquary' ? 'reliquary' : 'merchant';
    openShopScreen(rollShopStock(3, 5, undefined, t as never),
      t === 'reliquary' ? { title: 'THE RELIC-KEEPER' } : {});
  };
  // Nav-grid debug overlay — window.__navDebug() / ?navdebug=1 / press N.
  initNavOverlay(scene, () => getLevel() as never);
  w.__navDebug = (on?: boolean) => setNavOverlay(on);
  if (new URLSearchParams(location.search).get('navdebug') === '1') setNavOverlay(true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') setNavOverlay();
  });
  // Live sim fast-forward for bot/headless testing — window.__turbo(3) etc.
  w.__turbo = (n: number) => setSimTurbo(n);
  // Harness-bot pathfinding forensics — route from the player to the nearest
  // enemy (or a given world point), returning the chosen dir + the raw grid path.
  w.__navTest = async (to?: { x: number; z: number }) => {
    const level = getLevel();
    if (!level) return { error: 'no level' };
    const { makeNav } = await import('../harness/pathfind');
    const nav = makeNav(level.nav);
    const from = { x: camera.position.x, z: camera.position.z };
    const e = (level as { enemies?: Array<{ group: THREE.Object3D; alive: boolean }> }).enemies?.find((x) => x.alive);
    const target = to ?? (e ? { x: e.group.position.x, z: e.group.position.z } : from);
    return { from, target, dir: nav.dirToward(from, target), path: nav._debugPath };
  };
  // Gore stamps thrown from the camera.
  w.__stamp = (r = 1.2, a = 1.0, spray = false) => {
    if (spray) {
      const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);
      stampSpray(camera.position.x + fx * 1.5, camera.position.z + fz * 1.5, r, 0x8a1812, a, fx, fz);
    } else {
      stampSplat(camera.position.x, camera.position.z, r, 0x8a1812, a);
    }
    return [camera.position.x.toFixed(1), camera.position.z.toFixed(1)];
  };
  w.__goreDebug = (on = true) => { setGoreDebugEnabled(on); return on; };
  // __gore(e): full impact splash 1.2m ahead, thrown along the view.
  w.__gore = (e = 1.0) => {
    const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);
    emitGoreSplash(camera.position.x + fx * 1.2, camera.position.z + fz * 1.2, 1.0, fx, fz, e, 0x8a1812);
    return 'splashed';
  };
  // __teleport(x, z, yaw?): move the player camera. Headless repro aid.
  w.__teleport = (x: number, z: number, yaw = 0) => {
    camera.position.set(x, CONFIG.PLAYER_HEIGHT, z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = 0;
    // Hard teleport outside the sim step — re-seed render-interp or
    // interpRestore snaps the camera straight back (same trap as
    // inspect-mode framing / the OOB-on-descent fix).
    interpSync([camera]);
  };
  // __dropItem(id, dist?): spawn a real floor pickup ahead of the camera —
  // loot-flow repro (auto-pickup, carry caps, flask pours) without a chest.
  w.__dropItem = async (id: string, dist = 1.0) => {
    const [{ ITEMS }, { createPickup }] = await Promise.all([
      import('../content/items'), import('../interactables/pickup'),
    ]);
    const item = ITEMS[id];
    if (!item) return `unknown item '${id}'`;
    const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);
    createPickup(scene, new THREE.Vector3(
      camera.position.x + fx * dist, 0.35, camera.position.z + fz * dist), item);
    return id;
  };
  // __flask() / __flaskSpend(): read + drain flask charges — headless asserts.
  w.__flask = async () => (await import('../player/flask')).getFlask();
  w.__flaskSpend = async () => (await import('../player/flask')).spendCharge();
  // __smite(r): lethal damage to every enemy within r metres of the camera,
  // through the REAL damage pipeline — death/dissolve/corpse paths run exactly
  // as in combat. Headless corpse-bug repro.
  w.__smite = (r = 6) => {
    const killed: string[] = [];   // kind@x,z of each kill
    for (const e of getLevel()?.enemies ?? []) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - camera.position.x, e.position.z - camera.position.z);
      if (d > r) continue;
      e.takeDamage({ source: null, target: e.entityId, base: 99999, type: 'physical' });
      killed.push(`${e.kind}@${e.position.x.toFixed(1)},${e.position.z.toFixed(1)}`);
    }
    return killed;
  };
  // __sceneScan(x,z,r) names every mesh near a world point (parent chain
  // included) so a mystery object in a screenshot can be interrogated.
  w.__sceneScan = (x: number, z: number, r = 1.5) => {
    const found: Array<{ name: string; type: string; center: number[]; radius: number; visible: boolean; chain: string }> = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      // Bounding sphere in WORLD space — world-baked merged meshes sit at
      // transform origin with their geometry elsewhere; the bounds are where
      // the pixels actually are.
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere!;
      const c = bs.center.clone().applyMatrix4(m.matrixWorld);
      const scale = m.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
      const wr = bs.radius * scale;
      if (Math.hypot(c.x - x, c.z - z) - Math.min(wr, 3) > r) return;
      if (wr > 8) return;   // room-scale merges: not a "body"
      const chain: string[] = [];
      let n: THREE.Object3D | null = m;
      while (n && chain.length < 6) { chain.push(n.name || n.type); n = n.parent; }
      found.push({
        name: m.name || '(unnamed)', type: m.type,
        center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
        radius: +wr.toFixed(2), visible: m.visible,
        chain: chain.join(' < '),
      });
    });
    return found;
  };
  // Fire the equipped rite from the console.
  w.__rite = tryActivateRite;
  // Headless lux API (scripts/lux-scan.ts drives it via playwright).
  w.__lux = {
    measure: () => requestLux().then((res) => { showLuxCard(res); return res; }),
    tour: () => luxTour(),
    bands: LUX_BANDS,
  };

  // ── Boss / pack observation ───────────────────────────────────────────
  // Drive + inspect multi-phase boss fights from the console or a headless
  // chrome-devtools session without grinding combat:
  //   __boss.info()      → { encounter, phase: { index, count } }
  //   __boss.phase(n)    → jump to phase n INSTANTLY (settled pose)
  //   __boss.advance()   → trigger the NEXT phase WITH its collapse animation
  // Reads the live boss lazily so it follows floor swaps.
  const findBoss = () => getLevel()?.enemies.find((e) => e.isBoss && e.alive);
  const bossApi = {
    info: () => ({ encounter: bossEncounterDebug(), phase: findBoss()?.bossPhaseInfo() ?? null }),
    phase: (n: number) => { findBoss()?.setDebugBossPhase(n); return bossApi.info(); },
    advance: () => { findBoss()?.debugAdvanceBossPhase(); return bossApi.info(); },
  };
  w.__boss = bossApi;
  // Pack/AI observation: per-enemy distance + bearing to the player + AI state.
  // Lets a headless probe confirm a crowd RINGS (bearings spread, dist ≈ strike
  // range) vs PILES (dist ≈ 0, bearings clustered). Drives pack tuning.
  w.__mobPack = () => {
    const lvl = getLevel(); if (!lvl) return null;
    const px = camera.position.x, pz = camera.position.z;
    const mobs = lvl.enemies.filter((e) => e.alive).map((e) => {
      const dx = e.position.x - px, dz = e.position.z - pz;
      const dist = Math.hypot(dx, dz) || 1;
      // Facing error: angle between the model's forward (-Z → (-sinθ,-cosθ))
      // and the unit vector TOWARD the player. 0° = looking at you, 180° = back
      // turned. This is the "half face away" measurement.
      const yaw = (e as unknown as { yaw: number }).yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const tox = -dx / dist, toz = -dz / dist;
      const faceErr = Math.round(Math.acos(Math.max(-1, Math.min(1, fx * tox + fz * toz))) * 180 / Math.PI);
      return {
        kind: e.kind, state: e.aiState,
        dist: Math.round(dist * 100) / 100,
        faceErr,   // degrees off from looking at the player
      };
    });
    return { tokens: packTokenCount(), mobs };
  };

  // ── Fixed-step sim stepper (window.__sim) ─────────────────────────────
  // Runs ONLY the kind:'sim' systems by hand at a fixed timestep — the
  // headless / deterministic-replay substrate, distinct from the real-time
  // ?harness path.
  void import('./sim-stepper').then((m) =>
    m.installSimStepper({
      systems,
      getLevel: () => getLevel() as never,
      getCamera: () => camera,
      getSeed: getRunSeed,
      getSwing: () => ({
        phase: deps.weapon.getPhase(),
        striking: deps.weapon.isStriking,
        swinging: deps.weapon.isSwinging,
      }),
    }),
  );
}
