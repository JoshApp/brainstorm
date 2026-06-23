// Common transport for ALL runtime AI decisions (PROTOTYPE).
//
// One seam for every AI verb. Game code calls requestNow() / prefetch() /
// claim(); it never knows whether the answer was retrieved or generated, nor
// whether it came from the dev daemon-shim or the prod Cloudflare Worker.
// Adding a new AI-driven thing later = a new `kind`, not new plumbing. This is
// the "don't stitch weird things all over the place" layer.
//
// Contract (both the dev shim and the prod Worker implement it):
//   POST /api/ai { kind, context, idempotencyKey? }  ->  { line?, name?, flavor? }
//
// Latency model: split every award into a MECHANICAL core (rolled by the
// deterministic engine — instant, replay-safe) and a NARRATIVE skin (this
// layer — async, cosmetic). Request the skin AHEAD (prefetch) and deliver it
// at a moment whose animation covers the wait (claim), with a baked fallback
// so the player never blocks. See docs/ALPHA-AND-BACKEND.md.

import { getRunState } from '../state/run-state';
import { getPlayerName } from '../state/meta-state';

export type AIKind = 'voice' | 'item-skin' | 'fate-card';

export interface AIArtifact {
  line?: string;
  name?: string;
  flavor?: string;
}

/** Loosely typed for the prototype. The backend wants `embedText` for caching
 *  and the base provenance fields for attribution; kind-specific fields ride
 *  along. */
export type AIContext = Record<string, unknown>;

// Dev-only for now; flips to include prod when the Worker ships. The /api/ai
// contract is identical — only this gate changes.
const AI_ENABLED = import.meta.env.DEV;
const ENDPOINT = '/api/ai';
const DEFAULT_TIMEOUT_MS = 20_000; // the deep is slow; it has all the time there is

/** Stamp shared provenance/cache base onto every context (kind fields win). */
function withBase(context: AIContext): AIContext {
  const run = getRunState();
  return {
    runSeed: run?.startedAt ?? 0,
    depth: run?.depth ?? 1,
    name: getPlayerName() ?? 'a nameless delver',
    ...context,
  };
}

/** Fire one AI request and await it. Returns null on any failure (best-effort). */
export async function requestNow(
  kind: AIKind,
  context: AIContext,
  opts: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<AIArtifact | null> {
  if (!AI_ENABLED) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, context: withBase(context), idempotencyKey: opts.idempotencyKey }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return (await resp.json().catch(() => null)) as AIArtifact | null;
  } catch {
    return null; // no shim, offline, or timeout — the deep stays silent
  }
}

/** A request started ahead of time. `claim` it at the delivery moment. */
export interface Ticket {
  kind: AIKind;
  promise: Promise<AIArtifact | null>;
}

/** Start generating now; deliver later. Returns immediately. */
export function prefetch(
  kind: AIKind,
  context: AIContext,
  opts: { idempotencyKey?: string } = {},
): Ticket {
  return { kind, promise: requestNow(kind, context, opts) };
}

/** Deliver a prefetched artifact. Ready within `coverMs` → it; else `fallback`. */
export async function claim(
  ticket: Ticket,
  opts: { coverMs?: number; fallback?: AIArtifact } = {},
): Promise<AIArtifact | null> {
  const cover = opts.coverMs ?? 0;
  if (cover <= 0) return ticket.promise; // no cover — just await
  const timeout = new Promise<AIArtifact | null>((r) =>
    setTimeout(() => r(opts.fallback ?? null), cover),
  );
  return Promise.race([ticket.promise, timeout]);
}

/**
 * A small buffer of ready artifacts for one kind. `warm()` keeps N requests in
 * flight; `take()` delivers the oldest (within a cover window, else a fallback)
 * and refills. Decouples generation rate from delivery rate — every drop reads
 * as instant as long as generation keeps up on average; the delivery animation
 * absorbs the variance. This is how the game "requests an item in advance".
 */
export class RewardPool {
  private tickets: Ticket[] = [];

  constructor(
    private readonly kind: AIKind,
    private readonly makeContext: () => AIContext,
    private readonly size = 2,
  ) {}

  /** Fill the pool to size. Safe to call repeatedly. */
  warm(): void {
    if (!AI_ENABLED) return;
    while (this.tickets.length < this.size) {
      this.tickets.push(prefetch(this.kind, this.makeContext()));
    }
  }

  /** Take the oldest ready artifact (cover window, else fallback); refill. */
  async take(opts: { coverMs?: number; fallback?: AIArtifact } = {}): Promise<AIArtifact | null> {
    if (!AI_ENABLED) return opts.fallback ?? null;
    if (this.tickets.length === 0) this.warm();
    const ticket = this.tickets.shift();
    this.warm(); // refill in the background
    if (!ticket) return opts.fallback ?? null;
    return claim(ticket, opts);
  }
}
