# Profiling DELVE

The performance toolkit, layered from "glance" to "deep autopsy".

**These tools ship in the production build**, behind the **PROFILER TOOLS**
setting (Settings → DEBUG), off by default. They're safe diagnostics — no
gameplay effect — so they ride the same "diagnostics are the exception"
carve-out as the perf meter, rather than being `import.meta.env.DEV`-stripped.
Zero footprint until the toggle is flipped: the timing core, HUD, and toolbar
are lazily created the first time it's enabled.

**Enable it** with the PROFILER TOOLS setting, or a `?profiler=1` (also
`?profile/record/marks=1`) URL flag for a one-session enable — works on the
**live site, on the phone**, which is the whole point.

When enabled, an **on-screen toolbar** appears (top-left): `HUD` · `● REC` ·
`SPCT` — so you can drive everything by tapping, no keyboard needed.

## The layers

| Tool | Answers | Where |
| --- | --- | --- |
| **PERF METER** | "How fast am I right now?" | Settings → PERF METER |
| **Profiler HUD** | "Which system is eating the frame?" | toolbar `HUD` · `F2` · `?profile=1` |
| **Session recorder** | "Where did frames drop over the last minute?" | toolbar `● REC` · `F3` · `?record=1` → review page |
| **DevTools marks** | Native flame chart, incl. remote-over-USB from a phone | `F4` · `?marks=1` |
| **spector.js** | "What's eating the draw calls?" (every GL command) | toolbar `SPCT` · `F6` |

On a phone, use the on-screen toolbar buttons (no F-keys). On desktop, the
hotkeys are quicker.

### Reviewing a recording made on the live site

The live build has no dev server to POST to, so stopping a recording
**downloads** the JSON instead. Review it at **`/brainstorm/perf-review.html`**
(deployed alongside the game) — drag the downloaded `.json` onto the page.

## Hotkeys (desktop)

- `F2` — toggle the live Profiler HUD (FPS, CPU ms, GPU ms, per-system breakdown, graph).
- `F3` — start/stop a **session recording**. On stop it ships the recording to the PC (see below).
- `F4` — toggle Chrome DevTools User Timing marks (per-system `performance.measure`).
- `F6` — load spector.js and capture the next frame's draw calls.

Console equivalents: `window.__profiler()`, `window.__perfRec.toggle()`,
`window.__marks()`, `window.__spector()`. URL flags: `?profile=1`, `?record=1`,
`?marks=1`.

---

## Recording a session and reviewing it on the PC

This is the "play on the phone, review on the PC" loop — and it works **over
WiFi, no cable**, because the phone already loaded the game from the PC's dev
server.

1. On the PC: `npm run dev` (the server listens on the LAN; scan the QR / use
   the `Network:` URL it prints).
2. On the phone: open that URL, optionally with `?record=1` to auto-start, or
   tap `F3`-equivalent via `window.__perfRec.start()` from a remote console.
   Easiest: append `?scenario=perf-horde&record=1` to stress-test, or just play.
3. Stop the recording (`F3` again / `window.__perfRec.stop()`). It POSTs the
   timeline to the dev server, which writes `perf-recordings/<id>.json` on the PC.
   (No dev server reachable? It falls back to a file **download** instead.)
4. On the PC: open **`/brainstorm/perf-review.html`**. Pick the recording from
   the dropdown (or drag a downloaded `.json` onto the page).

### Reading the review timeline

- **Stacked bands** = each frame's per-system CPU cost, heaviest at the bottom.
  Watch which band swells during a spike — that's your culprit system.
- **White line** = the real frame interval (`dt`) — the "are we hitting 60fps?" truth.
- **Magenta line** = GPU time (when supported).
- **Dashed lines** = the 60fps (16.7ms) and 30fps (33.3ms) budgets.
- **Red ticks** (top) = dropped frames (`dt` > 1.5× budget).
- **Spike chips** (bottom) jump the cursor to the worst frames.
- **Hover** anywhere to read that frame's full breakdown: dt/cpu/gpu, draws,
  tris, heap, GC, and every system sorted by cost.

---

## Using the PC as a profiler for the phone

Two routes, pick by platform:

### A. Over WiFi (any phone) — the in-engine recorder

The recorder loop above. No cable, works on iOS and Android. Best for "capture
a real play session and study the timeline." This is the primary path.

### B. Over USB (Android) — Chrome DevTools remote

Highest fidelity: the *full* DevTools Performance panel profiling the phone's
real execution, with native dropped-frame markers, the 60fps ruler, and — with
`?marks=1` on — the per-system flame chart from our User Timing marks.

1. Phone: enable Developer Options → USB debugging. Plug into the PC.
2. PC Chrome: open `chrome://inspect/#devices`, find the phone's tab, click
   **inspect**.
3. In the remote DevTools, open **Performance**, hit record, play on the phone,
   stop. Scrub the flame chart; the **Timings** track shows our per-system spans.

(iOS equivalent: Safari → Develop menu → your iPhone → Web Inspector → Timelines,
from a Mac over USB.)

---

## Draw-call autopsy with spector.js

When you're GPU-bound or the draw count looks too high, `F6` captures the next
frame's entire GL command stream — every draw, state change, shader, texture.
It loads from a CDN on demand (nothing in the bundle). Offline? Install the
[spector.js browser extension](https://spector.babylonjs.com/) and click its
capture button — same tool, no code.

---

## The optimization playbook (what to do once you've found it)

1. **CPU-bound or GPU-bound?** Compare CPU ms vs GPU ms in the HUD/recording.
   The whole hunt forks here.
2. **Draw calls are the #1 Three.js killer.** Each unique geometry+material =
   one draw. Watch the `draws` count; a model authored as 20 primitives with 20
   materials is 20 draws/frame. Merge static geometry, share materials. The
   engine's geometry-pool + light-pool already dedupe — make sure new content
   routes through them.
3. **Lights & shadows** are expensive on mobile; the light-pool's LOS culling is
   load-bearing.
4. **Kill per-frame allocations** — watch the alloc rate / GC ticks. `new
   Vector3()` in a hot loop = stutter. Use scratch vectors (`forwardScratch`).
5. **Overdraw** — stacked transparent/additive sprites (motes, wisps, flames)
   murder mobile fill rate.
