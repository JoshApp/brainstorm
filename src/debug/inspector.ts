// ── THE ROOM INSPECTOR — a way to actually SEE what the generator built ──────
//
// DEV-only. Stripped from production by the import.meta.env.DEV gate in
// dev-hooks.ts, which is the only thing that imports this module.
//
// WHY THIS EXISTS. On 2026-08-05 the polygon shell shipped with three defects
// that were live on a phone within the hour: geometry with no vertex-colour
// attribute (black holes), a ceiling mirrored in Z (the back of the room open to
// the void), and walls built as slabs that only overlap at right angles. Each
// was found by a human walking the room and reporting "it looks wrong", because
// the ONLY instrument available was a first-person screenshot of a game that is
// deliberately almost entirely black.
//
// That is a tooling gap, not three mistakes. A dark first-person camera cannot
// answer "is this geometry correct" — it can only answer "does this room look
// good", and conflating those two questions is how all three shipped. So this
// module separates them:
//
//   - LIT       — the studio rig from inspect-mode, on a real level. Shows FORM.
//   - PARTS     — every mesh recoloured by WHICH PASS BUILT IT. Shows STRUCTURE,
//                 and answers "why is that there" in one glance instead of a
//                 grep through four producers.
//   - SEGS      — the collision segments drawn as lines, over the geometry that
//                 is supposed to match them. A wall you can walk through and a
//                 wall that isn't there look identical from inside; here they
//                 don't.
//   - TOP       — near-orthographic plan view. The view that would have shown
//                 the ring gaps in a single frame.
//
// Nothing here edits the hot loop. When the world is frozen the first-person
// look system is gated off, so a self-contained rAF owns the camera — the same
// trick viewer.ts uses for its orbit.
//
// USE IT HEADLESSLY. Every mode is a URL parameter, and `delve snap` already
// forwards arbitrary params via `--q=`:
//
//   npm run delve snap run-1780376544217-3 -- --plan --parts
//   npm run delve snap starter-choice -- --plan --segs --lit
//   npm run delve snap starter-choice -- --orbit --only=polytrim
//
// Three of the game's own systems have to stand down for these views, and all
// three fail SILENTLY — the frame just renders wrong. `delve snap` turns them
// off for you (see the inspector block in scripts/snap.ts); driving the URL by
// hand, you need them too:
//   batchworld=0   static batching erases per-mesh debug labels
//   portalcull=0   PORTAL CULLING IS ON BY DEFAULT and hides every room the
//                  player isn't standing in
//
// …or from the console: `__insp.top()`, `__insp.parts()`, `__insp.rooms()`.

import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import type { RoomSpec } from '../level/types';
import { setWorldFrozen } from './freeze';
import { interpSync } from '../engine/render-interp';
import { setInspectBypass } from '../style/render-frame';

type Level = LiveLevel & { checkRoomClear?: () => void };

interface Deps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  getLevel: () => Level | null;
}

/** Field of view for the plan view. Small = nearly parallel projection without
 *  swapping the renderer's camera for an orthographic one (which would mean
 *  touching every system that holds a PerspectiveCamera reference). At 12° the
 *  perspective error across a 20m room is a couple of percent — invisible for
 *  reading a plan, and free. */
const PLAN_FOV = 12;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/**
 * Screen-up for the plan view: world NORTH (−Z).
 *
 * Looking straight down with up = +Y is DEGENERATE — the view direction is
 * anti-parallel to the up vector, so lookAt's cross product collapses and Three
 * falls back to an arbitrary basis. The first plan view came out MIRRORED IN Z
 * because of it, and since the mirror was consistent it looked like a plausible
 * room: I read it as "the generator built the wrong polygon" and went hunting in
 * the shell for a bug that was in the camera. An explicit up makes the basis
 * well-defined AND fixes the convention: −Z at the top of frame, matching every
 * top-down diagram in docs/ and scripts/shape-sheet.ts.
 */
const PLAN_UP = new THREE.Vector3(0, 0, -1);

