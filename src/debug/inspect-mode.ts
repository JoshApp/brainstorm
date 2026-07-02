// Inspection mode for preview snaps — `?inspect=true`, driven by
// `npm run snap mob-*/item-*/model-*/vault-*`.
//
// The dungeon renders through a PSX post stack (quantize, dither, scanlines,
// amber tint, vignette, eye dark-adaptation) and lives in near-darkness — great
// for play, useless for *seeing* an asset. Inspect mode swaps that for a clean
// studio: bypass the post stack + filmic tone map, a flat-but-shaped lighting
// rig, a spotlight backdrop, and — for single-subject previews — auto-framing
// of the tagged subject.
//
// It all lives here so main.ts isn't littered with debug-only lighting and so
// gameplay code only ever has to ask one question: isInspectActive().

import * as THREE from 'three';
import { setInspectBypass } from '../style/render-frame';
import type { DelveRenderer } from '../scene/create-renderer';

// Ambient fill intensity while inspecting (pure white, flat). Bright enough
// that a near-black mob's shadow side stays readable without blowing out metal.
export const INSPECT_AMBIENT = 1.5;

// True when the page was booted for an inspection snap. Read once at module
// load so callers (e.g. the drifting-motes gate) can branch on it before
// enterInspectMode() has run.
export const INSPECT_REQUESTED =
  new URLSearchParams(window.location.search).get('inspect') === 'true';

// The subject mesh of a single-subject preview (a mob, a model) spawns async
// after the scenario is applied, so we can't frame it at setup time. These hold
// the rig + a pending flag; tickInspectFraming() does the framing once the
// subject actually appears in the scene graph.
let active = false;
let framePending = false;
let keyLight: THREE.DirectionalLight | null = null;
let rimLight: THREE.DirectionalLight | null = null;
let sceneRef: THREE.Scene | null = null;
let cameraRef: THREE.PerspectiveCamera | null = null;
let getLevelRoot: (() => THREE.Object3D | null) | null = null;

/** Whether an inspection preview is running. Gameplay systems read this instead
 *  of branching on scattered debug flags. */
export function isInspectActive(): boolean {
  return active;
}

export interface EnterInspectOpts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: DelveRenderer;
  ambient: THREE.AmbientLight;
  /** Single-subject preview (mob/item/model): hide the surrounding level and
   *  auto-frame the tagged subject. Vault previews pass false — the room IS the
   *  subject and keeps its authored framing/lighting. */
  subjectOnly: boolean;
  /** Lazily fetches the loaded level's root so the framing pass can hide its
   *  non-subject children. The level loads async, hence a getter not a value. */
  getLevelRoot: () => THREE.Object3D | null;
}

/** Switch the renderer + scene into clean studio-preview presentation. */
export function enterInspectMode(o: EnterInspectOpts): void {
  active = true;
  sceneRef = o.scene;
  cameraRef = o.camera;
  getLevelRoot = o.getLevelRoot;
  framePending = o.subjectOnly;

  // 1. Bypass the PSX post stack + filmic tone map. Both are grimdark
  //    crunchifiers (they crush a mid-grey backdrop to black) that fight the
  //    clean material read inspection wants.
  setInspectBypass(true);
  o.renderer.toneMapping = THREE.NoToneMapping;
  o.renderer.toneMappingExposure = 1.0;

  // 2. Studio lighting rig. White ambient fill + a hemisphere light (which
  //    lifts metals — they barely register under a plain AmbientLight without
  //    an env map, but the hemi's up-vs-down gradient gives them something to
  //    sample) + a key/rim directional pair. Lights aim at a floating-item
  //    default (~1.4m); tickInspectFraming() retargets them at the subject's
  //    true centre once it spawns (a floor mob sits lower).
  o.ambient.color.setHex(0xffffff);
  o.ambient.intensity = INSPECT_AMBIENT;

  const hemi = new THREE.HemisphereLight(0xeeeeff, 0x806040, 2.5);
  hemi.position.set(0, 5, 0);
  o.scene.add(hemi);

  const aim = new THREE.Vector3(0, 1.4, 0);
  keyLight = new THREE.DirectionalLight(0xffffff, 3.0);   // front-right, above
  keyLight.position.set(aim.x + 2, aim.y + 3, aim.z + 3);
  keyLight.target.position.copy(aim);
  o.scene.add(keyLight, keyLight.target);

  rimLight = new THREE.DirectionalLight(0xffd0a0, 1.5);    // warm back edge
  rimLight.position.set(aim.x - 2, aim.y + 2, aim.z - 3);
  rimLight.target.position.copy(aim);
  o.scene.add(rimLight, rimLight.target);

  // 3. Spotlight backdrop, kill fog, strip HUD.
  o.scene.background = makeStudioBackdrop();
  const fog = o.scene.fog as THREE.Fog | null;
  if (fog) { fog.near = 1000; fog.far = 2000; }
  document.body.classList.add('hud-hidden');
}

