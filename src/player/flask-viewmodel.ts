import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { ESTUS_FLASK } from '../content/loot-models';
import { registerViewmodel, unregisterViewmodel, applyViewmodelDepthWebGPU } from '../style/render-frame';
import { registerWarmup } from '../content/warmup-registry';
import { isDrinkingFlask, getDrinkProgress, hasSipLanded } from './flask-drink';
import { getFlask } from '../player/flask';
import { getOffhandOffset } from './viewmodel-bob';

// The drink VIEWMODEL — the Elden Ring beat, first person: the off hand raises
// the golden flask from below the frame, tips it at the sip, and lowers it.
// Pure presentation: it samples flask-drink.ts (the sim channel) every frame
// and never advances game state itself.
//
// GOLD IS THE POINT. The flask is liquid light (emissive amber + an additive
// glow sprite), and at the sip the light SWELLS — the one warm moment the
// dungeon allows. The glow is a billboard sprite, not a PointLight: it never
// touches the light pool / slot budget.
//
// Built ONCE and kept (shared geometry, no per-drink allocation — the GPU-leak
// rule); hidden between drinks. On a cancel the flask drops out of frame fast
// rather than replaying the lower half of the pose curve.

// Pose stations, camera-local. The flask lives just out of frame bottom-left
// (mirroring the offhand side) and rises toward the mouth — center-low, close.
const HIDDEN_POS = new THREE.Vector3(-0.22, -0.46, -0.42);
const RAISED_POS = new THREE.Vector3(-0.06, -0.155, -0.30);
const HIDDEN_ROT_X = -0.35;   // resting, slightly away
const DRINK_TILT_X = 0.95;    // tipped toward the mouth at full sip
const RAISE_END = 0.30;       // progress fraction spent raising
const LOWER_START = 0.80;     // progress fraction where the lower begins
const CANCEL_OUT_S = 0.14;    // seconds to drop out of frame on cancel

let group: THREE.Group | null = null;
let elixirMat: THREE.MeshStandardMaterial | null = null;
let elixirMesh: THREE.Object3D | null = null;
let glow: THREE.Sprite | null = null;
let glowBaseOpacity = 0;
let shown = 0;          // 0 hidden → 1 posed; springs toward the drink state
let sipFlash = 0;       // decaying pulse kicked when the sip lands
let sawSip = false;
// The LIGHT inside the bulb — eased toward charges/capacity, so the swallow
// visibly drains it (the charge is spent at the sip; this chases it).
let displayFill = 1;
const ELIXIR_Y = 0.066;   // the elixir part's authored centre (loot-models.ts)

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Soft radial gold falloff — the glow sprite's texture, generated once. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 196, 90, 0.9)');
  grad.addColorStop(0.4, 'rgba(255, 160, 50, 0.35)');
  grad.addColorStop(1, 'rgba(255, 140, 30, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build the flask + glow with the viewmodel material treatment (depth-test
 *  off, high renderOrder — same trick as sword/lamp/offhand so it never clips
 *  into walls). Shared by the live attach and the warmup hook. */
function buildFlaskGroup(): { group: THREE.Group; elixir: THREE.MeshStandardMaterial; elixirMesh: THREE.Object3D | null; glow: THREE.Sprite } {
  const built = buildModel(ESTUS_FLASK);
  const g = built.group;
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = true;
      m.needsUpdate = true;
      applyViewmodelDepthWebGPU(m);
    }
    mesh.renderOrder = 998;   // just under the sword (999), same as the lamp
  });
  const elixir = built.materials.get('elixir') as THREE.MeshStandardMaterial;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xffc860,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
  }));
  sprite.scale.setScalar(0.26);
  sprite.position.set(0, 0.07, 0);   // centered on the bulb
  sprite.renderOrder = 998;
  g.add(sprite);
  return { group: g, elixir, elixirMesh: built.parts.get('elixir') ?? null, glow: sprite };
}

function ensureBuilt(camera: THREE.Camera): void {
  if (group) return;
  const built = buildFlaskGroup();
  group = built.group;
  elixirMat = built.elixir;
  elixirMesh = built.elixirMesh;
  glow = built.glow;
  group.visible = false;
  const f = getFlask();
  displayFill = f.capacity > 0 ? f.charges / f.capacity : 0;
  camera.add(group);
  registerViewmodel(group);   // near-depth pass (see render-target.ts)
}

/** Per-frame (PRESENT pass, real dt). Samples the drink channel and poses the
 *  flask; free (one visibility check) while not drinking. */
