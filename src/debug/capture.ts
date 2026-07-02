// Debug capture tool — one tap during normal play grabs a rich snapshot
// of "where am I + what's around + what am I looking at + what just went
// wrong", formats it as a compact text report, and copies it to the
// clipboard so Josh can paste it straight into chat from his phone.
//
// Reuses the harness observation + annotated-screenshot builders so the
// payload matches what the AI pilot already understands. Adds three
// things the harness observation doesn't carry:
//   - vault provenance (which template generated this room)
//   - a forward "look-at" raycast (the object under the crosshair)
//   - the recent console-error ring buffer
//
// Gated behind ?debug=1; dynamic-imported so player builds pay nothing.

import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import { buildObservation } from '../harness/observation';
import { captureScreenshot } from '../harness/annotate';
import type { HarnessContext } from '../harness/state';
import { getAllInteractables } from '../interactables/system';
import { getRecentLogs } from './console-buffer';
import { getRunState } from '../state/run-state';
import { listLightSourcesNear, getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';
import { actForDepth } from '../level/acts';
import { captureAllOverlays } from './debug-screenshots';
import type { DelveRenderer } from '../scene/create-renderer';

export interface DebugContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: DelveRenderer;
  canvas: HTMLCanvasElement;
  getLevel: () => LiveLevel | null;
}

const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);

export interface LookAtInfo {
  /** Best-effort identity of whatever is under the crosshair. */
  kind: 'enemy' | 'interactable' | 'destructible' | 'geometry' | 'nothing';
  /** Human label: enemy kind, interactable kind, or mesh/geometry name. */
  label: string;
  /** Which pipeline phase produced this (prop provenance), if known. */
  source?: string;
  /** Metres from camera to the hit point. */
  distance: number;
  /** World hit point. */
  point: { x: number; y: number; z: number } | null;
  /** Room + vault the hit point falls in (if resolvable). */
  room: string | null;
  vault: string | null;
}

/** Raycast straight ahead from the camera centre and identify the first
 *  thing hit that isn't the player's own viewmodel (sword / lamp are
 *  camera children and would otherwise always win). */
export function resolveLookAt(ctx: DebugContext): LookAtInfo {
  const { camera, scene } = ctx;
  const level = ctx.getLevel();
  raycaster.setFromCamera(CENTER, camera);
  const hits = raycaster.intersectObjects(scene.children, true);

  for (const hit of hits) {
    // Skip the player's own held viewmodel (anything parented under the
    // camera — sword, lamp, offhand).
    if (isDescendantOf(hit.object, camera)) continue;

    const identity = identifyObject(hit.object, level);
    const p = hit.point;
    const room = level ? roomAt(p.x, p.z, level) : null;
    return {
      kind: identity.kind,
      label: identity.label,
      source: identity.source,
      distance: round(hit.distance),
      point: { x: round(p.x), y: round(p.y), z: round(p.z) },
      room: room?.id ?? null,
      vault: room ? (level?.spec.roomVaults?.[room.id] ?? null) : null,
    };
  }

  return { kind: 'nothing', label: '(void)', distance: Infinity, point: null, room: null, vault: null };
}

/** Raycast a fan of rays across the forward view cone and return the
 *  distinct objects hit (deduped by identity label + rounded distance),
 *  nearest first. Answers "everything I'm looking at", not just dead
 *  centre. ~25 rays in a grid covering roughly the central 50° of view. */
export function resolveLookCone(ctx: DebugContext, maxItems = 12): LookAtInfo[] {
  const { camera, scene } = ctx;
  const level = ctx.getLevel();
  const seen = new Map<string, LookAtInfo>();

  // 5×5 grid of NDC offsets within ±0.45 (≈ central cone, not the full
  // frustum edges where fisheye distortion dominates).
  const SPREAD = 0.45;
  const N = 5;
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const nx = (ix / (N - 1) - 0.5) * 2 * SPREAD;
      const ny = (iy / (N - 1) - 0.5) * 2 * SPREAD;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        if (isDescendantOf(hit.object, camera)) continue;
        const id = identifyObject(hit.object, level);
        const key = `${id.kind}:${id.label}`;
        const prior = seen.get(key);
        if (!prior || hit.distance < prior.distance) {
          const room = level ? roomAt(hit.point.x, hit.point.z, level) : null;
          seen.set(key, {
            kind: id.kind, label: id.label, source: id.source,
            distance: round(hit.distance),
            point: { x: round(hit.point.x), y: round(hit.point.y), z: round(hit.point.z) },
            room: room?.id ?? null,
            vault: room ? (level?.spec.roomVaults?.[room.id] ?? null) : null,
          });
        }
        break; // first non-viewmodel hit per ray
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.distance - b.distance).slice(0, maxItems);
}

