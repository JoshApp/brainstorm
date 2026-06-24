import * as THREE from 'three';
import { isWebGPU } from '../scene/renderer-mode';

// Baked, MIPMAPPED tiling stone textures for the big surfaces. The patterns used
// to be evaluated procedurally per-pixel in the surface material — which aliased
// badly: the scene renders at 0.4x resolution (see render-target.ts), so thin
// mortar lines were undersampled and CRAWLED under motion, and the relief's
// screen-space derivative buzzed. Baking the same patterns to tiling textures
// lets the GPU's mipmap + anisotropic filtering resolve them per-pixel — the
// textbook fix for that crawl — and the relief reads off a (mip-filtered, hence
// stable) height channel instead of a hard per-pixel function.
//
// One RGBA texture per surface: RGB = albedo shade (a grayscale multiplier the
// material's base colour tints), A = surface height (1 = proud block face,
// low = recessed seam / gap), used for the normal relief at runtime.
//
// WALLS = brick running-bond. FLOOR = irregular Voronoi flagstones (uneven
// slabs, ~7% missing). CEILING = coffered panels (raised beam grid, recessed
// panels) — its own architectural language, distinct from the floor.

export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'dressed' | 'grain';

// World-space repeat period (metres) of each baked texture. Chosen so the
// pattern tiles seamlessly: walls = 4 bricks x 8 courses, floor = 5x5 flagstone
// cells, ceiling = 3x3 coffer panels, dressed = 3x4 ashlar blocks, grain = fine.
export const SURFACE_TILE: Record<SurfaceKind, [number, number]> = {
  wall: [4.6, 4.8],
  floor: [5.25, 5.25],
  ceiling: [4.8, 4.8],
  dressed: [4.8, 3.2],
  grain: [1.5, 1.5],
};

const TEX = 512;

const BAKE_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BAKE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform int uMode;       // 0 wall brick, 1 floor flagstone, 2 ceiling coffer
uniform vec2 uTile;      // metres

float dHash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec2 dHash2(vec2 p){ return vec2(dHash(vec3(p,0.13)), dHash(vec3(p,4.71))); }

// Periodic Voronoi (period P cells) — two pass (nearest point, true edge dist).
// Neighbour cell ids wrap mod P so the field tiles seamlessly.
vec3 voroP(vec2 x, float P){
  vec2 ip=floor(x), fp=fract(x);
  vec2 mr=vec2(0.0), mg=vec2(0.0); float md=9.0;
  for(int j=-1;j<=1;j++){ for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=0.5+0.42*(dHash2(mod(ip+g,P))*2.0-1.0);
    vec2 r=g+o-fp; float d=dot(r,r);
    if(d<md){ md=d; mr=r; mg=ip+g; }
  }}
  float ed=9.0;
  for(int j=-1;j<=1;j++){ for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=0.5+0.42*(dHash2(mod(ip+g,P))*2.0-1.0);
    vec2 r=g+o-fp; vec2 diff=r-mr;
    if(dot(diff,diff)>1e-5) ed=min(ed, dot(0.5*(mr+r), normalize(diff)));
  }}
  return vec3(ed, mod(mg,P));
}

void brick(vec2 p, float aa, out float shade, out float height){
  vec2 bsz=vec2(1.15,0.6);
  vec2 g=p/bsz; float row=floor(g.y);
  g.x += 0.5*mod(row,2.0);
  vec2 cell=vec2(floor(g.x),row);
  vec2 id=vec2(mod(cell.x,4.0),mod(cell.y,8.0));
  vec2 inb=fract(g);
  float dH=min(inb.y,1.0-inb.y)*bsz.y;
  float dV=min(inb.x,1.0-inb.x)*bsz.x;
  float vKeep=step(0.18, dHash(vec3(mod(floor(g.x+0.5),4.0), id.y, 9.1)));
  float dseam=min(dH, vKeep>0.5 ? dV : 1e3);
  float seamVar=mix(0.4,1.0, dHash(vec3(id,2.3)));
  float mortar=(1.0-smoothstep(0.03-aa,0.03+aa,dseam))*seamVar;
  float crackable=step(0.92, dHash(vec3(id,5.5)));
  float cpos=mix(0.3,0.7, dHash(vec3(id,7.7)));
  float crack=crackable*(1.0-smoothstep(0.0,0.012+aa,abs(inb.x-cpos)));
  float recess=max(mortar, crack*0.85);
  float bt=dHash(vec3(id,3.7));
  float tone=mix(0.86,1.0,bt);
  shade=mix(tone,0.5,recess);
  height=mix(1.0,0.4,recess);
}

