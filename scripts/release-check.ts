// Release check — reads a production build (default `dist/`) and fails if
// anything that must never reach players is in it.
//
//   npm run release-check            # after `npm run build`
//   tsx scripts/release-check.ts <dir>
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
//
// CLAUDE.md's rule is that every cheat and debug affordance sits behind the DEV
// gate so the minifier deletes it. The rule held only where a session
// remembered it. On 2026-11-21 the live site was found serving:
//   - `?fakemeta=1`, which OVERWROTE a player's real `delve:meta` save from a
//     link (src/debug/boot-url-screens.ts, ungated since it was extracted);
//   - every `.js.map`, i.e. the game's full source, because maps were only ever
//     deleted by a Sentry upload that CI never ran.
// Nothing noticed either, because nothing looked at the built output. This
// does, on every deploy (.github/workflows/deploy.yml).
//
// ── HOW TO EXTEND ────────────────────────────────────────────────────────────
//
// A BANNED string is one that exists ONLY inside DEV-gated code, so finding it
// in the bundle proves a gate is missing. Pick a token that is unique to the
// debug path (a URL flag name, a `window.__*` hook) — not a word the game also
// uses legitimately. Each entry says where it lives so a failure points at the
// fix. WARN entries are things that are allowed but someone should know about.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

interface Rule { token: string; where: string }

const BANNED: Rule[] = [
  { token: 'fakemeta', where: 'src/debug/boot-url-screens.ts (writes delve:meta)' },
  { token: 'fakesave', where: 'src/debug/boot-url-screens.ts (writes delve:save)' },
  { token: 'showStash', where: 'src/debug/boot-url-screens.ts' },
  { token: 'showCodex', where: 'src/debug/boot-url-screens.ts' },
  { token: 'showPatchlog', where: 'src/debug/boot-url-screens.ts' },
  { token: 'setGodMode', where: 'src/player — godmode must be DEV && on' },
  { token: '__harness', where: 'src/harness — the autobot' },
  { token: '__sim', where: 'sim stepper hooks' },
  { token: '__boss', where: 'boss observation hooks' },
  { token: '__presentedFrames', where: 'warm/present instrumentation' },
  { token: 'hudedit', where: 'HUD drag mode (?hudedit=1)' },
];

const WARN: Rule[] = [
  {
    // Allowed only inside Clerk's own library chunk, which checks key prefixes.
    // Anywhere else it is account-link.ts's dev fallback, meaning the deploy has
    // no VITE_CLERK_PUBLISHABLE_KEY and players sign in to the Clerk DEV instance.
    token: 'pk_test_cGxl',
    where: 'src/net/account-link.ts fallback — set repo var CLERK_PUBLISHABLE_KEY to a pk_live key',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const dist = process.argv[2] ?? 'dist';
const files = walk(dist);
const failures: string[] = [];
const warnings: string[] = [];

for (const f of files) {
  if (f.endsWith('.map')) failures.push(`source map shipped: ${relative(dist, f)}`);
}

const code = files.filter((f) => /\.(js|mjs|html)$/.test(f));
for (const f of code) {
  const text = readFileSync(f, 'utf8');
  for (const r of BANNED) {
    if (text.includes(r.token)) failures.push(`"${r.token}" in ${relative(dist, f)} — ungated, see ${r.where}`);
  }
  for (const r of WARN) {
    if (text.includes(r.token)) warnings.push(`"${r.token}" in ${relative(dist, f)} — ${r.where}`);
  }
}

for (const w of warnings) console.log(`[release-check] warn: ${w}`);
if (failures.length) {
  for (const msg of failures) console.error(`[release-check] FAIL: ${msg}`);
  console.error(`[release-check] ${failures.length} problem(s) in ${dist}/ — this build must not ship.`);
  process.exit(1);
}
console.log(`[release-check] ok: ${code.length} code files, ${files.length} files, nothing banned.`);
