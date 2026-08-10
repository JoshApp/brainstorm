// ── UPLOAD CENSUS — WHERE DO THE 567 WRITES PER FRAME COME FROM? ─────────────
//
// upload-counter.ts already counts `device.queue.writeBuffer` + `writeTexture`
// calls per frame into the `ub` column. Four pooled phone recordings then said
// something the column alone could not: renderer CPU tracks THAT count at
// r=+0.92, while draw calls manage +0.27 and triangles +0.22. At ~567 calls a
// frame and ~16 µs each that is the ~9ms of `render·scene` — the whole problem,
// in one number.
//
// A count is not a cause. This attributes the calls: for a couple of frames it
// captures a stack signature per upload and aggregates by call site, so the
// report says WHICH code is doing 567 writes rather than that someone is.
//
// WHY IT RIDES ALONG WITH A RECORDING, rather than being a console command:
// the measurement only exists on the WebGPU backend, and the headless harness
// has no working WebGPU (every snap in this project forces `webgpu=0`) — so
// this cannot be run from CI or from a script here. It has to run on a real
// device. Josh already makes recordings on his phone and sends them, so the
// census attaches itself to the front of a recording and arrives in the same
// file. No new thing to learn, no console on a phone.
//
// COST, stated because it is not free: `new Error().stack` is a few µs, so a
// census frame pays roughly 2–4ms extra. It runs for CENSUS_FRAMES frames at
// the START of a recording and then removes itself, and the frames it touched
// are named in the export (`censusFrames`) so nobody mistakes the hitch it
// causes for the bug it is measuring.

const CENSUS_FRAMES = 2;

/** One call site, and what it uploaded. */
export interface CensusSite {
  /** Trimmed stack signature — the first few frames outside this module. */
  site: string;
  calls: number;
  kb: number;
  /** Distinct destination buffers seen. A high call count against a LOW
   *  buffer count means the same buffer is rewritten many times per frame;
   *  the two need different fixes, so the report keeps them apart. */
  buffers: number;
}
export interface CensusResult {
  frames: number;
  totalCalls: number;
  totalKB: number;
  /** Frame indices (relative to the recording) the census ran on. */
  censusFrames: [number, number];
  sites: CensusSite[];
}

interface QueueLike {
  writeBuffer(...args: unknown[]): void;
  writeTexture(...args: unknown[]): void;
}

let active = false;
let framesLeft = 0;
let startFrame = 0;
let frameIndex = 0;
const byCall = new Map<string, { calls: number; bytes: number; buffers: Set<unknown> }>();
let result: CensusResult | null = null;
let restore: (() => void) | null = null;

/**
 * Turn a stack into a stable, short signature. Drops this module's own frames
 * and the counter's wrapper, keeps the next few — that is the boundary between
 * "the renderer's upload plumbing" and "whoever asked it to upload", which is
 * the distinction the whole census exists to draw.
 */
function signature(stack: string | undefined): string {
  if (!stack) return '(no stack)';
  const lines = stack.split('\n').slice(1)
    .map((l) => l.trim().replace(/^at\s+/, ''))
    .filter((l) => !l.includes('upload-census') && !l.includes('upload-counter'));
  const keep = lines.slice(0, 4).map((l) => {
    // "fnName (https://host/assets/chunk-abc123.js:1234:56)" → "fnName @chunk:1234"
    const m = l.match(/^(\S+)\s*\(?.*?\/([^/]+?):(\d+):\d+\)?$/);
    return m ? `${m[1]} @${m[2].replace(/-[a-zA-Z0-9]{6,}\./, '.')}:${m[3]}` : l.slice(0, 70);
  });
  return keep.join(' ← ') || '(empty)';
}

function byteLen(data: unknown): number {
  return (data as { byteLength?: number } | undefined)?.byteLength ?? 0;
}

function record(dest: unknown, bytes: number): void {
  const sig = signature(new Error().stack);
  let e = byCall.get(sig);
  if (!e) { e = { calls: 0, bytes: 0, buffers: new Set() }; byCall.set(sig, e); }
  e.calls++;
  e.bytes += bytes;
  e.buffers.add(dest);
}

/**
 * Arm the census. Wraps the queue for CENSUS_FRAMES frames, then unwraps itself
 * and leaves the aggregate in `takeCensus()`. Safe to call on a WebGL2 backend
 * (no device → does nothing and reports nothing, exactly like the counter).
 */
export function armCensus(renderer: unknown, atFrame: number): void {
  if (active || result) return;
  const queue = (renderer as { backend?: { device?: { queue?: QueueLike } } })
    .backend?.device?.queue;
  if (!queue || typeof queue.writeBuffer !== 'function') return;

  active = true;
  framesLeft = CENSUS_FRAMES;
  startFrame = atFrame;
  frameIndex = 0;
  byCall.clear();

  // Keep the RAW method references and re-apply them with .call, rather than
  // stashing `fn.bind(queue)`. Restoring a bound copy puts a different function
  // on the property than the one that was there, so the next arm binds the
  // bound one — and a session with several recordings would build a chain of
  // wrappers, each adding a call frame to every upload the game makes. A
  // profiler that gets more expensive the more you profile is worse than none.
  const origWB = queue.writeBuffer;
  const origWT = queue.writeTexture;
  queue.writeBuffer = function (this: unknown, ...args: unknown[]) {
    record(args[0], (args[4] as number | undefined) ?? byteLen(args[2]));
    return origWB.apply(queue, args as never);
  };
  queue.writeTexture = function (this: unknown, ...args: unknown[]) {
    record((args[0] as { texture?: unknown } | undefined)?.texture, byteLen(args[1]));
    return origWT.apply(queue, args as never);
  };
  restore = () => { queue.writeBuffer = origWB; queue.writeTexture = origWT; };
}

/** Call once per frame while a recording runs. Ends the census on its own. */
export function tickCensus(atFrame: number): void {
  if (!active) return;
  frameIndex++;
  if (--framesLeft > 0) return;
  active = false;
  restore?.();
  restore = null;
  let totalCalls = 0, totalBytes = 0;
  const sites: CensusSite[] = [];
  for (const [site, e] of byCall) {
    totalCalls += e.calls;
    totalBytes += e.bytes;
    sites.push({ site, calls: e.calls, kb: Math.round((e.bytes / 1024) * 10) / 10, buffers: e.buffers.size });
  }
  sites.sort((a, b) => b.calls - a.calls);
  result = {
    frames: frameIndex,
    totalCalls,
    totalKB: Math.round((totalBytes / 1024) * 10) / 10,
    censusFrames: [startFrame, atFrame],
    // Cap the list: a long tail of one-call sites is noise, and the export
    // rides in a file someone has to upload from a phone.
    sites: sites.slice(0, 25),
  };
  byCall.clear();
}

/** The aggregate, or null if the census never ran (WebGL2, or not armed). */
export function takeCensus(): CensusResult | null { return result; }

/** Clear so the next recording censuses afresh. */
export function resetCensus(): void {
  if (restore) { restore(); restore = null; }
  active = false;
  result = null;
  byCall.clear();
}
