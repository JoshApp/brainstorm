import * as THREE from 'three';
import { CONFIG } from '../config';
import type { DelveRenderer } from '../scene/create-renderer';
import type { LiveLevel } from '../level/builder';
import type { GameSystem } from '../engine/loop';
import { loadLevel } from '../level/loader';
import { setSimTurbo } from '../engine/frame-loop';
import { interpSync } from '../engine/render-interp';
import { initNavOverlay, setNavOverlay } from './nav-overlay';
import { initCullMap, setCullMap } from './cull-map';
import { mountBoneView, boneViewWanted, boneArmsWanted, preloadBoneHand }
  from './bone-hand';
import { mountGripBench, gripBenchWanted } from './grip-bench';
import { runOriginProbe, originProbeWanted } from './origin-probe';
import { stampSplat, stampSpray, emitGoreSplash } from '../scene/splat-map';
import { setGoreDebugEnabled } from './gore-debug';
import { bossEncounterDebug } from '../mobs/boss-encounter';
import { packTokenCount } from '../mobs/pack';
import { installBandedLightingWebGPU, setLeanLightingWebGPU } from '../style/banded-lighting-webgpu';
import { setPS1Scale } from '../style/render-frame';
import { setShadowMode } from '../scene/light-pool';
import { setOutlinesDisabled } from '../interactables/outline';
import { returnToTitle } from '../app-restart';
import { setGodMode } from '../player/health';
import { tryActivateRite } from '../combat/rites';
import { requestLux, showLuxCard, luxTour, LUX_BANDS } from './lux';
import { installPerfProbe } from './perf-probe';
import { installInspector } from './inspector';
import type { RoomCuller } from '../level/room-culling';
import { applyLook, LOOKS, LOOK_ORDER } from '../style/look-presets';
import { installObserver } from './observer';

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
  /** The live room culler, when the setting has one built. Owned by main.ts;
   *  passed as a thunk so the cull AUDIT (window.__cullAudit) can ask the real
   *  culler what it hid rather than a reconstruction of it. */
  getRoomCuller: () => RoomCuller | null;
  /** Puts the studio lighting rig on the whole loaded level. Owned by main.ts
   *  (it holds the renderer + ambient); the inspector calls it via this thunk. */
  enterLit: () => void;
}

