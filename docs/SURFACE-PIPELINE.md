# Surface pipeline — what a material must be to be cheap

**Status:** measured brief, 2026-08-16. Written for whoever is reworking the
texture/surface shaders. Nothing here is aesthetic direction — that lives in
VISUAL-LANGUAGE.md. This is the cost contract the new surfaces have to satisfy,
and the reasoning is entirely from phone measurements, not from theory.

---

## The number this exists to move

On a phone, standing still, a real floor:

```
cpu 10.90ms of a 16.67ms budget      render·scene 7.53ms      draws 168
```

`render·scene` is Three's per-object encode loop, and its leaves account for
6.66ms of that 7.53ms. Per drawn object that is **~40µs of CPU, every frame**:

```
enc·bindings   15.6µs   walk every binding, value-compare every uniform
enc·nodesUpdate 7.2µs
enc·draw        5.0µs
enc·objects     3.5µs
enc·pipelines/geometry/project ~8µs
```

Desktop does the identical work in the same proportions at ~4µs an object — so
this is not a mobile-specific bug, it is the same cost on a CPU roughly ten
times slower. **Frame cost tracks RENDER OBJECT COUNT.** It does not track draw
calls (measured: r ≈ 0.0) and it does not track GPU uploads (44% of uploads were
removed for a 0.2ms gain).

---

## Three's fast path, and the two gates

`Renderer._renderObjectDirect` skips the node updates, the geometry update and
the binding walk — **~25µs of the 40µs** — when `needsRefresh()` returns false.
`NodeMaterialObserver.needsRefresh()` (r185, NodeMaterialObserver.js:717):

```js
if ( this.hasNode || this.hasAnimation || firstInitialization || needsVelocity )
    return true;                                   // GATE 1
...
const isStatic = renderObject.object.static === true;
if ( isStatic || isBundle ) return false;          // GATE 2
```

**Gate 1 — `hasNode`.** `containsNode()` returns true if ANY material property
is a node. One `colorNode` voids the whole thing, and because it short-circuits
first it also disables the render-bundle static path in the same expression.

**Gate 2 — `object.static === true`.** A real first-class three property
(Object3D.js:370, serialised and cloned). We had never set it on anything.

Measured on a floor: 70 of 94 drawn objects are ALREADY node-free — but they are
the flames, the archway eyes, the doors, the viewmodel, i.e. the things that
move, which fail gate 2. The population that genuinely never moves — the merged
world shell — carries surface-detail nodes and fails gate 1. **The two halves are
disjoint. That is the problem this document is about.**

---

## What is free, and what is not

Verified by reading `containsNode` against our own materials:

| Thing | Trips gate 1? | Notes |
| --- | --- | --- |
| `setupLightingModel = () => new BandedPhysicalLightingModel(...)` | **No** | It is a FUNCTION, not a Node. The banded/cel look costs nothing here. |
| `vertexColors: true` + a colour attribute | **No** | Plain-material feature. |
| `map` / `normalMap` / `roughnessMap` textures | **No** | Plain-material features. |
| `colorNode`, `normalNode`, `roughnessNode` | **Yes** | surface-detail.ts, surface-ao.ts |
| `emissiveNode`, `opacityNode` | **Yes** | build-model reveal/flash/dissolve |
| `positionNode` | **Yes** | sprite-batch, outline, embers |

So the signature lighting model survives untouched. What has to move off nodes is
the **surface detail**.

---

## The rule

> **Surface variation lives in vertex attributes and baked textures — never in
> per-material node graphs, never in per-object uniforms.**

This is not a new idea in this codebase. `ecs/build-model.ts` already says it for
creatures: *"variation rides on attributes, not new shaders"* — baking each
part's colour into geometry so thirty creature pipelines became one.

The reason it matters twice over:

- A **per-material** node graph or uniform forces materials apart, and objects
  can only merge if they share a material. So it blocks merging.
