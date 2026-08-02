# Power & Weapons — design proposal (DRAFT, for Josh)

Status: **proposal / discussion.** Nothing here is built. This captures the
design work behind two linked questions:

1. Fates + Trinkets + Vestments + (coming) Rites — is that too much, and how do
   we keep them from blurring into each other?
2. How do we make **variable weapon drops feel awesome** — instead of "I picked
   a weapon and I'll never swap unless the next one is strictly better"?

Decisions locked with Josh so far:
- **Keep all three passive systems** (fates, trinkets, vestments) — don't unify
  or cut. Give each a sharper, non-overlapping job.
- **Weapon variety → lean toward Dead Cells "colors,"** but do the design work
  first (this doc).

---

## Part 1 — The passive layer: three roles, not three copies

Today vestments, trinkets, and fates **all emit the same thing** — `StatModifier[]`
+ on-hit + set/conditional payloads (`content/cards.ts`, `player/reliquary.ts`,
the vestment slots). That sameness is the "too much" feeling: three collectors of
the same substance. The fix isn't to cut one — it's to give each a **distinct verb**
and then *enforce it by curating what each pool is allowed to roll.*

| System | Role | Verb | Rule for what it may grant |
|---|---|---|---|
| **Vestments** (2 chosen slots) | **DEFINE** | *shape how you play* | Behavioral / playstyle effects only — a movespeed cloak, a lifesteal mantle, a "crits chain" charm. Slot-limited → each is an identity choice. **No flat +stats.** |
| **Trinkets** (uncapped reliquary) | **AMPLIFY** | *stack what you already do* | Quantitative stackers — +damage, +crit%, bleed harder, +health. Small, additive, many. The Isaac-items accumulation layer. **No build-defining behaviors** (those are vestments). |
| **Fates** (cards, feed the Rite) | **PACT** | *gamble + power your active* | Boons-with-a-cost + the **combo fuel for your Rite** (rites already scale with matching-domain cards). The deliberate, rare, run-shaping tradeoffs. **Always carry a cost or condition** (that's what makes it a fate, not a trinket). |

So: **Vestments define, Trinkets amplify, Fates gamble + fuel the Rite.** Same three
systems Josh wants to keep — but now a player can answer "why would I take this
*here* and not there?" for each. Implementation is mostly **content curation**
(which affix/effect pools each source may roll) plus a one-line "role" tag on each
so the item card can say *AMPLIFY · trinket* / *DEFINE · vestment* / *PACT · fate*.

This also resolves backlog #81/#82 without merging the systems: fates and trinkets
stay distinct **classes**, but share the domain-binding collect beat and the domain
tag — they differ by *role* (pact vs amplify), not by being the same thing twice.

---

## Part 2 — Why weapon drops feel flat, and the three levers

The "won't swap unless it's strictly better" problem is **incumbency + flat
differentiation**: weapons differ mostly by numbers, your current one carries your
comfort, so a sidegrade reads as a downgrade. The games that solve this (Dead Cells,
Hades, Isaac) use three levers:

1. **Weapons are verbs, not stat sticks.** A drop excites when it *plays*
   differently — a whip that zones, a scythe that arcs, a dagger that flurries.
   DELVE has 8 classes (sword ×5, dagger, scythe, spear ×2, hammer, whip, crossbow,
   wand) — the lever is making each **moveset** distinct enough that you swap for the
   *playstyle*. This is the biggest and most durable win, independent of colors.
2. **Build-synergy beats raw base** — *the Dead Cells colors idea.* A "worse"
   weapon that fits your build out-performs a higher-base one that doesn't. This is
   what makes a *lower-damage drop* still a spike, which is the exact feeling Josh
   is missing.
3. **Modifiers on pickup** (Hades' Daedalus hammer / affixes) — a found weapon
   carries a roll that can transform it. DELVE already has the affix system.

Part 3 designs lever #2 for DELVE. Levers #1 and #3 are content/feel work we can
do alongside, no new system required.

---

## Part 3 — Weapon "colors," DELVE-native

### The problem with copying Dead Cells directly

Dead Cells' colors are **Brutality / Tactics / Survival**, and a weapon scales with
the color you **invest in at level-up**. That investment axis is the whole trick —
without an axis to invest in, "colors" are just damage types.

DELVE has two candidate axes:

- **Attributes** (`might / finesse / lore / grit`) — the literal Dead Cells mapping,
  and `WeaponScaling` already maps weapons to attributes. **But attribute investment
  rode the level system, which we just disabled (#102, banked as "souls" #100).** So
  Option A needs levels/souls back before it means anything.
- **Domain alignment** — how deep you are in each of the 9 domains (`blood bone rot
  ash / dawn grace valor / greed forbidden`), **emergent from the domain-tagged
  passives you already collect** (trinkets, fates, vestments are all domain-tagged).
  This axis is **alive right now**, needs no disabled system, and backlog #87 already
  wants to track it.

### Recommendation: **Option B — alignment-color.**

> A weapon has a **primary domain**. Its effective power scales with **your alignment
> in that domain** — the weight of domain-matched passives you carry.

Why this is the right fit for DELVE, not just a port:

- **It makes weapons synergize with the passive layer** — the "does this plug into
  MY build?" lever, which is exactly what turns a lower-base drop into a spike. A
  blood scythe when you're a blood build hits like a truck; the same scythe on an
  ash build is mediocre.
- **No disabled systems required.** Alignment is emergent from collection, which is
  live. (Attributes/souls can *layer in later* as a second axis when levels return —
  Option A and B aren't exclusive.)
- **It's thematically perfect for the fiction.** The deep's corruption powering the
  blade — "a blade that remembers heat" hits harder for someone the ash has claimed.
  Alignment-as-power *is* the grimdark premise.
- **It gives #87 alignment its first concrete mechanical use** and ties the whole
  economy together: your passives don't just stack numbers, they **tune which weapons
  are yours.**

### Sketch of the math (to argue about, not final)

```
alignment[d]      = Σ weight(passive) for passives tagged domain d   // 0..N, emergent
effectiveDamage   = base × (1 + K × alignmentTier(weapon.primaryDomain))
alignmentTier(d)  = bucket alignment[d] → 0 / 1 / 2 / 3   (none / touched / deep / consumed)
```

- `K` tuned so an **on-color** weapon at "deep" clearly beats an **off-color** weapon
  of one rarity higher — that's the whole point (a fitting drop is a real upgrade
  even at lower base).
- Off-color isn't *dead*, just flat — you can always swing anything; you just hit
  hardest with what your build feeds.
- Keep it **legible**: 4 tiers, not a continuous curve. The player should feel
  "I'm deep in blood" as a state, not read a percentage.

### The swap-compare card is where this pays off

The ground-equip compare I just shipped is the natural home: instead of only showing
Δdamage, it says the synergy out loud —

> **A bone scythe** — scales with **BONE** · you are **DEEP** in bone
> effective **18** vs your drawn **12**  ·  *and it sunders (you run 3 sunder trinkets)*

That line is what makes a drop feel awesome: not "+6 damage," but *"this is a
weapon for the delver you've become."*

---

## Open questions for Josh

1. **Alignment (Option B) as the first color axis — yes?** Or hold weapons flat until
   souls/levels return and do attribute-colors (Option A) then? (Recommendation: B
   now, A can layer later.)
2. **Granularity:** 9 domains is a lot of colors. Do weapons key off the **9 domains**,
   or the **3 poles** (corruption / virtue / vice) for a coarser, more legible
   "red/green/blue"? (Leaning: **3 poles** for the scaling color, domain for flavor —
   9 is too many to read at a glance, and poles map cleanly to a Dead-Cells-style trio.)
3. **Do off-color weapons get a floor** so early game (no alignment yet) isn't
   punishing, or is "everything is flat until you commit" the intended ramp?
4. **Moveset pass (lever #1):** worth a dedicated pass to make the 8 classes feel
   distinct to swing, independent of colors? (I think yes — it's the biggest win and
   needs no system.)

---

## Suggested phasing (once direction is picked)

- **P0 — role tags + curation (Part 1).** Cheap, high-clarity: tag each passive with
  DEFINE/AMPLIFY/PACT, curate the roll pools, surface the role on the card. Ships the
  "sharpen the three systems" win immediately.
- **P1 — alignment tracking.** Compute `alignment[pole]` from carried passives; show
  it in the character sheet (advances #87). No combat effect yet — just make it real
  and visible.
- **P2 — weapon color scaling.** Add `primaryDomain`/pole to weapons, wire
  `effectiveDamage`, tune `K`. Light up the compare card's synergy line.
- **P3 — moveset distinctiveness pass** (parallel, anytime): make each class feel
  different to swing.
