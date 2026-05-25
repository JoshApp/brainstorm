import * as THREE from 'three';

// Procedural texture registry for sprite-based parts.
//
// Sprites (in ModelSpec parts of kind 'sprite') reference a texture by ID.
// At first lookup we run the registered generator to draw to a canvas, then
// wrap it as a THREE.CanvasTexture. NEAREST filtering preserves the chunky
// PSX aesthetic instead of blurring on scale-up.
//
// New textures: just register a generator function that draws to the canvas.
// No PNG files, no asset pipeline.

type TextureGenerator = (canvas: HTMLCanvasElement) => void;

const generators = new Map<string, TextureGenerator>();
const cache = new Map<string, THREE.Texture>();

export function registerTexture(id: string, generator: TextureGenerator) {
  generators.set(id, generator);
}

export function getTexture(id: string): THREE.Texture {
  const cached = cache.get(id);
  if (cached) return cached;

  const gen = generators.get(id);
  if (!gen) {
    // eslint-disable-next-line no-console
    console.warn(`Unknown texture id: ${id}`);
    const fallback = makeMissingTexture();
    cache.set(id, fallback);
    return fallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  gen(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(id, tex);
  return tex;
}

function makeMissingTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 4, 4);
  ctx.fillRect(4, 4, 4, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
