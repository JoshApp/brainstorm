// One texture for a model that arrived as many.
//
// The scanned bone hands (content/scanned-hand.ts) come out of Tripo as 30
// parts, each with its OWN material and its OWN baseColor texture — identical
// in every other respect. A material per part means a draw per part, and the
// viewmodel merge (player/viewmodel-merge.ts) cannot fold parts that sample
// different textures. A 2026-11-22 phone recording drew the sword hand as ~27
// separate meshes every frame, about a third of the frame's draws, each with
// its own bind groups.
//
// So at load: pack every part's texture into one atlas (shelf packing, sizes
// kept, a gutter of edge pixels round each tile so mipmaps don't bleed between
// neighbours), rewrite each part's UVs into its tile, and give every part ONE
// shared material. The parts then merge like any untextured model. The look is
// the same texels at the same resolution.
//
// Browser-only (draws into a canvas). Requires UVs inside [0,1] — true of
// these assets (0.001..0.999); a part outside that is left alone.

import * as THREE from 'three';

const GUTTER = 4;

interface Part {
  mesh: THREE.Mesh;
  image: CanvasImageSource & { width: number; height: number };
}

/** Pack every textured MeshStandardMaterial part under `root` into one atlas
 *  and one shared material. Mutates the parts' geometry UVs in place (call it
 *  once on a loaded source, before cloning). Returns how many parts moved. */
export function atlasModelTextures(root: THREE.Object3D, label: string): number {
  const parts: Part[] = [];
  const geoSeen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const img = mat.map?.image as Part['image'] | undefined;
    if (!img || !img.width || !img.height) return;
    const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute | undefined;
    if (!uv || geoSeen.has(mesh.geometry)) return;   // a shared geometry would be remapped twice
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < 0 || u > 1 || v < 0 || v > 1) return;   // tiling UVs can't live in a tile
    }
    geoSeen.add(mesh.geometry);
    parts.push({ mesh, image: img });
  });
  if (parts.length < 2 || typeof document === 'undefined') return 0;

  // ── Shelf packing, tallest first, into a fixed width ─────────────────────
  const W = 2048;
  const order = [...parts].sort((a, b) => b.image.height - a.image.height);
  const place = new Map<Part, { x: number; y: number }>();
  let x = 0, y = 0, shelf = 0;
  for (const p of order) {
    const w = p.image.width + GUTTER * 2, h = p.image.height + GUTTER * 2;
    if (x + w > W) { x = 0; y += shelf; shelf = 0; }
    place.set(p, { x: x + GUTTER, y: y + GUTTER });
    x += w; shelf = Math.max(shelf, h);
  }
  const H = y + shelf;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  for (const p of parts) {
    const { x: px, y: py } = place.get(p)!;
    const { width: w, height: h } = p.image;
    ctx.drawImage(p.image, px, py);
    // Gutter: stretch the outermost row/column of texels outward.
    const g = GUTTER;
    ctx.drawImage(p.image, 0, 0, w, 1, px, py - g, w, g);              // top
    ctx.drawImage(p.image, 0, h - 1, w, 1, px, py + h, w, g);          // bottom
    ctx.drawImage(p.image, 0, 0, 1, h, px - g, py, g, h);              // left
    ctx.drawImage(p.image, w - 1, 0, 1, h, px + w, py, g, h);          // right
    ctx.drawImage(p.image, 0, 0, 1, 1, px - g, py - g, g, g);          // corners
    ctx.drawImage(p.image, w - 1, 0, 1, 1, px + w, py - g, g, g);
    ctx.drawImage(p.image, 0, h - 1, 1, 1, px - g, py + h, g, g);
    ctx.drawImage(p.image, w - 1, h - 1, 1, 1, px + w, py + h, g, g);
  }

  const first = parts[0].mesh.material as THREE.MeshStandardMaterial;
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.name = `${label}-atlas`;
  atlas.flipY = first.map!.flipY;              // keep the source's UV convention
  atlas.colorSpace = first.map!.colorSpace;
  atlas.magFilter = first.map!.magFilter;
  atlas.minFilter = first.map!.minFilter;
  atlas.generateMipmaps = true;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  const shared = first.clone();
  shared.name = `${label}-atlased`;
  shared.map = atlas;

  for (const p of parts) {
    const { x: px, y: py } = place.get(p)!;
    const { width: w, height: h } = p.image;
    const uv = p.mesh.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      // flipY=false (glTF): v=0 is the image's TOP row, as is the canvas's y=0.
      const u = uv.getX(i), v = uv.getY(i);
      const vv = atlas.flipY ? 1 - v : v;
      const au = (px + u * w) / W;
      const avTop = (py + vv * h) / H;
      uv.setXY(i, au, atlas.flipY ? 1 - avTop : avTop);
    }
    uv.needsUpdate = true;
    const old = p.mesh.material as THREE.MeshStandardMaterial;
    p.mesh.material = shared;
    old.map?.dispose();
    old.dispose();
  }
  return parts.length;
}
