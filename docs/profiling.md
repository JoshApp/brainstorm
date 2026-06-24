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
| **Session recorder** | "Where did frames drop over the last minute?" | toolbar `● REC` · `F3` · `?record=1` → cockpit |
| **Perf cockpit** | Scrub a recording across synchronized lanes; drill into one frame | `/brainstorm/perf-review.html` |
| **Detached live stream** | Watch the cockpit LIVE in a second tab, at ~zero cost to the game | `F9` · `?stream=1` · `window.__perfStream()` |
| **DevTools marks** | Native flame chart, incl. remote-over-USB from a phone | `F4` · `?marks=1` |
| **GPU probe** | Real GPU ms on devices without the timer-query extension | toolbar `GPU` · `F5` |
| **Per-pass GPU** | "WHICH render pass is eating the GPU ms?" (prepass/scene/bloom/blit) | toolbar `PASS` · `F8` · `window.__gpuPass()` |
| **GPU attribution** | "WHICH feature is eating the GPU ms?" — ranked A/B sweep, shareable | toolbar `ATTR` · `F7` · `window.__gpuAttr()` |
| **Draw report** | "What's eating the draw calls?" + instancing wins, shareable | toolbar `DRAWS` · `F6` |
| **Alloc profiler** | "WHO is allocating?" — ranked allocation sites w/ caller chains | `npm run alloc-profile` (PC, headless) |
| **spector.js** | Every GL command of a frame (deep; its result view exports) | toolbar `SPCT` · `window.__spector()` |

### Reading GPU time

Three signals, in order of preference:

1. **Timer query (passive, free).** If the WebGL2 `EXT_disjoint_timer_query_webgl2`
   extension is present, GPU ms is measured for free. Chrome hides it behind a
   flag on most phones — enable **`chrome://flags/#enable-webgl-developer-extensions`**
   (Enabled, relaunch) to try to turn it on for your device.
2. **GPU probe (`GPU` button / `F5`).** When the extension isn't available, this
   does a 1×1 `readPixels` every 8th frame — a synchronous readback that forces
   the GPU to finish, so the wall-clock around it is real GPU time. It STALLS the
   pipeline on sampled frames (fps dips while on), so treat it as a measurement
   mode, not always-on.
3. **`wait` = dt − cpu (always shown).** Frame interval minus CPU work ≈ GPU +
   vsync/compositor. When `wait` is the big number and GPU is `n/a`, you're
   GPU/fill-bound — arm the GPU probe to quantify it.

### Per-pass GPU timing (`PASS` / `F8`)

Splits the GPU number by render pass — prepass / scene / bloom / blit — shown
as a `gpu·` line in the profiler HUD. Uses labeled timer-query spans where the
extension exists; falls back to a readPixels-sync probe on every 8th frame
elsewhere (stalls those frames — measurement mode). This is how you tell
"the 3D scene pass is the wall" from "the full-res blit is the wall."

### GPU attribution sweep (`ATTR` / `F7`)

The A/B auto-profiler: toggles ONE feature off at a time, measures the GPU
delta, restores, and shares a ranked report. Covers the post pipeline (bloom,
inscatter/crush, sprites, motes), shadows, detail textures, the viewmodel
prepass — and the STRUCTURAL axes draw counts can't see: the light-pool
budget (every pooled PointLight is compiled into every lit material and
evaluated per fragment, parked or not), the PBR shading tax
(scene.overrideMaterial → Lambert/Basic, upper bounds), and resolution
(scene-target scale, canvas DPR — splits scene-pass fill from blit fill).
Hold still ~15-20s. It arms the GPU probe itself if no timing source is
active and suspends adaptive resolution for the duration. Read the report
programmatically with `window.__gpuAttrReport()`.

### Allocation-site profiling (`npm run alloc-profile [scenario]`)