- A **per-object** uniform means the object can never be `static`. So it blocks
  the fast path.

And merging is the bigger prize: passing both gates saves ~25µs per object, while
merging N objects into one saves ~40µs × (N−1). **The same discipline buys both.**

---

## Target shape for world surfaces

| Layer | Today | Target |
| --- | --- | --- |
| Detail (grain, seams, wear) | TSL `colorNode` / `normalNode` / `roughnessNode` | baked albedo + normal + roughness, small tiling atlas |
| Per-surface variation (mood tint, wetness, wear) | per-material uniforms → many materials | **vertex attributes** (`vertexColors`) |
| Lighting look | `setupLightingModel` | **unchanged** |
| Geometry | merged per room, materials differ | one material ⇒ 1–3 BatchedMeshes per room |
| Static | never set | `markStatic()` on the merged output |

Room shell: ~20–40 render objects at 40µs each → ~2 that also skip the update
block.

**Bake at boot, not offline.** `style/procedural-textures.ts` already generates
canvas textures at startup; baking the surface maps there, from the same config
the node graph reads today, keeps the design layer's tunability. The look stays
authored as data; only the moment of evaluation moves from per-fragment-per-frame
to once-per-look.

---

## What this document does NOT decide

It prices a material. It does not decide what the look is worth.

Some effects cannot bake by construction. Parallax occlusion mapping is the
clear case: it is view-dependent, so there is no static map that contains it —
"move it to baked textures" is not a lift for POM, it is a proposal to remove
it. The wear, grime and streak layers and the per-stone hue/roughness variation
ARE functions of world position and the baked texture's own channels, and those
bake cleanly. Know which half you are holding before quoting this document at a
shader.

And note the gate's granularity: **gate 1 is all-or-nothing per material.** If a
material keeps one view-dependent node, moving its other layers to baked maps
buys nothing at this gate — the material still fails, still cannot be static,
still forces its objects apart from the plain ones. So the useful question is
usually not "does this effect survive" but "does it survive ON THE SAME MATERIAL
AS EVERYTHING ELSE". A split — plain surfaces node-free and merged, node graphs
only on the surfaces that genuinely earn them — collects most of the win without
giving up the read where it matters.

That trade is a design call. The numbers say what it costs, not whether to pay.

---

## Checklist for the new surface work

A world-surface material qualifies when all of these hold:

- [ ] no `*Node` property assigned to the material (`setupLightingModel` is fine)
- [ ] per-surface variation rides on a vertex attribute or a texture, not a
      per-material uniform — so N surfaces share ONE material instance
- [ ] the shared material comes from `style/material-registry.ts` (`stdMat`),
      not a bare `new THREE.MeshStandardMaterial` (there is a ratchet test)
- [ ] any TSL uniform that survives is `.setGroup(frameGroup)` unless its value
      genuinely differs per object (see CLAUDE.md — six instances of that bug so
      far, one was 44% of a frame's GPU uploads)
- [ ] the merged output is `markStatic()`-ed (scene/animation-gate.ts) and
      nothing mutates it afterwards

---

## How to verify, without guessing

Every claim above came from an instrument, and all of them ship behind
PROFILER TOOLS so they work on the phone (which is the only device where the
cost is visible):

- `enc·*` rows in a recording — the per-object encode split. Read them against
  `render·scene`; they nest inside it.
- `uploadCensus.changes` — which float span of which binding actually moved.
  `NO BYTES CHANGED (uploaded anyway)` is the tell for a wasted upload.
- `matrixCensus` — what actually moved, by owner. `camSerial` — was the camera
  bit-still.
- `scripts/_static-opportunity.ts` — how many drawn objects are node-free, and
  which node property is blocking the rest.

**Do not diagnose this class of problem by reading three's source.** Five
successive theories were argued that way in one session and all five were wrong
(head bob, camera motion, scene size, the clustered pass-size uniform, light
flicker). Take a capture.
