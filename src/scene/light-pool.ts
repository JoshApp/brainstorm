import * as THREE from 'three';
import type { ShadowMode } from '../settings/settings';

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
//   projectile  — active projectiles in flight (acolyte spit, future
//                 spells/darts). Own slots so a salvo can't crowd
//                 torches out. 4 slots is plenty: the projectile pool
//                 itself only spawns 16 and they're spread in space.
//
// Per category we sort registered sources by distance to camera and
// bind the nearest N to that category's slots. Sources beyond their
// own range are culled. Hysteresis (2.2m² bonus) prevents flicker
// when two sources contend for the boundary slot.
//
// Three.js sees a constant number of PointLights in the scene — no
// shader recompiles regardless of how many logical sources exist.

export type LightCategory = 'lamp' | 'environment' | 'pickup' | 'projectile';

// Budgets per category. LOS-culling means only IN-ROOM sources can
// reach a slot, so it's fine to give environment a generous budget —
// the pool naturally caps to "lights you can see."
const CATEGORY_SLOTS: Record<LightCategory, number> = {
  lamp: 1,
  environment: 10,
  pickup: 4,
  projectile: 4,
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
  projectile: [],
};
const boundLastFrameByCategory: Record<LightCategory, Set<string>> = {
  lamp: new Set(),
  environment: new Set(),
  pickup: new Set(),
  projectile: new Set(),
};
let scene: THREE.Scene | null = null;

// Reusable scratch list per category to avoid per-frame allocation.
const scratchByCategory: Record<LightCategory, Array<{ src: LightSource; sortKey: number }>> = {
  lamp: [],
  environment: [],
  pickup: [],
  projectile: [],
};

// ── Shadows ──────────────────────────────────────────────────────────
// PointLight shadows are the dearest thing in the frame on mobile (each
// caster re-renders the scene as a 6-face cube map), so we cast from a
// SMALL, FIXED set of slots chosen by the SHADOWS quality setting. The
// caster COUNT is constant within a mode, so the number of shadow-casting
// lights Three.js sees never changes per frame — no shader recompiles, the
// same invariant the whole pool is built around. Which physical light fills
// a caster slot does change (the env slots re-sort nearest-first each
// frame), so "the nearest torch casts" without any recompile.
const SHADOW_MAP_SIZE = 512;
let shadowMode: ShadowMode = 'off';

/** Pre-configure a slot's shadow camera + map. Cheap; the shadow map
 *  itself isn't allocated until castShadow flips true on first render. */
function configureSlotShadow(light: THREE.PointLight): void {
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  light.shadow.bias = -0.004;
  light.shadow.camera.near = 0.12;
  // Tight far plane — torch/lamp reach is short, and a tight frustum keeps
  // the depth precision (and cost) reasonable.
  light.shadow.camera.far = 16;
}

/** One-time setup. Adds N PointLights per category to the scene. */
export function initLightPool(sc: THREE.Scene): void {
  if (slotsByCategory.environment.length > 0) return;
  scene = sc;
  const categories = Object.keys(CATEGORY_SLOTS) as LightCategory[];
  for (const cat of categories) {
    for (let i = 0; i < CATEGORY_SLOTS[cat]; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 5, 1.4);
      light.position.set(0, PARK_Y, 0);
      configureSlotShadow(light);
      sc.add(light);
      slotsByCategory[cat].push(light);
    }
  }
  applyShadowMode();
}

/** Set the dynamic-shadow quality. Flips castShadow on the lamp slot and
 *  the first K environment slots per the mode; counts are fixed per mode.
 *  Changing mode is the only time the caster count changes, so the single
 *  shader recompile it costs lands on a settings toggle, never mid-frame. */
export function setShadowMode(mode: ShadowMode): void {
  shadowMode = mode;
  applyShadowMode();
}

function applyShadowMode(): void {
  // hero = lamp only; single = nearest world light only; all = lamp + nearest few.
  const lampCasts = shadowMode === 'hero' || shadowMode === 'all';
  const envCasters = shadowMode === 'single' ? 1 : shadowMode === 'all' ? 4 : 0;
  for (const light of slotsByCategory.lamp) light.castShadow = lampCasts;
  const env = slotsByCategory.environment;
  for (let i = 0; i < env.length; i++) env[i].castShadow = i < envCasters;
  // pickup / projectile lights never cast — they're transient sparkle.
}

export function registerLight(src: LightSource): void {
  sources.set(src.id, src);
}

/** Iterate registered sources in a given category. Used by the
 *  dark-adaptation "lit" estimate to count non-torch room lights
 *  (bonfire, candles, god rays, floor glows) toward the signal —
 *  without this the system over-adapts in bonfire-lit foyers. */
