// run-sync.ts — tape capture + offline-tolerant upload.
//
// On death: take the finished input tape (recorded only under the
// deterministic fixed-step loop), compress it, and queue it with the claimed
// result. On (re)connect: drain the queue to the backend's submit_run reducer.
// The verifier (a separate headless replay worker) re-runs seed+tape later and
// confirms the score. Capture is decoupled from verification — we record the
// evidence now, online or off, and verify whenever. See
// docs/ALPHA-AND-BACKEND.md.

import { takeLastRunTape } from '../harness/run-recorder';
import { serializeTape } from '../harness/tape';
import { getPlayerName } from '../state/meta-state';
import { latestPatchVersion } from '../content/patchlog';
import { enqueueRun, listPendingRuns, deletePendingRun } from './run-store';
import { submitRun, addConnectedListener } from './delve-net';

function buildTag(): string {
  return latestPatchVersion()?.version ?? 'unknown';
}

/** gzip a string and base64 it (so it rides in a reducer string arg). The
 *  input tape is hugely redundant (neutral frames repeat), so this shrinks a
 *  ~1MB run to tens of KB. Falls back to raw base64 if CompressionStream is
 *  unavailable. */
async function gzipBase64(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  let out: Uint8Array;
  if (typeof CompressionStream === 'undefined') {
    out = bytes;
  } else {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    void w.write(bytes);
    void w.close();
    out = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

/** On death: grab the finished tape (fixed-step runs only) + the claimed
 *  result, compress, and queue it for upload. Best-effort + fire-and-forget. */
export async function captureRunTape(claim: { depth: number; kills: number }): Promise<void> {
  try {
    const tape = takeLastRunTape();
    if (!tape) return; // no tape — not a deterministic (fixed-step) run
    const packed = await gzipBase64(serializeTape(tape));
    if (packed.length > 580_000) return; // absurd length — skip (server caps at 600k)
    await enqueueRun({
      seed: tape.seed,
      buildVersion: buildTag(),
      depth: claim.depth,
      kills: claim.kills,
      name: getPlayerName() ?? 'a nameless delver',
      tape: packed,
      at: Date.now(),
    });
    void flushPendingRuns(); // try to send right away if we're online
  } catch (err) {
    console.warn('[run-sync] capture failed:', err);
  }
}

let flushing = false;
/** Drain the queue to the backend. Safe to call repeatedly; stops at the first
 *  failure (offline) and leaves the rest queued for the next connect. */
export async function flushPendingRuns(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const runs = await listPendingRuns();
    for (const r of runs) {
      const sent = submitRun({
        seed: r.seed,
        buildVersion: r.buildVersion,
        depth: r.depth,
        kills: r.kills,
        name: r.name,
        tape: r.tape,
      });
      if (sent && r.id !== undefined) await deletePendingRun(r.id);
      else break; // not connected — retry on the next connect
    }
  } catch (err) {
    console.warn('[run-sync] flush failed:', err);
  } finally {
    flushing = false;
  }
}

/** Wire flush-on-connect (fires on first connect AND every reconnect). Call
 *  once at boot. */
export function initRunSync(): void {
  addConnectedListener(() => { void flushPendingRuns(); });
}
