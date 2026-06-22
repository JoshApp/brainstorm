# DELVE — Identity & the Build Economy

> **STATUS: DIRECTION SET 2026-06-22.** This captures the design session
> that defined what DELVE *is* and how its builds work. The arcana card
> system (the tarot lane) is BUILT; the gear-arts and rite lanes are
> DESIGNED here and built per the order at the bottom. Companion to
> `THE-DUNGEON-NOTICES.md` (progression spine), `THE-CARDS.md` (card
> grammar), `VISUAL-LANGUAGE.md` (the look).

---

## 1. The gimmick

**Steel in your hand, fate in your cards, the deep keeping score.**

You are a *doomed delver* descending a living dungeon that wants you dead
and finds you funny. The fantasy is **mastery, identity, and defiance
against an indifferent cruel place** — not power-fantasy dominance. You
will die. But you went deeper than last time, you became a *specific kind
of dangerous* on the way down, and the deep remembers you.

Every decision below falls out of that line.

### The decided questions

- **Magical or mundane? → Mundane steel, magical fate.** You stay a
  grounded warrior — real weapons, real weight ("a blade that remembers
  heat," never "Staff of Fireball +3"). The *magic* is what the deep does
  to you: the tarot. You don't cast spells; you're **dealt a fate that
  warps what you are.** No wizards. A man the dungeon is turning into
  something.

- **How far does the transformation go? → It goes GROTESQUE, slowly.**
  (Decided 2026-06-22.) A deep blood/rot build genuinely *becomes* a
  gore-soaked, rot-wreathed thing — mechanics that rewrite how you play
  (can't heal except by killing, leave a blood-trail, erupt). This is the
  fantasy nothing else in the Souls space delivers, and the tarot is the
  delivery system. It's earned one pact at a time, on grounded steel.

- **Combat or puzzle? → Combat-first, untouchable.** The "puzzle" is
  *decisions under dread*: risk management (push on at low HP for the
  deeper fire, or bank?), the dungeon's bargains (which fountain, what
  cost?), and the build puzzle (which cards/arts/rites combo). Souls-
  puzzle, never literal puzzle rooms.

- **Slowmo mass-slaughter? → No.** Mowing down chaff is the
  Hades/Vampire-Survivors power fantasy and would kill the dread. Combat
  is deliberate and dangerous — *Sekiro in a crypt*, not Dynasty Warriors.
  The asymmetric bullet-time that exists stays *reactive* (the reward for
  a perfect deflect/dodge), a flash of mastery, never a constant mode.

- **Escalation? → Two arcs.** The RUN arc: descend, assemble a fate, see
  how deep it carries you — escalation in *threat and build depth*, not
  number-go-up. The META arc: "meta carries forward" — over many runs you
  unlock more of the deck, the world, and the deep's memory.

- **Meta / community? → The deep remembers.** Three layers, grimdark-
  restrained, on the SpacetimeDB substrate: (1) the deep remembers YOU
  (epitaphs, dead-count, debts, names persist; the voice keeps score);
  (2) sparse NPC threads that advance across runs (a delver you free or
  fail recurs; a carried quest-item unlocks the next beat); (3) the
  community as ten thousand delvers (bloodstains, messages, a shared tally
  of how deep anyone's reached). Alone, but never the only one.

---

## 2. The build economy — three lanes

The core design rule for builds: **each lane answers a DIFFERENT question,
so they complement instead of overlap.**

| Lane | Question | Excitement | Rhythm / acquisition |
| --- | --- | --- | --- |
| **Gear / weapons** | *How do I swing?* | your **verb** changes | per-pickup, swappable; found |
| **Tarot** | *What am I becoming?* | your **nature** + synergy combos | per-floor/act; dealt at fires; capped Spread |
| **Rites** | *What's my big move?* | the **payoff button** that morphs with your tarot | per-fight (Hunger meter); found, slotted |

The build sentence: **gear = how you fight, tarot = what you are, rites =
the moment you cash it in.** Three different verbs, no redundancy. (This
resolves the "card vs gear build-surface tension" left open in
`THE-DUNGEON-NOTICES.md`.)

### The modifier philosophy (the Hades-hammer lesson)

**Exciting modifiers change a VERB or trigger a SYNERGY. Boring ones
change a number.** The best systems all teach this:

- **Hades hammers** transform the *moveset* ("your attack cleaves in an
  arc"), not the stats. **Boons** are coherent *themes* per god — that's
  our **domains** (Blood is the Ares).
- **Isaac**: the magic is *synergy* — items combine into emergent wholes.
- **Slay the Spire**: relics define a build, the deck expresses it.
- **Dead Cells**: commit to a color and it scales.

DELVE leans every lane toward **verb-changes and synergy-triggers**, and
keeps pure stat-sticks as cheap *texture* (the common drops), never the
exciting ones.

---

## 3. The gear lane — Weapon Arts (the hammer model)

Weapons keep their common stat-affixes as texture, but the *exciting*
drops are **Weapon Arts** — moveset transforms that plug into the existing
combo machinery (combo steps, flurries, directional moves; see the combo
model). They change *how the weapon plays*:

- "Your finisher cleaves the whole arc."
- "Your dagger flurry is five hits, not three."
- "Your dodge becomes a lunging gore-strike that heals."

This is the Hades-hammer hit, in the lane that's currently flat (stat
affixes only). It complements tarot/rites because it's a different *kind*
of change — the verb, not the nature, not the active. **Status: DESIGNED,
not built.**

---

## 4. The tarot lane — fate (BUILT)

The passive transformation of *who you are*, dealt at fires (minors found
often; majors at the boss fire). Cards are DATA flowing through the one
`aggregateModifiers()` pipeline — see `content/cards.ts` + `THE-CARDS.md`.
Five verb-types:

- **PACT** — a boon with a cost (passive modifiers, often a tradeoff).
- **BRINK** — power that wakes when you're dying (HP-conditional).
- **PROC** — a power that fires in battle (on kill/crit → self fury; on
  hit → a hex on the struck enemy).
- **RESONANCE** — scales with the kin in your Spread (synergy). The combo
  engine: minors you accumulate feed your majors.
- **TRANSFORM** *(pending primitive)* — replace a mechanic (e.g. "you can
  only heal by killing"). The grotesque capstones need this; it's the next
  card-grammar increment.

Minors stay small/numeric (the breadth that feeds synergies); majors are
the verbs. Built: Pact/Brink/Proc/Resonance live; the reading screen
spells each effect out.

---

## 5. The rite lane — the active (DESIGNED)

The same DNA as Isaac's active-item slot — *a thing goes in the slot, you
press it, it does its thing* — but made **synergistic** so it's a build
*payoff*, not a found panic button. Three parts:

1. **Hunger** — a meter built by fighting (kills, aggression, deflects).
   Rites spend it. A rhythm, not a flat cooldown ("the deep feeds you, you
   feed it back") — the Hades "Call" model.
2. **Rites** — a found collectible with **1–2 equip slots**. Pried from
   corpses / altars / boss drops; distinct from cards (dealt) and gear
   (your tools). Collect many, slot a couple, **swap freely** — that's the
   mix-and-match.
3. **Domain-morph** — every rite reads your domain counts (reusing the
   `cardSynergyModifiers` resolver) and *changes* with your fate. Same
   button, escalating grotesqueness as your Spread commits. This is the
   "more synergistic than Isaac" — the rite is an expression of who you've
   become, not an isolated item.

Mobile: 1 thumb button + a charge ring, shown only when a rite is slotted;
a 2nd slot unlocks later. **Mix-and-match = loadout choice**, NOT
component-crafting (the Noita route — rejected as off-genre for combat-
first mobile).

---

## 6. The domains — the eight build identities

Each domain is a coherent archetype (the Hades-boon model). The
dark/light/numinous split *is* the magical/mundane axis: dark is what the
PLACE corrupts you into; light is what the DELVER carries against it;
wonder is the sublime weird.

| Domain | Class | Archetype | Feel |
| --- | --- | --- | --- |
| **Blood** | dark | aggression — lifesteal, fury-on-kill, risk | vampire / berserker |
| **Bone** | dark | endurance — poise, undeath, attrition | the unkillable |
| **Rot** | dark | decay — DoT, anti-heal, festering | plague-bringer |
| **Greed** | dark | scaling — hoarding, crit, economy | the collector (Balatro engine) |
| **Dawn** | light | precision — crit, the killing blow | duelist |
| **Grace** | light | protection — wards, healing, survival | the holy / shielded |
| **Valor** | light | defiance — finishers, brink power, last stands | the desperate hero |
| **Wonder** | numinous | the weird — mobility, rule-bending, gambles | wildcard |

Each major should make its domain *feel* like its archetype. **Bridge
cards** (two domains) are where the spice lives (The Martyr = Valor+Blood).

---

## 7. Blood — the first vertical slice (DRAFT)

*Aggression is currency; life is ammunition.* Grotesque arc: by the deep
end you're a gore-soaked thing that leaves a trail and erupts — you don't
survive fights, you feed on them. Drafted across all three lanes:

**Tarot (cards):**

| Card | Arc | Type | Effect |
| --- | --- | --- | --- |
| The Hound *(built)* | minor | — | +move/+action speed — run the prey down |
| The Tick *(new)* | minor | — | on kill: heal a sliver (feeds the kill-loop) |
| Red Thirst *(built)* | major | PACT | +25% lifesteal, +12% damage taken |
| The Feast *(built)* | major | PROC | on kill → a short fury (berserk) |
| Crimson Tide *(new)* | major | RESONANCE | per blood card: +lifesteal & +damage; you visibly redden |
| The Exsanguinated *(new)* | major | TRANSFORM | heal ONLY by killing; max HP bleeds down each floor, damage climbs as you empty — grotesque capstone |

**Gear — Sanguine Edge (weapon art):** hits leave a bleed; killing a
bleeding enemy refunds stamina. *(changes how the weapon plays)*

**Rite — Hemorrhage** (costs Hunger):
- *Base:* erupt — spend some of your own HP, blood-nova around you; the
  spill heals you per enemy caught. A risk→reward swing.
- *2+ blood cards:* the nova also inflicts **bleed** and leaves a **blood
  pool** you heal standing in.
- *4+ blood cards:* costs no HP (Hunger only) and the nova goes huge —
  you bleed power freely now.

The fantasy end to end: **your steel bleeds them, your nature feeds on the
blood, you erupt at the kill.**

Art prompts (crimson accent, ink/Mörk-Borg, grotesque):
- *The Tick* — "a swollen blood-tick the size of a fist clamped to a
  corpse's throat, gorged and glistening, the body beneath drained grey."
- *Crimson Tide* — "a delver waist-deep in a rising tide of blood, arms
  spread, drowning and exultant, the red climbing the walls."
- *The Exsanguinated* — "a gaunt figure hung open and bloodless, skin like
  dry parchment, still standing, still swinging, refusing to fall."

---

## 8. Build order

1. **The transform primitive** (tarot) — unlock The Exsanguinated and the
   other grotesque capstones. Small grammar increment on the card system.
2. **The rite system** — Hunger meter + 1 rite slot + a Rite data shape
   that reads domain counts (reuse `cardSynergyModifiers`). Ship Hemorrhage.
3. **Weapon Arts** — the hammer-model gear lane: an Art that transforms the
   combo machinery. Ship Sanguine Edge.
4. **Blood as the proven vertical slice** across all three lanes, then
   draft + build the other seven domains the same way.
