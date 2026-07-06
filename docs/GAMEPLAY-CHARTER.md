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
5. **Placement is authorship.** Meaningful things are STAGED, never
   scattered: a fallen delver sits with their back against a pillar at a
   dead end, facing what killed them — not dropped on a random open cell.
   Bonfires anchor their own quiet space. The content pass fills budgets,
   but anything the player is meant to FEEL claims an anchor (geometry it
   relates to) — the occupancy grid finds space; anchors give it meaning.

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

### One substance, distinct verbs

The card is a SINGLE kind of object. It is not boring that the same object
is your build, the floor's omen, a corpse's loot, and a stranger's ghost —
it is boring only if all of those *do the same thing*. They don't. What
changes per context is the **verb**:

- **Draw a major** (bonfire ceremony) → forge who you are.
- **Read a floor card** (dealt on entry) → an omen; the floor's contract.
- **Loot a corpse card** → inheritance from the dead.
- **Trade / be dealt one** → a deal with the deep.

Same deck, four verbs. The reuse is what makes the world cohere — the
dungeon deals the WORLD from the same deck it deals YOU. If each verb
*feels* distinct to do, the shared substance reads as one predator's hand,
not as filler.

### Two tiers: majors define you, minors furnish you

This is how we get Souls-weight and roguelike-accumulation at once without
one muddying the other.

- **Majors (Arcana) — FEW and HEAVY.** 2–3 a run. Drawn at bonfire
  ceremonies, dealt by the dungeon, or looted off the notable dead.
  Run-DEFINING, visible on the body/viewmodel, reversible into marks. A
  major changes **who you are** — playstyle, not numbers. Slots are scarce
  and sacred; this tier carries the terse-grimdark identity.
- **Minors (pips) — MANY and LIGHT.** Found, dealt, traded, looted;
  plentiful. Small effects — this is where the roguelike joy-of-stacking
  lives. A minor changes **what you have**, never who you are.
- **GUARDRAIL — a minor is never run-defining.** Identity vs inventory is
  the whole line. The moment a pip rewrites your playstyle it's a
  mis-tiered major and you're back in trinket soup. Hold the line and you
  can be as generous with minors as the dopamine wants.

**Three concrete majors** (so "a major" is not abstract):

- **The Glutton** — you heal only by feeding: a close kill restores health;
  fountains and flasks do nothing for you. An aggressive lifesteal
  identity. *Reversed (The Fed Upon):* the hunger turns on you — health
  drains whenever you are NOT killing.
- **The Second Face** — the first blow that would kill you instead leaves
  you at 1 health — and Marks you (reverses a random card). You know it
  saves you once and that it will cost you a reversal; you don't know which
  card turns. The survivor who is slowly corrupted by cheating death.
- **The Long Dark** — douse your lamp and your strikes grow stronger the
  less light you carry — but the dungeon's dormant things wake in the dark.
  A darkness build that trades the baseline lamp for power. *Reversed:* the
  dark clings; you can't fully relight, and everything sees you as if lit.

(Minors, for contrast, are pip-scale: *The Two of Knives* — crits bleed;
*The Ember* — torches you pass relight brighter. Nice, not defining.)

### The gamble law: unpredictable outcome, legible stakes

Cards give AND take, and some ROLL — that is metamorphosis, not a power-up,
and it fits "you get stranger, never safe." But it must not break the
mortality pillar (*no random deaths — you die to things you understand*).
So the law:

> **You always know the AXIS and that you are rolling on it. You never know
> the exact point it lands. Whatever lands, you understand in hindsight.**

You flip knowing "this is somewhere between a boon and a wound on *this*
axis." The roll surprises you; the *decision to roll* was fully informed —
Souls-legal. **Banned:** a hidden downside with no tell. Predictable
stakes, unpredictable roll.

Three faces of the same object fall out of this:

- **Chosen** — a blessing with a stated drawback (you see both).
- **Rolled** — you see the axis, not the point (the gamble).
- **Dealt reversed** — the dungeon picks the bad end for you (the mark).

### Marks = reversals

The dungeon transforms you without consent by REVERSING a card — same art
inverted, the cruel mirror of the blessing. Every card ships with two
faces. Marks are bargains you didn't sign but always **earned by chosen
exposure** (blind trapdoors, surviving what should have killed you,
desecration, lingering too deep) — so the causal link is always legible in
hindsight, never a random slap. They are FEW (2–3 a run is a lot), named,
terse, visible on the body/viewmodel, narrated once.

### The floor is dealt

Entering a floor, the voice flips its card — *The Toll, The Nest, The Long
Dark* — and that card IS the floor's contract (encounter shape, question,
mood-light palette) and can carry MODIFIERS (the dark hungrier, the torches
fewer, the dead restless). Floor intent, content budget, and narration
share one vocabulary. The floor card doubles as the **resume screen**: on a
phone you close the app mid-descent, reopen to *"Depth 4. The Nest. You are
hunted,"* and you are instantly back in it.

### Death mints your card — and it comes back (the thesis)

This is the one thing no other crawler has, and it is the point of the
whole deck. Everything above is a well-made game; THIS is DELVE.

- **Your meta-progression IS your own death log.** Not a skill tree — a
  growing personal deck of your own dead. You get stronger by dying
  *interestingly*; your past selves become the resources your future selves
  draw. Death stops being punishment and becomes **authorship**.
- **Selective minting.** A run that earned remembering becomes a card —
  name, depth, cause, build essence, epitaph. NOT every death mints
  (criteria TBD — new-depth runs, boss kills, interesting deaths); scarcity
  keeps them precious.
- **Single-player FIRST (no backend, buildable now).** Your own dead
  circulate in your own runs: find your Depth-12 glass-cannon corpse on
  Depth 8, loot her card, inherit a fragment of that build. This IS the
  world deck, single-player — the marketable hook proven with zero backend
  and templated epitaphs (LLM epitaphs upgrade it at Phase 5, don't gate
  it).
- **Phase 4 = swap the pool, not the system.** "My dead" becomes
  "everyone's dead." Same inheritance loop, bigger deck. Their bloodstain
  glows when you pass where they fell.
- **The ambitious end (the sentence that gets posted):** the dungeon deals
  your death BACK as a phantom — your best run becomes a boss a future you,
  or a stranger, has to fight. FromSoft's red-invader dread, async and
  card-framed.

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

**Note on order vs. thesis.** Steps 1–6 are what makes DELVE a *good
crawler*; step 7 (the local death→card→inheritance loop) is what makes it
DELVE. It builds last because it needs the loop beneath it — but it is the
*reason* the earlier steps exist, not a nice-to-have tacked on the end. The
Phase 1 north star is a full run that ends in your death becoming a card
you can re-encounter, single-player, no LLM, no backend.