function identifyObject(
  obj: THREE.Object3D,
  level: LiveLevel | null,
): { kind: LookAtInfo['kind']; label: string; source?: string } {
  if (level) {
    // Enemy? compare ancestry against each enemy's group.
    for (const e of level.enemies) {
      if (e.group && isDescendantOf(obj, e.group)) {
        return { kind: 'enemy', label: `${e.kind} (${e.aiState}, hp ${e.hp}/${e.maxHp})` };
      }
    }
    // Destructible (vase)?
    for (const d of level.destructibles ?? []) {
      const g = (d as { group?: THREE.Object3D }).group;
      if (g && isDescendantOf(obj, g)) {
        return { kind: 'destructible', label: 'vase' };
      }
    }
  }
  // Interactable? compare against each built group.
  for (const it of getAllInteractables()) {
    const g = it.built?.group;
    if (g && isDescendantOf(obj, g)) {
      return { kind: 'interactable', label: `${kindFromId(it.id)} (${it.promptLabel || 'inert'})` };
    }
  }
  // Decoration prop? builder.ts stamps userData.dbgSource on prop groups.
  // Walk up to the nearest ancestor carrying it.
  const src = findUserData(obj, 'dbgSource');
  if (src) {
    const dbgKind = findUserData(obj, 'dbgKind');
    const geo = (obj as THREE.Mesh).geometry?.type ?? '';
    // Walls/floor/ceiling stamp dbgKind too — label them by what they are,
    // not as "prop", so a stray structural face self-identifies.
    const prefix = dbgKind && dbgKind !== 'prop' ? '' : 'prop ';
    return { kind: 'geometry', label: `${prefix}[${src}]${geo ? ` ${geo}` : ''}`, source: String(src) };
  }
  // Static geometry — report the most descriptive name we can find by
  // walking up to a named ancestor, else the geometry type.
  let named: THREE.Object3D | null = obj;
  while (named && !named.name) named = named.parent;
  const geo = (obj as THREE.Mesh).geometry?.type ?? 'Object3D';
  return { kind: 'geometry', label: named?.name ? named.name : geo };
}

/** Walk up the parent chain returning the first ancestor's userData
 *  value for `key`, or undefined. */
function findUserData(obj: THREE.Object3D, key: string): unknown {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p.userData && p.userData[key] !== undefined) return p.userData[key];
    p = p.parent;
  }
  return undefined;
}

/** Build the full structured snapshot. */
export async function captureDebugSnapshot(ctx: DebugContext) {
  const level = ctx.getLevel();
  if (!level) throw new Error('[debug] no live level');

  const cam = ctx.camera;
  const observation = buildObservation(cam, level);
  const lookAt = resolveLookAt(ctx);
  const cone = resolveLookCone(ctx);
  const run = getRunState();
  const roomVault = observation.roomId
    ? (level.spec.roomVaults?.[observation.roomId] ?? null)
    : null;

  // Nearby light sources (for lighting glitches + the light=signal rule).
  const lights = listLightSourcesNear(cam.position.x, cam.position.z, 14);

  // Floor manifest — whole-floor context for reproduction + understanding.
  const act = actForDepth(observation.depth);
  const vaultList = level.spec.roomVaults
    ? [...new Set(Object.values(level.spec.roomVaults))].sort()
    : [];
  const manifest = {
    seed: run?.startedAt ?? null,
    depth: observation.depth,
    act: `${act.number}: ${act.name}`,
    floorId: level.spec.id,
    vaults: vaultList,
    fogColor: level.spec.fogColor ?? null,
    counts: {
      rooms: level.spec.rooms.length,
      corridors: level.spec.corridors.length,
      props: level.spec.props.length,
      torches: level.spec.torches.length,
      enemiesAlive: level.enemies.filter((e) => e.alive).length,
      interactables: getAllInteractables().length,
      lightSourcesRegistered: getRegisteredSourceCount(),
      lightSlotsActive: getActiveSourceCount(),
    },
  };

  // Perf + nav. renderer.info is cheap + already tracked by Three.js.
  const info = ctx.renderer.info;
  const walkableHere = level.walkable.contains(cam.position.x, cam.position.z, 0.3);
  const perf = {
    fps: await sampleFps(),
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    /** False = player centre is NOT in a walkable cell (clipped into
     *  geometry / out of bounds) — a strong glitch signal. */
    walkableAtPlayer: walkableHere,
  };

  // captureScreenshot wants a HarnessContext; the debug context carries
  // the same render-relevant fields, so cast through the shared shape.
  const screenshot = await captureScreenshot(ctx as unknown as HarnessContext, { annotated: true });
  // Three extra diagnostic layers sharing one base frame.
  const overlays = await captureAllOverlays(ctx, cone);

  // SCENE CENSUS — every mesh whose world-space bounds sit within 6m of
  // the player, with its parent chain. Bounds-based (world-baked merged
  // meshes sit at transform origin with geometry elsewhere). This is
  // what names a mystery object in a screenshot: an unnamed mesh's
  // PARENT CHAIN identifies the system that spawned it.
  const census: Array<{ name: string; type: string; center: number[]; r: number; chain: string }> = [];
  {
    const cx = cam.position.x, cz = cam.position.z;
    const tmpV = new THREE.Vector3();
    ctx.scene.updateMatrixWorld(true);
    ctx.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || !m.visible) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere!;
      const c = tmpV.copy(bs.center).applyMatrix4(m.matrixWorld);
      const scale = m.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
      const wr = bs.radius * scale;
      if (wr > 8) return;   // room-scale merges aren't "objects"
      if (Math.hypot(c.x - cx, c.z - cz) - Math.min(wr, 3) > 6) return;
      const chain: string[] = [];
      let n: THREE.Object3D | null = m;
      while (n && chain.length < 6) { chain.push(n.name || n.type); n = n.parent; }
      if (chain.includes('PerspectiveCamera')) return;   // viewmodel
      census.push({
        name: m.name || '(unnamed)', type: m.type,
        center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
        r: +wr.toFixed(2),
        chain: chain.join(' < '),
      });
    });
    census.sort((a, b) =>
      Math.hypot(a.center[0] - cx, a.center[2] - cz) - Math.hypot(b.center[0] - cx, b.center[2] - cz));
  }

  return {
    when: new Date().toISOString(),
    id: makeId(observation.depth),
    seed: run?.startedAt ?? null,
    vault: roomVault,
    lookAt,
    cone,
    lights,
    manifest,
    perf,
    observation,
    census: census.slice(0, 80),
    consoleLogs: getRecentLogs(),
    screenshot,
    overlays,
  };
}

