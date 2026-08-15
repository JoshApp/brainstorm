/**
 * GEN-SURFACE-TEX — generate a dungeon SURFACE texture (wall / floor) with the
 * same fal/FLUX backend the tarot art already uses, and pack it into the layout
 * the surface shader reads.
 *
 *   npx tsx scripts/gen-surface-tex.ts wall
 *   npx tsx scripts/gen-surface-tex.ts floor --seed=7
 *
 * Josh: *"would it be easier to use textures for this that we could ai generate
 * etc"* → *"can you generate one and drop it in"*. This is the experiment, not
 * a commitment: the shader can swap between this and the CPU-baked procedural
 * texture with ?surftex=ai|proc, so the two can be judged side by side rather
 * than argued about.
 *
 * ── WHAT THE SHADER NEEDS, AND WHY IT ISN'T JUST AN IMAGE ────────────────────
 * style/surface-detail.ts samples ONE texture and reads:
 *      RGB  the stone's colour
 *      A    HEIGHT — drives both the normal perturbation and the POM march
 * A diffusion model gives us RGB and nothing else, so the alpha has to be
 * derived. Luminance is the honest approximation for stone lit flat: mortar and
 * cracks are darker than the faces that catch light, so dark ≈ deep. It is an
 * approximation — a dark STAIN reads as a hole to it — which is exactly the
 * kind of thing this experiment is meant to expose.
 *
 * ── SEAMLESSNESS ────────────────────────────────────────────────────────────
 * FLUX does not reliably produce a tiling image, and this texture is tiled
 * every few metres across every wall in the game. The offset-and-blend pass
 * below is the classic fix: roll the image by half in both axes so the former
 * edges meet in the middle, then cross-fade a band across those seams. It is
 * not as good as a model that was asked for a tile, and the trade shows up as
 * a soft cross through the middle of the texture — worth knowing before
 * judging the result.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { PNG } from 'pngjs';
import { falBackend } from './art-backend';

type Kind = 'wall' | 'floor';

// The prompts lean on the game's own references (docs/VISUAL-LANGUAGE.md,
// CLAUDE.md's Visual Style) rather than generic "dungeon wall", because the
// point is to test whether a generated texture can hit DELVE's look — not
// whether FLUX can draw stone.
const PROMPTS: Record<Kind, { prompt: string; negative: string }> = {
  wall: {
    prompt:
      'seamless tileable texture of an ancient dungeon wall, rough hewn stone blocks of '
      + 'varying size and colour, deep mortar joints packed with grime, greasy soot stains, '
      + 'patches of dark green moss and pale lichen in the crevices, water seepage running '
      + 'down, chipped and spalled block faces, worn smooth in places, cold damp catacomb, '
      + 'orthographic flat-lit material scan, high detail, muted desaturated palette',
    negative:
      'perspective, vanishing point, lighting, shadows, highlights, vignette, people, text, '
      + 'watermark, border, frame, bright colours, cartoon, clean, new, polished, symmetrical',
  },
  floor: {
    prompt:
      'seamless tileable texture of an ancient dungeon floor, irregular polygonal flagstones '
      + 'of differing stone types, cracked and sunken, deep gaps packed with dirt and grit, '
      + 'a few stones missing leaving bare earth, greasy worn surface, damp patches, '
      + 'orthographic flat-lit material scan, top down, high detail, muted desaturated palette',
    negative:
      'perspective, vanishing point, lighting, shadows, highlights, vignette, people, text, '
      + 'watermark, border, frame, bright colours, cartoon, clean, new, polished, grass, plants',
  },
};

const args = process.argv.slice(2);
const kind = (args.find((a) => !a.startsWith('--')) ?? 'wall') as Kind;
const seedArg = args.find((a) => a.startsWith('--seed='));
const seed = seedArg ? parseInt(seedArg.slice('--seed='.length), 10) : 1;
if (kind !== 'wall' && kind !== 'floor') {
  console.error(`unknown kind '${kind}' — expected wall | floor`);
  process.exit(1);
}

/** Wrap-roll by half in both axes, then cross-fade the seams that lands in the middle. */
function makeSeamless(png: PNG, band: number): PNG {
  const { width: W, height: H } = png;
  const out = new PNG({ width: W, height: H });
  const at = (src: PNG, x: number, y: number) => ((y * W + x) << 2);
  // 1. roll by half — the original edges now meet down the centre lines.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = (x + (W >> 1)) % W, sy = (y + (H >> 1)) % H;
      const s = at(png, sx, sy), d = at(out, x, y);
      out.data[d] = png.data[s]; out.data[d + 1] = png.data[s + 1];
      out.data[d + 2] = png.data[s + 2]; out.data[d + 3] = png.data[s + 3];
    }
  }
  // 2. cross-fade across the vertical centre seam, then the horizontal one,
  //    pulling from the mirrored side so the blend has something to blend WITH.
  const blendAxis = (vertical: boolean) => {
    const mid = vertical ? (W >> 1) : (H >> 1);
    for (let i = -band; i <= band; i++) {
      const t = 0.5 * (1 - Math.cos(((i + band) / (2 * band)) * Math.PI)); // smooth 0..1
      const w = Math.abs(i) / band;                                        // 0 at seam
      const k = 0.5 * (1 - w);                                             // blend weight
      const span = vertical ? H : W;
      for (let j = 0; j < span; j++) {
        const x = vertical ? (mid + i + W) % W : j;
        const y = vertical ? j : (mid + i + H) % H;
        const mx = vertical ? (mid - i + W) % W : j;
        const my = vertical ? j : (mid - i + H) % H;
        const a = at(out, x, y), b = at(out, mx, my);
        for (let c = 0; c < 3; c++) {
          out.data[a + c] = Math.round(out.data[a + c] * (1 - k) + out.data[b + c] * k);
        }
      }
      void t;
    }
  };
  blendAxis(true);
  blendAxis(false);
  return out;
}

