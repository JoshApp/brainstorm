// Patch-log generator. Reads the git history and writes a structured
// patch log to src/content/patchlog.generated.ts. Runs automatically
// before every build (package.json "prebuild"), so each deploy ships
// a patch log derived from the commits that went into it.
//
// DATA, NOT VOICE. The output is the same factual PatchVersion[] shape
// the hand-curated log used; the LLM announcer layer (Phase 5) is a
// VIEW over this, never baked in.
//
// ── Two ways a commit feeds the changelog ──────────────────────────
//
// 1. **Explicit `Patch-*` trailers (preferred).** A commit can declare
//    exactly what surfaces by appending key:value lines to its body:
//
//      Patch-tag: tune
//      Patch-summary: Whip cracks now ripple instead of swinging rigid.
//      Patch-area: combat, weapons
//      Patch-audience: player
//
//    Recognized keys:
//      Patch-tag       — add | fix | tune | content | tech
//      Patch-summary   — player-facing line (overrides commit subject)
//      Patch-area      — comma-separated system tags (combat, ui, level…)
//      Patch-audience  — player | dev | both (default: both)
//                        'dev' = surface in a future dev log, never
//                                in the player-facing changelog
//      Patch-skip      — true   skip this commit entirely
//
// 2. **Subject-only (legacy / quick commits).** No trailers? Fall back
//    to inferring a tag from the subject's keywords and using the
//    cleaned subject as the text. Existing history works unchanged.
//
// Good commit subjects + Patch-* trailers → high-quality patch notes
// with no hand-editing. The trailer format is what Claude (or anyone)
// writes when committing per the CLAUDE.md guidance.
//
// Resilient by design: any failure (no git, shallow clone, parse
// error) leaves the existing committed generated file untouched and
// exits 0 so it can never break a build.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type PatchTag = 'add' | 'fix' | 'tune' | 'content' | 'tech';
export type PatchAudience = 'player' | 'dev' | 'both';

export interface PatchEntry {
  tag: PatchTag;
  text: string;
  /** Optional system tags from `Patch-area`. Persisted so a future
   *  view can filter "all combat changes in the last week." */
  area?: string[];
}
export interface PatchVersion { version: string; date: string; entries: PatchEntry[]; }

export interface ParsedCommit {
  date: string;
  subject: string;
  body: string;
  trailers: Record<string, string>;
}

const VALID_TAGS = new Set<PatchTag>(['add', 'fix', 'tune', 'content', 'tech']);
const VALID_AUDIENCES = new Set<PatchAudience>(['player', 'dev', 'both']);

// Bounds on what ends up in the log. Caps keep the bundle + the
// in-game screen readable as history piles up — a rolling recent
// window is what a build-in-public changelog wants anyway.
const MAX_DAYS = 25;
const MAX_ENTRIES = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'src', 'content', 'patchlog.generated.ts');

// Commits we never want surfaced as a player-facing note — internal
// housekeeping, CI/build/deploy plumbing, the patch-log machinery
// itself. Only consulted when a commit lacks explicit trailers.
// Word-boundary-anchored — `ci\b` matches "ci:" / "ci " / "ci-foo".
// Previous `ci:` had `\b` after the colon, where a colon→space gap
// isn't a word boundary, so "ci: bump deps" silently leaked through.
const SKIP_SUBJECT = /^(merge|wip|fixup|squash|chore|ci|bump|revert|format|lint)\b/i;

export function isHousekeeping(subject: string): boolean {
  if (SKIP_SUBJECT.test(subject)) return true;
  if (/\b(build|deploy|ci|pipeline|typecheck|tsc)\b.*\b(error|fix|fixes|red|green)\b/i.test(subject)) return true;
  if (/\bred (build|deploy|ci)\b/i.test(subject)) return true;
  if (/\bpatch ?log\b/i.test(subject)) return true;   // the changelog machinery itself
  return false;
}

export function inferTag(subject: string): PatchTag {
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
 *  identifier, a path, or a .ts file) and any "(round N)" noise. Used
 *  as the default text when no Patch-summary trailer is set. */
