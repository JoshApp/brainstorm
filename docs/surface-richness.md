# Surface richness — breaking up the untextured environment

Charter for making DELVE's flat, primitive, textureless geometry read as a real
old dungeon/temple — brick, cobblestone, weathered stone, moss, overgrowth —
*without* a texture pipeline. This is the groundwork doc; the work itself is
staged below.

## The constraints (what makes this its own problem)

- **No texture maps.** Pillar 6: "code-generated visuals, no texture pipelines.
  Style emerges from lighting, shaders, and palette." So richness lives in
  *geometry, vertex data, and shaders* — not bitmaps.
- **Lighting carries.** It's a torchlit dungeon; the flicker is the main event.
  Surface detail should *interact with the light* (catch it, pool shadow in
  crevices) rather than be a static pattern.
- **Mobile, but CPU-bound.** Profiling shows we're CPU/draw-bound with the GPU
  idling (`wait` ~1ms). So **per-fragment shader detail is nearly free headroom**
  — it spends the resource we're *not* short on. Geometry/draw-count work is the
  expensive axis; shader work is cheap.

## Baseline after cleanup (done)

So we design from a clean slate, the first pass removed the prototype hacks:
- **Random per-vertex jitter → OFF** (`WALL_VERTEX_JITTER = 0`). It read as
  melted/glitchy, not stone. Walls keep only the smooth low-frequency **wave**.
- **Random vertex-color tint → calmed** (`[0.7,1.0]` → `[0.85,1.0]`). The wide
  random range was noisy splotches, worst in dim corridors.
- **Screen-space contact-AO → removed.** Dead end: the contacts we wanted (props
  on a floor) are grazing surfaces, indistinguishable on the low-res depth buffer
  from the slopes that streaked. Grounding moves to the height/baked approach below.

Floors are geometrically flat for both rooms and corridors (`flat: true`); the
"wobbly corridor floor" was the random vertex color, now calmed.

## The toolbox (ranked by payoff for this game)

### 1. Grounding (replaces the dead screen-space AO)
- **Height-based darkening** — darken surfaces toward the floor (low world-Y), in
  the vertex colour or the material. Robust (no depth buffer, no streaks), cheap,
  and reads as the dungeon's grime/damp pooling low. *(Josh's idea — "things on
  the floor get it right, height-based, smarter.")*
- **Baked corner/crevice AO** — at build time, darken vertices where surfaces meet
  (wall↔floor, wall↔wall, around column bases). Free per-frame, gives form.

### 2. Geometry warp "used for profit" (coherent, not random noise)
- **Coherent low-freq displacement** — replace the old random jitter with worn-
  stone undulation (value/simplex noise, gentle). Deliberate unevenness.
- **Beveled edges** (`box.bevel`) on chunky surfaces so hard cube edges catch the
  torchlight instead of reading as flat slabs.

### 3. Coherent vertex colouring
- Grime, weathering, **moss pooling low / in crevices**, subtle hue drift by
  position — intentional, not per-vertex random. Free per-frame.

### 4. Procedural shader detail (the big shading move)
- **Worldspace noise → brightness**: coherent grime/weathering pattern = fake
  stone texture.
- **Worldspace noise → normal perturbation**: fake bumps so the surface catches
  light unevenly. In a torchlit game this is the killer — the flicker plays across
  the fake roughness and the walls come alive, all from lighting.
- Injected via `onBeforeCompile` on the wall/floor `MeshStandardMaterial`.

### 5. "Real and fake texture" — the old-temple look
- **Brick / cobblestone** (Backstein / Kopfsteinpflaster): a procedural pattern
  (shader) or lightly-modeled relief, mortar lines as darker grooves.
- **Overgrowth / moss**: decals or shader masks keyed to height + crevices.
- **Weathering**: stains, cracks (the decorate pass already has crack decals).

## Recommended direction

Layer, don't pick one: **procedural shader detail (4) as the core** (noise →
brightness + fake-bump normals), **height-based + baked corner AO (1)** for
grounding and form, a **gentle coherent geometry warp (2)** for real unevenness,
and **beveled edges** on key surfaces. Brick/cobble/moss (5) on top once the
stone base reads right. It's the same move that solves both the "break up the
walls" and the "ground objects" goals at once.

## Seams (where it plugs in)

- `src/level/geometry-prims.ts · makeJitteredPlane` — wall/floor geometry + the
  per-vertex colour attribute (height-AO, coherent colour, coherent warp land here).
- The wall/floor **material** (in the builder / palette) — `onBeforeCompile` for
  the shader procedural detail + normal perturbation.
- Build-time **AO bake** — a pass over the merged shell geometry darkening
  contact vertices.
- `src/level/decorate.ts` — already does floor cracks / rubble / sigils as
  instanced decals; moss/overgrowth decals would extend it.

## Open questions for the design session

- How far toward *literal* brick/cobble vs. just weathered rough stone?
- Per-room/biome variation (mossy lower floors, dry upper, ritual-red, etc.)?
- Do we want the detail to be deterministic per floor seed (so a floor looks the
  same on revisit) — yes, almost certainly; route through `buildRng`.
