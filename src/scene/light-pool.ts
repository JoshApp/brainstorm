import * as THREE from 'three';
import type { ShadowMode } from '../settings/settings';
import { CONFIG } from '../config';

// THE LIGHT DIRECTOR — decides, each frame, which of the level's many logical
// light sources actually LIGHT the frame, and how strongly. Selection
// (nearest-N per category), hysteresis (no boundary flicker), soft LOS
// (through-wall sources dim instead of popping), flame wobble, and the
// shadow-caster slots all live here. The fixed PointLight slots it binds
// into are its OUTPUT.
//
// Categories:
//
//   lamp        — the player's handheld lantern. Always 1 slot. Wins
//                 over everything; never pops.
//   environment — torches, candles, fountains, floor glows, stairs
//                 beacons, fill lights. The "room is lit by" stuff.
//   pickup      — loot highlights. Their own slots so a wave of drops
//                 can't crowd torches out, and torches can't crowd
//                 pickups out.
//   projectile  — active projectiles in flight (acolyte spit, future
//                 spells/darts). Own slots so a salvo can't crowd
//                 torches out; the pool spawns few and they're spread.
//
// Slot counts per category live in CONFIG.LIGHT_SLOTS. HISTORY: under
// classic WebGL every slot (even parked) was a per-fragment shader cost
// and a count change was a sync recompile — the fixed pool existed to
// dodge that. Under the clustered/tiled light loops parked slots cost
// nothing (intensity 0 → culled out of the bins), so the budget is now
// mostly a SELECTION cap: how many sources may light simultaneously.
// The fixed count still serves the material-path invariant (lamp +
// shadow casters — see below).
//
// Per category we sort registered sources by distance to camera and
// bind the nearest N to that category's slots. Sources beyond their
// own range are culled. Hysteresis (2.2m² bonus) prevents flicker
// when two sources contend for the boundary slot.

export type LightCategory = 'lamp' | 'environment' | 'pickup' | 'projectile';