export function cleanSubject(raw: string): string {
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

/** Pull `Key: value` trailer lines from a commit body. We look at the
 *  LAST contiguous block of key:value lines (separated from the body
 *  by a blank line — the git trailer convention). Case-insensitive
 *  key match; values are trimmed. */
export function parseTrailers(body: string): Record<string, string> {
  const trailers: Record<string, string> = {};
  if (!body) return trailers;
  // Walk lines from the bottom up, collecting keys until a non-trailer
  // line (or a blank) breaks the block. Skip trailing blank lines
  // first.
  const lines = body.replace(/\s+$/, '').split('\n');
  // Find the start of the trailer block by walking back from the end.
  let blockStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === '') break;
    // Standard git trailer shape: <Token>: <value> where token has no
    // whitespace. Also accept lines that aren't trailers (e.g. a
    // session URL) interleaved — they don't break the block, just
    // skip them.
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s/.test(line) || /^https?:\/\//i.test(line)) {
      blockStart = i;
      continue;
    }
    break;
  }
  for (let i = blockStart; i < lines.length; i++) {
    // URL-looking lines slip past the Key:value match because the
    // scheme ("https") matches the key shape and "//..." becomes the
    // value. The trailer block tolerates them (a session link sits
    // alongside Patch-* trailers in our convention) but they're not
    // trailers — skip.
    if (/^https?:\/\//i.test(lines[i])) continue;
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    trailers[m[1].toLowerCase()] = m[2].trim();
  }
  return trailers;
}

/** Resolve a commit into a PatchEntry, or null to skip. Honours
 *  explicit `Patch-*` trailers; falls back to the subject-inference
 *  path used by pre-trailer commits. */
export function entryForCommit(c: ParsedCommit): PatchEntry | null {
  const t = c.trailers;
  const skipFlag = t['patch-skip']?.toLowerCase();
  if (skipFlag === 'true' || skipFlag === 'yes' || skipFlag === '1') return null;

  const audience = (t['patch-audience']?.toLowerCase() ?? 'both') as PatchAudience;
  if (!VALID_AUDIENCES.has(audience)) {
    // Bad value — treat as the safe default (both) rather than drop.
  }
  // Player-facing log excludes dev-only entries. (Future: emit a
  // separate dev log from the same input — same data, different view.)
  if (audience === 'dev') return null;

  // No trailers + housekeeping subject = legacy skip.
  const hasExplicitTrailers = Object.keys(t).some((k) => k.startsWith('patch-'));
  if (!hasExplicitTrailers && isHousekeeping(c.subject)) return null;

  // Tag: prefer the trailer, validated; else infer.
  const explicitTag = t['patch-tag']?.toLowerCase() as PatchTag | undefined;
  const tag: PatchTag = explicitTag && VALID_TAGS.has(explicitTag)
    ? explicitTag
    : inferTag(c.subject);

  // Text: prefer Patch-summary, else cleaned subject.
  const summary = t['patch-summary']?.trim();
  const text = summary && summary.length >= 4 ? summary : cleanSubject(c.subject);
  if (text.length < 4) return null;

  // Areas: comma-separated, lowercase, trimmed, deduped.
  let area: string[] | undefined;
  const rawAreas = t['patch-area'];
  if (rawAreas) {
    const set = new Set(rawAreas.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (set.size > 0) area = [...set];
  }

  return area ? { tag, text, area } : { tag, text };
}

export function run(): void {
  let raw: string;
  try {
    // %x1e = record separator (commit boundary); %x1f = unit
    // separator (field boundary within a commit). Lets us include the
    // multi-line body without any escape sequence collisions with
    // commit content.
    raw = execSync(
      'git log --no-merges --date=short --pretty=format:%x1e%H%x1f%ad%x1f%s%x1f%b',
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    console.warn('[gen-patchlog] git log failed — leaving existing generated file:', (err as Error).message);
    return;
  }

  // Parse commits separated by RS.
  const commits: ParsedCommit[] = [];
  for (const chunk of raw.split('\x1e')) {
    if (!chunk.trim()) continue;
    const fields = chunk.split('\x1f');
    if (fields.length < 3) continue;
    const [, date, subject, body = ''] = fields;
    if (!date || !subject) continue;
    commits.push({ date, subject, body, trailers: parseTrailers(body) });
  }

  // Group entries by day, preserving newest-first order within a day.
  const byDay = new Map<string, PatchEntry[]>();
  const dayOrder: string[] = [];      // first-seen (newest) order
  for (const commit of commits) {
    const entry = entryForCommit(commit);
    if (!entry) continue;
    if (!byDay.has(commit.date)) { byDay.set(commit.date, []); dayOrder.push(commit.date); }
    byDay.get(commit.date)!.push(entry);
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
// subjects + Patch-* trailers (or scripts/gen-patchlog.ts) to change
// what appears here.

export const GENERATED_PATCHLOG = ${JSON.stringify(versions, null, 2)} as const;
`;

  writeFileSync(OUT_PATH, body, 'utf8');
  const entryCount = versions.reduce((n, v) => n + v.entries.length, 0);
  console.log(`[gen-patchlog] wrote ${versions.length} builds, ${entryCount} entries → ${OUT_PATH}`);
}

// Only execute the generator when this file is invoked directly (the
// prebuild hook). Importing it from a test file just pulls in the
// pure functions for unit-testing without writing the output file.
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
