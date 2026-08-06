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

### Broadcast layer (the dungeon's attention)
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

## Model authoring (Claude is the model author)

You — this session, every future session — are the layer that writes
ModelSpec geometry. The codebase has tools, conventions, and known
LLM-CAD failure modes that the research literature has identified.
Honour them and your first attempt will be much closer to right.

### Coordinate convention (pin this in your head before authoring)

Three.js is **right-handed, Y-up, metres**. ALWAYS:

- **+X** = right
- **+Y** = up
- **+Z** = toward the camera (so a forward-facing weapon points in **−Z**)
- **rot** = `[rotX, rotY, rotZ]` Euler in **radians**, applied in
  Three's default XYZ order. Rotation-order confusion is the #2
  documented LLM-CAD failure mode after axis confusion — if a part
  ends up wildly mis-oriented, suspect order, not magnitude.

Most of the codebase's existing models follow these conventions. When
in doubt, look at how an adjacent weapon authors its hilt + blade.

### Primitives you can compose

`box` `sphere` `capsule` `cylinder` `cone` `lathe` `extrude` `torus`
`sprite` `decal` — plus the **`csg`** node (boolean op between two
child specs). New as of recent work:

- **`box.bevel`** — corner radius in metres, swaps to
  `RoundedBoxGeometry`. Default 0 (hard edges). Use sparingly; most
  shapes don't need it. Set when authoring chunky surfaces that
  should catch light (bracers, chests, benches).
- **`extrude.bevel*`** — `bevel: true` + optional
  `bevelSize/Thickness/Segments` rounds the front + back faces of an
  extrusion. Good for fullers in blades, raised emblems, key bits.
- **`kind: 'csg'`** — `{ op: 'subtract'|'add'|'intersect', a, b }`.
  The "ProBuilder in code" tool. Use for: skulls with eye sockets,
  chests with keyholes, hands with finger grooves, weapons with
  fullers cut from a blade. Both operands must be CLOSED solids
  (sphere/box/capsule/cylinder/cone/lathe/extrude/csg). **Stay
  shallow** — the research finds LLM CSG state tracking degrades
  past 2-3 nesting levels.

### Named anchors > raw coordinates (this is load-bearing)

Recent academic CAD work ([LL4CAD-DSL], [AIDL]) identifies
**symbolic anchor reference** as the single biggest mitigation for
LLM spatial-reasoning collapse. Coordinates rot — change the parent
and every absolute child position needs re-tuning. Anchor references
survive refactors.

In ModelSpec:

- **Declare `slots`** on every model that other things attach to —
  `grip_anchor`, `blade_tip`, `palm_anchor`, `mount_point`. A slot is
  a named `Object3D` with a local pos/rot; child models or weapons
  attach to it.
- **Reference slots by name** when composing (e.g. the viewmodel
  parents a weapon's `grip_anchor` to the hand's `palm_anchor`)
  rather than measuring an offset and pasting the magic numbers
  somewhere.
- **Name your parts** (`name: 'blade'`, `name: 'palm'`) — debug
  overlays use these names, and a content-layer animation can
  reference them.

### Anchors with INTENT (the next level up)

A position slot is mute: "something is here." An *intent* anchor
carries MEANING — what should be here, which way it should face,
what something should ALIGN to. Two naming conventions the bench
treats specially when it renders the debug overlay:

- **`*_up` / `*_emerge` / `*_axis`** — the slot's local +Y direction
  is meaningful. Bench renders it as a labeled arrow instead of an
  axis triad. Use for:
  - `palm_up` — the palm's outward normal (which way the palm faces)
  - `blade_emerge` — where a blade exits the closed fist
  - `grip_axis` — the direction along which a weapon's grip extends
- **`contact_*`** — a target POINT (no direction). Bench renders it
  as a small magenta sphere; the readout reports the distance from a
  paired live slot (`contact_index` ↔ `finger_index_dip`, etc.) as
  the `fingerContactErrors` array. This converts "tune curl angles
  by eye" into "drive these distances to zero."

A model authored with intent anchors lets a future Claude (or a
future content layer) reason about it abstractly — "where should the
weapon sit" reads off `palm_up` and `palm_anchor`, not by measuring
the bones. Annotated models survive refactors that absolute
coordinates don't.

### The bench is your iteration loop

The fast author → render → look loop, no game underneath:

