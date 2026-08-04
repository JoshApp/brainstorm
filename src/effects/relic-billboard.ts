// THE RELIC BILLBOARD — a dropped relic's 2.5D sprite standing in the world,
// faked into looking three-dimensional the way DELVE fakes everything: with
// LIGHT.
//
// The trick (see the "curved lit billboard" note): a flat sprite reads flat
// because it's UNLIT — it ignores the torch. So we do two things together:
//
//   1. CURVE the quad into a shallow cylindrical section — the left/right edges
//      bow away from the viewer. That gives the mesh real surface normals that
//      fan outward across its width.
//   2. LIGHT it (a lit MeshStandard material, not an unlit sprite). Now the
//      player's lamp + the room's torches RAKE across the curve: the centre
//      catches the light, the edges fall into shadow, and the flat art reads as
//      a solid, rounded object. Because the relic now shades like every other
//      surface in the dungeon, it belongs in the scene instead of floating on
//      top of it.
//
// Plus a Y-axis billboard (via onBeforeRender, which hands us the camera for
// free) so it always faces the player but stays standing upright on the floor.
// A faint domain-tinted emissive keeps it readable in the dark from a distance
// without washing out the lit shading that sells the depth.

import * as THREE from 'three';
import { stdMat } from '../style/material-registry';
import { relicArtUrl } from '../content/relic-art-assets';
import { DOMAINS } from '../content/domains';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import type { BuiltModel } from '../ecs/build-model';
import { dropSizeMeters } from '../content/drop-size';

const BILL_W = 0.64;      // billboard width (m) — relics read bigger on the floor
const BILL_H = 0.64;      // billboard height (m)
const SEG = 20;           // horizontal subdivisions — enough for a smooth curve
const CURVE_DEPTH = 0.14; // how far the edges bow back toward the object (m)
// Look-angle TILT: the board pitches back a FRACTION of the camera's elevation
// so a relic on the floor, viewed from a standing/looking-down angle, shows its
// FACE instead of a thin top edge — but never fully flattens, so it still reads
// as planted upright. 0 = pure upright billboard; 1 = full lay-flat-to-camera.
const TILT_FACTOR = 0.7;
const MAX_TILT = 1.05;    // clamp (~60°) so it tilts to greet you, never lies down

// ── Texture cache ────────────────────────────────────────────────────────────
// Each relic gets TWO textures from its one sprite: the albedo (the art) and a
// NORMAL MAP derived from the art's luminance. The normal map is the bas-relief
// escalation — it makes the torch shade the relic's SURFACE DETAIL (the ridges of
// a ring, the barbs of a tongue), not just the overall curve, so the flat sprite
// reads as a real 3D object under DELVE's dynamic light.
interface RelicTex { albedo: THREE.Texture; normal: THREE.Texture }
const texCache = new Map<string, RelicTex>();
let loader: THREE.TextureLoader | null = null;

function relicTextures(id: string): RelicTex | null {
  const url = relicArtUrl(id);
  if (!url) return null;
  let t = texCache.get(id);
  if (t) return t;

  loader ??= new THREE.TextureLoader();
  // Normal map — a blank texture filled once the albedo image decodes (linear
  // colour space; flat-up default (0.5,0.5,1) until then).
  const normal = new THREE.Texture();
  normal.colorSpace = THREE.NoColorSpace;
  normal.anisotropy = 4;

  const albedo = loader.load(url, (loaded) => {
    try {
      const img = loaded.image as CanvasImageSource & { width: number; height: number };
      normal.image = buildNormalCanvas(img);
      normal.needsUpdate = true;
    } catch { /* normal map is a bonus — never break the pickup on it */ }
  });
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 4;
  albedo.generateMipmaps = true;

  t = { albedo, normal };
  texCache.set(id, t);
  return t;
}

// Derive a tangent-space normal map from the sprite's luminance (weighted by
// alpha so the transparent background reads flat). A Sobel gradient → surface
// slope: brighter = raised, so painted highlights and edges become relief the
// scene light can rake across. Runs once per relic, cached.
function buildNormalCanvas(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const W = img.width, H = img.height;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const sctx = src.getContext('2d')!; sctx.drawImage(img, 0, 0);
  const d = sctx.getImageData(0, 0, W, H).data;
  const height = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) {
    const a = d[i + 3] / 255;
    height[p] = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255) * a;
  }
  const at = (x: number, y: number) => height[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d')!;
  const nd = octx.createImageData(W, H);
  const STRENGTH = 2.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
    const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
    let nx = -dx, ny = -dy, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
    const i = (y * W + x) * 4;
    nd.data[i] = (nx * 0.5 + 0.5) * 255;
    nd.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    nd.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    nd.data[i + 3] = 255;
  }
  octx.putImageData(nd, 0, 0);
  return out;
}

