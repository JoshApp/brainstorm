import * as THREE from 'three';
import type { LiveLevel } from './builder';
import { on as onEvent } from '../broadcast/event-bus';

// Portal/room visibility culling. Three.js frustum-culls (the view cone) but
// never OCCLUSION-culls — a wall doesn't stop the frustum, so a room hidden
// behind a wall you're facing still gets submitted as draw calls. This module
// fixes that for the room-based dungeon: it renders only the room you're in
// plus rooms reachable through doorways that are actually in view, and hides
// the rest (sets their static geometry `.visible = false`).
//
// Fully self-contained: it reads the FINISHED level (root children + torches +
// rect list) and never touches the builder. It groups each rect's toggleable
// static content (walls/floor/ceiling by their dbgSource room tag; torches by
// position) and flips visibility per frame from a frustum-gated flood-fill over
// the doorway graph.
//
// Conservative by design: it errs toward rendering (generous doorway margin,
// 2-hop sightlines over-render slightly rather than pop in). The MARGIN is the
// knob to tune on-device — bigger = rooms reveal earlier = less pop-in, more
// draws. Pillars (level-merged) + instanced decor can't be per-room toggled, so
// they stay always-visible; this culls shells + torches, which is the bulk.

interface RectNode {
  id: string;
  cx: number; cz: number; hw: number; hd: number;   // centre + half-extents
  objects: THREE.Object3D[];                          // toggleable static content
  neighbors: Array<{ id: string; ox: number; oz: number }>;  // opening midpoints
}

// Doorway-reveal margin (metres): a neighbour room renders when its connecting
// doorway is within this distance of the view frustum. Generous = less pop-in.
const MARGIN = 1.5;
const DOOR_Y = 1.2;   // sample height for the doorway-in-frustum test
const EPS = 0.05;

export interface RoomCuller {
  /** Recompute visibility for this frame. */
  tick(camera: THREE.Camera): void;
  /** Turn culling off → restore everything visible (does not free the culler). */
  setEnabled(on: boolean): void;
  /** Restore all visibility (called on level teardown / disable). */
  dispose(): void;
  /** Count of currently-visible rects (debug readout). */
  visibleCount(): number;
  /** Force a set of rooms to always render this frame onward — used by ARENAS
   *  while their encounter is active so a portcullis (which blocks LOS for
   *  walkable but is visually see-through bars) doesn't make the arena pop
   *  out from inside the alcove. Cleared by clearForceVisible(). */
  addForceVisible(roomIds: readonly string[]): void;
  /** Drop a previously-forced set. */
  removeForceVisible(roomIds: readonly string[]): void;
}

