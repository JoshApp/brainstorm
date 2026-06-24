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
export function bakeSurfaceTexture(renderer: THREE.WebGLRenderer, kind: SurfaceKind): THREE.DataTexture {
  // WEBGPU SPIKE: the bake is a GLSL ShaderMaterial rendered + read back via
  // readRenderTargetPixels — WebGL-only, and it runs at module-boot, so it would
  // throw/hang the whole boot under WebGPU. Return a neutral 1×1 texture (white
  // albedo multiplier, full height) so surfaces render FLAT and boot proceeds.
  // Porting the bake to a TSL/compute path is Phase 2 (see WEBGPU-MIGRATION.md).
  if (isWebGPU()) {
    const flat = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    flat.needsUpdate = true;
    return flat;
  }
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
