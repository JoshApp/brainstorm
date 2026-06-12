import * as THREE from 'three';

// ── SPLAT MAP — the floor remembers its violence ─────────────────────
//
// A single world-mapped render target that gameplay events stamp into
// (Killing Floor's gore tech, sized for us): every blood burst leaves
// a wet splat; the floor material samples the map by world XZ and
// darkens/tints/wets where blood landed. Persistent for the life of
// the floor — rooms accumulate their history; a new floor wipes it.
//
//   initSplatMap(renderer)            once at boot
//   resetSplatMap(minX,minZ,w,d)      per floor (builder)
//   stampSplat(x, z, r, color, a)     queue a stamp (any gameplay code)
//   flushSplats(renderer)             render tick drains the queue
//
// The map + bounds are exported as SHARED UNIFORM REFS that
// surface-detail.ts wires into the floor material once.

const SIZE = 1024;
// Wall arc map: 1024×512, split halves by wall facing (left = X-facing
// walls keyed by worldZ, right = Z-facing keyed by worldX), v = worldY
// over a 3.5m height window. Channels: RG = stain colour (B is
// reconstructed at read), B = the wall's PLANE COORDINATE (kills
// ghosting between parallel walls sharing an axis), A = wetness.
// Wall arcs don't dry (the drying lerp would corrupt the B channel) —
// they're rare, deliberate marks: deaths and crits only.
const WALL_W = 1024;
const WALL_H = 512;
const WALL_HEIGHT_M = 3.5;

let rt: THREE.WebGLRenderTarget | null = null;
let wallRt: THREE.WebGLRenderTarget | null = null;
let stampScene: THREE.Scene | null = null;
let stampCam: THREE.OrthographicCamera | null = null;
let stampMesh: THREE.Mesh | null = null;
let stampMat: THREE.ShaderMaterial | null = null;
let needsClear = true;

// Shared uniform refs (surface-detail wires these into materials).
export const uSplatTex = { value: null as THREE.Texture | null };
export const uSplatBounds = { value: new THREE.Vector4(0, 0, 1, 1) };  // minX, minZ, sizeX, sizeZ
export const uSplatOn = { value: 0 };
export const uSplatWallTex = { value: null as THREE.Texture | null };

/** Wall probe — registered by main per floor. Given a point + throw
 *  direction, returns the first axis-aligned wall within reach. */
export type WallHit = { axis: 'x' | 'z'; plane: number; along: number };
let wallProbe: ((x: number, z: number, dx: number, dz: number) => WallHit | null) | null = null;
export function setSplatWallProbe(fn: typeof wallProbe): void {
  wallProbe = fn;
}

interface Stamp {
  x: number; z: number; r: number; color: THREE.Color; a: number; seed: number;
  /** Direction (map-space, normalized) for streak splats; null = radial pool. */
  dir: { x: number; z: number } | null;
  /** 'floor' renders into the XZ map; 'wall' into the wall-arc map
   *  (x/z are then map UV, r pre-scaled, rot in radians). */
  surface: 'floor' | 'wall';
  rot?: number;
  scaleX?: number;
  scaleY?: number;
}
const queue: Stamp[] = [];

// Drying: every DRY_INTERVAL a low-alpha quad lerps the map's COLOR
// toward dried brown-black (alpha/wetness untouched). Freshness needs
// no extra channel — drying IS desaturating, and the floor shader
// reads saturation as freshness (fresh saturated blood glistens and
// flows; dried brown lies matte; skeleton dust never glistens).
const DRY_INTERVAL_S = 2.5;
const DRY_FULL_S = 75;
let lastDryAt = 0;
let dryMesh: THREE.Mesh | null = null;
let dryMat: THREE.ShaderMaterial | null = null;

