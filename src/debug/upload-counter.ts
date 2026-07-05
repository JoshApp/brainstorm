import type { DelveRenderer } from '../scene/create-renderer';

// ── PER-FRAME GPU-UPLOAD COUNTER (WebGPU) ────────────────────────────────────
//
// The 2026-07-05 phone recordings contain "encode storm" frames — 76ms of CPU
// inside render·scene at a normal draw count — and the per-pass buckets can't
// say WHY: a buffer-upload burst, first-touch object prep, and a GC pause
// landing mid-encode all look identical from outside. This wraps
// `device.queue.writeBuffer` (+ writeTexture) with two counters, read/reset
// once per frame by frame-timing, so every recording carries `ub`/`ubKB`
// columns: a storm frame with a fat ubKB is an upload burst (and the byte
// count sizes it); a storm frame with gc=true is the collector; neither means
// first-touch prep. Costs two increments per upload call (~tens/frame) —
// always on, no gating needed. WebGL2 backend has no device → installs
// nothing and the columns stay 0.

let uploads = 0;
let uploadBytes = 0;
let installed = false;

// Minimal structural types — the repo doesn't pull @webgpu/types; every other
// WebGPU touchpoint (compile guard, backend reads) also goes through casts.
interface UploadQueueLike {
  writeBuffer(...args: unknown[]): void;
  writeTexture(...args: unknown[]): void;
}

function byteLen(data: unknown): number {
  return (data as ArrayBufferView | ArrayBuffer | undefined as { byteLength?: number })?.byteLength ?? 0;
}

/** Wrap the device queue's upload entry points. Idempotent; call once after
 *  renderer init (alongside installRenderPassCpu). */
export function installUploadCounter(renderer: DelveRenderer): void {
  if (installed) return;
  const device = (renderer as unknown as { backend?: { device?: { queue?: UploadQueueLike } } }).backend?.device;
  const queue = device?.queue;
  if (!queue || typeof queue.writeBuffer !== 'function') return;   // WebGL2 fallback
  installed = true;
  const origWriteBuffer = queue.writeBuffer.bind(queue);
  queue.writeBuffer = (...args: unknown[]) => {
    uploads++;
    // size (args[4]) is in ELEMENTS for TypedArray data per spec; approximate
    // with byteLength when omitted — this is a burst detector, not a ledger.
    uploadBytes += (args[4] as number | undefined) ?? byteLen(args[2]);
    return origWriteBuffer(...args);
  };
  const origWriteTexture = queue.writeTexture.bind(queue);
  queue.writeTexture = (...args: unknown[]) => {
    uploads++;
    uploadBytes += byteLen(args[1]);
    return origWriteTexture(...args);
  };
}

/** Uploads since the last read (frame-timing calls this once per frame). */
export function readAndResetUploads(): { count: number; kb: number } {
  const out = { count: uploads, kb: uploadBytes / 1024 };
  uploads = 0;
  uploadBytes = 0;
  return out;
}
