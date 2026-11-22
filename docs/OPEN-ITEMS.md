# Open items

One list of everything known to be open: bugs, decisions waiting on Josh,
debt, release gaps. Started 2026-11-21 from a four-way inventory of main
(`fd3b358f`) plus the Phase 0 work that followed. Sessions: add to it when you
find something you are not fixing now, strike it when you close it.

**Tags**
- `[josh]` — needs Josh: a decision, an account, a phone, a device.
- `[unverified]` — believed from reading code or docs, not run or measured.
  Check before building on it.
- `[uncertain]` — evidence conflicts or is thin; the claim may be wrong.
- `[parked]` — known and deliberately deferred.

The overhaul runs in phases: **0** stop the bleeding (done) → **1** make the
engine checkable → **2** three.js r185 → r187 → **3** debt → **4** platform
foundations → back to building the game.

---

## Bugs live on main

- **Parry has no input on any device.** `545776ee` took parry off the tap,
  `47ea1017` hid the parry button believing the tap still parried
  (`src/main.ts` ~1146-1165, `src/controls/tap-resolve.ts:52`). No desktop key
  either. Deflect, bullet-time and riposte unreachable since 2026-08-13.
  `[josh]` `[parked]` — Josh: "parry later". Needs a design call: own button
  (where does the rite go), tap-on-flash (why it was removed), or a gesture.
- **Hard renderer failure strands the player on "descending".** `__delveBooted`
  is set (`main.ts:200`) before the renderer starts (`main.ts:259`), so the
  boot-guard self-heal never fires; safe mode needs two failed boots in 60 s.
  `[unverified]` — read from code, not reproduced.
- **Developer Mode and `?lux=1` reachable on the live site**
  (`settings-menu.ts:579`, `debug/lux-button.ts:13`). Kept on purpose for phone
  debugging. `[josh]` — before a store release these go behind a release-build
  flag; decide when.
- **Desktop has no key for rite or weapon swap**; their DOM buttons cannot be
  clicked while the mouse is pointer-locked. `[unverified]`
- **Leaderboard is trivially fakeable**: `reportDeath` accepts any depth
  (`server/spacetimedb/src/index.ts:130-153`). Every client subscribes to the
  whole `death` and `identity` tables (`src/net/delve-net.ts:119`).
- **Account merge does not move pending-run rows** (`server/.../index.ts:218-229`).

## Needs Josh (accounts, devices, decisions)

- **Clerk is on its DEV instance in production.** Clerk = the login provider
  behind CLAIM YOUR NAME (Google/Discord/Twitch sign-in to keep your server
  identity). Create a production instance, set repo var
  `CLERK_PUBLISHABLE_KEY` to its `pk_live_…` key. `npm run release-check` warns
  until then. `[josh]`
- **Phone perf baseline.** Newest phone recordings are from June — before the
  rework, the material collapse and the strip. Every optimisation in Phases 1-2
  needs a current one. `[josh]` — on the phone, open the live site with
  `?record=1` appended, play a floor for a minute or two (one fight), stop the
  recording from the toolbar (it downloads a `.json`), and send the file over.
  Ideally twice: once as-is, once with `?record=1&webgpu=0` for the WebGL2
  path. Review lives at `/brainstorm/perf-review.html` (docs/profiling.md).
  `[unverified]` that a phone stop downloads cleanly today — the doc says so.
- **The ending.** Act III boss is INTERIM `boiling-king` (`acts.ts:88`); no won
  state; 2 distinct bosses for 3 acts. Design conversation, not engineering.
  `[josh]` `[parked]` until the overhaul is done.
- **Asset licences.** Tarot/relic art via fal `flux/dev`; bone-hand `.glb` via
  Tripo; `lantern.glb` provenance unrecorded; font licence files not committed;
  repo has no LICENSE. Read the terms for your plan tier before selling.
  `[josh]` `[uncertain]` — commercial terms depend on account/plan, not checked.
- **Privacy/compliance before strangers**: privacy policy, consent before a
  name is published, account + data deletion (Apple requires in-app deletion),
  name filtering. `[josh]` `[parked]` until a public release is near.

## Phase 1 — make the engine checkable (in progress)

- **WebGL2 path: now booted and guarded.** `npm run backend-boot` boots a real
  floor on each backend in headless Chrome and fails on page/GPU errors, a
  stalled frame counter, a black screen, or a renderer patch that didn't
  install. Both pass (headless WebGL2 reveal ~33 s, WebGPU ~17 s, software
  rendering — not a speed figure). Runs in CI as a parallel job that does NOT
  block deploys yet. `[parked]` — promote it into deploy's `needs` once it has
  run green for a while without flaking.
