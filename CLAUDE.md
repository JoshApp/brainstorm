# Project: DELVE (working title)

A grimdark first-person dungeon crawler for mobile browser. Async multiplayer in the Dark Souls tradition. LLM-augmented item, lore, and event system.

## Core Design Pillars

1. **Crunchy combat first.** Combat feel is the foundation. Everything else is built on top. If combat doesn't feel good, nothing else matters. Polish this before adding features.
2. **Mobile-native browser game.** Must work on a phone, in a browser, with thumbs. No keyboard, no mouse. PWA-installable.
3. **Grimdark atmosphere through restraint.** Limited palette, torchlight, sound design, terse writing. NEVER bright, NEVER cute, NEVER comic-relief.
4. **Solo descent, async multiplayer.** Players play alone but encounter traces of others — bloodstains, messages, corpses, phantom NPCs.
5. **Delve structure, not extraction.** Players descend, going deeper is the progression. They will eventually die. Meta-progression carries forward.
6. **Code-generated visuals.** No 3D model files, no texture pipelines. Geometry composed from Three.js primitives. Style emerges from lighting, shaders, and palette.
7. **LLM is narrative flavor, never mechanics.** The LLM layer (added LATER) generates names, descriptions, epitaphs, lore. It never touches combat math or game rules.

## Build Phases (in order — DO NOT SKIP AHEAD)

### Phase 1: Atmosphere & Movement (current focus)
- [ ] Three.js scene with one dungeon room (walls, floor, ceiling)
- [ ] Torchlight: real-time flickering point light, dramatic shadows
- [ ] Fog: dense, dark, hides anything beyond ~6 meters
- [ ] First-person controls: touch joystick (left thumb) + camera swipe (right thumb)
- [ ] PWA manifest so it installs to home screen
- [ ] Deploy to a public URL so Josh can open on his phone

### Phase 2: Combat (the make-or-break)
- [ ] One mob type, primitive geometry (capsule body + sphere head)
- [ ] Mob AI: detect player, approach, attack when in range
- [ ] Tap-to-attack on right side of screen
- [ ] Hit detection with raycast
- [ ] **Hit-pause** (80ms freeze on connecting hit) — non-negotiable
- [ ] Screen shake on hit
- [ ] Haptic feedback (navigator.vibrate)
- [ ] Sound effects layered (impact + material + grunt)
- [ ] Damage numbers, small and fast
- [ ] Recovery frames on player swing (cannot cancel)
- [ ] Stamina bar with consequences (empty = stagger on hit)
- [ ] Death sequence (slow-mo, red vignette, audio muffle, beat of silence)
- [ ] **Iterate this phase until combat genuinely feels crunchy on a phone.** Do not move on until Josh confirms.

### Phase 3: Dungeon Structure
- [ ] Multiple rooms connected by doors
- [ ] Procedurally arranged floors (3-5 rooms per floor)
- [ ] Stairs down between floors
- [ ] Depth counter (small, bottom of UI)
- [ ] 3 mob types with different attack patterns / spatial dances
- [ ] Basic loot drops (visual objects you walk over to pick up)
- [ ] Inventory screen (simple grid)

### Phase 4: Async Multiplayer Foundation
- [ ] SpacetimeDB integration
- [ ] Player events logged as event-sourced rows
- [ ] Bloodstains: spawn at death locations from other players' runs
- [ ] Messages: simple template-based for now (Souls-style vocabulary)
- [ ] Corpses: other players' dead characters appear as walkable-up-to objects

### Phase 5: LLM Layer (LAST)
- [ ] Item descriptions generated on first-discovery
- [ ] Death epitaphs generated from player event log
- [ ] Bloodstain narration generated from death context
- [ ] Cached aggressively — most calls hit cache, only novel events hit API
- [ ] Character summary updates every 5 floors

## Architecture Principles

- **Vanilla TypeScript + Three.js.** No React for the 3D scene. React only for UI overlay (HUD, inventory, menus).
- **Vite** as build tool. Fast HMR, mobile-friendly dev server with QR code for phone testing.
- **One concern per file.** Combat logic, mob AI, lighting, controls, UI — all separate modules.
- **Constants in one place.** All tuning numbers (damage values, attack timing, light radius, etc.) in `src/config.ts` so iteration is one-file changes.
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

## Tone Bible (for any text written by the system or LLM later)

- Terse. Archaic. Cruel. Indifferent.
- "A blade that remembers heat" — yes
- "Sword of Fire +3" — no
- "She was forgotten on Depth 47" — yes
- "You leveled up! +10 XP" — no
- Items don't celebrate. The dungeon doesn't care. The system observes without judgment.
- No exclamation points outside player input. No emoji. No modern slang.

## Deployment

- Hosted on Cloudflare Pages (free tier, instant deploys from git push).
- Public URL. Mobile-installable.
- Every push to `main` deploys automatically.
- Josh opens the URL on his phone, taps install, plays daily build.

## Operating Mode

- Iterate in small, testable increments. Each session, ship something Josh can feel on his phone.
- Commit often. Push often. Live URL always reflects latest work.
- When in doubt, ask Josh which direction. Do not over-architect.
- This is not a long-running production codebase. It is an evolving prototype. Optimize for iteration speed, not enterprise patterns.

## Tone Layering — the DCC tribute hook

This project is inspired by *Dungeon Crawler Carl*. The DCC tone (snarky AI announcer,
sponsor pops, sarcastic achievements, fourth-wall mockery) is the **tribute layer**.
It does NOT live in the dungeon.

**The dungeon is grimdark.** All in-world text — item flavor, mob behavior, room
descriptions, ambient writing — stays cruel, terse, and indifferent. Everything in
the "Tone Bible" section above still applies, unchanged, to in-world content.

**The narrator is not.** The game runs on top of a cosmic **broadcast frame**: a
meta-layer of system pops, achievements, item-discovery blurbs, run-summary
epitaphs, and (eventually) an announcer voice. THIS layer is allowed to be
snarky, pop-cultural, fourth-wall-aware. The contrast IS the joke.

Example of the split on a single event (player dies on Floor 1 in their underwear):

- **In-world death message** (grimdark, fits the Tone Bible):
  > "She was forgotten on Depth 1."
- **Broadcast pop on the same death** (DCC tribute layer):
  > "Achievement Unlocked: Dignity Optional — Die in your underwear on Floor 1."

**Phase ordering for the tribute layer:**

- Phases 1-3 build the grimdark crawler exactly as planned in the Build Phases above.
  Zero broadcast content. Zero snark in any text.
- Phase 4 introduces the broadcast frame as architecture (event bus, achievement
  triggers, UI overlay distinct from in-world UI).
- Phase 5 plugs the LLM into the broadcast layer to generate snark on demand,
  with aggressive caching.

**Do not bleed snark into in-world text.** Keep the layers architecturally separate.
Item names are grim. Achievement names are funny. They can describe the same event.

## Deploy

Deployed via **GitHub Pages**, built by GitHub Actions on every push to `main` or
the active feature branch.

- Workflow: `.github/workflows/deploy.yml`
- Live URL: `https://joshapp.github.io/brainstorm/`
- Vite is configured with `base: '/brainstorm/'` so the sub-path works.
- PWA manifest `scope`/`start_url` also use `/brainstorm/` — install-to-home-screen
  launches at the right URL.

One-time Pages setup (Josh, in the GitHub UI):
`Settings → Pages → Source: "GitHub Actions"`.
