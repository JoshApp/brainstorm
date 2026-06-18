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
import { submitRun, addConnectedListener, isNetLive } from './delve-net';

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
/** Drain the queue to the backend. Safe to call repeatedly. Offline → stop and
 *  retry on the next connect. Online but a specific run won't dispatch (corrupt
 *  payload) → drop THAT run so it can't wedge every later run behind it. */
export async function flushPendingRuns(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const runs = await listPendingRuns();
    for (const r of runs) {
      if (!isNetLive()) break; // offline — keep the queue, retry on next connect
      const sent = submitRun({
        seed: r.seed,
        buildVersion: r.buildVersion,
        depth: r.depth,
        kills: r.kills,
        name: r.name,
        tape: r.tape,
      });
      if (sent) {
        if (r.id !== undefined) await deletePendingRun(r.id); // server has it
      } else if (!isNetLive()) {
        break; // dropped offline mid-drain — DON'T delete; retry next connect
      } else if (r.id !== undefined) {
        // Still online but this run wouldn't dispatch (corrupt seed/payload).
        // Drop it so it can't block every later run behind it forever.
        console.warn(`[run-sync] dropping unsendable run ${r.id}`);
        await deletePendingRun(r.id);
      }
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