let deps: Deps | null = null;
let pose: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; up: THREE.Vector3 } | null = null;
let raf = 0;
let gameFov = 0;

/** Original materials, so an overlay can be turned back off. */
const savedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
let overlayGroup: THREE.Group | null = null;

// ── camera ownership ─────────────────────────────────────────────────────────

/**
 * Hold the camera at `pose` every frame.
 *
 * A one-shot set does not survive: render-interp re-seeds the camera from the
 * simulation each frame and snaps it back — the same trap that made every
 * subject-only snap capture the spawn pose instead of the framed one. Freezing
 * the world gates off the first-person look system; this rAF then owns the pose
 * outright.
 */
function holdPose(): void {
  if (raf) return;
  const tick = () => {
    if (pose && deps) {
      const cam = deps.camera;
      cam.position.copy(pose.pos);
      cam.up.copy(pose.up);
      cam.lookAt(pose.look);
      if (cam.fov !== pose.fov) { cam.fov = pose.fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
      interpSync([cam]);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function take(pos: THREE.Vector3, look: THREE.Vector3, fov: number, up = WORLD_UP): string {
  if (!deps) return 'inspector not installed';
  if (!gameFov) gameFov = deps.camera.fov;
  setWorldFrozen(true);
  pose = { pos, look, fov, up };
  holdPose();
  return `camera at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) fov ${fov}`;
}

/** Hand the camera back to the game. */
function release(): string {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  pose = null;
  liftRoof(false);
  showAll();
  setInspectBypass(false);
  document.body.classList.remove('hud-hidden');
  if (deps && gameFov) {
    deps.camera.fov = gameFov;
    if (savedFar) { deps.camera.far = savedFar; savedFar = 0; }
    deps.camera.updateProjectionMatrix();
  }
  setWorldFrozen(false);
  return 'camera released';
}

// ── room lookup ──────────────────────────────────────────────────────────────

function rooms(): RoomSpec[] {
  return (deps?.getLevel()?.spec.rooms ?? []).filter((r) => !r.logicalOnly);
}

/** Accepts a room id, an index, or nothing (= the whole floor). */
function resolveRoom(which?: string | number): RoomSpec | null {
  const rs = rooms();
  if (which === undefined) return null;
  if (typeof which === 'number') return rs[which] ?? null;
  return rs.find((r) => r.id === which) ?? null;
}

/** The bounding box of a room, or of every room + corridor when given none. */
function extentOf(which?: string | number): { x: number; z: number; w: number; d: number; y: number } {
  const room = resolveRoom(which);
  if (room) {
    return { ...room.rect, y: room.elevation ?? 0 };
  }
  const lvl = deps?.getLevel();
  const rects = [...(lvl?.spec.rooms ?? []).filter((r) => !r.logicalOnly).map((r) => r.rect),
                 ...(lvl?.spec.corridors ?? []).map((c) => c.rect)];
  if (rects.length === 0) return { x: 0, z: 0, w: 20, d: 20, y: 0 };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x - r.w / 2); x1 = Math.max(x1, r.x + r.w / 2);
    z0 = Math.min(z0, r.z - r.d / 2); z1 = Math.max(z1, r.z + r.d / 2);
  }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: 0 };
}

// ── views ────────────────────────────────────────────────────────────────────

/**
 * Plan view. Looks straight down; +Z (south) ends up at the BOTTOM of frame,
 * matching how every top-down diagram in docs/ and scripts/shape-sheet.ts is
 * drawn, so a screenshot and an SVG of the same room are comparable.
 *
 * Three things have to be true before a downward camera shows you anything, and
 * the first attempt at this got a black frame because none of them were:
 * the CEILING is in the way, the FOG ends long before 40m up, and the HUD is
 * still drawing a floor-item card over the middle of the room.
 */
function top(which?: string | number, pad = 1.15): string {
  const e = extentOf(which);
  const span = Math.max(e.w, e.d) * pad;
  const dist = span / (2 * Math.tan((PLAN_FOV * Math.PI) / 360));
  liftRoof(true);
  clearSight(dist * 3);
  const cam = new THREE.Vector3(e.x, e.y + dist, e.z);
  return take(cam, new THREE.Vector3(e.x, e.y, e.z), PLAN_FOV, PLAN_UP);
}

/** Hide (or restore) every ceiling plate, so a plan view sees the room instead
 *  of its lid. Keyed on the `dbgKind` stamp the builder already sets. */
const hiddenRoof: THREE.Object3D[] = [];
function liftRoof(off: boolean): void {
  if (!off) {
    for (const o of hiddenRoof) o.visible = true;
    hiddenRoof.length = 0;
    return;
  }
  if (!deps) return;
  // Scene-wide, for the same reason `parts` is: the batching passes re-parent
  // shell geometry out of the level root. A root-only walk left every ceiling
  // in place on a real floor, and since a ceiling's underside is near-black the
  // plan came back as a set of empty outlines — which reads as "the rooms have
  // no floors" instead of "you are looking at their lids".
  deps.scene.traverse((o) => {
    const k = o.userData?.dbgKind;
    if ((k === 'ceiling' || /ceil/i.test(o.name)) && o.visible) { o.visible = false; hiddenRoof.push(o); }
  });
}

/**
 * Let the camera see further than a torch.
 *
 * Two separate 9-and-10-metre walls stand between a plan camera and the room:
 * the fog is fully opaque by CONFIG.FOG_FAR (9m), and CONFIG.CAMERA_FAR is
 * **10m** — deliberately clipped to just past the fog, because past it
 * everything is opaque black anyway and the tight frustum is free performance.
 * Excellent for the game. Fatal for a camera 38m up, which is why the first
 * plan view rendered a perfectly black frame with the HUD on top of it.
 */
function clearSight(far: number): void {
  // Bypass the PSX post stack. It is a deliberate crunchifier — quantize,
  // dither, amber tint, vignette, dark-adaptation — and it makes an inspection
  // view lie: a #c882f8 debug colour came back as near-black indigo, so the
  // plan read as a flat purple slab and I spent a pass measuring pixels through
  // a filter designed to destroy exactly the information I was measuring.
  setInspectBypass(true);
  const fog = deps?.scene.fog as THREE.Fog | null;
  if (fog) { fog.near = far; fog.far = far * 2; }
  if (deps) {
    const cam = deps.camera;
    if (!savedFar) savedFar = cam.far;
    cam.far = Math.max(cam.far, far * 1.5);
    cam.updateProjectionMatrix();
  }
  document.body.classList.add('hud-hidden');
}
let savedFar = 0;

/** Three-quarter view — the one that reads FORM (height, thickness, overhang)
 *  which a plan view flattens away entirely. */
function orbit(which?: string | number, azDeg = 35, elDeg = 38, pad = 1.5): string {
  const e = extentOf(which);
  const span = Math.max(e.w, e.d) * pad;
  const dist = span / (2 * Math.tan((50 * Math.PI) / 360));
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const target = new THREE.Vector3(e.x, e.y + 1.2, e.z);
  const cam = target.clone().add(new THREE.Vector3(
    Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist));
  liftRoof(true);              // a three-quarter view is still looking under a lid
  clearSight(dist * 3);
  return take(cam, target, 50);
}

/** Eye height, standing where a player would. */
function at(x: number, z: number, yaw = 0, y = 1.6): string {
  const look = new THREE.Vector3(x - Math.sin(yaw) * 4, y, z - Math.cos(yaw) * 4);
  return take(new THREE.Vector3(x, y, z), look, gameFov || 70);
}

// ── PARTS: colour by producer ────────────────────────────────────────────────

/**
 * Recolour every mesh in the level by WHICH PASS BUILT IT.
 *
 * The builder already stamps `userData.dbgSource` (e.g. `polywalls · antechamber`,
 * `floor · r0 @(3.0,-4.0)`) on everything it makes — it was only ever read by
 * the draw-call report. Hashing that string to a hue turns "which system put
 * this here" into a colour you can see, which is the question every placement
 * bug starts with.
 *
 * Deliberately unlit (MeshBasic): the point is structure, and torchlight would
 * hide half of it. Meshes with no stamp go grey, which is itself informative —
 * an unlabelled mesh is a pass that never expected to be debugged.
 */
function parts(on = true, only?: string): Record<string, string> | string {
  const lvl = deps?.getLevel();
  if (!lvl) return 'no level';
  if (!on) { restoreMaterials(); showAll(); return 'parts off'; }
  const legend: Record<string, string> = {};
  // Traverse the whole SCENE, not just the level root. Static batching and
  // static-merge re-parent shell geometry into BatchedMeshes that live outside
  // the root, and a root-only walk came back with a legend containing every
  // prop and NO FLOORS OR WALLS — a plan view of a real floor with black
  // interiors, which reads as "the rooms have no floor" rather than "your
  // traversal missed them".
  deps!.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!savedMaterials.has(m)) savedMaterials.set(m, m.material);
    const key = String(m.userData.dbgSource || m.userData.dbgKind || m.name || 'unnamed');
    // ISOLATION. Two meshes stacked in a plan view are indistinguishable — a
    // prop sitting on a floor plate hides the plate, and you end up measuring
    // pixels of the wrong surface and concluding the generator is broken. `only`
    // hides everything whose label doesn't match, so a claim about ONE pass can
    // be checked against that pass alone.
    if (only && !key.includes(only)) { if (m.visible) { m.visible = false; hiddenByFilter.push(m); } return; }
    const col = colorFor(key);
    legend[key] = '#' + col.getHexString();
    m.material = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
  });
  return legend;
}

