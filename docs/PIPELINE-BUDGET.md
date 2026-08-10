# Pipeline Budget — zero in-game compilation (v2: the template architecture)

The charter for "no hitches during gameplay, ever." This is the **why** + the **architecture**;
`docs/WARMUP.md` is the warm machinery. v1 (decor) is shipped and proved the approach; v2
generalizes it to the whole renderer.

## The reframe (read this first)

There are TWO costs, and only the first is the hitch:

1. **Pipeline COMPILATION** — depends ONLY on `(material × vertex-layout × render-state)`. It does
   **not** depend on the specific level. Two procgen floors made of the same wall material + vertex
   format share the same pipeline. This set is **finite and knowable at build time**.
2. **Resource RESIDENCY** — uploading *this* floor's buffers/textures. Level-specific, but **fast,
   never compiles a shader**.

> **We do not prewarm "the level." We prewarm the closed SET of pipelines** — the same for every
> floor → it belongs at the **boot** loading screen. The per-descent screen then does residency only.

## Why we can't boot-warm today

Not because the level doesn't exist yet (irrelevant — we warm the pipeline set, not geometry).
The real blocker: **the pipeline set is unbounded.** On Three-WebGPU **every material *instance*
becomes its own pipeline** ([three.js #32735] — it's why sharing decor instances via `stdMat` cut
compiles). We mint instances *per thing* — per interactable, per enemy — and the animated ones
**mutate their material per instance**, so they can't be naively shared. No finite list → nothing
to enumerate and warm.

## The law (how shipping games solve it)

**PSO precaching**, two non-negotiable halves ([Unreal writeup], [UE5 PSO playbook]):

1. **Bound + enumerate the set** — ubershaders / **shared material templates** (per-instance variation
   rides on **uniforms / instance-attributes**, never a new material instance) + **bounded vertex
   layouts**.
2. **Precompile the whole set at a loading screen** — often by RECORDING every PSO a playthrough
   uses, shipping the manifest, warming it at load.

**The WebGPU constraint:** there is **no app-level pipeline cache API** (`GPUPipelineCache` deferred
post-MVP). Unlike Vulkan/D3D/Unity we **cannot serialize + ship compiled pipelines**. So our "PSO
cache" is a **recipe to recompile at load**, not a binary; the browser's `DawnWebGPUCache` amortizes
repeat sessions.

## Principle: template the RECURRING set, not everything

Templating *literally everything* is the wrong target. Disadvantages:
- **Ubershader fattening** — collapsing variants into uniform-branches grows the shader (registers,
  per-pixel cost); on mobile that bites. → keep a *small set of templates per render-state family*.
- **Can't template across render STATE** — blending/depth/transparency *are* the pipeline; additive
  glow and opaque stone physically cannot share one. Templating reorganizes into N families, not 1.
- **Per-instance uniforms cost** a bind group per instance unless instanced.
- **Diminishing returns on rare materials** — `DawnWebGPUCache` already makes a one-off compile
  once-per-session-then-cached. Templating a unique set-piece buys "no first-run hitch on that one
  thing" for real refactor cost.

→ **Template the recurring (every-floor / repeated) materials; let rare one-offs compile-once-cache.**

## The audit (real numbers, this codebase)

Material-creation sites by area:

| Area | creations | status / plan |
|---|---|---|
| **interactables** | **38 / 19 files** | **the dominant unbounded source** — see split below |
| effects | 21 / 14 | mostly handled — clone-of-template (shares pipeline) + self-registered warmups; verify |
| style | 11 / 4 | `StyleMaterials` shared palette — bounded, boot-warmed ✓ |
| scene | 8 / 5 | audit (lamp/fog/post — likely few, shared) |
| combat | 6 / 3 | audit (mostly effects-adjacent) |
| ecs (`build-model`) | 5 / 1 | the dynamic-material factory (`createMaterialFromDef`) — enemy/prop path |
| content / mobs / player / level | ~10 | decor done (`stdMat`); enemy halos are per-instance sprites (warmed via primitive hook) |

**Interactables split** (the key finding — most are easy):
- **STATIC (6, route through a shared cache like decor — low-risk):** `card-drop`, `fountain`,
  `pickup`, `reliquary`, `spike-trap`, `tome-pillar`.
- **ANIMATED (6, need template + per-instance uniform):** `door`, `tithe-basin`, `challenge-offering`,
  `boss-mist`, `stairs`, `blood-altar`. These mutate `opacity`/`color`/`emissive` per instance (the
  stair beacon, blood-altar pulse, tithe glow).

**Dynamic families:** enemies build per-instance materials (`buildSkinnedCreature` / `createMaterialFromDef`;
`enemy-presentation` animates per-instance halos/glow) — but they barely appear in the in-play logs,
so per-type sharing + the roster warm largely cover them (verify the body material is shared per type).
Effects use the clone-of-template pattern (clones share the pinned pipeline) + self-warm.

## The architecture (A–E)

**A. Material templates (keystone — bounds the set).** Route all *recurring* material creation through
a template registry. Static families → share instances (the `stdMat` mechanism, generalized to
`MeshBasic`). Animated families → a shared template + a per-instance **uniform/attribute** for the
animated property (the beacon opacity becomes `material.opacity` on a *cloned-but-pipeline-shared*
template, or an instance uniform), never a structurally-new material. Outcome: a finite template set.

**B. Bounded vertex layouts.** A fixed, audited set — static / skinned / instanced / shadow-caster —
so `material × layout` stays a small product.

**C. Enumerate + record + warm at boot.** Templates × layouts × render-states = the closed set. Turn
the compile-guard into a **recorder** (a headless sim playthrough captures every pipeline actually
used → a manifest), then warm that manifest at boot through the real PSX pipeline. Covers dynamic
materials too, because it records what the game *actually* draws.

**D. The level-load screen (descent).** A real load screen covers (1) floor build, (2) a residency
render of the spawn view to upload this floor's buffers — **no compilation** (pipelines pre-warmed),
so it's quick + deterministic. Gameplay gated until it recedes (the descent gate / fade is the seam).

**E. Self-validating invariant.** `window.__compileStats().compileHitches` must be **0** in gameplay.
The watch flags any in-play compile → something escaped the template system → add a template. This
keeps the budget closed as content grows (dev/CI gate).

## Status & sequencing

- [x] **v1 — decor proof:** `stdMat` registry (Pillar 1) + `primeFloorPalette` boot-prime + instanced/
      plain warm (Pillars 1b/2/3). Decor compiles at boot; the climbing-ID explosion is closed.
- [x] Removed the wrong-format per-floor `compileAsync` (wasted ~30 compiles/floor).
- [ ] **A1 — static interactables** (the biggest *easy* win): generalize the cache to `MeshBasic`
      (`basicMat`) and route the 6 static interactable files through it. Boot-prime + warm them.
- [ ] **A2 — animated interactables**: shared template + per-instance uniform for the 6 animated files.
- [ ] **B — vertex-layout audit** (incl. the shadow-caster layout → closes the `ShadowMaterial` tail).
- [ ] **C — the recorder + boot-warm the recorded manifest** (captures dynamic/enemy/effect too).
- [x] **D — descent load screen warms the whole floor (the centerpiece).** `warmSceneCompile`
      (render-webgpu.ts): binds the PSX scene-pass target, then `renderer.compileAsync(scene, camera)`.
      Two research findings made this work: (a) the render cache key includes the target FORMAT
      (Pipelines.js `_getRenderCacheKey` → `backend.getRenderCacheKey`), and compileAsync warms at
      the BOUND target (three.js #31220 / Mugen87) — so binding the PSX target is what makes the
      warm match the live render; (b) compileAsync traverses EVERY material in the scene, not the
      frustum, so hidden rooms warm too. Gated as the descent prewarm behind revealWhenReady's cover.
      VERIFIED: descend → 51 pipelines compile behind the cover, then **grewSinceReveal: 0** — the
      revealed floor renders with zero new compiles (kills both the descent hitch and the move-hitch).
      three 0.184 makes compileAsync non-blocking, so the load screen stays responsive.
- [ ] **E — wire `compileHitches===0` as a dev/CI invariant.**

## The other half of the same structure: uploads, every frame (measured 2026-08-10)

This document has always been about COMPILE cost — one pipeline per material
instance, paid once, at a bad moment. Seven phone recordings say the same
structure also has a **per-frame** cost, and that one is the reason the game
runs at 47 fps rather than the reason it hitches.

`delve rec` pools recordings and regresses frame cost against draws, triangles
and the `ub` column (`device.queue.writeBuffer`/`writeTexture` CALLS per frame —
see debug/upload-counter.ts; it is a call count, not a buffer count):

| predictor | slope | r |
| --- | --- | --- |
| draws | 20–49 µs/draw | +0.27 … +0.58 |
| triangles | 44–143 ns/tri | +0.22 … +0.54 |
| **upload calls** | **16.1 / 16.6 µs per call** | **+0.92 / +0.97** |

Two independent sets of captures, different scenes, essentially the same slope.
The upload census (debug/upload-census.ts, rides along in every recording)
then attributed the calls, and it is not spread around:

```
356–720 calls/frame   Bindings.updateBinding → backend.updateBinding → writeBuffer
                      against 267–534 DISTINCT buffers, ~200 bytes each
  5–9   calls/frame   updateAttribute
  1–2   calls/frame   updateTexture
```

**98–99% of every upload the game makes is one call site.** ~500 separate
uniform buffers, each written once per frame, ~200 bytes at a time. At 16.6 µs
a call that is ~8ms, which is the whole of `render·scene`.

What this means for the rules above:

- **Material-instance count is not only a compile budget, it is a per-frame
  budget.** Every independently-bound render object carries a uniform buffer
  that is rewritten each frame, and on mobile each `writeBuffer` crosses a
  process boundary — 16 µs for a 200-byte write is IPC overhead, not bandwidth
  (103–210 KB/frame total is nothing).
- **The buffer count runs ~1.5× the mesh count** (498 buffers / 354 meshes;
  534 / 343), so it tracks bound render objects *and* their materials, not
  materials alone. Reducing either reduces the frame.
- **Resolution and geometry are already free.** The render target is 422×196 —
  82k pixels — and the scene runs 264–321 triangles per draw. Anything that
  reaches for `renderScale` or polycount here is optimising the one thing that
  was never the cost.

### Is this three.js's fault or ours? (traced 2026-08-10, three 0.185.1)

Neither, quite. The mechanism is in the source, not in our usage:

- `NodeManager.updateGroup` (:120): `if ( groupNode.updateType === NodeUpdateType.OBJECT ) return true;`
  — an object-scoped uniform group is *always* considered for update, per render
  object, per frame.
- `UniformsGroup.updateMatrix4` (:499) DOES dirty-check via `arraysEqual`, so an
  unchanged value uploads nothing. three is not being careless here.
- But the object group carries the model-VIEW matrix, and `ModelNode` (:155)
  computes it as `camera.matrixWorldInverse × object.matrixWorld`. It is
  camera-relative, so it changes for every object the moment the camera moves —
  a static wall included. The dirty-check cannot save you in a first-person game.
- Changed → `Bindings._update` (:359) → `backend.updateBinding` → one
  `queue.writeBuffer`.

So the per-frame upload count is essentially THE NUMBER OF SEPARATELY-BOUND
RENDER OBJECTS DRAWN. On desktop that is free (500 × ~1 µs = 0.5ms, invisible).
On mobile each `writeBuffer` crosses into the GPU process and costs ~16 µs
measured, so the same design costs 8ms. Nothing is misconfigured; we are simply
on the expensive side of a tradeoff three makes for us, and the engine's own
remedy is the one this codebase already applies in places — InstancedMesh /
BatchedMesh collapse N objects into ONE render object with one object buffer.
The world shell is already 18 BatchedMeshes and creatures are instanced; the
~350 loose meshes that remain are the bill.

**An attempted falsification that did NOT settle it, recorded so nobody repeats
it.** If model-view is the driver, a stationary camera should upload far less.
Splitting 5370 pooled frames by whether yaw/pitch changed gives 548 uploads/frame
still vs 570 moving — a 4% difference, nothing like the prediction. That looks
like a refutation and is not one: the recording's `cam` field stores only YAW and
PITCH, not position, so "still" there includes walking in a straight line, which
moves the view matrix exactly as much as turning does. The test cannot
discriminate. To actually settle it, stand completely motionless (no walk, no
turn) for a few seconds during a recording and compare — or add position to the
`cam` column.

The GPU side is separate and still unexplained: across 2756 pooled frames it
correlates with NOTHING (draws −0.05, triangles −0.38, uploads −0.05), sitting
flat at ~7.4ms. That is a fixed per-frame cost and only the pass structure can
move it. Not yet investigated.

### The ~350 loose meshes were a GATE, not a limit (fixed 2026-08-10)

The paragraph above says "the ~350 loose meshes that remain are the bill," which
read as a ceiling — the leftovers too fragmented to batch. They were not. The
batcher's own DEV line, once anyone captured it, said:

```
[static-batch] 280/282 static meshes → 19 batches
```

It **saw 282** meshes on a floor holding ~570 and batched **99% of what reached
it**. Everything else was rejected before the batcher looked at it, by an
implicit allowlist in `batchStaticWorld`: a root child had to be a destructible,
or tagged `dbgKind:'prop'`, or carry a `"<kind> · <rect>"` dbgSource. Anything
else hit `if (!rectId) continue`. On a depth-3 floor that was **179 of 240 root
children holding 351 meshes** — an unnamed 88-box masonry construct, an unnamed
40-piece arch, sixteen identical 7-part fixtures, candelabra bodies. The most
static objects in the dungeon, each paying a render object every frame.

Resolving those by **bounds** (`containedRectId`) took the floor from
**282 → 362 candidates, 280 → 360 batched, in the same 22 batches**. The rule is
pinned in `tests/static-batch-rect.test.ts`: **a rect id is not a label, it is
what the room culler toggles.** File stone under the wrong room and it blinks out
while the player looks straight at it (the doorframe bug). So overhang into the
VOID is accepted — masonry leans out of its room by design, and rejecting it
threw away the biggest groups on the floor — while overlap into ANOTHER rect is
refused.

#### The part that was wrong, and how the phone caught it

The first version went further: a group that genuinely spans two rects was
batched under a `NO_RECT` sentinel, entering no rect index, on the reasoning that
"an instance nothing ever toggles has bit-for-bit the visibility it already had,
since the room culler skips unlabelled children too." That took the floor to
517 batched and looked like the bigger win — ~237 render objects × ~16.6 µs ≈
3.9 ms/frame on paper.

**A loose mesh is still FRUSTUM culled.** A batch instance is not: this codebase
turns `perObjectFrustumCulled` off deliberately (r185's per-instance frustum path
wrongly culls live instances — altar pedestals vanished). So the sentinel did not
preserve those groups' visibility, it deleted their frustum culling, and the
batch began submitting the half of the floor behind the player every frame.

Phone recordings, one clean before and one clean after (two others had unrelated
CPU storms and were discarded):

| | before | after |
| --- | --- | --- |
| uniform buffers | 567 | 369 (−35%) |
| draws | 196 | **307 (+57%)** |
| CPU | 10.5 ms | **13.6 ms** |
| frame time | 16.6 ms | 16.8 ms |

The metric the change targeted moved exactly as predicted. Draws went the wrong
way, which is the tell: batching converts render objects into cheap
`drawIndexed` calls roughly one-for-one, so the draw count should have stayed
flat. It rose because geometry that used to be frustum-culled no longer was.

**Room culling and frustum culling are not interchangeable, and an object that
can have neither is better off loose, where it still gets one.**

The general lesson, for the next optimisation: **a headless object count is not a
frame time.** The µs-per-object constant was measured on a build where every
object still had frustum culling, and it silently stopped applying to objects
that lost it.

#### …and then the premise turned out to be false

The whole trade above rests on batch instances not being frustum culled, which
rested on a 2026-07-05 comment: `perObjectFrustumCulled` was off because r185's
per-instance frustum path supposedly culled live instances (altar pedestals, the
bonfire sword). Josh doubted it — his recollection was that frustum culling
worked. Both readings were compatible, because they are different code paths:
ordinary meshes use `Object3D.frustumCulled` against the renderer's frustum,
which was never in question, while BatchedMesh builds its own frustum inside
`onBeforeRender`.

Reading three 0.185.1, that path now looks correct — the WebGPU renderer sets
`camera._reversedDepth` (`three.webgpu.js _updateCamera`) and BatchedMesh passes
`camera.reversedDepth` into `setFromProjectionMatrix`. It could not be settled
locally (WebGPU-only, and the headless harness has none), so it shipped as
`?batchfrustum=1` and was **verified on device: nothing blinks out.** Either the
original report predated a fix or it was misattributed.

That inverts the conclusion. With per-instance culling on, a batched instance is
culled exactly as the loose mesh was and costs no render object on top — so
batching is free rather than a trade, and the `NO_RECT` sentinel is sound after
all. Both are now the default, gated on the flag: `?batchfrustum=0` disables
per-instance culling AND the sentinel together, because the second is only safe
while the first is on.

Result on a depth-3 floor, against the 280/282 → 19 batches this section opened
with:

```
[static-batch] 520/520 static meshes → 10 batches
```

**Every static mesh on the floor, in ten render objects, all frustum culled.**
The batch-count halving came from the surface-scalar bake (roughness/metalness
moved to an `aSurface` vertex attribute, so `bake|f|1.00|0.00` and
`bake|f|0.95|0.00` stopped being separate batches); the coverage came from the
bounds resolution plus the sentinel. Verified against `?batchworld=0` on
procgen-3: identical geometry, identical shading.

The moral is not "trust the phone over the code" — it is that **a comment
asserting a bug is a claim with an expiry date.** This one had been true once,
was carried forward as fact, and cost the project its per-instance culling for a
month. When a workaround's justification cannot be re-tested cheaply, put it
behind a flag rather than a constant.

[three.js #32735]: https://github.com/mrdoob/three.js/issues/32735
[Unreal writeup]: https://www.unrealengine.com/tech-blog/game-engines-and-shader-stuttering-unreal-engines-solution-to-the-problem
[UE5 PSO playbook]: https://www.strayspark.studio/blog/ue5-shader-stutter-pso-precaching-playbook
