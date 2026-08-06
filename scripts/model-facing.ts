// WHICH MODELS ARE FACING THE WRONG WAY?
//
// Every placer in this game assumes a model's FRONT is its local −Z. That
// assumption is invisible: a model authored facing +X gets rotated as though −Z
// were its face, lands sideways, and looks exactly like somebody placed it
// badly. The information lives in the author's head and nowhere the renderer
// can read it.
//
// This is the detector for that. It discovers every ModelSpec exported from
// src/content/ — so a model added tomorrow is audited without touching this
// file — and measures where each one's MASS actually sits relative to the
// forward it declares (or the −Z it is assumed to have).
//
// What it reports:
//   BACKWARD  the mass sits behind the forward axis. Either the model faces the
//             other way, or it wants an explicit `mount.forward`.
//   SIDEWAYS  the model is much deeper across X than Z and its mass is off the
//             centre line — the shape of a thing authored on the X axis.
//   flat/thin  informational: a model with no meaningful depth (a decal, a
//             glow) has no front, and orienting it is meaningless either way.
//
// A detector that flags nothing looks exactly like a codebase with nothing to
// find, so it always prints the totals it examined.
//
//   npx tsx scripts/model-facing.ts [--all]

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classifyFacing, type FacingPart } from '../src/ecs/model-facing';

interface Spec {
  id?: string;
  parts?: FacingPart[];
  materials?: unknown;
  mount?: { forward?: 'x' | '-x' | 'z' | '-z' };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, '..', 'src', 'content');

function looksLikeModel(v: unknown): v is Spec {
  const s = v as Spec;
  return !!s && typeof s === 'object' && typeof s.id === 'string'
    && Array.isArray(s.parts) && s.parts.length > 0;
}

async function main(): Promise<void> {
  const showAll = process.argv.includes('--all');
  const files = readdirSync(CONTENT).filter((f) => f.endsWith('.ts'));

  const models: Array<{ file: string; name: string; spec: Spec }> = [];
  for (const f of files) {
    let mod: Record<string, unknown>;
    try {
      mod = await import(pathToFileURL(join(CONTENT, f)).href) as Record<string, unknown>;
    } catch {
      continue;   // a module that needs a browser/scene — not our business
    }
    for (const [name, v] of Object.entries(mod)) {
      if (looksLikeModel(v)) models.push({ file: f, name, spec: v });
    }
  }

  interface Row {
    file: string; name: string; id: string;
    cz: number; cx: number; depth: number; width: number; verdict: string;
  }
  const rows: Row[] = [];

  for (const { file, name, spec } of models) {
    // THE REAL CLASSIFIER, not a copy of it (docs/DESIGN-METHOD.md). This
    // script only discovers models and prints; the judgement lives in
    // src/ecs/model-facing.ts and is what the test exercises.
    const r = classifyFacing({ parts: spec.parts ?? [], forward: spec.mount?.forward });
    rows.push({ file, name, id: spec.id ?? '?', ...r });
  }

  const flagged = rows.filter((r) => r.verdict === 'BACKWARD' || r.verdict === 'SIDEWAYS');
  const shown = showAll ? rows : flagged;

  console.log(`\nmodel facing audit — ${rows.length} models across ${files.length} content files\n`);
  if (shown.length === 0) {
    console.log('  nothing flagged.');
  } else {
    console.log('  verdict   centroid z    centroid x    depth   width   model');
    for (const r of shown.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.id.localeCompare(b.id))) {
      console.log(`  ${r.verdict.padEnd(9)} ${r.cz.toFixed(3).padStart(9)} ${r.cx.toFixed(3).padStart(13)} `
        + `${r.depth.toFixed(2).padStart(7)} ${r.width.toFixed(2).padStart(7)}   ${r.id}  (${r.file} · ${r.name})`);
    }
  }
  const counts = rows.reduce<Record<string, number>>((a, r) => (a[r.verdict] = (a[r.verdict] ?? 0) + 1, a), {});
  console.log(`\n  totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  (run with --all to list every model)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
