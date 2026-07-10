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
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CARD_ART } from '../src/art/cards';
import { RELIC_ART } from '../src/art/relic-art';
import { SIGIL_SUBJECT } from '../src/art/domains';
import {
  STYLES, DEFAULT_STYLE, type StyleId,
  FRAMES, FRAME_NEGATIVE, ILLUSTRATION_SIZE, FRAME_SIZE,
} from '../src/art/style';
import type { ArtRun, RunKind, ArtManifest } from '../src/art/runs';
import { runsFor } from '../src/art/runs';
import { TEXTURES, TEXTURE_SIZE } from '../src/art/textures';
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

// Relics reuse the style's ink REGISTER (palette / chiaroscuro / deep-black
// edges) but are a single occult OBJECT, not a framed tarot card — steer FLUX
// off the card format so it renders a thing you'd pick up off a corpse.
function composeRelicPrompt(base: string, art: string, accent?: string, tweak?: string): string {
  const accentClause = accent ? `, the single spot colour a ${accent}` : '';
  return `${base}${accentClause}. a single grotesque occult relic object, NOT a tarot card, no card, no border, no frame — just the object on a black ground: ${art}${tweak ? `, ${tweak}` : ''}`;
}

async function main() {
  const m = M.load();

  // ── status ────────────────────────────────────────────────────────────────
  if (!cmd) {
    console.log(`\nDELVE art suite — ${m.runs.length} runs · ${Object.keys(m.promoted).length} promoted · frame=${m.activeFrame ?? '—'}\n`);
    console.log(`CARDS (${CARD_ART.length}):  ${CARD_ART.map((c) => c.id).join('  ')}`);
    console.log(`RELICS (${RELIC_ART.length}):  ${RELIC_ART.map((r) => r.id).join('  ')}`);
    console.log(`STYLES:  ${Object.entries(STYLES).map(([k, v]) => `${k}${k === DEFAULT_STYLE ? '*' : ''}`).join('  ')}   (${Object.values(STYLES).map((s) => s.label).join(' · ')})`);
    console.log(`FRAMES:  ${Object.keys(FRAMES).join('  ')}   ·  'all'`);
    console.log(`TEXTURES:  ${Object.keys(TEXTURES).join('  ')}   ·  'all'`);
    console.log(`\n  delve art card <id> [--n K] [--style s] [--from rX] [--tweak "…"]`);
    console.log(`  delve art relic <id> [--n K] [--style s] [--from rX] [--tweak "…"]`);
    console.log(`  delve art frame <key|all> [--n K]`);
    console.log(`  delve art texture <id|all> [--n K] [--from rX] [--tweak "…"]`);
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

  // ── sigil <domain|all> ──────────────────────────────────────────────────────
  // AI-generated ink sigils (the experiment) → public/art/sigils/<domain>.png.
  // Not in the run manifest — a fixed set, one per domain.
  if (cmd === 'sigil') {
    const dir = resolve(process.cwd(), 'public/art/sigils');
    mkdirSync(dir, { recursive: true });
    const keys = (arg1 && arg1 !== 'all') ? [arg1] : Object.keys(SIGIL_SUBJECT);
    console.log(`\ndelve art — sigils [${keys.join(', ')}] via ${backend.name}\n`);
    let ok = 0;
    for (const d of keys) {
      const s = SIGIL_SUBJECT[d as keyof typeof SIGIL_SUBJECT];
      if (!s) { console.error(`  no domain '${d}'`); continue; }
      const prompt = `a single bold occult emblem of ${s.mark}, stark woodcut linocut ink, heavy black carved ink with one bold ${s.accent} spot colour, the emblem LARGE and filling most of the frame edge to edge with only a thin cream parchment margin, simple graphic high-contrast ink stamp`;
      const negative = 'text, letters, words, numbers, writing, lettering, photographic, 3d render, realistic, multiple emblems, scene, landscape, gradient, soft shading, small emblem, tiny, lots of empty background, border, frame, ornate edge';
      process.stdout.write(`  ${d.padEnd(8)} generating… `);
      const t = Date.now();
      try {
        const r = await backend.generate({ prompt, negative, width: 640, height: 640, seed: 8000, model: flags.model });
        writeFileSync(resolve(dir, `${d}.png`), r.bytes);
        console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s) → public/art/sigils/${d}.png`);
        ok++;
      } catch (e) {
        console.log('FAILED'); console.error(`    ${(e as Error).message}`);
      }
    }
    console.log(`\n${ok}/${keys.length} sigils.`);
    return;
  }

  // ── back [--n K] ──────────────────────────────────────────────────────────
  // The shared card-back → public/art/back.png (or back-<i>.png for candidates).
  if (cmd === 'back') {
    const dir = resolve(process.cwd(), 'public/art');
    mkdirSync(dir, { recursive: true });
    const prompt = 'an ornate symmetrical linocut tarot CARD BACK, full bleed edge to edge, a single watching eye at the very centre framed by intricate gothic woodcut ornament, heavy black carved ink on cream parchment with one dried-blood crimson accent, Mörk Borg aesthetic, no central window, no text';
    const negative = 'text, letters, numbers, a scene, a person, a creature, photographic, 3d render, soft shading, smooth gradient, white paper border, empty centre window';
    const count = Math.max(1, Number(flags.n ?? 1));
    const baseSeed = Number(flags.seed ?? 9000);
    console.log(`\ndelve art — card back x${count} via ${backend.name}\n`);
    let ok = 0;
    for (let i = 0; i < count; i++) {
      const out = resolve(dir, count > 1 ? `back-${i + 1}.png` : 'back.png');
      process.stdout.write(`  back ${i + 1} generating… `);
      const t = Date.now();
      try {
        const r = await backend.generate({ prompt, negative, width: FRAME_SIZE.width, height: FRAME_SIZE.height, seed: baseSeed + i, model: flags.model });
        writeFileSync(out, r.bytes);
        console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s) → ${out}`);
        ok++;
      } catch (e) { console.log('FAILED'); console.error(`    ${(e as Error).message}`); }
    }
    console.log(`\n${ok}/${count} back(s).`);
    return;
  }

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

  // ── texture <id|all> — the surfaces lane (forkable runs, atelier-visible) ──
  if (cmd === 'texture') {
    const keys = (arg1 === 'all' || !arg1) ? Object.keys(TEXTURES) : [arg1];
    const baseSeed = flags.seed ? Number(flags.seed) : undefined;
    console.log(`\ndelve art — textures [${keys.join(', ')}] x${N} via ${backend.name}\n`);
    let ok = 0;
    for (const key of keys) {
      const def = TEXTURES[key];
      if (!def) { console.error(`  no texture '${key}'. known: ${Object.keys(TEXTURES).join(', ')}`); continue; }
      const tweak = flags.tweak;
      const prompt = `${def.prompt}${tweak ? `, ${tweak}` : ''}`;
      const seed0 = baseSeed ?? def.seed;
      const sz = def.size ?? TEXTURE_SIZE;
      for (let i = 0; i < N; i++) {
        const r = await runOne(backend, m, 'texture', key, key, prompt, def.negative, seed0 + i, sz.width, sz.height, flags.from ?? null, tweak);
        if (r) ok++;
      }
    }
    console.log(`\n${ok} texture run(s).  promote one:  delve art promote <id>`);
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

  if (cmd === 'relic') {
    const spec = RELIC_ART.find((r) => r.id === arg1);
    if (!spec) { console.error(`no relic '${arg1}'. known: ${RELIC_ART.map((r) => r.id).join(', ')}`); process.exit(1); }

    const parent = flags.from ? M.findRun(m, flags.from) : undefined;
    if (flags.from && !parent) { console.error(`no run ${flags.from}`); process.exit(1); }

    const styleId = (flags.style ?? parent?.style ?? DEFAULT_STYLE) as StyleId;
    const style = STYLES[styleId];
    const baseSeed = Number(flags.seed ?? parent?.seed ?? spec.seed);
    const tweak = flags.tweak;
    const prompt = parent
      ? `${parent.prompt}${tweak ? `, ${tweak}` : ''}`
      : composeRelicPrompt(style.prompt, spec.art, spec.accent, tweak);

    console.log(`\ndelve art — relic ${spec.id} x${N} · style=${styleId}${parent ? ` (fork ⟜${parent.id})` : ''} via ${backend.name}\n`);
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const r = await runOne(backend, m, 'relic', spec.id, styleId, prompt, style.negative, baseSeed + i, ILLUSTRATION_SIZE.width, ILLUSTRATION_SIZE.height, parent?.id ?? null, tweak);
      if (r) ok++;
    }
    console.log(`\n${ok}/${N} run(s) for ${spec.id}.  promote one:  delve art promote <id>`);
    return;
  }

  console.error(`unknown command '${cmd}'. try: card · relic · frame · promote · ls`);
  process.exit(1);
}

main();
