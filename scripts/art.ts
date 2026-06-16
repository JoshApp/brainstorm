/**
 * delve art — the art exploration generator. Append-only & forkable: every
 * generation is an immutable run (see src/art/runs.ts). Nothing is overwritten,
 * so the viewer can show the whole forking tree and you can compare iterations.
 *
 *   delve art                                 status (cards · styles · frames · runs)
 *   delve art ls [subject]                    list runs (optionally for one subject)
 *   delve art card the-glutton                generate 1 (default style = ink)
 *   delve art card the-glutton --n 4          a batch of 4 (seed-jittered) to explore
 *   delve art card the-glutton --style painted
 *   delve art card the-glutton --from r3 --tweak "more crimson, less light"
 *   delve art frame etched                    one frame candidate
 *   delve art frame all --n 2                 every frame variant, x2 each
 *   delve art promote r7                       mark r7 the chosen card art / active frame
 *
 * NOTE: run via `npx tsx scripts/art.ts …` (or `delve art …`). Plain `npm run
 * delve art --flag` has npm swallow the --flags; positionals pass fine.
 */
import { writeFileSync } from 'node:fs';
import { CARD_ART } from '../src/art/cards';
import {
  STYLES, DEFAULT_STYLE, type StyleId,
  FRAMES, FRAME_NEGATIVE, ILLUSTRATION_SIZE, FRAME_SIZE,
} from '../src/art/style';
import type { ArtRun, RunKind, ArtManifest } from '../src/art/runs';
import { runsFor } from '../src/art/runs';
import { falBackend, type ArtBackend } from './art-backend';
import * as M from './art-runs';

// ── arg parsing ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VALUED = new Set(['--style', '--model', '--from', '--tweak', '--note', '--n', '--seed']);
const flags: Record<string, string> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUED.has(a)) flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = 'true';
  else pos.push(a);
}
const [cmd, arg1] = pos;
const N = Math.max(1, Number(flags.n ?? 1));

function isoNow(): string { return new Date().toISOString(); }

async function runOne(
  backend: ArtBackend, m: ArtManifest,
  kind: RunKind, subject: string, style: string,
  prompt: string, negative: string, seed: number, w: number, h: number,
  parentId: string | null, tweak: string | undefined,
): Promise<ArtRun | null> {
  const { id, n } = M.nextId(m);
  process.stdout.write(`  ${id} ${subject} [${style}] seed=${seed}${parentId ? ` ⟜${parentId}` : ''}… `);
  const t = Date.now();
  try {
    const r = await backend.generate({ prompt, negative, width: w, height: h, seed, model: flags.model });
    M.save(m); // ensure dir
    writeFileSync(M.runImagePath(id), r.bytes);
    const run: ArtRun = {
      id, n, kind, subject, style, prompt, negative, seed,
      model: String((r.meta as { model?: string }).model ?? 'fal'),
      parentId, tweak, note: flags.note, createdAt: isoNow(),
      width: w, height: h, file: `runs/${id}.png`,
    };
    M.addRun(m, run);
    M.save(m);
    console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    return run;
  } catch (e) {
    console.log('FAILED');
    console.error(`    ${(e as Error).message}`);
    return null;
  }
}

function composeCardPrompt(base: string, art: string, accent?: string, tweak?: string): string {
  const accentClause = accent ? `, the single spot colour a ${accent}` : '';
  return `${base}${accentClause}. ${art}${tweak ? `, ${tweak}` : ''}`;
}