export function createRoomCuller(level: LiveLevel): RoomCuller {
  const nodes = new Map<string, RectNode>();
  // Occlusion comes from the walkable grid's line-of-sight (the same check the
  // light pool uses): a doorway with a wall between it and the camera fails LOS
  // and its room is culled. This is what frustum-alone can't see.
  const los = (ax: number, az: number, bx: number, bz: number) =>
    level.walkable.hasLineOfSight(ax, az, bx, bz);

  // 1) Rect nodes from rooms + corridors. SKIP logicalOnly sub-rooms — they
  //    have no baked walls/floor/ceiling and exist only as bounding rects for
  //    enemy attribution. If we kept them, rectAt() (which prefers the smallest
  //    containing rect) would return the LOGICAL sub-room as the player's start
  //    node — but that node has no geometry, and the parent vault rect that DOES
  //    own the geometry is not its rect-edge neighbour (parent contains sub-
  //    room rather than sharing an edge), so the parent culls out. Symptom:
  //    floor + walls disappear when you look at certain angles while standing
  //    in an arena's alcove/proper. Excluding logical rooms makes rectAt fall
  //    through to the parent automatically.
  const rects = [
    ...level.spec.rooms.filter((r) => !r.logicalOnly).map((r) => ({ id: r.id, rect: r.rect })),
    ...level.spec.corridors.map((c) => ({ id: c.id, rect: c.rect })),
  ];
  for (const { id, rect } of rects) {
    nodes.set(id, {
      id, cx: rect.x, cz: rect.z, hw: rect.w / 2, hd: rect.d / 2,
      objects: [], neighbors: [],
    });
  }

  // Logical sub-room id → containing parent rect id. Encounters reference
  // sub-room ids (e.g. arena:<subRoomId>); the culler's force-visible set
  // operates on real rect ids, so we translate at the event boundary.
  const subroomToParent = new Map<string, string>();
  for (const sub of level.spec.rooms) {
    if (!sub.logicalOnly) continue;
    let bestParent: { id: string; area: number } | null = null;
    for (const candidate of level.spec.rooms) {
      if (candidate.logicalOnly) continue;
      const cw2 = candidate.rect.w / 2, cd2 = candidate.rect.d / 2;
      const sw2 = sub.rect.w / 2, sd2 = sub.rect.d / 2;
      const containsX = candidate.rect.x - cw2 <= sub.rect.x - sw2 + 1e-3
                     && candidate.rect.x + cw2 >= sub.rect.x + sw2 - 1e-3;
      const containsZ = candidate.rect.z - cd2 <= sub.rect.z - sd2 + 1e-3
                     && candidate.rect.z + cd2 >= sub.rect.z + sd2 - 1e-3;
      if (!containsX || !containsZ) continue;
      const area = candidate.rect.w * candidate.rect.d;
      if (!bestParent || area < bestParent.area) bestParent = { id: candidate.id, area };
    }
    if (bestParent) subroomToParent.set(sub.id, bestParent.id);
  }

  // 2) Adjacency: two rects are connected if a wall edge coincides and overlaps
  //    along the run axis — the doorway. Opening midpoint = centre of the
  //    overlap on the shared edge. O(n²), n small.
  const arr = [...nodes.values()];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const opening = sharedOpening(a, b);
      if (opening) {
        a.neighbors.push({ id: b.id, ox: opening.x, oz: opening.z });
        b.neighbors.push({ id: a.id, ox: opening.x, oz: opening.z });
      }
    }
  }

  // 3) Assign toggleable static objects to rects.
  //    Shells (floor/ceiling/walls) carry userData.dbgSource = "<kind> · <id> …".
  for (const child of level.root.children) {
    const src = child.userData?.dbgSource;
    if (typeof src === 'string') {
      const id = parseRectId(src);
      const node = id ? nodes.get(id) : undefined;
      if (node) {
        node.objects.push(child);
        continue;
      }
    }
    // Decoration PROPS tagged with userData.dbgKind = 'prop' (clutter, chests,
    // braziers, ritual altars, everything authored through the prop pipeline)
    // don't carry a per-rect dbgSource — they're assigned by world position
    // to the smallest non-logical containing rect. Without this they stayed
    // visible inside a culled room (the player would see floor decoration
    // through a wall the culler had hidden).
    if (child.userData?.dbgKind === 'prop') {
      const node = rectAt(nodes, child.position.x, child.position.z);
      if (node) node.objects.push(child);
    }
  }
  //    Torches by position (their group is a direct root child not tagged above).
  for (const torch of level.torches) {
    const node = rectAt(nodes, torch.group.position.x, torch.group.position.z);
    if (node) node.objects.push(torch.group);
  }

  let enabled = true;
  const visible = new Set<string>();
  // Rooms forced to render every frame regardless of frustum / LOS — counted
  // by reference, so two encounters can claim the same room without one
  // dropping the other's claim when it ends.
  const forceVisibleCounts = new Map<string, number>();

  // Frustum scratch (no per-frame alloc).
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), MARGIN);

  function showAll() {
    for (const node of nodes.values()) {
      for (const o of node.objects) o.visible = true;
    }
    for (const e of level.enemies) e.group.visible = true;
  }

  function tick(camera: THREE.Camera) {
    if (!enabled) return;

    camera.updateMatrixWorld();
    projView.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(projView);

    const cx = camera.position.x;
    const cz = camera.position.z;
    const start = rectAt(nodes, cx, cz) ?? nearestRect(nodes, cx, cz);

    visible.clear();
    // Force-visible rooms (active arenas etc.) always render — PLUS every
    // direct neighbour, so the alcove on the other side of an arena gate is
    // also rendered while the arena is active even though the gate's wall
    // segment blocks LOS. (The portcullis is visually bars; you should see
    // through it. Walking through it is what's sealed.)
    for (const id of forceVisibleCounts.keys()) {
      const node = nodes.get(id);
      if (!node) continue;
      visible.add(id);
      for (const nb of node.neighbors) visible.add(nb.id);
    }
    if (start) {
      // Flood-fill: from the current rect, cross any doorway that's in view;
      // from each newly-visible rect, cross ITS in-view doorways (handles
      // looking through two doorways). The current rect is always visible.
      visible.add(start.id);
      const queue = [start.id];
      while (queue.length) {
        const node = nodes.get(queue.pop()!)!;
        for (const nb of node.neighbors) {
          if (visible.has(nb.id)) continue;
          // In the view cone (frustum, with reveal margin) AND not occluded by
          // a wall (line-of-sight from the camera to the doorway).
          sphere.center.set(nb.ox, DOOR_Y, nb.oz);
          if (frustum.intersectsSphere(sphere) && los(cx, cz, nb.ox, nb.oz)) {
            visible.add(nb.id);
            queue.push(nb.id);
          }
        }
      }
    } else {
      // Player not resolvable to any rect — fail safe (render everything).
      showAll();
      return;
    }

    for (const node of nodes.values()) {
      const vis = visible.has(node.id);
      for (const o of node.objects) {
        if (o.visible !== vis) o.visible = vis;
      }
    }

    // Enemies are occlusion-culled DYNAMICALLY. Unlike shells (assigned once),
    // a mob walks between rooms, so we resolve its room from its live position
    // every frame and hide it when that room isn't rendered. This is the big
    // one: frustum culling alone can't occlusion-cull, so a wall between you and
    // a packed room still draws every enemy behind it — full geometry AND a
    // shadow-cube redraw each — for nothing (you see only the wall). The mob's
    // AI keeps ticking; only its rendering is culled. An enemy that doesn't
    // resolve to a rect (straddling a doorway) stays visible, erring to render.
    for (const e of level.enemies) {
      const node = rectAt(nodes, e.group.position.x, e.group.position.z);
      const vis = !node || visible.has(node.id);
      if (e.group.visible !== vis) e.group.visible = vis;
    }
  }

  const culler: RoomCuller = {
    tick,
    setEnabled(on: boolean) {
      if (on === enabled) return;
      enabled = on;
      if (!on) showAll();
    },
    dispose() {
      showAll();
      unsubEvents();
    },
    visibleCount() { return visible.size; },
    addForceVisible(roomIds: readonly string[]) {
      for (const id of roomIds) {
        forceVisibleCounts.set(id, (forceVisibleCounts.get(id) ?? 0) + 1);
      }
    },
    removeForceVisible(roomIds: readonly string[]) {
      for (const id of roomIds) {
        const n = (forceVisibleCounts.get(id) ?? 0) - 1;
        if (n <= 0) forceVisibleCounts.delete(id);
        else forceVisibleCounts.set(id, n);
      }
    },
  };

  // Auto-track arena encounters via the bus: 'arena:<roomId>' encounter
  // activates → force-visible that roomId; completes → drop. This means
  // ANY arena (combat, challenge, future variants) automatically keeps its
  // room visible through the gate's see-through bars while the encounter
  // runs, without the builder having to plumb a reference to the culler.
  const ARENA_PREFIX = 'arena:';
  function arenaRectId(eventId: string): string {
    const subId = eventId.slice(ARENA_PREFIX.length);
    return subroomToParent.get(subId) ?? subId;
  }
  const unsubEvents = onEvent((event) => {
    if (event.type === 'encounter:activated' && event.id.startsWith(ARENA_PREFIX)) {
      culler.addForceVisible([arenaRectId(event.id)]);
    } else if (event.type === 'encounter:complete' && event.id.startsWith(ARENA_PREFIX)) {
      culler.removeForceVisible([arenaRectId(event.id)]);
    }
  });

  return culler;
}