export function initSplatMap(): void {
  if (rt) return;
  rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  uSplatTex.value = rt.texture;
  wallRt = new THREE.WebGLRenderTarget(WALL_W, WALL_H, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  uSplatWallTex.value = wallRt.texture;

  stampScene = new THREE.Scene();
  stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  stampMat = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector2() },   // in map UV
      uRadius: { value: 0.01 },                  // in map UV
      uColor: { value: new THREE.Color(0x7a1612) },
      uAlpha: { value: 0.8 },
      uSeed: { value: 0 },
      uStreak: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec2 uCenter; uniform float uRadius; uniform vec3 uColor;
      uniform float uAlpha; uniform float uSeed; uniform float uStreak;
      float h(vec2 p){ p = fract(p * 0.3183099 + uSeed); p *= 17.0; return fract(p.x * p.y * (p.x + p.y)); }
      void main(){
        // The quad is positioned + scaled to the splat's bounds (see
        // flushSplats), so vUv spans exactly the stamp's disc — the
        // shader touches ~hundreds of texels, not the whole 1024^2
        // target. uCenter/uRadius stay in MAP space for the seed hash.
        float d = length(vUv - vec2(0.5)) * 2.0;
        if (d > 1.0) discard;
        // SOLID core; spatter as droplet BLOBS (coarse cells smoothly
        // thresholded), not per-texel hash — per-texel hash reads as
        // red-white noise on the floor, not as liquid.
        // Streaks (uStreak=1): the quad is pre-stretched along the
        // throw; the core sits at the IMPACT end (-x) and the spatter
        // thins toward the far end — blood travels away from the blow.
        vec2 pl = (vUv - vec2(0.5)) * 2.0;
        float along = pl.x * 0.5 + 0.5;   // 0 = impact end, 1 = far end
        float coreD = uStreak > 0.5 ? length(pl + vec2(0.45, 0.0)) * 1.25 : d;
        float core = 1.0 - smoothstep(0.45, 0.72, coreD);
        vec2 cell = (vUv - vec2(0.5)) * 2.0 * 5.5;
        float blob = h(floor(cell));
        float inBlob = smoothstep(0.55, 0.85, blob) * (1.0 - smoothstep(0.0, 0.45, length(fract(cell) - 0.5)));
        float thin = uStreak > 0.5 ? (1.0 - along * 0.55) : 1.0;
        float spatter = inBlob * (1.0 - smoothstep(0.45, 1.0, d)) * thin;
        float a = clamp(max(core, spatter), 0.0, 1.0) * uAlpha;
        if (a < 0.015) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // RGB lerps toward the stamp colour; ALPHA accumulates (wetness adds up).
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  stampMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), stampMat);
  stampMesh.frustumCulled = false;   // positioned per stamp in flushSplats
  stampScene.add(stampMesh);

  // Drying quad: lerps the map's COLOR toward dried brown-black,
  // leaving alpha (wetness footprint) untouched.
  dryMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0.03 } },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uK;
      void main(){ gl_FragColor = vec4(vec3(0.085, 0.035, 0.025), uK); }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  dryMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dryMat);
  dryMesh.position.set(0.5, 0.5, 0);
  dryMesh.visible = false;
  stampScene.add(dryMesh);
}

/** New floor: set the world→map mapping and wipe the slate. */
export function resetSplatMap(minX: number, minZ: number, sizeX: number, sizeZ: number): void {
  uSplatBounds.value.set(minX, minZ, Math.max(1, sizeX), Math.max(1, sizeZ));
  uSplatOn.value = 1;
  queue.length = 0;
  needsClear = true;
  wallProbe = null;   // stale probes reference the dead floor's walkable
}

/** Queue a splat. x/z world; radius metres; alpha = wetness added. */
export function stampSplat(
  x: number, z: number, radius: number, colorHex: number, alpha = 0.8,
  dir?: { x: number; z: number } | null,
): void {
  if (!rt) return;
  const b = uSplatBounds.value;
  const u = (x - b.x) / b.z;
  const v = (z - b.y) / b.w;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  let d: { x: number; z: number } | null = null;
  if (dir) {
    const len = Math.hypot(dir.x, dir.z);
    if (len > 0.001) d = { x: dir.x / len, z: dir.z / len };
  }
  queue.push({ x: u, z: v, r: radius / Math.max(b.z, b.w), color: new THREE.Color(colorHex), a: alpha, seed: Math.random(), dir: d, surface: 'floor' });
}

/** Throw an arc onto the nearest wall along the throw direction
 *  (deaths + crits). Uses the per-floor wall probe; silently does
 *  nothing in open space. */
export function stampWallArc(
  x: number, z: number, y: number, dirX: number, dirZ: number,
  colorHex: number, alpha = 0.8, size = 0.55,
): void {
  if (!rt || !wallProbe) return;
  const len = Math.hypot(dirX, dirZ) || 1;
  const hit = wallProbe(x, z, dirX / len, dirZ / len);
  if (!hit) return;
  const b = uSplatBounds.value;
  // Mirror of the wall-shader mapping (surface-detail.ts): X-facing
  // walls key by Z in the left half; Z-facing by X in the right.
  const along = hit.axis === 'x' ? (hit.along - b.y) / b.w : (hit.along - b.x) / b.z;
  const pc = hit.axis === 'x' ? (hit.plane - b.x) / b.z : (hit.plane - b.y) / b.w;
  if (along < 0 || along > 1) return;
  const u = hit.axis === 'x' ? along * 0.5 : 0.5 + along * 0.5;
  const v = Math.max(0, Math.min(1, y / WALL_HEIGHT_M));
  const c = new THREE.Color(colorHex);
  queue.push({
    x: u, z: v,
    r: size,
    color: new THREE.Color(c.r, c.g, pc),   // B carries the plane coordinate
    a: alpha,
    seed: Math.random(),
    dir: null,
    surface: 'wall',
    rot: (Math.random() - 0.5) * 0.5,
    scaleX: (size * 2.2) / (hit.axis === 'x' ? b.w : b.z) * 0.5,
    scaleY: (size * 0.9) / WALL_HEIGHT_M,
  });
}

