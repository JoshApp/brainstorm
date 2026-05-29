// Patch-log generator. Reads the git history and writes a structured
// patch log to src/content/patchlog.generated.ts. Runs automatically
// before every build (package.json "prebuild"), so each deploy ships
// a patch log derived from the commits that went into it.
//
// DATA, NOT VOICE. The output is the same factual PatchVersion[] shape
// the hand-curated log used; the LLM announcer layer (Phase 5) is a
// VIEW over this, never baked in. Good commit subjects → good patch
// notes: this is a gentle forcing function for build-in-public hygiene.
//
// Resilient by design: any failure (no git, shallow clone, parse
// error) leaves the existing committed generated file untouched and
// exits 0 so it can never break a build.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type PatchTag = 'add' | 'fix' | 'tune' | 'content' | 'tech';
interface PatchEntry { tag: PatchTag; text: string; }
interface PatchVersion { version: string; date: string; entries: PatchEntry[]; }

// Bounds on what ends up in the log. Caps keep the bundle + the
// in-game screen readable as history piles up — a rolling recent
// window is what a build-in-public changelog wants anyway.
const MAX_DAYS = 25;
const MAX_ENTRIES = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'src', 'content', 'patchlog.generated.ts');

// Commits we never want surfaced as a player-facing note — internal
// housekeeping, CI/build/deploy plumbing, the patch-log machinery
// itself.
const SKIP_SUBJECT = /^(merge|wip|fixup|squash|chore|ci:|bump|revert|format|lint)\b/i;

function isHousekeeping(subject: string): boolean {
  if (SKIP_SUBJECT.test(subject)) return true;
  if (/\b(build|deploy|ci|pipeline|typecheck|tsc)\b.*\b(error|fix|fixes|red|green)\b/i.test(subject)) return true;
  if (/\bred (build|deploy|ci)\b/i.test(subject)) return true;
  if (/\bpatch ?log\b/i.test(subject)) return true;   // the changelog machinery itself
  return false;
}

function inferTag(subject: string): PatchTag {
  const s = subject.toLowerCase();
  // FIX wins first: the leading action governs the tag. "Fix the
  // ooze" is a FIX, not CONTENT, even though it names a creature.
  if (/^fix\b|\bfix(es|ed)?\b|\bbug\b/.test(s)) return 'fix';
  // Then CONTENT — new game content reads better as CONTENT than the
  // generic ADD even when the subject starts with "Add".
  if (/\b(enemy|enemies|ooze|spitter|brazier|pike|cresset|torch|vault|prop|weapon|mob|chest|relic|altar|fountain|light source|fixture)\b/.test(s)) {
    return 'content';
  }
  if (/^(add|new)\b|\badds?\b|\bintroduce/.test(s)) return 'add';
  if (/perf|optimi[sz]|cull|refactor|cleanup|clean up|dedupe|frustum/.test(s)) return 'tech';
  if (/tune|tweak|balance|adjust|quieter|feel|polish|rework|smaller|larger|slower|faster/.test(s)) return 'tune';
  return 'tune';
}

/** Clean a raw commit subject into a player-readable line. Strips a
 *  trailing technical colon-clause (one that mentions an ALL_CAPS
 *  identifier, a path, or a .ts file) and any "(round N)" noise. */
function cleanSubject(raw: string): string {
  let s = raw.trim();
  const colon = s.indexOf(': ');
  if (colon > 0) {
    const tail = s.slice(colon + 2);
    // Drop the tail only when it looks like an implementation note.
    if (/[A-Z]{2,}|_|\.ts\b|\//.test(tail)) {
      s = s.slice(0, colon);
    }
  }
  s = s.replace(/\s*\(round \d+\)/i, '').replace(/\s*\(\d+\)\s*$/, '');
  return s.trim();
}

function run(): void {
  let raw: string;
  try {
    // %x1f = unit separator between fields; one commit per line.
    raw = execSync(
      'git log --no-merges --date=short --pretty=format:%H%x1f%ad%x1f%s',
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    console.warn('[gen-patchlog] git log failed — leaving existing generated file:', (err as Error).message);
    return;
  }

  // Group commits by day, preserving newest-first order within a day.
  const byDay = new Map<string, PatchEntry[]>();
  const dayOrder: string[] = [];      // first-seen (newest) order
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [, date, subject] = line.split('\x1f');
    if (!date || !subject) continue;
    if (isHousekeeping(subject)) continue;
    const text = cleanSubject(subject);
    if (text.length < 4) continue;
    if (!byDay.has(date)) { byDay.set(date, []); dayOrder.push(date); }
    byDay.get(date)!.push({ tag: inferTag(subject), text });
  }

  // Build numbers count chronologically (oldest day = Build 1) so the
  // newest day has the highest number — satisfying "we're on build N"
  // read for build-in-public. dayOrder is newest-first; reverse to
  // assign ascending numbers.
  const chronological = [...dayOrder].reverse();
  const buildNumber = new Map<string, number>();
  chronological.forEach((d, i) => buildNumber.set(d, i + 1));

  const versions: PatchVersion[] = [];
  let total = 0;
  for (const date of dayOrder.slice(0, MAX_DAYS)) {
    if (total >= MAX_ENTRIES) break;
    // Trim this day's entries so the running total never exceeds the
    // cap — the oldest included day may be partially shown.
    const entries = byDay.get(date)!.slice(0, MAX_ENTRIES - total);
    total += entries.length;
    versions.push({ version: `Build ${buildNumber.get(date)}`, date, entries });
  }

  if (versions.length === 0) {
    console.warn('[gen-patchlog] no commits matched — leaving existing generated file');
    return;
  }

  const body = `// AUTO-GENERATED by scripts/gen-patchlog.ts — DO NOT EDIT.
// Regenerated on every build from the git history. Edit commit
// subjects (or scripts/gen-patchlog.ts) to change what appears here.

export const GENERATED_PATCHLOG = ${JSON.stringify(versions, null, 2)} as const;
`;

  writeFileSync(OUT_PATH, body, 'utf8');
  const entryCount = versions.reduce((n, v) => n + v.entries.length, 0);
  console.log(`[gen-patchlog] wrote ${versions.length} builds, ${entryCount} entries → ${OUT_PATH}`);
}

run();
