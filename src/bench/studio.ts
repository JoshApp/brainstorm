// The bench studio — a clean, editor-grade render environment for a SINGLE
// subject, with NO game underneath. This is the core that makes the bench fast
// and noise-free: a bare Three.js scene + a neutral studio light rig, no fog,
// no PSX post, no HUD, no level. Renders on demand (not in a rAF loop) so every
// capture is deterministic — exactly `subject @ azimuth @ elevation`.
//
// Two render modes, both painting the same canvas:
//   renderView(az, el)        — one framed hero shot
//   renderTurntable(n, el)    — n azimuths laid out as a contact sheet (one
//                               image = the whole form), via GL scissor tiles
//
// Lighting values mirror src/debug/inspect-mode.ts so a bench shot and an
// in-game inspect snap read the same.

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { installBandedLightingWebGPU } from '../style/banded-lighting-webgpu';

export interface Studio {
  /** Center + frame the object; remembers its radius for camera distance. */
  show(object: THREE.Object3D): void;
  renderView(azDeg: number, elDeg: number): void;
  renderTurntable(n: number, elDeg: number): void;
  /** Four-view contact sheet: front (az=0, el=0), side (az=90, el=0),
   *  top (az=0, el=89), iso (az=35, el=18). Each tile gets a corner
   *  label via DOM overlay. Use this as the default debug-iteration
   *  view — published LLM-CAD research finds single-screenshot
   *  feedback degrades iteration; multi-view doesn't. */
  renderOrthoQuad(): void;
  /** The three-lights acceptance test: BLACK / LAMP / TINT panels.
   *  Optional azimuth for subjects that read from an angle other than
   *  the side profile (wall props: az 0 = front). */
  renderThreeLights(azDeg?: number): void;
  /** Contact sheet from a fixed camera, calling poseAt(i, n) before each tile
   *  to mutate the subject — for animation arcs (windup→strike→recover). */
  renderPoseGrid(n: number, azDeg: number, elDeg: number, poseAt: (i: number, n: number) => void): void;
  /** First-person contact sheet: camera fixed at the eye (origin, looking -Z)
   *  at the given FOV, calling poseAt(i, n) before each tile. For weapon
   *  viewmodels, whose swing is authored in camera space and reads wrong from
   *  an orbit. */
  renderHeldGrid(n: number, fovDeg: number, poseAt: (i: number, n: number) => void): void;
  /** The framed group — spawn effects (or mount a held weapon) into this so it
   *  sits at the studio origin and reads against the backdrop. */
  root(): THREE.Group;
  /** Fix the framing distance manually (for effects, whose extent changes over
   *  their lifetime so auto-fit from a single frame would mis-frame). */
  frame(radiusM: number): void;
  resize(w: number, h: number): void;
}

