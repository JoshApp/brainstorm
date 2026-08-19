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
// Josh already makes recordings on his phone and sends them, so the census
// attaches itself to the front of a recording and arrives in the same file.
// No new thing to learn, no console on a phone.
// (This used to say the census could ONLY run on a real device, because the
// headless harness had no WebGPU. That stopped being true on 2026-08-13 — see
// scripts/headless-browser.ts. A headless run is a real WebGPU backend now, so
// the census CAN be driven from a script; the phone is still where the numbers
// mean something, since swiftshader's upload costs are not a phone's.)
//
// IT RUNS ON A TIMER, NOT AT RECORD-START. First version armed in
// startRecording() and produced nothing, because the recordings people
// actually make come from SAVE LAST 15s — a snapshot of a ring buffer that was
// already full by the time the button is pressed. You cannot census the past.
// So it re-arms every CENSUS_PERIOD_MS while the ring is rolling and keeps the
// most recent result; any snapshot then carries an attribution measured within
// the last few seconds, in the same scene it depicts.
//
// COST, stated because it is not free: `new Error().stack` is a few µs, so a
// census frame pays roughly 2–4ms extra. That lands on CENSUS_FRAMES frames
// every CENSUS_PERIOD_MS — about 2 frames in 300 — and the frames it touched
// are named in the export (`censusFrames`) so nobody mistakes the hitch it
// causes for the bug it is measuring.

const CENSUS_FRAMES = 2;
/** How often to re-census while the profiler ring is rolling. */
export const CENSUS_PERIOD_MS = 5000;

/** One BINDING OWNER, and what it uploaded. The `site` column says which code
 *  calls writeBuffer and, for the binding path, that is always the same three
 *  lines — useless for deciding what to fix. This says WHOSE buffer it was. */
export interface CensusOwner {
  /** `<groupName> [updateType] <uniform, uniform, …>` — the uniform group's
   *  identity plus the uniforms inside it. The uniform list is the payload:
   *  a group that re-uploads every frame while holding only a time value is a
   *  different problem from one holding modelViewMatrix. */
  owner: string;
  calls: number;
  kb: number;
  buffers: number;
  /** Whether three considers this group SHARED across render objects. A shared
   *  group uploading hundreds of times a frame is pure waste. */
  shared: boolean;
}

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
/** WHICH SLOT of a binding's buffer actually moved. `backend.updateBinding` is
 *  only reached when Three's own value-compare decided something changed, so a
 *  binding arriving here with NO changed bytes would mean the compare and the
 *  upload disagree — worth knowing, hence the explicit bucket for it. */
export interface CensusChange {
  /** e.g. "object · floats[0..15] 16/32" — group, span, and how much of it. */
  where: string;
  hits: number;
}

