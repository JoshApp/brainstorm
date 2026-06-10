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