export async function mountStudio(canvas: HTMLCanvasElement): Promise<Studio> {
  // The GAME's renderer (WebGPURenderer, WebGL2 backend as fallback — same
  // detection as scene/create-renderer.ts). The whole reveal system — rim,
  // dissolve, PAINTED chroma, the banded lighting model — lives in node
  // properties a classic WebGLRenderer silently IGNORES; on the old renderer
  // the three-lights acceptance test was blind to the very things it judges.
  const forceWebGL = new URLSearchParams(location.search).get('webgpu') === '0'
    || !('gpu' in navigator);
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  await renderer.init();
  // Banded cel lighting, globally, like the game boots it (default setting is
  // ON) — a bench shot should read like an in-game inspect snap.
  installBandedLightingWebGPU(true);

  const scene = new THREE.Scene();
  scene.background = studioBackdrop();

  // Studio rig: flat white ambient + hemisphere (lifts metals) + key/rim
  // directional pair. Same intensities as inspect-mode's rig.
  // --light=<hex> tints the rig to simulate a coloured room (validating the
  // "Painted" material mode — e.g. --light=ff1818 for a blood-lit chamber).
  const lightParam = new URLSearchParams(location.search).get('light');
  const tint = lightParam ? new THREE.Color(parseInt(lightParam, 16)) : null;
  const studioRig = new THREE.Group();
  studioRig.add(new THREE.AmbientLight(tint ?? 0xffffff, 1.5));
  const hemi = new THREE.HemisphereLight(tint ?? 0xeeeeff, 0x806040, 2.5);
  hemi.position.set(0, 5, 0);
  studioRig.add(hemi);
  const key = new THREE.DirectionalLight(tint ?? 0xffffff, 3.0);
  key.position.set(2, 4, 3);
  studioRig.add(key);
  const rim = new THREE.DirectionalLight(tint ?? 0xffd0a0, 1.5);
  rim.position.set(-2, 2, -3);
  studioRig.add(rim);
  scene.add(studioRig);

  // ── THE THREE-LIGHTS TEST RIGS (docs/VISUAL-LANGUAGE.md) ──────────
  // A model ships when it reads under all three: BLACK (emissive/rim
  // only — does the silhouette read, does only the RIGHT stuff glow?),
  // LAMP (the player's near-neutral hand-lamp — true colors, gesture,
  // connections), TINT (one saturated room mood — does painted carry
  // the hue, does absorbed stay swallowed?). Swapped per-tile by
  // renderThreeLights below.
  const blackRig = new THREE.Group();
  blackRig.add(new THREE.AmbientLight(0xffffff, 0.02));   // not literally zero — silhouette vs backdrop
  blackRig.visible = false;
  scene.add(blackRig);

  const lampRig = new THREE.Group();
  const lampPoint = new THREE.PointLight(0xfff4e0, 30, 0, 2);  // near-neutral, slight warmth like the hand-lamp
  lampPoint.position.set(0.5, 0.8, 1.2);
  lampRig.add(lampPoint);
  lampRig.add(new THREE.AmbientLight(0xffffff, 0.06));
  lampRig.visible = false;
  scene.add(lampRig);

  const tintRig = new THREE.Group();
  const BLOOD = 0xff5040;                                  // TORCH_BLOOD, the strongest mood
  tintRig.add(new THREE.AmbientLight(BLOOD, 0.5));
  const tintKey = new THREE.DirectionalLight(BLOOD, 2.5);
  tintKey.position.set(2, 3, 2);
  tintRig.add(tintKey);
  tintRig.visible = false;
  scene.add(tintRig);

  const RIGS: Record<string, THREE.Group> = { studio: studioRig, black: blackRig, lamp: lampRig, tint: tintRig };
  function setLightRig(mode: keyof typeof RIGS): void {
    for (const [name, rig] of Object.entries(RIGS)) rig.visible = name === mode;
  }

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);

  const subject = new THREE.Group();   // holds the current object, centered
  scene.add(subject);
  const pivot = new THREE.Vector3(0, 0, 0);
  let radius = 0.5;

  function show(object: THREE.Object3D): void {
    subject.clear();
    subject.add(object);
    subject.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Recenter the object on the studio origin so the turntable spins around
    // its true center regardless of where the spec placed it.
    object.position.sub(sphere.center);
    radius = Math.max(sphere.radius, 0.05);
    pivot.set(0, 0, 0);
  }

  function placeCamera(azDeg: number, elDeg: number, aspect: number): void {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    const fov = (camera.fov * Math.PI) / 180;
    // Distance to fit the bounding sphere in the (narrower) vertical extent,
    // accounting for aspect so wide tiles don't crop a tall subject.
    const vFit = radius / Math.sin(fov / 2);
    const hFit = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = Math.max(vFit, hFit) * 1.15;
    camera.position.set(
      pivot.x + dist * Math.sin(az) * Math.cos(el),
      pivot.y + dist * Math.sin(el),
      pivot.z + dist * Math.cos(az) * Math.cos(el),
    );
    camera.lookAt(pivot);
  }

  function renderView(azDeg: number, elDeg: number): void {
    const w = canvas.width, h = canvas.height;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera(azDeg, elDeg, camera.aspect);
    renderer.render(scene, camera);
  }

  // Shared scissor-tile contact-sheet loop. perTile(i, aspect) positions the
  // camera (and may pose the subject) for cell i, then the tile renders.
  function grid(n: number, perTile: (i: number, aspect: number) => void): void {
    const cols = gridCols(n);
    const rows = Math.ceil(n / cols);
    const W = canvas.width, H = canvas.height;
    const tw = Math.floor(W / cols), th = Math.floor(H / rows);
    const aspect = tw / th;
    renderer.setScissorTest(true);   // per-tile clear stays inside its cell
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = col * tw;
      // Node-renderer viewport/scissor y is TOP-LEFT origin on BOTH backends
      // (the WebGL fallback converts to GL's bottom-left internally) — the old
      // `H - (row+1)*th` GL flip put every contact-sheet row upside down.
      const y = row * th;
      renderer.setViewport(x, y, tw, th);
      renderer.setScissor(x, y, tw, th);
      perTile(i, aspect);
      renderer.render(scene, camera);
    }
    renderer.setScissorTest(false);
  }

  function renderTurntable(n: number, elDeg: number): void {
    grid(n, (i, aspect) => placeCamera((i / n) * 360, elDeg, aspect));
  }

  // Four canonical views for spatial debugging. Models face −Z by
  // convention (CLAUDE.md), so FRONT puts the camera at −Z looking
  // back at the FACE — az 0 (camera at +Z) showed every mob's REAR
  // labeled "FRONT", which mis-led a whole critique pass before it
  // was caught (the rat's inverted tail read as its nose). ISO sits
  // front-right for the same reason. The published research (Picard
  // et al., 3DCodeBench) is explicit that single-view critique hurts
  // LLM iteration; the quad is the mitigation. Top uses 89° to avoid
  // Three's gimbal-lock at 90.
  const ORTHO_VIEWS: ReadonlyArray<{ az: number; el: number; label: string }> = [
    { az: 180, el: 0,  label: 'FRONT' },
    { az: 90,  el: 0,  label: 'SIDE' },
    { az: 0,   el: 89, label: 'TOP' },
    { az: 145, el: 18, label: 'ISO' },
  ];

  function renderOrthoQuad(): void {
    grid(ORTHO_VIEWS.length, (i, aspect) => {
      const v = ORTHO_VIEWS[i];
      placeCamera(v.az, v.el, aspect);
    });
    paintViewLabels(ORTHO_VIEWS.map((v) => v.label));
  }

  // Three side-by-side views, one per test rig. Default is the SIDE
  // profile (the gesture-readable angle for mobs); pass an azimuth for
  // subjects whose reading angle differs — wall props read from the
  // FRONT (az 0). Three lighting conditions beat three angles of one
  // condition for ACCEPTANCE (the ortho quad already covers geometry).
  function renderThreeLights(azDeg = 90): void {
    const modes: Array<keyof typeof RIGS> = ['black', 'lamp', 'tint'];
    grid(3, (i, aspect) => {
      setLightRig(modes[i]);
      placeCamera(azDeg, 8, aspect);
    });
    setLightRig('studio');
    paintViewLabels(['BLACK · emissive only', 'LAMP · neutral', 'TINT · blood room']);
  }

  function renderPoseGrid(n: number, azDeg: number, elDeg: number, poseAt: (i: number, n: number) => void): void {
    grid(n, (i, aspect) => {
      poseAt(i, n);
      subject.updateMatrixWorld(true);   // re-resolve the posed rig before render
      placeCamera(azDeg, elDeg, aspect);
    });
  }

  function renderHeldGrid(n: number, fovDeg: number, poseAt: (i: number, n: number) => void): void {
    camera.fov = fovDeg;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);   // identity → looks down world -Z, the player's eye
    grid(n, (i) => { poseAt(i, n); subject.updateMatrixWorld(true); });
  }

  function resize(w: number, h: number): void {
    renderer.setSize(w, h, false);
  }

  resize(canvas.clientWidth || 1200, canvas.clientHeight || 900);
  return {
    show, renderView, renderTurntable, renderOrthoQuad, renderThreeLights, renderPoseGrid, renderHeldGrid,
    root: () => subject, frame: (r) => { radius = r; pivot.set(0, 0, 0); }, resize,
  };
}