export interface CensusResult {
  frames: number;
  totalCalls: number;
  totalKB: number;
  /** Frame indices (relative to the recording) the census ran on. */
  censusFrames: [number, number];
  sites: CensusSite[];
  /** Per binding-owner attribution. Only the binding path appears here; the
   *  attribute/texture uploads have no uniform group and stay in `sites`. */
  owners?: CensusOwner[];
  /** Which float span of a binding's buffer actually moved. */
  changes?: CensusChange[];
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
const byChange = new Map<string, number>();
const prevBuf = new WeakMap<object, Float32Array>();
const byOwner = new Map<string, { calls: number; bytes: number; buffers: Set<unknown>; shared: boolean }>();
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

/**
 * Identify whose uniform buffer this is. `groupNode` carries the group's name,
 * whether three treats it as shared, and its update scope; the uniform list
 * says what is actually in the buffer — which is what decides the fix. A group
 * holding modelViewMatrix is dirtied by the camera and wants fewer render
 * objects; a group holding a time value is dirtied unconditionally and wants
 * hoisting into one shared frame-scoped group.
 */
function ownerOf(binding: unknown): { key: string; shared: boolean; bytes: number } {
  const b = binding as {
    name?: string;
    byteLength?: number;
    buffer?: { byteLength?: number };
    uniforms?: Array<{ name?: string }>;
    groupNode?: { name?: string; shared?: boolean; updateType?: string };
  };
  const g = b.groupNode;
  const uniforms = (b.uniforms ?? []).map((u) => u?.name ?? '?').slice(0, 8).join(',');
  const scope = g?.updateType ?? '?';
  const name = g?.name ?? b.name ?? '?';
  return {
    key: `${name} [${scope}]${g?.shared ? ' SHARED' : ''}  ${uniforms}`,
    shared: !!g?.shared,
    bytes: b.byteLength ?? b.buffer?.byteLength ?? 0,
  };
}

/** Diff a binding's CPU-side buffer against the copy kept from last time, and
 *  bucket by which float span moved. This is the attribution the stack-based
 *  view cannot give: every per-object write shares one call stack, so the only
 *  way to tell a matrix from a material scalar is to look at what changed. */
function recordChange(binding: unknown): void {
  const b = binding as { buffer?: ArrayLike<number>; groupNode?: { name?: string } } | undefined;
  const buf = b?.buffer;
  if (!buf || typeof buf.length !== 'number') return;
  const obj = binding as object;
  const last = prevBuf.get(obj);
  if (!last || last.length !== buf.length) {
    const copy = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) copy[i] = buf[i];
    prevBuf.set(obj, copy);
    return;
  }
  let first = -1, lastIdx = -1, n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (last[i] !== buf[i]) { if (first < 0) first = i; lastIdx = i; n++; last[i] = buf[i]; }
  }
  const g = b?.groupNode?.name ?? '?';
  const where = n === 0
    ? `${g} · NO BYTES CHANGED (uploaded anyway)`
    : `${g} · floats[${first}..${lastIdx}] ${n}/${buf.length}`;
  byChange.set(where, (byChange.get(where) ?? 0) + 1);
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
  // Re-armable. The previous result is deliberately NOT cleared here — it stays
  // readable until a new census finishes and replaces it, so a snapshot taken
  // at any moment always has an attribution to carry.
  if (active) return;
  const queue = (renderer as { backend?: { device?: { queue?: QueueLike } } })
    .backend?.device?.queue;
  if (!queue || typeof queue.writeBuffer !== 'function') return;

  active = true;
  framesLeft = CENSUS_FRAMES;
  startFrame = atFrame;
  frameIndex = 0;
  byCall.clear();
  byOwner.clear();

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
  // ALSO wrap the backend's updateBinding. The queue wrapper can only see the
  // destination GPUBuffer, which is anonymous; updateBinding receives the
  // BINDING, which knows its uniform group, its scope and its contents. That is
  // the difference between "something writes 500 buffers" and "these groups do,
  // holding these uniforms".
  const backend = (renderer as { backend?: Record<string, unknown> }).backend;
  const origUB = backend?.updateBinding as ((b: unknown) => void) | undefined;
  if (backend && typeof origUB === 'function') {
    backend.updateBinding = function (this: unknown, binding: unknown) {
      recordChange(binding);
      const { key, shared, bytes } = ownerOf(binding);
      let e = byOwner.get(key);
      if (!e) { e = { calls: 0, bytes: 0, buffers: new Set(), shared }; byOwner.set(key, e); }
      e.calls++;
      e.bytes += bytes;
      e.buffers.add(binding);
      return origUB.call(backend, binding);
    };
  }

  restore = () => {
    queue.writeBuffer = origWB;
    queue.writeTexture = origWT;
    if (backend && origUB) backend.updateBinding = origUB;
  };
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
  const owners: CensusOwner[] = [];
  for (const [owner, e] of byOwner) {
    owners.push({
      owner, calls: e.calls, shared: e.shared,
      kb: Math.round((e.bytes / 1024) * 10) / 10, buffers: e.buffers.size,
    });
  }
  owners.sort((a, b) => b.calls - a.calls);
  result = {
    frames: frameIndex,
    totalCalls,
    totalKB: Math.round((totalBytes / 1024) * 10) / 10,
    censusFrames: [startFrame, atFrame],
    // Cap the list: a long tail of one-call sites is noise, and the export
    // rides in a file someone has to upload from a phone.
    sites: sites.slice(0, 25),
    owners: owners.slice(0, 25),
    changes: [...byChange.entries()]
      .map(([where, hits]) => ({ where, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20),
  };
  byCall.clear();
  byOwner.clear();
  byChange.clear();
}

/** The aggregate, or null if the census never ran (WebGL2, or not armed). */
export function takeCensus(): CensusResult | null { return result; }

/** Clear so the next recording censuses afresh. */
export function resetCensus(): void {
  if (restore) { restore(); restore = null; }
  active = false;
  result = null;
  byCall.clear();
  byOwner.clear();
}
