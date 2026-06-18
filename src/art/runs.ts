/**
 * The run model — shared between the generator (scripts/) and the viewer.
 *
 * Art exploration is a FORKING TREE, not a pipeline: you generate a batch, see
 * something, branch from THAT with a tweak, recombine, compare siblings. So
 * every generation is an immutable RUN, appended to a manifest and never
 * overwritten. A run records exactly how it was made (prompt, seed, model) and
 * what it forked FROM (parentId) so the lineage is reconstructable.
 *
 * Files live under public/art/ (gitignored — exploration, not shipped):
 *   public/art/runs/index.json   the manifest
 *   public/art/runs/<id>.png     one immutable image per run
 */

export type RunKind = 'card' | 'frame' | 'texture';

export interface ArtRun {
  id: string;            // 'r1', 'r2', … — stable, also the filename
  n: number;             // monotonic ordinal
  kind: RunKind;
  subject: string;       // card id (e.g. 'the-glutton') or frame key (e.g. 'etched')
  style: string;         // StyleId for cards, FrameId for frames
  prompt: string;        // the full positive prompt used
  negative: string;
  seed: number;
  model: string;
  parentId: string | null; // the run this forked from, if any
  tweak?: string;        // the delta phrase appended when forking ("more crimson")
  note?: string;         // freeform label
  createdAt: string;     // ISO
  width: number;
  height: number;
  file: string;          // 'runs/<id>.png' relative to public/art/
}

export interface ArtManifest {
  runs: ArtRun[];
  /** card subject -> chosen run id (the art the deck composites). */
  promoted: Record<string, string>;
  /** the single active frame run id (the deck composites against this). */
  activeFrame: string | null;
}

export const EMPTY_MANIFEST: ArtManifest = { runs: [], promoted: {}, activeFrame: null };

/** Children of a run, by parentId. */
export function childrenOf(manifest: ArtManifest, id: string): ArtRun[] {
  return manifest.runs.filter((r) => r.parentId === id);
}

/** All runs for a subject, oldest→newest. */
export function runsFor(manifest: ArtManifest, subject: string): ArtRun[] {
  return manifest.runs.filter((r) => r.subject === subject);
}
