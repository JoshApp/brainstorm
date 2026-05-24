import * as THREE from 'three';
import type { Style } from './index';

// PS1-era render pipeline: render the scene to a low-res target, then blit it
// full-screen with nearest-neighbor filtering. The pixelated upscale + chunky
// shadows + warm fog = late-90s console feel without any vertex shader work.
//
// Resolution is a fraction of canvas size (so it adapts to phone vs desktop).
// 0.4 = roughly 480x216 on a phone — distinctly pixelated but still readable.

const PS1_SCALE = 0.4;

let lowResTarget: THREE.WebGLRenderTarget | null = null;
let blitScene: THREE.Scene | null = null;
let blitCamera: THREE.OrthographicCamera | null = null;

export function initRenderPipeline(renderer: THREE.WebGLRenderer) {
  // Always allocate the low-res target + blit setup so style switching from
  // ps1 → other → ps1 doesn't require re-init.
  const w = Math.max(1, Math.floor(renderer.domElement.width * PS1_SCALE));
  const h = Math.max(1, Math.floor(renderer.domElement.height * PS1_SCALE));

  lowResTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });

  blitScene = new THREE.Scene();
  blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blitMat = new THREE.MeshBasicMaterial({
    map: lowResTarget.texture,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
  blitScene.add(blitMesh);

  window.addEventListener('resize', () => {
    if (!lowResTarget) return;
    const nw = Math.max(1, Math.floor(renderer.domElement.width * PS1_SCALE));
    const nh = Math.max(1, Math.floor(renderer.domElement.height * PS1_SCALE));
    lowResTarget.setSize(nw, nh);
  });
}

export function renderWithStyle(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  style: Style,
) {
  if (style === 'ps1' && lowResTarget && blitScene && blitCamera) {
    renderer.setRenderTarget(lowResTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
  } else {
    renderer.render(scene, camera);
  }
}