/** Directional spray: a stretched streak stamp plus satellite droplets
 *  thrown further along the direction. The shape every hit should
 *  make — blood travels AWAY from the blow. */
export function stampSpray(
  x: number, z: number, radius: number, colorHex: number, alpha: number,
  dirX: number, dirZ: number,
): void {
  const len = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / len, dz = dirZ / len;
  stampSplat(x + dx * radius * 0.4, z + dz * radius * 0.4, radius, colorHex, alpha, { x: dx, z: dz });
  const sats = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < sats; i++) {
    const t = 0.8 + Math.random() * 1.1;
    const side = (Math.random() - 0.5) * 0.5;
    stampSplat(
      x + (dx * t - dz * side) * radius * 1.6,
      z + (dz * t + dx * side) * radius * 1.6,
      radius * (0.22 + Math.random() * 0.22),
      colorHex,
      alpha * 0.8,
    );
  }
}

/** Drain queued stamps into the map. Called from the render tick. */
export function flushSplats(renderer: THREE.WebGLRenderer): void {
  if (!rt || !stampScene || !stampCam || !stampMat || !stampMesh) return;
  const dryDue = performance.now() / 1000 - lastDryAt >= DRY_INTERVAL_S;
  if (!needsClear && queue.length === 0 && !dryDue) return;
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(rt);
  if (needsClear) {
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (wallRt) {
      renderer.setRenderTarget(wallRt);
      renderer.clear(true, false, false);
      renderer.setRenderTarget(rt);
    }
    needsClear = false;
  }
  renderer.autoClear = false;
  for (const s of queue.splice(0)) {
    // Quad sized (and for streaks: rotated + stretched) to the splat —
    // fragment work proportional to the stain, not the map.
    renderer.setRenderTarget(s.surface === 'wall' && wallRt ? wallRt : rt);
    stampMesh.position.set(s.x, s.z, 0);
    if (s.surface === 'wall') {
      stampMesh.rotation.z = s.rot ?? 0;
      stampMesh.scale.set(s.scaleX ?? 0.05, s.scaleY ?? 0.05, 1);
      stampMat.uniforms.uStreak.value = 0;
    } else if (s.dir) {
      stampMesh.rotation.z = Math.atan2(s.dir.z, s.dir.x);
      stampMesh.scale.set(s.r * 2 * 1.9, s.r * 2 * 0.6, 1);
      stampMat.uniforms.uStreak.value = 1;
    } else {
      stampMesh.rotation.z = 0;
      stampMesh.scale.set(s.r * 2, s.r * 2, 1);
      stampMat.uniforms.uStreak.value = 0;
    }
    (stampMat.uniforms.uCenter.value as THREE.Vector2).set(s.x, s.z);
    stampMat.uniforms.uRadius.value = s.r;
    (stampMat.uniforms.uColor.value as THREE.Color).copy(s.color);
    stampMat.uniforms.uAlpha.value = s.a;
    stampMat.uniforms.uSeed.value = s.seed;
    renderer.render(stampScene, stampCam);
  }
  // Drying tick — piggybacks on any flush; also runs when only the
  // clock demands it (see the early-return above, which lets us in
  // when due).
  const nowS = performance.now() / 1000;
  if (nowS - lastDryAt >= DRY_INTERVAL_S) {
    lastDryAt = nowS;
    if (dryMesh && dryMat) {
      stampMesh.visible = false;
      dryMesh.visible = true;
      dryMat.uniforms.uK.value = DRY_INTERVAL_S / DRY_FULL_S;
      renderer.setRenderTarget(rt);
      renderer.render(stampScene, stampCam);
      dryMesh.visible = false;
      stampMesh.visible = true;
    }
  }
  renderer.autoClear = prevAutoClear;
  renderer.setRenderTarget(prevTarget);
}
