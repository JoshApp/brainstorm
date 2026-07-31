// Content include-flag — the seam that lets a build INCLUDE or EXCLUDE a piece
// of content without editing the content itself.
//
// Every real content spec (enemies, items, bosses, cards, rites, affixes) may
// carry an optional `status`. Selection choke-points (loot roll, enemy roll,
// card deal, drop tables) call `isIncluded()` so half-baked or in-progress
// content simply doesn't appear in a build it isn't cleared for — no code edits,
// no commenting-out. This is what lets a public release be cut purely from the
// game loop while dev/draft content keeps living in the same registries.
//
//   release — ships everywhere. The default when `status` is omitted, so
//             existing content needs zero changes.
//   dev     — included in DEV builds (and previewable on the live site via
//             ?content=dev) but stripped from a normal production build.
//   draft   — never included by default; a work-in-progress parked in the
//             registry. Surfaces only under ?content=all / an explicit override
//             (e.g. `delve inventory --all`).
//
// Node-safe: this module is imported by loot.ts / procgen.ts, which run both in
// the browser AND headless under tsx (scripts/balance.ts, scripts/delve.ts).
// So every environment probe is guarded.

export type ContentStatus = 'release' | 'dev' | 'draft';

/** Anything carrying the include-flag. */
export interface HasContentStatus {
  status?: ContentStatus;
}

// An explicit override wins over the environment default. Used by tooling
// (`delve inventory --all`) and tests to pin the active set deterministically.
let override: ReadonlySet<ContentStatus> | null = null;

/** Pin the active status set (tooling/tests). Pass null to restore env default. */
export function setActiveContentStatuses(statuses: readonly ContentStatus[] | null): void {
  override = statuses ? new Set(statuses) : null;
}

function isDevBuild(): boolean {
  // Vite replaces import.meta.env.DEV with a literal; under tsx import.meta.env
  // is undefined, so the optional chain yields false (release-only) — the safe
  // default for headless tooling that doesn't pass an explicit override.
  try {
    return typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  } catch {
    return false;
  }
}

function envDefault(): Set<ContentStatus> {
  // URL override (phone-friendly): preview dev/all content on any build without
  // a rebuild. ?content=dev → release+dev, =all → everything, =release → strict.
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('content');
    if (q === 'all') return new Set(['release', 'dev', 'draft']);
    if (q === 'dev') return new Set(['release', 'dev']);
    if (q === 'release') return new Set(['release']);
  }
  return isDevBuild() ? new Set(['release', 'dev']) : new Set(['release']);
}

/** The statuses a piece of content must be in to appear in this build. */
export function activeStatuses(): ReadonlySet<ContentStatus> {
  return override ?? envDefault();
}

/** True if `spec` is included in the active build. Omitted status = release. */
export function isIncluded(spec: HasContentStatus | null | undefined): boolean {
  if (!spec) return false;
  return activeStatuses().has(spec.status ?? 'release');
}

/** The status of a spec, resolving the omitted-means-release default. */
export function statusOf(spec: HasContentStatus | null | undefined): ContentStatus {
  return spec?.status ?? 'release';
}
