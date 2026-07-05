import * as THREE from 'three';
import { BundleGroup } from 'three/webgpu';
import type { LiveLevel } from '../level/builder';
import { getAllInteractables } from '../interactables/system';

// ── STATIC-WORLD RENDER BUNDLES (WebGPU) ─────────────────────────────────────
//
// The phone CPU profile (2026-07-04, USB CDP capture) put ~40% of the busy main
// thread inside Three's PER-OBJECT render frontend: writeBuffer uploads (12%),
// bind-group updates (7%), uniform diffing + renderObject dispatch (~20%) — all
// charged per draw, every frame, for ~200 mostly STATIC objects (walls, floors,
// props). WebGPU has a purpose-built answer: RENDER BUNDLES. Wrap the static
// content of each room rect in a `BundleGroup` and Three records its GPU
// commands once, then replays the recorded bundle each frame (`executeBundles`)
// — the per-object encode/bind/upload machinery drops to a needsRefresh check.
//
// Grouping is PER ROOM RECT, aligned with the room culler: each bundle is
// stamped with the same `userData.dbgSource = '… · <rectId>'` tag the shell
// pieces carry, so the culler assigns the WHOLE BUNDLE to its rect and toggles
// one object where it used to toggle dozens. (Bundling runs BEFORE
// createRoomCuller — the culler reads root children at creation.)
//
// What goes IN a bundle: room/corridor shell pieces (tagged dbgSource) and
// decoration props (tagged dbgKind 'prop') that never move, change, or leave.
// What STAYS OUT (renders normally): enemies, torches (animated flames),
// interactables (chests open, runes reveal, stairs), destructibles (vases are
// REMOVED on smash — a recorded bundle would replay a ghost), doors/fittings
// (animated), and anything spawned after the floor builds (pickups, gibs,
// corpses — they're added to root later, never inside a bundle).
//
// Dynamic uniforms still work inside bundles because they're not per-object:
// lights/flicker, fog, gore splat arrays, dark-adapt all live in shared
// buffers that unbundled draws (mobs, viewmodel) keep updating each frame; the
// recorded bundle references the same GPUBuffers. Verify visually when
// touching this: torch flicker on bundled walls, blood pooling on a bundled
// floor (DEV `__goreAt`), pillar shadows.
//
// EXPERIMENT FLAG: ?bundles=1 enables, default off until phone-profiled.
// Fully static membership means nothing ever needs `bundle.needsUpdate` — if
// you ever bundle something mutable, bump `needsUpdate = true` on change.

/** Default ON; ?bundles=0 is the kill switch.
 *
 *  HISTORY (a cautionary tale in two misdiagnoses): the 2026-07-04 r184
 *  experiment died with a depth/output usage-scope validation storm +
 *  `setIndexBuffer: not a GPUBuffer` and was verdicted "Three's bundle
 *  recording is incompatible with our post chain". The ACTUAL root cause was
 *  OURS — the level teardown's synchronous geometry-dispose burst destroying
 *  buffers referenced by in-flight frames (fixed by deferGpuDispose;
 *  bundles' bigger recorded surface just made the race fire reliably). The
 *  2026-07-05 r185 retest then read "still broken, 1fps" — that was a
 *  BACKGROUND-TAB rAF throttle artifact (chrome throttles occluded tabs to
 *  ~2 rAF/s), not the game. With the dispose fix + r185's render-bundle
 *  fixes, bundles run clean: soaked over kills + chained descents with zero
 *  validation errors, coexisting with the BatchedMesh world (batching takes
 *  the mergeables; each rect's bundle wraps the loose static leftovers —
 *  multi-material, single-material odds — killing their per-frame encode).
 *  Josh's instinct that "we do something wrong with it" was exactly right.
 */
export function renderBundlesEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('bundles') !== '0';
}

/** Smallest non-logical room rect containing (x, z), or null. Mirrors the
 *  room culler's assignment so bundle membership and culling agree. */
function rectIdAt(level: LiveLevel, x: number, z: number): string | null {
  let best: { id: string; area: number } | null = null;
  for (const room of level.spec.rooms) {
    if (room.logicalOnly) continue;
    const { rect } = room;
    if (Math.abs(x - rect.x) > rect.w / 2 || Math.abs(z - rect.z) > rect.d / 2) continue;
    const area = rect.w * rect.d;
    if (!best || area < best.area) best = { id: room.id, area };
  }
  return best?.id ?? null;
}