void flag(vec2 p, float aa, out float shade, out float height){
  float FLAG=1.05;
  vec3 vo=voroP(p/FLAG, 5.0);
  float edM=vo.x*FLAG;
  float bt=dHash(vec3(vo.yz,1.3));
  float missing=step(0.93, dHash(vec3(vo.yz,8.1)));
  float seam=1.0-smoothstep(0.03-aa,0.03+aa,edM);
  float recess=max(seam,missing);
  float tone=mix(0.78,1.0,bt);
  shade=mix(tone,0.5,recess)*mix(1.0,0.45,missing);
  height=mix(1.0,0.35,recess);
}

void coffer(vec2 p, float aa, out float shade, out float height){
  float PAN=1.6;
  vec2 g=p/PAN; vec2 cell=floor(g); vec2 id=mod(cell,3.0);
  vec2 inb=fract(g);
  float dB=min(min(inb.x,1.0-inb.x),min(inb.y,1.0-inb.y))*PAN;  // dist to beam
  float BEAM=0.16;
  float beam=1.0-smoothstep(BEAM-aa,BEAM+aa,dB);                 // 1 on beam grid
  float bt=dHash(vec3(id,4.2));
  float tone=mix(0.8,1.0,bt);
  shade=mix(tone*0.78, tone, beam);   // recessed panels darker than the beams
  height=mix(0.45,1.0,beam);          // beams proud, panels sunk
}

// DRESSED ASHLAR — large, evenly-cut blocks with thin CLEAN joints. Smoother and
// quieter than the rough wall brick: this is the "finished" stone that frames a
// passage (archways, doorframes, lintels), contrasting the rough masonry walls.
void dressed(vec2 p, float aa, out float shade, out float height){
  vec2 bsz=vec2(1.6,0.8);
  vec2 g=p/bsz; float row=floor(g.y);
  g.x += 0.5*mod(row,2.0);
  vec2 cell=vec2(floor(g.x),row);
  vec2 id=vec2(mod(cell.x,3.0),mod(cell.y,4.0));
  vec2 inb=fract(g);
  float dseam=min(min(inb.y,1.0-inb.y)*bsz.y, min(inb.x,1.0-inb.x)*bsz.x);
  float joint=1.0-smoothstep(0.018-aa,0.018+aa,dseam);
  float bt=dHash(vec3(id,3.1));
  float tone=mix(0.92,1.0,bt);        // dressed stone is even-toned
  shade=mix(tone,0.62,joint);
  height=mix(1.0,0.65,joint);         // shallow, clean joint
}

