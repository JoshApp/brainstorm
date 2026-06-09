import * as THREE from 'three';

// Blob shadow — a cheap soft contact shadow on the floor under a moving thing
// (creatures now; loot/props can share it later), REPLACING real cube-map cast
// shadows for dynamic objects.
//
// Why: the player's lamp is a PointLight, so every castShadow mesh is re-drawn
// across the shadow cube's faces EVERY frame. Measured at ~5-6 draws per
// creature (plus the cube-map fill) — roughly HALF the frame's draw calls in a
// fight. A creature's cast shadow falls away from the lamp (behind it), so it
// barely reads anyway; the GROUNDING (the dark contact patch under the feet) is
// what sells weight, and a single floor quad does that for ~1 draw and no fill.
// Static world geometry keeps its real lamp shadows — the blob only replaces
// the expensive dynamic cast.
//
// The blob is plain alpha-blended black with a radial falloff: it darkens the
// floor toward black under the body. On lit floor (near the lamp, where fights
// happen) it reads as a shadow; on already-black floor it's invisibly absent —
// which is correct (no light, no shadow). Geometry + texture + material are all
// shared, so a horde of blobs is one geometry, one material, N cheap quads.

const TEX_SIZE = 64;
let sharedTex: THREE.Texture | null = null;

/** Radial alpha mask: opaque-black core feathering to transparent at the rim. */
function blobTexture(): THREE.Texture {
  if (sharedTex) return sharedTex;
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  const ctx = c.getContext('2d')!;
  const r = TEX_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.7)');   // hold the core, then feather
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  sharedTex = new THREE.CanvasTexture(c);
  return sharedTex;
}

const sharedGeom = new THREE.PlaneGeometry(1, 1);
let sharedMat: THREE.MeshBasicMaterial | null = null;

function blobMaterial(): THREE.MeshBasicMaterial {
  if (sharedMat) return sharedMat;
  sharedMat = new THREE.MeshBasicMaterial({
    map: blobTexture(),
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,     // a decal — never occludes
    fog: true,             // fade with the dungeon fog like the floor it sits on
  });
  return sharedMat;
}

/** A horizontal floor decal of `radius` (metres), centred on its parent's
 *  origin, sitting just above y=0. Parent it to the moving object's container
 *  so it tracks XZ for free (no per-frame update). Shared geom + material. */
export function createBlobShadow(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedGeom, blobMaterial());
  mesh.rotation.x = -Math.PI / 2;     // lie flat on the floor
  mesh.position.y = 0.02;             // hair above the floor to avoid z-fight
  const d = radius * 2;
  mesh.scale.set(d, d, 1);
  mesh.renderOrder = -2;              // floor decal — draws under props/creatures
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.blobShadow = true;
  return mesh;
}