/** Per-frame, while a subject-only preview waits for its subject to spawn: once
 *  the tagged mesh appears, hide the surrounding level, frame the camera on the
 *  subject, and aim the key/rim lights at its true centre. One-shot — clears
 *  itself when done, so it's a cheap early-return on every other frame. */
export function tickInspectFraming(): void {
  if (!framePending || !sceneRef || !cameraRef) return;
  const box = new THREE.Box3();
  sceneRef.traverse((obj) => { if (obj.userData.inspectSubject) box.expandByObject(obj); });
  if (box.isEmpty()) return;   // subject not spawned yet — retry next frame

  // Hide the surrounding room so the dungeon doesn't read as noise behind the
  // subject. (Items/models live under the level root; mobs live in the scene
  // root and are simply not tagged for hiding.)
  const root = getLevelRoot?.();
  if (root) {
    for (const child of root.children) {
      if (!(child as THREE.Object3D).userData.inspectSubject) child.visible = false;
    }
  }

  // Frame by the bounding SPHERE, not the longest box axis: a long, low mob
  // (e.g. the carrion hound — 0.8m deep, 0.25m tall) framed by its depth axis
  // pushes the camera back and leaves it a sliver on screen. The sphere fills
  // the vertical FOV the same regardless of which way the subject faces. A 3/4
  // hero angle (front-right, slightly above) shows the form in three dimensions
  // instead of sending its length straight into the screen.
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const c = sphere.center;
  const radius = sphere.radius || 0.5;
  const fov = (cameraRef.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fov / 2)) * 1.15;   // 1.15× = a little air
  const az = (35 * Math.PI) / 180, el = (22 * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  cameraRef.position.copy(c).addScaledVector(dir, dist);
  cameraRef.lookAt(c);
  cameraRef.updateMatrixWorld();

  aimLight(keyLight, c, 2, 3, 3);
  aimLight(rimLight, c, -2, 2, -3);
  framePending = false;
}

function aimLight(
  light: THREE.DirectionalLight | null, at: THREE.Vector3,
  dx: number, dy: number, dz: number,
): void {
  if (!light) return;
  light.position.set(at.x + dx, at.y + dy, at.z + dz);
  light.target.position.copy(at);
  light.target.updateMatrixWorld();
}

// Radial "studio sweep" backdrop: a lighter pool of light in the centre (where
// the framed subject sits) falling to near-black at the edges. Gives a
// near-black mob a brighter ground to read against while keeping the frame dark
// and grimdark — a flat grey field hid the darkest subjects. CanvasTexture is
// browser-only, and inspect only ever runs in the browser.
function makeStudioBackdrop(): THREE.CanvasTexture {
  const size = 512;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const g = cvs.getContext('2d')!;
  // Centre offset slightly below middle — the subject's lower body/feet read
  // against the brightest part, the way a stage spotlight pools on the floor.
  const grad = g.createRadialGradient(
    size / 2, size * 0.58, size * 0.04,
    size / 2, size * 0.58, size * 0.62);
  grad.addColorStop(0, '#5b6068');   // pool centre — lifts dark silhouettes
  grad.addColorStop(0.55, '#3b3e44');
  grad.addColorStop(1, '#191b1f');   // edges fall to near-black to frame it
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
