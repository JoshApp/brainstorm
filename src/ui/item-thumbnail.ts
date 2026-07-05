import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import type { ItemSpec } from '../content/items';
import { disposeBuiltTree } from '../style/material-registry';

// 3D item thumbnails for the inventory panel. Each item's dropModel gets
// rendered once to an offscreen canvas, converted to a PNG data URL, and
// cached forever. The inventory UI uses these as <img src=...> for slot
// cells — much more legible than text labels alone.
//
// Rendering is intentionally low-res (96×96 with nearest-filter feel) so
// it matches the PSX aesthetic of the rest of the game.

const THUMB_SIZE = 128;   // source render res — displayed up to 48px, smooth + crisp

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const cache = new Map<string, string>();

function ensureRig() {
  if (renderer && scene && camera) return;

  // Deliberately a classic WebGLRenderer (NOT the game's WebGPU renderer):
  // this rig renders once, synchronously, straight into toDataURL — the async
  // WebGPU submit has no place here, and a tiny second GL context is free.
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0); // transparent so the panel bg shows through

  scene = new THREE.Scene();

  // Three-light setup so items have clear silhouettes + readable detail:
  //   - Key warm light from upper-right
  //   - Fill cool light from lower-left (so shadowed side isn't pure black)
  //   - Ambient floor lift so dark items don't disappear
  const key = new THREE.DirectionalLight(0xffeecc, 1.7);
  key.position.set(0.6, 1.0, 0.5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x4a90ff, 0.45);
  fill.position.set(-0.6, -0.4, 0.4);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  camera = new THREE.PerspectiveCamera(28, 1, 0.05, 10);
  camera.position.set(0.7, 0.6, 0.9);
  camera.lookAt(0, 0, 0);
}

/**
 * Render the item's dropModel to a small image. The result is a PNG data
 * URL suitable as an <img src>. Cached forever by item id — call it as
 * many times as you want; the work happens once per unique item.
 *
 * For items whose model looks bad at our default 3/4 angle, the
 * item-specific overrides in PER_ITEM_VIEW kick in (rotation, scale).
 */
export function getItemThumbnail(item: ItemSpec): string {
  const cached = cache.get(item.id);
  if (cached) return cached;
  ensureRig();
  if (!renderer || !scene || !camera) return '';

  const built = buildModel(item.dropModel);
  const group = built.group;

  // Apply any per-item view tweaks (orientation that suits THIS item).
  const view = PER_ITEM_VIEW[item.id];
  if (view) {
    if (view.rotation) group.rotation.fromArray(view.rotation);
  }

  // Auto-frame: scale + center the group so its bounding box fits inside
  // a unit box around the origin. The camera is positioned so a unit box
  // fills most of the frame.
  const tempGroup = new THREE.Group();
  tempGroup.add(group);
  scene.add(tempGroup);

  const bbox = new THREE.Box3().setFromObject(group);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  tempGroup.scale.setScalar(0.7 / maxDim);
  tempGroup.position.set(-center.x * tempGroup.scale.x, -center.y * tempGroup.scale.y, -center.z * tempGroup.scale.z);

  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');

  // Cleanup — remove from scene + dispose of the built materials so we
  // don't leak GPU memory if there are many items.
  scene.remove(tempGroup);
  disposeBuiltTree(group);

  cache.set(item.id, dataURL);
  return dataURL;
}

// Per-item orientation overrides — apply a rotation BEFORE auto-framing so
// the item presents its "best side" to the camera. Defaults are fine for
// most items; this is the escape hatch for ones that need a different pose.
const PER_ITEM_VIEW: Record<string, { rotation?: [number, number, number] }> = {
  // Weapons are designed with the blade pointing +Y; the default 3/4 view
  // already shows them well, so no override needed.

  // Cloak is a flat extruded silhouette — face it more directly so the
  // shape reads instead of being a thin slice.
  'tattered-cloak': { rotation: [0, -0.4, 0] },

  // Shield should show its disc face, not its edge.
  'wooden-shield': { rotation: [-0.4, 0.3, 0] },
};
