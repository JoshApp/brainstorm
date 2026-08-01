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

const BILL_W = 0.64;      // billboard width (m) — relics read bigger on the floor
const BILL_H = 0.64;      // billboard height (m)
const SEG = 20;           // horizontal subdivisions — enough for a smooth curve
const CURVE_DEPTH = 0.14; // how far the edges bow back toward the object (m)

// ── Texture cache ────────────────────────────────────────────────────────────
const texCache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;

function relicTexture(id: string): THREE.Texture | null {
  const url = relicArtUrl(id);
  if (!url) return null;
  let t = texCache.get(id);
  if (!t) {
    loader ??= new THREE.TextureLoader();
    t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    texCache.set(id, t);
  }
  return t;
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
export function buildRelicBillboard(item: ItemSpec): BuiltModel {
  const tex = relicTexture(item.id) ?? undefined;
  const accent = item.domain
    ? DOMAINS[item.domain].register.color
    : RARITY_COLORS[item.rarity ?? 'mundane'];

  const mat = stdMat({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide,            // the bowed edges show their back faces
    // Faint self-glow so it reads in the dark from a distance; low enough that
    // the LIT shading across the curve still dominates up close (where the depth
    // has to sell). Tinted by the relic's domain.
    emissive: accent,
    emissiveMap: tex,
    emissiveIntensity: 0.16,   // low — enough to read in the dark; the LIT curve carries the depth
    fog: true,
  });

  const mesh = new THREE.Mesh(getCurvedGeo(), mat);
  mesh.name = 'relic-billboard';
  // Centre the art at "torso" height of the drop so it stands, not sinks.
  mesh.position.y = BILL_H / 2;

  const group = new THREE.Group();
  group.add(mesh);

  // Y-BILLBOARD: onBeforeRender hands us the live camera every frame — yaw the
  // group so the sprite faces the player but stays upright (no pitch/roll). The
  // parent (pickupGroup) is unrotated, so local yaw == world yaw.
  mesh.onBeforeRender = (_r, _s, camera) => {
    group.getWorldPosition(_wp);
    group.rotation.set(0, Math.atan2(camera.position.x - _wp.x, camera.position.z - _wp.z), 0);
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
