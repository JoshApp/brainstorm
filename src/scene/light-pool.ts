import * as THREE from 'three';

// Light slot pool — partitioned by category so each kind of light
// plays by its own rules.
//
// Categories:
//
//   lamp        — the player's handheld lantern. Always 1 slot. Wins
//                 over everything; never pops.
//   environment — torches, candles, fountains, floor glows, stairs
//                 beacons, fill lights. The "room is lit by" stuff.
//                 8 slots — comfortable budget for a dense procgen
//                 floor's nearby lights.
//   pickup      — loot highlights. Their own slots so a wave of drops
//                 can't crowd torches out, and torches can't crowd
//                 pickups out. 4 slots covers worst-case wraith drop
//                 + chest open + one straggler.
//
// Per category we sort registered sources by distance to camera and
// bind the nearest N to that category's slots. Sources beyond their
// own range are culled. Hysteresis (2.2m² bonus) prevents flicker
// when two sources contend for the boundary slot.
//
// Three.js sees a constant 13 PointLights in the scene — no shader
// recompiles regardless of how many logical sources exist.

export type LightCategory = 'lamp' | 'environment' | 'pickup';

const CATEGORY_SLOTS: Record<LightCategory, number> = {
  lamp: 1,
  environment: 8,
  pickup: 4,
};

// Park position for unused slots — far below the floor.
const PARK_Y = -1000;

// Hysteresis bonus (m²) — bound-last-frame sources get this advantage
// in current frame's ranking. Same value across categories; tuneable
// per-category if a class of lights ever wants stickier or looser.
const HYSTERESIS_SQ = 2.2 * 2.2;

export interface LightSource {
  id: string;
  /** Which category-pool this source competes in. */
  category: LightCategory;
  /** Position vector. The pool reads this reference each frame. */
  position: THREE.Vector3;
  /** Base color. Use getColor() for animated tints. */
  color: number;
  /** Base intensity. Use getIntensity() for flicker. */
  intensity: number;
  /** Light falloff range. */
  distance: number;
  decay: number;
  /** Optional: dynamic intensity (e.g. torch flicker). */
  getIntensity?: () => number;
  /** Optional: dynamic color (e.g. lamp flame). */
  getColor?: (out: THREE.Color) => void;
  /** Survives clearLightPool — used by the camera-attached lantern. */
  persistent?: boolean;
}

const sources = new Map<string, LightSource>();
const slotsByCategory: Record<LightCategory, THREE.PointLight[]> = {
  lamp: [],
  environment: [],
  pickup: [],
};
const boundLastFrameByCategory: Record<LightCategory, Set<string>> = {
  lamp: new Set(),
  environment: new Set(),
  pickup: new Set(),
};
let scene: THREE.Scene | null = null;

// Reusable scratch list per category to avoid per-frame allocation.
const scratchByCategory: Record<LightCategory, Array<{ src: LightSource; sortKey: number }>> = {
  lamp: [],
  environment: [],
  pickup: [],
};

/** One-time setup. Adds N PointLights per category to the scene. */
export function initLightPool(sc: THREE.Scene): void {
  if (slotsByCategory.environment.length > 0) return;
  scene = sc;
  const categories = Object.keys(CATEGORY_SLOTS) as LightCategory[];
  for (const cat of categories) {
    for (let i = 0; i < CATEGORY_SLOTS[cat]; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 5, 1.4);
      light.position.set(0, PARK_Y, 0);
      sc.add(light);
      slotsByCategory[cat].push(light);
    }
  }
}

export function registerLight(src: LightSource): void {
  sources.set(src.id, src);
}

export function unregisterLight(id: string): void {
  sources.delete(id);
  // Drop it from every category's bound set so its slot frees up
  // immediately rather than waiting for the next tick.
  for (const cat of Object.keys(boundLastFrameByCategory) as LightCategory[]) {
    boundLastFrameByCategory[cat].delete(id);
  }
}

/** Clear all NON-persistent sources. Called at the start of buildLevel. */
export function clearLightPool(): void {
  for (const [id, src] of sources) {
    if (!src.persistent) sources.delete(id);
  }
  // Also reset the bound sets for non-persistent ids.
  for (const cat of Object.keys(boundLastFrameByCategory) as LightCategory[]) {
    for (const id of boundLastFrameByCategory[cat]) {
      const src = sources.get(id);
      if (!src || !src.persistent) boundLastFrameByCategory[cat].delete(id);
    }
  }
}

const tmpColor = new THREE.Color();

/** Per-frame: bind the N nearest sources within each category to that
 *  category's slots. */
export function tickLightPool(camera: THREE.Camera): void {
  if (slotsByCategory.environment.length === 0) return;

  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;

  // Reset scratch buckets.
  scratchByCategory.lamp.length = 0;
  scratchByCategory.environment.length = 0;
  scratchByCategory.pickup.length = 0;

  // Bucket sources by category + compute sort keys (dist² with
  // hysteresis bonus for previously-bound sources).
  for (const src of sources.values()) {
    const dx = src.position.x - cx;
    const dy = src.position.y - cy;
    const dz = src.position.z - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    // RAW dist² for the cull check — sources truly out of range can't
    // sneak in via hysteresis.
    const reach = src.distance + 2;
    if (dist2 > reach * reach) continue;
    let sortKey = dist2;
    if (boundLastFrameByCategory[src.category].has(src.id)) sortKey -= HYSTERESIS_SQ;
    scratchByCategory[src.category].push({ src, sortKey });
  }

  // Sort + bind each category's slots independently.
  const cats: LightCategory[] = ['lamp', 'environment', 'pickup'];
  for (const cat of cats) {
    const scratch = scratchByCategory[cat];
    const slots = slotsByCategory[cat];
    const bound = boundLastFrameByCategory[cat];
    scratch.sort(bySortKey);
    bound.clear();
    const n = Math.min(scratch.length, slots.length);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (i < n) {
        const { src } = scratch[i];
        slot.position.copy(src.position);
        slot.intensity = src.getIntensity ? src.getIntensity() : src.intensity;
        slot.distance = src.distance;
        slot.decay = src.decay;
        if (src.getColor) {
          src.getColor(tmpColor);
          slot.color.copy(tmpColor);
        } else {
          slot.color.setHex(src.color);
        }
        bound.add(src.id);
      } else {
        slot.intensity = 0;
        slot.position.set(0, PARK_Y, 0);
      }
    }
  }
}

function bySortKey(a: { sortKey: number }, b: { sortKey: number }): number {
  return a.sortKey - b.sortKey;
}

/** Debug introspection — counts per category. */
export function getActiveSourceCount(): number {
  let n = 0;
  for (const cat of Object.keys(slotsByCategory) as LightCategory[]) {
    for (const slot of slotsByCategory[cat]) if (slot.intensity > 0) n++;
  }
  return n;
}

export function getRegisteredSourceCount(): number {
  return sources.size;
}
