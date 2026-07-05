# DELVE — Gameplay Charter

**DECIDED 2026-07-05 (Josh + design session).** This is the gameplay spine.
Sessions build *against* this document; changes to it are design decisions,
not refactors. `DESIGN.md` holds the why-philosophy; this holds the what.

---

## The game we are building

**Souls' weight and dread in a real dungeon, one thumb, three minutes a
floor — played against a thing that holds a deck.**

You are a trespasser who is slowly becoming something the dungeon
recognizes. Not a hero clearing content; not an Isaac god-baby trivializing
it. Power is **metamorphosis, not trivialization**: you get stranger, never
safe. The dungeon is older than you, finds you interesting, and keeps a
card for everyone who ever came down.

---

## Feel pillars (test every feature against these)

1. **Space is real.** Retreat, kiting, funneling packs into corridors — the
   crawler's freedom stays. Rooms do NOT universally seal (seals remain one
   encounter flavor, not the rule). Threat binds by **attention, not
   architecture**: while something hunts you, the world's interactables go
   dormant — wherever you run.
2. **Danger never retires.** Mortality is build-dependent and moderate-at-
   least: no random deaths, but a careless glass build can die to a ghoul at
   any depth. You die to things you understand and misplayed — never to
   sponges. Enemies escalate through **behavior** (packs, morale, stalking,
   ambush — the AI-V2 ladder), not hit points.
3. **Deliberation is sacred.** Nothing irreversible happens on a stray tap.
   Deals state their price in plain cruel words; a deliberate hold commits.
   Combat and consideration are separated by the attention rule, not doors.
4. **Terse grimdark applies to builds.** Run-defining choices are FEW and
   HEAVY — two or three per run that visibly change you. No trinket soup.

---

## Run structure: there is a bottom

- **The descent is winnable.** Act III ends at the bottom, where the thing
  in the deep — the voice that has mocked you all game — actually is. A won
  run is ~30–45 min across multiple phone sessions (a floor = a session;
  resumability is a pillar).
- **Below the bottom, the endless dark.** Winning does not end the descent.
  Past the bottom is the true endless zone — the leaderboard's home. "How
  deep" stops meaning "how long did you survive" and means **"how far past
  the end did you dare."** The voice changes register down there.

## The floor contract

Every floor delivers, enforced by the content-budget pass (v3 system —
budgets spawned into open cells via the occupancy grid, decoupled from
vault tags):

1. **A fight that matters** — an encounter with a shape (Seal / Ambush /
   Guardian / Hunt), picked by depth and recent-floor history.
2. **A question** — one deal from the transaction grammar (fountain, altar,
   basin, trial…). Early-floor questions are survivable-bad at worst;
   run-threatening gambles live deep and at boss fires.
3. **A glint** — one curiosity hook: a note, a corpse, a rune, a locked
   thing whose key is elsewhere.

Pacing is shaped, not flat: lean floors early, full contract mid-act, and
one deliberate **quiet floor** per act (no fight — just dread and a
question). The fight-floor lands because the quiet one made you paranoid.

## Exits: the floor's last decision

Floors can offer **multiple exits with attributes** (see
BRANCHING-DESCENT.md): the stairs (known, lit, safe), the trapdoor (fast,
blind drop, random landing — sometimes a secret room, and the dark touches
you on the way down), the locked way (the key you saw behind the pack you
avoided), deeper shafts at a price. Sweeping a floor earns better doors —
exploration pays in options.

---

## The Deck (the power system)

**The deep keeps a deck.** It has watched ten thousand delvers die and
remembers them as cards. These are not human tarot — every card is a
delver, a death, a thing that happened down there. The fortune-teller is
the predator.

- **Your spread is your character sheet.** Some cards you DREW (chosen at
  bonfire ceremonies — your nature, the tarot-is-the-build spine). Some
  were DEALT (the dungeon adds to your spread uninvited).
- **Marks = reversals.** The dungeon transforms you without consent by
  REVERSING a card — same art inverted, the cruel mirror of the blessing.
  Every card ships with two faces. Marks are bargains you didn't sign but
  always earned by chosen exposure (blind trapdoors, surviving what should
  have killed you, desecration, lingering too deep). They are FEW (2–3 a
  run is a lot), named, terse, visible on the body/viewmodel, narrated
  once.
- **Death mints your card — selectively.** A run that earned remembering
  becomes a card — name, depth, cause, build essence, epitaph — written by
  the narration layer from the actual event log (Phase 5: one LLM call per
  death, cached forever). NOT every death mints (criteria TBD — new-depth
  runs, boss kills, interesting deaths); scarcity keeps cards precious.
  Future delvers can draw their own dead. Meta-progression IS the deck
  growing richer with your history.
- **Fallen delvers carry cards.** The lootable corpse traces become RARE —
  and finding one can yield a card: powerful-with-a-drawback, or dealt
  straight-out reversed. Looting a card off a corpse is the world deck's
  singleplayer seed — inheritance before Phase 4 even lands.
- **The world deck (Phase 4).** Other players' death-cards circulate.
  Drawing a stranger's card carries a fragment of their build — and their
  bloodstain glows when you pass where they fell. Async multiplayer as
  inheritance.
- **Floors are dealt.** Entering a floor, the voice flips its card — *The
  Toll, The Nest, The Long Dark* — and that card IS the floor's contract
  (encounter shape, question, mood-light palette) and can carry MODIFIERS
  (the dark hungrier, the torches fewer, the dead restless). Floor intent,
  content budget, and narration share one vocabulary.

**GUARDRAIL: cards never enter combat.** No card-as-action, no hand
management, no Balatro creep. Combat stays cone-swing crunch, computed
locally and deterministically. Cards are the fate layer only: who you are,
what the floor is, what the dungeon remembers.

---

## The Presence

The dungeon has presence, **never a body** (tone canon: never shown, never
explained, deliberately unresolved). What we take from Inscryption /
Buckshot Roulette is the TABLE, not the dealer — and our table is the
**bonfire reading**:

- The ceremony is a scene: world drops away, camera settles on fire +
  spread. Fights cannot reach you here; *it* can.
- Cards are dealt from BEYOND the firelight. No hand, no face. The fire
  leans, dims, gutters when a reversal comes.
- The voice goes near-field and personal — the one place it speaks TO you
  instead of about you.
- The ceremony can bite in real time (a major dealt reversed while you
  watch). Hold-to-flip; the card resists a little.
- Reaching the bottom is finally walking around to its side of the table —
  and what you find stays unresolved.

Bonfires are therefore **centerpieces, never furniture**: at most one per
floor, never inside an encounter room, staged in its own quiet anchor
space. The bonfire is where your run's identity is forged; it must be
placed like it knows that.

---

## Build order (foundations first)

1. **Attention rule** — interactables dormant while in combat/aggro
   (fixes accidental mid-fight rests/trades immediately).
2. **Deal ceremonies** — price shown plainly on tap, hold-to-commit.
3. **Floor contract pass** — the v3 content budget (fight/question/glint)
   over the occupancy grid; floor cards as its surface.
4. **Bonfire centerpiece placement** + the reading scene (presence).
5. **Spread UI** — drawn + dealt cards, one screen; reversals as marks.
6. **Exit variety** — trapdoors first (blind drop + mark exposure).
7. **Minted death cards** — local first (your own dead), LLM epitaphs at
   Phase 5, world deck at Phase 4.