```
delve bench viewmodel-<id> --hand --ortho --debug
```

`--ortho` = 2×2 FRONT/SIDE/TOP/ISO contact sheet (multi-view is the
single biggest LLM-iteration win — never iterate single-view);
`--debug` = part colours + slot markers + bbox. That combo is the
default for any geometry/grip work. **The full tooling map — every
flag, which tool for which job (bench vs snap vs `?viewer=1`),
`delve weapons`, and the author→iterate→inspect loop — lives in
`docs/AUTHORING.md` → "Tooling".** Read it once; don't hand-write a
preview scenario or a one-off script when a `delve` command exists.

Static-model debug subjects (specs the authorable registry doesn't
own) go in `src/bench/subjects.ts` under the `model-` prefix
(e.g. `model-hand-right`).

### Known failure modes (read this before you author)

The CAD LLM literature is explicit about where models go wrong. Most
of these are mitigated by the conventions above; the rest are flagged
here so you can self-check.

1. **Axis confusion** — Z-up vs Y-up flip, +Z vs −Z forward. Three is
   Y-up, −Z forward.
2. **Rotation order** — XYZ Euler order in Three. If a part looks
   wildly off, halve one axis and see if it's not the wrong axis.
3. **CSG state tracking** — past 2-3 nest levels, the model loses
   track of "what's solid vs void." Flatten.
4. **Coordinate-vs-symbolic.** Prefer slot names over magic offsets.
5. **One-blob-of-leather** — same material on every part = silhouette
   collapse. Either vary materials (named differently even if
   close-coloured), or run `--debug` to see per-part colours.

### Author rotations by INTENT, not by guessing Euler decimals

The single biggest source of "iterate three times with the wrong
sign" in this codebase is hand-tuning Euler rotations. `rot: [-0.2,
-0.15, 0.4]` reads as nothing to anyone and the sign of any one
component depends on which axis you're projecting to — half the
"invert that" guesses go the wrong way.

When you're authoring a NEW rotation (an idle pose, a slot
orientation, a clip endpoint), use `src/anim/orient.ts` instead:

```ts
import { orient, tilt, DIR } from '../anim/orient';

// "I want the weapon's grip axis (= the model's local +Y) to point
//  mostly forward with a slight downward lean. The back of the hand
//  (local +Z) should mostly face up."
const SWORD_IDLE_ROT = orient({
  yAxisTo: tilt(DIR.FORWARD, DIR.DOWN, 0.2),
  upTo:    tilt(DIR.UP, DIR.LEFT, 0.3),
});
```

The function solves for the Euler — sign-correct, order-correct,
orthogonalised. You only ever name directions (UP, DOWN, LEFT,
RIGHT, FORWARD, BACKWARD) and `tilt(principal, secondary, amount)`
between them. `amount` is a feel knob (0.05 subtle, 0.20 slight,
0.40 moderate, 0.80 strong).

Existing tuned rotations (like the current `SWORD_IDLE_ROT`) can
stay as decimals — don't refactor what's already feeling right.
But any NEW pose should go through `orient()`. If you find
yourself authoring `rot: [a, b, c]` and the file would compile
without you understanding what the result LOOKS like, you reached
for the wrong tool — use `orient()`.

**Counter-rotating a child to keep it fixed in world space** —
`localFromWorld(worldRot, parentRot)` returns the local rotation
that, combined with the parent, gives the requested world rotation.
Use when you want to rotate a parent (say, the wrist) while a child
slot (say, palm_anchor and the weapon attached to it) stays at its
pre-rotation orientation:

```ts
const newWristRot = orient({ yAxisTo: tilt(DIR.UP, DIR.FORWARD, 0.5) });