The perf CLI's alloc-churn line says HOW MUCH; this says WHO. Drives Chrome's
sampling heap profiler over CDP while a scenario runs unfrozen (godmode on, so
a death doesn't freeze the churn mid-window), then prints ranked allocation
sites with caller chains, mapped to src/ files. Headless is representative
here — allocation behaviour is V8-level, unlike FPS. Watch for THREE's
`getProgram`/`cloneUniforms` showing up mid-run: that's a shader compiling
DURING gameplay (a hitch), i.e. a material that escaped warmup.

### Reading the `render` breakdown

`render` is split into sub-phases so it's not one opaque blob:
`render·prepass` (viewmodel depth) · `render·scene` (main draw, **includes shadow
maps** — usually the bulk) · `render·bloom` · `render·blit` (the PSX post pass).
These are CPU *submission* times; pair them with the GPU number above to tell
"too many draws" (high `render·scene` CPU) from "too much fill/shading" (high GPU).

On a phone, use the on-screen toolbar buttons (no F-keys). On desktop, the
hotkeys are quicker.

### Reviewing a recording made on the live site

The live build has no dev server to POST to, so stopping a recording
**downloads** the JSON instead. Review it in the **cockpit** at
**`/brainstorm/perf-review.html`** (deployed alongside the game) — drag the
downloaded `.json` onto the page.

## Hotkeys (desktop)

- `F2` — toggle the live Profiler HUD (FPS, CPU ms, GPU ms, per-system breakdown, graph).
- `F3` — start/stop a **session recording**. On stop it ships the recording to the PC (see below).
- `F4` — toggle Chrome DevTools User Timing marks (per-system `performance.measure`).
- `F6` — load spector.js and capture the next frame's draw calls.
- `F9` — toggle the **detached live stream** (feeds the cockpit's ● LIVE in a second tab).

Console equivalents: `window.__profiler()`, `window.__perfRec.toggle()`,
`window.__marks()`, `window.__perfStream()`, `window.__spector()`. URL flags:
`?profile=1`, `?record=1`, `?marks=1`, `?stream=1`.

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
4. On the PC: open **`/brainstorm/perf-review.html`** (the cockpit). Pick the
   recording from the dropdown (or drag a downloaded `.json` onto the page).

### Reading the cockpit

The cockpit stacks **synchronized lanes** on one shared, zoomable time axis —
the Unity/Unreal-profiler shape. One cursor crosses every lane, so a spike in
`dt` lines up with the GPU pass, the heap, the draw count, and any event tag at
the same instant.

- **CPU · ms/frame** — per-system cost stacked (heaviest at the bottom); the
  **white line** is the real frame interval (`dt`), the **magenta line** is GPU
  ms, dashed guides mark the 60fps (16.7ms) / 30fps (33.3ms) budgets, and red
  ticks along the top flag dropped frames. Watch which band swells in a spike.
- **GPU · passes** — `prepass`/`scene`/`bloom`/`blit` stacked from the per-pass
  timing (the `gph` data), so you see *which* pass owns the GPU ms, not just the
  total. Falls back to the GPU line where per-pass timing wasn't armed.
- **heap · GC** — the JS heap as a filled area with an orange tick on every GC
  frame. A staircase that climbs and never falls back = a leak; pair it with the
  next lane.
- **draws · geo/tex/prog** — draw count plus the geometry/texture/program
  resource lines (each self-normalized). A *climbing* geo/tex/prog line over a
  session is a GPU-resource leak the JS heap can't see.
- **events** — vertical flags where `spawn`/`death`/`level:N`/… were tagged: the
  "why" sitting directly under a spike.

**Driving it:** **wheel** zooms the time axis around the cursor, **drag** pans,
**click** pins a frame (click again or `Esc` to unpin), **←/→** step the pinned
frame (**Shift+←/→** jump spike-to-spike), **F** fits the whole recording. The
**spike chips** below the lanes jump to the worst frames.

**The pinned-frame panel** at the bottom is the single-frame drill-down: dt /
cpu / gpu / wait, draws, tris, geo/tex/prog, heap+GC, camera look angle, any
event — and a **hierarchical flame** of that frame's systems, with children
nested under parents (`render` → `render·scene`/`bloom`/`blit`). The **meta**
button (top bar) unfolds the recording's own context: device + the true **fill
resolution** (viewport × pixelRatio × renderScale — the dominant mobile lever),
the graphics settings it ran under, and the scene-audit drawable tally.

---

## Detached live profiling (the low-overhead cockpit)

An in-game HUD isn't free — it redraws a canvas + DOM on the game's own main
thread and GPU, so watching the profiler slightly perturbs what you're
profiling. Unity's "detached profiler" dodges this by rendering in a separate
process. The browser equivalent: stream the samples to a **second tab** and let
*it* do all the drawing. The game tab then pays only for sampling (which the
recorder already costs) plus **one `postMessage` per frame** — no canvas, no
layout. (`src/debug/perf-stream.ts` over a `BroadcastChannel`.)

1. In the game: enable the stream — `F9`, `?stream=1`, or `window.__perfStream()`.
2. In a **second tab/window** open the cockpit (`/brainstorm/perf-review.html`)
   and click **● LIVE**. It connects, follows the tail in real time, and keeps a
   rolling ~60s buffer.
3. Pin / zoom / pan at any time to freeze and inspect — the live tail keeps
   filling underneath; `Esc` resumes following. Clicking **■ STOP** keeps the
   captured buffer as an ordinary scrub session.

Caveat: `BroadcastChannel` is same-origin **same-browser** — great for desktop
(game in one window, cockpit beside it). For the *phone→desktop* case use route
B below (remote DevTools over USB), which is the true zero-overhead detached
profiler for mobile. Also note the foreground tab runs full-speed while
background tabs are rAF-throttled, so put the two windows side by side (both
visible) rather than stacked.

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

### What `?marks=1` puts on the Timings track

With marks on, the native flame chart shows a labeled span for **every
system** (`combat`, `light-pool`, `render`, …) on the same axis as the
browser's own work — layout, GC pauses, paint, and the GPU track. That's the
fastest way to see "the frame went here" without any custom tooling: the
browser's profiler is already Unity-grade once you feed it spans.

The render system is split a level deeper — `render·prepass` / `render·scene` /
`render·bloom` / `render·blit` nest *under* the `render` bar — so the known wall
(scene fill) is visible natively, not just in our recorder.

#### Adding depth where you need it — `profSpan`

The per-system spans are flat: they tell you *which* system is fat, not *why*.
To carve a fat system into nested sub-spans, wrap the work in **`profSpan`**
(`src/debug/prof-span.ts`):

```ts
import { profSpan } from '../debug/prof-span';

profSpan('combat·hitscan', () => resolveSwing(ctx));
profSpan('combat·ai',      () => { for (const e of enemies) e.think(); });
```

A span opened during a system's tick falls inside that system's `[t0,t1]`
window, so DevTools nests it automatically — the flame chart gains depth exactly
where you instrument. It's **free when marks are off** (one boolean check), so
it's safe to leave in a hot path. Name spans `parent·child` (middle-dot) to match
the render convention; the cockpit groups the same way. (`profBegin`/`profEnd` is
the manual form for when a closure doesn't fit.)

### Capturing a trace headlessly via the `chrome-devtools` MCP

For an agent-driven capture on real Windows Chrome (real GPU/ANGLE, not WSL
swiftshader), the `chrome-devtools` MCP drives the Performance panel directly:

1. `new_page` → the game with marks armed, e.g.
   `…/brainstorm/?scenario=perf-horde&profiler=1&marks=1`.
2. `performance_start_trace` (reload, autoStop off) → let it play a few seconds →
   `performance_stop_trace`.
3. `performance_analyze_insight` for the headline costs, or read the Timings
   track spans straight from the trace — they're our system + `render·*` +
   `profSpan` labels.

Counts in a headless capture (draws, tris, light/resource counts) are
trustworthy because they're GPU-independent; **frame times** are only real on
the on-device or real-GPU path, never swiftshader.

---

## Draw-call autopsy

### Draw report (`DRAWS` / `F6`) — the phone-friendly one

Walks the live scene graph and reports what's generating the draws, ranked by
the biggest **instancing wins**: groups of meshes that share a shape + material
and could collapse into one `InstancedMesh`. Grouped semantically (by shape +
material params, not object identity), so "64 identical dark spheres" reads as
one line, not 64. Output is a text report shared via the OS share sheet — so you
can send it off the phone (to yourself, or to review). This is the practical
"what's eating the draws" tool on mobile.

### spector.js (`window.__spector()`) — DESKTOP only

The deep option: captures the next frame's entire GL command stream (every draw,
state change, shader, texture). Loads from a CDN on demand. Its UI is heavy and
desktop-oriented and there's no good way to export or even close it on a phone —
so it's console-only now (`window.__spector()`), best used on desktop or via the
[spector.js browser extension](https://spector.babylonjs.com/). On mobile, use
the draw report above.

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
