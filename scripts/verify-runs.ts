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
 * LIMITATION: headless floor-transitions aren't built yet, so the replay
 * reaches one floor. depth>1 claims are therefore left 'pending' (NEVER
 * falsely rejected) until the determinism track lands multi-floor replay;
 * depth-1 runs are fully verifiable now.
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
      if (r.depth > 1) {
        console.log(`  run ${r.id}: depth ${r.depth} — multi-floor replay not headless yet, left pending`);
        continue;
      }
      const b64 = fetchTape(r.id);
      if (!b64) { console.log(`  run ${r.id}: no tape → rejected`); setVerdict(r.id, 'rejected'); continue; }
      const tapeFile = join(tmp, `tape-${r.id}.json`);
      writeFileSync(tapeFile, decodeTape(b64));
      const res = replay(tapeFile);
      // A captured run ended in death; the replay must reproduce that, with the
      // same kills, on at least the claimed depth.
      const ok = res.alive === false && res.kills === r.kills && res.depth >= r.depth;
      setVerdict(r.id, ok ? 'verified' : 'rejected');
      console.log(
        `  run ${r.id}: claim d${r.depth}/k${r.kills} → replay d${res.depth}/k${res.kills}/alive=${res.alive} → ${ok ? 'VERIFIED' : 'REJECTED'}`,
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