/**
 * Stable string → colour, from a FIXED palette of well-separated hues.
 *
 * The first version hashed to a continuous hue and the first real legend came
 * back with `polyfloor`, `polywalls` and `static-batch-world` on #dfec8b,
 * #ecec8b and #c4ec8b — three shades of the same yellow-green, which rendered
 * the whole room as one olive blob and defeated the entire point of the mode.
 * A continuous hue space has no minimum separation; a palette does. 24 entries
 * around the wheel, alternating light and dark so even a collision in hue lands
 * at a different value.
 */
const PALETTE: readonly [number, number, number][] = Array.from({ length: 24 }, (_, i) => [
  (i * 360) / 24 / 360,
  i % 3 === 0 ? 0.85 : 0.62,
  i % 2 === 0 ? 0.58 : 0.36,
] as [number, number, number]);

function colorFor(key: string): THREE.Color {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  // Shuffle the index across the palette rather than taking consecutive slots —
  // two strings differing in one character otherwise land side by side.
  const [hue, sat, lum] = PALETTE[((h >>> 0) * 7 + (h >>> 16)) % PALETTE.length];
  return new THREE.Color().setHSL(hue, sat, lum);
}

const hiddenByFilter: THREE.Object3D[] = [];
function showAll(): void {
  for (const o of hiddenByFilter) o.visible = true;
  hiddenByFilter.length = 0;
}

