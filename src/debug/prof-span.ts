// Nested User-Timing spans for the native Chrome-DevTools flame chart.
//
// loop.ts already wraps every top-level system in one performance.measure, so a
// DevTools Performance recording (incl. remote over USB from a phone) shows a
// flat row of ~46 system bars on the Timings track. That tells you WHICH system
// is fat — not WHY. profSpan() lets code INSIDE a system carve its work into
// nested sub-spans: a span opened during a system's tick falls within that
// system's [t0,t1] window, so DevTools nests it underneath automatically and
// the flame chart gains depth exactly where you instrument it.
//
// Gated on the same "DevTools marks" toggle as the per-system measures
// (frame-timing.setMarks → setProfSpans). When OFF, profSpan is one boolean
// check and a direct call — no measure, no timestamp, no allocation — so it's
// free to leave in a hot path. When ON it costs two performance.now() reads and
// a performance.measure per wrapped span.
//
// Convention: name spans 'parent·child' (middle-dot U+00B7). That's the same
// separator render-target uses (render·scene, render·bloom …) and the one the
// perf-review cockpit groups by, so a span authored here lines up in BOTH the
// native flame chart and the recorded timeline.

let active = false;

/** Driven by frame-timing.setMarks — true exactly when User Timing marks are
 *  being emitted. Nothing else should flip this. */
export function setProfSpans(on: boolean): void { active = on; }
export function profSpansOn(): boolean { return active; }

/** Wrap a unit of work in a named span; returns fn()'s value untouched. Nests
 *  under whatever span is open around it (the enclosing system, or an outer
 *  profSpan). Free when marks are off.
 *
 *    profSpan('combat·hitscan', () => resolveSwing(ctx));
 */
export function profSpan<T>(label: string, fn: () => T): T {
  if (!active) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    performance.measure(label, { start, end: performance.now() });
  }
}

/** Manual begin/end for when a closure doesn't fit (e.g. a span that brackets a
 *  loop you don't want to wrap in a function). MUST be balanced. profBegin()
 *  returns a token to hand to profEnd(); both are no-ops when marks are off.
 *
 *    const t = profBegin();
 *    for (const e of enemies) e.think();
 *    profEnd('combat·ai', t);
 */
export function profBegin(): number { return active ? performance.now() : 0; }
export function profEnd(label: string, token: number): void {
  if (active && token) performance.measure(label, { start: token, end: performance.now() });
}
