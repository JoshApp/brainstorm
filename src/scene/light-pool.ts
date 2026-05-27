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

const SLOT_COUNT = 10;
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
}

const sources = new Map<string, LightSource>();
const slots: THREE.PointLight[] = [];
let scene: THREE.Scene | null = null;

// Reusable scratch list to avoid per-frame allocation. We append + sort
// this in place each frame. Index 0..n-1 are valid after collect.
const scratch: Array<{ src: LightSource; dist2: number }> = [];

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
    // Skip sources whose light range can't reach the camera area
    // (distance + a small margin so neighboring fragments are still
    // lit). Saves shading time when the player is far from a torch.
    const reach = src.distance + 2;
    if (dist2 > reach * reach) continue;
    scratch.push({ src, dist2 });
  }
  scratch.sort(byDist2);

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
    } else {
      // Unused slot — park it. Keep intensity 0 so it contributes zero
      // to every fragment without us having to remove it from the scene.
      slot.intensity = 0;
      slot.position.set(0, PARK_Y, 0);
    }
  }
}

function byDist2(a: { dist2: number }, b: { dist2: number }): number {
  return a.dist2 - b.dist2;
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
