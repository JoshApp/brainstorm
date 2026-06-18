/**
 * Run verifier — replays pending run tapes headlessly and writes verdicts.
 *
 *   npm run verify-runs              (one pass)
 *   npm run verify-runs -- --watch   (poll every 30s)
 *
 * Reads pending_run via `spacetime sql` (run as the DB OWNER — owner-only SQL
 * mutation is the admin gate, so no verdict reducer/auth is needed), replays
 * each (seed + input tape) in Node via the proven headless harness, compares
 * to the claimed depth/kills, and UPDATEs status to verified|rejected.
 *
 * Requires: `spacetime` on PATH, logged in as the database owner.
 *
 * The replay is MULTI-FLOOR (mirrors the loader's floor swaps headlessly), so
 * deep runs verify. Verdict policy is deliberately safe for the alpha: VERIFY
 * only an exact match (depth + kills + ended-in-death); REJECT a tape that
 * doesn't reproduce the death (survived the whole tape); leave anything else
 * 'pending' (a depth/kills mismatch is more likely residual determinism drift
 * than cheating right now — flag, don't punish). Tighten to reject mismatches
 * once determinism is battle-tested.
 */
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReplayer, OUT } from './build-replay-run.mjs';

const DB = 'delve';
const SERVER = 'maincloud';

function sql(query: string): string {
  return execFileSync('spacetime', ['sql', '-s', SERVER, DB, query], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

interface PendingRow { id: number; seed: number; depth: number; kills: number; }

/** Parse the spacetime ASCII table → data rows of trimmed cells (drops the
 *  WARNING line, the `+---+` separators, and the header). */
function parseTable(out: string): string[][] {
  const rows = out.split('\n')
    .filter((l) => l.includes('|') && !/^[\s|+-]+$/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()));
  return rows.slice(1); // drop header
}

function listPending(): PendingRow[] {
  const out = sql("SELECT id, seed, depth, kills FROM pending_run WHERE status = 'pending'");
  return parseTable(out)
    .map((c) => ({ id: Number(c[0]), seed: Number(c[1]), depth: Number(c[2]), kills: Number(c[3]) }))
    .filter((r) => Number.isFinite(r.id));
}

function fetchTape(id: number): string | null {
  const m = sql(`SELECT tape FROM pending_run WHERE id = ${id}`).match(/"([A-Za-z0-9+/=]+)"/);
  return m ? m[1] : null;
}

/** Tapes are gzip+base64; fall back to raw base64 if gunzip fails. */
function decodeTape(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  try { return gunzipSync(buf).toString('utf8'); } catch { return buf.toString('utf8'); }
}

function setVerdict(id: number, status: 'verified' | 'rejected'): void {
  sql(`UPDATE pending_run SET status = '${status}' WHERE id = ${id}`);
}

function replay(tapeFile: string): { depth: number; kills: number; alive: boolean } {
  const out = execFileSync('node', [OUT, tapeFile], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const line = out.trim().split('\n').pop() ?? '{}';
  return JSON.parse(line);
}

function pass(tmp: string): void {
  const pending = listPending();
  if (!pending.length) { console.log('[verify] no pending runs'); return; }
  console.log(`[verify] ${pending.length} pending run(s)`);
  for (const r of pending) {
    try {
      const b64 = fetchTape(r.id);
      if (!b64) { console.log(`  run ${r.id}: no tape → rejected`); setVerdict(r.id, 'rejected'); continue; }
      const tapeFile = join(tmp, `tape-${r.id}.json`);
      writeFileSync(tapeFile, decodeTape(b64));
      const res = replay(tapeFile);
      // Safe policy: VERIFY only an exact reproduction (depth + kills + died).
      // Anything else is left 'pending' — a replay that can't reproduce a run is
      // a VERIFIER limitation (e.g. an input the tape doesn't yet record), not
      // proof of cheating. Never auto-reject until the replay is proven faithful.
      const verdict: 'verified' | 'pending' =
        res.depth === r.depth && res.kills === r.kills && res.alive === false ? 'verified' : 'pending';
      if (verdict === 'verified') setVerdict(r.id, 'verified');
      console.log(
        `  run ${r.id}: claim d${r.depth}/k${r.kills} → replay d${res.depth}/k${res.kills}/alive=${res.alive} → ${verdict.toUpperCase()}`,
      );
    } catch (err) {
      console.warn(`  run ${r.id}: error —`, (err as Error).message ?? err);
    }
  }
}

const watch = process.argv.includes('--watch');
const tmp = mkdtempSync(join(tmpdir(), 'delve-verify-'));
console.log('[verify] building headless replayer…');
await buildReplayer();
pass(tmp);
if (watch) {
  console.log('[verify] watching (every 30s)…');
  setInterval(() => pass(tmp), 30_000);
}
