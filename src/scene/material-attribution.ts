import type { DelveRenderer } from './create-renderer';

// ── EVERY PIPELINE GETS A NAME ───────────────────────────────────────────────
//
// The pipeline census (debug/pipeline-census.ts) attributes each in-play compile
// to a material by reading the shader program's name — which three takes from
// `material.name` when it mints the ProgrammableStage (Pipelines.js: `const name =
// renderObject.material ? renderObject.material.name : ''`). A material with no
// name produces a program with no name, and the census reports it as `?`.
//
// Measured after the duplicate-shader fix (2026-08-21): `?` was the LARGEST
// in-play bucket, 44 of 128 compiles. A third of the instrument's own signal was
// unattributable, which is the difference between "122 compiles" and a list of
// things you can go fix.
//
// Naming every material by hand at its creation site is the version that rots —
// it is the same failure the self-registering warmup registry exists to avoid
// (add a material, forget the name, lose the attribution silently). So the name
// is filled in at the ONE place it is read: any material that reaches pipeline
// creation without a name gets one derived from its type and the object it is
// drawn on.
//
// SAFE BY CONSTRUCTION: `material.name` is explicitly excluded from three's
// material cache key — `RenderObject.getMaterialCacheKey` skips it by regex
// (`/^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData)$/`) — so a name
// can never move a cache key, a shader, or a pipeline. It reaches only the
// pipeline's debug label and our own reports. DELVE never branches on a material
// name being empty; the four places that touch `material.name` all WRITE one, for
// exactly this purpose (build-model, flame-mesh-batch, sprite-batch,
// material-registry).
//
// PROD-SAFE and deliberately not DEV-gated: the census rides along in a
// recording's `meta.pipelineCensus` because the behaviour is WebGPU-only and can
// only be measured on a real device. An attribution that never reaches the phone
// would leave the phone's report reading `?`. Cost is one string per material,
// once, at first pipeline creation.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Short, stable aliases so the census reads as a report rather than a stack of
 *  class names. Anything unlisted falls through to its own type. */
const TYPE_ALIAS: Readonly<Record<string, string>> = {
  MeshStandardMaterial: 'std', MeshStandardNodeMaterial: 'std',
  MeshBasicMaterial: 'basic', MeshBasicNodeMaterial: 'basic',
  MeshPhysicalMaterial: 'phys', MeshPhysicalNodeMaterial: 'phys',
  SpriteMaterial: 'sprite', SpriteNodeMaterial: 'sprite',
  PointsMaterial: 'points', PointsNodeMaterial: 'points',
  LineBasicMaterial: 'line', LineBasicNodeMaterial: 'line',
};

/** Where this material was first seen drawing, when that is knowable.
 *
 *  Often it is NOT: a material's pipeline is frequently first created while its
 *  object is still detached (pooled effects, warm dummies), so `object.name` and
 *  `object.parent` are both empty and this returns ''. That is why the variant
 *  tags below carry the discrimination and the site is only a bonus.
 *
 *  Truncated at `@`, because build-model's autoName bakes COORDINATES into the
 *  name (`box·iron@0,0.06,0.22`). Left whole, every instance would be its own
 *  census row and the report would be longer than the problem. */
function siteOf(object: any): string {
  const raw: string = object?.name || object?.parent?.name || '';
  return raw.split('@')[0].slice(0, 40);
}

/** The properties that decide which PIPELINE a material compiles into, in the
 *  order the census's own `KEY_FIELDS` lists them. Without these, every unnamed
 *  basic material in the game collapses into one row called `auto:basic` — true,
 *  but not something anyone can act on. With them, a row reads "additive,
 *  depth-write off, double-sided" and names its own fix. */
function variantOf(material: any): string {
  const tags: string[] = [];
  if (material.transparent) tags.push('t');
  if (material.blending !== undefined && material.blending !== 1) tags.push(`b${material.blending}`);
  if (material.depthWrite === false) tags.push('nd');
  if (material.depthTest === false) tags.push('nz');
  if (material.side) tags.push(`s${material.side}`);
  return tags.join(',');
}

let installed = false;
let named = 0;

/** How many materials this session reached pipeline creation unnamed. Trending
 *  DOWN is not the goal — the auto-name is the fix, not a warning. It is a
 *  census-health number: if it is 0, every pipeline was named at its source. */
export function autoNamedMaterialCount(): number { return named; }

/** Install right after `init()`, BEFORE anything renders or compiles — the name
 *  has to be in place the first time a material reaches `getForRender`, because
 *  that is when the ProgrammableStage captures it. Idempotent. */
export function installMaterialAttribution(renderer: DelveRenderer): void {
  if (installed) return;
  const pipelines = (renderer as any)._pipelines;
  if (!pipelines || typeof pipelines.getForRender !== 'function') {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[material-attribution] renderer._pipelines.getForRender missing — not installed');
    }
    return;
  }

  const orig = pipelines.getForRender.bind(pipelines);
  // Wraps BOTH call sites — `Renderer._renderObjectDirect` and the `compileAsync`
  // path the warm uses — because they both funnel through this one method.
  pipelines.getForRender = (renderObject: any, promises: unknown = null): unknown => {
    const material = renderObject?.material;
    if (material && !material.name) {
      const kind = TYPE_ALIAS[material.type as string] ?? material.type ?? 'material';
      const site = siteOf(renderObject.object);
      const variant = variantOf(material);
      material.name = `auto:${kind}${site ? `@${site}` : ''}${variant ? `|${variant}` : ''}`;
      named++;
    }
    return orig(renderObject, promises);
  };

  installed = true;
  if (typeof window !== 'undefined') {
    (window as unknown as { __autoNamedMaterials?: () => number })
      .__autoNamedMaterials = autoNamedMaterialCount;
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[material-attribution] unnamed materials will be auto-named at pipeline creation');
  }
}