export function installDevHooks(deps: DevHookDeps): void {
  const { renderer, scene, camera, systems, getLevel, getRunSeed } = deps;
  const w = window as unknown as Record<string, unknown>;

  // ── The room inspector — window.__insp + the ?insp=… URL family. The one
  // instrument that can answer "is this geometry correct" separately from
  // "does this room look good"; see debug/inspector.ts for why that matters.
  installInspector({ scene, camera, getLevel, enterLit: deps.enterLit });
  // THE OBSERVER — read-only queries + marks, for debugging geometry WITH Josh
  // rather than from screenshots of it. See debug/observer.ts. `scene` is handed
  // in as the raycast root: the level root is a child of it and comes and goes
  // per floor, so holding the scene means the observer survives a descent.
  installObserver({ level: () => getLevel()?.spec ?? null, camera: () => camera, root: () => scene });

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

  // ── ART DIRECTION: try a LOOK without implementing one ────────────────
  // window.__look('drawn') on the console, or ?look=drawn on the URL — the
  // whole point of style/look-presets.ts is that a look is data you can put on
  // the running game, so the contact sheet (npm run delve look) is just this
  // hook plus a screenshot. Applied AFTER the level builds, since the level
  // sets scene.fog from its own spec and would otherwise win.
  // ── REVEAL RATIO ON REAL MOBS ─────────────────────────────────────────────
  //
  // The lab settled the reveal modes with capsules. This runs the same question
  // against the ACTUAL roster in the ACTUAL renderer, which is the only version
  // that counts — a ghoul reads differently from a capsule because a ghoul is
  // the shape doing the reading.
  //
  // MUTATES the existing materials rather than replacing them. The game's
  // materials are NODE materials; swapping in a plain MeshStandardMaterial
  // would either break or quietly render through a different path, and a
  // comparison shot through a different path is not a comparison.
  //
  // Consequence, stated: EDGED is not reproducible this way. A rim is authored
  // into the material at build time and cannot be added by mutation, so these
  // ratios cover absorbed / reflected / self-lit only. The lab still owns the
  // edged question.
  //
  // EMISSIVE DOES NOT LIVE ON THE MATERIAL. build-model's installRevealWebGPU
  // bakes each part's emissive into a per-vertex attribute (`aRevealEmissive`)
  // so every creature colour shares one pipeline — so `m.emissive = …` is a
  // silent no-op on any mob with a rim or a dissolve, which is most of them.
  // The first run of this experiment shipped a sheet whose SELF-LIT leg had
  // simply never applied, and the cells looked plausible enough to believe.
  // Writing the attribute drives the REAL path instead of a parallel fake one —
  // and it has to be written for every mode, not just self-lit: an "absorbed"
  // mob that keeps its baked glow is not absorbed.
  // The attribute is per-VERTEX because a merged creature carries body and
  // accent in one geometry — which is also why a blanket fill is wrong: it
  // would blank the EYES, the one cue that makes an absorbed creature findable
  // at all. Bright vertices are left alone, the same guard the material path
  // uses, applied at the level the data actually lives at.
  const EYE_LUMA = 0.8;
  const setBakedEmissive = (mesh: THREE.Mesh, r: number, g: number, b: number): boolean => {
    const attr = mesh.geometry?.getAttribute?.('aRevealEmissive') as THREE.BufferAttribute | undefined;
    if (!attr) return false;
    for (let v = 0; v < attr.count; v++) {
      const mag = Math.max(attr.getX(v), attr.getY(v), attr.getZ(v));
      if (mag >= EYE_LUMA) continue;
      attr.setXYZ(v, r, g, b);
    }
    attr.needsUpdate = true;
    return true;
  };

  const applyReveal = (modes: ReadonlyArray<string>): number => {
    const level = getLevel();
    if (!level) return 0;
    let n = 0;
    level.enemies.forEach((e, i) => {
      const mode = modes[i % modes.length];
      e.group.traverse((o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mode === 'selflit') setBakedEmissive(mesh, 0.37, 0.77, 1.0);
        else setBakedEmissive(mesh, 0, 0, 0);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const raw of mats) {
          const m = raw as THREE.MeshStandardMaterial;
          if (!m || !m.color) continue;
          // Leave EYES alone — they are the identity cue that makes an absorbed
          // creature findable at all, and blanking them would test a rule
          // nobody proposed.
          if (m.emissiveIntensity && m.emissiveIntensity >= 1.8) continue;
          if (mode === 'absorbed') {
            m.color.setHex(0x121013);
            if (m.emissive) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
          } else if (mode === 'reflected') {
            m.color.setHex(0xeee8dc);
            if (m.emissive) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
          } else if (mode === 'selflit') {
            m.color.setHex(0x14161c);
            if (m.emissive) { m.emissive.setHex(0x5fc4ff); m.emissiveIntensity = 1.1; }
          }
          m.needsUpdate = true;
        }
      });
      n++;
    });
    return n;
  };
  w.__reveal = (modes: string[]) => applyReveal(modes);

  // STAGING PROBE. A scenario that spawns ten creatures the camera cannot see
  // produces a contact sheet of ten identical empty rooms — which reads as "the
  // styles are indistinguishable" rather than "nothing was in frame." That
  // happened; this is the instrument that would have caught it in one call.
  // Reports each enemy's world position, its normalised device coords (|x|,|y|
  // < 1 and z < 1 = on screen) and its distance, so posing a lab scenario is a
  // measurement instead of a guess.
  // Scale every creature's RIM in place. The rim colour·intensity rides on the
  // aRevealRim vec4 (xyz), same per-vertex trick as the emissive, so this drives
  // the shipping path — and it answers a question the material spec cannot:
  // a fresnel rim on a SMOOTH revolved body (the acolyte's robe is one lathe)
  // grazes across most of the visible silhouette rather than edging it, so a
  // 0.4-intensity "rim" can read as a solid colour wash. __mobRim(0) vs
  // __mobRim(1) separates "the robe is green" from "the rim is washing it".
  w.__mobRim = (scale: number) => {
    const level = getLevel();
    if (!level) return 0;
    let touched = 0;
    level.enemies.forEach((e) => {
      e.group.traverse((o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const attr = mesh.geometry?.getAttribute?.('aRevealRim') as THREE.BufferAttribute | undefined;
        if (!attr) return;
        for (let v = 0; v < attr.count; v++) {
          attr.setXYZW(v, attr.getX(v) * scale, attr.getY(v) * scale, attr.getZ(v) * scale, attr.getW(v));
        }
        attr.needsUpdate = true;
        touched++;
      });
    });
    return touched;
  };

  // Hide/show the whole roster. Pairs with __mobs for the POP SCORE probe:
  // shoot the frame, hide the mobs, shoot it again, and the pixels that changed
  // are exactly the creature pixels — which turns "does it read against the
  // room" from an argument about a thumbnail into a per-pixel measurement.
  w.__mobsVisible = (on: boolean) => {
    const level = getLevel();
    if (!level) return 0;
    level.enemies.forEach((e) => { e.group.visible = on; });
    return level.enemies.length;
  };

  // Leave the run for the title, the way abandon / quit / death-continue do.
  // Exists because that path had a bug nobody could reproduce without a phone
  // in hand: the swap dressed itself as a descent ("descending" + a progress
  // bar over the menu), so quitting read as the app restarting. Headless can
  // drive it now and assert on what actually appears.
  w.__toTitle = () => { returnToTitle(); return 'returning'; };

  // Interactable population census — window.__interactables() for the table,
  // .json for the rows. The counterpart to __mobs for the OTHER big population;
  // a phone recording put interactables above the level shell in mesh count,
  // and this splits that total by kind so the fix targets the mass.
  w.__interactables = async () => {
    const m = await import('../interactables/census');
    // eslint-disable-next-line no-console
    console.log(m.interactableCensusText());
    return m.interactableCensus();
  };

  w.__mobs = () => {
    const level = getLevel();
    if (!level) return { n: -1, onScreen: 0, mobs: [] as unknown[] };
    const p = new THREE.Vector3();
    camera.updateMatrixWorld();
    const mobs = level.enemies.map((e, i) => {
      e.group.getWorldPosition(p);
      const ndc = p.clone().project(camera);
      const on = Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1;
      return {
        i, id: e.kind, alive: e.alive, vis: e.group.visible,
        pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)],
        dist: +camera.position.distanceTo(p).toFixed(2),
        onScreen: on,
      };
    });
    return { n: mobs.length, onScreen: mobs.filter((m) => m.onScreen).length, mobs };
  };

  w.__look = (id: string) => {
    const ok = applyLook(id, scene);
    const preset = LOOKS[id];
    if (preset?.reveal) applyReveal(preset.reveal);
    return ok;
  };
  w.__looks = () => LOOK_ORDER.map((id) => ({ id, name: LOOKS[id].name, note: LOOKS[id].note }));
  {
    const wanted = new URLSearchParams(window.location.search).get('look');
    if (wanted && LOOKS[wanted]) {
      // One frame after boot: the level build assigns fog from the level spec,
      // so a look applied during module init is overwritten before it renders.
      // Two frames out, not one: the level build assigns fog, and the ENEMIES
      // are spawned after it — a reveal applied at frame 0 would re-skin an
      // empty roster and silently do nothing.
      setTimeout(() => {
        applyLook(wanted, scene);
        const preset = LOOKS[wanted];
        if (preset?.reveal) applyReveal(preset.reveal);
      }, 400);
    }
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
  // SMASH the first N destructibles — exercises the real break path (loot roll,
  // shatter burst, walkable splice, and the static batch's instance retirement)
  // without swinging a sword at them. The batch case is why this exists: once a
  // vase's meshes live inside a floor-wide BatchedMesh, removing its group from
  // the scene draws nothing down, and the only way to catch a regression there
  // is to break one and look.
  w.__smash = (n = 1) => {
    const level = getLevel();
    if (!level) return { smashed: 0, error: 'no level' };
    let smashed = 0;
    for (const d of level.destructibles) {
      if (smashed >= n) break;
      if (!d.alive) continue;
      d.takeDamage({ amount: 999, kind: 'melee', source: 'player' } as never);
      smashed++;
    }
    return { smashed, remaining: level.destructibles.filter((d) => d.alive).length };
  };
  // __finisher() — open the execution hush without having to poise-break a mob,
  // charge a heavy and land the kill. The ceremony is a 0.6s window with a warm
  // close-in and a narrowed view, so the only way to LOOK at it (snap, or a
  // desktop eyeball) is to be able to hold it open on demand.
  // `holdMs` re-opens the hush on a short interval so it stays pinned at its
  // deepest point for that long — a 0.6s window is not something a headless
  // screenshot can be aimed at.
  w.__finisher = async (holdMs = 0) => {
    const { triggerFinisher, finisherIntensity } = await import('../combat/finisher');
    triggerFinisher();
    if (holdMs > 0) {
      const id = setInterval(() => triggerFinisher(), 100);
      setTimeout(() => clearInterval(id), holdMs);
    }
    return { intensity: finisherIntensity() };
  };
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
  // __forge() — open the blacksmith forge screen (with gold) for previewing.
  w.__forge = async () => {
    const [{ openForgeSheetForDebug }, { grantGold }] = await Promise.all([
      import('../interactables/blacksmith'), import('../state/run-state'),
    ]);
    grantGold(500);
    openForgeSheetForDebug();
  };
  // The bone-hand look-at-it loop — ?boneview=1 shows the bone hand beside the authored one
  // at a fixed distance, so iterating costs a reload rather than a descent.
  if (boneViewWanted()) mountBoneView(camera);
  // Start the asset early. composeHeldWeapon is synchronous and falls back to the authored
  // hand if the file has not landed, so the load wants every second it can get between boot
  // and the first equip; a late arrival is picked up on the next weapon swap.
  if (boneArmsWanted()) void preloadBoneHand();
  // The grip bench — ?gripbench=1 puts the COMPOSED hand and weapon close and turning, because
  // in every scenario the viewmodel's hand sits at the bottom edge of the frame and a grip
  // cannot be judged from a millimetre report alone.
  // ?originprobe=1 — report anything sizeable parked at the world origin, a few seconds in so
  // the level and every persistent system have settled.
  if (originProbeWanted()) {
    setTimeout(() => runOriginProbe(scene), 4000);
    setTimeout(() => runOriginProbe(scene), 9000);
  }
  if (gripBenchWanted()) {
    if (boneArmsWanted()) void preloadBoneHand().then(() => mountGripBench(camera));
    else mountGripBench(camera);
  }

  // The cull map — the MAP chip on the instrumentation toolbar, window.__cullMap(),
  // ?cullmap=1, or press M. Reads the camera for the player marker and the FOV wedge.
  initCullMap(camera);
  w.__cullMap = (on?: boolean) => setCullMap(on);
  if (new URLSearchParams(location.search).get('cullmap') === '1') setCullMap(true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') setCullMap();
  });

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
  // ── CULL AUDIT ────────────────────────────────────────────────────────────
  // __cullAudit() — one measurement from where you stand: which rects the rays
  // can actually reach vs which the culler drew. `holes` non-empty means the
  // player is looking at a black gap right now.
  w.__cullAudit = (cols?: number, rows?: number) =>
    deps.getRoomCuller()?.audit(camera, { cols, rows }) ?? { error: 'culler off' };
  // __cullSweep() — the same measurement from EVERY doorway on the floor, at 12
  // yaws each, which is where the failures live (Josh's shots are all in a
  // corridor mouth or just short of one). Stands 1.2m back from each opening on
  // both sides, since a hole is directional. Returns the worst offenders.
  // __leaks() — does the world CLOSE from everywhere the player can stand?
  // Suspends culling first (an invisible room is not a hole in the sky) and
  // restores it after. See debug/leak-scan.ts.
  w.__leaks = async () => {
    const level = getLevel();
    if (!level) return { error: 'no level' };
    const { scanForLeaks, leakSamplePoints } = await import('./leak-scan');
    const culler = deps.getRoomCuller();
    culler?.setEnabled(false);
    try {
      return scanForLeaks(level, leakSamplePoints(level), CONFIG.PLAYER_HEIGHT);
    } finally {
      culler?.setEnabled(true);
    }
  };
  // __cullWhere(x, z, yaw) — teleport there and dump every crossing decision.
  w.__cullWhere = (x: number, z: number, yaw: number) => {
    const culler = deps.getRoomCuller();
    if (!culler) return { error: 'culler off' };
    (w.__teleport as (a: number, b: number, c: number) => void)(x, z, yaw);
    const audit = culler.audit(camera, { cols: 12, rows: 7 });
    return { audit: { holes: audit.holes, hits: audit.hits }, explain: culler.explain(camera) };
  };
  w.__cullDiag = () => {
    const level = getLevel();
    if (!level) return { error: 'no level' };
    const rects = [...level.spec.rooms.filter((r) => !r.logicalOnly), ...level.spec.corridors];
    return {
      rooms: level.spec.rooms.length, corridors: level.spec.corridors.length, rects: rects.length,
      centreOk: rects.map((r) => level.walkable.contains(r.rect.x, r.rect.z, 0.3)),
      camOk: level.walkable.contains(camera.position.x, camera.position.z, 0.3),
      cam: [+camera.position.x.toFixed(1), +camera.position.z.toFixed(1)],
      first: rects.slice(0, 4).map((r) => [r.id, +r.rect.x.toFixed(1), +r.rect.z.toFixed(1)]),
    };
  };
  w.__cullSweep = (yaws = 12, standoff = 1.2) => {
    const culler = deps.getRoomCuller();
    const level = getLevel();
    if (!culler || !level) return { error: culler ? 'no level' : 'culler off' };
    const spots: Array<{ x: number; z: number }> = [];
    const rects = [...level.spec.rooms.filter((r) => !r.logicalOnly), ...level.spec.corridors];
    for (const r of rects) spots.push({ x: r.rect.x, z: r.rect.z });   // centres too
    // Every rect boundary midpoint the walkable grid says you can stand near —
    // a cheap stand-in for "doorway", and a superset of it.
    for (const r of rects) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ex = r.rect.x + dx * (r.rect.w / 2 + standoff);
        const ez = r.rect.z + dz * (r.rect.d / 2 + standoff);
        if (level.walkable.contains(ex, ez, 0.3)) spots.push({ x: ex, z: ez });
      }
    }
    const worst: Array<Record<string, unknown>> = [];
    let samples = 0, withHoles = 0, sumDrawn = 0, sumRects = 0;
    const px = camera.position.x, pz = camera.position.z, pyaw = camera.rotation.y;
    for (const s of spots) {
      if (!level.walkable.contains(s.x, s.z, 0.3)) continue;
      for (let i = 0; i < yaws; i++) {
        const yaw = (i / yaws) * Math.PI * 2;
        (w.__teleport as (x: number, z: number, y: number) => void)(s.x, s.z, yaw);
        const a = culler.audit(camera, { cols: 12, rows: 7 });
        samples++; sumDrawn += a.drawn.length; sumRects += rects.length;
        if (a.holes.length === 0) continue;
        withHoles++;
        const top = a.holes[0];
        worst.push({ x: +s.x.toFixed(2), z: +s.z.toFixed(2), yaw: +yaw.toFixed(2),
                     id: top.id, rays: top.rays, of: a.hits, nearest: +top.nearest.toFixed(1),
                     why: top.why, drawn: a.drawn.length });
      }
    }
    (w.__teleport as (x: number, z: number, y: number) => void)(px, pz, pyaw);
    worst.sort((a, b) => (b.rays as number) - (a.rays as number));
    return { samples, withHoles, pct: +(100 * withHoles / Math.max(1, samples)).toFixed(1),
             meanDrawn: +(sumDrawn / Math.max(1, samples)).toFixed(2),
             meanOf: +(sumRects / Math.max(1, samples)).toFixed(1),
             worst: worst.slice(0, 20) };
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
  // The live level, for probes that need its rooms + enemy list directly
  // (stuck-mob sweeps walk every room by rect centre). Read-only in practice.
  w.__level = () => getLevel();

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