/** Output resolution. See the note in main() on why smaller is BETTER here. */
const OUT_SIZE = 512;

/** Separable box blur of a scalar field, wrapping at the edges (the texture tiles). */
function blurWrap(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * W + ((k % W) + W) % W];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc * inv;
      acc -= src[y * W + ((x - r % W) + W) % W];
      acc += src[y * W + ((x + r + 1) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((((k % H) + H) % H) * W) + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * inv;
      acc -= tmp[(((y - r) % H + H) % H) * W + x];
      acc += tmp[(((y + r + 1) % H) * W) + x];
    }
  }
  return out;
}

/**
 * DE-LIGHT — divide out the lighting the model baked into the image.
 *
 * Josh: *"yeah do the torches do lighting."* This is the fix, and it matters
 * more here than in most games: DELVE's whole premise is that form is REVEALED
 * by coloured light out of black. A texture that arrives with its own shading
 * already painted on fights that at every pixel — the stone looks lit from
 * somewhere that isn't your torch, and no amount of dynamic lighting can undo a
 * shadow that is baked into the albedo.
 *
 * The standard fix: estimate the LOCAL MEAN brightness with a wide blur, then
 * divide by it. Lighting is low-frequency (broad gradients across the image);
 * material is high-frequency (the grain of the stone). Dividing removes the
 * former and keeps the latter, so the result is closer to a flat albedo scan
 * and the torches get to do the work.
 */
function deLight(png: PNG): void {
  const { width: W, height: H } = png;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * png.data[p] + 0.587 * png.data[p + 1] + 0.114 * png.data[p + 2];
  }
  // Radius ~1/8 of the image: wide enough to be "the lighting", narrow enough
  // to leave block-scale variation alone.
  const local = blurWrap(lum, W, H, Math.max(4, W >> 3));
  let mean = 0;
  for (let i = 0; i < lum.length; i++) mean += lum[i];
  mean /= lum.length;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    // Clamped gain — an unbounded divide blows out wherever the blur went dark.
    const gain = Math.max(0.55, Math.min(1.8, mean / Math.max(1, local[i])));
    for (let c = 0; c < 3; c++) {
      png.data[p + c] = Math.max(0, Math.min(255, Math.round(png.data[p + c] * gain)));
    }
  }
}

