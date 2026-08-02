import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelSpec, RoomSpec, TorchSpec, PropSpec, OpeningSpec } from './types';
import { spawnNetworkBloodstains } from './network-bloodstains';
import { WalkableRegion, type WallSegment, type Obstacle } from './walkable';
import { NavGrid } from './nav-grid';
import { buildElevationField, setElevationField, groundYAt } from './elevation';
import { CONFIG } from '../config';
import { buildAltarPillar, buildAltarBlock } from './altar-pillar-builders';
import { spawnVase, spawnVaseCluster, spawnBreakableDecoration, disposeDestructible, type Destructible } from './destructibles';
import type { StyleMaterials } from '../style/materials';
import { stdMat } from '../style/material-registry';
import { installPropHeightAO } from '../style/surface-ao';
import { createTorchlight, type Torch } from '../scene/torchlight';
import { wallFixtureModel } from './lit-fixture-pool';
import { createEnemy, disposeEnemy, type Enemy } from '../mobs/enemy';
import { createPickup } from '../interactables/pickup';
import { spawnGoldCoins } from '../effects/gold-coins';
import { kickShake } from '../combat/screen-shake';
import { registerBossMember, advanceBossPhase, onBossEncounterComplete } from '../mobs/boss-encounter';
import { spawnBossBonfire } from '../effects/boss-bonfire';
import { setBossPresentation } from '../mobs/boss-cinematics';
import { ENEMIES, type EnemySpec } from '../content/enemies';
import { threatensPlayer } from '../content/factions';
import { scaleEnemySpec } from '../content/modifiers';
import { buildModel } from '../ecs/build-model';
import { isPooledGeometry } from '../scene/geometry-pool';
import { deferGpuDispose } from '../style/render-webgpu';
import { spawnChest } from '../interactables/chest';
import { spawnGateOffering } from '../interactables/gate-offering';
import { spawnStashChest } from '../interactables/stash-chest';
import { spawnStarterAltar } from '../interactables/starter-altar';
import { spawnBloodAltar } from '../interactables/blood-altar';
import { spawnChallengeOffering } from '../interactables/challenge-offering';
import { ITEMS } from '../content/items';
import { rollCursedItem } from '../content/loot';
import { spawnTutorialHint } from '../effects/tutorial-hints';
import {
  spawnStairs,
  STAIRWELL_TOTAL_DEPTH,
  STAIRWELL_HALF_WIDTH,
} from '../interactables/stairs';
import { spawnCorpse } from '../interactables/corpse';
import { spawnWallRune } from '../interactables/wall-rune';
import { pickFallen } from '../content/corpses';
import { pickWallMark } from '../content/wall-marks';
import { rollDropItem, rollDropTable } from '../content/drop-tables';
import { registerSearchable } from '../interactables/searchable';
import type { ItemSpec } from '../content/items';
import { spawnFitting } from '../interactables/fitting';
import { applyShadowRole } from '../scene/shadow-role';
import { createArenaController, arenaEncounterId, type WaveSpec } from './arena-waves';
import { rollFloorEnemies } from './procgen';
import { registerEncounter, activateEncounter, clearEncounters, onEncounterActivated, onEncounterComplete, roomClearEncounterId, type EncounterHandle } from '../encounters/registry';
import { openingEndpoints } from './opening';
import { bindLight as bindRoomMoodLight, bindFlame as bindRoomMoodFlame, clearRoomMoodBindings } from './room-mood';
import { spawnSpikeTrap } from '../interactables/spike-trap';
import { spawnFountain } from '../interactables/fountain';
import { spawnMerchant } from '../interactables/merchant';
import { spawnTitheBasin } from '../interactables/tithe-basin';
import { spawnChandelier } from './chandelier';
import { BONFIRE } from '../content/bonfire';
import { ORIGIN_ARCH } from '../content/origin-arch';
import { registerFateFire } from './fate-fire';
import { clearFateGate } from '../state/fate-gate';
import { setSurfaceSeep, setSurfaceWetness } from '../style/surface-detail';
import { resetSplatMap } from '../scene/splat-map';
import { spawnReliquary } from '../interactables/reliquary';
import { spawnTomePillar } from '../interactables/tome-pillar';
import { registerLight, clearLightPool } from '../scene/light-pool';
import { decorateFloor } from './decorate';
import { seedBuildRng, buildRng, gameRng, hashStringToSeed } from '../engine/rng';
import { spawnThresholdDraft } from '../scene/threshold-draft';
import { installFrameFittings } from './frame';

// A boss's "signature colour" for the sealed-descent ward — its eye glow if it
// has one, else any material's rim colour, else a default arcane green. Used to
// tint the boss-gate so the seal reads as the boss's own power.
function bossWardColor(b: EnemySpec): number {
  const mats = b.creature?.materials ?? {};
  const eye = b.eyeMaterialName ? mats[b.eyeMaterialName] : undefined;
  if (eye?.emissive != null) return eye.emissive;
  if (eye?.color != null) return eye.color;
  for (const m of Object.values(mats)) if (m.rim?.color != null) return m.rim.color;
  return 0x88cc33;
}

