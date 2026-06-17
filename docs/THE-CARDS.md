# The Cards — DELVE's tarot mechanic

> Status: DESIGN CHARTER (decided in discussion 2026-06-17). The art identity is
> in docs/TAROT-CONCEPT.md; the world/voice framing in docs/THE-DUNGEON-NOTICES.md;
> the build-vs-progression thread in docs/HARBOR-AND-PROGRESSION.md. This doc is
> the MECHANICS: what cards are, what they do, and how they're built.

## Premise

The deck is the dungeon's, not yours. It deals you fate; you choose from what
it deals. Cards are how you build — power lives in the **Spread** (your hand of
fate), not a stat sheet.

## Major vs Minor

Borrowed from real tarot (22 Majors = archetypal/fate; 56 Minors = everyday,
suit-organized), bent for play:

- **Minor** — the *frequent drip*. Small, modular, stackable. You accumulate
  many. Source: the **bonfire level-up** draw. Mechanically: mostly numbers +
  tiny modifiers.
- **Major** — *rare and build-defining*. The capped **Spread (~5)** — dropping
  one to take another should hurt. Source: weighty moments (bosses, fallen-delver
  corpses, the fire, the clairvoyant). Mechanically: **verbs and rule-changers**
  (how you play), not just bigger numbers; may carry stats too.

**The repetition fix — two different numbers:**
- How many Majors you HOLD = small (cap ~5). The build tension.
- How many Majors EXIST = huge. The replayability. (A capped Spread drawn from a
  library of 100+ is the opposite of repetitive.) Everything below exists to make
  the library cheap to grow.

## Domains — the trio (not one rule)

Domain = colour = meaning (the art accent). For Majors, use all three patterns:
- **Single-anchor** (most) — deepen one archetype, so a build has real choices.
- **Domain-less "true Arcana"** (rarest) — build-agnostic capstones that crown
  any run (the real-tarot "Majors transcend suits").
- **Bridge** (a few) — belong to two domains; the hybrid-build / synergy enablers.

Domains (DARK → LIGHT): blood · bone · rot · greed · dawn · grace · valor · wonder.
Rule: a card carries **at most one accent colour**; the deck varies across cards,
never within one (atmosphere discipline).

## The keystone: ONE effect grammar, shared with items

**A card is DATA composed from the SAME effect vocabulary as items** — not its
own engine. DELVE already routes affixes + passives + relics + buffs through one
pipeline (`src/combat/modifiers.ts`, "effects/triggers/buffs flow through the same
pipeline regardless of source"). Cards are just a new **source** feeding it.

A card / item / (later) enemy ability = a bundle of:
- **passive modifiers** — `StatModifier[]` (the `modifiers.ts` vocabulary).
- **conditional modifiers** — modifiers gated by a predicate (below-hp-pct, …).
- **triggered effects** — `trigger → condition → action` (the affix `onHit`
  shape today; the composable-abilities timeline is the same grammar).

The **carrier** (item / card / ability) is a thin shell with carrier metadata:
- Item: slot, rarity, affix-rolls, 3D model, equip/unequip.
- Card: arcana, domain(s), Spread cap, art, fate-dealt.
- Ability: timeline, anchors.

**Shared by default; small carrier-only tail** (don't pre-design the gating —
gate a primitive only the day one genuinely can't cross over):
- Item-only: on-weapon-hit, while-in-offhand, set-bonus, equip triggers.
- Card-only: on-draw, **on-reverse** (the Reversal), while-in-Spread,
  **domain-count synergies** ("+X per Blood card" — the Balatro engine),
  floor/run-scope.
- Shared middle: on-kill, on-crit, on-hit, while-below-half-hp, +stat%, cleave,
  lifesteal, thorns, apply-buff…

Why: one vocabulary to LLM-author items, cards, AND abilities; effects
cross-pollinate; balance lives in one place. This is the "LLM-authored in layers"
thesis applied to mechanics.

## Three scopes of fate (Self / Floor / Run)

Tarot is fate at multiple ranges — use it at three, each a DIFFERENT KIND of
effect (not the same effect at a different duration):
- **Self** — your build (the Spread). You curate. → the bonfire draw.
- **Floor** — an omen: a *rule of this floor* changes. Dealt at the threshold.
- **Run** — a signature: the *global weather* of the descent. Drawn once.

Keep combat OFF the deck — tarot is the fate/meta layer; the fight stays crunchy
and direct. Tier the frequency so it's ritual, not wallpaper.

## The bonfire loop (Self scope — build this first)

- Cards **accrue UNCLAIMED on the descent** (a card-back docked at the screen edge:
  "fate waits"). You **claim at the fire**: rest → the reading.
- **Fate deals; you pick** — dealt 3, keep 1 (minors); 1-of-3 for the rare major.
- Framing is **identity, not stats**: "you become The Hound," not "+5 Might."
- Tiered sources keep cards from feeling equal: minors from the fire; majors from
  bosses / corpses / clairvoyant / sacrifice.

## LLM-authoring & discovered canon (staged)

Because effects are composed from a **bounded, balanced vocabulary**, an
LLM-authored card can't break the game — it "casts" from a constrained palette,
then is **frozen as data**. Path:
1. **Card grammar** (card = data over the effect vocabulary). ← building now
2. **Build-time LLM** authors more cards into the library (offline, safe).
3. **Runtime mint** — the dungeon invents one for you (same vocab → frozen data → cached).
4. **Shared canon** — a discovered *fate* propagates to the shared deck others can
   draw (rides the SpacetimeDB async layer; the dungeon "remembers"). Needs
   curation/moderation; rarity-gate minting so the library doesn't dilute.

## Open questions
- Do Majors get a domain, none, or a bridge — and the mix ratio?
- Reversed face: runtime shader over the upright art vs separate art.
- New StatModifier kinds the deck wants (loot%, gold%, on-X triggers as data,
  domain-count synergy) — grow the vocabulary as cards demand.

## Build status
- `src/content/cards.ts` — the grammar + starter effects for the 14 cards +
  `cardModifiers()` resolver (feeds `aggregateModifiers`). Held cards on the run
  (`SaveData.cards`). Triggers (onHit/onKill) are defined in the grammar; live
  event-wiring + the bonfire UI are the next increments.