- **WebGL2 on real hardware is still unmeasured for speed** (boot time, fps) —
  see the foreground-window item below. Visually it matches WebGPU on a real
  GPU (2026-11-21, Windows Chrome screenshots of the same room).
- **Headless WebGPU screenshots are ~3× brighter than real hardware.** In
  headless Chrome, WebGL2 frames measured mean luma ~25-28 and WebGPU ~66-79 for
  the same room. On a real GPU (Windows Chrome) the two backends look the
  same, and both match the DARK headless WebGL2 frame. So the bright one is the
  headless WebGPU capture path (`paintHeadlessFrame` → `__captureFrame`), not
  the game. Every `snap` taken on WebGPU, art review included, has likely been
  brighter than the phone. Runtime A/B ruled out the grade and shadows.
  CORRECTION: the lighting-loop, dark-adaptation and surface-detail "rule-outs"
  were void — `backend-boot --url-extra` cut values at their own `=`, so those
  runs had their flag unset (fixed 2026-11-21). `[uncertain]` cause — a double
  sRGB encode in the capture is the first suspect, untested.
- **Measuring on the dev box's Windows Chrome needs a foreground window.**
  Driven through chrome-devtools it ran at exactly 1 frame/s on BOTH backends
  (window throttled though `visibilityState` said visible), so boot and fps
  numbers from it are void. It is still fine for screenshots. Real WebGL2 boot
  time and fps on hardware remain unmeasured. `[josh]` — needs a phone or a
  foreground desktop run.
- **`tests/vault-step.test.ts` flaked once** in a full parallel run
  (2026-11-21: 1/154 failed; passed alone and on the next full run). The test
  has no timers, so suspect unseeded randomness in what it builds. Output was
  not captured. `[uncertain]` — next time it fails, keep the log. Now that CI
  runs tests, a flake here can block a deploy.
- ~~`?raw=1` stops frame presentation~~ — void: measured with the broken
  `--url-extra` parser, so the flag was never set. Unknown; recheck if needed.