slots: {
  wrist: { rot: newWristRot },
  palm_anchor: {
    parent: 'wrist',
    pos: [0, 0.092, -0.011],
    // Keep the weapon at "identity rotation in the hand's root frame"
    // regardless of how the wrist itself is rotated above it.
    rot: localFromWorld([0, 0, 0], newWristRot),
  },
}
```

You author intent in the frame you think in (hand-root, world,
whatever the parent's frame is), and the helper handles the
counter-rotation math.

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

The full visual grammar — reveal modes, brightness budget, color
legend, geometry rules, the three-lights acceptance test — lives in
**docs/VISUAL-LANGUAGE.md**. Check model/material work against it.

## Designing mechanics — read this before authoring an item or an economy

**docs/DESIGN-METHOD.md** is the record of how design has actually gone wrong
here, with the rules that came out of each failure. It is short and every entry
is a real bug, not advice. The load-bearing ones:

- **Bonuses add, penalties multiply, crit multiplies once.** Five stacked
  player-chosen multipliers turned a 1-damage dagger into an 11-damage hit.
- **Player-controlled condition + multiplicative payoff = broken, always.** That
  is the whole diagnosis; check a new effect against it before writing numbers.
- **Every audit tool imports the real function.** A report that re-inlines the
  math is worse than no report — it launders a guess as a measurement.
- **Check final-state rules against the final state.** "A fire and a deal never
  share a room" held in the director and was violated on 16 floors in 240,
  because four other producers place major beats too.
- **A cost denominated in another system's units is a FRACTION, not a number.**
  The blood altar charged four fifths of your health for months because the pool
  shrank and the constant didn't.
- **Brief a role and a ceiling, not a vibe.** Claude is reliable at diagnosis and
  unreliable at inventing fun items; "make some cool relics" reliably produces
  overpowered or boring ones.

## Tone Bible (for any text written by the system or LLM later)

- Terse. Archaic. Cruel. Indifferent.
- "A blade that remembers heat" — yes
- "Sword of Fire +3" — no
- "She was forgotten on Depth 47" — yes
- "You leveled up! +10 XP" — no
- Items don't celebrate. The dungeon doesn't care. The system observes without judgment.
- No exclamation points outside player input. No emoji. No modern slang.

## Tone Layering — the dungeon speaks

**DECIDED 2026-06-12 (supersedes the DCC tribute frame, nuanced same
day):** there is no audience, no showrunner, no sponsors, no fourth
wall, no pop culture. The meta-voice is **something that lives in the
deep** — nameless, ancient, never shown, never explained (a lich? the
dungeon's own mind? a prisoner older than the stairs? deliberately
unresolved). It has watched ten thousand delvers die and it finds you
*funny*. It mocks. It teases. It keeps score. But it is OF the place
— it speaks from below you, not from a studio above.

**Two layers, two temperatures:**

- **In-world text** — item flavor, room descriptions, corpse notes,
  ambient writing. Cruel, terse, indifferent. The Tone Bible applies
  unchanged, NO humor here. This is the place itself: the place does
  not joke.
- **The voice in the deep** (`src/broadcast/` — event bus, pops,
  achievement queue, epitaphs; the architecture keeps its name) — the
  thing that watches. HERE the game is allowed to be funny: cruel
  teasing, gallows comedy, the dry delight of something that profits
  from your death either way. Achievements may be SILLY-DARK — punchy,
  mocking names are encouraged — but framed as ITS mockery, never as a
  system unlock ("Achievement Unlocked" is banned; the thing just
  *says* it). It speaks at meaningful moments (deaths, firsts, streaks,
  foolishness), never explains mechanics, and remembers everything
  (epitaphs, counts of the dead, your past runs).

Example of the split on a single event (player dies on Depth 1 in
their underwear):

- **In-world death message:** "She was forgotten on Depth 1."
- **The voice in the deep:** "Dead on the first stair, and not even
  dressed for it. I will keep this one."

The contrast survives — but it's the contrast between a cruel PLACE
and a cruel WIT that lives inside it, not between a dungeon and a
game show.

**Phase 5 is unchanged mechanically:** the LLM plugs into the same
seams (`src/broadcast/`, aggressive caching) — it writes the voice in
the deep instead of an announcer. The "attention meter"
concept survives BETTER in this frame: the dungeon's attention is
literal — loud, greedy, bloody play gets noticed, and being noticed
has consequences.

**Patchlog voice** (commit `Patch-summary` trailers): stays wry and
terse but drops all crowd/sponsor/show framing — it reads as the
dungeon's ledger of its own changes. Present tense, no emoji, no
exclamations, no modern slang.

## Operating Mode

- Iterate in small, testable increments. Each session, ship something Josh can feel on his phone.
- Commit often. Push often. Live URL always reflects latest work.
- When in doubt, ask Josh which direction. Do not over-architect.
- This is not a long-running production codebase. It is an evolving prototype. Optimize for iteration speed, not enterprise patterns.
- **Fast iteration is for FEATURES. Baseline / cross-cutting systems get a proper,
  research-grounded foundation — not a rushed patch.** Loading, the renderer, the
  warmup, save/state, the frame loop, input — these are amortized over everything;
  a shortcut here bites repeatedly and gets redone five times. The tell: if you're
  patching the *symptom* of a baseline system a second time, stop and design the
  system. **Especially now** — the WebGPU migration has us refactoring and deleting
  legacy across the whole codebase, so it's the right moment to make these proper
  rather than carry the debt forward. "Don't over-architect" still holds for
  features; it is not a license to leave a load-bearing system half-built.

## Commit message format

**YOU (Claude) are the narration layer.** The in-game patch-log screen
is one of your output surfaces — every entry in it was authored by a
Claude session at the moment of its commit. There is no separate
"changelog generator" that summarizes your code for the player; the
generator only collates lines you already wrote.

So every commit you author has two audiences and two parts:

- **Subject + body** — for the human reviewer (Josh, future you).
  Subject is one terse line. Body explains the *why* and what changed
  at the level a code review wants.
- **`Patch-*` trailers** at the end of the body — for the player. The
  `Patch-summary` you write here is *the literal line they read on
  their phone* when they open the patchlog screen.

### Trailers

| Key             | Values                              | Effect                                                                                     |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `Patch-summary` | one sentence                        | **REQUIRED** to appear in the player log. No summary → silently skipped (the right call for infra / refactors / WIP). |
| `Patch-tag`     | `add` `fix` `tune` `content` `tech` | Optional, defaults to `tune`. Picks the icon/category.                                     |
| `Patch-area`    | comma-separated tokens              | Optional: `combat`, `ui`, `level`, `atmosphere`, `controls`, `content`, etc. Drives future filtered views — "all combat changes since Build 12." |

### The Patch-summary voice

This is **broadcast-layer text** (per the Tone Layering section
earlier): the cosmic-announcer / DCC tribute register. Snarky,
fourth-wall-aware, terse, *present tense*, one sentence. NOT the
in-world grimdark register that item flavor and room descriptions
use — the patchlog is the announcer talking ABOUT the dungeon, not
the dungeon talking to itself.

Good:
- "Whip cracks ripple along the chain now. The mob does not appreciate the improvement."
- "Drink the wrong fountain. Become something new. The dungeon does not regret this for you."
- "Fountains stopped poisoning you. The basin agrees, reluctantly."
- "The tome pillar opens your sheet. Yes, you've earned a look."

Bad:
- "Tuned whip damage values" → no voice, dry, dev-speak.
- "Whip cracks ripple, dealing more damage and triggering bleed procs at 0.6s intervals." → too long, mechanic-dump.
- "💥 NEW WHIP MECHANICS!!! 🔥" → not the register at all.

Constraints from the Tone Bible (still apply):
- No emoji. No exclamation points outside player input.
- No modern slang, no "you guys", no marketing voice.
- Present tense. The thing *is now this way*, not "was changed to be."

If you can't compose a Patch-summary that earns its place in the
log, omit the trailer — that commit just doesn't surface, which is
the right outcome for plumbing.

### When to OMIT Patch-summary

- CI / scripts / session-hook changes the player can't observe
- Pure refactors with no behaviour delta
- Type-only changes
- Backup checkpoints (`npm run ship` mid-feature)
- Anything where you'd struggle to write the player-facing line without lying

### Example

```
Whip ripples instead of swinging rigid

