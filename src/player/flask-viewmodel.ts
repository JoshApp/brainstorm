import * as THREE from 'three';
import { CONFIG } from '../config';
import { composeFlaskHold } from './flask-hold';
import { mergeRigidViewmodel } from './viewmodel-merge';
import { registerViewmodel, unregisterViewmodel, applyViewmodelDepthWebGPU } from '../style/render-frame';
import { registerWarmup } from '../content/warmup-registry';
import { isDrinkingFlask, getDrinkProgress, hasSipLanded } from './flask-drink';
import { getFlask } from '../player/flask';
import { getOffhandOffset } from './viewmodel-bob';

// The drink VIEWMODEL — the Souls beat, first person, in the RIGHT hand:
// the weapon stows out of frame (viewmodel.ts's drink-stow layer), this
// hand rises from the bottom-right CUPPING the golden flask, tips it at
// the sip, and lowers it. The right arm follows for real — viewmodel.ts
// retargets its arm IK onto this hand's wrist while the drink runs.
// Pure presentation: it samples flask-drink.ts (the sim channel) every
// frame and never advances game state itself.
//
// GOLD IS THE POINT. The flask is liquid light behind real alpha glass
// (emissive elixir + an additive glow sprite), and at the sip the light
// SWELLS — the one warm moment the dungeon allows. The glow is a billboard
// sprite, not a PointLight: it never touches the light pool / slot budget.
//
// Built ONCE and kept (shared geometry, no per-drink allocation — the
// GPU-leak rule); hidden between drinks. On a cancel the whole rig drops
// out of frame fast rather than replaying the lower half of the pose curve.

// Pose stations, camera-local, positioning the composition root (≈ the
// wrist). The rig waits just out of frame bottom-right — the weapon's side,
// because it IS that hand — and rises toward the mouth: center-low, close.
const HIDDEN_POS = new THREE.Vector3(0.26, -0.60, -0.38);
const RAISED_POS = new THREE.Vector3(0.05, -0.19, -0.30);
// Base orientation: the same idle the sword hand keeps, so the rig rises
// reading as THE hand, not a prop. Tip = added pitch toward the mouth.
const DRINK_TILT_X = 1.05;    // wrist pitch-back at full sip — neck to the lips
const DRINK_TURN_Y = 0.30;    // slight inward turn so the pour reads angled
const RAISE_END = 0.30;       // progress fraction spent raising
const LOWER_START = 0.80;     // progress fraction where the lower begins
const CANCEL_OUT_S = 0.14;    // seconds to drop out of frame on cancel
const SIP_WOBBLE = 0.018;     // radians of hand tremble while swallowing

let group: THREE.Group | null = null;
let wristSlot: THREE.Object3D | null = null;
let elixirMat: THREE.MeshStandardMaterial | null = null;
let elixirMesh: THREE.Object3D | null = null;
let glow: THREE.Sprite | null = null;
let glowBaseOpacity = 0;
let shown = 0;          // 0 hidden → 1 posed; springs toward the drink state
let sipFlash = 0;       // decaying pulse kicked when the sip lands
let sawSip = false;
let wobblePhase = 0;
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

/** Build the hand-cupping-flask rig with the viewmodel material treatment.
 *  Normal depth throughout (the WebGPU path): fingers occlude the bulb they
 *  wrap, the elixir shows through the alpha glass, no ordering tricks.
 *  Shared by the live attach and the warmup hook. */
function buildFlaskGroup(): {
  group: THREE.Group;
  wrist: THREE.Object3D | null;
  elixir: THREE.MeshStandardMaterial;
  elixirMesh: THREE.Object3D | null;
  glow: THREE.Sprite;
} {
  const composed = composeFlaskHold();
  // The hand is rigid during the drink (the whole rig is posed as one), so
  // collapse its ~88 bone meshes — same always-on win as the weapon hand.
  mergeRigidViewmodel(composed.hand.group, null);
  composed.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.depthWrite = true;
      m.needsUpdate = true;
      applyViewmodelDepthWebGPU(m);   // opaque parts self-occlude; alpha glass is left translucent
    }
    mesh.renderOrder = 998;   // just under the sword (999), same as the lamp
  });
  const elixir = composed.weapon!.materials.get('elixir') as THREE.MeshStandardMaterial;

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
  sprite.renderOrder = 1000;
  composed.weapon!.group.add(sprite);
  return {
    group: composed.group,
    wrist: composed.hand.slots.get('wrist') ?? null,
    elixir,
    elixirMesh: composed.weapon!.parts.get('elixir') ?? null,
    glow: sprite,
  };
}

function ensureBuilt(camera: THREE.Camera): void {
  if (group) return;
  const built = buildFlaskGroup();
  group = built.group;
  wristSlot = built.wrist;
  elixirMat = built.elixir;
  elixirMesh = built.elixirMesh;
  glow = built.glow;
  group.visible = false;
  const f = getFlask();
  displayFill = f.capacity > 0 ? f.charges / f.capacity : 0;
  camera.add(group);
  registerViewmodel(group);   // WebGPU depth conventions (see render-frame.ts)
}

/** World position of the flask hand's wrist while the rig is up — the
 *  weapon viewmodel retargets its right-arm IK here during a drink, so
 *  the one right arm follows the flask to the mouth. Null when hidden. */
export function getFlaskWristWorld(out: THREE.Vector3): THREE.Vector3 | null {
  if (!group || !wristSlot || !group.visible) return null;
  return wristSlot.getWorldPosition(out);
}

/** Per-frame (PRESENT pass, real dt). Samples the drink channel and poses the
 *  rig; free (one visibility check) while not drinking. */
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

  // Tilt toward the mouth across the drink window, held through the sip —
  // the whole hand pitches back at the wrist, like a real swig. A faint
  // tremble rides the held tip (drinking mid-fight is not a calm act).
  const tip = smoothstep(RAISE_END, CONFIG.FLASK.SIP_AT, p) * lift;
  wobblePhase += dt * 34;
  const wobble = Math.sin(wobblePhase) * SIP_WOBBLE * tip * (drinking ? 1 : 0);
  const [brx, bry, brz] = CONFIG.SWORD_IDLE_ROT;
  group.rotation.set(
    brx + DRINK_TILT_X * tip + wobble,
    bry + DRINK_TURN_Y * tip,
    brz - 0.10 * lift + wobble * 0.5,
  );

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
  group = null; wristSlot = null; elixirMat = null; elixirMesh = null; glow = null; shown = 0;
}

// Warmup — the rig's material variants (merged hand bone, alpha glass,
// emissive elixir, additive sprite) must compile before the first mid-combat
// drink, or that drink pays a shader-compile hitch (the documented failure
// mode).
let warmKept: { group: THREE.Group } | null = null;
registerWarmup({
  label: 'flask-viewmodel',
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
    // Materials are retained by the warmup pass; drop only our reference.
    warmKept = null;
  },
});
