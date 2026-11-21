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

## Phase 2 — three.js (r185.1 → r186.1 done; r187 blocked)

- **r187 renders a BLACK WORLD on WebGPU** (real GPU, Windows Chrome,
  2026-11-21): HUD draws, scene doesn't, even with post-processing off
  (`setSceneOnly`) and bundles off. 11 validation errors during the warm, all
  `[Texture "depth"|"output"] usage (TextureBinding|RenderAttachment) includes
  writable usage and another usage in the same synchronization scope` on a
  70×43 pass tagged `warming=1`; none after reveal. Headless: frame capture
  hangs; `backend-boot` fails, as it should. r186.1 is clean on the same box.
  Suspects from the r187 notes, untested: viewport/pixel-ratio
  (#34333, #34460), depth-only render targets (#34782), animation-loop start
  (#35278, #35279), CubeUV → cube RTs (#34585). `[uncertain]` — next step is to
  bisect three's commits between r186 and r187.
- r187 gains we'd want once it works, from release notes `[unverified]`:
  parallel pipeline compile in `compileAsync` (#34816) for the descent warm;
  shadow maps re-render only when `needsUpdate` (#34794); fewer scene matrix
  updates (#35203); point-light shadow seam fix (#35267); clustered lighting
  gains spot lights + a WebGL2 fallback (#34978), which could retire our own
  `DelveTiledLighting`.
- **Measured on r186.1** (headless, perf-horde, WebGPU): all three of our
  naming/geometry patches are STILL NEEDED. `stable-buffer-names` off →
  171 pipelines vs 92 (r185: 169 vs 90), so r186's deterministic binding
  labels (#34069) don't cover skinned/instanced `NodeBuffer_<id>`.
  `stable-shader-names` and `stale-vertex-buffers` change no count on this
  floor (they guard other cases). Boot time and pipeline counts otherwise
  unchanged vs r185 — r186.1 is a maintenance upgrade, not a speed-up.
- Not fixed upstream, patches stay: render-bundle pass order; per-object
  default uniform group (the CLAUDE.md rule stays).

## Phase 3 — debt

- `createEnemy` ~3,365 lines in one function (`mobs/enemy.ts`); `buildLevel`
  ~2,255 + `buildRoomShell` 755 (`level/builder.ts`). CONSOLIDATION-PLAN 2a/2b
  stalled while both grew.
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
- `debug/scenarios.ts` (3,196 lines) ships in the prod main chunk: statically
  imported by `main.ts`, side-effectful top level. Dynamic-import it under DEV.
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

- 2026-11-21 Phase 2 (part): three r185.1 → r186.1 + @types/three 0.186.
  Real GPU: renders correctly, 60 fps cap, 0 GPU errors, 0 in-play compiles.
  Headless both backends pass; 154/154 test files; canaries 14/14.

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
