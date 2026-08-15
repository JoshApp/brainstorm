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

async function main() {
  const backend = falBackend();
  const { prompt, negative } = PROMPTS[kind];
  console.log(`[gen-surface-tex] ${kind} · seed ${seed} · ${backend.name}`);
  const res = await backend.generate({ prompt, negative, width: 1024, height: 1024, seed });
  console.log(`[gen-surface-tex] generated ${res.bytes.length} bytes`, res.meta);

  const raw = PNG.sync.read(res.bytes);
  const tiled = makeSeamless(raw, Math.max(8, raw.width >> 5));

  // Pack HEIGHT into alpha from luminance. Contrast-stretched so mortar reads
  // as properly deep rather than "slightly darker" — POM needs range to march
  // through, and a flat height field is the thing that made the procedural
  // version look painted on before relief existed.
  let lo = 255, hi = 0;
  const lum = new Float32Array(tiled.width * tiled.height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const l = 0.299 * tiled.data[p] + 0.587 * tiled.data[p + 1] + 0.114 * tiled.data[p + 2];
    lum[i] = l; if (l < lo) lo = l; if (l > hi) hi = l;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const n = (lum[i] - lo) / span;             // 0 = darkest (deep) … 1 = face
    tiled.data[p + 3] = Math.round(Math.max(0, Math.min(1, 0.25 + n * 0.75)) * 255);
  }

  const outPath = resolve(process.cwd(), `public/art/surfaces/${kind}-ai.png`);
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, PNG.sync.write(tiled));
  console.log(`[gen-surface-tex] wrote ${outPath} (${tiled.width}x${tiled.height}, RGB=albedo A=height)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