Procedural chain physics — a per-link spring solver runs each frame so
the crack lags the swing and snaps back to centre on release. Costs
~0.2ms per whip equipped.

Patch-tag: tune
Patch-summary: Whip cracks ripple along the chain now. The mob doesn't appreciate the improvement.
Patch-area: combat, weapons

https://claude.ai/code/session_...
```

### Future-Claude commitment

You're reading this because you're about to commit. The format above
is **required**, not aspirational, on every commit you make. The
log's quality is your responsibility — there's no fallback parser to
make a dry subject sound right.

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

### THIS IS A MULTI-AGENT REPO — work in your own worktree (default)

Several Claude sessions work this repo **at the same time**, sharing one
checkout. Two agents free-handing the same working directory collide:
push races, one agent's uncommitted edits breaking another's typecheck,
deploys blocked by a tree that's dirty with someone else's WIP. The fix
is isolation — **each session gets its own git worktree off the latest
`main`.**

**At the very start of every session, BEFORE making any file changes,
unless the user explicitly says to work in the main checkout:**

1. Get current with main and create your own isolated worktree off it.
   `main` is the repo's default branch, so `EnterWorktree` bases off it:

   ```
   git fetch origin main      # so the worktree is off the LATEST main
   ```
   then call the **`EnterWorktree`** tool with a short task name
   (e.g. `EnterWorktree({ name: "combo-tuning" })`). It creates
   `.claude/worktrees/<name>` on a fresh branch off `origin/main` and
   switches your session into it.

2. A fresh worktree has **no `node_modules`** — symlink the main one so
   `tsc` / `vite` / `tsx` resolve, or every build fails:

   ```
   ln -s ../../../node_modules node_modules
   ```

3. Work there, commit only your own files, and `npm run live` from the
   worktree to deploy (its tree is clean, so the pre-push typecheck only
   sees YOUR changes — another agent's broken WIP can't block you).

The Bash tool resets cwd each call, so use absolute paths or `cd <worktree>
&& …` in commands. On session end you're prompted to keep or remove the
worktree (`ExitWorktree`).

**Opt-out:** if the user says to work directly (a quick read-only task, a
one-line fix, or "don't use a worktree"), skip this and just
`git fetch origin main && git rebase origin/main` on the shared branch as
below. Pure conversational / read-only sessions don't need a worktree.

If `origin/main` doesn't exist yet (very-first-deploy bootstrap),
`npm run live` creates it from your session HEAD.

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

**Cloud agents don't have `gh` installed**, so `npm run live` cannot see
whether the site actually updated. It prints **`⚠ PUSHED … DEPLOY
UNVERIFIED`** in that case — that is NOT a success, and reporting it as
"live" is wrong. On 2026-08-06 five consecutive commits were called live
while `actions/deploy-pages@v4` sat in GitHub's Pages queue and aborted; the
BUILD was green every time, which is why nothing local noticed.

To actually confirm, after `live`: `mcp__github__actions_list`
(`{"branch": "main"}`), then **look at the `deploy` JOB's conclusion, not
the run's build job**. `mcp__github__actions_list` with
`method: list_workflow_jobs` gives per-job status.

**Read the job, not the run.** A run whose conclusion is `failure` may have
failed in three quite different ways, and only one of them is yours:

| What you see on the job | What it means |
| --- | --- |
| `build` failed, with `steps` | Your code. Fix it. |
| `deploy` failed after a green `build` | `actions/deploy-pages@v4` timed out in the Pages queue. Service-side. |
| `build` **cancelled**, `runner_id: 0`, no `steps`, ~15 min from `created_at` to `completed_at` | **NO RUNNER WAS EVER ASSIGNED.** The job sat in the queue until GitHub gave up. Nothing was built and nothing was deployed. |

That third row is the one that fooled a session on 2026-08-06: five commits
in a row were reported as live while every job was being cancelled unstarted,
and the site stayed on the commit from two hours earlier. The tell is
`runner_id: 0` and an empty `steps` array — a job that actually ran has a
real runner name and a step list. When you see it, say so plainly: **the site
has not moved.** It is an account/service condition (runner availability),
not something in this repo, and the only lever from here is to push again
later. The GitHub App token lacks `actions: write`, so `rerun_failed_jobs`
and `workflow_dispatch` both 403.

**Don't push to `main` faster than the pipeline drains.** The workflow's
concurrency group is `pages` with `cancel-in-progress: false`, so runs
queue — and only the newest PENDING run survives, the rest are cancelled.
That's harmless for content (main fast-forwards, so the newest run carries
every earlier commit) but it makes the run list look like a wall of failures
and it hides the case above. One `live` at a time; verify before the next.

On your own machine `gh` is installed and the script polls as designed.

### Configuration

- Workflow: `.github/workflows/deploy.yml` — triggers only on push to `main`.
- Live URL: `https://joshapp.github.io/brainstorm/`
- Vite is configured with `base: '/brainstorm/'` so the sub-path works.
- PWA manifest `scope`/`start_url` also use `/brainstorm/` — install-to-home-screen launches at the right URL.

One-time Pages setup (Josh, in the GitHub UI):
`Settings → Pages → Source: "GitHub Actions"`.
