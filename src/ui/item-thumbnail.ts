import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import type { ItemSpec } from '../content/items';
import { disposeBuiltTree } from '../style/material-registry';
import { relicArtUrl } from '../content/relic-art-assets';

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

/**
 * The image URL to show for an item ANYWHERE in the UI (bag, detail header,
 * reliquary plate). For a relic with a shipped 2.5D sprite this is the baked
 * Flux art (public/relics/<id>.webp); otherwise it's the procedural 3D thumbnail.
 * ONE call site for the "art supersedes model" rule, so wiring it here lights up
 * every surface at once the moment a relic is baked.
 */
export function itemImageUrl(item: ItemSpec): string {
  if (item.kind === 'relic') {
    const art = relicArtUrl(item.id);
    if (art) return art;
  }
  return getItemThumbnail(item);
}

// ── GENERATING ONE OF THESE IS NOT FREE ──────────────────────────────────────
//
// Measured in-browser: the first call costs ~260ms and EVERY new item id costs
// 150-240ms after that — a WebGL context on the first call, then a model build,
// a render and a toDataURL (a GPU→CPU sync plus a PNG encode) on each one. That
// was happening ON THE FRAME YOU TOUCH AN ITEM, because the acquisition beat
// asks for the thumbnail to fly into the satchel. Hence "picking up an ember
// kinda lags the game shortly" — and it wasn't the ember, it was any item this
// session hadn't drawn yet.
//
// 107 items × ~200ms is 21 seconds, so pre-generating everything at load is not
// the answer either. The answer is WHEN, not whether:
//
//   - the RIG warms once during loading, not on the first pickup;
//   - a thumbnail is generated when the item is SPAWNED into the world, on idle
//     time, so it is ready long before you walk over to it;
//   - the gameplay-frame caller never generates. It takes what's cached, and if
//     nothing is, it shows a rarity glyph and asks for one to be made.
//
// The inventory panel still calls the synchronous version deliberately: you are
// standing in a menu with the world paused, and a hitch there costs nothing.

/** Build the offscreen rig NOW (during loading), so the first real thumbnail
 *  doesn't pay for a WebGL context on a gameplay frame. */
export function warmThumbnailRig(): void {
  ensureRig();
}

/** The cached thumbnail, or null. NEVER generates — safe on a gameplay frame. */
export function peekItemThumbnail(item: ItemSpec): string | null {
  if (item.kind === 'relic') {
    const art = relicArtUrl(item.id);
    if (art) return art;
  }
  return cache.get(item.id) ?? null;
}

// Idle generation queue. Deduped, and drained a couple at a time so a floor that
// spawns twenty pickups doesn't stall a frame trying to be helpful.
const pending: ItemSpec[] = [];
const queued = new Set<string>();
let pumping = false;

/** Ask for this item's thumbnail to exist SOON. Called where items enter the
 *  world (a pickup lands, a stall lays out its wares), never where one is
 *  taken. Cheap and idempotent. */
export function requestThumbnail(item: ItemSpec): void {
  if (cache.has(item.id) || queued.has(item.id)) return;
  if (item.kind === 'relic' && relicArtUrl(item.id)) return;   // baked art, nothing to render
  queued.add(item.id);
  pending.push(item);
  pump();
}

function pump(): void {
  if (pumping || pending.length === 0) return;
  pumping = true;
  const idle = (cb: () => void) => {
    const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(cb, { timeout: 2000 }); else setTimeout(cb, 0);
  };
  idle(() => {
    // ONE per idle slice. Each is ~200ms of blocking work; two in a slice is a
    // dropped frame even when the browser said there was room.
    const next = pending.shift();
    pumping = false;
    if (next) { try { getItemThumbnail(next); } catch { /* a thumbnail is never worth throwing over */ } }
    pump();
  });
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