export function tickFlaskViewmodel(camera: THREE.Camera, dt: number): void {
  const drinking = isDrinkingFlask();
  if (!group && !drinking) return;
  ensureBuilt(camera);
  if (!group || !elixirMat || !glow) return;

  // Shown springs up fast on start, drops faster on cancel/finish.
  const target = drinking ? 1 : 0;
  const rate = drinking ? dt / 0.10 : dt / CANCEL_OUT_S;
  shown += Math.sign(target - shown) * Math.min(rate, Math.abs(target - shown));
  if (shown <= 0.001 && !drinking) {
    if (group.visible) group.visible = false;
    sawSip = false;
    sipFlash = Math.max(0, sipFlash - dt * 6);
    return;
  }
  group.visible = true;

  const p = getDrinkProgress();
  // Pose from progress: raise (0→RAISE_END), tip through the sip, lower after
  // LOWER_START. The lower half also rides `shown`, so a cancel exits by
  // dropping the whole pose instead of replaying the curve.
  const raise = smoothstep(0, RAISE_END, p);
  const lower = drinking ? 1 - smoothstep(LOWER_START, 1, p) : 1;
  const lift = raise * lower * shown;

  const pos = new THREE.Vector3().lerpVectors(HIDDEN_POS, RAISED_POS, lift);
  const b = getOffhandOffset();   // breathe with the stride like the offhand
  group.position.set(pos.x + b.x * 0.5, pos.y + b.y * 0.5, pos.z);

  // Tilt toward the mouth across the drink window, held through the sip.
  const tip = smoothstep(RAISE_END, CONFIG.FLASK.SIP_AT, p);
  group.rotation.set(HIDDEN_ROT_X + (DRINK_TILT_X - HIDDEN_ROT_X) * tip * lift, 0.25 * lift, -0.12 * lift);

  // The light inside: eased toward charges/capacity, so the swallow visibly
  // DRAINS it — the orb of light shrinks toward the bulb's bottom and dims,
  // gone entirely on the last charge. It flares once at the sip, then what
  // remains settles smaller.
  if (drinking && !sawSip && hasSipLanded()) { sawSip = true; sipFlash = 1; }
  sipFlash = Math.max(0, sipFlash - dt * 3.2);
  const f = getFlask();
  const targetFill = f.capacity > 0 ? f.charges / f.capacity : 0;
  displayFill += (targetFill - displayFill) * Math.min(1, dt / 0.45);
  if (Math.abs(targetFill - displayFill) < 0.005) displayFill = targetFill;
  if (elixirMesh) {
    const s = 0.3 + 0.7 * displayFill;   // never a point — a low flask is a small ember
    elixirMesh.scale.setScalar(s);
    elixirMesh.position.y = ELIXIR_Y - (1 - s) * 0.028;   // the light settles as it drains
    elixirMesh.visible = displayFill > 0.02;              // spent flask = dark glass
  }
  elixirMat.emissiveIntensity = 0.6 + displayFill * 1.9 + sipFlash * 3.0;
  glowBaseOpacity = 0.25 * lift * (0.25 + 0.75 * displayFill);
  (glow.material as THREE.SpriteMaterial).opacity = Math.min(1, glowBaseOpacity + sipFlash * 0.7);
  glow.scale.setScalar(0.26 + sipFlash * 0.14);
}

/** Detach + dispose (level teardown safety; normally the flask lives for the
 *  session). Idempotent. */
export function disposeFlaskViewmodel(): void {
  if (!group) return;
  unregisterViewmodel(group);
  group.parent?.remove(group);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Sprite).isSprite) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose();
      mesh.geometry?.dispose();
    }
  });
  group = null; elixirMat = null; elixirMesh = null; glow = null; shown = 0;
}

// Warmup — the flask's viewmodel materials (depth-test-off transparent
// standard + additive sprite) must compile before the first mid-combat drink,
// or that drink pays a shader-compile hitch (the documented failure mode).
let warmKept: { group: THREE.Group } | null = null;
registerWarmup({
  label: 'flask-viewmodel',
  tier: 'deferred',
  live: true,
  spawn(scene) {
    const built = buildFlaskGroup();
    (built.glow.material as THREE.SpriteMaterial).opacity = 0.2;   // warm the visible-glow variant
    warmKept = { group: built.group };
    scene.add(built.group);
  },
  clear() {
    if (!warmKept) return;
    warmKept.group.parent?.remove(warmKept.group);
    // Materials are retained by the warmup stream; drop only our reference.
    warmKept = null;
  },
});
