// Shared BufferGeometry pool.
//
// Procedural primitives (BoxGeometry, CylinderGeometry, etc.) are
// allocated per-instance by default — every vase, every candle, every
// stair tread builds its own vertex buffer at spawn time. That's fine
// for one-offs but expensive in the aggregate: dozens of identical
// candles in a vault all duplicate the same geometry on the GPU.
//
// The pool keys geometries by their canonical shape spec (e.g.
// "box:0.2:0.3:0.2") and returns the SAME BufferGeometry instance to
// every caller that asks for the same shape. Three.js handles multiple
// meshes referencing one geometry natively — the renderer batches
// draw calls, shadow casters share vertex buffers, GPU memory usage
// stays constant regardless of instance count.
//
// ── Ownership ─────────────────────────────────────────────────────────
//
// Pooled geometries live for the lifetime of the app. Every returned
// geometry is tagged with `userData.pooled = true` so the level
// teardown loop in level/builder.ts can SKIP dispose() on them —
// disposing a shared geometry would yank vertex buffers out from
// under meshes still in the next level.
//
// Geometries that need per-instance mutation (jitter, runtime morphs)
// MUST NOT be pulled from the pool. The build-model.ts logic respects
// this by routing parts with a `jitter` field through fresh
// constructors and the in-place jitterGeometry pass.
//
// ── Adding a new shape ────────────────────────────────────────────────
//
// 1. Add a `pooledX(...)` helper below using getOrCache + a stable key.
// 2. Round float args via `k()` so 0.20000001 and 0.2 hash equally.
// 3. Use it from build-model.ts (auto-pooled for ModelSpec parts) or
//    from hand-written builders as a drop-in replacement for
//    `new THREE.XGeometry(...)`.

import * as THREE from 'three';

// Shape key → shared geometry. Map (not WeakMap) — we want strong
// references, the pool is the owner.
const cache = new Map<string, THREE.BufferGeometry>();

/** Round to 6 decimals so floating-point drift in authored specs
 *  doesn't fragment the cache. Almost all in-code numbers are clean
 *  to 3-4 decimals anyway. */
function k(n: number): string {
  return (Math.round(n * 1e6) / 1e6).toString();
}

function getOrCache(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = cache.get(key);
  if (!geo) {
    geo = build();
    geo.userData.pooled = true;
    cache.set(key, geo);
  }
  return geo;
}

/** True if this geometry came from the pool. Level teardown checks
 *  this and skips dispose() so the shared instance persists. */
export function isPooledGeometry(geo: THREE.BufferGeometry): boolean {
  return geo.userData.pooled === true;
}

/** Diagnostics: how many unique geometries does the pool hold?
 *  Surfaced via the perf overlay later if useful. */
export function getGeometryPoolSize(): number {
  return cache.size;
}

// ── Primitives ────────────────────────────────────────────────────────

export function pooledBox(w: number, h: number, d: number): THREE.BoxGeometry {
  return getOrCache(`box:${k(w)}:${k(h)}:${k(d)}`,
    () => new THREE.BoxGeometry(w, h, d)) as THREE.BoxGeometry;
}

/** Whole sphere, or a SLICE of one when the phi/theta arguments are given — a
 *  half-sphere lid, a dome, a shell cap. The slice arguments are part of the
 *  cache key, so a dome and a full sphere of the same radius stay distinct. */
export function pooledSphere(
  radius: number, widthSeg: number = 16, heightSeg: number = 12,
  phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number,
): THREE.SphereGeometry {
  const sliced = phiStart !== undefined || phiLength !== undefined
    || thetaStart !== undefined || thetaLength !== undefined;
  const slice = sliced ? `:${k(phiStart ?? 0)}:${k(phiLength ?? Math.PI * 2)}:${k(thetaStart ?? 0)}:${k(thetaLength ?? Math.PI)}` : '';
  return getOrCache(`sph:${k(radius)}:${widthSeg}:${heightSeg}${slice}`,
    () => new THREE.SphereGeometry(radius, widthSeg, heightSeg, phiStart, phiLength, thetaStart, thetaLength)) as THREE.SphereGeometry;
}

/** Flat disc. `pooledRing(0, r)` is nearly the same shape but carries the ring's
 *  extra inner vertices and its UVs run radially, so a disc gets its own entry. */
export function pooledCircle(radius: number, segments: number = 16): THREE.CircleGeometry {
  return getOrCache(`circ:${k(radius)}:${segments}`,
    () => new THREE.CircleGeometry(radius, segments)) as THREE.CircleGeometry;
}

export function pooledCylinder(
  radiusTop: number, radiusBottom: number, height: number, segments: number = 12,
): THREE.CylinderGeometry {
  return getOrCache(`cyl:${k(radiusTop)}:${k(radiusBottom)}:${k(height)}:${segments}`,
    () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments)) as THREE.CylinderGeometry;
}

export function pooledCone(
  radius: number, height: number, segments: number = 12,
): THREE.ConeGeometry {
  return getOrCache(`cone:${k(radius)}:${k(height)}:${segments}`,
    () => new THREE.ConeGeometry(radius, height, segments)) as THREE.ConeGeometry;
}

export function pooledTorus(
  radius: number, tube: number, radialSeg: number = 8, tubularSeg: number = 16,
): THREE.TorusGeometry {
  return getOrCache(`tor:${k(radius)}:${k(tube)}:${radialSeg}:${tubularSeg}`,
    () => new THREE.TorusGeometry(radius, tube, radialSeg, tubularSeg)) as THREE.TorusGeometry;
}

export function pooledCapsule(
  radius: number, height: number, capSeg: number = 4, radialSeg: number = 12,
): THREE.CapsuleGeometry {
  return getOrCache(`cap:${k(radius)}:${k(height)}:${capSeg}:${radialSeg}`,
    () => new THREE.CapsuleGeometry(radius, height, capSeg, radialSeg)) as THREE.CapsuleGeometry;
}

export function pooledPlane(
  width: number, height: number, widthSeg: number = 1, heightSeg: number = 1,
): THREE.PlaneGeometry {
  return getOrCache(`plane:${k(width)}:${k(height)}:${widthSeg}:${heightSeg}`,
    () => new THREE.PlaneGeometry(width, height, widthSeg, heightSeg)) as THREE.PlaneGeometry;
}

export function pooledRing(
  inner: number, outer: number, segments: number = 24,
): THREE.RingGeometry {
  return getOrCache(`ring:${k(inner)}:${k(outer)}:${segments}`,
    () => new THREE.RingGeometry(inner, outer, segments)) as THREE.RingGeometry;
}
