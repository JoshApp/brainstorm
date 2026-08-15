import * as THREE from 'three';
import { disposeGpu } from '../scene/gpu-dispose';

// Blade trail — a warm-amber ribbon drawn from the held weapon's
// blade_tip over the last ~180ms, used to extend the charged-strike
// glow into a brief streak through the air. Grimdark, NOT Zelda: thin,
// tapered, additive, gone before the recover ends. The blade IS hot;
// the air remembers where it was, briefly.
//
// One BufferGeometry sized to MAX_SEGMENTS pairs of vertices is built
// at init and refilled each frame — no per-frame allocation. Indices
// + vertex order form a triangle strip; `setDrawRange` clips it to the
// live segment count. Vertex colors carry the head-bright/tail-dark
// gradient — multiplied by additive blending so no shader needed.
//
// Coordinate notes:
//   - Trail lives in WORLD space (not viewmodel-local) so it correctly
//     occludes against world geometry — a swing past a wall doesn't
//     paint a streak through the wall.
//   - Ribbon width follows the screen-aligned RIGHT vector at each
//     point: cross(tangent_along_path, view_to_point). Always faces
//     the camera regardless of swing direction.
//   - NOT registered as a viewmodel root. Additive blending wants the
//     world's painted colour underneath to add against — registering
//     would write the trail's depth in the viewmodel pre-pass and
//     mask the world from painting behind it, giving solid amber on
//     black instead of an additive streak over the lit scene.

const MAX_SEGMENTS    = 18;     // ring buffer depth — 18 frames @ 60fps ≈ 300 ms cap
const MAX_AGE         = 0.20;   // seconds before a point fully fades
const SAMPLE_INTERVAL = 0.008;  // min seconds between samples (8 ms)
const TRAIL_WIDTH     = 0.030;  // metres at the head, tapers with age
const TRAIL_COLOR     = new THREE.Color(0xffa860);   // warm amber, matches charged-glow

interface TrailPoint {
  pos: THREE.Vector3;
  age: number;
}

const points: TrailPoint[] = [];
let mesh: THREE.Mesh | null = null;
let material: THREE.MeshBasicMaterial | null = null;
let geometry: THREE.BufferGeometry | null = null;
let positionAttr: THREE.BufferAttribute | null = null;
let colorAttr: THREE.BufferAttribute | null = null;

// 0..1 — drives the per-frame max brightness. The viewmodel sets this
// during a charged strike, fades it during recover, clears on idle.
let intensity = 0;
let timeSinceSample = 0;

const _tangent     = new THREE.Vector3();
const _right       = new THREE.Vector3();
const _viewToPoint = new THREE.Vector3();

/** Build the trail mesh + attach under `scene`. Idempotent. Call once
 *  at startup; the mesh persists across levels (one geometry, no
 *  per-level rebuild). */
export function initBladeTrail(scene: THREE.Object3D): void {
  if (mesh) return;

  geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(2 * MAX_SEGMENTS * 3);
  const colors    = new Float32Array(2 * MAX_SEGMENTS * 3);
  positionAttr = new THREE.BufferAttribute(positions, 3);
  colorAttr    = new THREE.BufferAttribute(colors, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('color', colorAttr);

  // Triangle strip indices: each adjacent pair of vertex-pairs forms
  // two triangles spanning the ribbon. 6 indices per segment.
  const indices: number[] = [];
  for (let i = 0; i < MAX_SEGMENTS - 1; i++) {
    const a = 2 * i;
    const b = 2 * i + 1;
    const c = 2 * (i + 1);
    const d = 2 * (i + 1) + 1;
    indices.push(a, b, c);
    indices.push(b, d, c);
  }
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);

  material = new THREE.MeshBasicMaterial({
    color: 0xffffff,              // unit white; vertex colour does the tinting
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,              // world geometry occludes the streak
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,       // ribbon's orientation flips as swing arcs
  });

  mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;     // it can move/swing past culling bounds in one frame
  mesh.renderOrder = 997;         // sits before lamp (998) + sword (999) in the transparent phase
  mesh.visible = false;
  scene.add(mesh);
}

/** Set the trail's live brightness (0..1). The viewmodel raises this
 *  during a charged strike and decays it through recover. Below ~0.05
 *  the trail stops sampling new points and the visible streak fades to
 *  nothing as the existing points age out. */
export function setBladeTrailIntensity(value: number): void {
  intensity = Math.max(0, Math.min(1, value));
}

/** Per-frame. Pass the current blade tip world position (null when
 *  unarmed / mid-swap) and the camera world position. Calls only need
 *  the tip while the trail is live; an inactive trail still ticks so
 *  in-flight points age out cleanly. */