/** Centre-of-overlap doorway between two edge-adjacent rects, or null. */
function sharedOpening(a: RectNode, b: RectNode): { x: number; z: number } | null {
  // Vertical shared edge (a's E == b's W, or vice versa) → overlap in Z.
  const ax0 = a.cx - a.hw, ax1 = a.cx + a.hw, az0 = a.cz - a.hd, az1 = a.cz + a.hd;
  const bx0 = b.cx - b.hw, bx1 = b.cx + b.hw, bz0 = b.cz - b.hd, bz1 = b.cz + b.hd;

  // East of A meets West of B (or symmetric): shared x line.
  if (Math.abs(ax1 - bx0) < EPS || Math.abs(bx1 - ax0) < EPS) {
    const z0 = Math.max(az0, bz0), z1 = Math.min(az1, bz1);
    if (z1 - z0 > EPS) {
      const x = Math.abs(ax1 - bx0) < EPS ? ax1 : ax0;
      return { x, z: (z0 + z1) / 2 };
    }
  }
  // North/South: shared z line, overlap in X.
  if (Math.abs(az1 - bz0) < EPS || Math.abs(bz1 - az0) < EPS) {
    const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1);
    if (x1 - x0 > EPS) {
      const z = Math.abs(az1 - bz0) < EPS ? az1 : az0;
      return { x: (x0 + x1) / 2, z };
    }
  }
  return null;
}

/** Rect whose AABB contains (x, z), or null. Prefers the smallest (so a
 *  corridor nested against a room boundary wins over the room). */
function rectAt(nodes: Map<string, RectNode>, x: number, z: number): RectNode | null {
  let best: RectNode | null = null;
  for (const n of nodes.values()) {
    if (x >= n.cx - n.hw - EPS && x <= n.cx + n.hw + EPS &&
        z >= n.cz - n.hd - EPS && z <= n.cz + n.hd + EPS) {
      if (!best || n.hw * n.hd < best.hw * best.hd) best = n;
    }
  }
  return best;
}

function nearestRect(nodes: Map<string, RectNode>, x: number, z: number): RectNode | null {
  let best: RectNode | null = null;
  let bestD = Infinity;
  for (const n of nodes.values()) {
    const dx = n.cx - x, dz = n.cz - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Pull the rect id out of a dbgSource like "walls · r0" / "floor · r0 @(…)". */
function parseRectId(src: string): string | null {
  const dot = src.indexOf('·');
  if (dot < 0) return null;
  const rest = src.slice(dot + 1).trim();
  const sp = rest.search(/\s/);
  return (sp < 0 ? rest : rest.slice(0, sp)) || null;
}