// ── Curved geometry (shared — the bow is the same for every relic) ───────────
// A cylindrical section: each vertex slides back in Z by how far it is from the
// centre column, so the plane bows toward the camera in the middle and its edges
// recede. Normals recomputed after the displacement so lighting uses the curve.
let curvedGeo: THREE.PlaneGeometry | null = null;
function getCurvedGeo(): THREE.PlaneGeometry {
  if (curvedGeo) return curvedGeo;
  const g = new THREE.PlaneGeometry(BILL_W, BILL_H, SEG, 1);
  const pos = g.attributes.position;
  const halfW = BILL_W / 2;
  for (let i = 0; i < pos.count; i++) {
    const tx = pos.getX(i) / halfW;                         // -1..1 across width
    pos.setZ(i, -CURVE_DEPTH * (1 - Math.cos((tx * Math.PI) / 2)));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  curvedGeo = g;
  return g;
}

const _wp = new THREE.Vector3();

/** Build a curved, lit, camera-facing billboard for a relic that has baked 2.5D
 *  art. Shaped like a BuiltModel so the pickup path can consume it unchanged. */
export function buildRelicBillboard(item: ItemSpec, opts: { sizeM?: number } = {}): BuiltModel {
  const tex = relicTextures(item.id);
  const accent = item.domain
    ? DOMAINS[item.domain].register.color
    : RARITY_COLORS[item.rarity ?? 'mundane'];

  const mat = stdMat({
    map: tex?.albedo,
    // The bas-relief: torchlight shades the sprite's own surface detail.
    normalMap: tex?.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    transparent: true,
    alphaTest: 0.5,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide,            // the bowed edges show their back faces
    // Faint self-glow so it reads in the dark from a distance; low enough that
    // the LIT shading (curve + normal-map relief) still dominates up close where
    // the depth has to sell. Tinted by the relic's domain.
    emissive: accent,
    emissiveMap: tex?.albedo,
    emissiveIntensity: 0.16,
    fog: true,
  });

  const mesh = new THREE.Mesh(getCurvedGeo(), mat);
  mesh.name = 'relic-billboard';
  // HOW BIG IS THIS THING? Every relic used to be the same 0.64m square, so a
  // finger ring and a war standard both stood two-thirds of a metre off the
  // floor. Size is the first thing a player reads off an object, and it was
  // carrying nothing. content/drop-size.ts answers in metres; the geometry stays
  // one shared cached plane and the mesh scales, so the curve and the standing
  // height come along and there's still exactly one geometry for all relics.
  const sizeM = opts.sizeM ?? dropSizeMeters(item);
  const k = sizeM / BILL_W;
  mesh.scale.setScalar(k);
  // Centre the art at "torso" height of the drop so it stands, not sinks.
  mesh.position.y = (BILL_H / 2) * k;

  const group = new THREE.Group();
  // YXZ so the YAW (Y) is applied first and the PITCH (X) then tilts about the
  // board's own horizontal axis — a "face the camera, then lean back" billboard,
  // not a world-axis tilt that would skew as it turns.
  group.rotation.order = 'YXZ';
  group.add(mesh);

  // Y-BILLBOARD + LOOK-ANGLE TILT: onBeforeRender hands us the live camera every
  // frame. Yaw to face the player; then pitch back a fraction of the camera's
  // elevation so a floor relic greets a looking-down view with its face, not its
  // edge. The parent (pickupGroup) is unrotated, so local yaw == world yaw.
  mesh.onBeforeRender = (_r, _s, camera) => {
    group.getWorldPosition(_wp);
    const dx = camera.position.x - _wp.x;
    const dy = camera.position.y - _wp.y;
    const dz = camera.position.z - _wp.z;
    const yaw = Math.atan2(dx, dz);
    const dh = Math.hypot(dx, dz) || 1e-4;
    // Camera elevation above the board; tilt the face UP toward it (negative
    // pitch in this frame), scaled + clamped so it leans, never lies flat.
    const elev = Math.atan2(dy, dh);
    const pitch = Math.max(-MAX_TILT, Math.min(MAX_TILT, -elev * TILT_FACTOR));
    group.rotation.set(pitch, yaw, 0);
  };

  return {
    group,
    parts: new Map(),
    slots: new Map(),
    materials: new Map([['billboard', mat]]),
    hitTargets: [mesh],   // tappable / raycastable like any pickup
    light: undefined,
  };
}