async function main() {
  const m = M.load();

  // ── status ────────────────────────────────────────────────────────────────
  if (!cmd) {
    console.log(`\nDELVE art suite — ${m.runs.length} runs · ${Object.keys(m.promoted).length} promoted · frame=${m.activeFrame ?? '—'}\n`);
    console.log(`CARDS (${CARD_ART.length}):  ${CARD_ART.map((c) => c.id).join('  ')}`);
    console.log(`STYLES:  ${Object.entries(STYLES).map(([k, v]) => `${k}${k === DEFAULT_STYLE ? '*' : ''}`).join('  ')}   (${Object.values(STYLES).map((s) => s.label).join(' · ')})`);
    console.log(`FRAMES:  ${Object.keys(FRAMES).join('  ')}   ·  'all'`);
    console.log(`\n  delve art card <id> [--n K] [--style s] [--from rX] [--tweak "…"]`);
    console.log(`  delve art frame <key|all> [--n K]`);
    console.log(`  delve art promote rX   ·   delve art ls [subject]`);
    return;
  }

  // ── ls ──────────────────────────────────────────────────────────────────────
  if (cmd === 'ls') {
    const runs = arg1 ? runsFor(m, arg1) : m.runs;
    console.log(`\n${runs.length} run(s)${arg1 ? ` for ${arg1}` : ''}:`);
    for (const r of runs) {
      const badge = m.promoted[r.subject] === r.id ? ' ★' : m.activeFrame === r.id ? ' ◆frame' : '';
      console.log(`  ${r.id.padEnd(5)} ${r.kind.padEnd(5)} ${r.subject.padEnd(14)} ${r.style.padEnd(8)} seed=${String(r.seed).padEnd(6)}${r.parentId ? `⟜${r.parentId} ` : ''}${r.tweak ? `“${r.tweak}” ` : ''}${badge}`);
    }
    return;
  }

  // ── promote ───────────────────────────────────────────────────────────────
  if (cmd === 'promote') {
    if (!arg1) { console.error('usage: delve art promote rX'); process.exit(1); }
    const run = M.promote(m, arg1);
    M.save(m);
    console.log(run.kind === 'frame' ? `active frame → ${run.id}` : `${run.subject} → ${run.id}`);
    return;
  }

  const backend = falBackend();

  // ── frame <key|all> ─────────────────────────────────────────────────────────
  if (cmd === 'frame') {
    const keys = (arg1 === 'all' || !arg1) ? Object.keys(FRAMES) : [arg1];
    const baseSeed = Number(flags.seed ?? 7000);
    console.log(`\ndelve art — frames [${keys.join(', ')}] x${N} via ${backend.name}\n`);
    let ok = 0;
    for (const key of keys) {
      const def = FRAMES[key as keyof typeof FRAMES];
      if (!def) { console.error(`  no frame '${key}'`); continue; }
      const tweak = flags.tweak;
      const prompt = `${def.prompt}${tweak ? `, ${tweak}` : ''}`;
      for (let i = 0; i < N; i++) {
        const r = await runOne(backend, m, 'frame', key, key, prompt, FRAME_NEGATIVE, baseSeed + i, FRAME_SIZE.width, FRAME_SIZE.height, flags.from ?? null, tweak);
        if (r) ok++;
      }
    }
    console.log(`\n${ok} frame run(s).`);
    return;
  }

  // ── card <id> ─────────────────────────────────────────────────────────────
  if (cmd === 'card') {
    const spec = CARD_ART.find((c) => c.id === arg1);
    if (!spec) { console.error(`no card '${arg1}'. known: ${CARD_ART.map((c) => c.id).join(', ')}`); process.exit(1); }

    const parent = flags.from ? M.findRun(m, flags.from) : undefined;
    if (flags.from && !parent) { console.error(`no run ${flags.from}`); process.exit(1); }

    const styleId = (flags.style ?? parent?.style ?? DEFAULT_STYLE) as StyleId;
    const style = STYLES[styleId];
    const baseSeed = Number(flags.seed ?? parent?.seed ?? spec.seed);
    const tweak = flags.tweak;
    // forking from a parent: extend the parent's exact prompt; else compose fresh.
    const prompt = parent
      ? `${parent.prompt}${tweak ? `, ${tweak}` : ''}`
      : composeCardPrompt(style.prompt, spec.art, spec.accent, tweak);

    console.log(`\ndelve art — ${spec.id} x${N} · style=${styleId}${parent ? ` (fork ⟜${parent.id})` : ''} via ${backend.name}\n`);
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const r = await runOne(backend, m, 'card', spec.id, styleId, prompt, style.negative, baseSeed + i, ILLUSTRATION_SIZE.width, ILLUSTRATION_SIZE.height, parent?.id ?? null, tweak);
      if (r) ok++;
    }
    console.log(`\n${ok}/${N} run(s) for ${spec.id}.  promote one:  delve art promote <id>`);
    return;
  }

  console.error(`unknown command '${cmd}'. try: card · frame · promote · ls`);
  process.exit(1);
}

main();
