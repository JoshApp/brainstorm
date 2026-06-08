// GPU frame timer — measures actual GPU execution time per frame via the
// WebGL2 `EXT_disjoint_timer_query_webgl2` extension. This is the number a
// CPU-side `performance.now()` CANNOT give you: how long the GPU spent
// chewing through the frame's draw calls, independent of the JS that
// submitted them. On a phone it's usually the GPU that's the wall, so this
// is the readout that tells you "we're fill-rate / shader bound" vs
// "we're CPU/script bound."
//
// How timer queries work (and why the result lags): you bracket the frame's
// GL commands with beginQuery/endQuery, but the answer isn't ready until the
// GPU actually finishes — a few frames later. So we keep a small ring of
// query objects in flight and harvest each one once its result is available.
// `lastMs` is therefore the GPU time of a frame 1–3 frames ago, which is
// fine for a HUD readout.
//
// DEV-only tool; gracefully degrades to `supported = false` (lastMs stays
// null) on WebGL1, on browsers without the extension (Safari), and whenever
// the driver signals a "disjoint" (a GPU clock glitch / context switch that
// invalidates outstanding measurements).

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private gl: WebGL2RenderingContext | null = null;
  private ext: TimerExt | null = null;
  private active: WebGLQuery | null = null;
  private inFlight: WebGLQuery[] = [];
  private free: WebGLQuery[] = [];

  /** Most recent completed GPU time in ms, or null if unavailable yet. */
  lastMs: number | null = null;
  /** Whether timer queries are usable in this context at all. */
  supported = false;

  constructor(glCtx: WebGLRenderingContext | WebGL2RenderingContext) {
    // Only WebGL2 carries the elapsed-time query we need.
    if (typeof WebGL2RenderingContext === 'undefined' || !(glCtx instanceof WebGL2RenderingContext)) {
      return;
    }
    const ext = glCtx.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    if (!ext) return;
    this.gl = glCtx;
    this.ext = ext;
    this.supported = true;
  }

  /** Open a measurement spanning the GL commands issued until end(). */
  begin(): void {
    if (!this.gl || !this.ext || this.active) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  /** Close the open measurement and queue it for later harvest. */
  end(): void {
    if (!this.gl || !this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.inFlight.push(this.active);
    this.active = null;
  }

  /** Harvest any finished queries. Call once per frame after end(). */
  poll(): void {
    if (!this.gl || !this.ext) return;
    // A disjoint event means the GPU timer was unreliable across these
    // queries (thermal throttle, context switch) — discard them all.
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      for (const q of this.inFlight) this.free.push(q);
      this.inFlight.length = 0;
      return;
    }
    while (this.inFlight.length) {
      const q = this.inFlight[0];
      const available = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;
      const ns = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) as number;
      const ms = ns / 1e6;   // nanoseconds → milliseconds
      // Guard against driver garbage: some return 2^64-1 (≈1.8e13 ms once
      // divided) when the result is actually invalid even though
      // QUERY_RESULT_AVAILABLE reported true. A real GPU frame is never near a
      // second, so reject anything implausible rather than report nonsense.
      if (Number.isFinite(ms) && ms >= 0 && ms < 1000) this.lastMs = ms;
      this.inFlight.shift();
      this.free.push(q);
    }
  }
}
