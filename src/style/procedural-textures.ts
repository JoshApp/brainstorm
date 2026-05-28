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

// --- Built-in textures ---

// 'fire-wisp' — a soft, radial fire blob. Hot yellow-white core fading to
// orange to red to transparent at the edges. Used as an additive-blended
// sprite above torch flames so torches glow into the air above them.
registerTexture('fire-wisp', (canvas) => {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Slightly elongated vertical to suggest flame shape, with a hot core that
  // falls off into ember orange and then transparent.
  const cx = w / 2;
  const cy = h / 2;
  const grad = ctx.createRadialGradient(cx, cy * 1.05, 0, cx, cy * 0.95, w * 0.48);
  grad.addColorStop(0.00, 'rgba(255, 240, 200, 1.00)');
  grad.addColorStop(0.15, 'rgba(255, 200, 110, 0.95)');
  grad.addColorStop(0.35, 'rgba(255, 130,  40, 0.65)');
  grad.addColorStop(0.65, 'rgba(180,  40,  10, 0.25)');
  grad.addColorStop(1.00, 'rgba( 30,   0,   0, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
});

// 'moonbeam' — neutral white-to-transparent radial gradient. NO red /
// orange in the gradient (unlike fire-wisp), so material-level colour
// tinting is the ONLY thing that decides the visible hue. Used by the
// stair shaft + motes (and any other "shaft of light" prop) so the
// blue passive state stays blue and the gold active state stays gold —
// the texture's edges don't poison the colour the way fire-wisp's red
// edge does when tinted blue.
registerTexture('moonbeam', (canvas) => {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
  grad.addColorStop(0.00, 'rgba(255, 255, 255, 1.00)');
  grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.75)');
  grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.30)');
  grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.08)');
  grad.addColorStop(1.00, 'rgba(255, 255, 255, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
});

// 'moss-patch' — irregular green-grey blob with darker veins. Used as wall and
// floor decals to break up uniform stone. Alpha-faded edges so it blends into
// the surface it sits on. Procedural noise gives each patch a unique shape.
registerTexture('moss-patch', (canvas) => {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // Stipple-noise of mossy dots, denser in center, sparser at edges. Each dot
  // randomized in color (greens to greys) and size for organic feel.
  const dotCount = 240;
  for (let i = 0; i < dotCount; i++) {
    // Bias toward center via two coordinate samples
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 1.3) * (w * 0.45);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const edgeFade = 1 - r / (w * 0.45);
    const alpha = (0.25 + Math.random() * 0.55) * edgeFade;
    if (alpha <= 0) continue;
    // Color: muted greens with brown undertones, occasional darker spots
    const g = 50 + Math.floor(Math.random() * 50);
    const rr = 20 + Math.floor(Math.random() * 30);
    const bb = 25 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgba(${rr}, ${g}, ${bb}, ${alpha.toFixed(2)})`;
    const sz = 1.5 + Math.random() * 3.5;
    ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
  }
});

// 'blood-splatter' — irregular dark-red stain with droplet outliers. Used as
// floor decals near dead-enemy locations or as wall stains.
registerTexture('blood-splatter', (canvas) => {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // Main pool — radial gradient of dark red
  const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.32);
  pool.addColorStop(0.00, 'rgba(70, 8, 6, 0.95)');
  pool.addColorStop(0.55, 'rgba(45, 6, 4, 0.75)');
  pool.addColorStop(1.00, 'rgba(20, 2, 2, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);

  // Spatter droplets at random angles around the pool
  const spatters = 35;
  for (let i = 0; i < spatters; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = w * 0.20 + Math.random() * w * 0.30;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const sz = 1 + Math.random() * 4;
    const alpha = 0.4 + Math.random() * 0.45;
    ctx.fillStyle = `rgba(60, 8, 6, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
});

// 'soot-streak' — vertical sooty smudge for above-torch wall darkening or
// general grime. Long thin shape, dark and translucent.
registerTexture('soot-streak', (canvas) => {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Vertical streak — wider at bottom, narrowing toward top. Darker at edges
  // (gradient mask), lots of noise.
  for (let py = 0; py < h; py++) {
    const tY = py / h;
    const widthAtY = (1 - tY * 0.6) * w * 0.55;
    const cx = w / 2;
    for (let px = 0; px < w; px++) {
      const dx = (px - cx);
      const inStreak = Math.abs(dx) < widthAtY;
      if (!inStreak) continue;
      const edgeDist = 1 - Math.abs(dx) / widthAtY;
      const verticalFade = 1 - Math.pow(Math.abs(tY - 0.6) * 1.8, 2);
      const alpha = 0.5 * edgeDist * Math.max(0, verticalFade) * (0.5 + Math.random() * 0.5);
      if (alpha <= 0.02) continue;
      ctx.fillStyle = `rgba(8, 6, 4, ${alpha.toFixed(2)})`;
      ctx.fillRect(px, py, 1, 1);
    }
  }
});

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