function restoreMaterials(): void {
  for (const [mesh, mat] of savedMaterials) {
    if (Array.isArray(mesh.material)) (mesh.material as THREE.Material[]).forEach((mm) => mm.dispose());
    else (mesh.material as THREE.Material).dispose();
    mesh.material = mat;
  }
  savedMaterials.clear();
}

// ── SEGS: the collision the player actually feels ────────────────────────────

/**
 * Draw the walkable region's wall segments as lines, floating just above the
 * floor.
 *
 * From inside a dark room, a wall that isn't there and a wall you can walk
 * through look exactly the same. This is the only view that tells them apart:
 * geometry with no line under it is decoration the player will walk through; a
 * line with no geometry over it is an invisible wall.
 */
function segs(on = true): string {
  clearOverlay();
  if (!on) return 'segs off';
  const lvl = deps?.getLevel();
  if (!lvl || !deps) return 'no level';
  const walls = lvl.walkable.listWalls();
  const pts: number[] = [];
  for (const w of walls) {
    pts.push(w.ax, 0.06, w.az, w.bx, 0.06, w.bz);
    // A tick at each end, so two segments meeting at a corner are visibly two.
    pts.push(w.ax, 0.06, w.az, w.ax, 0.9, w.az);
  }
  overlayGroup = new THREE.Group();
  overlayGroup.name = 'inspector-overlay';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  overlayGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x33ff88 })));
  deps.scene.add(overlayGroup);
  return `${walls.length} wall segments`;
}

