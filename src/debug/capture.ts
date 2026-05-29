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

export interface DebugContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
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
      distance: round(hit.distance),
      point: { x: round(p.x), y: round(p.y), z: round(p.z) },
      room: room?.id ?? null,
      vault: room ? (level?.spec.roomVaults?.[room.id] ?? null) : null,
    };
  }

  return { kind: 'nothing', label: '(void)', distance: Infinity, point: null, room: null, vault: null };
}

function identifyObject(
  obj: THREE.Object3D,
  level: LiveLevel | null,
): { kind: LookAtInfo['kind']; label: string } {
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
  // Static geometry — report the most descriptive name we can find by
  // walking up to a named ancestor, else the geometry type.
  let named: THREE.Object3D | null = obj;
  while (named && !named.name) named = named.parent;
  const geo = (obj as THREE.Mesh).geometry?.type ?? 'Object3D';
  return { kind: 'geometry', label: named?.name ? named.name : geo };
}

/** Build the full structured snapshot. */
export async function captureDebugSnapshot(ctx: DebugContext) {
  const level = ctx.getLevel();
  if (!level) throw new Error('[debug] no live level');

  const observation = buildObservation(ctx.camera, level);
  const lookAt = resolveLookAt(ctx);
  const run = getRunState();
  const roomVault = observation.roomId
    ? (level.spec.roomVaults?.[observation.roomId] ?? null)
    : null;

  // captureScreenshot wants a HarnessContext; the debug context carries
  // the same render-relevant fields, so cast through the shared shape.
  const screenshot = await captureScreenshot(ctx as unknown as HarnessContext, { annotated: true });

  return {
    when: new Date().toISOString(),
    seed: run?.startedAt ?? null,
    vault: roomVault,
    lookAt,
    observation,
    consoleLogs: getRecentLogs(),
    screenshot,
  };
}

export type DebugSnapshot = Awaited<ReturnType<typeof captureDebugSnapshot>>;

/** Compact, paste-ready text report for chat. */
export function formatSnapshotText(snap: DebugSnapshot): string {
  const o = snap.observation;
  const L = snap.lookAt;
  const lines: string[] = [];

  lines.push('=== DELVE DEBUG CAPTURE ===');
  lines.push(`floor: ${o.floorId} (depth ${o.depth})  seed: ${snap.seed ?? '?'}`);
  lines.push(`room: ${o.roomId ?? '?'}${snap.vault ? `  vault: ${snap.vault}` : ''}`);
  lines.push(`player: (${o.player.pos.x}, ${o.player.pos.z}) yaw ${deg(o.player.facingYaw)}  HP ${o.player.hp.current}/${o.player.hp.max}  light ${o.light.atPlayer.toFixed(1)}`);

  // Looking at — the headline for "this thing is glitched"
  lines.push('');
  if (L.kind === 'nothing') {
    lines.push('looking at: nothing (void / skybox)');
  } else {
    const loc = L.point ? ` @ (${L.point.x},${L.point.z})` : '';
    const prov = L.vault ? `  [vault ${L.vault}]` : '';
    lines.push(`looking at: ${L.kind} — ${L.label}  ${L.distance.toFixed(1)}m${loc}${prov}`);
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
  lines.push(`(screenshot ${snap.screenshot.size.w}x${snap.screenshot.size.h} captured)`);
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
