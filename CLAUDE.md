# Project: DELVE

A grimdark first-person dungeon crawler for mobile browser. Async multiplayer in the Dark Souls tradition. Designed and built by a layered LLM system (see **Authoring Model**); items, lore, and events are LLM-generated.

## Core Design Pillars

1. **Crunchy combat first.** Combat feel is the foundation. Everything else is built on top. If combat doesn't feel good, nothing else matters.
2. **Mobile-native browser game.** Must work on a phone, in a browser, with thumbs. PWA-installable. Desktop is debug only.
3. **Grimdark atmosphere through restraint.** Limited palette, torchlight, sound design, terse writing. NEVER bright, NEVER cute, NEVER comic-relief.
4. **Solo descent, async multiplayer.** Players play alone but encounter traces of others — bloodstains, messages, corpses, phantom NPCs.
5. **Delve structure, not extraction.** Players descend, going deeper is the progression. They will eventually die. Meta-progression carries forward.
6. **Code-generated visuals.** No 3D model files, no texture pipelines. Geometry composed from Three.js primitives. Style emerges from lighting, shaders, and palette.
7. **LLM-authored, in layers.** This game is *designed and built* by a layered LLM system — an orchestrating design layer, a coding layer, a content/items layer, a narration layer (see **Authoring Model**) — not a hand-built game with LLM text bolted on. Whether an LLM also acts at *runtime* (live, mid-run, on the player's device), and how far into mechanics it may reach there, is deliberately **left open** for now.

## Authoring Model — a layered LLM system

DELVE is the *output* of a layered LLM authoring system, and increasingly its
*subject*. The paradigm: distinct LLM layers each own a slice of making the
game, and this repository is the shared substrate they read and write.

- **Design / orchestration layer** — holds the vision (this CLAUDE.md is its
  charter), sets direction, and delegates to the layers below.
- **Coding layer** — all the engineering: systems, refactors, build, deploy.
  (The layer authoring these very lines.)
- **Content / items layer** — items, affixes, enemies, vaults, events authored
  as DATA that the coding layer's systems consume.
- **Narration layer** — names, descriptions, epitaphs, bloodstain narration,
  the broadcast/announcer voice.

Two consequences for how we build:

1. **Code is an interface between layers, so it must be legible as data.** A
   system the coding layer writes should expose its tunable surface as *data*
   — config knobs, content specs — with clear names and stated intent, so a
   content or design layer can author against it without reading the
   implementation. "One concern per file", data-driven specs, and named
   constants in `config.ts` aren't just tidiness here; they're the seam the
   other layers plug into. Prefer extracting pure, named, testable logic over
   clever-but-opaque code.
2. **Build-time vs run-time is the load-bearing distinction (and run-time is
   TBD).** At build/design time the layers may touch anything, mechanics
   included — that's the point. Whether an LLM acts at RUNTIME is a separate
   question with real constraints — determinism, fair play, latency, cost,
   offline/PWA, aggressive caching — and is **currently undecided**. Until it's
   decided: keep runtime LLM use in the content/narrative lane (the
   `broadcast/` seams), and keep combat math + game rules computed locally and
   deterministically. Architect so the line *can* move later without a rewrite
   — route any LLM-authored values through the same data surfaces (config /
   specs) the build-time layers already use, rather than into bespoke code
   paths.

## What's Built

If you're reading this to figure out where to start, read this section first — it's the source of truth for what already exists. Don't reinvent any of it.

### Core loop
- 3-act dungeon (`src/level/acts.ts`) with hand-authored safe rooms between acts and procgen floors in between
- Vault-based procgen (`src/level/{procgen,vault,vault-compose,vault-library}.ts`) — ASCII tile chunks chained into floors, deterministic per run seed
- Multi-room levels with corridors, doors that seal on combat and open on room-clear
- Tutorial chamber for first-time players (`src/level/tutorial.ts`)

### Combat
- Cone raycast sword swing with windup/strike/recover phases (`src/combat/attack.ts`, `src/player/sword.ts`)
- Hit-pause, screen shake, haptic, damage numbers (`src/combat/`, all tuned in `src/config.ts`)
- 3+ enemy types with data-driven specs (`src/content/enemies.ts`), shared aggro alerts (`src/mobs/alerts.ts`), pooled projectiles (`src/combat/projectile-pool.ts`)
- Dark Souls-style death sequence: slow-mo + camera collapse + red vignette (`src/player/death.ts`)
- Destructible vases drop loot (`src/level/destructibles.ts`, `src/content/vase.ts`)

### Player progression
- Equipment slots (weapon, armor, helmet, amulet, gloves, boots, offhand, two rings) — `src/player/equipment.ts`
- Affixes + passives + relics + buffs, all composing through one stat pipeline (`src/combat/modifiers.ts`, `src/ecs/buffs.ts`)
- Inventory grid, consumables bar, stash chest (`src/ui/inventory-panel.ts`, `src/ui/stash-screen.ts`)
- Per-run state + meta progression (codex, deepest depth, achievements) persisted to `localStorage` (`src/state/`)

### Atmosphere & rendering
- Three swappable art styles: PS1 / flat-shaded / procedural stone (`src/style/`)
- Slot-based light pool with LOS culling (`src/scene/light-pool.ts`) — prevents Three.js shader recompiles on light-count change
- Torchlight flicker, handheld lamp, candle/bonfire flame stacks, god rays in signature vaults
- Drifting motes, XP wisps, gold coins (`src/effects/`)
- Web Audio synth for ambient bed + impacts (`src/audio/sfx.ts`)

### Interactables
- Registry-based system with in-range + forward-cone detection (`src/interactables/system.ts`)
- Chests, stash chest, doors, fountains, spike traps, stairs, corpses, pickups, notes
- Tap-target raycast lets you tap directly on an object instead of walking up to it (`src/controls/tap-target.ts`)

### Broadcast layer (DCC tribute)
- Event bus + achievement queue + pop UI all wired (`src/broadcast/`, `src/ui/broadcast-pop.ts`)
- LLM not plugged in yet — that's Phase 5. The seams are there.

### Debug
- URL scenarios (`?scenario=name`) jump past the title into posed world states (`src/debug/scenarios.ts`)
- Snap CLI for headless Playwright screenshots (`scripts/snap.ts`, `npm run snap`)
- URL flags: `?fakemeta=1`, `?fakesave=1`, `?showEnd=1`, `?showCodex=1`, `?showStash=1`, `?tutorial=1`
- `?god=1` — invulnerability for posing combat states without dying (DEV-only)

### Dev-only code must not ship to the live site
The live GitHub Pages site is a `vite build` (production), where Vite replaces
`import.meta.env.DEV` with the literal `false`. **Every cheat / debug-only
affordance** — godmode, scenario jumps, `window.__*` inspection hooks,
debug-only URL flags — **must sit behind the `DEV` gate** (`src/debug/dev.ts`):
an `if (import.meta.env.DEV)` guard or a `DEV && …` short-circuit. Those blocks
collapse to `if (false)` and are dead-code-eliminated, so the affordance
literally cannot be reached or toggled on the live site. Belt-and-suspenders for
the riskiest ones (e.g. `setGodMode` does `godMode = DEV && on`) so even a stray
call can't enable them in prod. Diagnostics that are safe for players and already
inert on the static deploy (the dev-server `/__debug/capture` endpoint) are the
only exception. Verify a strip with `npm run build` then grep `dist/assets/*.js`.

## Current Focus

Atmosphere & feel polish. Recent work has been on prop variety, declarative prop facing, bonfire/candle flame stacks, art-style passes. The core game is feature-complete through Phase 3.

**Default mode: don't add new mechanics unless explicitly asked.** Polish, iterate on feel, fix bugs found on the phone. Save big new systems for when Josh names one.

When in doubt about what to do next: ask Josh.

## Phases

- **Phase 1 — Atmosphere & Movement: ✓ DONE**
- **Phase 2 — Combat: ✓ DONE** (hit-pause, shake, haptic, damage numbers, death sequence — all in)
- **Phase 3 — Dungeon Structure: ✓ DONE** (multi-room procgen, multiple enemy types, inventory, loot)
- **Phase 4 — Async Multiplayer: NOT STARTED**
  - SpacetimeDB integration
  - Player events logged as event-sourced rows
  - Bloodstains spawned at other players' death locations
  - Souls-style template messages
  - Other-player corpses walkable-up-to
- **Phase 5 — LLM Layer: NOT STARTED** (broadcast architecture from Phase 4-tribute work is already in place; just needs the LLM calls + cache)
  - Item descriptions on first discovery
  - Death epitaphs from event log
  - Bloodstain narration from death context
  - Aggressive caching — most calls hit cache
  - Character summary every 5 floors

## Architecture Principles

- **Vanilla TypeScript + Three.js.** No framework. UI is vanilla DOM with manual layout.
- **Vite** as build tool. Fast HMR, mobile-friendly dev server with QR code for phone testing.
- **One concern per file.** Combat logic, mob AI, lighting, controls, UI — all separate modules. Long file names are fine.
- **Constants in one place.** All tuning numbers in `src/config.ts`. Iterate there first.
- **ECS-lite.** Entities live in a single `Map` in `src/ecs/world.ts`. Presentation (meshes, AI state) lives on classes that reference their entity by id. Effects/triggers/buffs all flow through the same pipeline regardless of source.
- **Module-level mutable state with getter/setter exports.** Not class singletons. Fine at this scale.
- **No barrel exports.** Direct imports.
- **No premature optimization.** Build it working first, optimize when measured.
- **Mobile is the primary target, desktop is debug.** Test on phone every change.

## Visual Style Reference

- **Lunacid** (PS1-era lo-fi 3D, fog, torchlight)
- **Cruelty Squad** (primitive geometry, shader work)
- **Manifold Garden** (untextured surfaces, lighting carries)
- **Darkest Dungeon** (palette and writing tone)

NOT inspired by:
- Generic dark fantasy MMOs
- Modern AAA aesthetic
- Pixel art (we are 3D)
- Anything cute or stylized-bright

## Lighting as signal

The dungeon's baseline is darkness. **Any UNCOMMON light source the
player sees should mean SOMETHING IS HAPPENING THERE.** Players will
learn the rule from the geometry: an unusual light = an event, an
interactable, a story beat. If we use special lighting as pure
decoration, we destroy that signal.

Rules:
- **God rays anchor content.** Every god ray must illuminate or sit
  beside something the player can engage with — a fountain, an altar,
  a chest, a corpse with a note, a boss spawn. Never as background
  ambience.
- **Coloured floor glows mark a hot spot.** Treasure glows under the
  treasure-room altar; blood glows under the blood altar's basin.
  Don't sprinkle them as carpet.
- **Mood-coloured torches signal the room's character.** Blood-red,
  sickly-green, moonlight-blue — each is a promise about what's in
  the room. The fill light system auto-tints to match (see
  `averageTorchTintInRect` in builder.ts) so all sources read in
  agreement once a vault commits to a palette.
- **The player's lamp is the BASELINE everywhere.** Anything brighter
  than the lamp or in a colour the lamp isn't carrying is a signal.

When in doubt: if you're tempted to add a god ray to make a room look
less empty, the right move is usually to give the room a reason to
exist (encounter, hint, interactable) rather than light up an empty
corner.

## Tone Bible (for any text written by the system or LLM later)

- Terse. Archaic. Cruel. Indifferent.
- "A blade that remembers heat" — yes
- "Sword of Fire +3" — no
- "She was forgotten on Depth 47" — yes
- "You leveled up! +10 XP" — no
- Items don't celebrate. The dungeon doesn't care. The system observes without judgment.
- No exclamation points outside player input. No emoji. No modern slang.

## Tone Layering — the DCC tribute hook

This project is inspired by *Dungeon Crawler Carl*. The DCC tone (snarky AI announcer, sponsor pops, sarcastic achievements, fourth-wall mockery) is the **tribute layer**. It does NOT live in the dungeon.

**The dungeon is grimdark.** All in-world text — item flavor, mob behavior, room descriptions, ambient writing — stays cruel, terse, and indifferent. Everything in the "Tone Bible" section above still applies, unchanged, to in-world content.

**The narrator is not.** The game runs on top of a cosmic **broadcast frame**: a meta-layer of system pops, achievements, item-discovery blurbs, run-summary epitaphs, and (eventually) an announcer voice. THIS layer is allowed to be snarky, pop-cultural, fourth-wall-aware. The contrast IS the joke.

Example of the split on a single event (player dies on Floor 1 in their underwear):

- **In-world death message** (grimdark, fits the Tone Bible):
  > "She was forgotten on Depth 1."
- **Broadcast pop on the same death** (DCC tribute layer):
  > "Achievement Unlocked: Dignity Optional — Die in your underwear on Floor 1."

**The broadcast layer's architecture is already built** (`src/broadcast/`, `src/ui/broadcast-pop.ts`). Phase 5 plugs the LLM into it to generate snark on demand, with aggressive caching.

**Do not bleed snark into in-world text.** Keep the layers architecturally separate. Item names are grim. Achievement names are funny. They can describe the same event.

## Operating Mode

- Iterate in small, testable increments. Each session, ship something Josh can feel on his phone.
- Commit often. Push often. Live URL always reflects latest work.
- When in doubt, ask Josh which direction. Do not over-architect.
- This is not a long-running production codebase. It is an evolving prototype. Optimize for iteration speed, not enterprise patterns.

## Commit message format

Commit messages feed the in-game patch-log screen (and, later, the
LLM-narrated dispatch feed). They have two parts:

- **The subject + body** — same as any well-written commit. Subject is
  one terse line, body explains *why* and what changed at a level a
  human reviewer cares about.
- **`Patch-*` trailers** at the end of the body — machine-readable
  key:value lines that drive what surfaces to players. All optional;
  commits without trailers still appear via subject/keyword inference,
  but trailers are how you author with intent.

Recognized trailer keys:

| Key             | Values                          | Effect                                                                |
| --------------- | ------------------------------- | --------------------------------------------------------------------- |
| `Patch-tag`     | `add` `fix` `tune` `content` `tech` | Explicit tag (overrides keyword inference)                            |
| `Patch-summary` | one line                        | Player-facing text (overrides the cleaned subject)                    |
| `Patch-area`    | comma-separated tokens          | Systems touched: `combat`, `ui`, `level`, `atmosphere`, etc. Drives future filtered views. |
| `Patch-audience`| `player` `dev` `both` (default `both`) | `dev` keeps the entry out of the player-facing log                    |
| `Patch-skip`    | `true`                          | Hard-exclude from the changelog                                       |

Example:

```
Whip ripples instead of swinging rigid

Procedural chain physics on the whip — a per-link spring solver runs
each frame so the crack lags-and-snaps when the player swings…

Patch-tag: tune
Patch-summary: Whip cracks now ripple along the chain when you swing.
Patch-area: combat, weapons

https://claude.ai/code/session_...
```

`Patch-summary` is what the patchlog screen displays — write it for
*the player reading it on their phone*, not for the reviewer reading
the diff. Keep it short, factual, and in the game's voice register
(grimdark for in-world facts; the broadcast layer's snark is added by
the future LLM narrator, not by you).

When the change shouldn't surface — script changes, CI tweaks,
session-hook plumbing, work the player can't see — set `Patch-skip:
true`. The user-facing log stays tight.

## Deploy

Deployed via **GitHub Pages**, built by GitHub Actions on push to **`main`**.

### Two commands, two purposes

Multiple Claude sessions work this repo in parallel. To avoid races on the
live URL, the **session branch** you commit to (`claude/<task-name>`) is
NOT auto-deployed; only **`main`** is. Going live is a deliberate step.

- **`npm run ship`** — push your session branch to origin. Frequent. No
  deploy is triggered. Safe to run any time without coordinating with
  other agents.
- **`npm run live`** — promote your session branch into `main` (fast-
  forward merge) and push main. THIS is what triggers the deploy. Run
  when the work is ready to be on the phone.

If `main` has moved ahead of your session branch (another session
shipped first), `npm run live` **auto-rebases** the session onto the
new main and force-with-lease-pushes the rebased branch back to
origin — silently in the no-conflict case. Conflict aborts loud so
you decide what to integrate; we still don't paper over work that
touches the same lines.

### Session lifecycle (start every session this way)

The deploy branch is `main`. Other agents land work on it through their
own session branches; auto-rebase in `live` papers over the no-conflict
cases, but pulling main at session start is still cheaper than hitting
a conflict at deploy time when you've forgotten what you changed.

**At the start of every session, before any code changes:**

```
git fetch origin main
git rebase origin/main
```

That replays this session branch's commits on top of the latest main.
If there are no local commits yet, you fast-forward to whatever main
currently has — you're starting from the canonical state. If there ARE
local commits (continuing a session, or someone pushed to your branch),
the rebase replays them; resolve any conflicts now, when you're fresh,
not at deploy time.

If `origin/main` doesn't exist yet (very-first-deploy bootstrap),
`npm run live` creates it from your session HEAD — no rebase needed
on the first ever session.

### Iteration loop (the normal case)

1. Start of session: `git fetch origin main && git rebase origin/main`.
2. Make changes on the session branch.
3. Commit. **Then run `npm run live`** — don't ask, just live it.
   Every Claude-made commit goes live; `ship` is reserved for backup
   checkpoints during in-progress work (refactors, half-built
   features) that aren't meant to deploy yet.
4. ~90s later the URL is fresh.

If you forgot the rebase at step 1, `npm run live` will rebase for you
on the fly. Only stops if a conflict shows up — then:

```
# in the rebase-in-progress state live left you in:
# (resolve conflicts in the working tree, then)
git rebase --continue
npm run live
# or to back out:
git rebase --abort
```

### `npm run ship` mechanics

- Pre-push hook typechecks; a type error aborts before anything reaches
  the remote. `SKIP_PREPUSH=1` bypasses the typecheck for an emergency push.
- Exit 0 = push landed on the session branch. (Deploy is decoupled —
  `ship` does not start a deploy.)
- Pass git args through: `npm run ship -- --force-with-lease`.

### `npm run live` mechanics

- Fetches origin, fast-forwards local `main` from `origin/main` (or
  bootstraps `main` from your session HEAD if it doesn't exist yet).
- If main has moved ahead of where the session branch is based,
  rebases the session branch onto main automatically and
  force-with-lease-pushes the rebased branch back to origin. A real
  conflict aborts with the rebase left in progress so you can
  resolve and continue — we never silently merge changes that touch
  the same lines.
- Fast-forward merges your session tip into `main`. Aborts on
  divergence rather than create a merge commit.
- Pushes `main`, then watches the deploy via `scripts/watch-deploy.sh`:
  exit 0 = deploy green or still cooking; exit 1 = deploy failed
  (failed-step log dumped inline).
- Returns you to your session branch when done.

**Run `npm run live` in the background**: the agent harness re-wakes you
when it completes (~90s typical). The patient watch-deploy distinguishes
"queued behind another run" (exit 0, push is safe) from "deploy explicitly
failed" (exit 1, fix it).

**Cloud agents don't have `gh` installed.** When Claude runs in the web
cloud container, `gh` isn't available, so the watch-deploy step exits
immediately with "push is safe, use MCP to verify." If you actually want
to confirm a deploy outcome from the agent, call the GitHub MCP tools
directly after running live (e.g. `mcp__github__actions_list` filtered
to `branch: main`, look for `head_sha` matching `git rev-parse HEAD`).
On your own machine `gh` is presumably installed and the script will
poll as designed.

### Configuration

- Workflow: `.github/workflows/deploy.yml` — triggers only on push to `main`.
- Live URL: `https://joshapp.github.io/brainstorm/`
- Vite is configured with `base: '/brainstorm/'` so the sub-path works.
- PWA manifest `scope`/`start_url` also use `/brainstorm/` — install-to-home-screen launches at the right URL.

One-time Pages setup (Josh, in the GitHub UI):
`Settings → Pages → Source: "GitHub Actions"`.