export function tickBladeTrail(
  dt: number,
  tipWorld: THREE.Vector3 | null,
  cameraWorld: THREE.Vector3,
): void {
  if (!mesh || !geometry || !positionAttr || !colorAttr) return;

  // Sample a new point at the head while the trail is bright enough to
  // see. The sample interval caps the buffer growth on high-FPS frames.
  if (intensity > 0.05 && tipWorld) {
    timeSinceSample += dt;
    if (timeSinceSample >= SAMPLE_INTERVAL) {
      points.unshift({ pos: tipWorld.clone(), age: 0 });
      if (points.length > MAX_SEGMENTS) points.pop();
      timeSinceSample = 0;
    }
  } else {
    // No sampling while dim, but reset the interval so the next bright
    // window starts with a fresh sample (no leftover wait time).
    timeSinceSample = SAMPLE_INTERVAL;
  }

  // Age + drop expired.
  for (const p of points) p.age += dt;
  while (points.length > 0 && points[points.length - 1].age >= MAX_AGE) {
    points.pop();
  }

  if (points.length < 2) {
    mesh.visible = false;
    geometry.setDrawRange(0, 0);
    return;
  }
  mesh.visible = true;

  const positions = positionAttr.array as Float32Array;
  const colors    = colorAttr.array as Float32Array;

  for (let i = 0; i < MAX_SEGMENTS; i++) {
    if (i < points.length) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)].pos;
      const next = points[Math.min(points.length - 1, i + 1)].pos;
      _tangent.subVectors(next, prev);
      if (_tangent.lengthSq() < 1e-10) {
        _tangent.set(1, 0, 0);          // degenerate — use any direction
      } else {
        _tangent.normalize();
      }
      _viewToPoint.subVectors(p.pos, cameraWorld);
      _right.crossVectors(_tangent, _viewToPoint);
      const rl = _right.length();
      if (rl < 1e-6) {
        _right.set(0, TRAIL_WIDTH, 0);
      } else {
        _right.multiplyScalar(1 / rl);
      }
      const ageFrac = p.age / MAX_AGE;
      const widthHere = TRAIL_WIDTH * (1 - ageFrac);
      _right.multiplyScalar(widthHere);

      const base = 6 * i;
      positions[base + 0] = p.pos.x + _right.x;
      positions[base + 1] = p.pos.y + _right.y;
      positions[base + 2] = p.pos.z + _right.z;
      positions[base + 3] = p.pos.x - _right.x;
      positions[base + 4] = p.pos.y - _right.y;
      positions[base + 5] = p.pos.z - _right.z;

      // Brightness = intensity × (1 − ageFrac)². The squared falloff
      // keeps the tail dim quickly so older streaks don't smear.
      const tail = 1 - ageFrac;
      const brightness = intensity * tail * tail;
      const r = TRAIL_COLOR.r * brightness;
      const g = TRAIL_COLOR.g * brightness;
      const b = TRAIL_COLOR.b * brightness;
      colors[base + 0] = r;
      colors[base + 1] = g;
      colors[base + 2] = b;
      colors[base + 3] = r;
      colors[base + 4] = g;
      colors[base + 5] = b;
    } else {
      // Collapse unused vertex pairs onto the last live point so any
      // degenerate triangles draw nothing. setDrawRange below also
      // clips them out for safety.
      const last = points[points.length - 1].pos;
      const base = 6 * i;
      positions[base + 0] = positions[base + 3] = last.x;
      positions[base + 1] = positions[base + 4] = last.y;
      positions[base + 2] = positions[base + 5] = last.z;
      colors[base + 0] = colors[base + 1] = colors[base + 2] = 0;
      colors[base + 3] = colors[base + 4] = colors[base + 5] = 0;
    }
  }

  positionAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  // Clip to live segments — 6 indices (2 triangles) per ribbon segment.
  const segCount = Math.max(0, points.length - 1);
  geometry.setDrawRange(0, segCount * 6);
}

/** Wipe the in-flight trail — level swap, death, etc. */
export function clearBladeTrail(): void {
  points.length = 0;
  intensity = 0;
  timeSinceSample = 0;
  if (mesh && geometry) {
    mesh.visible = false;
    geometry.setDrawRange(0, 0);
  }
}

/** Detach + dispose. Optional — tests / harness teardown. */
export function disposeBladeTrail(): void {
  mesh?.parent?.remove(mesh);
  disposeGpu(geometry, material);
  mesh = null;
  geometry = null;
  material = null;
  positionAttr = null;
  colorAttr = null;
  points.length = 0;
}
