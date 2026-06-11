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

let rt: THREE.WebGLRenderTarget | null = null;
let stampScene: THREE.Scene | null = null;
let stampCam: THREE.OrthographicCamera | null = null;
let stampMesh: THREE.Mesh | null = null;
let stampMat: THREE.ShaderMaterial | null = null;
let needsClear = true;

// Shared uniform refs (surface-detail wires these into materials).
export const uSplatTex = { value: null as THREE.Texture | null };
export const uSplatBounds = { value: new THREE.Vector4(0, 0, 1, 1) };  // minX, minZ, sizeX, sizeZ
export const uSplatOn = { value: 0 };

interface Stamp { x: number; z: number; r: number; color: THREE.Color; a: number; seed: number }
const queue: Stamp[] = [];

export function initSplatMap(): void {
  if (rt) return;
  rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  uSplatTex.value = rt.texture;

  stampScene = new THREE.Scene();
  stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  stampMat = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector2() },   // in map UV
      uRadius: { value: 0.01 },                  // in map UV
      uColor: { value: new THREE.Color(0x7a1612) },
      uAlpha: { value: 0.8 },
      uSeed: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec2 uCenter; uniform float uRadius; uniform vec3 uColor;
      uniform float uAlpha; uniform float uSeed;
      float h(vec2 p){ p = fract(p * 0.3183099 + uSeed); p *= 17.0; return fract(p.x * p.y * (p.x + p.y)); }
      void main(){
        float d = length(vUv - uCenter) / uRadius;
        if (d > 1.0) discard;
        // SOLID core; spatter as droplet BLOBS (coarse cells smoothly
        // thresholded), not per-texel hash — per-texel hash reads as
        // red-white noise on the floor, not as liquid.
        float core = 1.0 - smoothstep(0.45, 0.72, d);
        vec2 cell = (vUv - uCenter) / uRadius * 5.5;
        float blob = h(floor(cell));
        float inBlob = smoothstep(0.55, 0.85, blob) * (1.0 - smoothstep(0.0, 0.45, length(fract(cell) - 0.5)));
        float spatter = inBlob * (1.0 - smoothstep(0.45, 1.0, d));
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
  stampMesh.position.set(0.5, 0.5, 0);   // unit quad over the whole RT; the shader masks
  stampScene.add(stampMesh);
}

/** New floor: set the world→map mapping and wipe the slate. */
export function resetSplatMap(minX: number, minZ: number, sizeX: number, sizeZ: number): void {
  uSplatBounds.value.set(minX, minZ, Math.max(1, sizeX), Math.max(1, sizeZ));
  uSplatOn.value = 1;
  queue.length = 0;
  needsClear = true;
}

/** Queue a splat. x/z world; radius metres; alpha = wetness added. */
export function stampSplat(x: number, z: number, radius: number, colorHex: number, alpha = 0.8): void {
  if (!rt) return;
  const b = uSplatBounds.value;
  const u = (x - b.x) / b.z;
  const v = (z - b.y) / b.w;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  queue.push({ x: u, z: v, r: radius / Math.max(b.z, b.w), color: new THREE.Color(colorHex), a: alpha, seed: Math.random() });
}

/** Drain queued stamps into the map. Called from the render tick. */
export function flushSplats(renderer: THREE.WebGLRenderer): void {
  if (!rt || !stampScene || !stampCam || !stampMat || !stampMesh) return;
  if (!needsClear && queue.length === 0) return;
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(rt);
  if (needsClear) {
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    needsClear = false;
  }
  renderer.autoClear = false;
  for (const s of queue.splice(0)) {
    (stampMat.uniforms.uCenter.value as THREE.Vector2).set(s.x, s.z);
    stampMat.uniforms.uRadius.value = s.r;
    (stampMat.uniforms.uColor.value as THREE.Color).copy(s.color);
    stampMat.uniforms.uAlpha.value = s.a;
    stampMat.uniforms.uSeed.value = s.seed;
    renderer.render(stampScene, stampCam);
  }
  renderer.autoClear = prevAutoClear;
  renderer.setRenderTarget(prevTarget);
}