// Even-ish column count so a contact sheet reads left-to-right, top-to-bottom.
function gridCols(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return Math.min(n, 2);   // 4-up is 2×2, not 1×4 (orthos read square)
  if (n <= 8) return 4;
  return Math.ceil(Math.sqrt(n));
}

// DOM overlay for per-tile labels — drawn on top of the canvas at each
// tile's screen-space corner. The headless screenshot captures the body,
// not just the canvas, so these end up baked into the snap as-is.
const LABEL_LAYER_ID = 'bench-view-labels';
function paintViewLabels(labels: string[]): void {
  let layer = document.getElementById(LABEL_LAYER_ID);
  if (layer) layer.remove();
  layer = document.createElement('div');
  layer.id = LABEL_LAYER_ID;
  Object.assign(layer.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10',
    font: 'bold 12px ui-monospace, monospace', letterSpacing: '0.18em',
    color: 'rgba(220, 230, 240, 0.85)',
    textShadow: '0 0 4px rgba(0,0,0,0.95), 0 1px 0 rgba(0,0,0,0.85)',
  } as CSSStyleDeclaration);
  const cols = gridCols(labels.length);
  const rows = Math.ceil(labels.length / cols);
  for (let i = 0; i < labels.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tag = document.createElement('div');
    tag.textContent = labels[i];
    Object.assign(tag.style, {
      position: 'absolute',
      left: `calc(${(col / cols) * 100}% + 10px)`,
      top:  `calc(${(row / rows) * 100}% + 8px)`,
    } as CSSStyleDeclaration);
    layer.appendChild(tag);
  }
  document.body.appendChild(layer);
}

// Radial studio sweep: a lighter pool behind the subject falling to near-black
// at the edges — gives a dark asset a ground to read against without a busy bg.
function studioBackdrop(): THREE.CanvasTexture {
  const size = 512;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const g = cvs.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size * 0.5, size * 0.05, size / 2, size * 0.5, size * 0.62);
  grad.addColorStop(0, '#4a4e55');
  grad.addColorStop(0.6, '#2c2f34');
  grad.addColorStop(1, '#15171a');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