// Local Mulberry32 seeded RNG — kept here to avoid importing procgen.ts
// (would create a cyclic dependency between builder and procgen).
function rngFromSeed(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Module-level counter for unique source ids across all level builds.
// Resets to a deterministic-enough range per build via the per-call
// declaration below. Could be per-level seeded but cross-level
// uniqueness is enough for our use.
let lightSerial = 0;
import { clearInteractables } from '../interactables/system';
import { emit } from '../broadcast/event-bus';

// Consumes a LevelSpec and produces the live scene + collision data. This is
// the seam where declarative data becomes Three.js objects + game entities.
//
// Returns:
//   - walkable: the collision region (queried by player and enemy each frame)
//   - torches: array of torch handles (light + flame, ticked each frame)
//   - enemies: array of enemy handles (state machine, ticked each frame)
//   - playerSpawn: where to put the camera + initial yaw

// ?bigfire=1.4 — event-presence knob for the level-up fire (read once, not per
// bonfire per floor). >1 scales each bonfire up + boosts its light pool.
const BIGFIRE = typeof location !== 'undefined'
  ? (Number(new URLSearchParams(location.search).get('bigfire')) || 1) : 1;

const PILLAR_DEFAULT_SIZE = 0.5;

// Reusable bbox scratch for measuring a prop's geometry top (the projectile
// ceiling default). Module-level so the level-build loop allocates nothing per prop.
const _propBox = new THREE.Box3();

export interface LiveLevel {
  spec: LevelSpec;
  walkable: WalkableRegion;
  /** Pathfinding grid for physical mobs (respects walls + obstacles). */
  nav: NavGrid;
  /** Phasing pathfinding grid for ghost mobs (respects walls only —
   *  obstacles are passable). Same dimensions as `nav`. */
  navPhasing: NavGrid;
  torches: Torch[];
  enemies: Enemy[];
  destructibles: Destructible[];
  playerSpawn: { x: number; z: number; yaw: number };
  /**
   * Single Three.js group containing EVERYTHING the level added to the
   * scene — rooms, props, torches, enemies, doors, stairs. Teardown just
   * removes this from the scene + disposes meshes inside it.
   */
  root: THREE.Group;
  /**
   * Call to dispose this level: removes root from its parent, disposes
   * geometries/materials inside, clears interactables, destroys enemy
   * entities. Idempotent.
   */
  teardown: () => void;
}

// Procedural geometry factories (floor-with-holes, jittered planes, arched
// ceilings, mine bracing, chasm drops) live in geometry-prims.ts — pure,
// no game-state coupling. builder.ts composes the level from them.
import {
  makeFloorWithHoles,
  makeJitteredPlane,
  bakeFloorContactAO,
  bakeFloorPropContactAO,
  type PropContact,
  archCeilingMaterial,
  makeArchedCeilingGeometry,
  makeBracedFramesGeometry,
  makeChasmDropGeometry,
  makeCeilingShaftGeometry,
  makeSteppedRampGeometry,
} from './geometry-prims';
import { getPropAABB } from './prop-aabb';

function buildRoomShell(
  scene: THREE.Object3D,
  room: RoomSpec,
  allRects: RoomSpec[],
  materials: StyleMaterials,
  wallSegmentsOut: WallSegment[],
  floorHoles: Array<Array<[number, number]>> = [],
  obstaclesOut: Obstacle[] = [],
) {
  const { rect, height: H } = room;
  const W = rect.w;
  const D = rect.d;

  // ── ELEVATION ──────────────────────────────────────────────────────
  // Rooms sit flat at their elevation; a corridor whose two ends meet
  // rooms at different elevations becomes a RAMP (the elevation field
  // already lerps groundY along it — here we make the geometry agree).
  // Sample the field at both ends of the long axis to detect the slope.
  // Authored elevation when present (rooms); otherwise ask the FIELD at
  // the rect's centre. Corridors never carry an elevation of their own —
  // a FLAT corridor between two lowered rooms inherits their level here.
  // (It used to default to 0 and build its floor half a metre in the air,
  // walkable but floating over void — the walk samples the field, the
  // shell didn't.)
  const elev = room.elevation ?? groundYAt(rect.x, rect.z);
  // Slope detection samples along the RAMP axis. For corridors that's the
  // composer-stamped connection axis (rampAlongX) — NOT the rect's longer
  // side, which on a stubby wide corridor is perpendicular to travel and
  // would read the slope as flat, building a level floor mid-ramp that
  // matches neither room. Rooms (no rampAlongX) use the rect's long side.
  const alongX = room.rampAlongX ?? (W >= D);
  const eEnd0 = alongX
    ? groundYAt(rect.x - W / 2 + 0.05, rect.z)
    : groundYAt(rect.x, rect.z - D / 2 + 0.05);
  const eEnd1 = alongX
    ? groundYAt(rect.x + W / 2 - 0.05, rect.z)
    : groundYAt(rect.x, rect.z + D / 2 - 0.05);
  const sloped = Math.abs(eEnd1 - eEnd0) > 1e-3;
  const elevLo = Math.min(eEnd0, eEnd1, elev);
  const elevHi = Math.max(eEnd0, eEnd1, elev);

  // ── FLOOR GRATE (box-buster #5) ────────────────────────────────────
  // An iron grate flush with the floor over a recess that falls toward a
  // faint ember glow far below: the next depth, previewed. Walkable — the
  // playfield is 2D, the bars are the visual truth, so no obstacle is
  // registered. Floor event: independent of the ceiling breach/shaft
  // rolls, but skips rooms that already have floor holes (stairwells and
  // chasm voids own those). Hugs a wall like a drain should.
  const wantGrate =
    !room.logicalOnly &&
    !sloped &&
    floorHoles.length === 0 &&
    W >= 4.0 && D >= 4.0 &&
    buildRng() < CONFIG.GRATE_CHANCE;
  let grateRect: { cx: number; cz: number; s: number } | null = null;
  if (wantGrate) {
    const s = 1.1 + buildRng() * 0.4;
    const off = 0.9 + s / 2;   // wall-hugging distance, clear of the trim
    const side = Math.floor(buildRng() * 4);
    const slide = (span: number) => (buildRng() - 0.5) * Math.max(0, span - s - 2.4);
    const cx = side === 0 ? -W / 2 + off : side === 1 ? W / 2 - off : slide(W);
    const cz = side === 2 ? -D / 2 + off : side === 3 ? D / 2 - off : slide(D);
    grateRect = { cx, cz, s };
  }
  // Floor — with rectangular holes for stairwells in this room. Holes
  // path takes precedence over the jittered plane; without holes the
  // legacy subdivided + Z-jittered plane is used (visually richer
  // surface variation).
  const allFloorHoles = grateRect
    ? [...floorHoles, [
        [grateRect.cx - grateRect.s / 2, -(grateRect.cz - grateRect.s / 2)],
        [grateRect.cx + grateRect.s / 2, -(grateRect.cz - grateRect.s / 2)],
        [grateRect.cx + grateRect.s / 2, -(grateRect.cz + grateRect.s / 2)],
        [grateRect.cx - grateRect.s / 2, -(grateRect.cz + grateRect.s / 2)],
      ] as Array<[number, number]>]
    : floorHoles;
  // Sloped corridors get a stepped stair-run instead of a tilted plane —
  // the visual is cut stone treads following the linear grade; the eye
  // and collision glide the smooth line underneath (groundYAt).
  const floorGeo: THREE.BufferGeometry = sloped
    ? (makeSteppedRampGeometry(rect, groundYAt, CONFIG.STAIR_RISER_M, alongX)
        ?? makeJitteredPlane(W, D, { flat: true }))
    : allFloorHoles.length > 0
      ? makeFloorWithHoles(W, D, allFloorHoles)
      : makeJitteredPlane(W, D, { flat: true });
  const floor = new THREE.Mesh(floorGeo, materials.floor);
  if (!sloped) {
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(rect.x, elev, rect.z);
  }
  floor.receiveShadow = true;
  floor.name = 'floor';
  // Rect (+ whether it carries per-vertex colour) so the prop-contact AO pass
  // can find floors and darken them under props after props are placed.
  // Sloped ramps skip it (the bake assumes a flat plane).
  if (allFloorHoles.length === 0 && !sloped) floor.userData.aoRect = { x: rect.x, z: rect.z, w: W, d: D };
  floor.userData.dbgKind = 'floor';
  floor.userData.dbgSource = `floor · ${room.id} @(${rect.x.toFixed(1)},${rect.z.toFixed(1)})`;
  scene.add(floor);
  if (grateRect) {
    const gx = rect.x + grateRect.cx;
    const gz = rect.z + grateRect.cz;
    const s = grateRect.s;
    // Recess — same fade-to-black treatment as a chasm, just shallower.
    const recessGeo = makeChasmDropGeometry(
      [{ x: gx, z: gz, w: s, d: s }], CONFIG.GRATE_DEPTH_M, CONFIG.GRATE_FADE_M,
    );
    if (recessGeo) {
      const recess = new THREE.Mesh(recessGeo, materials.chasmWall);
      recess.position.y = elev;
      recess.receiveShadow = true;
      recess.name = 'grate-recess';
      recess.userData.dbgKind = 'floor';
      recess.userData.dbgSource = `grate-recess · ${room.id}`;
      scene.add(recess);
    }
    // The ember below — unlit plane floating just above the black bottom.
    // Its colour IS its brightness (basic material): a dim promise of the
    // inhabited depth, never competing with the lamp.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(s * 0.8, s * 0.8),
      new THREE.MeshBasicMaterial({ color: CONFIG.GRATE_GLOW_COLOR }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(gx, elev - CONFIG.GRATE_DEPTH_M + 0.5, gz);
    glow.name = 'grate-glow';
    glow.userData.dbgKind = 'floor';
    glow.userData.dbgSource = `grate-glow · ${room.id}`;
    scene.add(glow);
    // Bars — a perimeter frame + parallel rods, merged to ONE mesh. Dark
    // iron so the silhouette against the glow does the reading.
    const barGeos: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4();
    const railH = 0.045, railW = 0.075;
    const frame = (len: number, px: number, pz: number, alongX: boolean) => {
      const g = new THREE.BoxGeometry(alongX ? len : railW, railH, alongX ? railW : len);
      m4.makeTranslation(px, railH / 2, pz); g.applyMatrix4(m4);
      barGeos.push(g);
    };
    frame(s + railW, gx, gz - s / 2, true);
    frame(s + railW, gx, gz + s / 2, true);
    frame(s + railW, gx - s / 2, gz, false);
    frame(s + railW, gx + s / 2, gz, false);
    const nBars = Math.max(5, Math.floor(s / 0.16));
    for (let i = 1; i < nBars; i++) {
      const bx = gx - s / 2 + (i / nBars) * s;
      const g = new THREE.BoxGeometry(0.035, 0.035, s);
      m4.makeTranslation(bx, 0.03, gz); g.applyMatrix4(m4);
      barGeos.push(g);
    }
    const bars = new THREE.Mesh(
      mergeGeometries(barGeos, false),
      stdMat({ color: 0x15171b, roughness: 0.55, metalness: 0.55 }),
    );
    bars.position.y = elev;
    bars.receiveShadow = true;
    bars.name = 'grate-bars';
    bars.userData.dbgKind = 'floor';
    bars.userData.dbgSource = `grate-bars · ${room.id} @(${gx.toFixed(1)},${gz.toFixed(1)})`;
    scene.add(bars);
  }

  // Ceiling — flat plane by default; barrel/pitched build a custom arch that
  // springs from the wall-top (H) and rises to H+rise. Verticality without a
  // draw-call increase (still one ceiling mesh per room).
  const ceilStyle = room.ceilingStyle ?? 'flat';
  // ── CEILING BREACH (box-buster #3) ────────────────────────────────
  // Occasionally the level above broke through: a ragged hole in the
  // ceiling, a black cavity behind it, a snapped timber dangling, and
  // the rubble that fell sitting on the floor below. Render-only —
  // the rubble is ankle-high, walkable. Deterministic per floor seed.
  // Big flat-ceiling stone rooms only; never rooms with floor holes
  // (stairwells own those).
  const wantBreach =
    ceilStyle === 'flat' &&
    room.wallVariant !== 'braced' &&
    floorHoles.length === 0 &&
    !room.logicalOnly &&
    W >= 4.5 && D >= 4.5 && H >= 2.9 &&
    buildRng() < 0.10;
  let breachHole: Array<[number, number]> | null = null;
  let breachCx = 0, breachCz = 0;
  if (wantBreach) {
    // Ragged octagon, centre offset from the room centre, kept inside
    // the soffit border.
    breachCx = (buildRng() - 0.5) * (W - 3.2) * 0.5;
    breachCz = (buildRng() - 0.5) * (D - 3.2) * 0.5;
    const base = 0.65 + buildRng() * 0.4;
    breachHole = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = base * (0.7 + buildRng() * 0.6);
      breachHole.push([breachCx + Math.cos(a) * rr, breachCz + Math.sin(a) * rr]);
    }
  }
  // ── CEILING SHAFT (box-buster #4) ──────────────────────────────────
  // Where the breach says "collapse", the shaft says intent: a clean
  // rectangular well rising into darkness above the ceiling — deliberate
  // architecture, proof the level above exists. Walls fade to pure black
  // (vertex colours on the chasm material) so the lamp catches the lip
  // and the rest is void. Same eligibility as the breach, mutually
  // exclusive with it (a room gets one vertical event at most).
  const wantShaft =
    !wantBreach &&
    ceilStyle === 'flat' &&
    room.wallVariant !== 'braced' &&
    floorHoles.length === 0 &&
    !room.logicalOnly &&
    W >= 4.5 && D >= 4.5 && H >= 2.9 &&
    buildRng() < CONFIG.SHAFT_CHANCE;
  let shaftRect: { cx: number; cz: number; w: number; d: number } | null = null;
  if (wantShaft) {
    const sw = 1.4 + buildRng() * 0.8;
    const sd = 1.4 + buildRng() * 0.8;
    // Centre offset kept inside the soffit border, like the breach.
    const cx = (buildRng() - 0.5) * Math.max(0, W - sw - 2.4);
    const cz = (buildRng() - 0.5) * Math.max(0, D - sd - 2.4);
    shaftRect = { cx, cz, w: sw, d: sd };
  }
  let ceiling: THREE.Mesh;
  if (ceilStyle === 'flat') {
    const ceilHoles: Array<Array<[number, number]>> = [];
    if (breachHole) ceilHoles.push(breachHole);
    if (shaftRect) {
      const { cx, cz, w: sw, d: sd } = shaftRect;
      ceilHoles.push([
        [cx - sw / 2, cz - sd / 2],
        [cx + sw / 2, cz - sd / 2],
        [cx + sw / 2, cz + sd / 2],
        [cx - sw / 2, cz + sd / 2],
      ]);
    }
    const ceilGeo: THREE.BufferGeometry = ceilHoles.length > 0
      ? makeFloorWithHoles(W, D, ceilHoles)
      : sloped ? makeJitteredPlane(W, D, { flat: true }) : new THREE.PlaneGeometry(W, D);
    if (sloped) {
      // Ramped corridor: the ceiling tracks the floor's grade so headroom
      // stays constant down the slope. rotX +π/2 maps local (x, y, z) to
      // world (x, -z, +y): displace local Z by the NEGATIVE target height.
      const pos = ceilGeo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const wx = rect.x + pos.getX(i);
        const wz = rect.z + pos.getY(i);
        pos.setZ(i, -(groundYAt(wx, wz) + H));
      }
      ceilGeo.computeVertexNormals();
      ceiling = new THREE.Mesh(ceilGeo, materials.ceiling);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(rect.x, 0, rect.z);
    } else {
      ceiling = new THREE.Mesh(ceilGeo, materials.ceiling);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(rect.x, elev + H, rect.z);
    }
  } else {
    const rise = room.ceilingRise ?? (ceilStyle === 'barrel' ? 1.3 : 1.0);
    ceiling = new THREE.Mesh(
      makeArchedCeilingGeometry(W, D, H, rise, ceilStyle),
      archCeilingMaterial(materials.ceiling),
    );
    ceiling.position.set(rect.x, elev, rect.z);   // geometry already in world-Y (above the room's floor)
  }
  ceiling.receiveShadow = true;
  ceiling.name = 'ceiling';
  ceiling.userData.dbgKind = 'ceiling';
  ceiling.userData.dbgSource = `ceiling · ${room.id} (${ceilStyle}) @(${rect.x.toFixed(1)},${rect.z.toFixed(1)}) y${H.toFixed(1)}`;
  scene.add(ceiling);
  if (breachHole) {
    const bx = rect.x + breachCx;
    const bz = rect.z + breachCz;
    // Black cavity above the hole — you see darkness, not sky.
    const cavity = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.8, 3.0),
      stdMat({ color: 0x020203, roughness: 1.0 }),
    );
    cavity.position.set(bx, elev + H + 0.4, bz);
    scene.add(cavity);
    // A snapped timber dangling through the hole + one wedged across it.
    const beamA = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.1), materials.timber);
    beamA.position.set(bx + 0.25, elev + H - 0.55, bz - 0.1);
    beamA.rotation.set(0.18, 0.4, 0.5);
    const beamB = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), materials.timber);
    beamB.position.set(bx - 0.15, elev + H - 0.06, bz + 0.3);
    beamB.rotation.set(0, buildRng() * Math.PI, 0.07);
    // Overhead breach timbers — structural shell, receive-only (don't flood the
    // lamp cube map). See scene/shadow-role.ts.
    applyShadowRole(beamA, 'receive');
    applyShadowRole(beamB, 'receive');
    scene.add(beamA, beamB);
    // The fall: a rubble heap on the floor beneath, ankle-high, walkable.
    const rubbleMat = stdMat({ color: 0x231f19, roughness: 1.0, flatShading: true });
    const heap = new THREE.Group();
    const n = 5 + Math.floor(buildRng() * 3);
    for (let i = 0; i < n; i++) {
      const sz = 0.12 + buildRng() * 0.22;
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.55, sz * 0.8), rubbleMat);
      const a = buildRng() * Math.PI * 2;
      const rr = buildRng() * 0.8;
      chunk.position.set(bx + Math.cos(a) * rr, sz * 0.22, bz + Math.sin(a) * rr);
      chunk.rotation.y = buildRng() * Math.PI;
      heap.add(chunk);
    }
    heap.position.y = elev;
    applyShadowRole(heap, 'receive');   // floor rubble — clutter, catches light, casts nothing
    scene.add(heap);
  }
  if (shaftRect) {
    const wx = rect.x + shaftRect.cx;
    const wz = rect.z + shaftRect.cz;
    const shaft = new THREE.Mesh(
      makeCeilingShaftGeometry(wx, wz, shaftRect.w, shaftRect.d, elev + H, CONFIG.SHAFT_RISE_M, CONFIG.SHAFT_FADE_M),
      materials.chasmWall,
    );
    shaft.receiveShadow = true;
    shaft.name = 'ceiling-shaft';
    shaft.userData.dbgKind = 'ceiling';
    shaft.userData.dbgSource = `ceiling-shaft · ${room.id} @(${wx.toFixed(1)},${wz.toFixed(1)})`;
    scene.add(shaft);
    // Cap the well so a stray ray can't see out of the world. Not pure
    // black: the faintest cold square far above — distant, unreachable
    // light. Basic material (ignores lights) so it never brightens when
    // the lamp sweeps past, staying well below the lamp baseline.
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(shaftRect.w, shaftRect.d),
      new THREE.MeshBasicMaterial({ color: 0x05070c }),
    );
    cap.rotation.x = Math.PI / 2;   // face down the well
    cap.position.set(wx, elev + H + CONFIG.SHAFT_RISE_M, wz);
    cap.name = 'ceiling-shaft-cap';
    cap.userData.dbgKind = 'ceiling';
    cap.userData.dbgSource = `ceiling-shaft-cap · ${room.id}`;
    scene.add(cap);
  }


  // Walls with openings where another rect butts up. Each of the four wall
  // edges is broken into segments that skip the overlap with adjacent rects
  // (so corridors connect to rooms via gaps in the wall, not via teleport).
  const halfW = W / 2;
  const halfD = D / 2;
  // Each wall edge: which line it runs along + which end coords define its extent.
  const wallEdges: Array<{
    side: 'N' | 'S' | 'E' | 'W';
    perpAxis: 'x' | 'z';   // axis perpendicular to the wall line (the wall is AT this coord)
    perpCoord: number;
    wallStart: number;     // along the wall's running axis
    wallEnd: number;
  }> = [
    { side: 'N', perpAxis: 'z', perpCoord: rect.z - halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
    { side: 'S', perpAxis: 'z', perpCoord: rect.z + halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
    { side: 'W', perpAxis: 'x', perpCoord: rect.x - halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
    { side: 'E', perpAxis: 'x', perpCoord: rect.x + halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
  ];

  // Wall segments are BAKED to world space + merged into ONE mesh for this
  // room (one draw call instead of one per segment — a floor had ~50-100
  // wall draw calls). Per-room (not per-floor) so each room's wall set still
  // frustum-culls as a unit. Collision is recorded per segment as before.
  const wallGeos: THREE.BufferGeometry[] = [];
  // TRIM (box-buster #1): a skirting course where wall meets floor and
  // a cornice where wall meets ceiling, per wall segment, in DRESSED
  // stone. Three thin boxes per segment kill the extruded-rectangle
  // read for one merged draw per room — the oldest PS1 trick there is.
  // Trim breaks at openings automatically (segments already do), so
  // it meets the dressed doorframes like coursework should.
  const trimGeos: THREE.BufferGeometry[] = [];
  const trimSegment = (
    we: { side: 'N' | 'S' | 'E' | 'W' },
    perpCoord: number,
    segStart: number,
    segEnd: number,
  ) => {
    const segLen = segEnd - segStart;
    if (segLen < 0.6) return;   // slivers between close openings: skip
    const segMid = (segStart + segEnd) / 2;
    const inward = we.side === 'N' || we.side === 'W' ? 1 : -1;
    const alongX = we.side === 'N' || we.side === 'S';
    for (const t of [
      { y: elev + 0.075, h: 0.15, depth: 0.07 },        // skirting
      { y: elev + H - 0.06, h: 0.12, depth: 0.055 },    // cornice
    ]) {
      const geo = new THREE.BoxGeometry(
        alongX ? segLen : t.depth,
        t.h,
        alongX ? t.depth : segLen,
      );
      geo.translate(
        alongX ? segMid : perpCoord + inward * (t.depth / 2 - 0.012),
        t.y,
        alongX ? perpCoord + inward * (t.depth / 2 - 0.012) : segMid,
      );
      trimGeos.push(geo);
    }
  };
  for (const we of wallEdges) {
    const openings = findOpenings(we, allRects, room);
    const segments = subtractRanges(we.wallStart, we.wallEnd, openings);
    for (const seg of segments) {
      const segLen = seg.end - seg.start;
      if (segLen < 0.01) continue;
      wallGeos.push(bakeWallSegmentGeometry(we, seg.start, seg.end, H + (elevHi - elevLo), elevLo));
      if (room.wallVariant !== 'braced' && !sloped) trimSegment(we, we.perpCoord, seg.start, seg.end);
      // Record the segment as collision data. The XZ endpoints describe a
      // line in the floor plane along which the player cannot pass.
      if (we.perpAxis === 'z') {
        // wall runs along X at z = we.perpCoord
        wallSegmentsOut.push({ ax: seg.start, az: we.perpCoord, bx: seg.end, bz: we.perpCoord });
      } else {
        // wall runs along Z at x = we.perpCoord
        wallSegmentsOut.push({ ax: we.perpCoord, az: seg.start, bx: we.perpCoord, bz: seg.end });
      }
    }
  }
  if (wallGeos.length > 0) {
    const merged = mergeGeometries(wallGeos, false);
    for (const g of wallGeos) g.dispose();
    if (merged) {
      const walls = new THREE.Mesh(merged, materials.wall);
      walls.receiveShadow = true;
      walls.name = 'walls-merged';
      walls.userData.dbgKind = 'wall';
      walls.userData.dbgSource = `walls · ${room.id}`;
      scene.add(walls);
    }
  }
  // SOFFIT (box-buster #1b): a stepped ceiling border — a frame of
  // dropped ceiling 0.45m wide around the room's perimeter, so the
  // ceiling stops reading as one infinite lid. Big flat rooms only.
  if ((room.ceilingStyle ?? 'flat') === 'flat' && room.wallVariant !== 'braced' && W >= 4 && D >= 4) {
    const SW = 0.45, ST = 0.16;
    const frames: Array<[number, number, number, number]> = [
      [rect.x, rect.z - halfD + SW / 2, W, SW],
      [rect.x, rect.z + halfD - SW / 2, W, SW],
      [rect.x - halfW + SW / 2, rect.z, SW, D - 2 * SW],
      [rect.x + halfW - SW / 2, rect.z, SW, D - 2 * SW],
    ];
    for (const [fx, fz, fw, fd] of frames) {
      const geo = new THREE.BoxGeometry(fw, ST, fd);
      geo.translate(fx, elev + H - ST / 2, fz);
      trimGeos.push(geo);
    }
  }
  if (trimGeos.length > 0) {
    const mergedTrim = mergeGeometries(trimGeos, false);
    for (const g of trimGeos) g.dispose();
    if (mergedTrim) {
      const trim = new THREE.Mesh(mergedTrim, materials.dressed);
      trim.receiveShadow = true;
      trim.castShadow = false;
      trim.name = 'trim-merged';
      trim.userData.dbgKind = 'wall';
      trim.userData.dbgSource = `trim · ${room.id}`;
      scene.add(trim);
    }
  }
  // NOTE: floor wall-contact AO is baked in a POST-pass (bakeFloorWallContacts),
  // not here — it needs EVERY room's wall segments so the darkening is continuous
  // across a room↔corridor junction (a floor vertex at a passage mouth must see
  // the neighbour's walls too, or the two plates seam).

  // Mine-shaft timber bracing (one merged mesh — see makeBracedFramesGeometry).
  if (room.wallVariant === 'braced') {
    const frames = makeBracedFramesGeometry(rect, H);
    if (frames) {
      const braces = new THREE.Mesh(frames.geo, materials.timber);
      braces.position.y = elev;
      applyShadowRole(braces, 'receive');   // wall bracing = shell, receive-only
      braces.name = 'braces';
      braces.userData.dbgKind = 'wall';
      braces.userData.dbgSource = `braces · ${room.id}`;
      scene.add(braces);
      // Posts block like they look — they read as doorframe jambs, and a
      // jamb you ghost through is the exact bug this fixes. Tiny AABBs
      // hugging the walls; the nav grid's tight tier keeps mobs flowing.
      for (const post of frames.posts) {
        obstaclesOut.push({
          kind: 'aabb',
          minX: post.x - post.half, maxX: post.x + post.half,
          minZ: post.z - post.half, maxZ: post.z + post.half,
          yTop: Infinity,   // doorframe jamb — full-height block
        });
      }
    }
  }
}

// Bake one wall-segment plane into a WORLD-SPACE geometry (so a room's
// segments can be merged into a single mesh — see buildRoomShell). Position
// + facing depend on which edge it's on; the jittered-plane normal faces
// into the room (materials.wall is double-sided anyway, so the back is safe).
function bakeWallSegmentGeometry(
  we: { side: 'N' | 'S' | 'E' | 'W'; perpAxis: 'x' | 'z'; perpCoord: number },
  segStart: number,
  segEnd: number,
  height: number,
  baseY: number = 0,
): THREE.BufferGeometry {
  const segLen = segEnd - segStart;
  const segMid = (segStart + segEnd) / 2;
  const geo = makeJitteredPlane(segLen, height, { wavy: true });
  let yaw = 0, px = 0, pz = 0;
  if (we.side === 'N') { yaw = 0; px = segMid; pz = we.perpCoord; }
  else if (we.side === 'S') { yaw = Math.PI; px = segMid; pz = we.perpCoord; }
  else if (we.side === 'W') { yaw = Math.PI / 2; px = we.perpCoord; pz = segMid; }
  else { yaw = -Math.PI / 2; px = we.perpCoord; pz = segMid; }
  const m4 = new THREE.Matrix4().makeRotationY(yaw);
  m4.setPosition(px, baseY + height / 2, pz);
  geo.applyMatrix4(m4);
  return geo;
}

// Place a dust draft at each OPEN archway — a room wall opening (where a
// corridor / adjacent room connects) that has no door. Reuses findOpenings to
// locate the gaps; dedups shared thresholds; skips any opening near a door
// (those already signal). Onward passages get a diegetic dust/haze cue without
// rimming the architecture.
// Prop-contact AO — darken each room's floor under the props standing on it,
// so a free-standing prop grounds to the floor (no decal, no extra draws). Prop
// footprints come straight off the specs (getPropAABB); each floor mesh (stamped
// with its aoRect in buildRoomShell) takes only the contacts that fall on it.
function bakePropContactShadows(root: THREE.Object3D, props: PropSpec[]): void {
  const contacts: PropContact[] = [];
  for (const p of props) {
    const a = getPropAABB(p);
    if (!a) continue;
    contacts.push({
      x: (a.minX + a.maxX) / 2,
      z: (a.minZ + a.maxZ) / 2,
      r: Math.max((a.maxX - a.minX) / 2, (a.maxZ - a.minZ) / 2),
    });
  }
  if (contacts.length === 0) return;
  root.traverse((o) => {
    const rect = o.userData?.aoRect as { x: number; z: number; w: number; d: number } | undefined;
    const mesh = o as THREE.Mesh;
    if (!rect || !mesh.isMesh) return;
    const hx = rect.w / 2 + 0.5, hz = rect.d / 2 + 0.5;   // rect + contact band reach
    const local = contacts.filter(
      (c) => Math.abs(c.x - rect.x) <= hx + c.r && Math.abs(c.z - rect.z) <= hz + c.r,
    );
    if (local.length > 0) {
      bakeFloorPropContactAO(mesh.geometry as THREE.BufferGeometry, { x: rect.x, z: rect.z }, local);
    }
  });
}

// Floor wall-contact AO — darken each floor near walls, using EVERY room's solid
// wall segments (filtered to those reaching the floor's rect) rather than just
// its own. Continuous across room↔corridor junctions: a floor vertex at a
// passage mouth sees the neighbour's walls too, so the two plates ramp together
// instead of seaming. Run as a post-pass once all rooms' segments exist.
function bakeFloorWallContacts(root: THREE.Object3D, segs: WallSegment[]): void {
  const R = 0.9;   // reach: a touch beyond bakeFloorContactAO's radius
  root.traverse((o) => {
    const rect = o.userData?.aoRect as { x: number; z: number; w: number; d: number } | undefined;
    const mesh = o as THREE.Mesh;
    if (!rect || !mesh.isMesh) return;
    const exMinX = rect.x - rect.w / 2 - R, exMaxX = rect.x + rect.w / 2 + R;
    const exMinZ = rect.z - rect.d / 2 - R, exMaxZ = rect.z + rect.d / 2 + R;
    const local = segs.filter((s) => {
      const sMinX = Math.min(s.ax, s.bx), sMaxX = Math.max(s.ax, s.bx);
      const sMinZ = Math.min(s.az, s.bz), sMaxZ = Math.max(s.az, s.bz);
      return sMinX <= exMaxX && sMaxX >= exMinX && sMinZ <= exMaxZ && sMaxZ >= exMinZ;
    });
    if (local.length > 0) {
      bakeFloorContactAO(mesh.geometry as THREE.BufferGeometry, { x: rect.x, z: rect.z }, local);
    }
  });
}

function placeThresholdDrafts(root: THREE.Object3D, spec: LevelSpec, allRects: RoomSpec[]) {
  const doors = spec.doors ?? [];
  const seen = new Set<string>();
  for (const room of spec.rooms) {
    if (room.logicalOnly) continue;
    const rect = room.rect;
    const halfW = rect.w / 2;
    const halfD = rect.d / 2;
    const edges = [
      { perpAxis: 'z' as const, perpCoord: rect.z - halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
      { perpAxis: 'z' as const, perpCoord: rect.z + halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
      { perpAxis: 'x' as const, perpCoord: rect.x - halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
      { perpAxis: 'x' as const, perpCoord: rect.x + halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
    ];
    for (const we of edges) {
      for (const op of findOpenings(we, allRects, room)) {
        const mid = (op.start + op.end) / 2;
        const x = we.perpAxis === 'z' ? mid : we.perpCoord;
        const z = we.perpAxis === 'z' ? we.perpCoord : mid;
        // Dedup thresholds shared by two rects (rounded to 0.5m).
        const key = `${Math.round(x * 2)}:${Math.round(z * 2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Skip doored passages — the door already signals.
        let doored = false;
        for (const d of doors) {
          const dmx = (d.ax + d.bx) / 2;
          const dmz = (d.az + d.bz) / 2;
          if (Math.hypot(dmx - x, dmz - z) < 1.2) { doored = true; break; }
        }
        if (doored) continue;
        // The passage runs along the wall's perpendicular axis; the opening
        // span (op) is the doorway width. Pass the floor Y under the opening +
        // the room's ceiling so the threshold marks ride this opening's actual
        // floor (rooms vary in elevation) instead of a fixed world height.
        spawnThresholdDraft(root, x, z, we.perpAxis, op.end - op.start, groundYAt(x, z), room.height);
      }
    }
  }
}

// Wall-opening range math (findOpenings / subtractRanges) + torchYawForWall
// live in wall-openings.ts. Mood-tint colour math lives in mood-tint.ts.
import { findOpenings, subtractRanges, torchYawForWall } from './wall-openings';
import { mixColors, moodTintForPosition, applyMoodTint, averageTorchTintInRect } from './mood-tint';

// Scatter a few lamp-revealed wall-runes across a floor's rooms so the dungeon
// remembers its dead from the very first descent. Off the build stream so a
// seed is reproducible; off-centre on a wall to dodge the doorway most rooms
// keep mid-wall; skipped on tutorial/safe/foyer rooms (those have their own
// authored mood). Spawned directly (not via spec.props) so revisiting a
// hand-authored spec doesn't accrete duplicates.
function scatterWallRunes(root: THREE.Object3D, spec: LevelSpec): void {
  const depth = spec.depth ?? 0;
  if (depth < 1) return;
  if (/tutorial|safe|harbor|foyer/i.test(spec.id)) return;
  const allRects = [...spec.rooms, ...spec.corridors];
  const MIN_SEG = 1.5;   // a rune quad is ~0.95 wide; need a solid run wider than that
  const NUDGE = 0.06;
  for (const room of spec.rooms) {
    if (room.logicalOnly) continue;
    const r = room.rect;
    if (Math.min(r.w, r.d) < 3.4) continue;            // corridors / tiny pockets
    if (buildRng() > Math.min(0.5, 0.2 + depth * 0.05)) continue;
    const halfW = r.w / 2, halfD = r.d / 2;
    // Place ONLY on a SOLID wall segment — subtract the doorways/corridor
    // openings from the wall (same logic the wall mesh + torches use) so the
    // rune never overhangs a gap or corner and floats in the air. Try sides in
    // random order; take the first with a wide-enough solid run.
    const sides = (['N', 'S', 'E', 'W'] as const).slice();
    for (let i = sides.length - 1; i > 0; i--) {        // Fisher-Yates (deterministic)
      const j = Math.floor(buildRng() * (i + 1)); [sides[i], sides[j]] = [sides[j], sides[i]];
    }
    for (const side of sides) {
      const we = side === 'N' ? { perpAxis: 'z' as const, perpCoord: r.z - halfD, wallStart: r.x - halfW, wallEnd: r.x + halfW }
        : side === 'S' ? { perpAxis: 'z' as const, perpCoord: r.z + halfD, wallStart: r.x - halfW, wallEnd: r.x + halfW }
        : side === 'W' ? { perpAxis: 'x' as const, perpCoord: r.x - halfW, wallStart: r.z - halfD, wallEnd: r.z + halfD }
        : { perpAxis: 'x' as const, perpCoord: r.x + halfW, wallStart: r.z - halfD, wallEnd: r.z + halfD };
      const openings = findOpenings(we, allRects, room);
      const segs = subtractRanges(we.wallStart, we.wallEnd, openings).filter((s) => s.end - s.start >= MIN_SEG);
      if (!segs.length) continue;
      const seg = segs[Math.floor(buildRng() * segs.length)];
      // Centre-ish of the segment, clamped so the full quad stays on solid wall.
      const lo = seg.start + 0.55, hi = seg.end - 0.55;
      const along = lo + buildRng() * Math.max(0, hi - lo);
      let x: number, z: number, yaw: number;
      if (we.perpAxis === 'z') { x = along; z = we.perpCoord + (side === 'N' ? NUDGE : -NUDGE); yaw = side === 'N' ? 0 : Math.PI; }
      else { z = along; x = we.perpCoord + (side === 'W' ? NUDGE : -NUDGE); yaw = side === 'W' ? Math.PI / 2 : -Math.PI / 2; }
      spawnWallRune(root, new THREE.Vector3(x, groundYAt(x, z) + 1.45, z), yaw, pickWallMark(depth, buildRng));
      break;
    }
  }
}

export function buildLevel(
  scene: THREE.Scene,
  spec: LevelSpec,
  materials: StyleMaterials,
  onDescend?: (targetLevel: string) => void,
): LiveLevel {
  // Seed the build stream from the floor seed so geometry jitter + prop /
  // loot placement are reproducible for a given seed. Procgen stamps
  // spec.seed; hand-authored floors fall back to a stable hash of their id.
  seedBuildRng(spec.seed ?? hashStringToSeed(spec.id));

  // Ground-elevation field FIRST — every placement below (shells, props,
  // torches, mobs) samples groundYAt, so the field must be current before
  // anything is positioned. Flat floors build a constant-0 field and every
  // sample short-circuits.
  setElevationField(buildElevationField(spec.rooms, spec.corridors));

  // Per-level lights start fresh. Persistent sources (the camera-
  // attached lantern) survive — see light-pool.clearLightPool.
  clearLightPool();
  // Drop the previous floor's encounters before this one registers its own
  // (the registry is module-global).
  clearEncounters();
  // Reset the descent fate-gate; a big (harbor) fire on this floor re-arms it.
  clearFateGate();

  // Everything goes into this root group rather than directly into the
  // scene — teardown is a single scene.remove(root). Geometry/material
  // disposal walks root's tree.
  const root = new THREE.Group();
  root.name = `level-${spec.id}`;
  scene.add(root);

  // --- Geometry: rooms + corridors ---
  const allRects: RoomSpec[] = [...spec.rooms, ...spec.corridors];
  // ── THE THRESHOLD BONFIRE ──────────────────────────────────────────
  // Every floor begins at a fire: the player wakes seated beside it
  // (player/arrival.ts) and can REST at it (the level-up menu) any time.
  // Floors that author their own bonfire (safe rooms, tutorial) are
  // left alone. Placed off the spawn's shoulder so it never blocks
  // the lane, and skipped if it would sit in a doorway.
  {
    const hasBonfire = spec.props.some(
      (pr) => pr.kind === 'model' && (pr as { model?: { id?: string } }).model?.id === 'bonfire');
    // v3: procgen floors manage their own fires (the content budget rolls a
    // FOUND minor fire deeper in, or none) — so the builder only auto-places the
    // wake-beside-fire threshold bonfire on hand-authored floors that don't opt
    // out. This is what makes fires "found, not guaranteed per descent."
    if (!hasBonfire && spec.startPos && !spec.composerManagedFires) {
      const yaw = spec.startPos.yaw ?? 0;
      // forward is (-sin yaw, -cos yaw); the fire sits DEAD AHEAD —
      // you wake looking straight into it and walk around.
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const bx = spec.startPos.x + fx * 1.8;
      const bz = spec.startPos.z + fz * 1.8;
      spec.props.push({ kind: 'model', model: BONFIRE, x: bx, y: 0, z: bz, rotY: yaw + 2.2 });
    }
    // ORIGIN ARCH — independent of WHO placed the bonfire (foyer vaults
    // author their own, which used to silently skip the doors too).
    if (spec.startPos) {
      const yaw = spec.startPos.yaw ?? 0;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      // ORIGIN ARCH — the closed pair of doors on the wall BEHIND the
      // spawn: you arrived THROUGH them (they stood ajar at the bottom
      // of the last floor's stairwell, fire shimmering through the
      // crack) and they shut at your back. You wake facing the fire,
      // the way you came closed behind you. Cast BACKWARD from the
      // spawn to the containing room's wall; skip when a doorway sits
      // there (another rect just beyond the wall line) — closed doors
      // beside an open passage would lie.
      const sx = spec.startPos.x, sz = spec.startPos.z;
      const startRoom = spec.rooms.find((r) => {
        const hw = r.rect.w / 2, hd = r.rect.d / 2;
        return !r.logicalOnly
          && sx >= r.rect.x - hw && sx <= r.rect.x + hw
          && sz >= r.rect.z - hd && sz <= r.rect.z + hd;
      });
      if (startRoom) {
        const hw = startRoom.rect.w / 2, hd = startRoom.rect.d / 2;
        // Backward = opposite the facing/fire direction.
        const ux = -fx, uz = -fz;
        const tx = ux > 1e-6 ? (startRoom.rect.x + hw - sx) / ux
          : ux < -1e-6 ? (startRoom.rect.x - hw - sx) / ux : Infinity;
        const tz = uz > 1e-6 ? (startRoom.rect.z + hd - sz) / uz
          : uz < -1e-6 ? (startRoom.rect.z - hd - sz) / uz : Infinity;
        const tWall = Math.min(tx, tz);
        if (isFinite(tWall) && tWall > 0.8 && tWall < 12) {
          const ax = sx + ux * tWall;
          const az = sz + uz * tWall;
          // A rect just beyond the wall here = an opening/passage — skip.
          const px = sx + ux * (tWall + 0.6);
          const pz = sz + uz * (tWall + 0.6);
          const passage = [...spec.rooms, ...spec.corridors].some((r) => {
            const w2 = r.rect.w / 2, d2 = r.rect.d / 2;
            return px >= r.rect.x - w2 && px <= r.rect.x + w2
              && pz >= r.rect.z - d2 && pz <= r.rect.z + d2;
          });
          if (!passage) {
            spec.props.push({
              kind: 'model', model: ORIGIN_ARCH,
              x: ax, y: 0, z: az,
              // +Z faces INTO the room (toward the spawn): under rotY,
              // model +Z maps to (sin, cos) — the forward direction is
              // (−sin yaw, −cos yaw), so rotY = yaw + π faces it.
              rotY: yaw + Math.PI,
              _dbg: 'origin-arch',
            });
          }
        }
      }
    }
  }
  // Splat map: world bounds of this floor (+2m margin) → fresh slate.
  {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const r of allRects) {
      minX = Math.min(minX, r.rect.x - r.rect.w / 2);
      maxX = Math.max(maxX, r.rect.x + r.rect.w / 2);
      minZ = Math.min(minZ, r.rect.z - r.rect.d / 2);
      maxZ = Math.max(maxZ, r.rect.z + r.rect.d / 2);
    }
    if (isFinite(minX)) resetSplatMap(minX - 2, minZ - 2, maxX - minX + 4, maxZ - minZ + 4);
  }
  const wallSegments: WallSegment[] = [];
  // Hoisted: stair-footprint AABBs push into this BEFORE the prop pass
  // populates the rest. WalkableRegion is constructed below with the
  // full list.
  const obstacles: Obstacle[] = [];
  // Destructibles — vases + future breakable props. Built
  // inline alongside the props loop, returned in LiveLevel.
  const destructibles: Destructible[] = [];
  // Parallel list of stair-footprint AABBs in world XZ — same shape as
  // the stair obstacles above. Passed to decorateFloor so the procgen
  // sigils/cracks/rubble decorator skips cells that sit on the cut-out
  // stairwell floor.
  const stairFootprintAabbs: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  // Pre-compute floor holes (one per stairwell) keyed by which room the
  // stairwell sits inside. Each hole is a 4-corner polygon in floor-mesh
  // shape coordinates (shape Y maps to world -Z after the -π/2 X rotation
  // of the floor mesh). The stairwell descends in stair-local +Z; we
  // rotate by stair.rotY to find its world footprint.
  const stairs = spec.stairs ?? [];
  for (const r of allRects) {
    const holes: Array<Array<[number, number]>> = [];
    for (const st of stairs) {
      const rx = r.rect.x;
      const rz = r.rect.z;
      const hw = r.rect.w / 2;
      const hd = r.rect.d / 2;
      if (st.x < rx - hw || st.x > rx + hw) continue;
      if (st.z < rz - hd || st.z > rz + hd) continue;
      // Slight outward margin on each edge so the hole's outline can't
      // peek past the parapet at oblique camera angles.
      const halfW = STAIRWELL_HALF_WIDTH + 0.04;
      const back = STAIRWELL_TOTAL_DEPTH + 0.04;
      const front = -0.04;
      const angle = st.rotY ?? 0;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const corners: Array<[number, number]> = [
        [-halfW, front],
        [ halfW, front],
        [ halfW, back],
        [-halfW, back],
      ];
      // World XZ of the four stair-footprint corners. The rotation
      // here MUST match Three.js's Y-rotation convention used by the
      // group containing the stair geometry (group.rotation.y =
      // spec.rotY). Three.js maps local (lx, ly, lz) under Y-rotation
      // θ to world (ca*lx + sa*lz, ly, -sa*lx + ca*lz). The earlier
      // formula used opposite-sign cross terms, which is rotation by
      // -θ — the hole + obstacle ended up MIRRORED ACROSS the cell
      // from the actual stair body for any non-axial rotY (most
      // notably the auto-rotated east/west boss + exit stairs).
      const worldCorners = corners.map(([lx, lz]) => {
        const wx = st.x + ca * lx + sa * lz;
        const wz = st.z - sa * lx + ca * lz;
        return [wx, wz] as [number, number];
      });
      // Clip to the ROOM's axis-aligned bounding box. The stair often
      // descends INTO the back wall (the footprint extends past the
      // room). Without clipping, the floor hole goes past the room rect
      // and ShapeGeometry triangulates unpredictably — manifests as
      // half-cut floors on small rooms. We axis-clamp the AABB of the
      // footprint to the room rect; for axis-aligned stair rotations
      // (0, ±π/2, π — all current cases) this preserves the rectangle.
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [wx, wz] of worldCorners) {
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz;
        if (wz > maxZ) maxZ = wz;
      }
      // Clamp the hole to sit STRICTLY INSIDE the floor contour by a
      // small inset on every side. A hole vertex that lands exactly on
      // (or, via float error, a hair past) the outer boundary makes
      // THREE's earcut triangulation silently DROP the hole — the floor
      // comes back as a solid 2-triangle slab with no stairwell opening.
      // This bites whenever a stairwell is shifted flush with its back
      // wall (the back edge then coincides with the room boundary): e.g.
      // exit-grand, where rz≈30.7227 made the back edge land at
      // y=-3.5000000000000036 vs the contour's -3.5. The leftover inset
      // sliver (≤2cm) sits under the wall / behind the stair parapet, so
      // it's never visible.
      const EDGE_INSET = 0.02;
      const cMinX = Math.max(minX, rx - hw + EDGE_INSET);
      const cMaxX = Math.min(maxX, rx + hw - EDGE_INSET);
      const cMinZ = Math.max(minZ, rz - hd + EDGE_INSET);
      const cMaxZ = Math.min(maxZ, rz + hd - EDGE_INSET);
      if (cMinX >= cMaxX || cMinZ >= cMaxZ) continue;  // clipped to nothing
      // Build hole in floor-shape coords (X = world_x - rect.x;
      // Y = -(world_z - rect.z) due to the floor's -π/2 X rotation).
      const hole: Array<[number, number]> = [
        [cMinX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMaxZ - rz)],
        [cMinX - rx, -(cMaxZ - rz)],
      ];
      holes.push(hole);
      // Stair footprint → AABB obstacle. The player can walk up to the
      // stair MOUTH (interactable range fires before contact) but can't
      // step onto the stairs themselves. Leave a small front-edge gap
      // so the prompt is reachable. The obstacle is computed in WORLD
      // space (matches the rest of the obstacle list).
      const FRONT_GAP = 0.15;
      // Re-build the FRONT-clipped local corners and project to world.
      const obsCorners = [
        [-halfW, front + FRONT_GAP],
        [ halfW, front + FRONT_GAP],
        [ halfW, back],
        [-halfW, back],
      ];
      let oMinX = Infinity, oMaxX = -Infinity, oMinZ = Infinity, oMaxZ = -Infinity;
      for (const [lx, lz] of obsCorners) {
        // Same Three.js Y-rotation convention as the hole corners above.
        const wx = st.x + ca * lx + sa * lz;
        const wz = st.z - sa * lx + ca * lz;
        if (wx < oMinX) oMinX = wx;
        if (wx > oMaxX) oMaxX = wx;
        if (wz < oMinZ) oMinZ = wz;
        if (wz > oMaxZ) oMaxZ = wz;
      }
      obstacles.push({ kind: 'aabb', minX: oMinX, maxX: oMaxX, minZ: oMinZ, maxZ: oMaxZ, yTop: Infinity });   // stair footprint — full-height block
      // Decorator AABB uses the FULL (unclipped) footprint so cells
      // beyond the room rect can't sprout sigils either — even though
      // those cells fall outside the floor, the grid loop iterates them.
      stairFootprintAabbs.push({ minX, maxX, minZ, maxZ });
    }
    // Chasm voids inside this room → a floor hole (clamped just inside the
    // contour so earcut keeps it) + an edge-barrier obstacle covering the
    // FULL void (so the player can't step into the abyss). Drop geometry is
    // built once after this loop.
    for (const v of spec.voids ?? []) {
      const rx = r.rect.x, rz = r.rect.z, hw = r.rect.w / 2, hd = r.rect.d / 2;
      if (v.x < rx - hw || v.x > rx + hw || v.z < rz - hd || v.z > rz + hd) continue;
      const vMinX = v.x - v.w / 2, vMaxX = v.x + v.w / 2;
      const vMinZ = v.z - v.d / 2, vMaxZ = v.z + v.d / 2;
      const EDGE = 0.02;
      const cMinX = Math.max(vMinX, rx - hw + EDGE), cMaxX = Math.min(vMaxX, rx + hw - EDGE);
      const cMinZ = Math.max(vMinZ, rz - hd + EDGE), cMaxZ = Math.min(vMaxZ, rz + hd - EDGE);
      if (cMinX >= cMaxX || cMinZ >= cMaxZ) continue;
      holes.push([
        [cMinX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMaxZ - rz)],
        [cMinX - rx, -(cMaxZ - rz)],
      ]);
      obstacles.push({ kind: 'aabb', minX: vMinX, maxX: vMaxX, minZ: vMinZ, maxZ: vMaxZ, yTop: Infinity });   // chasm void edge — full-height block
    }
    // Logical-only sub-rooms (multi-room vault parsing) skip the shell
    // build — they exist only for mob-attribution and arena-door
    // trigger purposes. Their parent vault's main RoomSpec already
    // covers floor/ceiling/walls.
    if (!r.logicalOnly) {
      buildRoomShell(root, r, allRects, materials, wallSegments, holes, obstacles);
    }
  }

  // --- Threshold drafts: drifting dust + a proximity haze at OPEN archways
  // (passages with no door), so an onward passage reads as a way through —
  // diffuse + in-motion, not a placed marker. Doored passages already signal.
  placeThresholdDrafts(root, spec, allRects);

  // --- Props (visual meshes) + collect obstacles for collision ---
  // `obstacles` was hoisted above so stair AABBs land in the same list.

  // Pillar geometry is BATCHED: each pillar's ~8 parts are baked to world
  // space and collected here, then merged into ONE mesh after the loop (see
  // below) — so a colonnade costs a single draw call instead of dozens. The
  // boss cathedral alone was ~48 pillar draw calls.
  const pillarGeos: THREE.BufferGeometry[] = [];

  // Boss-mist props need the WalkableRegion (for the seal obstacle)
  // which is constructed AFTER this loop. Collect them here, spawn
  // after the region exists.
  // Every wall-opening fitting — doors, portcullises, the boss fog-gate, and
  // cobwebs — is installed through ONE deferred drain (spawnFitting) after the
  // walkable region + room membership exist. Collected here from props +
  // spec.doors so they all flow through the same placement + seal path.
  const pendingFittings: OpeningSpec[] = [];
  // Rooms that hold a challenge offering → their arena gate becomes a
  // voluntary 'offering' trigger (set on the door spec below) instead of a
  // trap that slams on entry.
  const offeringRooms = new Set<string>();
  // Tag a static decoration group so the per-room static-merge pass
  // (batchStaticFixtures) folds it into one mesh per material — the single
  // biggest draw-call win on procgen floors, where loose `model`/`altar` decor
  // is otherwise one draw per prop part. Flames are skipped (they animate via a
  // mesh that must stay live). Everything else — including an archway's
  // proximity-GLOW parts — is safe to fold: the merge is per-room/corridor and
  // groups by material instance, so one corridor's archway collapses to a single
  // mesh that STILL carries that archway's own glow material (registerArchwayGlow
  // animates the material, which the merged mesh shares — so it still pulses by
  // the player's distance to THAT gate). Pillars are merged separately above.
  const markMergeStatic = (obj: THREE.Object3D): void => {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name !== 'flame') m.userData.mergeStatic = true;
    });
  };
  // GOD RAYS OWN THEIR POOL — light-placement awareness. The altar
  // groups deliberately stage a candle just outside a ray's shaft;
  // both carried PointLights, so the player saw a pale shaft-light
  // and a warm candle-light a hand's width apart (the 'two lights,
  // no awareness' read). The ray is the room's signal: any lesser
  // fixture within its floor pool keeps its FLAME (set dressing) but
  // yields its light registration to the ray.
  const godRayLightPos: Array<{ x: number; z: number }> = [];
  for (const prop of spec.props) {
    if (prop.kind === 'model' && prop.model.id.startsWith('god-ray')) {
      godRayLightPos.push({ x: prop.x, z: prop.z });
    }
  }
  const lightOwnedByGodRay = (x: number, z: number, modelId: string): boolean => {
    if (modelId.startsWith('god-ray')) return false;
    return godRayLightPos.some((g) => Math.hypot(g.x - x, g.z - z) < 1.0);
  };
  // A pillar dropped right in front of a composer-cut entrance reads as
  // a bug (traversable, but it crowds the doorway). Authors place pillars
  // in vault-local coords with no knowledge of WHERE the composer will cut
  // openings, so the guard has to live here, at build time.
  const pillarBlocksOpening = (px: number, pz: number): boolean => {
    const rid = findRoomContaining(px, pz, spec.rooms);
    const room = spec.rooms.find((r) => r.id === rid);
    if (!room) return false;
    const rect = room.rect;
    const hw = rect.w / 2, hd = rect.d / 2;
    const walls = [
      { perpAxis: 'x' as const, perpCoord: rect.x - hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
      { perpAxis: 'x' as const, perpCoord: rect.x + hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
      { perpAxis: 'z' as const, perpCoord: rect.z - hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
      { perpAxis: 'z' as const, perpCoord: rect.z + hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
    ];
    for (const w of walls) {
      for (const op of findOpenings(w, allRects, room)) {
        const cx = w.perpAxis === 'x' ? w.perpCoord : (op.start + op.end) / 2;
        const cz = w.perpAxis === 'x' ? (op.start + op.end) / 2 : w.perpCoord;
        if (Math.hypot(px - cx, pz - cz) < 1.7) return true;
      }
    }
    return false;
  };
  for (const prop of spec.props) {
    // Ground height under this prop — 0 on flat floors. Every spawner
    // below receives its base Y from here so props ride their room's
    // elevation (and a prop in a sloped corridor sits on the ramp).
    const gy = groundYAt(prop.x, prop.z);
    if (prop.kind === 'pillar') {
      if (pillarBlocksOpening(prop.x, prop.z)) continue;   // crowds a doorway — drop it
      const size = prop.size ?? PILLAR_DEFAULT_SIZE;
      const H = spec.rooms[0]?.height ?? 3.2;
      const { group: pillarGroup, obstacle } = buildAltarPillar(prop.x, prop.z, size, H, materials);
      // Bake each part's local transform into a world-space geometry clone
      // for the merge. (Merge, not InstancedMesh: pillars vary in height +
      // size, which one instanced geometry can't express without stretching
      // the cap/bead proportions.) The pooled source geometries are left
      // intact; the clones get disposed after the merge. Ground lift goes
      // on the group BEFORE the bake so it rides into the merged mesh.
      pillarGroup.position.y += gy;
      pillarGroup.updateMatrixWorld(true);
      pillarGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          pillarGeos.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
        }
      });
      obstacles.push(obstacle);   // geometry-accurate circle, full-height (yTop: Infinity)
    } else if (prop.kind === 'altar') {
      const { group: altarGroup, obstacle } = buildAltarBlock(prop.x, prop.z, materials);
      altarGroup.position.y += gy;
      root.add(altarGroup);
      markMergeStatic(altarGroup);   // static stone — fold into the per-room merge
      obstacles.push({ kind: 'aabb', ...obstacle, yTop: gy + 0.9 });   // waist-high — shots fly over
    } else if (prop.kind === 'challenge-offering') {
      const rid = findRoomContaining(prop.x, prop.z, spec.rooms);
      spawnChallengeOffering(root, new THREE.Vector3(prop.x, gy, prop.z), rid ?? '', spec.depth ?? 1, materials);
      if (rid) offeringRooms.add(rid);
      // Coffer footprint blocks movement; waist-high so shots clear it.
      obstacles.push({
        kind: 'aabb',
        minX: prop.x - 0.36, maxX: prop.x + 0.36,
        minZ: prop.z - 0.28, maxZ: prop.z + 0.28,
        yTop: gy + 0.7,
      });
    } else if (prop.kind === 'model' && prop.destructible) {
      // Breakable DECORATION (a corner cobweb) — spawn as a destructible so a
      // swing tears it. Stays OUT of the static merge (it must survive as its
      // own group for the hit-test + removal). Blocks nothing, drops nothing.
      const web = spawnBreakableDecoration(root, prop.model, prop.x, prop.y, prop.z, {
        rotY: prop.rotY, rotZ: prop.rotZ, scale: prop.scale,
      });
      destructibles.push(web);
    } else if (prop.kind === 'model') {
      // batchSprites: prop flame/glow sprites (candles, braziers, bonfires)
      // fold into the instanced sprite batch — one draw per texture instead
      // of one per tongue. Props are static, so their anchors never move.
      const built = buildModel(prop.model, { batchSprites: true });
      // Height AO — darken the prop's base toward the floor so it sits in its
      // own shadow (world-Y driven, survives the static merge). Scaled by the
      // same SURFACE AO slider as the rest of the grounding.
      for (const m of built.materials.values()) installPropHeightAO(m);
      built.group.position.set(prop.x, prop.y + gy, prop.z);
      if (prop.rotX) built.group.rotation.x = prop.rotX;
      if (prop.rotY) built.group.rotation.y = prop.rotY;
      if (prop.rotZ) built.group.rotation.z = prop.rotZ;
      if (prop.scale && prop.scale !== 1) built.group.scale.setScalar(prop.scale);
      // LOOTABLE decoration (docs/BUILD-ECONOMY.md) — any model prop tagged
      // `searchable` becomes a one-shot container through the shared seam: it
      // wears the standard focus outline and SPEWS its drop half a step forward
      // on the first SEARCH (see interactables/searchable.ts). Registered after
      // the group is parented, below; a searchable prop also opts OUT of the
      // static merge so its meshes survive for the outline to hull.
      // Framed openings (archway / doorframe props): install the shared visual
      // fittings — proximity crown glow + the dungeon's nav eye at the model's
      // keystone slots. Same seam the fitting drain uses (see level/frame.ts), so
      // every framed mouth dresses identically no matter who emitted the prop.
      if (prop.proximityGlow) {
        installFrameFittings(built, root, prop.x, prop.z, (px, pz) =>
          spec.corridors.some((c) =>
            Math.abs(px - c.rect.x) <= c.rect.w / 2 && Math.abs(pz - c.rect.z) <= c.rect.d / 2));
      }
      // Debug provenance — stamp the generating system + a coarse model
      // hint onto the group so the debug capture's look-at/cone resolver
      // can report "this rubble = surface-clutter phase." No-op for
      // gameplay; only read by src/debug/capture.ts.
      built.group.userData.dbgSource = prop._dbg ?? 'authored';
      built.group.userData.dbgKind = 'prop';
      // Mood-tint pass: if the spec opts in (moodTintable), recolour
      // its flame material + every additive sprite particle + the
      // attached light to match the average torch tint of the room
      // the prop sits in. Cheap, instance-local. See FLOOR_CANDLE
      // for the canonical user.
      let lightColorOverride: number | undefined;
      if (prop.model.moodTintable) {
        const moodTint = moodTintForPosition(spec, prop.x, prop.z);
        if (moodTint !== null) {
          applyMoodTint(built, moodTint);
          lightColorOverride = moodTint;
        }
      }
      root.add(built.group);
      // Searchable props register their container now that the group is parented.
      // The outline hulls this group's meshes, so a searchable prop must STAY OUT
      // of the static merge (which would empty the group into a room-wide mesh and
      // leave the outline nothing to trace).
      if (prop.searchable) {
        registerSearchable({
          scene: root, built,
          x: prop.x, y: prop.y + gy, z: prop.z, rotY: prop.rotY ?? 0,
          table: prop.searchable.table,
          depth: spec.depth ?? 1,
          rng: gameRng,
          label: prop.searchable.label,
          radius: prop.searchable.radius,
        });
      } else {
        // Fold the prop's STATIC meshes into the per-room static-merge pass — the
        // biggest draw-call win on a floor. The merge skips meshes named 'flame'
        // (the flicker) and all sprites; the prop's LIGHT is a separate pool
        // source, untouched. Mood-tint sets colour once at spawn so a tinted body
        // bakes fine. Archways/doorframes (proximityGlow) ARE folded now — their
        // glow material is per-gate and the merge is per-corridor, so each gate
        // collapses to ~one mesh that still pulses. They were the single biggest
        // bucket of loose draws down a long hall.
        markMergeStatic(built.group);
      }
      // Optional collision shape(s) — used by structural model
      // props (buttresses, ruined columns, archway columns). For
      // AABB the half-extents rotate with the prop's rotY; we
      // only support cardinal angles in practice so the rotated
      // AABB stays axis-aligned. Each shape may carry a local
      // offset (ox, oz) so one prop can express multiple
      // obstacles (e.g. an archway's TWO columns).
      if (prop.collision) {
        const shapes = Array.isArray(prop.collision) ? prop.collision : [prop.collision];
        const angle = prop.rotY ?? 0;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        // Projectile ceiling when a collision shape declares no explicit height:
        // use the prop's ACTUAL geometry top (world-space bbox) rather than
        // Infinity, so a bolt flying ABOVE a low prop (a thing lying on the
        // floor, a stump, low debris) sails over instead of being eaten. A tall
        // structural column still measures tall and keeps blocking. This is the
        // 3D hit-test the projectile pass already wanted (containsProjectile reads
        // yTop) — it was only ever missing a sane default. Computed once per prop.
        _propBox.setFromObject(built.group);
        const geomTop = Number.isFinite(_propBox.max.y) ? _propBox.max.y + 0.05 : gy + 2.0;
        for (const shape of shapes) {
          const ox = shape.ox ?? 0;
          const oz = shape.oz ?? 0;
          // Rotate local offset into world.
          const wox = ca * ox + sa * oz;
          const woz = -sa * ox + ca * oz;
          const cx = prop.x + wox;
          const cz = prop.z + woz;
          const yTop = shape.height === undefined ? geomTop : gy + shape.height;
          if (shape.kind === 'circle') {
            obstacles.push({ kind: 'circle', x: cx, z: cz, r: shape.r, yTop, dashable: shape.dashable });
          } else {
            // Swap halfW/halfD if rotation is perpendicular (±π/2).
            const swap = Math.abs(ca) < 0.5;
            const hw = swap ? shape.halfD : shape.halfW;
            const hd = swap ? shape.halfW : shape.halfD;
            obstacles.push({
              kind: 'aabb',
              minX: cx - hw, maxX: cx + hw,
              minZ: cz - hd, maxZ: cz + hd,
              yTop,
              dashable: shape.dashable,
            });
          }
        }
      }
      // If the model spec carries a light, register it with the global
      // light pool. The pool decides per-frame whether this source gets
      // a real slot. Light's local position is added to the prop's
      // world position; rotations are not currently applied to the
      // offset (most model lights sit on the prop's axis).
      // Bonfires are where you REST — sitting at any fire deals you your fate:
      // the dealt-3-pick-1 card draw (ui/card-reading.ts) is the payoff now, not
      // stat distribution. The tarot IS the build. (Brightness calibration — the
      // old wick ritual — lives in Settings.)
      // Per-fire spent dimmer — the fate-fire sets this to fade THIS bonfire's
      // pooled light to embers once it's been drawn (1 = lit, <1 = spent).
      let bonfireDim = 1;
      // Event-presence knob for the level-up fire. A bonfire is CONTENT (the
      // rest + the fate draw happen here), so per lighting-as-signal it should
      // read as an EVENT across a cluttered room, not blend into ambient props.
      // ?bigfire=1.4 scales the fire up + boosts its pool so you can dial the
      // presence on the phone; default 1.0 = today's look, zero regression.
      // Boosts the LIGHT pass below too (fireBoost) so bigger fire = bigger glow.
      let fireBoost = 1;
      if (prop.model.id === 'bonfire') {
        if (BIGFIRE > 1) { built.group.scale.multiplyScalar(BIGFIRE); fireBoost = BIGFIRE; }
        registerFateFire({
          group: built.group,
          position: new THREE.Vector3(prop.x, gy, prop.z),
          // The MAJOR fate (+ descent gate) now belongs to the BOSS bonfire that
          // erupts on the kill — so a post-boss SAFE ROOM / harbor fire steps down
          // to a MINOR rest-fire (still heals + refills, deals a minor arcana, no
          // gate). The foyer's opening fire and any deliberately-scaled big fire
          // keep the major.
          isBig: !/safe|harbor/i.test(spec.id ?? '')
            && (/foyer/i.test(spec.id ?? '') || (prop.scale ?? 1) >= 1.3),
          dimLight: (f) => { bonfireDim = f; },
        });
      }
      if (prop.model.light && !lightOwnedByGodRay(prop.x, prop.z, prop.model.id)) {
        const lp = prop.model.light;
        const lightPos = new THREE.Vector3(
          prop.x + (lp.pos?.[0] ?? 0),
          prop.y + (lp.pos?.[1] ?? 0),
          prop.z + (lp.pos?.[2] ?? 0),
        );
        // Soft flame-flicker by default — cressets/braziers are FIRE and
        // read dead when their light is a constant (the visual flame
        // sprites always flickered; the LIGHT didn't). Specs opt out
        // with flicker: 0 (moonlight, arcane).
        const amp = lp.flicker ?? 0.10;
        // fireBoost (?bigfire=) grows the bonfire's pool with its size so a
        // scaled-up fate fire also throws proportionally more warm light.
        const baseIntensity = lp.intensity * fireBoost;
        const p1 = buildRng() * Math.PI * 2;
        const p2 = buildRng() * Math.PI * 2;
        registerLight({
          id: `model-light-${lightSerial++}`,
          category: 'environment',
          position: lightPos,
          color: lightColorOverride ?? lp.color,
          intensity: baseIntensity,
          getIntensity: amp > 0 ? () => {
            const t = performance.now() / 1000;
            return baseIntensity * bonfireDim * (1 + amp * (0.6 * Math.sin(t * 5.1 + p1) + 0.4 * Math.sin(t * 8.7 + p2)));
          } : () => baseIntensity * bonfireDim,
          distance: lp.distance * fireBoost,
          decay: lp.decay,
        });
      }
    } else if (prop.kind === 'chest') {
      // Mimic chests need a callback that spawns the mimic mob into
      // the right room when the lid slams open. spawnInto is defined
      // later in this function (hoisted as a function declaration);
      // the closure body only runs at interact-time so all the
      // by-then-initialised state is available.
      const chestRoomId = prop.mimic
        ? findRoomContaining(prop.x, prop.z, spec.rooms)
        : null;
      // Push the chest's blocker FIRST and keep a reference, so a mimic
      // reveal can splice it out — the disguise mesh is removed on reveal
      // and the mob walks free, so leaving the AABB would block the cell
      // where the chest used to sit (same fix as the vase pattern below).
      let chestObs: Obstacle | null = null;
      if (!prop.noCollision) {
        chestObs = {
          kind: 'aabb',
          minX: prop.x - 0.28, maxX: prop.x + 0.28,
          minZ: prop.z - 0.23, maxZ: prop.z + 0.23,
          yTop: gy + 0.7,   // chest-high — shots fly over
        };
        obstacles.push(chestObs);
      }
      const onMimic = prop.mimic
        ? (worldPos: THREE.Vector3) => {
            // Route removal through the region so the collider leaves the
            // spatial hash (what collision reads) + bumps the nav version —
            // else a revealed mimic leaves an invisible chest-shaped blocker.
            if (chestObs) walkable.removeObstacle(chestObs);
            spawnInto(ENEMIES.mimic, worldPos, chestRoomId);
          }
        : undefined;
      spawnChest(
        root,
        new THREE.Vector3(prop.x, gy, prop.z),
        prop.rotY ?? 0,
        prop.loot ?? { gold: 0, items: [] },   // mimics carry no bundle (their branch handles the reveal)
        prop.tier,
        prop.mimic ?? false,
        onMimic,
        prop.gateId,   // #74: sealed until this room's gate offering is taken
      );
    } else if (prop.kind === 'gate-offering') {
      // The centrepiece of a gated loot room — taking it releases every chest
      // sharing its gateId. Blocks like a low plinth (shots fly over).
      spawnGateOffering(root, new THREE.Vector3(prop.x, gy, prop.z), prop.rotY ?? 0, prop.gateId);
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.42, yTop: gy + 0.6,
      });
    } else if (prop.kind === 'stash-chest') {
      spawnStashChest(root, new THREE.Vector3(prop.x, gy, prop.z), prop.rotY ?? 0);
      obstacles.push({
        kind: 'aabb',
        minX: prop.x - 0.28, maxX: prop.x + 0.28,
        minZ: prop.z - 0.23, maxZ: prop.z + 0.23,
        yTop: gy + 0.7,
      });
    } else if (prop.kind === 'corpse') {
      // A fallen delver — pick who they were + resolve what they died holding,
      // deterministically off the build stream. An authored `note` overrides
      // the epitaph (lets a vault speak a specific death).
      const base = pickFallen(buildRng);
      // Note override + the director's context POSE override (against a wall vs
      // open floor) both fold onto the picked delver.
      const fallen = { ...base, ...(prop.note ? { epitaph: prop.note } : {}), ...(prop.pose ? { pose: prop.pose } : {}) };
      let loot: ItemSpec | null = null;
      if (fallen.carried === 'roll') loot = rollDropItem('corpse', spec.depth ?? 1, buildRng);
      else if (typeof fallen.carried === 'string') loot = ITEMS[fallen.carried] ?? null;
      spawnCorpse(root, new THREE.Vector3(prop.x, gy, prop.z), prop.rotY ?? 0, fallen, loot);
      // No collision — player steps over the body; walking up to SEARCH/READ
      // it shouldn't be blocked.
    } else if (prop.kind === 'wall-rune') {
      // A glyph scratched into the wall — invisible until the lamp finds it.
      const mark = prop.text
        ? { text: prop.text, glyph: prop.glyph, tint: prop.tint }
        : pickWallMark(spec.depth ?? 1, buildRng);
      spawnWallRune(root, new THREE.Vector3(prop.x, gy + (prop.height ?? 1.5), prop.z), prop.rotY ?? 0, mark);
    } else if (prop.kind === 'boss-mist') {
      // Soulslike fog wall. Spawn is DEFERRED until after the
      // walkable region is constructed (spawnBossMist takes a
      // WalkableRegion handle so it can add the seal obstacle on
      // cross). Collected here, processed below.
      pendingFittings.push({
        id: `fog-${Math.round(prop.x * 10)}-${Math.round(prop.z * 10)}`,
        kind: 'fog-gate',
        x: prop.x, z: prop.z, rotY: prop.rotY ?? 0,
        widthM: prop.width ?? 3.4, height: prop.height,
        color: prop.color,
      });
    } else if (prop.kind === 'vase') {
      // Push the obstacle FIRST, keep a reference, and remove it via the
      // region when the vase shatters. Routing through removeObstacle (not a
      // raw array splice) is load-bearing: collision + LOS + nav all read the
      // spatial HASH, not the array, so a bare splice left an invisible blocker
      // (and a ghost the mobs kept pathing around) where the vase stood.
      const vaseObs: Obstacle = { kind: 'circle', x: prop.x, z: prop.z, r: 0.18, yTop: gy + 0.6 };
      obstacles.push(vaseObs);
      const vase = spawnVase(root, prop.x, prop.z, () => {
        walkable.removeObstacle(vaseObs);
      });
      destructibles.push(vase);
    } else if (prop.kind === 'cobweb') {
      // Destructible web curtain — installed as a unified fitting (wall-segment
      // seal spanning the gap; slashing removes it). Deferred to the drain
      // below so it shares the same path as doors + the fog-gate.
      pendingFittings.push({
        id: `cobweb-${Math.round(prop.x * 10)}-${Math.round(prop.z * 10)}`,
        kind: 'cobweb',
        x: prop.x, z: prop.z, rotY: prop.rotY ?? 0, widthM: prop.widthM ?? 1.9,
      });
    } else if (prop.kind === 'vase-cluster') {
      // Cluster of 2-4 vases jittered around (x, z). Each gets
      // its own destructible entry + its own collision circle.
      // Build an obstacle list parallel to the cluster's vase
      // list so the spliceOnDestroy callback can find the right
      // one by index when an individual cluster member breaks.
      const clusterObs: Obstacle[] = [];
      const cluster = spawnVaseCluster(root, prop.x, prop.z, (idx) => {
        const obs = clusterObs[idx];
        if (obs) walkable.removeObstacle(obs);   // hash + nav, not a raw splice
      });
      for (const v of cluster) {
        destructibles.push(v);
        const obs: Obstacle = { kind: 'circle', x: v.position.x, z: v.position.z, r: 0.18, yTop: gy + 0.6 };
        clusterObs.push(obs);
        obstacles.push(obs);
      }
    } else if (prop.kind === 'spike-trap') {
      spawnSpikeTrap(
        root,
        new THREE.Vector3(prop.x, gy, prop.z),
        prop.damage ?? 2,
        prop.telegraphTime ?? 0.45,
      );
      // No collision — the plate is flat with the floor. The DAMAGE is
      // the trap. Walking through is the point.
    } else if (prop.kind === 'fountain') {
      spawnFountain(root, new THREE.Vector3(prop.x, gy, prop.z), prop.rotY ?? 0, prop.variant ?? 'gamble');
      // Cylindrical collision — approximate the pedestal/bowl footprint.
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.45, yTop: gy + 0.85,
      });
    } else if (prop.kind === 'reliquary') {
      spawnReliquary(root, new THREE.Vector3(prop.x, gy, prop.z), spec.depth ?? 1, materials);
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.45, yTop: gy + 1.3,
      });
    } else if (prop.kind === 'tithe-basin') {
      spawnTitheBasin(root, new THREE.Vector3(prop.x, gy, prop.z), spec.depth ?? 1, materials);
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.5, yTop: gy + 0.85,
      });
    } else if (prop.kind === 'merchant') {
      spawnMerchant(root, new THREE.Vector3(prop.x, gy, prop.z), prop.rotY ?? 0, spec.depth ?? 1);
      // Slim footprint — step around the hooded figure on the path.
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.35, yTop: gy + 1.6,
      });
    } else if (prop.kind === 'tome-pillar') {
      spawnTomePillar(root, new THREE.Vector3(prop.x, gy, prop.z), prop.rotY ?? 0);
      // Narrow pedestal footprint — tighter than the fountain so the
      // player can step around it on the central path without snagging.
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.32, yTop: gy + 1.1,
      });
    } else if (prop.kind === 'blood-altar') {
      // Hand-picked offering, or roll a cursed item by depth (the same gamble
      // pool as shrouded relics) so a vault that just declares a blood-altar
      // gets a depth-scaled reward instead of a fixed one.
      const item = prop.itemId ? ITEMS[prop.itemId] : rollCursedItem(spec.depth ?? 1, buildRng);
      if (item) {
        // Same AABB pattern as the starter altar — slightly wider
        // footprint matches the larger basin geometry. Stone block
        // stays a collider for the rest of the run.
        obstacles.push({
          kind: 'aabb',
          minX: prop.x - 0.44, maxX: prop.x + 0.44,
          minZ: prop.z - 0.36, maxZ: prop.z + 0.36,
          yTop: gy + 0.9,
        });
        spawnBloodAltar(
          root,
          new THREE.Vector3(prop.x, gy, prop.z),
          prop.rotY ?? 0,
          item,
          materials,
          undefined,
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`blood-altar references unknown itemId: ${prop.itemId}`);
      }
    } else if (prop.kind === 'starter-altar') {
      const weapon = ITEMS[prop.weaponId];
      if (weapon) {
        // Push the obstacle FIRST, keep a reference, and pass a
        // splice callback to spawnStarterAltar — interactable.onDestroy
        // will fire it so the AABB doesn't outlive the visible stone.
        // (The stone monument REMAINS visible after the weapon is taken,
        // so the splice would normally NOT fire here; we leave the
        // collision in place because the player can still walk into the
        // remaining stone block. If we ever want walk-through-empty-
        // altar later, swap to splice unconditionally.)
        const altarObs: Obstacle = {
          kind: 'aabb',
          minX: prop.x - 0.40, maxX: prop.x + 0.40,
          minZ: prop.z - 0.32, maxZ: prop.z + 0.32,
          yTop: gy + 1.0,
        };
        obstacles.push(altarObs);
        // onDestroy: no obstacle removal — stone block stays and
        // remains a collider. The hook is still wired in case future
        // iteration wants the empty altars to become walkable.
        spawnStarterAltar(
          root,
          new THREE.Vector3(prop.x, gy, prop.z),
          prop.rotY ?? 0,
          weapon,
          materials,
          undefined,
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`starter-altar references unknown weaponId: ${prop.weaponId}`);
      }
    } else if (prop.kind === 'hint') {
      // Diegetic tutorial hint — invisible trigger that fades a line of
      // italic text in over its world position as the player nears.
      // No collision, no model. The effect module owns its own DOM
      // element + per-frame tick (driven from main.ts).
      spawnTutorialHint({
        x: prop.x,
        z: prop.z,
        y: prop.y,
        text: prop.text,
        triggerRadius: prop.triggerRadius,
        lingerMs: prop.lingerMs,
        dismissOn: prop.dismissOn,
      });
    }
  }

  // Merge every pillar's baked parts into a SINGLE mesh — one draw call for
  // all pillars on the floor (they were ~8 meshes each). Non-pooled, so the
  // teardown traversal disposes it. mergeGeometries(…, false) → one material
  // group (all parts share materials.wall).
  if (pillarGeos.length > 0) {
    const merged = mergeGeometries(pillarGeos, false);
    for (const g of pillarGeos) g.dispose();
    if (merged) {
      const pillarsMesh = new THREE.Mesh(merged, materials.stone);
      pillarsMesh.castShadow = true;
      pillarsMesh.receiveShadow = true;
      pillarsMesh.name = 'pillars-merged';
      root.add(pillarsMesh);
    }
  }

  // Chasm drop geometry — one merged mesh for the vertical walls of every floor
  // void/crack. Uses the WALL material: its walls are VERTICAL, so the wall
  // material's projection textures them with brick correctly. (The ceiling
  // material projects horizontally and smeared the texture straight down the
  // drop — the carvings read as untextured.) materials.wall is double-sided, so
  // the inner faces render without a clone.
  if (spec.voids && spec.voids.length > 0) {
    // One mesh PER VOID so each rim can sit at its own room's elevation
    // (the geometry bakes the rim at world y=0; the mesh lifts it).
    for (const v of spec.voids) {
      const dropGeo = makeChasmDropGeometry([v], CONFIG.CHASM_DROP_M, CONFIG.CHASM_FADE_M);
      if (!dropGeo) continue;
      const chasm = new THREE.Mesh(dropGeo, materials.chasmWall);
      chasm.position.y = groundYAt(v.x, v.z);
      chasm.receiveShadow = true;
      chasm.name = 'chasm-drop';
      chasm.userData.dbgKind = 'wall';
      chasm.userData.dbgSource = 'chasm-drop';
      root.add(chasm);
    }
  }

  // --- Extra walls (from tile-map parsing — interior walls inside the
  //     bounding room rect). Render them as wall meshes + add to
  //     collision so the player can't walk through them.
  if (spec.extraWalls) {
    const defaultH = spec.rooms[0]?.height ?? 3.0;
    // Same per-floor merge as the shell walls — interior walls collapse to
    // one mesh. Collision still recorded per segment.
    const extraGeos: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4();
    for (const w of spec.extraWalls) {
      const H = w.height ?? defaultH;
      const baseY = w.baseY ?? 0;
      const dx = w.bx - w.ax;
      const dz = w.bz - w.az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const geo = makeJitteredPlane(len, H, { wavy: true });
      // X-running wall faces ±Z (yaw 0); Z-running faces ±X (yaw π/2).
      const yaw = Math.abs(dz) < Math.abs(dx) ? 0 : Math.PI / 2;
      const midX = (w.ax + w.bx) / 2;
      const midZ = (w.az + w.bz) / 2;
      // Sit the segment on the ROOM FLOOR under it (these interior walls /
      // niche divisions live inside one flat room). Without the ground
      // offset the wall built at world baseY and floated, its foot hanging
      // metres above a sunken room's floor — the "niche doesn't reach the
      // bottom" / cave-in-in-mid-air bug.
      const gy = groundYAt(midX, midZ);
      m4.makeRotationY(yaw);
      m4.setPosition(midX, gy + baseY + H / 2, midZ);
      geo.applyMatrix4(m4);
      extraGeos.push(geo);
      // Elevated segments are lintels (doorway caps) — visual only. The gap
      // below them must stay walkable, so they get NO collision segment.
      if (baseY <= 0.01) wallSegments.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz });
    }
    if (extraGeos.length > 0) {
      const merged = mergeGeometries(extraGeos, false);
      for (const g of extraGeos) g.dispose();
      if (merged) {
        const mesh = new THREE.Mesh(merged, materials.wall);
        applyShadowRole(mesh, 'receive');   // walls = shell, receive-only (was casting into the lamp cube map)
        mesh.name = 'extra-walls-merged';
        mesh.userData.dbgKind = 'wall';
        mesh.userData.dbgSource = 'extra-walls (merged)';
        root.add(mesh);
      }
    }
  }

  // Floor grounding (post-passes — every wall segment now exists and props are
  // placed): wall-contact AO baked from ALL nearby walls so it's continuous
  // across room↔corridor junctions (no seam), then prop contact shadows.
  bakeFloorWallContacts(root, wallSegments);
  bakePropContactShadows(root, spec.props);

  // Scatter the dungeon's remembered dead — wall-runes the lamp will reveal.
  scatterWallRunes(root, spec);

  // --- Torches / wall cressets ---
  // Each TorchSpec carries a fixtureKind set at emission time by
  // pickWallFixture (defaults to 'torch' for legacy specs). Resolve
  // the kind to the right ModelSpec and hand it to createTorchlight,
  // which is now model-agnostic.
  const torches: Torch[] = [];
  // ── CORRIDOR-MOUTH SCONCES (light doctrine: wayfinding) ──────────
  // One quiet sconce per corridor end, mounted on the corridor's SIDE
  // wall just inside the mouth — exits glow from within the passage,
  // rooms keep their authored mood untouched. v1 mounted sconces on
  // the ROOM side of every opening and taught three lessons at once:
  // small rooms with close doorways BUNCHED lights (4+ in a closet),
  // corner placements stuck fixtures halfway into walls, and ~20 extra
  // lights oversubscribed the light pool so slots churned visibly
  // (pop-in, and the safe-room brazier lost its slot entirely).
  // Corridor-side placement kills all three: few corridors per floor,
  // no corners, no room-side light creep.
  {
    const sconces: typeof spec.torches = [];
    for (const c of spec.corridors) {
      if (c.logicalOnly) continue;
      const horizontal = c.rect.w >= c.rect.d;
      const len = horizontal ? c.rect.w : c.rect.d;
      const breadth = horizontal ? c.rect.d : c.rect.w;
      if (breadth < 1.0) continue;
      // SPARSE, PATTERNLESS beacons — explicitly NOT one per mouth
      // (a guaranteed sconce at every corridor end reads as wallpaper
      // rule, and some corridors SHOULD be black). Each mouth rolls
      // independently: most corridors get one beacon, some get two,
      // roughly a quarter stay dark — variance is the pattern-breaker.
      const candidates = len >= 2.6 ? [-1, 1] : [0];
      const ends = candidates.filter(() => buildRng() < 0.55);
      for (const e of ends) {
        const along = (horizontal ? c.rect.x : c.rect.z) + e * Math.max(0, len / 2 - 0.55);
        // 0.18m clearance off the wall plane — same convention as the
        // '*' tile emitter (tilemap.ts WALL_OFFSET): the sconce arm's
        // back sinks into the wall, the bowl + flame sit clear of it.
        const sx = horizontal ? along : c.rect.x - c.rect.w / 2 + 0.18;
        const sz = horizontal ? c.rect.z - c.rect.d / 2 + 0.18 : along;
        const wall = horizontal ? 'N' as const : 'W' as const;
        if (spec.torches.some((t) => Math.hypot(t.x - sx, t.z - sz) < 1.8)) continue;
        // Inherit the mood of the room this mouth leads to — a pale
        // chamber should glow pale into its corridor, not clash a
        // warm sconce against its tinted torches two metres away.
        const mouthX = horizontal ? c.rect.x + e * (len / 2) : sx;
        const mouthZ = horizontal ? sz : c.rect.z + e * (len / 2);
        let mouthTint: number | undefined;
        let bestD = Infinity;
        for (const room of spec.rooms) {
          if (room.logicalOnly) continue;
          const dx = Math.max(Math.abs(mouthX - room.rect.x) - room.rect.w / 2, 0);
          const dz = Math.max(Math.abs(mouthZ - room.rect.z) - room.rect.d / 2, 0);
          const d = dx + dz;
          if (d < bestD) {
            bestD = d;
            mouthTint = averageTorchTintInRect(spec.torches, room.rect) ?? undefined;
          }
        }
        sconces.push({
          x: sx, z: sz, height: 1.85, wall,
          colorTint: mouthTint,
          // Wayfinding, not mood: quiet.
          intensityMul: 0.5,
        });
      }
    }
    spec.torches.push(...sconces);
  }
  // ── ORPHANED-TORCH CULL — no fixtures floating in carved openings ──
  // Vault authors and the procedural sprinkler mount torches against
  // VAULT-LOCAL walls; the composer (and hand-authored door layouts)
  // then cut openings into those same walls, leaving any torch on the
  // carved stretch hanging mid-air in the doorway. v1 guessed a single
  // owner rect and trusted the torch's declared wall letter — both can
  // mismatch after composition (it missed the safe-room exit torch).
  // Now: collect EVERY opening on every wall of every rect, and cull
  // any torch that hugs that wall plane (≤0.6m) inside the opening
  // span (+0.35m fixture margin). No owner guessing, no letter trust.
  {
    interface OpeningSeg { perpAxis: 'x' | 'z'; perpCoord: number; start: number; end: number }
    const openSegs: OpeningSeg[] = [];
    for (const r of allRects) {
      if (r.logicalOnly) continue;
      const rect = r.rect;
      const hw = rect.w / 2, hd = rect.d / 2;
      const walls = [
        { perpAxis: 'x' as const, perpCoord: rect.x - hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
        { perpAxis: 'x' as const, perpCoord: rect.x + hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
        { perpAxis: 'z' as const, perpCoord: rect.z - hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
        { perpAxis: 'z' as const, perpCoord: rect.z + hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
      ];
      for (const w of walls) {
        for (const op of findOpenings(w, allRects, r)) {
          openSegs.push({ perpAxis: w.perpAxis, perpCoord: w.perpCoord, start: op.start, end: op.end });
        }
      }
    }
    spec.torches = spec.torches.filter((t) => {
      for (const o of openSegs) {
        const perp = o.perpAxis === 'x' ? t.x : t.z;
        const along = o.perpAxis === 'x' ? t.z : t.x;
        if (Math.abs(perp - o.perpCoord) <= 0.6 &&
            along > o.start - 0.35 && along < o.end + 0.35) return false;
      }
      return true;
    });
  }
  // ── PER-ROOM LIGHT BUDGET — the reconciler ────────────────────────
  // Torches arrive from four independent systems (authored '*' tiles,
  // power-authored vault.torches, the procedural sprinkler, corridor
  // sconces) and none of them can see the TOTAL. This pass is the one
  // place with full awareness: per room, cap the fixture count by
  // area + darkness tier (a 5×5 'dim' room does not need four
  // torches), dropping the sprinkler's torches first and authored
  // ones never. Cool/pale tints also get a perceptual discount —
  // blue-white light reads markedly brighter than warm at equal
  // intensity (the washed-out 'white room' screenshots).
  {
    const drop = new Set<typeof spec.torches[number]>();
    for (const room of spec.rooms) {
      if (room.logicalOnly) continue;
      const rect = room.rect;
      const inRoom = spec.torches.filter((t) =>
        Math.abs(t.x - rect.x) <= rect.w / 2 + 0.45 &&
        Math.abs(t.z - rect.z) <= rect.d / 2 + 0.45);
      if (inRoom.length === 0) continue;
      const tier = room.lightTier ?? 'lit';
      const per = tier === 'lit' ? 15 : tier === 'dim' ? 21 : 34;
      const cap = Math.max(1, Math.min(4, Math.round((rect.w * rect.d) / per)));
      let excess = inRoom.length - cap;
      for (const t of inRoom) {
        if (excess <= 0) break;
        if (t.procedural) { drop.add(t); excess--; }
      }
      for (const t of inRoom) {
        if (drop.has(t)) continue;
        const c = t.colorTint;
        if (c !== undefined && (c & 0xff) > ((c >> 16) & 0xff)) {
          t.intensityMul = (t.intensityMul ?? 1) * 0.82;
        }
      }
    }
    if (drop.size > 0) {
      spec.torches = spec.torches.filter((t) => !drop.has(t));
    }
  }
  // ── ENGRAVED ROOMS — swap pools for rake (Josh's groove-glow) ─────
  // A share of dim/dark rooms trade the sprinkler's wall torches for
  // WALL STUBS: guttering candles mounted ~10cm off the wall plane,
  // whose light strikes the wall at grazing incidence along its whole
  // length. The brick faces stay dark; the mortar grooves and brick
  // edges ignite — the room reads as stone drawn in thin lines of
  // fire instead of a bright pool. Authored '*' torches are never
  // touched; rooms that are all-authored only convert if they had no
  // light at all (rake is a gift to a black room, a theft from a lit
  // one).
  const engravedRooms = new Set<string>();
  for (const room of spec.rooms) {
    if (room.logicalOnly) continue;
    const tier = room.lightTier ?? 'lit';
    if (tier === 'lit') continue;
    const rect = room.rect;
    if (rect.w * rect.d < 16) continue;
    const inRoom = (t: { x: number; z: number }) =>
      Math.abs(t.x - rect.x) <= rect.w / 2 + 0.45 && Math.abs(t.z - rect.z) <= rect.d / 2 + 0.45;
    const mine = spec.torches.filter(inRoom);
    const procCount = mine.filter((t) => t.procedural).length;
    if (procCount === 0 && mine.length > 0) continue;
    if (buildRng() >= 0.35) continue;
    spec.torches = spec.torches.filter((t) => !(t.procedural && inRoom(t)));
    const tint = averageTorchTintInRect(spec.torches, rect) ?? undefined;
    const horizontal = rect.w >= rect.d;
    const RAKE_OFF = 0.10;   // tighter than the torch's 0.18 — grazing is the point
    for (const [frac, side] of [[0.33, -1], [0.67, 1]] as Array<[number, number]>) {
      const sx = horizontal ? rect.x + (frac - 0.5) * rect.w : rect.x + side * (rect.w / 2 - RAKE_OFF);
      const sz = horizontal ? rect.z + side * (rect.d / 2 - RAKE_OFF) : rect.z + (frac - 0.5) * rect.d;
      if (pillarBlocksOpening(sx, sz)) continue;
      spec.torches.push({
        x: sx, z: sz, height: 1.5,
        wall: horizontal ? (side < 0 ? 'N' : 'S') : (side < 0 ? 'W' : 'E'),
        colorTint: tint,
        intensityMul: 1,
        fixtureKind: 'wall-stub',
      });
    }
    engravedRooms.add(room.id);
  }
  // ── SEEP — the floor's mood decides if its walls bleed ────────────
  // Strong-mood floors run liquid light through their groove network
  // (surface-detail.ts seep pass): blood floors bleed, green floors
  // ooze, violet floors weep. Warm/pale/gold floors stay dry — the
  // seep is a SIGNAL of a committed mood, not wallpaper.
  {
    const counts = new Map<number, number>();
    for (const t of spec.torches) {
      if (t.colorTint !== undefined) counts.set(t.colorTint, (counts.get(t.colorTint) ?? 0) + 1);
    }
    let dom = 0, domN = 0;
    for (const [c, n] of counts) if (n > domN) { dom = c; domN = n; }
    const SEEP_STRENGTH: Record<number, number> = {
      0xff5040: 0.50,   // blood
      0x70d090: 0.40,   // sickly green
      0xa080ff: 0.35,   // violet
    };
    setSurfaceSeep(dom, (SEEP_STRENGTH[dom] ?? 0) * 0.5);   // seep is the garnish now
    // WETNESS is the star: glossy seams that catch real specular from
    // every light — view-dependent, alive, coloured by the lights
    // themselves. Mood floors run wet; warm floors stay dry. Scaled by the
    // mood's seep intensity (blood wettest, violet faintest) rather than a flat
    // 0.85 — that binary snap over-glossed every mood floor into a "wet gold"
    // sheen on deeper levels (warm lamp specular blowing out too-high gloss).
    const WETNESS_SCALE = 1.0;   // ×SEEP_STRENGTH → blood 0.50, green 0.40, violet 0.35
    setSurfaceWetness((SEEP_STRENGTH[dom] ?? 0) * WETNESS_SCALE);
  }
  // ── CHANDELIERS — light from above for tall rooms ────────────────
  // One hung central source paints a wider pool than any wall torch
  // and costs ONE env slot; in trade the room sheds its sprinkler
  // torches. Ceiling-height aware (chandelier.ts). Skips god-ray
  // rooms (the ray owns the room's signal) and dark-tier rooms.
  for (const room of spec.rooms) {
    if (room.logicalOnly) continue;
    const rect = room.rect;
    const H = room.height ?? 3.2;
    if ((room.ceilingStyle ?? 'flat') !== 'flat') continue;
    if (room.wallVariant === 'braced') continue;
    if ((room.lightTier ?? 'lit') === 'dark') continue;
    if (engravedRooms.has(room.id)) continue;   // engraved rooms keep their rake
    if (H < 3.2 || rect.w * rect.d < 26) continue;
    if (godRayLightPos.some((g) =>
      Math.abs(g.x - rect.x) <= rect.w / 2 && Math.abs(g.z - rect.z) <= rect.d / 2)) continue;
    if (buildRng() >= 0.38) continue;
    const cx = rect.x + (buildRng() - 0.5) * 1.2;
    const cz = rect.z + (buildRng() - 0.5) * 1.2;
    const tint = averageTorchTintInRect(spec.torches, rect) ?? undefined;
    spawnChandelier(root, cx, cz, H, tint, lightSerial++);
    // The trade: the chandelier covers the room's middle — shed up to
    // two of the sprinkler's wall torches.
    let shed = 2;
    spec.torches = spec.torches.filter((t) => {
      if (shed <= 0 || !t.procedural) return true;
      const inside =
        Math.abs(t.x - rect.x) <= rect.w / 2 + 0.45 &&
        Math.abs(t.z - rect.z) <= rect.d / 2 + 0.45;
      if (inside) { shed--; return false; }
      return true;
    });
  }
  for (const t of spec.torches) {
    const torch = createTorchlight(
      root,
      // TorchSpec.height is metres above the FLOOR — lift by the ground
      // under the fixture so wall torches ride their room's elevation.
      new THREE.Vector3(t.x, groundYAt(t.x, t.z) + t.height, t.z),
      torchYawForWall(t.wall),
      t.colorTint,
      t.intensityMul,
      wallFixtureModel(t.fixtureKind),
    );
    torches.push(torch);
    // Bind to its containing room (and any LOGICAL sub-rooms it sits in) for
    // runtime mood overrides — e.g. the ritual altar paints its arena sub-
    // room red while the encounter runs. setRoomMood(subRoomId) only finds
    // torches bound to that exact id, so we bind through every containing
    // rect, smallest first.
    const ownerRoom = smallestNonLogicalContaining(spec.rooms, t.x, t.z);
    if (ownerRoom) {
      bindRoomMoodLight(ownerRoom, torch.source);
      if (torch.flameMaterial) bindRoomMoodFlame(ownerRoom, torch.flameMaterial);
    }
    for (const r of spec.rooms) {
      if (!r.logicalOnly) continue;
      const hw = r.rect.w / 2, hd = r.rect.d / 2;
      if (t.x < r.rect.x - hw || t.x > r.rect.x + hw) continue;
      if (t.z < r.rect.z - hd || t.z > r.rect.z + hd) continue;
      bindRoomMoodLight(r.id, torch.source);
      if (torch.flameMaterial) bindRoomMoodFlame(r.id, torch.flameMaterial);
    }
  }

  // --- Stationary fill lights ---
  // A few very-low-intensity, no-flicker PointLights per rect. Real-
  // world bounced light has uneven low-level fill; this approximates it
  // without flattening the spotlight contrast.
  //
  // PERF: each PointLight costs PER FRAGMENT × every material — count
  // dominates frame time on mobile. Earlier density (1 per 22 m²) put
  // ~16 fills on a single procgen room; combined with torches, candles,
  // floor-glow lights, pickup-pool lights + the player lantern, scenes
  // hit 30+ PointLights and lagged hard. Current budget: ~1 per 45 m²,
  // max 4 per rect (bumped from 60m² / 3 cap because the phone was
  // dark-cornering in larger procgen rooms).
  //
  // Color: averaged from the torches actually placed in the room so the
  // fill agrees with the room's mood — a blood-tinted chamber gets a
  // red-tinted ambient fill, a sickly-green chamber gets sickly-green,
  // not a generic warm wash regardless of palette. Falls back to a
  // fog-mixed warm default when the room has no torches.
  const defaultFillColor = spec.fogColor !== undefined
    ? mixColors(spec.fogColor, 0x553322, 0.5)
    : 0x2a1a10;
  const corridorSet = new Set(spec.corridors);
  for (const r of allRects) {
    // Sub-rooms (logical-only) already live inside their parent's
    // rect — adding fill lights for them double-illuminates the
    // same volume.
    if (r.logicalOnly) continue;
    // LIGHT DOCTRINE — darkness tiers. The sourceless ambient wash is
    // what makes light feel undesigned; tiers give floors a brightness
    // RHYTHM instead of one even level. Corridors are always 'dim':
    // their threshold sconces light the mouths, the middle belongs to
    // the lamp.
    const tier = corridorSet.has(r) ? 'dim' : (r.lightTier ?? 'lit');
    if (tier === 'dark') continue;
    const tierMul = tier === 'dim' ? 0.55 : 1.0;
    const area = r.rect.w * r.rect.d;
    const count = Math.min(4, Math.max(1, Math.floor(area / 45)));
    // Average tint of torches inside this room's rect — what the
    // mood reads as. mixed with the default fill so the fill stays
    // dimmer/desaturated relative to the torches themselves.
    const fillColor = mixColors(
      averageTorchTintInRect(spec.torches, r.rect) ?? defaultFillColor,
      defaultFillColor,
      0.4,
    );
    for (let i = 0; i < count; i++) {
      const fx = r.rect.x + (((i * 1.6) % r.rect.w) - r.rect.w / 2 + r.rect.w / (count + 1));
      const fz = r.rect.z + (((i * 0.9) % r.rect.d) - r.rect.d / 2 + r.rect.d / (count + 1));
      registerLight({
        id: `fill-${lightSerial++}`,
        category: 'environment',
        position: new THREE.Vector3(fx, groundYAt(fx, fz) + 1.4, fz),
        color: fillColor,
        // The fill is the NAVIGABILITY FLOOR, not a light you notice:
        // broad window, gentle decay, low level. Torches paint pools
        // on top of it (config TORCH_* — pools, not floods).
        intensity: 4.5 * tierMul,
        distance: 8.0,
        decay: 1.3,
        // Ambience wash yields its slot to torches/signal glows when
        // the 6-slot environment budget is contended.
        priority: 'low',
      });
    }
  }

  // --- Procgen decoration pass (instanced) ---
  // procgenDecor is set by src/level/procgen.ts at generation time.
  // decorateFloor builds InstancedMesh batches of sigils + cracks +
  // rubble in a few draw calls instead of dozens of individual meshes.
  if (spec.procgenDecor) {
    const d = spec.procgenDecor;
    decorateFloor(d.grid, spec, rngFromSeed(d.seed), d.tint, root, stairFootprintAabbs);
  }

  // --- Per-floor fog tint ---
  // Atmospheric depth without flattening mood. The scene's Fog instance
  // gets a recolor per floor; the scene background tracks so the very-
  // distant horizon matches. Floor 2's blood crypt gets a faint red
  // tint, procgen depths get their template's torchTint, etc.
  if (spec.fogColor !== undefined && scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.color.setHex(spec.fogColor);
    if (scene.background && (scene.background as THREE.Color).isColor) {
      (scene.background as THREE.Color).setHex(spec.fogColor);
    }
  } else if (scene.fog && scene.fog instanceof THREE.Fog) {
    // Reset to the global default when a floor omits the field.
    scene.fog.color.setHex(CONFIG.FOG_COLOR);
    if (scene.background && (scene.background as THREE.Color).isColor) {
      (scene.background as THREE.Color).setHex(CONFIG.FOG_COLOR);
    }
  }

  // --- Walkable region (collision data; mutable so doors can add/remove) ---
  const walkable = new WalkableRegion(
    [...spec.rooms.map((r) => r.rect), ...spec.corridors.map((c) => c.rect)],
    obstacles,
    wallSegments,
  );

  // --- Pathfinding grids ---
  // Built once at level construction. Covers the bounding box of every
  // walkable rect; cells inside the box that aren't passable become
  // blocked. Two variants — standard (mobs avoid props) and phasing
  // (ghosts ignore props, walls only). Build cost is ~1ms at our cell
  // counts; query cost is sub-ms per chase.
  const navRects = allRects.map((r) => r.rect);
  const navBbox = {
    minX: Math.min(...navRects.map((r) => r.x - r.w / 2)),
    maxX: Math.max(...navRects.map((r) => r.x + r.w / 2)),
    minZ: Math.min(...navRects.map((r) => r.z - r.d / 2)),
    maxZ: Math.max(...navRects.map((r) => r.z + r.d / 2)),
  };
  // Gate funnel points: framed openings registered by their emitters.
  // Phasing mobs ignore obstacles entirely, so their grid skips gates.
  const nav = new NavGrid(walkable, navBbox, false, spec.navGates ?? []);
  const navPhasing = new NavGrid(walkable, navBbox, true);

  // --- Enemies + room-membership tracking ----------------------------
  // Each enemy faces the player spawn at level start so the very first frame
  // is correctly oriented.
  //
  // Room membership: an enemy belongs to the first rect whose AABB contains
  // its spawn (x,z). Used to know when a room is "cleared" for door gating.
  // Room membership keyed by the enemy's stable entityId (NOT the Enemy
  // object or its position) so the split-on-death callback can look up the
  // parent's room exactly — two enemies dying at the same spot used to
  // collide in a position-proximity scan.
  const roomByEntity = new Map<string, string | null>();
  const aliveByRoom = new Map<string, number>();
  const enemies: Enemy[] = [];
  const levelDepth = spec.depth ?? 1;

  // Single helper for spawning an enemy into the live level. Used by
  // both the initial spawn loop AND the split-on-death callback so the
  // bookkeeping (room membership, alive count) stays consistent across
  // both paths. Recursive: the spawned child receives `spawnInto`
  // again as its onDeath, so a child that itself has splitsInto will
  // also split correctly. Termination relies on the child spec NOT
  // carrying splitsInto (e.g. ooze-small has none — ooze cascades stop
  // after one generation).
  function spawnInto(baseSpec: EnemySpec, pos: THREE.Vector3, roomId: string | null): Enemy {
    const enemySpec = scaleEnemySpec(baseSpec, levelDepth, []);
    const resolved = walkable.resolveSpawn(pos.x, pos.z, enemySpec.collisionRadius);
    const e = createEnemy(
      root,
      new THREE.Vector3(resolved.x, groundYAt(resolved.x, resolved.z), resolved.z),
      enemySpec,
      onEnemyDeath,
    );
    enemies.push(e);
    roomByEntity.set(e.entityId, roomId);
    // Only player-THREATS count toward a room's clear gate — neutral vermin
    // (maggots) get real room membership but never hold a door shut.
    if (roomId && threatensPlayer(enemySpec.faction)) aliveByRoom.set(roomId, (aliveByRoom.get(roomId) ?? 0) + 1);
    // Every boss body (the king + each split child) joins the one boss
    // encounter, so "boss done" means ALL of them are dead.
    if (e.isBoss) registerBossMember(e);
    return e;
  }

  // SUMMON-GATE hook factory — the boss calls this when it wards itself. Spawns
  // its brood into the same sealed room (so room-clear + the boss encounter both
  // count them) and hands the bodies back so the boss can watch them: its ward
  // lifts when they're all dead. Mirrors the splitsInto scatter, but MID-fight.
  function makeOnSummon(roomId: string | null) {
    return (gate: NonNullable<EnemySpec['summonGate']>, atPos: THREE.Vector3): Enemy[] => {
      const childBase = ENEMIES[gate.enemyId];
      if (!childBase) return [];
      // ONE add per call — the boss spits them one at a time across HP thresholds
      // (enemy.ts drives the cadence). Fling it out in a random direction.
      const r = gate.radius ?? 1.6;
      const angle = gameRng() * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const child = spawnInto(childBase, new THREE.Vector3(atPos.x + cos * r, 0, atPos.z + sin * r), roomId);
      child.applyKnockback(cos, sin, 5.0);   // flung out of the parent as it splits
      kickShake(0.24, 0.4);
      return [child];
    };
  }

  // Deferred boss reward — the boss's hoard is held back from its own death drop
  // (enemy.ts suppresses it for isBoss) and erupts here when the whole encounter
  // ends, beside the rising bonfire. Captured from the authored boss spawn +
  // its final death position.
  let bossRewardSpec: EnemySpec | null = null;
  let bossDeathPos: THREE.Vector3 | null = null;
  let bossRoomId: string | null = null;

  // Fired right after an enemy dies in enemy.ts:takeDamage. Handles
  // splitsInto — spawns N children scattered in a small ring around
  // the death position. Roomid comes from where the PARENT was
  // tracked so split children stay attributed to the same room for
  // door-clear bookkeeping (kill the parent → kids spawn in the same
  // sealed combat room → you have to kill them too).
  const onEnemyDeath = (deadSpec: EnemySpec, deathPos: THREE.Vector3, deadEntityId: string) => {
    // Remember where each boss body fell — the king dies LAST (warded until its
    // brood is cleared), so this ends up holding the king's spot, which is where
    // the reward + bonfire erupt on encounter completion.
    if (deadSpec.isBoss) bossDeathPos = deathPos.clone();
    const split = deadSpec.splitsInto;
    if (!split) return;
    const childBase = ENEMIES[split.enemyId];
    if (!childBase) return;
    const radius = split.radius ?? 0.4;
    // The parent's room, looked up EXACTLY by its entityId (set at spawn).
    // Children inherit it so they stay attributed to the same sealed combat
    // room for door-clear bookkeeping.
    const parentRoom = roomByEntity.get(deadEntityId) ?? null;
    // A splitting "spit" — the parent bursts and flings the spawns
    // outward (a screen-shake thud + an outward knockback impulse on each
    // so they scatter dynamically, then settle), rather than just popping
    // into place. The parent's own death dissolve provides the goo.
    const bigSplit = split.count >= 3;
    if (bigSplit) kickShake(0.3, 0.4);
    // A BOSS splitting is a phase transition (king → its spawns = phase 2).
    if (deadSpec.isBoss) advanceBossPhase();
    for (let i = 0; i < split.count; i++) {
      const angle = (i / split.count) * Math.PI * 2 + gameRng() * 0.3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const childPos = new THREE.Vector3(
        deathPos.x + cos * radius,
        0,
        deathPos.z + sin * radius,
      );
      const child = spawnInto(childBase, childPos, parentRoom);
      // Fling it outward from the burst point.
      child.applyKnockback(cos, sin, bigSplit ? 6.0 : 3.5);
    }
  };

  for (const s of spec.spawns) {
    const baseSpec = ENEMIES[s.enemyId];
    if (!baseSpec) {
      // eslint-disable-next-line no-console
      console.warn(`Unknown enemyId in spawn: ${s.enemyId}`);
      continue;
    }
    // Difficulty pipeline — apply depth scaling + any modifier tags on
    // the spawn entry. Returns an instance-ready spec (the registry
    // entry is never mutated).
    const enemySpec = scaleEnemySpec(baseSpec, levelDepth, s.modifiers);
    // Resolve the spawn against the walkable region — if the authored
    // (or procgen-rolled) cell lands on a fountain / altar / pillar /
    // wall, scan outward for the nearest free spot. Without this, mobs
    // can spawn stuck inside a prop and never move.
    const resolved = walkable.resolveSpawn(s.x, s.z, enemySpec.collisionRadius);
    // Room membership uses the resolved position so a mob nudged across
    // a doorway is attributed to the room it actually ended up in. Computed
    // BEFORE createEnemy so the summon hook can hand its brood the same room.
    const roomId = s.roomId ?? findRoomContaining(resolved.x, resolved.z, spec.rooms);
    const enemy = createEnemy(
      root,
      new THREE.Vector3(resolved.x, groundYAt(resolved.x, resolved.z), resolved.z),
      enemySpec,
      onEnemyDeath,
      { dormant: s.dormant, onSummon: makeOnSummon(roomId) },
    );
    enemy.faceWorld(spec.startPos.x, spec.startPos.z);
    enemies.push(enemy);
    roomByEntity.set(enemy.entityId, roomId);
    if (roomId && threatensPlayer(enemySpec.faction)) aliveByRoom.set(roomId, (aliveByRoom.get(roomId) ?? 0) + 1);
    // Authored boss spawns (the king) MUST join the encounter container too
    // — without this they're never a `liveBossMember`, so the boss bar never
    // engages and a dormant boss stays asleep forever. (The split helper
    // registers spawned children; this is the missing initial-spawn case.)
    if (enemy.isBoss) { registerBossMember(enemy); bossRewardSpec = enemySpec; bossRoomId = roomId; }
  }

  // ── AMBIENT MAGGOTS — the dungeon's vermin (task #76) ────────────────────
  // Harmless larval crawlers sprinkled through the floor as living atmosphere.
  // They get REAL room membership — the faction system (content/factions.ts) is
  // what keeps them from gating a door: 'vermin' never counts as a player-threat,
  // so a sealed combat room ignores them (and they never aggro you). No placement
  // hack. Skips the entrance room and the boss arena, caps per floor, seeded.
  if (ENEMIES['maggot']) {
    const magRng = rngFromSeed(hashStringToSeed(`maggots:${spec.id}:${levelDepth}`));
    const startRoomId = findRoomContaining(spec.startPos.x, spec.startPos.z, spec.rooms);
    const bossMaggotSpawn = spec.spawns.find((s) => ENEMIES[s.enemyId]?.isBoss);
    const bossRoomIdForMaggots = bossMaggotSpawn
      ? findRoomContaining(bossMaggotSpawn.x, bossMaggotSpawn.z, spec.rooms) : null;
    let placed = 0;
    const MAX_MAGGOTS = 6;
    for (const room of spec.rooms) {
      if (placed >= MAX_MAGGOTS) break;
      if (room.id === startRoomId || room.id === bossRoomIdForMaggots) continue;
      if (magRng() > 0.42) continue;                 // ~42% of eligible rooms get a nest
      const n = 1 + Math.floor(magRng() * 3);        // a small cluster of 1..3
      for (let i = 0; i < n && placed < MAX_MAGGOTS; i++) {
        const px = room.rect.x + (magRng() - 0.5) * Math.max(0, room.rect.w - 1.4);
        const pz = room.rect.z + (magRng() - 0.5) * Math.max(0, room.rect.d - 1.4);
        spawnInto(ENEMIES['maggot'], new THREE.Vector3(px, 0, pz), room.id);
        placed++;
      }
    }
  }

  // When the whole boss encounter ends (king + every summoned prince dead), the
  // held-back hoard erupts and a bonfire RISES from the arena floor — the boss's
  // essence poured into a rest-fire the delver earns. Registered once per floor,
  // only when a boss actually spawned.
  if (bossRewardSpec) {
    const rewardSpec = bossRewardSpec;
    onBossEncounterComplete(() => {
      // The fire rises at the ARENA CENTRE (the boss's room), not wherever the
      // boss happened to die — a central, always-reachable spot so the reward is
      // never marooned in a corner or a hazard void. The boss's DEATH SPOT is the
      // stream origin: its green death-energy flows from where it fell into the
      // rising fire, guiding the eye there.
      const bossRoom = bossRoomId ? spec.rooms.find((r) => r.id === bossRoomId) : undefined;
      const centre = bossRoom ? { x: bossRoom.rect.x, z: bossRoom.rect.z } : { x: spec.startPos.x, z: spec.startPos.z };
      const safe = walkable.resolveSpawn(centre.x, centre.z, 0.5);
      const at = new THREE.Vector3(safe.x, groundYAt(safe.x, safe.z), safe.z);
      const fell = bossDeathPos ? bossDeathPos.clone() : at.clone();
      // The bonfire emerges here (rumble + the boss's souls streaming in from
      // where it fell), then becomes a REST fire that heals + deals a major arcana.
      spawnBossBonfire(root, at.clone(), levelDepth, fell);
      // The deferred hoard — the boss's whole 'boss' drop table, erupting around
      // the new fire on their own arcs (gold flies to the counter).
      const bundle = rollDropTable(rewardSpec.dropTable ?? 'boss', levelDepth, gameRng);
      const N = bundle.items.length;
      bundle.items.forEach((item, i) => {
        const angle = (N > 1 ? (i / N) * Math.PI * 2 : gameRng() * Math.PI * 2) + (gameRng() - 0.5) * 0.5;
        const hs = 1.6 + gameRng() * 0.6;
        const launchVel = new THREE.Vector3(Math.cos(angle) * hs, 3.8 + gameRng() * 0.5, Math.sin(angle) * hs);
        createPickup(root, at.clone(), item, { velocity: launchVel });
      });
      if (bundle.gold > 0) {
        const coinOrigin = at.clone(); coinOrigin.y += 0.6;
        spawnGoldCoins(root, coinOrigin, bundle.gold);
      }
    });
  }

  // --- Doors ---------------------------------------------------------
  // Doors close gaps in the wall layout. They start sealed if their unlock
  // condition isn't met (defaults: cleared rooms). They listen for
  // room:cleared events to flip to closed (interactable). Arena doors
  // are now driven by cross-axis trigger in door.ts; no level-side
  // lookup needed.
  // Fold the legacy DoorSpec list into the unified opening list — a door is
  // just a fitting in a wall opening. Centre + wall-line rotY + span come
  // straight off the segment; endpoints carried through so the door builder's
  // hinge math is byte-identical.
  for (const d of spec.doors ?? []) {
    pendingFittings.push({
      id: d.id,
      kind: d.unlock?.kind === 'cleared' ? 'gate-cleared'
          : d.unlock?.kind === 'arena'   ? 'gate-arena'
          : 'door-hinged',
      x: (d.ax + d.bx) / 2, z: (d.az + d.bz) / 2,
      rotY: Math.atan2(d.bz - d.az, d.bx - d.ax),
      widthM: Math.hypot(d.bx - d.ax, d.bz - d.az),
      height: d.height,
      ax: d.ax, az: d.az, bx: d.bx, bz: d.bz,
      hinge: d.hinge, swingDir: d.swingDir,
      // An arena gate whose room holds a challenge offering becomes a
      // voluntary 'offering' trigger — it won't slam on entry; the offering
      // starts the trial. Otherwise it's the default trap (slam on cross).
      unlock: d.unlock?.kind === 'arena' && d.unlock.roomIds.some((r) => offeringRooms.has(r))
        ? { ...d.unlock, trigger: 'offering' as const }
        : d.unlock,
    });
  }
  // PERIMETER-FITTING AUTO-INSTALL — for any room declaring a perimeterFitting
  // policy, walk its 4 walls and add the matching fitting at every external
  // opening the composer cut. This is what lets a CHALLENGE arena seal every
  // entrance visually (a portcullis drops at each one when the encounter
  // activates) instead of relying on a single authored gate at one entrance.
  // Authored fittings already at the same opening centre are skipped so a
  // mixed layout (one authored door + auto-installed perimeter elsewhere)
  // works without duplicates.
  for (const room of spec.rooms) {
    if (!room.perimeterFitting) continue;
    if (room.logicalOnly) continue;
    const rect = room.rect;
    const hw = rect.w / 2, hd = rect.d / 2;
    const walls = [
      { perpAxis: 'x' as const, perpCoord: rect.x - hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
      { perpAxis: 'x' as const, perpCoord: rect.x + hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
      { perpAxis: 'z' as const, perpCoord: rect.z - hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
      { perpAxis: 'z' as const, perpCoord: rect.z + hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
    ];
    for (const w of walls) {
      // Rect adjacency for openings includes CORRIDORS as well as rooms —
      // the composer connects vaults via corridors, so a room→corridor
      // opening is the most common entrance shape. allRects (= rooms +
      // corridors) is what the wall-shell builder uses for the same reason.
      // Passing spec.rooms alone here was the bug that made the challenge
      // arena spawn ZERO portcullises when the composer routed every
      // entrance through a corridor.
      const openings = findOpenings(w, allRects, room);
      for (const op of openings) {
        const seg = w.perpAxis === 'x'
          ? { ax: w.perpCoord, az: op.start, bx: w.perpCoord, bz: op.end }
          : { ax: op.start, az: w.perpCoord, bx: op.end, bz: w.perpCoord };
        const cx = (seg.ax + seg.bx) / 2;
        const cz = (seg.az + seg.bz) / 2;
        if (pendingFittings.some((p) => Math.abs(p.x - cx) < 0.1 && Math.abs(p.z - cz) < 0.1)) continue;
        const widthM = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
        const rotY = Math.atan2(seg.bz - seg.az, seg.bx - seg.ax);
        if (room.perimeterFitting === 'arena-portcullis') {
          pendingFittings.push({
            id: `auto-portcullis-${room.id}-${pendingFittings.length}`,
            kind: 'gate-arena',
            x: cx, z: cz, rotY, widthM,
            ax: seg.ax, az: seg.az, bx: seg.bx, bz: seg.bz,
            // Sealed-side is THIS room; trigger 'offering' so the gate doesn't
            // slam on cross — the room's altar activates the encounter, which
            // seals all of these in unison.
            unlock: { kind: 'arena', roomIds: [room.id], trigger: 'offering' as const },
          });
        } else if (room.perimeterFitting === 'arena-trap') {
          // TRAP variant: same portcullises, default 'cross' trigger —
          // committing through ANY entrance trips the gauntlet and every
          // gate slams. Single-room layout: no internal 'D' row, so the
          // tilemap flood-fill never splits the vault into the phantom
          // sub-rooms that used to surface as tiny rooms in the void.
          pendingFittings.push({
            id: `auto-trapgate-${room.id}-${pendingFittings.length}`,
            kind: 'gate-arena',
            x: cx, z: cz, rotY, widthM,
            ax: seg.ax, az: seg.az, bx: seg.bx, bz: seg.bz,
            unlock: { kind: 'arena', roomIds: [room.id] },
          });
        } else if (room.perimeterFitting === 'cobweb') {
          // NEST variant: every entrance sealed by a destructible web —
          // the den is closed until you cut your way in, from whichever
          // side you found it. Replaces the single authored '%' curtain
          // (which split the vault into sub-rooms the same way 'D' did).
          pendingFittings.push({
            id: `auto-cobweb-${room.id}-${pendingFittings.length}`,
            kind: 'cobweb',
            x: cx, z: cz, rotY, widthM,
            ax: seg.ax, az: seg.az, bx: seg.bx, bz: seg.bz,
          });
        }
      }
    }
  }
  // Drain — install every fitting at its opening. Per-opening room height so a
  // door/gate/fog lintel fills to the right ceiling.
  const doorTeardowns: Array<() => void> = [];
  for (const o of pendingFittings) {
    const r = spawnFitting(root, o, walkable, {
      materials,
      enemyRoomMembership: () => aliveByRoom,
      roomHeight: roomHeightAt(spec.rooms, o.x, o.z),
      addDestructible: (d) => destructibles.push(d),
      roomRectById: (id) => spec.rooms.find((rm) => rm.id === id)?.rect ?? null,
    });
    if (r.teardown) doorTeardowns.push(r.teardown);
  }

  // --- Arenas --------------------------------------------------------
  // A room sealed by an ARENA gate becomes a wave-gauntlet ENCOUNTER. The
  // gate's slam activates it; it summons escalating waves and resolves only
  // once the LAST wave is dead — which is what lets the gate finally rise.
  // The gate gates on the encounter's completion (not the momentary room-empty
  // count), so it stays down at slam and through the inter-wave lulls. This is
  // the first user of the Encounter layer (see encounters/registry.ts); ticks
  // run globally via tickEncounters in the system loop.
  const seenArenaRooms = new Set<string>();
  function registerArenaForRoom(roomId: string): void {
    if (seenArenaRooms.has(roomId)) return;
    seenArenaRooms.add(roomId);
    const room = spec.rooms.find((r) => r.id === roomId);
    if (!room) return;
    // Escalating gauntlet, ROLLED per floor+room from the depth-appropriate
    // enemy pool (was a fixed ghoul/skeleton/acid triad — same every trial,
    // boring). Deterministic: seeded from the room id so a replay reproduces the
    // exact gauntlet. Intensity climbs light→medium→heavy so the last wave bites.
    const depth = spec.depth ?? 1;
    const arenaRng = rngFromSeed(hashStringToSeed(`arena:${roomId}:${depth}`));
    const toWave = (ids: string[]): WaveSpec => {
      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      return { spawns: [...counts].map(([enemyId, count]) => ({ enemyId, count })) };
    };
    const waves: WaveSpec[] = [
      toWave(rollFloorEnemies(depth, 2, 'light', arenaRng)),
      toWave(rollFloorEnemies(depth, 3, 'medium', arenaRng)),
      toWave(rollFloorEnemies(depth, 3, 'heavy', arenaRng)),
    ];
    let handle: EncounterHandle;
    const controller = createArenaController({
      roomId,
      scene: root,
      rect: room.rect,
      waves,
      tint: 0xc01818,
      walkable,
      spawn: (enemyId, pos) => {
        const base = ENEMIES[enemyId];
        return base ? spawnInto(base, pos, roomId) : null;
      },
      onComplete: () => handle.complete(),
    });
    handle = registerEncounter(arenaEncounterId(roomId), {
      onActivate: () => controller.start(),
      tick: (dt, pos) => controller.tick(dt, pos),
    });
  }
  // Door-based arenas — the trap variant: a 'D' gate slams on cross.
  for (const d of spec.doors ?? []) {
    if (d.unlock?.kind !== 'arena') continue;
    for (const roomId of d.unlock.roomIds) registerArenaForRoom(roomId);
  }
  // Offering-based arenas — the challenge variant: no gate, no alcove. The
  // altar's onUse activates the encounter, the encounter's activate reactor
  // walls every external opening of the room (see seal-external-openings
  // loop below).
  for (const roomId of offeringRooms) registerArenaForRoom(roomId);
  // Perimeter trap arenas: the auto-installed gates carry the arena unlock,
  // but wave registration keys off rooms — register each trap room.
  for (const room of spec.rooms) {
    if (room.perimeterFitting === 'arena-trap') registerArenaForRoom(room.id);
  }

  // ARENA EXTERNAL-OPENING SEAL — while the arena's encounter is ACTIVE,
  // every external opening on the room(s) of the arena is walled off so the
  // player or an escaped enemy can't slip around the trial. Two flavours:
  //
  //   GATE-based (combat arena, the trap):
  //     complex = sealed-side room + alcove. The gate detects via the
  //     wall segment between them; external openings to NON-complex rooms
  //     are walled. Internal openings between sealed/alcove are the gate
  //     itself (logicalOnly sub-rooms — findOpenings auto-skips them).
  //
  //   OFFERING-based (challenge arena, the altar):
  //     complex = the altar's single room. No alcove, no gate. EVERY
  //     external opening on the room's perimeter is walled by the
  //     encounter's activation reactor; restored on completion.
  //
  // Both flavours fold through the same wireSeal() helper.
  function wireSealForArena(encId: string, arenaRoomIds: Set<string>): void {
    const externalSegs: Array<{ ax: number; az: number; bx: number; bz: number }> = [];
    for (const roomId of arenaRoomIds) {
      const room = spec.rooms.find((r) => r.id === roomId);
      if (!room) continue;
      const rect = room.rect;
      const hw = rect.w / 2;
      const hd = rect.d / 2;
      const walls = [
        { perpAxis: 'x' as const, perpCoord: rect.x - hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
        { perpAxis: 'x' as const, perpCoord: rect.x + hw, wallStart: rect.z - hd, wallEnd: rect.z + hd },
        { perpAxis: 'z' as const, perpCoord: rect.z - hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
        { perpAxis: 'z' as const, perpCoord: rect.z + hd, wallStart: rect.x - hw, wallEnd: rect.x + hw },
      ];
      for (const w of walls) {
        // allRects (rooms + corridors) — see the auto-install loop above
        // for why corridors must be included; the seal logic has the same
        // requirement (room→corridor openings are the common entrance).
        const openings = findOpenings(w, allRects, room);
        for (const op of openings) {
          externalSegs.push(
            w.perpAxis === 'x'
              ? { ax: w.perpCoord, az: op.start, bx: w.perpCoord, bz: op.end }
              : { ax: op.start, az: w.perpCoord, bx: op.end, bz: w.perpCoord },
          );
        }
      }
    }
    if (externalSegs.length === 0) return;
    const sealedSegs: Array<{ ax: number; az: number; bx: number; bz: number }> = [];
    doorTeardowns.push(onEncounterActivated(encId, () => {
      for (const seg of externalSegs) {
        walkable.addWall(seg);
        sealedSegs.push(seg);
      }
    }));
    doorTeardowns.push(onEncounterComplete(encId, () => {
      while (sealedSegs.length) walkable.removeWall(sealedSegs.pop()!);
    }));
  }
  // Door-based arena complexes — sealed room + alcove (gate-perimeter match).
  for (const arenaGate of pendingFittings) {
    if (arenaGate.unlock?.kind !== 'arena') continue;
    // Perimeter-fitted rooms already have a gate at EVERY opening — the
    // invisible-wall layer would double-seal and leave residual walls on
    // complete (same reason the offering loop below skips them).
    const sealRoom = spec.rooms.find((r) => r.id === arenaGate.unlock!.roomIds[0]);
    if (sealRoom?.perimeterFitting) continue;
    const arenaRoomIds = new Set(arenaGate.unlock.roomIds);
    const gateSeg = openingEndpoints(arenaGate);
    for (const room of spec.rooms) {
      if (arenaRoomIds.has(room.id)) continue;
      if (segOnRectPerimeter(gateSeg, room.rect)) arenaRoomIds.add(room.id);
    }
    wireSealForArena(arenaEncounterId(arenaGate.unlock.roomIds[0]), arenaRoomIds);
  }
  // Offering-based arenas — the altar's room is the entire complex. SKIP
  // rooms whose perimeter is already handled by visible fittings (the
  // perimeter-fitting auto-install pass dropped a portcullis at every
  // opening; each one seals on the encounter activate reactor, so an
  // invisible-wall layer on top would double-seal and leave a residual
  // wall when the encounter completes — distinct seg references defeat
  // walkable.removeWall's identity match).
  for (const roomId of offeringRooms) {
    const room = spec.rooms.find((r) => r.id === roomId);
    if (room?.perimeterFitting) continue;
    wireSealForArena(arenaEncounterId(roomId), new Set([roomId]));
  }

  // Plain room-clear gates ('cleared') become the degenerate encounter:
  // active from the start, resolves the frame the room is empty. Folds the
  // old aliveByRoom gate check into the same lifecycle as everything else —
  // a room with no mobs completes on its first tick (so the gate isn't stuck).
  const seenClearRooms = new Set<string>();
  for (const d of spec.doors ?? []) {
    if (d.unlock?.kind !== 'cleared') continue;
    for (const roomId of d.unlock.roomIds) {
      if (seenClearRooms.has(roomId)) continue;
      seenClearRooms.add(roomId);
      let handle: EncounterHandle;
      handle = registerEncounter(roomClearEncounterId(roomId), {
        tick: () => {
          let alive = 0;
          for (const en of enemies) {
            // Neutral vermin (maggots) never hold the gate — only player-threats.
            if (roomByEntity.get(en.entityId) === roomId && en.alive && threatensPlayer(en.faction)) alive++;
          }
          if (alive === 0) handle.complete();
        },
      });
      activateEncounter(roomClearEncounterId(roomId));
    }
  }

  // --- Stairs --------------------------------------------------------
  // A boss floor's descent is SEALED until the boss falls. Auto-gate it with
  // the boss's signature colour (eye/emissive, else a rim, else a default) so
  // the ward reads as the boss's own power holding the way shut.
  const bossSpawn = spec.spawns.find((s) => ENEMIES[s.enemyId]?.isBoss);
  const bossWard = bossSpawn ? bossWardColor(ENEMIES[bossSpawn.enemyId]) : null;
  // Hand the cinematics layer this floor's boss presentation (room to flood
  // with the boss colour on engage; cleared on a non-boss floor so it can't
  // bleed across floors).
  setBossPresentation(bossSpawn
    ? { roomId: findRoomContaining(bossSpawn.x, bossSpawn.z, spec.rooms), color: bossWard ?? 0x88cc33 }
    : null);
  for (const st of spec.stairs ?? []) {
    const gated = bossWard != null && !st.unlock
      ? { ...st, unlock: { kind: 'boss-defeated' as const, color: bossWard } }
      : st;
    spawnStairs(root, gated, materials, (target) => onDescend?.(target));
  }

  // Per-frame check (tucked into a separate driver below) wires room-clear
  // detection: walk enemies, recompute aliveByRoom, emit room:cleared when
  // a count flips from >0 to 0.
  //
  // Done lazily so we don't have to plumb a tick callback. main.ts ticks
  // enemies anyway; we hook into that via a Proxy isn't worth it. Instead,
  // expose tickRoomClearTracker — called from main.ts after enemy updates.

  // We attach tickRoomClearTracker to the LiveLevel for now via the
  // teardown closure (alternative would be a separate property; keep
  // interface lean — main.ts can read it off level.checkRoomClear).
  function checkRoomClear() {
    for (const [roomId, count] of aliveByRoom) {
      let stillAlive = 0;
      for (const enemy of enemies) {
        // Match the seal-count basis: only player-threats keep a room "uncleared".
        if (roomByEntity.get(enemy.entityId) === roomId && enemy.alive && threatensPlayer(enemy.faction)) stillAlive++;
      }
      if (stillAlive === 0 && count > 0) {
        aliveByRoom.set(roomId, 0);
        emit({ type: 'room:cleared', roomId });
      }
    }
  }

  let torndown = false;
  function teardown() {
    if (torndown) return;
    torndown = true;
    // Detach event-bus listeners owned by the level (door listeners).
    for (const td of doorTeardowns) td();
    // Drop room-mood bindings — a stale mood from this floor mustn't tint
    // a torch on the next that happens to reuse the room id.
    clearRoomMoodBindings();
    // Release ECS entities for anything the player left behind on this floor
    // so they don't leak into the world map across descents (killed mobs +
    // smashed vases already clean up on death). Idempotent.
    for (const d of destructibles) disposeDestructible(d);
    for (const e of enemies) disposeEnemy(e);
    // Wipe the interactables list — pickups + doors + stairs + chests all
    // get reset. The pickup light pool persists; it's scene-wide.
    clearInteractables();
    // Yank the root from the scene. Geometry/material disposal walks the
    // subtree so GPU memory isn't held.
    scene.remove(root);
    // DEFER the GPU disposal — a queued frame may still reference these
    // buffers (the descent-teardown dispose burst was the root cause of the
    // intermittent "setIndexBuffer: not a GPUBuffer" → black-world storm).
    // The scene removal above is immediate (the world vanishes now); the
    // buffers die at the next frame where the GPU queue is provably empty.
    const doomed: THREE.BufferGeometry[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        // Only dispose geometries unique to this level. POOLED geometries
        // (see scene/geometry-pool.ts) are shared across levels — disposing
        // them would yank vertex buffers out from under meshes in the
        // NEXT level. Shared materials (the StyleMaterials set) follow
        // the same rule and are skipped by virtue of never being walked
        // here (materials aren't disposed in this loop).
        if (!isPooledGeometry(mesh.geometry)) doomed.push(mesh.geometry);
      }
    });
    deferGpuDispose(() => { for (const g of doomed) g.dispose(); });
  }

  // Async bloodstains — real deaths recorded at this depth, placed as
  // loot-free fallen-delver corpses at valid spots in this floor. Runs last,
  // after all deterministic (buildRng) passes, with its own isolated RNG so
  // network data can never desync the build. Best-effort: no-op when offline.
  spawnNetworkBloodstains(root, walkable, spec);

  emit({ type: 'level:loaded', levelId: spec.id });

  return {
    spec,
    walkable,
    nav,
    navPhasing,
    torches,
    enemies,
    destructibles,
    playerSpawn: spec.startPos,
    root,
    teardown,
    // Stash on the object via casting; main.ts pulls this out via a typed
    // wrapper if needed. For now expose directly.
    ...({ checkRoomClear } as object),
  } as LiveLevel & { checkRoomClear: () => void };
}

/** Which room rect contains (x, z)? Prefers logical-only sub-rooms over
 *  their parent vault rect — they're the finer-grained attribution
 *  emitted by multi-room vault parsing. Null if outside all. */
/** Room ceiling height at (x,z) — for sizing a fitting's lintel fill. A
 *  fitting sits on a wall edge; a small margin lets a boundary point still
 *  resolve to its room. Falls back to the first room's height. */
function roomHeightAt(rooms: RoomSpec[], x: number, z: number): number {
  for (const r of rooms) {
    const hw = r.rect.w / 2, hd = r.rect.d / 2;
    if (x >= r.rect.x - hw - 0.05 && x <= r.rect.x + hw + 0.05 &&
        z >= r.rect.z - hd - 0.05 && z <= r.rect.z + hd + 0.05) {
      return r.height;
    }
  }
  return rooms[0]?.height ?? 3.2;
}

function findRoomContaining(x: number, z: number, rooms: RoomSpec[]): string | null {
  const containsHere = (r: RoomSpec): boolean => {
    const hw = r.rect.w / 2;
    const hd = r.rect.d / 2;
    return x >= r.rect.x - hw && x <= r.rect.x + hw && z >= r.rect.z - hd && z <= r.rect.z + hd;
  };
  // Sub-rooms first (more specific).
  for (const r of rooms) {
    if (!r.logicalOnly) continue;
    if (containsHere(r)) return r.id;
  }
  // Fall back to main rooms.
  for (const r of rooms) {
    if (r.logicalOnly) continue;
    if (containsHere(r)) return r.id;
  }
  return null;
}

/** Smallest non-logical room containing (x, z), or null. Used to give
 *  every torch/light a stable owner room so room-mood overrides apply
 *  to the right set of bound items. */
function smallestNonLogicalContaining(rooms: RoomSpec[], x: number, z: number): string | null {
  let best: RoomSpec | null = null;
  for (const r of rooms) {
    if (r.logicalOnly) continue;
    const hw = r.rect.w / 2, hd = r.rect.d / 2;
    if (x < r.rect.x - hw || x > r.rect.x + hw) continue;
    if (z < r.rect.z - hd || z > r.rect.z + hd) continue;
    if (!best || r.rect.w * r.rect.d < best.rect.w * best.rect.d) best = r;
  }
  return best?.id ?? null;
}

/** True if a wall segment lies on a rect's perimeter (both endpoints sit on
 *  the same edge). Used by the arena-seal logic to identify which rooms a
 *  gate splits between (sealed side + alcove). */
function segOnRectPerimeter(
  seg: { ax: number; az: number; bx: number; bz: number },
  rect: { x: number; z: number; w: number; d: number },
): boolean {
  const EPS = 0.05;
  const east  = rect.x + rect.w / 2;
  const west  = rect.x - rect.w / 2;
  const north = rect.z - rect.d / 2;
  const south = rect.z + rect.d / 2;
  for (const wallX of [east, west]) {
    if (Math.abs(seg.ax - wallX) < EPS && Math.abs(seg.bx - wallX) < EPS) {
      const zmin = Math.min(seg.az, seg.bz);
      const zmax = Math.max(seg.az, seg.bz);
      if (zmin >= north - EPS && zmax <= south + EPS) return true;
    }
  }
  for (const wallZ of [north, south]) {
    if (Math.abs(seg.az - wallZ) < EPS && Math.abs(seg.bz - wallZ) < EPS) {
      const xmin = Math.min(seg.ax, seg.bx);
      const xmax = Math.max(seg.ax, seg.bx);
      if (xmin >= west - EPS && xmax <= east + EPS) return true;
    }
  }
  return false;
}