- **WebGPU inside wrappers is unverified**: Electron on Linux/Deck (AMD is
  behind a Chrome flag), Android WebView `[uncertain]` (no source confirms it),
  iOS 26 WKWebView (developers report yes, Apple doesn't document it)
  `[uncertain]`.

## Phase 2 — three.js (r185.1 → r187: done)

What r187 changed for us, measured 2026-11-21 (headless unless noted; times
are software rendering, only compare like-for-like):
- **Our clustered-lighting subclass is gone; the stock addon does its job.**
  r187 made the cluster grid uniforms (no literals in WGSL) and refits it per
  render. 4 render-scale changes mid-play on a real GPU: 0 lighting
  recompiles. (The one compile seen was an unwarmed particle material — see
  below.)
- **`stable-buffer-names` deleted.** r187 names uniform buffers by bind-group
  position; the patch measured as a no-op (perf-horde: 79 pipelines on or
  off, vs 92/171 on r186).
- **Fewer pipelines, faster warm.** WebGPU perf-horde 90 → 79 pipelines,
  reveal ~16.4 → ~15 s; spawn 117 → 96-99. WebGL2 warms 159 → 60-64
  pipelines, reveal ~35 → ~20 s, renders the same room. 0 in-play compiles
  on both. `[unverified]` on a phone.
- Real GPU (Windows Chrome, r187 confirmed via `window.__THREE__`): renders
  correctly, ~59 fps at the 60 cap, 99 pipelines, 0 GPU errors.

How it went, so nobody repeats it:
- r187 first rendered a BLACK world. Bisected three (10 steps) to #34930
  "ClusteredLightsNode: Improve dispose() and code structure", which renamed
  every internal our subclass overrode; our `this.create()` threw in
  `updateBefore`. The patch canaries missed it because they didn't cover the
  addon — they do now.
- Twice on the way, r187 looked fixed when it wasn't: vite's pre-bundle cache
  lives in `<worktree>/.vite` (vite.config.ts `cacheDir`), keyed on the
  lockfile, so swapping `node_modules/three` by hand served the cached r186.
  `backend-boot` now fails when the page's `window.__THREE__` differs from the
  installed three. **After changing three: `rm -rf .vite`.**

Still open:
- `stable-shader-names` and `stale-vertex-buffers` still install on r187 and
  change no count on our test floors; they guard other cases. Re-measure on
  the next bump. Render-bundle pass order still needs its patch.
- r187's clustered node has a WebGL2 path (#34978) — could retire
  `DelveTiledLighting` on WebGL2. Untested. `[parked]`
- **Particle (`points`) material not covered by the warm**: one in-play
  compile, verdict NOT-WARMED (`auto:points|t,b2,nd`, additive point-list).
  Small hitch the first time those particles appear. Likely predates r187.
  `[unverified]` which effect.
- r187 gains not yet measured where they'd matter (phone): parallel
  `compileAsync` (#34816), shadow re-render only on `needsUpdate` (#34794),
  fewer matrix updates (#35203). Needs the phone recording.

### r185 → r187 review: what changed for us, and what we could use (2026-11-21)

976 three commits; 503 touch the renderer/nodes/lights. Measured r186.1 as
shipped (3bc4c699) vs r187 now, `backend-boot --cpu --metrics --frozen
--url-extra=seed=4242`, 3 runs each, headless WebGPU (spawn / perf-horde):
- Per-frame CPU: 2.36 → 2.33 ms / 1.76 → 1.71 ms. No real change.
- Pipelines −21% / −14%; reveal −15% / −10%; frames over 32 ms right after
  reveal −67% / −54%; allocation per frame −13% / −8%. r187 makes LOADING and
  the first seconds smoother, not the steady frame cheaper.

Candidates, none built:
- **Shadow maps still allocate a colour target nobody reads.** r187 added
  depth-only render targets (#34782) but `ShadowNode.setupRenderTarget` still
  calls `createRenderTarget(w, h)` (count 1). The lamp's 512² shadow writes an
  unused colour buffer every frame. Fix = a shadow-node override (another
  private patch) or an upstream PR. Bandwidth win on phones; size
  `[unverified]` until a phone recording.
- **Lamp shadow on demand.** r186/r187 made `shadow.needsUpdate` reliable
  (#34794, #35093). Re-render the lamp shadow only when the lamp or a caster in
  its cone moved. Saves nothing mid-fight, something while exploring.
  `[unverified]` — needs the phone's `render·shadow` share first.
- **Clustered lighting on WebGL2** (#34978) works: same room lit, boots
  ~1-2 s faster, but presented 52-57 frames vs 75-90 for our tiled loop in 5 s
  on software GL. Would delete `tiled-lighting.ts` (300 lines). Only with a
  real WebGL2 device A/B (Deck, older phone). Recipe: a DEV switch in
  create-renderer that skips the WebGL2 → tiled override, both places.
- **Baked static light** (#34991 LightMapper, #34909 faster probe bakes): bake
  static torch light per floor into probes or lightmaps, keep only the lamp,
  flicker and specials dynamic. Lighting slot count is our known GPU wall.
  Design-level change (torch flicker is part of the look). `[uncertain]`.
- Not for us now: the new meshlet / visibility-buffer drawing pipelines
  (#35191, experimental); `mipmapsAutoUpdate` / texture update ranges (no
  texture of ours updates per frame); BatchedMesh draw merging (#35259) is
  automatic, but the sampler's `draws` reads 0 (see below), so unconfirmed.
- Small bug: frame-timing's `draws` is 0 in every `--cpu` sample, so draw
  counts can't be compared. `perFrameDraws` vs r187's info fields `[unverified]`.

## Phase 3 — debt

- ~~`createEnemy` ~3,365 lines in one function~~ (done, below); `buildLevel`
  ~2,255 + `buildRoomShell` 755 (`level/builder.ts`) — CONSOLIDATION-PLAN 2b,
  still open.
  - **Net under the enemy split (2026-11-22):** `tests/enemy-golden.test.ts`
    drives all 24 enemy specs through one scripted fight (fog-gate wake,
    summons, parries, stagger, DoT, knockback, fear, a killing blow) and
    compares 150 samples each to `tests/golden/enemy-trace.txt`. Same hash on
    Node 20 (CI) and 23. Mutation-checked: engage grace, death and crumble
    timings, knockback, burrow depth are all caught. NOT covered: audio-only
    constants (vocal stir range), and anything the trace never reaches (a
    spec that never dies — marrow-sovereign's later phases, the wraith).
  - **`createEnemy` split: DONE (2026-11-22).** 3,716 → 1,023 lines; what
    remains is construction (the parts, the nine state groups with their
    docs) and the public `Enemy` API. The behaviour lives in subsystems over
    one `self: EnemyCtx` — `mobs/enemy-ctx.ts` maps them and states the rule
    for new state. Owned-state subsystems: `enemy-death`, `boss-phases`,
    `enemy-burrow`. Functions over `self`: `enemy-brain` (update; the 11
    states are a `Record<EnemyState, handler>`), `enemy-abilities`,
    `enemy-damage`, `enemy-locomotion`, `enemy-perception`, `enemy-overlays`.
    Every step was a pure move checked against the golden.
  - **Not done, on purpose:** the plan's boss-vs-mob controller. `useIntent`
    is six one-line gates (five in `tickChasing`), each commented; a strategy
    object would make each an indirect call and add a boss variant to keep in
    step, for no gain in clarity. Revisit if bosses grow their own decision
    layer.
  - Largest pieces now: `tickChasing` (~130 lines), `runAction` (~240, one
    case per action kind, already a dispatch). Fine as they are.
  - Cost measured: the golden harness (enemy CPU only, 24 specs, 15 s each)
    takes 468-472 ms before the split, 481-492 ms after, alternating runs:
    ~3-4%, consistent with state read through `self.` instead of closure
    slots. Hundredths of a millisecond per frame in play. Desktop CPU, not
    a phone. `[unverified]` on a phone.
  - Found doing it: the maggot's idle squirm read `performance.now()` and
    turned its body, so its sight cone depended on the wall clock. Now
    `gameNow()` (identical live, stepped in replay).
- `main.ts` 2,192 lines, 181 imports → an explicit `boot()`.
- Vestigial attributes (Might/Finesse/Lore/Grit always 0, still displayed and
  read by combat: `character.ts`, `attribute-defs.ts`, `modifiers.ts:289`,
  `ecs/buffs.ts`).
- Legacy weapon-pose fallback ~1,050 lines (`player/weapon-animations.ts`
  269-1323).
- Level modules imported only by tests: `occupancy-grid`, `loot-director`,
  `room-decor`, `room-signature`, `threshold`, `facing`; unimported:
  `palette-design`, `floor-manifest`, `anim/apply.ts`. **Sort parked dressing
  (comes back via `level/dressing.ts`) from truly dead before deleting.**
  `[uncertain]` — which are parked is Josh's strip, not yet cross-checked.
- ~~`debug/scenarios.ts` ships in the prod main chunk~~ DONE 2026-11-22. Most of
  it was already tree-shaken; what shipped was the module-level factory calls
  (`polyRoomScenario(...)` building the table) and what they reach — a
  `godMode: true` debug level among them. Now a DEV-only dynamic import in
  main.ts; the prod bundle has none of it (main chunk 387,188 → 384,607 B).
- `menu-shell` adopted by 7 of 12 screens; three HUD styles kept as parallel
  widgets.
- Docs drift: CLAUDE.md (9 equipment slots vs 4 in code; "three art styles";
  "no 3D model files" vs three `.glb`; light-pool description),
  WEBGPU-MIGRATION.md (still describes the spike), encounter registry header.
- 26 of 92 scripts referenced nowhere; 10 overlapping `perf-*` scripts.
- Leftover branches with unique commits: `wip/ai-voice-layer`,
  `claude/forcewebgl-gate`, `worktree-viewmodel-v3` (2 mob-AI commits),
  `claude/alpha-name-entry`, `claude/create-brainstorm-repo-KjJds`;
  `brainstorm-harness-v1` has uncommitted work from May. `[josh]` keep or drop.

- **`npm run replay-node` was broken from the r187 upgrade until 2026-11-22.**
  r187's `Texture` reads `image.depth > 1`; the DOM stub's proxy canvas could
  not be coerced to a number. Fixed in `headless/dom-stub.ts`. Nothing ran it,
  so nothing noticed: it is not in CI. Worth adding to CI.
- Under tsx, game code loads two copies of three ("Multiple instances of
  Three.js", one via `require("three")`). Harmless for the traces so far;
  source of the `require` not found. `[unverified]`

## Baked torchlight (`?bake=1`, built 2026-11-22, opt-in)

Static environment lights (torches, sconces, braziers, candle stacks, room
fills) lit through a baked top-down wall-VISIBILITY texture instead of live
PointLight slots. `scene/light-bake.ts` (pure bake, `tests/light-bake.test.ts`),
`scene/baked-light.ts` (textures, uniform arrays, the shader hook),
`scene/light-pool.ts` (`tickBakedSource`: the same selection, gate fade,
flicker, mood tint, strength setting and flame wobble, written to the bake's
arrays). The shader runs three's own `directPointLight` per channel through
the material's `direct()`, so falloff, banding and specular match a live light.

Verified (headless, 2026-11-22):
- Real floors, depths 1-12 (`npx tsx scripts/light-bake-stats.ts`): 19-31
  static lights; 4 channels bake 85-95%, the rest stay live; bake 25-50 ms on
  desktop; textures ~350 KB each.
- Both backends boot with it (backend-boot `--url-extra=bake=1`): no shader or
  validation errors, no compile gaps. The `archway` scenario renders near-
  identical with and without it (luma 91.9 vs 91.7 WebGPU, 32.4 vs 34.2 WebGL2);
  `__lightBakeScale(0)` darkens it, so the baked light is what is on screen.
- Live point lights bound on a spawn view: 4 → 1 (the lamp).

**Measured on Josh's phone (WebGPU, 2026-11-22): it is NOT cheaper.** Matched
pair, same view (22,141 tris both): GPU 8.06 ms without → 8.72 ms with (+8%,
p95 8.72 → 9.57); CPU 10.3 → 10.5 ms; late frames 8% → 12%; uploads 48 → 111 a
frame (the per-light uniform arrays, since cut from 2×96 to 1×64 vec4). The
director already lights only the few torches past an open threshold, so the
clustered path was cheap; the bake adds 2 texture reads + up to 4 channel
checks (including lights currently off) to every lit fragment. An earlier
"−11% GPU" compared two different views — retracted. Keep it OFF by default.
What it still offers is a LOOK: walls stop torchlight. Only worth more work
if that look is wanted; then skip channels whose light is off first.

Known limits:
- **How it looks on a phone.** Walls now stop torch light (a live point light
  passed through them, dimmed to 30% by the director), so rooms behind a wall
  from a torch get darker. `[josh]` judge.
- The torch-RANGE setting is read at bake time; changing it mid-floor keeps the
  old reach until the next floor.
- Occlusion is 2D: a floor slab between levels doesn't stop light.
- Lights registered after the bake (a boss bonfire, revealed chests) are live.
- `CHANNELS = 4`; 8 would bake every light measured, at 2 more texture samples.

## Phase 4 — platform foundations (before any store)

- No gamepad; `isDesktopLike()` false on any touch device, so a Deck or touch
  laptop gets the phone HUD and no mouse-look. `[unverified]` on real hardware.
- Saves: local only, no export/import, no cloud meta-save.
- Settings for stores: shake/haptics/flash toggles, invert-Y, FOV, SFX volume,
  text size, strings table for localisation.
- Boot payload ~880 KB gzip JS; service worker precaches 9 MB including Clerk.
- `/brainstorm/` base path hard-coded (`vite.config.ts:38`, manifest) and the
  service worker won't run under `file://` — wrappers need a custom protocol or
  base.
- Local `public/art/` (226 MB, gitignored) lands in any local `dist`: a trap
  for packaging a wrapper from a dev machine.

## Game (after the overhaul)

- Charter's Deck unbuilt: death mints a card, floor cards, reversals as marks,
  attention rule, quiet floor per act (`GAMEPLAY-CHARTER.md`).
- Mob AI V2 stopped at Stage 1.
- Async multiplayer partial: death feed + network corpses (random placement,
  not death position) + leaderboard live; Souls messages and phantoms not
  started.
- Deck design vs built cards disagree (majors few and heavy vs 11 majors /
  7 minors; The Glutton a minor in `cards.ts:93`).

---

## Closed

- 2026-11-21 Phase 2: three r185.1 → r186.1 → r187 (+ @types/three 0.187).
  Clustered-lighting subclass and stable-buffer-names deleted (upstream
  fixes). 154/154 test files; canaries 15/15; backend-boot both backends.

- 2026-11-21 Phase 1 (part): `tests/three-patch-canaries.test.ts` fails when a
  three upgrade removes any internal the five renderer patches or
  `tiled-lighting.ts` reach into (14 checks); `backend-boot` additionally
  requires each patch's install line on a live page. WebGL2 fallback booted and
  guarded (above).

- 2026-11-21 Phase 0 (`d3d6353b`): debug URL flags DEV-gated; no source maps
  without a Sentry upload; `release-check` + affected tests in CI; older build
  never overwrites a newer meta save; persist KEYS fixed and CLEAR THE SLATE
  wipes `delve-` keys; SAVE PROGRESS → CLAIM YOUR NAME. 33 worktrees and 40
  merged remote branches removed.