// Budgets per category — CONFIG.LIGHT_SLOTS (see the lean-era note there):
// the director binds the nearest N visible sources per category and the
// rest degrade to their emissive sprites.
const CATEGORY_SLOTS: Record<LightCategory, number> = CONFIG.LIGHT_SLOTS;

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
  /** Slot priority. 'low' = ambience that should YIELD under budget
   *  pressure (room fill wash) — real sources (torches, signal glows)
   *  win the nearest slots first. */
  priority?: 'low';
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
const scratchByCategory: Record<LightCategory, Array<{ src: LightSource; sortKey: number; losBlocked?: boolean }>> = {
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
// 256 (not 512): a torch/lamp shadow is soft anyway, and the FAR plane below
// is tightened to the light's actual lit reach — so a 256 map over an ~8m
// frustum holds the SAME texel density the old 512 map had over 16m, at a
// quarter of the shadow-map fill. The look Josh likes is preserved; the cost
// isn't. Memory + GPU fill scale with this squared.
const SHADOW_MAP_SIZE = 256;
let shadowMode: ShadowMode = 'off';

// FLAME WOBBLE — horizontal amplitude (metres) of the per-torch positional
// flicker. Jittering the light ORIGIN (not just intensity) makes the floor pool
// waver and the cast shadows dance, so a torch reads as a living flame instead of
// a dead-perfect spotlight circle. Combined peak ≈ 1.8× this. Tune to taste.
const FLAME_WOBBLE = 0.06;

/** Pre-configure a slot's shadow camera + map. Cheap; the shadow map
 *  itself isn't allocated until castShadow flips true on first render. */
function configureSlotShadow(light: THREE.PointLight, isLamp = false): void {
  // The LAMP is a special case: it swings, and its own cage bars sit centimetres
  // from the bulb, so its shadow self-aliases hard (the "shutter/flicker" on the
  // arm). Give it a bigger map (less crawl) and a strong normalBias (the real fix
  // for swimming self-shadow on geometry hugging the light). Static torches don't
  // need either — keep them cheap.
  const size = isLamp ? 512 : SHADOW_MAP_SIZE;
  light.shadow.mapSize.set(size, size);
  light.shadow.bias = -0.004;
  // normalBias offsets the shadow sample along the surface normal — biggest lever
  // against the swinging-lamp shutter. Works under any shadow-map filter.
  light.shadow.normalBias = isLamp ? 0.06 : 0.02;
  // Soft PCF radius — gentle edge (honoured by the WebGPU node shadow filter; a
  // no-op under WebGL PCFShadowMap, where the res + normalBias carry the stability).
  light.shadow.radius = isLamp ? 3 : 1;
  light.shadow.camera.near = 0.12;
  // Tight far plane = the light's actual reach. The lamp lights ~5.5m
  // (CONFIG.LAMP_DISTANCE); nothing past that is lit, so nothing past that
  // can show a shadow. 16 → 8 → 6: the shadow camera frustum-culls casters
  // beyond `far`, so this IS the distance cull — at 6m only casters in (or just
  // past) the lit pool render into the cube map; the 6-8m band cast shadows too
  // dark to see anyway. Tightening also sharpens the 256 map's depth precision.
  light.shadow.camera.far = 6;
}

/** One-time setup. Adds N PointLights per category to the scene. */
export function initLightPool(sc: THREE.Scene): void {
  if (slotsByCategory.environment.length > 0) return;
  scene = sc;
  const categories = Object.keys(CATEGORY_SLOTS) as LightCategory[];
  for (const cat of categories) {
    const n = CATEGORY_SLOTS[cat];
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 5, 1.4);
      light.position.set(0, PARK_Y, 0);
      // Under tiled lighting the lamp stays on the normal (shadowed) path — it's
      // the only shadow-caster, and tiled point lights cast none. Tagged here;
      // DelveTiledLighting routes noTile point lights away from the tiled bin.
      if (cat === 'lamp') light.userData.noTile = true;
      configureSlotShadow(light, cat === 'lamp');
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

/** Current dynamic-shadow mode — so a profiler can toggle it off and restore. */
export function getShadowMode(): ShadowMode {
  return shadowMode;
}

// Spot-shadow split (?lampspot=1): the lamp's cube-shadow point light yields its
// shadow to a single-map forward SpotLight (6 passes → 1) and dims to a fill.
let lampSpotActive = false;
const LAMP_OMNI_SHARE = 0.4;   // omni point's share of the lamp light when the spot is on
export function setLampSpotActive(on: boolean): void { lampSpotActive = on; applyShadowMode(); }

function applyShadowMode(): void {
  // hero = lamp only; single = nearest world light only; all = lamp + nearest few.
  // Under spot-shadow mode the omni lamp NEVER casts (the SpotLight does instead).
  const lampCasts = (shadowMode === 'hero' || shadowMode === 'all') && !lampSpotActive;
  const envCasters = shadowMode === 'single' ? 1 : shadowMode === 'all' ? 4 : 0;
  for (const light of slotsByCategory.lamp) light.castShadow = lampCasts;
  const env = slotsByCategory.environment;
  for (let i = 0; i < env.length; i++) env[i].castShadow = i < envCasters;
  // pickup / projectile lights never cast — they're transient sparkle.
}

// ── Light-budget trim (A/B probe) ────────────────────────────────────
// Every PointLight in the scene — bound or parked at intensity 0 — is
// compiled into EVERY lit material's shader and evaluated per fragment.
// The slot counts above ARE that per-fragment price. This probe removes
// the remaining headroom slots from the scene so the GPU attribution
// sweep can measure what the current budget still costs over a bare
// minimum. Causes one shader recompile each way — fine inside a sweep's
// settle window, never something to flip mid-gameplay.
const TRIM_KEEP: Record<LightCategory, number> = {
  lamp: 1,
  environment: 3,
  pickup: 1,
  projectile: 1,
};

/** Slot totals (full budget vs probe-trimmed) — for the sweep's label. */
export function getLightSlotTotals(): { full: number; trimmed: number } {
  let full = 0, trimmed = 0;
  for (const cat of Object.keys(CATEGORY_SLOTS) as LightCategory[]) {
    full += CATEGORY_SLOTS[cat];
    trimmed += Math.min(TRIM_KEEP[cat], CATEGORY_SLOTS[cat]);
  }
  return { full, trimmed };
}
let budgetTrimmed = false;

export function setLightBudgetTrim(on: boolean): void {
  if (on === budgetTrimmed || !scene) return;
  budgetTrimmed = on;
  for (const cat of Object.keys(slotsByCategory) as LightCategory[]) {
    const slots = slotsByCategory[cat];
    for (let i = TRIM_KEEP[cat]; i < slots.length; i++) {
      if (on) scene.remove(slots[i]);
      else scene.add(slots[i]);
    }
  }
}
export function getLightBudgetTrim(): boolean { return budgetTrimmed; }

export function registerLight(src: LightSource): void {
  if (import.meta.env.DEV) {
    // Placement-collision guard: two sources nearly co-located is
    // almost always two PLACEMENT SYSTEMS unaware of each other (an
    // authored torch + an auto sconce, a fixture's model-light + a
    // hand light). Name both so the colliding systems are obvious.
    for (const other of sources.values()) {
      if (other.category !== src.category) continue;
      const dx = other.position.x - src.position.x;
      const dy = other.position.y - src.position.y;
      const dz = other.position.z - src.position.z;
      if (dx * dx + dy * dy + dz * dz < 0.6 * 0.6) {
        console.warn(
          `[light-pool] sources nearly co-located (<0.6m): '${src.id}' and '${other.id}' ` +
          `at (${src.position.x.toFixed(2)}, ${src.position.z.toFixed(2)}) — two placement systems colliding?`,
        );
      }
    }
  }
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
  visById.clear();
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
// ── Soft visibility (the anti-pop layer) ──────────────────────────
// Per-source eased visibility factor. Binary LOS culling made lights
// POP: a torch around a door jamb flipped eligible/ineligible per
// frame, and next-room lights appeared the exact frame the ray
// cleared the jamb. Instead: LOS-blocked sources stay candidates at
// ~30% intensity (light leaks through openings — the dim glow through
// a doorway is the ANTICIPATION beat), de-prioritised in the slot
// sort so they yield under budget pressure, and every bind change
// EASES (~120ms in, ~200ms out of blockage) instead of stepping.
const visById = new Map<string, number>();

// Live tuning multipliers (settings sliders) for environment lights —
// applied at slot-write time so they touch every torch/sconce/
// chandelier instantly, no rebuild.
let envStrengthMul = 1;
let envRangeMul = 1;
export function setEnvLightMuls(strength: number, range: number): void {
  envStrengthMul = strength;
  envRangeMul = range;
}
// The wick's share: ambient FILLS (priority 'low') scale with the
// player's calibrated visibility floor; torches/signals don't.
let wickFillMul = 1;
export function setWickFillMul(v: number): void { wickFillMul = v; }
const LOS_DIM = 0.3;          // blocked sources glow at this fraction
const LOS_SORT_PENALTY = 90;  // dist²-space penalty: blocked ≈ 9.5m farther
const LOW_PRIORITY_PENALTY = 40;   // ambience fill yields to real sources
let lastTickMs = 0;

export function tickLightPool(camera: THREE.Camera, losCheck?: LOSChecker): void {
  if (slotsByCategory.environment.length === 0) return;
  const nowMs = performance.now();
  const dt = lastTickMs > 0 ? Math.min(0.1, (nowMs - lastTickMs) / 1000) : 1 / 60;
  lastTickMs = nowMs;

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
    //
    // ── THE CULL USES THE RANGE THE LIGHT IS ACTUALLY BOUND WITH ─────────────
    //
    // This read `src.distance + 2`, the AUTHORED range — while the slot below binds
    // `src.distance * envRangeMul`. So with TORCH RANGE above 1.00 a torch lit further
    // than the cull would let it live: it was dropped at 13m while still throwing light at
    // 16m, and walking in past the threshold made it appear. Josh: *"lights pop into view
    // when I approach them and I can already see the room."*
    //
    // Two readings of one number, which is the same fault as the corridor that was 2.20m
    // of rect and 1.03m of frame. The cull asks the bound range now, so raising the slider
    // extends the cull with it.
    const bound = src.distance * (src.category === 'environment' ? envRangeMul : 1);
    const reach = bound + 2;
    if (dist2 > reach * reach) continue;
    // Frustum cull: if the light's reach sphere doesn't intersect
    // the camera frustum, nothing the camera renders can be lit by
    // it. Lamp is exempt — its world pos sits a few cm in front of
    // the camera and the sphere can technically miss the frustum
    // bound on certain FOVs; for the lamp we always want a slot.
    if (src.category !== 'lamp') {
      tmpSphere.center.copy(src.position);
      // The BOUND range again — a sphere cut to the authored one would drop a light whose
      // reach still crosses the frustum, which is the same pop from a different angle.
      tmpSphere.radius = bound;
      if (!tmpFrustum.intersectsSphere(tmpSphere)) continue;
    }
    // LOS: a wall between source and camera DIMS the light instead of
    // killing it (see the soft-visibility note above). Lamp bypasses
    // LOS (it IS the camera; its world pos can sit just inside a wall).
    let losBlocked = false;
    if (losCheck && src.category !== 'lamp') {
      losBlocked = !losCheck(cx, cz, src.position.x, src.position.z);
    }
    let sortKey = dist2 + (losBlocked ? LOS_SORT_PENALTY : 0) + (src.priority === 'low' ? LOW_PRIORITY_PENALTY : 0);
    if (boundLastFrameByCategory[src.category].has(src.id)) sortKey -= HYSTERESIS_SQ;
    scratchByCategory[src.category].push({ src, sortKey, losBlocked });
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
        const { src, losBlocked } = scratch[i];
        // POSITIONAL FLICKER — torches/candles dance: jitter the light ORIGIN with
        // smooth, per-source, non-repeating noise so the floor pool wavers and the
        // shadows breathe instead of sitting as a dead-perfect spotlight circle.
        // Environment sources only — the lamp already moves (and its shadow is
        // stabilized; jittering it would re-introduce the swim).
        if (src.category === 'environment') {
          const t = nowMs * 0.001;
          const ph = src.position.x * 1.7 + src.position.z * 2.3;   // stable per-torch phase
          const jx = (Math.sin(t * 5.3 + ph) + Math.sin(t * 2.1 + ph * 1.7) * 0.8) * FLAME_WOBBLE;
          const jy = Math.sin(t * 6.7 + ph * 0.7) * FLAME_WOBBLE * 0.5;
          const jz = (Math.cos(t * 4.9 + ph * 1.3) + Math.cos(t * 2.7 + ph * 0.5) * 0.8) * FLAME_WOBBLE;
          slot.position.set(src.position.x + jx, src.position.y + jy, src.position.z + jz);
        } else {
          slot.position.copy(src.position);
        }
        // Eased visibility: fresh binds fade IN from 0; LOS blockage
        // fades to its dim level instead of stepping. Flicker
        // (getIntensity) rides on top untouched.
        const target = losBlocked ? LOS_DIM : 1;
        const prev = visById.get(src.id) ?? 0;
        const vis = prev + (target - prev) * (1 - Math.exp(-dt * (target > prev ? 9 : 5)));
        visById.set(src.id, vis);
        const isEnv = src.category === 'environment';
        slot.intensity = (src.getIntensity ? src.getIntensity() : src.intensity) * vis
          * (isEnv ? envStrengthMul : 1)
          * (src.priority === 'low' ? wickFillMul : 1)
          // Spot-shadow mode: the lamp's omni point drops to a dim fill; the
          // forward SpotLight (lamp-spot.ts) carries the rest + casts the shadow.
          * (src.category === 'lamp' && lampSpotActive ? LAMP_OMNI_SHARE : 1);
        slot.distance = src.distance * (isEnv ? envRangeMul : 1);
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
    // Sources that lost their slot restart from black on re-entry.
    for (const [id, _] of visById) {
      if (!sources.has(id)) visById.delete(id);
    }
    for (const sc of scratch) {
      if (!bound.has(sc.src.id)) visById.delete(sc.src.id);
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
