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

export interface Studio {
  /** Center + frame the object; remembers its radius for camera distance. */
  show(object: THREE.Object3D): void;
  renderView(azDeg: number, elDeg: number): void;
  renderTurntable(n: number, elDeg: number): void;
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

export function mountStudio(canvas: HTMLCanvasElement): Studio {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = studioBackdrop();

  // Studio rig: flat white ambient + hemisphere (lifts metals) + key/rim
  // directional pair. Same intensities as inspect-mode's rig.
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const hemi = new THREE.HemisphereLight(0xeeeeff, 0x806040, 2.5);
  hemi.position.set(0, 5, 0);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd0a0, 1.5);
  rim.position.set(-2, 2, -3);
  scene.add(rim);

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
      const y = H - (row + 1) * th;   // GL viewport origin is bottom-left
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
    show, renderView, renderTurntable, renderPoseGrid, renderHeldGrid,
    root: () => subject, frame: (r) => { radius = r; pivot.set(0, 0, 0); }, resize,
  };
}

// Even-ish column count so a contact sheet reads left-to-right, top-to-bottom.
function gridCols(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return n;
  if (n <= 8) return 4;
  return Math.ceil(Math.sqrt(n));
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
