/**
 * The image-generation backend — a swappable seam. Today: fal.ai hosted FLUX
 * (no infra, pay-per-image). Tomorrow, when the look needs a trained style LoRA
 * or ControlNet for composition, a `comfyBackend` POSTing graph JSON to a
 * RunPod ComfyUI pod drops in behind the SAME interface — specs, prompts and
 * post-process don't change. That's why this file exists: so the graph, when we
 * write it, plugs into a seam instead of a rewrite.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface GenRequest {
  prompt: string;
  negative: string;
  width: number;
  height: number;
  seed: number;
  /** Backend-specific model id; defaults per backend. */
  model?: string;
}

export interface GenResult {
  /** Raw PNG/JPEG bytes of the generated image. */
  bytes: Buffer;
  /** What the backend actually ran with (model, resolved seed) — for logging. */
  meta: Record<string, unknown>;
}

export interface ArtBackend {
  readonly name: string;
  generate(req: GenRequest): Promise<GenResult>;
}

/**
 * Read FAL_KEY from the environment, falling back to a gitignored .env.local
 * (so the key never lives in a tracked file and the CLI "just works" without a
 * dotenv dependency). Throws a clear error if missing.
 */
export function falKey(): string {
  if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('FAL_KEY='));
    if (line) return line.slice('FAL_KEY='.length).trim();
  } catch {
    /* no .env.local — fall through to the throw */
  }
  throw new Error(
    'FAL_KEY not set. Put `FAL_KEY=<id>:<secret>` in .env.local (gitignored) or export it.',
  );
}

/**
 * fal.ai FLUX backend. Uses the synchronous run endpoint (blocks until the
 * image is ready, then we fetch the bytes). The model slug is a config knob —
 * `fal-ai/flux/dev` is the cheap workhorse; swap to a flux-pro / flux-2 slug
 * via the --model flag once we're tuning quality.
 */
export const FAL_DEFAULT_MODEL = 'fal-ai/flux/dev';

export function falBackend(): ArtBackend {
  const key = falKey();
  return {
    name: 'fal',
    async generate(req) {
      const model = req.model ?? FAL_DEFAULT_MODEL;
      const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: req.prompt,
          negative_prompt: req.negative,
          image_size: { width: req.width, height: req.height },
          seed: req.seed,
          num_inference_steps: 30,
          enable_safety_checker: false,
          output_format: 'png',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`fal ${model} → ${res.status}: ${body.slice(0, 500)}`);
      }
      const json = (await res.json()) as { images?: Array<{ url: string }>; seed?: number };
      const url = json.images?.[0]?.url;
      if (!url) throw new Error(`fal returned no image: ${JSON.stringify(json).slice(0, 300)}`);
      const img = await fetch(url);
      const bytes = Buffer.from(await img.arrayBuffer());
      return { bytes, meta: { backend: 'fal', model, seed: json.seed ?? req.seed } };
    },
  };
}
