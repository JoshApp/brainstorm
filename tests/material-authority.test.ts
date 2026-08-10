// MATERIAL AUTHORITY — one owner for "what a surface is", enforced.
//
// The scene audit (docs/PIPELINE-BUDGET.md) found 42 distinct material
// configurations and 255 compiled pipelines for a floor with 35,000 triangles.
// That is ~137 triangles per pipeline, and pipelines are what the loading screen
// is made of. The cause was not 42 intended looks. It was the same few materials
// re-specified slightly differently — `modeldef:opa:plain` existing twice one fog
// flag apart, `shared:std` three times, ~61 instances across four UNNAMED
// configurations that bypass the pool entirely and therefore can never dedup.
//
// The pool already exists and already solves this: `style/material-registry.ts`
// stdMat/basicMat key on a canonical parameter hash and hand back one shared
// instance, and `ecs/build-model.ts createMaterial` does the same for model defs.
// stdMat's own doc comment says "call instead of `new THREE.MeshStandardMaterial`".
//
// So the rule was already written down. It just wasn't ENFORCED, and an unenforced
// convention decays: 86 shipping call sites construct materials directly. Every
// one is a place that can mint a surface nobody else can reuse, which becomes a
// pipeline nobody warmed.
//
// This test is the ratchet. It counts direct construction outside the authority
// and fails if that count GROWS. It is deliberately not a hard ban — banning 86
// existing sites at once would mean 86 unverifiable visual changes in one commit.
// It makes the number visible, stops it climbing, and lets it be walked down in
// verifiable steps.
//
// ── THE NUMBER MAY ONLY GO DOWN ──────────────────────────────────────────────
// If you lowered it, lower BUDGET too — that is how the ratchet tightens.
// If this fails because you ADDED a site: use stdMat/basicMat (static surfaces)
// or a ModelSpec material def (anything built through build-model). Reach for a
// direct `new` only when the material is genuinely per-instance animated, and if
// so add it to ANIMATED_EXEMPT below with the reason.
//
//   npm test -- material-authority

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Direct construction of a renderable material. */
const MATERIAL_CTOR = /new\s+(?:THREE\.)?(?:Mesh[A-Za-z]*|Sprite|Points|Line[A-Za-z]*|Shadow)(?:Node)?Material\b/g;

/** Areas that never ship to players — the DEV gate strips them, so their
 *  materials never become a player-visible pipeline. Not part of the budget. */
const NON_SHIPPING = ['src/lab/', 'src/debug/', 'src/bench/'];

/** The authority itself: these modules are ALLOWED to construct materials —
 *  constructing them is their job. Everything else should be asking. */
const AUTHORITY = [
  'src/style/material-registry.ts',   // stdMat / basicMat — the shared pool
  'src/style/materials.ts',           // the style pass's own material set
  'src/ecs/build-model.ts',           // createMaterial — pooled ModelSpec defs
];

/** Materials that are genuinely per-instance because something animates their
 *  own uniforms per object. These still cost a pipeline, but sharing them would
 *  be wrong, not merely different. Add with a reason or don't add. */
const ANIMATED_EXEMPT: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk('src').filter((f) => {
  const norm = f.replace(/\\/g, '/');
  if (NON_SHIPPING.some((d) => norm.startsWith(d))) return false;
  if (AUTHORITY.includes(norm)) return false;
  if (ANIMATED_EXEMPT.includes(norm)) return false;
  return true;
});

const byFile = new Map<string, number>();
let total = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const n = (src.match(MATERIAL_CTOR) || []).length;
  if (n > 0) { byFile.set(f.replace(/\\/g, '/'), n); total += n; }
}

// Measured 2026-08-10 by this test itself. Lower as call sites move to the pool.
const BUDGET = 86;

test('direct material construction outside the authority does not grow', () => {
  const worst = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const report = worst.map(([f, n]) => `    ${String(n).padStart(3)}  ${f}`).join('\n');
  assert.ok(
    total <= BUDGET,
    `Direct material construction rose to ${total} (budget ${BUDGET}).\n`
    + `Use stdMat/basicMat (style/material-registry.ts) for static surfaces, or a\n`
    + `ModelSpec material def for anything built through build-model. Worst files:\n${report}`,
  );
});

test('the budget is not stale — tighten it when sites are migrated', () => {
  assert.ok(
    total >= BUDGET - 10,
    `Direct material construction fell to ${total}, well under the ${BUDGET} budget.\n`
    + `Lower BUDGET to ${total} in this file so the ratchet keeps its grip.`,
  );
});

test('the authority modules still exist where the rule points', () => {
  for (const f of AUTHORITY) {
    assert.doesNotThrow(() => statSync(f), `${f} is missing — the rule points at nothing.`);
  }
});

if (process.env.MATERIAL_REPORT) {
  console.log(`\ndirect material construction: ${total} sites across ${byFile.size} files`);
  for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed  (material sites: ${total}/${BUDGET})`);
if (failed) process.exit(1);
