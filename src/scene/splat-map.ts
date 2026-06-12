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
let stampSpace: THREE.Group | null = null;   // world-meters → map-UV
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
        // POPPED-BALLOON mask, not a scaled circle: the boundary
        // radius wobbles per angular sector (smoothed hash → organic
        // lobes), streaks grow FINGERS toward the throw while the
        // body stays heavy at the impact end. Droplet blobs spray
        // past the boundary.
        vec2 pl = (vUv - vec2(0.5)) * 2.0;
        float ang = atan(pl.y, pl.x);
        float sect = (ang + 3.14159) * 1.2732;     // ~8 lobes around
        float s0 = h(vec2(floor(sect), 7.0));
        float s1 = h(vec2(floor(sect) + 1.0, 7.0));
        float lobe = mix(s0, s1, smoothstep(0.0, 1.0, fract(sect)));
        float along = pl.x * 0.5 + 0.5;            // streaks: 0 impact → 1 far
        float streakK = clamp(uStreak, 0.0, 1.0) * step(uStreak, 1.5);  // 1 only for floor streaks
        float wobble = mix(0.34, 0.55 + 0.35 * along, streakK);
        vec2 pc = streakK > 0.5 ? pl + vec2(0.45, 0.0) : pl;
        float d = length(pc) * (streakK > 0.5 ? 0.78 : 1.0);
        float edge = (1.0 - wobble * 0.5) + (lobe - 0.5) * wobble;
        float body = 1.0 - smoothstep(edge * 0.58, edge, d);
        vec2 cell = pl * 5.5;
        float blob = h(floor(cell));
        float inBlob = smoothstep(0.55, 0.85, blob) * (1.0 - smoothstep(0.0, 0.45, length(fract(cell) - 0.5)));
        float thin = streakK > 0.5 ? (1.0 - along * 0.45) : 1.0;
        float spatter = inBlob * (1.0 - smoothstep(0.55, 1.15, d)) * thin;
        float a = clamp(max(body, spatter), 0.0, 1.0) * uAlpha;
        // WALL ARC (uStreak=2): a messy splotch with DRIPS — gravity is
        // what makes wall blood read as wall blood. The body sits in
        // the upper half; thin runs of varying length descend from it.
        if (uStreak > 1.5) {
          vec2 pw = pl - vec2(0.0, 0.45);          // body centre upper-half
          float dw = length(pw * vec2(1.0, 1.9));
          float wbody = 1.0 - smoothstep(edge * 0.5, edge * 0.95, dw);
          // splotch satellites around the body
          vec2 wc = pl * vec2(4.5, 3.0) + vec2(0.0, -1.2);
          float wb = h(floor(wc));
          float wsat = smoothstep(0.6, 0.9, wb) * (1.0 - smoothstep(0.0, 0.42, length(fract(wc) - 0.5)))
                     * (1.0 - smoothstep(0.5, 1.0, length(pw)));
          // drips: columns below the body, random presence + length
          float col = floor((pl.x + 1.0) * 4.0);
          float dh = h(vec2(col, 3.0));
          float colX = fract((pl.x + 1.0) * 4.0) - 0.5;
          float inCol = 1.0 - smoothstep(0.10, 0.16, abs(colX));
          float top = 0.30;
          float bot = top - (0.5 + dh * 1.3);
          float inRun = step(pl.y, top) * step(bot, pl.y) * step(0.35, dh);
          float taper = smoothstep(bot, mix(bot, top, 0.35), pl.y);
          float drip = inCol * inRun * taper;
          a = clamp(max(max(wbody, wsat), drip * 0.9), 0.0, 1.0) * uAlpha;
        }
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
  // Stamps live in WORLD METRES inside this group; the group's scale
  // maps metres → map UV. Rotating a streak inside it stays true to
  // world space — rotating at the UV level squashed every angled
  // streak along the floor's shorter axis ('direction feels buggy').
  stampSpace = new THREE.Group();
  stampSpace.add(stampMesh);
  stampScene.add(stampSpace);

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
  queue.push({ x: x - b.x, z: z - b.y, r: radius, color: new THREE.Color(colorHex), a: alpha, seed: Math.random(), dir: d, surface: 'floor' });
}

/** THE GORE EMITTER — pseudo-physics splash from a weapon impact.
 *  The blow lands at (x, z, y) travelling (dirX, dirZ); blood bursts
 *  from that point OUTWARD, biased along the swing: a puddle at the
 *  body, a fingered streak down-throw, droplets beyond — and if the
 *  splash reaches a wall within its energy's range, the wall takes a
 *  dripping splotch scaled by the energy left when it got there.
 *  Every landed hit calls this; energy scales everything (a chip hit
 *  speckles, a heavy drenches, a kill detonates). */
