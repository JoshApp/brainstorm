# Project: DELVE

A grimdark first-person dungeon crawler for mobile browser. Async multiplayer in the Dark Souls tradition. LLM-augmented item, lore, and event system.

## Core Design Pillars

1. **Crunchy combat first.** Combat feel is the foundation. Everything else is built on top. If combat doesn't feel good, nothing else matters.
2. **Mobile-native browser game.** Must work on a phone, in a browser, with thumbs. PWA-installable. Desktop is debug only.
3. **Grimdark atmosphere through restraint.** Limited palette, torchlight, sound design, terse writing. NEVER bright, NEVER cute, NEVER comic-relief.
4. **Solo descent, async multiplayer.** Players play alone but encounter traces of others — bloodstains, messages, corpses, phantom NPCs.
5. **Delve structure, not extraction.** Players descend, going deeper is the progression. They will eventually die. Meta-progression carries forward.
6. **Code-generated visuals.** No 3D model files, no texture pipelines. Geometry composed from Three.js primitives. Style emerges from lighting, shaders, and palette.
7. **LLM is narrative flavor, never mechanics.** The LLM layer generates names, descriptions, epitaphs, lore. It never touches combat math or game rules.

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

## Deploy

Deployed via **GitHub Pages**, built by GitHub Actions on every push to the active branch.

**Always push with `npm run ship`, never bare `git push`.** It typechecks
(pre-push hook), pushes, watches the GitHub Pages run to completion, and
prints the failed step's log if it goes red — so a broken deploy surfaces
on its own instead of on the next manual check.

**Run it in the background (Claude Code: `run_in_background: true`), never
in the foreground.** The deploy takes ~45–60s; backgrounding means it
never blocks — keep working, and the harness re-invokes you with the
result (success, or the failed-step log to fix) when it finishes. This is
the standard push: fire `npm run ship` to the background and move on.

Pass git args through with `npm run ship -- <args>`. (`SKIP_PREPUSH=1`
bypasses the typecheck for an emergency push.)

- Workflow: `.github/workflows/deploy.yml`
- Live URL: `https://joshapp.github.io/brainstorm/`
- Vite is configured with `base: '/brainstorm/'` so the sub-path works.
- PWA manifest `scope`/`start_url` also use `/brainstorm/` — install-to-home-screen launches at the right URL.

One-time Pages setup (Josh, in the GitHub UI):
`Settings → Pages → Source: "GitHub Actions"`.
