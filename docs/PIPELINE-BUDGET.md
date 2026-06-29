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
- [ ] **D — formalize the descent load screen** (residency + gate).
- [ ] **E — wire `compileHitches===0` as a dev/CI invariant.**

[three.js #32735]: https://github.com/mrdoob/three.js/issues/32735
[Unreal writeup]: https://www.unrealengine.com/tech-blog/game-engines-and-shader-stuttering-unreal-engines-solution-to-the-problem
[UE5 PSO playbook]: https://www.strayspark.studio/blog/ue5-shader-stutter-pso-precaching-playbook
