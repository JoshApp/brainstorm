# DELVE — Relics, Domains-as-Abstracts & the Acquisition Loop

> **STATUS: SLICE BUILT 2026-07-10 (autonomous session, for Josh's review).**
> Companion to `BUILD-ECONOMY.md` (the four lanes), `STATUS-EFFECTS.md` (the
> substrate), `THE-CARDS.md`. This doc holds the relic-lane spine + what's built
> + the two handoffs that need Josh's call.

---

## The premise (the whole game, restated)

**You collect things that didn't belong to you, but now they do — they become
you.** A relic is not a cursed object the dungeon made; it is *someone's
belonging*, and taking it takes on a piece of who they were becoming. You
accumulate others' things → they accrete into your identity → you die → your
belongings (and the identity they formed) become the world's → the next
delver (you, or a stranger) finds them and inherits a fragment. **The relic loop
and the death-card inheritance loop are the same loop, expressed as objects.**

Every relic therefore carries **provenance** — whose it was, how they ended.
That's not flavor; it's the reason picking one up is a moment.

---

## Domains are ABSTRACTS (content makes them concrete)

Decided 2026-07-10. A domain is no longer a bare enum tag with hard-coded
mechanics. It is a **stable abstract** — an identity — and the **content** is
what makes it concrete. `src/content/domains.ts` is the source of truth:

```
DomainSpec = { id, name, pole, verb-hint, fantasy (prose), register (colour /
               accent / art tokens), affinities (soft substrate palette) }
```

- **No mechanics live on a domain.** A relic/card/rite tags `domain: 'blood'`
  and carries its OWN effect, composed from the status substrate.
- **LLM-authorable.** The `fantasy` + `register` + `affinities` are everything
  the content/narration layers need to author on-theme — no per-domain code
  path. "Author a Blood relic from bleed/lifesteal/health-cost," not "edit the
  Blood mechanic."
- **Season/run-mutable.** Because mechanics live in content, the pool can rotate
  — a season re-authors Blood's expression, a run can twist it — while the
  identity holds. The engine never changes; the deck does.
- **`affinities` is the coherence leash.** A soft, OPEN palette (known substrate
  hooks autocomplete; new ones allowed — the `(string & {})` type). It keeps
  authored content *feeling* like the domain (and roughly in-band, because it's
  built from balance-railed primitives) without hard-coding what the domain
  DOES. **Defined, not locked.**

This is the CLAUDE.md authoring model exactly: code is an interface between
layers, legible as data.

---

## The texture mix (soup done right)

The "no trinket soup" rule is scoped to the **major/tarot tier** (identity —
those must be rules). The **relic lane is the opposite**: many, found,
uncapped-stacking. That lane is *where healthy soup belongs.* The principle:
**numeric ≠ stat-stick.** A numeric relic is texture, not filler, if it has any
of four hooks — it **stacks**, **belongs to a theme**, **touches a system**
(a condition/proc), or **feels great to acquire**. A flat `+3` with none of
those is a stat-stick; the same `+3` that stacks, reads Blood, and hits harder
on bleeding foes is doing four jobs.

Draw from: **RoR2** (stacking makes numerics thrilling), **Isaac** (acquisition
+ emergent synergy + visceral art), **Slay the Spire** (rarity gates weight),
**Hades** (theme makes a `+%` feel like identity), **Dead Cells** (commit-to-a-
colour scaling). AVOID Vampire Survivors / Brotato pure-number-spam — that soup
needs the auto-battler god fantasy DELVE rejects.

**Proposed drop mix (OPEN — Josh to pick):**

| Rarity | share | Role |
| --- | --- | --- |
| Common | ~55% | numeric texture — but domain-tagged + stacking |
| Uncommon | ~30% | conditional procs — the connective tissue |
| Rare / cursed | ~15% | build-shapers with a cost — the grotesque identity pieces |

Alternatives on the table: **65/25/10** (heavier RoR2 soup) or **45/35/20**
(leaner, StS-ish). *Not yet chosen — the current Blood set is authored but the
drop-rate curve isn't tuned to a ratio yet.*

---

## The acquisition moment (built)

The Zelda-dungeon *wonder* of finding an item, without the Zelda *gate*:

- **Notice** — relics are staged and revealed by the dread-light (an uncommon
  light means something is here), never vacuumed off a random cell.
- **A beat scaled by weight** — taking a relic reveals its **provenance**
  (the flavor line), tinted by its domain, and HELD longer the heavier the find.
  Common = a quick satisfying beat; cursed = a lingering reveal. *(Built:
  `ui/pickup-notification.ts` — reuses the non-blocking in-world toast, never
  interrupts a fight, never celebrates. The place doesn't cheer; it tells you
  what you now carry.)*
- **No gate** — you can always walk past. The choice and the beat are the point.

**Designed, not yet built:** a *hold-to-commit* on the rarest relics (the cursed
ones), so taking a rule-with-a-wound is a deliberate press, matching the deal
ceremonies. Left out for now — it's a feel change best tuned on the phone.

---

## What's BUILT (this session)

1. **Domain abstract registry** — `content/domains.ts`, all nine domains as
   abstracts, `art/cards.ts` aliases `Domain` from it (one source of truth).
2. **Blood relic set** — the first domain, authored as real `kind:'relic'`
   grotesque objects across the spectrum, composing the bleed substrate:
   - `gorged-tick` (mundane) — +1 damage; stacking fuel.
   - `weeping-splinter` (mundane) — hits apply bleed; stack for reliability.
   - `sanguine` (uncommon) — 15% lifesteal.
   - `clot-fetish` (rare) — a dying bleeder bleeds neighbours (**detonate**).
   - `crimson-leech` (rare) — a bleeding kill mends you (**feed** — loop closes).
   - `drowned-heart` (cursed) — 25% lifesteal for −2 max HP (a rule with a wound).

   The loop: **apply (splinter) → amplify (stack) → detonate (clot) → feed
   (leech)**, all accreting uncapped in the reliquary. Try it:
   `?scenario=blood-drinker`.
3. **RELIC_BUNDLE** — a shared grotesque-object drop model (cord-wrapped
   talisman, bone shard, branded crimson sigil). Placeholder until the 2.5D art.
   Bench: `delve bench model-relic-bundle --ortho`.
4. **The acquisition reveal** — provenance on pickup, domain-tinted, held by
   rarity.

---

## HANDOFF 1 — the 2.5D relic art pilot (needs Josh: fal credits + taste)

The charter's plan: relics are **2D AI illustrations shown as sprite billboards
in the world + a reliquary UI**, same FLUX pipeline as tarot, different
presentation (object-sprites, not cards). Two pieces remain:

- **Art generation.** The pipeline exists (`delve art card <id>` → FLUX → promote
  → bake). It has no `relic` subcommand yet. Cheapest path: add a `RELIC_ART`
  registry (prompt + accent + seed per relic, drawing on the domain's
  `register.artTokens` + the relic's provenance) and a `delve art relic <id>`
  path mirroring `card`. I did NOT run generation — it costs credits and needs
  your eye. Prompt seeds are ready to drop in from the flavor + artTokens (e.g.
  drowned-heart: *"a waterlogged human heart wrapped in sodden funeral cloth,
  still faintly beating, crimson, ink / Mörk Borg, grotesque"*).
- **Billboard presentation.** In-world 2D art today is a *swaying quad*
  (`card-drop.ts`); there's a real camera-facing sprite batch
  (`scene/sprite-batch.ts`) but it's VFX-only. The pilot needs a relic drop
  rendered as a true camera-facing billboard of the baked art, lamp-lit. Small,
  contained — but a real bit of rendering work, and worth doing *after* you've
  seen a generated relic image you like.

**Recommendation:** generate 3–4 Blood relic images first (cheap, fast), eyeball
them in the atelier (`/art.html`), and if the 2.5D-object look reads cool in the
PS1 world, then I build the billboard + reliquary-icon presentation against the
proven art.

---

## HANDOFF 2 — the legacy purge (needs Josh: it's destructive + judgment-heavy)

"Remove all the legacy loot and redesign" is real, but it's ~47 items and a lot
of taste calls, so I did NOT do it wholesale on my own. Current state:

- **Slots are already the target** (`weapon | offhand | vestment` + the reliquary
  + rites). The 9-slot paperdoll is already collapsed in *code*.
- **The legacy ITEM DATA still exists:** ~21 paperdoll items (`armor/helmet/
  gloves/boots`, routed into `vestment`) + ~26 jewelry (`ring/amulet`, routed
  into the reliquary). The blood-flavored jewelry is now converted to proper
  relics; the rest is untouched.

The redesign is judgment-heavy, not mechanical:
- **Paperdoll → vestment VERBS.** The charter says a vestment is a defensive
  *verb* ("a hide that bleeds when you do"), never `+armor`. The 21 paperdoll
  items need re-authoring into verbs, not re-tagging — a design pass per item.
- **Jewelry → domained relics.** The ~26 rings/amulets need a domain + a
  substrate-composed effect each (the way the blood set was done).

**Recommendation:** do it **domain by domain**, the way Blood was sliced —
author each domain's relic set (converting/retiring the legacy jewelry that fits
it), and re-author vestments as verbs alongside. That keeps every step
coherent and reviewable, and the legacy items retire as their replacements land
rather than in one big destructive delete. Tell me which domain is next (Bone?
Rot?) and I'll slice it the same way.

---

## Designed-not-built engine hooks (noted for later)

- **Conditioned trigger payoffs** — a `condition: { victimHasBuff }` on
  `TriggerSpec` so a relic can reward *bleeding*-kills specifically (not just any
  kill). Needs the `enemy:killed` event to carry the victim + a status snapshot
  (the entity is dying). The current Blood loop works without it (bleed-feed /
  bleed-chain are already wired as modifier kinds), so this is a refinement, not
  a blocker.
- **Domain-tint the RELIC_BUNDLE brand** by the relic's `register.color` (it's
  Blood-crimson for all relics right now).
- **Hold-to-commit** on cursed relic pickups (see acquisition moment).
