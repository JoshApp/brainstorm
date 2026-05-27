import * as THREE from 'three';

// Light slot pool — the hyper-optimization that lets us have HUNDREDS of
// logical light sources in a level without paying Three.js's per-light
// fragment-shader cost.
//
// The problem: Three.js evaluates every PointLight in EVERY fragment
// shader pass. With ~30 PointLights in a procgen floor, mobile GPU
// drops frames. With 50+, the framerate tanks.
//
// The fix: keep a FIXED POOL of N THREE.PointLight instances in the
// scene (Three.js sees a constant light count, no shader recompiles).
// Every torch / candle / fountain / glow / lantern registers as a
// LOGICAL "source" via registerLight(); each frame, the pool sorts
// sources by distance to the camera and binds the N nearest to its
// actual lights. Distant sources go dark (which is what they'd do
// anyway behind the fog wall).
//
// Result: a level can have any number of registered sources, but the
// shader only ever sees N at a time. Frame time is bounded.
//
// Slot count of 10 was chosen as a comfort spot on mobile — enough that
// a player rarely sees a visible "torch dropped out" pop, low enough
// that GPU has plenty of headroom.

// 12 active slots. 10 was tight enough that two adjacent torches +
// the lamp + a pickup easily competed for the boundary slot; bumping
// to 12 gives the hysteresis fix more headroom on richer rooms without
// significantly raising GPU cost (one extra light evaluation per
// fragment is ~10% of a torch's cost, not per-frame fatal).
const SLOT_COUNT = 12;
// Park position for unused slots — far below the floor so any tiny
// residual contribution never reaches a visible fragment.
const PARK_Y = -1000;

export interface LightSource {
  id: string;
  /** Position vector. The pool reads this reference each frame; mutating
   *  the vector (e.g. a moving lamp following the camera) is supported. */
  position: THREE.Vector3;
  /** Base color. Use getColor() for animated tints. */
  color: number;
  /** Base intensity. Use getIntensity() for flicker. */
  intensity: number;
  /** Light falloff range. Sources outside (camera - distance) get culled
   *  early since they can't affect the visible area. */
  distance: number;
  decay: number;
  /** Optional: dynamic intensity (e.g. torch flicker). Called once per
   *  frame for the source's bound slot. */
  getIntensity?: () => number;
  /** Optional: dynamic color (e.g. lamp flame). Called once per frame. */
  getColor?: (out: THREE.Color) => void;
  /**
   * If true, survives clearLightPool() (which runs at level teardown).
   * Used for camera-attached sources like the handheld lamp that must
   * persist across level swaps.
   */
  persistent?: boolean;
  /**
   * Priority bias in metres² subtracted from the source's distance²
   * before ranking. POSITIVE values make a source "feel closer" than
   * its actual distance — used to keep important sources (the lamp,
   * loot pickups) reliably bound to slots even when many torches
   * compete. Default 0.
   */
  priority?: number;
}

// Hysteresis bonus: once a source is bound to a slot, it gets this
// "stickiness" advantage in next frame's ranking. Equivalent of ~2.2m
// of advantage — enough that a marginally-closer competitor can't keep
// stealing the slot back and forth as the camera moves, which would
// cause distant torches to flicker. A clearly-closer source still
// wins (the threshold isn't large enough to permanently lock a far
// source in once a much closer one appears).
const HYSTERESIS_SQ = 2.2 * 2.2;

const sources = new Map<string, LightSource>();
const slots: THREE.PointLight[] = [];
let scene: THREE.Scene | null = null;

// Set of source ids bound to slots LAST frame. Used to apply the
// hysteresis bonus on the current frame's ranking.
const boundLastFrame = new Set<string>();

// Reusable scratch list to avoid per-frame allocation. We append + sort
// this in place each frame. Index 0..n-1 are valid after collect.
const scratch: Array<{ src: LightSource; sortKey: number }> = [];

/** One-time setup. Adds SLOT_COUNT idle THREE.PointLights to the scene. */
export function initLightPool(sc: THREE.Scene): void {
  if (slots.length > 0) return;
  scene = sc;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 5, 1.4);
    light.position.set(0, PARK_Y, 0);
    sc.add(light);
    slots.push(light);
  }
}

/** Register a logical light source. The source's position vector is
 *  read each frame; mutating it (or returning new values from the
 *  optional callbacks) is the way to animate. */
export function registerLight(src: LightSource): void {
  sources.set(src.id, src);
}

/** Remove a source. Called on enemy/pickup/etc. teardown. */
export function unregisterLight(id: string): void {
  sources.delete(id);
}

/** Clear all NON-persistent sources. Called at the start of buildLevel
 *  so per-level lights (torches, fill, glows, pickups) reset cleanly
 *  while persistent sources (the lantern attached to the camera)
 *  carry across the descent. */
export function clearLightPool(): void {
  for (const [id, src] of sources) {
    if (!src.persistent) sources.delete(id);
  }
}

const tmpColor = new THREE.Color();

/** Per-frame: bind the N closest sources to the N slots, dark out the
 *  rest. Cheap: sort over ~50 entries per frame.
 *
 *  Cull radius: any source farther from the camera than its OWN distance
 *  (range) can't reach the camera's vicinity → effectively skipped. */
export function tickLightPool(camera: THREE.Camera): void {
  if (slots.length === 0) return;
  scratch.length = 0;
  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;
  for (const src of sources.values()) {
    const dx = src.position.x - cx;
    const dy = src.position.y - cy;
    const dz = src.position.z - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    // Skip sources whose light range can't reach the camera area.
    // The cull check uses RAW dist2 (no hysteresis) so a source
    // that's truly out of range can't sneak in via stickiness.
    const reach = src.distance + 2;
    if (dist2 > reach * reach) continue;
    // Sort key = dist² minus stickiness bonus minus per-source priority.
    // Sources that WERE bound last frame get a 2.2m² head-start, which
    // prevents two roughly-equidistant lights from popping in and out
    // as the camera nudges the rank order. Per-source priority lets
    // important sources (the lamp, a glowing pickup) shorten their
    // effective distance so they reliably win a slot.
    let sortKey = dist2;
    if (boundLastFrame.has(src.id)) sortKey -= HYSTERESIS_SQ;
    if (src.priority) sortKey -= src.priority;
    scratch.push({ src, sortKey });
  }
  scratch.sort(bySortKey);

  // Repopulate boundLastFrame as we assign slots so the next frame's
  // hysteresis sees the right set.
  boundLastFrame.clear();
  const n = Math.min(scratch.length, SLOT_COUNT);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = slots[i];
    if (i < n) {
      const { src } = scratch[i];
      slot.position.copy(src.position);
      const intensity = src.getIntensity ? src.getIntensity() : src.intensity;
      slot.intensity = intensity;
      slot.distance = src.distance;
      slot.decay = src.decay;
      if (src.getColor) {
        src.getColor(tmpColor);
        slot.color.copy(tmpColor);
      } else {
        slot.color.setHex(src.color);
      }
      boundLastFrame.add(src.id);
    } else {
      // Unused slot — park it. Keep intensity 0 so it contributes zero
      // to every fragment without us having to remove it from the scene.
      slot.intensity = 0;
      slot.position.set(0, PARK_Y, 0);
    }
  }
}

function bySortKey(a: { sortKey: number }, b: { sortKey: number }): number {
  return a.sortKey - b.sortKey;
}

/** Debug introspection — used by tests / scenarios. */
export function getActiveSourceCount(): number {
  let n = 0;
  for (const slot of slots) if (slot.intensity > 0) n++;
  return n;
}

export function getRegisteredSourceCount(): number {
  return sources.size;
}