/** Simple box downscale by an integer factor, averaging RGBA. */
function downscale(png: PNG, size: number): PNG {
  if (png.width <= size) return png;
  const f = Math.round(png.width / size);
  const out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < f; j++) {
        for (let i = 0; i < f; i++) {
          const s = (((y * f + j) * png.width) + (x * f + i)) << 2;
          r += png.data[s]; g += png.data[s + 1]; b += png.data[s + 2]; a += png.data[s + 3];
        }
      }
      const n = f * f, d = ((y * size) + x) << 2;
      out.data[d] = r / n; out.data[d + 1] = g / n;
      out.data[d + 2] = b / n; out.data[d + 3] = a / n;
    }
  }
  return out;
}

async function main() {
  const backend = falBackend();
  const { prompt, negative } = PROMPTS[kind];
  console.log(`[gen-surface-tex] ${kind} · seed ${seed} · ${backend.name}`);
  const res = await backend.generate({ prompt, negative, width: 1024, height: 1024, seed });
  console.log(`[gen-surface-tex] generated ${res.bytes.length} bytes`, res.meta);

  const raw = PNG.sync.read(res.bytes);
  const tiled = makeSeamless(raw, Math.max(8, raw.width >> 5));
  deLight(tiled);
  const out = downscale(tiled, OUT_SIZE);

  // ── HEIGHT, from LOCAL relief rather than absolute brightness ──────────────
  // Josh: *"can we use like depth on these textures to fake like 3dness? would
  // that work?"* — yes, and it already does: POM marches whatever is in alpha.
  // The question is what to put there.
  //
  // v1 used raw luminance, which conflates "dark" with "deep". A soot stain and
  // a mortar joint are equally dark and only one is a hole, so stains were being
  // carved into the wall. Using luminance MINUS its local mean measures relief
  // instead: how much darker this pixel is than its own neighbourhood. A broad
  // stain shifts pixel and neighbourhood together and cancels; a joint is dark
  // against bright faces a few pixels away and survives.
  const W = out.width, H = out.height;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * out.data[p] + 0.587 * out.data[p + 1] + 0.114 * out.data[p + 2];
  }
  const localMean = blurWrap(lum, W, H, Math.max(2, W >> 6));   // ~8px at 512
  let lo = 1e9, hi = -1e9;
  const rel = new Float32Array(W * H);
  for (let i = 0; i < rel.length; i++) {
    rel[i] = lum[i] - localMean[i];
    if (rel[i] < lo) lo = rel[i];
    if (rel[i] > hi) hi = rel[i];
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < rel.length; i++, p += 4) {
    const n = (rel[i] - lo) / span;             // 0 = deepest … 1 = proudest
    out.data[p + 3] = Math.round(Math.max(0, Math.min(1, 0.18 + n * 0.82)) * 255);
  }

  const outPath = resolve(process.cwd(), `public/art/surfaces/${kind}-ai.png`);
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, PNG.sync.write(out));
  const kb = Math.round(PNG.sync.write(out).length / 1024);
  // WHY 512 AND NOT 1024, since "could we compress it" was the other question:
  // shrinking is both the compression AND a fix for *"it pixelates quite hard"*.
  // The scene renders at a 0.4x PS1 buffer, so a 1024 texture carries far more
  // detail than there are pixels to show it — and detail finer than a pixel
  // does not resolve, it ALIASES, which is what the sparkle in Josh's
  // screenshots is. Less texture is literally less noise here.
  console.log(`[gen-surface-tex] wrote ${outPath} (${W}x${H}, ${kb} KB, RGB=albedo A=height)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