function clearOverlay(): void {
  if (!overlayGroup) return;
  overlayGroup.parent?.remove(overlayGroup);
  overlayGroup.traverse((o) => {
    const l = o as THREE.LineSegments;
    if (l.geometry) l.geometry.dispose();
  });
  overlayGroup = null;
}

// ── install ──────────────────────────────────────────────────────────────────

export interface InspectorDeps extends Deps {
  /** Applies the studio lighting rig to the whole level (inspect-mode with
   *  subjectOnly false). Passed in rather than imported so this module doesn't
   *  need the renderer/ambient handles main.ts owns. */
  enterLit: () => void;
}

export function installInspector(d: InspectorDeps): void {
  deps = d;
  const w = window as unknown as Record<string, unknown>;
  const api = {
    rooms: () => rooms().map((r, i) => ({
      i, id: r.id, ...r.rect, height: r.height, poly: r.poly ? r.poly.length : 0,
    })),
    top, orbit, at, parts, segs, release,
    /** Show ONLY the meshes whose debug label contains `sub`. */
    only: (sub: string) => { restoreMaterials(); showAll(); return parts(true, sub); },
    lit: () => { d.enterLit(); return 'studio lighting on'; },
    /** Everything at once for a room: lit, plan view, segments over it. */
    plan: (which?: string | number) => { d.enterLit(); segs(true); return top(which); },
  };
  w.__insp = api;

  // ── URL-driven, so `delve snap … --q=insp=top&inspParts=1` works headlessly.
  // The level loads async and a scenario can rebuild it, so poll rather than
  // read once — a self-rescheduling rAF that quits on its first tick is exactly
  // how the boot-timing harness recorded zero samples.
  const q = new URLSearchParams(window.location.search);
  const view = q.get('insp');
  const wantParts = q.get('inspParts') === '1';
  const onlySub = q.get('inspOnly') ?? undefined;
  const wantSegs = q.get('inspSegs') === '1';
  const wantLit = q.get('inspLit') === '1';
  if (!view && !wantParts && !wantSegs && !wantLit && !onlySub) return;
  const room = q.get('inspRoom') ?? undefined;
  const which = room === undefined ? undefined : (/^\d+$/.test(room) ? Number(room) : room);

  let applied = false;
  const poll = setInterval(() => {
    if (applied || !d.getLevel()) return;
    applied = true;
    clearInterval(poll);
    if (wantLit) d.enterLit();
    // Log what we're looking at. `delve snap` forwards browser console output to
    // the CLI, so a headless plan shot comes back with its own legend — the
    // image says WHERE something is, this says WHAT it is and who built it.
    console.log('[inspector] rooms', JSON.stringify(api.rooms()));
    if (wantParts || onlySub) {
      console.log('[inspector] parts', JSON.stringify(parts(true, onlySub)));
      // Batching and merging happen AFTER the level resolves, and they mint new
      // meshes. Re-apply a few times so the colouring covers what arrives late.
      let n = 0;
      const again = setInterval(() => { parts(true, onlySub); if (++n > 8) clearInterval(again); }, 250);
    }
    if (wantSegs) console.log('[inspector]', segs(true));
    if (view === 'top') top(which);
    else if (view === 'orbit') orbit(which);
    else if (view === 'at') {
      const e = extentOf(which);
      at(e.x, e.z + Math.max(2, e.d / 2 - 1.5), 0);
    }
    // Tell the snap CLI the view is posed — it already waits on a window flag
    // for inspect framing, and a fixed delay would race the async level load.
    (window as unknown as { __inspectFramed?: boolean }).__inspectFramed = true;
  }, 100);
}
