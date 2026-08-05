# Preloading: what the warm actually covers, and what it never did

Written 2026-08-05 answering Josh:

> *"Please revisit the preloading — we made this whole effort of preloading
> things, why are items not covered by that? I think we have to architect it
> better to allow for things to preload or at least not lag the game. Also the
> first loading screen takes a while even while already in game, and pressing new
> run you go back to the main menu which kinda starts at 80% and then takes a
> while, while the descent is almost instant once you've been through it."*

Two separate things, both real, and neither one was what it looked like.

---

## 1. "Why are items not covered by the preload"

They are — by exactly half of it, and that half was chosen deliberately.

The warm pass (`src/content/warmup-pass.ts`, `src/content/spawn-warmups.ts`)
covers **GPU pipeline compilation**: for each of the 107 items it creates the
material and renders it on a tiny dummy mesh, which compiles the same pipeline
the live drop will use. It explicitly does **not** build the model — the file
says so at the top, and it is right to, because `buildCreature`/`buildModel` is
the heavy synchronous cost that used to freeze the tab.

So the warm covers the GPU and skips the CPU. The question is whether the CPU
side is cheap enough to be skipped. Measured across all 107 item drop models:

| | first build | steady state |
|---|---|---|
| all 107 | 251ms | 100ms |
| average per item | 2.3ms | 0.9ms |
| **skeleton-key alone** | **107ms** | **37ms** |

One model was 37% of the whole catalogue's steady-state cost. The skeleton key is
a skull with two eye sockets subtracted — a **CSG boolean**, the one operation in
the model builder that is expensive rather than merely not-free. Keys drop
constantly, so that was a dropped frame every single time the dungeon paid you,
and no amount of pipeline warming would ever have touched it, because the cost
was never on the GPU.

### Why it went unnoticed for so long

Worth recording, because it is a repeatable mistake. The first pass of this
investigation wrote a walker to find CSG-bearing specs, and it reported **zero**.
The walker followed `children`; a boolean's operands live under `a` and `b`. A
detector that finds nothing is indistinguishable from a codebase with nothing to
find, and it reads as reassuring.

The fix in `spawn-warmups.ts` walks **every value of every object** and asks one
question. It is slower and uglier than a typed walk and it will keep working when
the spec shape grows a new container field — which matters doubly because the
content layer authors these specs and cannot be expected to opt into a warm.

### What changed

1. **`build-model.ts` caches the boolean.** A CSG result is a pure function of its
   spec node, and spec nodes are module-level constants, so a `WeakMap` keyed on
   node identity is enough. Repeats hand out a **clone**, never the instance: a
   clone is a typed-array copy against a 37ms BVH boolean, and sharing the
   geometry would let any downstream merge or dispose reach into every other
   build of that spec — the same aliasing class as the shared sprite geometry
   that crashed ember pickups a day earlier.
   → skeleton-key repeats **37ms → 2.2ms**; whole catalogue steady state
   **100ms → 54ms**.

2. **`spawn-warmups.ts` builds every CSG-bearing spec at boot**, so the *first*
   one is paid behind the loading veil. That is what the veil is for.

3. **`tests/model-build-cost.test.ts`** pins both: repeats must be a fraction of
   the first build (a ratio, so it holds on any box), and no item model may cost
   more than 8ms warm.

### The rule this leaves behind

> **The warm covers pipelines. Anything whose cost is CPU-side has to be warmed
> explicitly, and detected from the data rather than listed by hand.**

Today that means CSG. If a future spec kind is expensive to *build* — a mesh
boolean, a heavy lathe, a subdivision — it needs the same treatment, and adding
it to a hand-maintained list is not treatment.

---

## 2. "It starts at 80% and then takes a while"

He was reading the bar correctly. The bar was lying.

Boot has **four** phases and the bar was wired to **one**:

| phase | what it waits for |
|---|---|
| `boot-gate` | check for a fresh build, mount the title vignette |
| `title-settle` | the title vignette's pipelines stop compiling (≤4s) |
| `roster-warm` | build + compile the content roster ← **the only phase with a bar** |
| `clean-frames` | presented frames + a second compile settle (≤4.5s) |

Measured headless (software raster, so `roster-warm` is wildly exaggerated — but
the dead zones are hardware-independent, and they are the whole problem):

```
before:  5.4s of boot with NO BAR AT ALL
         bar revealed already part-filled
         bar SAT AT 100% for 2.5s before the veil dropped
```

The "80%" is those facts meeting. The bar revealed itself on its *first update*
behind a 0.4s opacity fade — so on real hardware, where `roster-warm` is a couple
of seconds rather than forty, the fill has already run most of its travel before
the player can see the bar at all. Then the three phases the bar cannot express
are the "takes a while".

Nothing was slow that had not always been slow. The bar measured a quarter of the
wait and presented it as the whole thing.

### What changed

`src/ui/boot-progress.ts` is now the single writer of the bar (`setBootProgress`
has one caller). Every phase reports into one span:

- Phases that do countable work pass their own fraction.
- Phases that are budget-capped **waits** pass `elapsed / budget` — honest,
  because the budget *is* their worst case, and settling early simply hands the
  remainder to the next phase. Progress is monotonic, so the bar jumps forward
  rather than rewinding.
- The bar is `on` in `index.html`, visible from **first paint**. Roughly 2s of
  boot is JS module evaluation before any of our code runs; a bar that appears
  after that is a bar the player catches part-filled.

```
after:   0.2s of boot with no bar
         bar revealed at 0%
         bar sat at 100% for 0.3s
```

### Why the weights are learned, not constants

The phases' relative cost is a property of the **device**, not the game.
`title-settle` and `clean-frames` are capped waits; `roster-warm` is unbounded
real work that is seconds on a good GPU and forty on a software rasteriser. Any
constant weighting is badly wrong on one of them.

So each boot records what its phases cost and the **next** boot uses those as its
weights (smoothed 0.4, stored in `localStorage`). That fits the complaint exactly:
"new run" is `location.reload()` (settings-menu `abandonRun` / `quitToMenu`), so
the boot Josh is describing is *never* the first one — it always has a previous
boot's measurements to draw on. Only a first-ever boot runs on defaults.

### Measuring it again

`src/debug/boot-timeline.ts` prints the phase table in DEV, and exposes
`window.__bootTimeline()`. `scripts/tmp/boot-timing.ts` drives a cold load then a
reload in the same context (warm caches — what NEW RUN hits) and reports both the
phase split and what the bar visibly did.

Run it before touching anything here. "Which part of boot is slow" was not a
question this code could answer until now, and every previous fix in this area
was a guess at whichever phase someone happened to suspect.

---

## 3. Still open

- **`roster-warm` genuinely dominates.** Making the bar honest does not make the
  boot fast. The real lever is warming *fewer* pipelines up front (the roster is
  warmed in full at every boot) or getting more of it into the browser's
  persistent pipeline cache. Not attempted here — measure first.
- **`clean-frames` may be over-budgeted.** It is capped at 4.5s and consistently
  finishes in ~2s headless. Worth checking on a phone before trimming.
- **The 2s before any of our code runs** is module parse + evaluate. That is a
  bundle-size question, not a loading question.