/** Rough FPS from two rAF deltas. Adds ~16-33ms to a capture — fine for
 *  a manual debug action. */
function sampleFps(): Promise<number> {
  return new Promise((resolve) => {
    let t0 = 0;
    requestAnimationFrame((a) => {
      t0 = a;
      requestAnimationFrame((b) => {
        const dt = b - t0;
        resolve(dt > 0 ? Math.round(1000 / dt) : 0);
      });
    });
  });
}

export type DebugSnapshot = Awaited<ReturnType<typeof captureDebugSnapshot>>;

/** Short, paste-friendly capture id: floor + 4 random base36 chars. The
 *  dev-server plugin writes the bundle to debug-captures/<id>/, so the id
 *  is how Claude finds the report + screenshots on disk. */
export function makeId(depth: number): string {
  const rnd = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `d${depth}-${rnd}`;
}

/** The four PNG layers written alongside report.txt in debug-captures/<id>/. */
const CAPTURE_LAYERS = ['annotated', 'geometry', 'light', 'cone'];

/** Compact, paste-ready text report for chat. */
export function formatSnapshotText(snap: DebugSnapshot): string {
  const o = snap.observation;
  const L = snap.lookAt;
  const lines: string[] = [];

  lines.push('=== DELVE DEBUG CAPTURE ===');
  lines.push(`id: ${snap.id}  ·  files: debug-captures/${snap.id}/ (report.txt + ${CAPTURE_LAYERS.map(l => l + '.png').join(', ')})`);
  lines.push(`floor: ${o.floorId} (depth ${o.depth})  seed: ${snap.seed ?? '?'}`);
  lines.push(`room: ${o.roomId ?? '?'}${snap.vault ? `  vault: ${snap.vault}` : ''}`);
  lines.push(`player: (${o.player.pos.x}, ${o.player.pos.z}) yaw ${deg(o.player.facingYaw)}  HP ${o.player.hp.current}/${o.player.hp.max}  light ${o.light.atPlayer.toFixed(1)}`);

  // Perf + nav one-liner (clip warning is a strong glitch signal)
  const pf = snap.perf;
  const clip = pf.walkableAtPlayer ? '' : '  ⚠ NOT-WALKABLE (clipped?)';
  lines.push(`perf: ${pf.fps}fps  ${pf.drawCalls} draws  ${(pf.triangles / 1000).toFixed(0)}k tris  lights ${snap.manifest.counts.lightSlotsActive}/${snap.manifest.counts.lightSourcesRegistered}${clip}`);

  // Looking at — the headline for "this thing is glitched"
  lines.push('');
  if (L.kind === 'nothing') {
    lines.push('looking at: nothing (void / skybox)');
  } else {
    const loc = L.point ? ` @ (${L.point.x},${L.point.z})` : '';
    const prov = L.vault ? `  [vault ${L.vault}]` : '';
    lines.push(`looking at: ${L.kind} — ${L.label}  ${L.distance.toFixed(1)}m${loc}${prov}`);
  }

  // Cone — everything in the forward view (provenance-tagged)
  if (snap.cone.length > 1) {
    lines.push('in view cone:');
    for (const c of snap.cone) {
      const prov = c.source ? ` {${c.source}}` : '';
      lines.push(`  ${c.kind} — ${c.label}  ${c.distance.toFixed(1)}m${prov}`);
    }
  }

  // Walls
  const w = o.geometry.walls8;
  lines.push('');
  lines.push(`walls(m): N ${fmt(w.N)} NE ${fmt(w.NE)} E ${fmt(w.E)} SE ${fmt(w.SE)} S ${fmt(w.S)} SW ${fmt(w.SW)} W ${fmt(w.W)} NW ${fmt(w.NW)}`);

  // Enemies
  if (o.visible.enemies.length) {
    lines.push('');
    lines.push(`enemies (${o.visible.enemies.length}):`);
    for (const e of o.visible.enemies.slice(0, 8)) {
      lines.push(`  ${e.kind} ${e.distance.toFixed(1)}m ${e.compass} ${e.state} hp ${e.hp.current}/${e.hp.max} ${e.inSight ? 'LOS' : 'no-LOS'}`);
    }
  }

  // Interactables
  if (o.visible.interactables.length) {
    lines.push('');
    lines.push(`interactables (${o.visible.interactables.length}):`);
    for (const it of o.visible.interactables.slice(0, 8)) {
      lines.push(`  ${it.kind} ${it.distance.toFixed(1)}m ${it.compass} ${it.state}${it.inRange ? ' [in-range]' : ''}`);
    }
  }

  // Nearby light sources — for lighting glitches + the light=signal rule
  if (snap.lights.length) {
    lines.push('');
    lines.push(`lights near (${snap.lights.length}):`);
    for (const lt of snap.lights.slice(0, 10)) {
      lines.push(`  ${lt.category} #${lt.id.slice(-8)} ${lt.range.toFixed(1)}m  i=${lt.intensity}  #${lt.color.toString(16).padStart(6, '0')}`);
    }
  }

  // Floor manifest — whole-floor context for reproduction
  const m = snap.manifest;
  lines.push('');
  lines.push(`floor manifest: act ${m.act}  seed ${m.seed ?? '?'}`);
  lines.push(`  vaults: ${m.vaults.length ? m.vaults.join(', ') : '(hand-authored)'}`);
  lines.push(`  counts: ${m.counts.rooms} rooms, ${m.counts.corridors} corridors, ${m.counts.props} props, ${m.counts.torches} torches, ${m.counts.enemiesAlive} enemies, ${m.counts.interactables} interactables`);

  // Console errors — the "what broke" section
  const logs = snap.consoleLogs;
  if (logs.length) {
    lines.push('');
    lines.push(`console (last ${logs.length}):`);
    // de-dupe consecutive identical messages with a count
    let prev = '';
    let count = 0;
    const flush = () => {
      if (count > 0) lines.push(`  [${count}x] ${prev}`);
    };
    for (const l of logs) {
      const msg = `${l.level}: ${l.text}`.slice(0, 160);
      if (msg === prev) { count++; continue; }
      flush();
      prev = msg; count = 1;
    }
    flush();
  }

  lines.push('');
  lines.push(`screenshots: ${snap.screenshot.size.w}x${snap.screenshot.size.h} → debug-captures/${snap.id}/ {${CAPTURE_LAYERS.join(', ')}}.png`);
  lines.push(`(to read: "read debug capture ${snap.id}")`);
  return lines.join('\n');
}

// ── helpers ──────────────────────────────────────────────────────────

function isDescendantOf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function roomAt(x: number, z: number, level: LiveLevel) {
  const rooms = level.spec.rooms;
  const here = (r: typeof rooms[number]) => {
    const hw = r.rect.w / 2, hd = r.rect.d / 2;
    return x >= r.rect.x - hw && x <= r.rect.x + hw && z >= r.rect.z - hd && z <= r.rect.z + hd;
  };
  for (const r of rooms) if (r.logicalOnly && here(r)) return r;
  for (const r of rooms) if (!r.logicalOnly && here(r)) return r;
  return null;
}

function kindFromId(id: string): string {
  const i = id.indexOf('-');
  return i > 0 ? id.slice(0, i) : id;
}

function fmt(n: number): string { return Number.isFinite(n) ? n.toFixed(1) : '∞'; }
function deg(rad: number): string { return `${Math.round((rad * 180) / Math.PI)}°`; }
function round(n: number, d = 1): number {
  if (!Number.isFinite(n)) return n;
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