export function emitGoreSplash(
  x: number, z: number, y: number,
  dirX: number, dirZ: number,
  energy: number, colorHex: number,
  opts?: { wallFallbackCardinals?: boolean },
): void {
  const e = Math.max(0, Math.min(1.6, energy));
  if (e < 0.05) return;
  const len = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / len, dz = dirZ / len;
  // Floor: puddle + streak + droplets, all energy-scaled.
  const r = 0.22 + 0.38 * e;
  stampSplat(x, z, r * 0.75, colorHex, 0.35 + 0.4 * e);
  stampSplat(x + dx * r, z + dz * r, r, colorHex, (0.3 + 0.4 * e), { x: dx, z: dz });
  const sats = Math.round(e * 2.2);
  for (let i = 0; i < sats; i++) {
    const t = 1.1 + Math.random() * 1.3;
    const side = (Math.random() - 0.5) * 0.7;
    stampSplat(
      x + (dx * t - dz * side) * r * 1.7,
      z + (dz * t + dx * side) * r * 1.7,
      r * (0.18 + Math.random() * 0.2),
      colorHex, 0.3 + 0.4 * e,
    );
  }
  // Wall: the splash carries ~1m per unit energy; whatever it reaches
  // gets painted, weaker with distance. Normal swings included.
  const reach = 0.6 + e * 0.9;
  // Blood sprays in a CONE, so the wall probe does too: straight down
  // the throw, then ±40° off it. A single ray missed every wall the
  // splash direction ran parallel to — which after the blade-travel
  // change was MOST walls (slashes throw sideways).
  let hit: WallHit | null = null;
  for (const off of [0, 0.7, -0.7]) {
    const c = Math.cos(off), sn = Math.sin(off);
    hit = wallProbe?.(x, z, dx * c - dz * sn, dz * c + dx * sn) ?? null;
    if (hit) break;
  }
  if (!hit && opts?.wallFallbackCardinals) {
    for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      hit = wallProbe?.(x, z, cx, cz) ?? null;
      if (hit) break;
    }
  }
  if (hit) {
    const dWall = Math.abs(hit.axis === 'x' ? hit.plane - x : hit.plane - z);
    if (dWall <= reach) {
      const k = 1 - (dWall / reach) * 0.6;
      stampWallArcAt(hit, y, colorHex, (0.35 + 0.5 * e) * k, (0.3 + 0.55 * e) * k);
    }
  }
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
  let hit = wallProbe(x, z, dirX / len, dirZ / len);
  if (!hit) {
    for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      hit = wallProbe(x, z, cx, cz);
      if (hit) break;
    }
  }
  if (!hit) return;
  stampWallArcAt(hit, y, colorHex, alpha, size);
}

function stampWallArcAt(hit: WallHit, y: number, colorHex: number, alpha: number, size: number): void {
  if (!rt) return;
  const b = uSplatBounds.value;
  // Mirror of the wall-shader mapping (surface-detail.ts): X-facing
  // walls key by Z in the left half; Z-facing by X in the right.
  const along = hit.axis === 'x' ? (hit.along - b.y) / b.w : (hit.along - b.x) / b.z;
  const pc = hit.axis === 'x' ? (hit.plane - b.x) / b.z : (hit.plane - b.y) / b.w;
  if (along < 0 || along > 1) return;
  const u = hit.axis === 'x' ? along * 0.5 : 0.5 + along * 0.5;
  const v = Math.max(0, Math.min(1, (y + size * 0.35) / WALL_HEIGHT_M));
  const c = new THREE.Color(colorHex);
  queue.push({
    x: u, z: v,
    r: size,
    color: new THREE.Color(c.r, c.g, pc),   // B carries the plane coordinate
    a: alpha,
    seed: Math.random(),
    dir: null,
    surface: 'wall',
    rot: (Math.random() - 0.5) * 0.22,
    scaleX: (size * 2.0) / (hit.axis === 'x' ? b.w : b.z) * 0.5,
    scaleY: (size * 2.2) / WALL_HEIGHT_M,
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
  // Puddle AT the mob; the streak's heavy end sits on it and the
  // fingers reach outward along the throw.
  stampSplat(x, z, radius * 0.7, colorHex, alpha);
  stampSplat(x + dx * radius * 0.9, z + dz * radius * 0.9, radius, colorHex, alpha * 0.9, { x: dx, z: dz });
  const sats = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < sats; i++) {
    const t = 1.1 + Math.random() * 1.2;
    const side = (Math.random() - 0.5) * 0.6;
    stampSplat(
      x + (dx * t - dz * side) * radius * 1.6,
      z + (dz * t + dx * side) * radius * 1.6,
      radius * (0.2 + Math.random() * 0.22),
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
    const bb = uSplatBounds.value;
    if (s.surface === 'wall') {
      // Wall stamps address the arc map directly in UV.
      stampSpace!.scale.set(1, 1, 1);
      stampMesh.position.set(s.x, s.z, 0);
      stampMesh.rotation.z = s.rot ?? 0;
      stampMesh.scale.set(s.scaleX ?? 0.05, s.scaleY ?? 0.05, 1);
      stampMat.uniforms.uStreak.value = 2;   // wall mode: splotch + drips
    } else {
      // Floor stamps: world metres inside the aniso group.
      stampSpace!.scale.set(1 / bb.z, 1 / bb.w, 1);
      stampMesh.position.set(s.x, s.z, 0);
      if (s.dir) {
        stampMesh.rotation.z = Math.atan2(s.dir.z, s.dir.x);
        stampMesh.scale.set(s.r * 2 * 2.1, s.r * 2 * 0.75, 1);
        stampMat.uniforms.uStreak.value = 1;
      } else {
        stampMesh.rotation.z = 0;
        stampMesh.scale.set(s.r * 2, s.r * 2, 1);
        stampMat.uniforms.uStreak.value = 0;
      }
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