// Periodic value noise (vec2 period) — tileable, supports anisotropic frequency.
float vnoiseP(vec2 x, vec2 P){
  vec2 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  float a=dHash(vec3(mod(i,P),0.7));
  float b=dHash(vec3(mod(i+vec2(1.,0.),P),0.7));
  float c=dHash(vec3(mod(i+vec2(0.,1.),P),0.7));
  float d=dHash(vec3(mod(i+vec2(1.,1.),P),0.7));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
// STONE GRAIN — VERTICAL streaks: high frequency AROUND the shaft (U), low along
// it (V). A planar projection on a vertical column then shows vertical grain,
// never horizontal banding. Lets columns catch torchlight without joints/blocks.
void grain(vec2 uv, out float shade, out float height){
  vec2 P1=vec2(16.,2.), P2=vec2(32.,4.);
  float n = vnoiseP(uv*P1,P1)*0.7 + vnoiseP(uv*P2,P2)*0.3;
  shade = mix(0.92,1.05,n);
  height = mix(0.48,0.52,n);          // near-flat
}

void main(){
  vec2 p = vUv * uTile;
  float aa = (uTile.x / float(${TEX})) * 0.7;
  float shade=1.0, height=1.0;
  if (uMode==0) brick(p,aa,shade,height);
  else if (uMode==1) flag(p,aa,shade,height);
  else if (uMode==2) coffer(p,aa,shade,height);
  else if (uMode==3) dressed(p,aa,shade,height);
  else grain(vUv,shade,height);
  gl_FragColor = vec4(vec3(shade), height);
}
`;

let _quadScene: THREE.Scene | null = null;
let _quadCam: THREE.OrthographicCamera | null = null;
let _quadMat: THREE.ShaderMaterial | null = null;

function ensureQuad(): { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial } {
  if (!_quadScene) {
    _quadMat = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: { uMode: { value: 0 }, uTile: { value: new THREE.Vector2(1, 1) } },
      depthTest: false,
      depthWrite: false,
    });
    _quadScene = new THREE.Scene();
    _quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _quadMat));
    _quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  return { scene: _quadScene!, cam: _quadCam!, mat: _quadMat! };
}

// Bake one surface pattern to a mipmapped, anisotropic, repeating DataTexture.
// One-time at material build. Reads back from a render target (a few hundred KB,
// ~1ms) so the data lands in a DataTexture, whose mipmaps three generates
// reliably (RT mipmap regeneration is fiddly by comparison).
// ── CPU bake (WebGPU path) ───────────────────────────────────────────────────
// A faithful JS port of the GLSL patterns above (brick/flag/coffer/dressed/
// grain). Runs once at load into a DataTexture — no GL, no readback. Kept in
// lockstep with BAKE_FRAG; if you change a pattern there, mirror it here.
const CPU_TEX = 512;   // match the GLSL bake's 512 (256 was visibly blurry on walls)
const fract = (x: number) => x - Math.floor(x);
const modf = (x: number, y: number) => x - y * Math.floor(x / y);
const mixf = (a: number, b: number, t: number) => a + (b - a) * t;
const stepf = (e: number, x: number) => (x < e ? 0 : 1);
const clampf = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number) => { const t = clampf((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function dHash(x: number, y: number, z: number): number {
  let px = fract(x * 0.3183099 + 0.1), py = fract(y * 0.3183099 + 0.1), pz = fract(z * 0.3183099 + 0.1);
  px *= 17; py *= 17; pz *= 17;
  return fract(px * py * pz * (px + py + pz));
}
function brickCPU(px: number, py: number, aa: number): [number, number] {
  const bx = 1.15, by = 0.6;
  let gx = px / bx; const gy = py / by; const row = Math.floor(gy);
  gx += 0.5 * modf(row, 2);
  const idx = modf(Math.floor(gx), 4), idy = modf(row, 8);
  const inbx = fract(gx), inby = fract(gy);
  const dH = Math.min(inby, 1 - inby) * by, dV = Math.min(inbx, 1 - inbx) * bx;
  const vKeep = stepf(0.18, dHash(modf(Math.floor(gx + 0.5), 4), idy, 9.1));
  const dseam = Math.min(dH, vKeep > 0.5 ? dV : 1e3);
  const seamVar = mixf(0.4, 1.0, dHash(idx, idy, 2.3));
  const mortar = (1 - smooth(0.03 - aa, 0.03 + aa, dseam)) * seamVar;
  const crackable = stepf(0.92, dHash(idx, idy, 5.5));
  const cpos = mixf(0.3, 0.7, dHash(idx, idy, 7.7));
  const crack = crackable * (1 - smooth(0, 0.012 + aa, Math.abs(inbx - cpos)));
  const recess = Math.max(mortar, crack * 0.85);
  const tone = mixf(0.86, 1.0, dHash(idx, idy, 3.7));
  return [mixf(tone, 0.5, recess), mixf(1.0, 0.4, recess)];
}
function cofferCPU(px: number, py: number, aa: number): [number, number] {
  const PAN = 1.6; const gx = px / PAN, gy = py / PAN;
  const idx = modf(Math.floor(gx), 3), idy = modf(Math.floor(gy), 3);
  const inbx = fract(gx), inby = fract(gy);
  const dB = Math.min(Math.min(inbx, 1 - inbx), Math.min(inby, 1 - inby)) * PAN;
  const beam = 1 - smooth(0.16 - aa, 0.16 + aa, dB);
  const tone = mixf(0.8, 1.0, dHash(idx, idy, 4.2));
  return [mixf(tone * 0.78, tone, beam), mixf(0.45, 1.0, beam)];
}
function dressedCPU(px: number, py: number, aa: number): [number, number] {
  const bx = 1.6, by = 0.8; let gx = px / bx; const gy = py / by; const row = Math.floor(gy);
  gx += 0.5 * modf(row, 2);
  const idx = modf(Math.floor(gx), 3), idy = modf(row, 4);
  const inbx = fract(gx), inby = fract(gy);
  const dseam = Math.min(Math.min(inby, 1 - inby) * by, Math.min(inbx, 1 - inbx) * bx);
  const joint = 1 - smooth(0.018 - aa, 0.018 + aa, dseam);
  const tone = mixf(0.92, 1.0, dHash(idx, idy, 3.1));
  return [mixf(tone, 0.62, joint), mixf(1.0, 0.65, joint)];
}
function vnoiseP(x: number, y: number, Px: number, Py: number): number {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = fract(x), fy = fract(y);
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = dHash(modf(ix, Px), modf(iy, Py), 0.7), b = dHash(modf(ix + 1, Px), modf(iy, Py), 0.7);
  const c = dHash(modf(ix, Px), modf(iy + 1, Py), 0.7), d = dHash(modf(ix + 1, Px), modf(iy + 1, Py), 0.7);
  return mixf(mixf(a, b, fx), mixf(c, d, fx), fy);
}
function grainCPU(u: number, v: number): [number, number] {
  const n = vnoiseP(u * 16, v * 2, 16, 2) * 0.7 + vnoiseP(u * 32, v * 4, 32, 4) * 0.3;
  return [mixf(0.92, 1.05, n), mixf(0.48, 0.52, n)];
}
function flagCPU(px: number, py: number, aa: number): [number, number] {
  // Periodic Voronoi (period 5), faithful 2-pass: nearest point then edge dist.
  const FLAG = 1.05, P = 5; const x = px / FLAG, y = py / FLAG;
  const ipx = Math.floor(x), ipy = Math.floor(y), fpx = fract(x), fpy = fract(y);
  let mrx = 0, mry = 0, mgx = 0, mgy = 0, md = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = modf(ipx + i, P), cy = modf(ipy + j, P);
    const ox = 0.5 + 0.42 * (dHash(cx, cy, 0.13) * 2 - 1), oy = 0.5 + 0.42 * (dHash(cx, cy, 4.71) * 2 - 1);
    const rx = i + ox - fpx, ry = j + oy - fpy; const dd = rx * rx + ry * ry;
    if (dd < md) { md = dd; mrx = rx; mry = ry; mgx = ipx + i; mgy = ipy + j; }
  }
  let ed = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = modf(ipx + i, P), cy = modf(ipy + j, P);
    const ox = 0.5 + 0.42 * (dHash(cx, cy, 0.13) * 2 - 1), oy = 0.5 + 0.42 * (dHash(cx, cy, 4.71) * 2 - 1);
    const rx = i + ox - fpx, ry = j + oy - fpy; const dx = rx - mrx, dy = ry - mry;
    const dl = dx * dx + dy * dy;
    if (dl > 1e-5) { const nl = Math.sqrt(dl); ed = Math.min(ed, 0.5 * (mrx + rx) * (dx / nl) + 0.5 * (mry + ry) * (dy / nl)); }
  }
  const gx = modf(mgx, P), gy = modf(mgy, P);
  const edM = ed * FLAG;
  const bt = dHash(gx, gy, 1.3), missing = stepf(0.93, dHash(gx, gy, 8.1));
  const seam = 1 - smooth(0.03 - aa, 0.03 + aa, edM);
  const recess = Math.max(seam, missing);
  const tone = mixf(0.78, 1.0, bt);
  return [mixf(tone, 0.5, recess) * mixf(1.0, 0.45, missing), mixf(1.0, 0.35, recess)];
}
function bakeSurfaceCPU(kind: SurfaceKind): THREE.DataTexture {
  const tile = SURFACE_TILE[kind];
  const aa = (tile[0] / CPU_TEX) * 0.7;
  const buf = new Uint8Array(CPU_TEX * CPU_TEX * 4);
  for (let yi = 0; yi < CPU_TEX; yi++) {
    for (let xi = 0; xi < CPU_TEX; xi++) {
      const u = (xi + 0.5) / CPU_TEX, v = (yi + 0.5) / CPU_TEX;
      const px = u * tile[0], py = v * tile[1];
      let shade = 1, height = 1;
      if (kind === 'wall') [shade, height] = brickCPU(px, py, aa);
      else if (kind === 'floor') [shade, height] = flagCPU(px, py, aa);
      else if (kind === 'ceiling') [shade, height] = cofferCPU(px, py, aa);
      else if (kind === 'dressed') [shade, height] = dressedCPU(px, py, aa);
      else [shade, height] = grainCPU(u, v);
      const o = (yi * CPU_TEX + xi) * 4;
      const s = clampf(shade, 0, 1) * 255;
      buf[o] = buf[o + 1] = buf[o + 2] = s; buf[o + 3] = clampf(height, 0, 1) * 255;
    }
  }
  const tex = new THREE.DataTexture(buf, CPU_TEX, CPU_TEX, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // ANISOTROPY — walls are seen at grazing angles, where isotropic mip filtering
  // collapses to a blur. The GLSL bake used max anisotropy; match it (clamped to
  // the hardware max). This is the single biggest "blurry wall" fix.
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

export function bakeSurfaceTexture(renderer: THREE.WebGLRenderer, kind: SurfaceKind): THREE.DataTexture {
  // WEBGPU: the GLSL bake (ShaderMaterial + readRenderTargetPixels) is WebGL-only
  // and runs at module-boot, so it can't run here. Generate the SAME patterns on
  // the CPU instead (bakeSurfaceCPU) — faithful, one-time, no GL/readback. Also
  // the future direction for both backends (removes the readback hack).
  if (isWebGPU()) return bakeSurfaceCPU(kind);
  const tile = SURFACE_TILE[kind];
  const mode = kind === 'wall' ? 0 : kind === 'floor' ? 1 : kind === 'ceiling' ? 2 : kind === 'dressed' ? 3 : 4;
  const { scene, cam, mat } = ensureQuad();
  mat.uniforms.uMode.value = mode;
  mat.uniforms.uTile.value.set(tile[0], tile[1]);

  const rt = new THREE.WebGLRenderTarget(TEX, TEX, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const buf = new Uint8Array(TEX * TEX * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, TEX, TEX, buf);
  renderer.setRenderTarget(prevRT);
  rt.dispose();

  const tex = new THREE.DataTexture(buf, TEX, TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.LinearSRGBColorSpace;   // detail/height data, not sRGB colour
  tex.needsUpdate = true;
  return tex;
}
