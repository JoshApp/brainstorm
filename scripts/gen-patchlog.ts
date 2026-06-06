// Patch-log assembler. Reads the git history and writes a structured
// patch log to src/content/patchlog.generated.ts. Runs automatically
// before every build (package.json "prebuild"), so each deploy ships
// the log built from the commits that went into it.
//
// ── How entries get into the log ────────────────────────────────────
//
// Each commit that should surface to PLAYERS authors its own line as
// a `Patch-summary` trailer in the commit message body. Claude (the
// design + coding + content layers) writes that line at commit time —
// in the BROADCAST VOICE (cosmic-announcer / DCC tribute), present
// tense, terse, fourth-wall-aware, one sentence. See CLAUDE.md
// "Commit message format" for the contract and voice guidance.
//
// Recognized trailers:
//
//   Patch-summary  — REQUIRED for the commit to appear in the log.
//                    The exact text shown to the player.
//   Patch-tag      — add | fix | tune | content | tech. Optional;
//                    defaults to 'tune'. Picks the icon/category.
//   Patch-area     — comma-separated system tags (combat, ui,
//                    level, atmosphere, …). Optional, persisted so
//                    a future filtered view can render "all combat
//                    changes since Build N".
//
// Commits WITHOUT a Patch-summary trailer are silently skipped —
// infrastructure (CI, scripts, session-hook plumbing), refactors the
// player can't see, in-progress work pushed for backup. The log is
// curated by what Claude chose to write up, not by what a regex
// guessed about a subject line.
//
// Resilient by design: any failure (no git, shallow clone, parse
// error) leaves the existing committed generated file untouched and
// exits 0 so it can never break a build.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type PatchTag = 'add' | 'fix' | 'tune' | 'content' | 'tech';

export interface PatchEntry {
  tag: PatchTag;
  text: string;
  /** Optional system tags from `Patch-area`. Persisted so a future
   *  view can render "all <area> changes since Build N." */
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
const DEFAULT_TAG: PatchTag = 'tune';

// Bounds on what ends up in the log. Caps keep the bundle + the
// in-game screen readable as history piles up.
const MAX_DAYS = 25;
const MAX_ENTRIES = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'src', 'content', 'patchlog.generated.ts');

/** Pull `Key: value` trailer lines from a commit body. Walks back
 *  from the end through trailer-shaped lines, URL lines, and blank
 *  separators — only breaks on a real prose line. Case-insensitive
 *  keys; values are trimmed.
 *
 *  Why blank-line-tolerant: the Claude Code commit convention puts the
 *  session URL on its own line, often blank-separated from the
 *  Patch-* trailers above it. Both the URL and the trailers are part
 *  of the same footer region. */
export function parseTrailers(body: string): Record<string, string> {
  const trailers: Record<string, string> = {};
  if (!body) return trailers;
  const lines = body.replace(/\s+$/, '').split('\n');
  let blockStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (
      line === '' ||
      /^[A-Za-z][A-Za-z0-9_-]*:\s/.test(line) ||
      /^https?:\/\//i.test(line)
    ) {
      blockStart = i;
      continue;
    }
    break;
  }
  for (let i = blockStart; i < lines.length; i++) {
    if (/^https?:\/\//i.test(lines[i])) continue;
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    trailers[m[1].toLowerCase()] = m[2].trim();
  }
  return trailers;
}

/** Resolve a commit into a PatchEntry, or null to skip. The rule is
 *  simple: NO `Patch-summary` → skipped. Authored, surfaced. */
export function entryForCommit(c: ParsedCommit): PatchEntry | null {
  const t = c.trailers;
  const summary = t['patch-summary']?.trim();
  if (!summary || summary.length < 4) return null;

  const explicitTag = t['patch-tag']?.toLowerCase() as PatchTag | undefined;
  const tag: PatchTag = explicitTag && VALID_TAGS.has(explicitTag)
    ? explicitTag
    : DEFAULT_TAG;

  let area: string[] | undefined;
  const rawAreas = t['patch-area'];
  if (rawAreas) {
    const set = new Set(rawAreas.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (set.size > 0) area = [...set];
  }

  return area ? { tag, text: summary, area } : { tag, text: summary };
}

export function run(): void {
  let raw: string;
  try {
    // %x1e = record separator (commit boundary); %x1f = unit
    // separator (field boundary within a commit). Lets us include the
    // multi-line body without escape-sequence collisions with content.
    raw = execSync(
      'git log --no-merges --date=short --pretty=format:%x1e%H%x1f%ad%x1f%s%x1f%b',
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    console.warn('[gen-patchlog] git log failed — leaving existing generated file:', (err as Error).message);
    return;
  }

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
    const entries = byDay.get(date)!.slice(0, MAX_ENTRIES - total);
    total += entries.length;
    versions.push({ version: `Build ${buildNumber.get(date)}`, date, entries });
  }

  if (versions.length === 0) {
    console.warn('[gen-patchlog] no commits had a Patch-summary trailer — leaving existing generated file');
    return;
  }

  const body = `// AUTO-GENERATED by scripts/gen-patchlog.ts — DO NOT EDIT.
// Regenerated on every build from commits that carry a Patch-summary
// trailer. See CLAUDE.md "Commit message format" for the contract.

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