/** The rect id a shell piece was built for — same parse the culler uses. */
function shellRectId(src: string): string | null {
  const dot = src.indexOf('·');
  if (dot < 0) return null;
  const rest = src.slice(dot + 1).trim();
  const sp = rest.search(/\s/);
  return (sp < 0 ? rest : rest.slice(0, sp)) || null;
}

/** Freeze a static subtree's matrix MATH: compute world matrices once, then
 *  stop the per-frame updateMatrix/compose work (updateMatrixWorld measured
 *  ~6-8% of phone CPU). ANIMATED leaves stay live — prop groups carry flame
 *  SPRITES (scale flicker), ember POINTS, and flickering LIGHTS; Three's
 *  updateMatrixWorld recurses into children unconditionally, so an unfrozen
 *  sprite under a frozen prop still updates against the parent's (constant)
 *  world matrix every frame. */
function freezeMatrices(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const anim = (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Light).isLight;
    if (anim) return;
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
  });
}

/**
 * Optimize the level's static content: matrix-freeze it (always — walls and
 * props never move, and the per-frame updateMatrixWorld walk measured ~6-8%
 * of phone CPU), and with ?bundles=1 additionally regroup it into one
 * BundleGroup per room rect. Call AFTER the floor is fully built and BEFORE
 * createRoomCuller (the culler reads root children at creation).
 */
export function bundleStaticLevelContent(level: LiveLevel): void {
  // Objects that must NOT be touched, by group reference: they animate, get
  // removed, or open — a recorded bundle would replay ghosts, and a frozen
  // matrix would pin them mid-animation.
  const excluded = new Set<THREE.Object3D>();
  for (const i of getAllInteractables()) { const g = i.built?.group; if (g) excluded.add(g); }
  for (const d of level.destructibles) excluded.add(d.group);
  for (const t of level.torches) excluded.add(t.group);
  for (const e of level.enemies) excluded.add(e.group);

  // Classify the root's direct children into per-rect member lists.
  const byRect = new Map<string, THREE.Object3D[]>();
  const staticObjects: THREE.Object3D[] = [];
  for (const child of level.root.children.slice()) {
    if (excluded.has(child)) continue;
    // Props FIRST — they also carry a dbgSource ('surface-clutter · …') whose
    // '·' would mis-parse as a rect id; their rect comes from world position.
    let rectId: string | null = null;
    if (child.userData?.dbgKind === 'prop') rectId = rectIdAt(level, child.position.x, child.position.z);
    else if (typeof child.userData?.dbgSource === 'string') rectId = shellRectId(child.userData.dbgSource);
    if (!rectId) continue;   // unknown residents stay untouched (render normally)
    staticObjects.push(child);
    const list = byRect.get(rectId);
    if (list) list.push(child); else byRect.set(rectId, [child]);
  }

  // Bundle (flag-gated experiment). Re-parent BEFORE freezing — the freeze
  // computes world matrices once and updateMatrixWorld(force) does not
  // recompute through a subtree whose matrixWorldAutoUpdate is already off.
  let bundles = 0;
  if (renderBundlesEnabled()) {
    for (const [rectId, members] of byRect) {
      if (members.length < 2) continue;   // a bundle of one buys nothing
      const bundle = new BundleGroup();
      bundle.static = true;
      // The culler parses the rect id from this tag exactly like a shell
      // piece's, so the whole bundle joins the rect's toggle list.
      bundle.userData.dbgSource = `bundle · ${rectId}`;
      level.root.add(bundle);
      for (const m of members) bundle.add(m);   // both parents sit at identity
      bundle.updateMatrixWorld(true);
      bundle.matrixAutoUpdate = false; bundle.matrixWorldAutoUpdate = false;
      bundles++;
    }
  }

  // Matrix-freeze the static set (both modes — orthogonal to bundling).
  for (const o of staticObjects) freezeMatrices(o);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[render-bundles] ${staticObjects.length} static objects frozen; ${bundles} rect bundles (${renderBundlesEnabled() ? 'ON' : 'off — ?bundles=1'})`);
  }
}