export function forEachLight(
  category: LightCategory,
  fn: (src: LightSource) => void,
): void {
  for (const src of sources.values()) {
    if (src.category === category) fn(src);
  }
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
// Frustum-cull scratch. Three.js doesn't auto-cull PointLights so a
// light to the player's back still pays per-fragment shader cost on
// every lit material. Build the frustum once per tick and reject any
// source whose sphere (centre + reach radius) misses it.
const tmpFrustum = new THREE.Frustum();
const tmpProjView = new THREE.Matrix4();
const tmpSphere = new THREE.Sphere();

/** Line-of-sight checker — provided each frame by the caller (main
 *  loop pulls walkable.hasLineOfSight from the active level). Sources
 *  whose XZ line to the camera is blocked by a wall get culled before
 *  ranking: a torch in the next room is physically close but visually
 *  useless (the wall absorbs every contribution to the player-side
 *  surface anyway, via N·L). Without this, a through-wall torch could
 *  hog a slot that an in-room torch wants. */
export type LOSChecker = (ax: number, az: number, bx: number, bz: number) => boolean;

/** Per-frame: bind the N nearest sources within each category to that
 *  category's slots. losCheck (optional) culls through-wall sources. */
export function tickLightPool(camera: THREE.Camera, losCheck?: LOSChecker): void {
  if (slotsByCategory.environment.length === 0) return;

  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;

  // Rebuild the frustum each tick. matrixWorldInverse is normally
  // updated by the renderer during render() — we may be called from
  // the main tick BEFORE render, so flush it ourselves. Cheap.
  camera.updateMatrixWorld();
  tmpProjView.multiplyMatrices(
    (camera as THREE.PerspectiveCamera).projectionMatrix,
    camera.matrixWorldInverse,
  );
  tmpFrustum.setFromProjectionMatrix(tmpProjView);

  // Reset scratch buckets.
  scratchByCategory.lamp.length = 0;
  scratchByCategory.environment.length = 0;
  scratchByCategory.pickup.length = 0;
  scratchByCategory.projectile.length = 0;

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
    // Frustum cull: if the light's reach sphere doesn't intersect
    // the camera frustum, nothing the camera renders can be lit by
    // it. Lamp is exempt — its world pos sits a few cm in front of
    // the camera and the sphere can technically miss the frustum
    // bound on certain FOVs; for the lamp we always want a slot.
    if (src.category !== 'lamp') {
      tmpSphere.center.copy(src.position);
      tmpSphere.radius = src.distance;
      if (!tmpFrustum.intersectsSphere(tmpSphere)) continue;
    }
    // LOS cull: if a wall separates this source from the camera, skip
    // it. Lamp category bypasses LOS (it IS the camera; its own world
    // pos sits at camera + offset, sometimes just inside a wall).
    if (losCheck && src.category !== 'lamp') {
      if (!losCheck(cx, cz, src.position.x, src.position.z)) continue;
    }
    let sortKey = dist2;
    if (boundLastFrameByCategory[src.category].has(src.id)) sortKey -= HYSTERESIS_SQ;
    scratchByCategory[src.category].push({ src, sortKey });
  }

  // Sort + bind each category's slots independently.
  const cats: LightCategory[] = ['lamp', 'environment', 'pickup', 'projectile'];
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

export interface LightSourceInfo {
  id: string;
  category: LightCategory;
  pos: { x: number; y: number; z: number };
  color: number;
  intensity: number;
  distance: number;
  /** Metres from the given point (set by listLightSourcesNear). */
  range: number;
}

/** Debug introspection — list registered light sources within `radius`
 *  of (x, z), nearest first. Used by the debug capture tool to report
 *  the lights around the player. Reports the source's CURRENT intensity
 *  (via getIntensity if present) so flicker is reflected. */
export function listLightSourcesNear(x: number, z: number, radius = 14): LightSourceInfo[] {
  const out: LightSourceInfo[] = [];
  for (const s of sources.values()) {
    const dx = s.position.x - x;
    const dz = s.position.z - z;
    const range = Math.hypot(dx, dz);
    if (range > radius) continue;
    out.push({
      id: s.id,
      category: s.category,
      pos: { x: round1(s.position.x), y: round1(s.position.y), z: round1(s.position.z) },
      color: s.color,
      intensity: round1(s.getIntensity ? s.getIntensity() : s.intensity),
      distance: s.distance,
      range: round1(range),
    });
  }
  return out.sort((a, b) => a.range - b.range);
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/** Sum of attenuated contributions from all CURRENTLY BOUND slots at
 *  (x, y, z). Reads slot state directly so it reflects exactly what the
 *  shader sees this frame (LOS-culled, hysteresis-stable). Returns raw
 *  intensity units — caller decides how to normalize.
 *
 *  Used by the AI-playable harness to report "how lit is the player".
 *  Cheap: walks ~17 slots, no allocations. */
export function sampleLightAt(x: number, y: number, z: number): number {
  let total = 0;
  for (const cat of Object.keys(slotsByCategory) as LightCategory[]) {
    for (const slot of slotsByCategory[cat]) {
      if (slot.intensity <= 0 || slot.distance <= 0) continue;
      const dx = slot.position.x - x;
      const dy = slot.position.y - y;
      const dz = slot.position.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= slot.distance) continue;
      // Three.js PointLight distance attenuation:  (1 - d/distance)^decay
      const t = 1 - d / slot.distance;
      const att = Math.pow(t, slot.decay);
      total += slot.intensity * att;
    }
  }
  return total;
}
