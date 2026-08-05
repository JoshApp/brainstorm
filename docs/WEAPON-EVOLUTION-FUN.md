# Weapon evolution: finding the fun instead of the fiction

Written 2026-08-04, in answer to Josh:

> *"I want to make this game super fun but the weapon evolution is something we
> come up with without knowing what it will be — that's genuinely hard isn't it?
> How can we make this game's weapon evolution fun and not boring? I don't care
> about any fantasy and convention, I just want the game to feel fun to play,
> addictive to the right people."*

It is genuinely hard, and I think I can say exactly why it has felt like guessing.

---

## 1. Why it has felt like designing blind

`WEAPON-EVOLUTION.md` (written this morning) designs a *structure*: three lanes,
a ceiling, a data model, an audit. All of that is sound and the code shipped. But
it never names **the moment the player is supposed to enjoy.** It answers "how is
this balanced and authored" without answering "what is the thing you feel."

That is the same error DESIGN-METHOD §6 records — items designed flavour-first,
numbers attached afterward — just one level up. Structure-first has the identical
failure mode: it produces something defensible that nobody craves.

And there is a sharper problem hiding in the shipped S0. Look at what a scar
actually IS to play right now:

> You walk to a vendor, open a menu, read three rows, spend gold, close the menu.

That's a **purchase**. Nobody has ever been addicted to a purchase. The compulsion
in this genre never lives in the shop; the shop is where you spend the compulsion
you already have. So S0 built the plumbing correctly and aimed it at the least
interesting possible moment. That is the honest state of it.

---

## 2. What actually produces compulsion, and which of it we can have

Stripping the fiction, as asked — the mechanisms that make progression addictive
in this genre are few, and they are not interchangeable:

| Mechanism | Where it lives | Fits DELVE? |
|---|---|---|
| **Variable-ratio reward** (most drops are near-misses) | Diablo | Partly — we're too short a run for grind |
| **Undocumented combination discovery** | Isaac | **Yes.** The single strongest one available to us |
| **Immediate recontextualisation** (the change alters the very next fight) | Hades | **Yes.** Short rooms, fast loop, thumbs |
| **Irreversible commitment under pressure** | Nuclear Throne | **Yes.** Already our whole death economy |
| **Sacrifice of something owned** (loss aversion) | Souls' humanity, Isaac's deals | **Yes, and unused** |
| Grinding a bar to a threshold | Monster Hunter | No — session length is wrong |

The four "yes" rows have something in common: none of them happen in a menu.
All of them happen because you gave something up and found out what it did.

---

## 3. The moment to build for

Naming it, so everything downstream can be judged against it:

> **You drop a relic you actually like into the blade. The blade eats it. The
> next room plays differently because of it.**

That's the whole pitch. Read the compulsion mechanics off it:

- **Sacrifice of something owned.** You are not spending an abstract currency;
  you are giving up a thing you already have, can see, and chose earlier. Loss
  aversion does the work that a price tag never will.
- **Discovery.** What a given relic does to a given weapon is *not* a lookup you
  read in a tooltip. You find out. Some combinations are absurd. That is the
  Isaac drug and it is the one we are least equipped to fake with numbers.
- **Immediate recontextualisation.** The next room is thirty seconds away, and
  it plays differently. This is the part S0 gets right and the shop delivery gets
  wrong: the test has to be RIGHT THERE.
- **Accumulated identity.** By Depth 10 the weapon is literally made of the
  run's decisions. That is the thing worth screenshotting, and the thing the
  deep can comment on.

And it solves three of Josh's other complaints in the same stroke:

- **The choice basin** — *"takes your weapon and kinda gives you sometimes another
  weapon or vestment or nothing"* — is already 80% of this shape, aimed wrong. It
  is a slot machine that eats your weapon. Turn it around: it is the trough where
  the weapon eats. Same object, same fiction, inverted transaction.
- **Cursed offerings are boring and always the same** — because they're a static
  list of effects. As FOOD they're never the same twice: a cursed relic eaten by
  a hammer is not the same event as one eaten by a dagger.
- **Weapon drops become interesting again** — a blank blade isn't "worse than
  mine", it's *an empty stomach*, a chance to build a different eater.

---

## 4. What makes it NOT boring (the part that needs care)

The failure mode is obvious and I want it written down before anyone authors a
table: **if eating X always yields effect Y, this is a crafting recipe list and
it is dead on arrival.** Recipe lists get solved once, published, and then it's
shopping again.

Three rules to keep it alive:

1. **The result depends on the WEAPON, not just the food.** Blood-food in a
   dagger is not blood-food in a hammer. That squares the interesting surface
   without squaring the authoring: the weapon class supplies the verb, the food
   supplies the flavour.
2. **Some combinations are deliberately absurd.** Not balanced-absurd —
   *absurd*. One in fifteen should make a player say "wait, what?" and go tell
   someone. Those are the ones that get remembered, and the ceiling test exists
   precisely so a small number of them can be allowed to break it on purpose.
3. **You may never see the result before you commit.** The category, yes ("this
   will make it hungrier"). The exact outcome, no. The instant a preview exists,
   the sacrifice becomes arithmetic and the compulsion dies.

Rule 3 is in direct tension with the cost-chip work and the "state the cost
visibly" instinct that has been right everywhere else in this game. That tension
is real and it is the interesting decision here: **prices should be legible;
outcomes should not be.**

---

## 5. What to build first

Not the whole system. The smallest thing that can prove or kill the moment:

**One basin, one weapon, three foods, no menu.**

- The basin accepts a relic from your reliquary (walk up, choose, drop it in).
- The blade takes on something from it — a FORM change you can feel in the swing,
  not a damage number.
- The next room is a fight.

If that loop is compelling on a phone, everything else is content authoring. If
it isn't, we've spent a day, and no amount of taxonomy would have told us.

What I'd measure afterward isn't balance — it's whether Josh does it a second
time without being asked.

### What this does to the S0 scars

Nothing bad. The scar data model (a permanent per-weapon modification, in three
lanes, with a ceiling and an audit) is exactly the right substrate for this —
eating a relic *produces a scar*. What changes is the DELIVERY: the forge stays
as the boring, legible, always-available option, and the basin becomes the
interesting one. That is the same shape as keeping temper beside the scar offer,
one level up, and it's a shape that has been working.

---

## 6. The open question for Josh

The one decision I can't make: **does eating a relic consume it from the
reliquary permanently?**

- **Yes** — maximum loss aversion, real tension every time, and trinkets stop
  being a hoard. Risk: players hoard anyway and never feed the blade, because
  the reliquary is a visible number going up and the blade's growth is not.
- **No** (it copies the relic's nature) — no tension at all, and it becomes a
  free button you press whenever you have anything. I think this kills it.

I lean strongly yes. But that's the lever that decides whether this is a real
economy or a formality, and it's worth being deliberate about.

---

# Part II — wear or feed (2026-08-05)

Josh, thinking out loud, landed the spine this was missing. Recording it before
it gets paraphrased into something weaker.

> *"What if we make the game about finding things that are active on you — relics
> — and you can use these to feed, refine, craft your weapon. What if we make a
> system that also visibly alters the model. What if you can transform your sword
> if you feed it the Boiling King's relic — either adding effect or taking form.
> Like Isaac but with the weapon, where you actively decide which pieces to give
> up and which to have as trinkets on you."*

## 7. The spine: every relic is a fork

**Every relic you find can be WORN or FED.** That is the entire economy.

- **Worn** — it takes a slot and gives you its effect now. Swappable later.
- **Fed** — the effect is gone forever and the weapon changes permanently.

One decision, repeated all run, and hard every single time.

Why this is right and the earlier framing wasn't:

- **It answers Josh's own objection.** He said "limited active trinkets, but
  inventory management isn't the most fun thing" — and he's right, that's a
  spreadsheet. Wear-or-feed has *no bag to manage*. There are two doors and you
  pick one. The decision is the content.
- **Loss aversion does the work a price tag never could** (§3). You're not
  spending currency, you're giving up a thing you already have and can see.
- **It makes weapon DROPS interesting again.** A blank blade stops being "worse
  than mine" and becomes an empty stomach — a chance to build a different eater.
- **It's Isaac's devil-deal**, except recurring and authored by the player rather
  than offered by the game.

## 8. TAKING FORM is the thing only we can build

Feeding should be able to do two different sizes of thing:

- **ADD** — a scar (the shipped S0 data model): a stat or effect change, plus a
  small visible addition to the model.
- **TAKE FORM** — rarer and much bigger: the weapon *becomes* something. New
  silhouette, new name, a moveset trait. **Boss relics should always be this.**

The second one is the whole pitch, and it is worth being explicit about why it's
available to us and not to a normal team of this size:

**Our models are code-generated `ModelSpec`s with named slots and intent
anchors.** A weapon that grows the Boiling King's crown along its pommel is a
*spec transformation* — a part appended at a named anchor, a material swapped, a
silhouette re-proportioned. It is not an art request. The combinatorics that
would make this ludicrous to hand-author (Josh's word, and correct) are the exact
thing a spec transformation gets for free.

That is the "couldn't be done before" instinct, and it's real. The authoring
model in CLAUDE.md was built for this without knowing it.

## 9. Is this the Monster Hunter fantasy? Partly — and the difference matters

Monster Hunter is a **known target**: you can see the armour set, you farm the
monster, you get it. That's a completion loop, it's deeply satisfying, and it
needs session lengths and a persistent character we do not have.

What's described here is the opposite: **you don't know what you'll get, and the
run ends.** That's much closer to **Isaac's synergy discovery wearing a Souls
coat** — which is a better description of the game we're actually building, and a
more useful one, because it tells you what to optimise:

> **Optimise for surprise per run, not progress toward a goal.**

The MH *feeling* we want to keep is narrower and worth naming: **your weapon is
visibly made of what you killed.** Keep that. Drop the grind that normally
delivers it.

## 10. The authoring problem, and the thing to build FIRST

Josh:

> *"We have the ability to author content but it can suck, as we said yesterday,
> so we need like a baseline testing system that can mechanically simulate
> combinations and see what they do, as well as a ruleset to author fun things
> that aren't just catchphrases but actually fun."*

This is the correct instinct and it should be built **before a single new relic
is authored**. DESIGN-METHOD §6 already records that "make some cool relics"
reliably produces overpowered or boring ones; the fix is not to try harder.

`content/scars.ts` already has half of it — a ceiling audit that imports the real
`composeStrikeDamage` rather than re-inlining the math (DESIGN-METHOD §2). What's
missing is the **combination simulator**:

> For every (weapon class × food) pair, resolve the actual outcome through the
> REAL stat pipeline, and report the distribution: outliers above the ceiling,
> dead cells that change nothing, and pairs that collapse into each other.

Three things that report gives you that no amount of care gives you:

- **outliers** — the 11-damage dagger, caught before a player finds it
- **dead cells** — the boring ones, which are the actual enemy here
- **duplicates** — two foods that produce the same feel, i.e. wasted content

And it is what makes an LLM content layer *safe*: **the LLM proposes, the
simulator disposes.**

## 11. On the background LLM graph — a caution and a better shape

Josh:

> *"We could use the LLM layer to author content in the background and make a
> graph of interactions and combinations and evolutions the player can discover,
> while maybe it not being a crafting recipe."*

The caution: **a precomputed graph of combinations IS a recipe list**, just with
more nodes. §4 of this document already records why that's death — recipe lists
get solved once, published, and then it's shopping again. Precomputing it doesn't
change what it is.

What saves the idea is a rule already written down in §4.1: **the result depends
on the WEAPON, not just the food.** That turns the graph into a small matrix —

```
weapon class  ×  food domain  →  outcome
```

— which is a couple of dozen cells rather than a combinatorial explosion, is
auditable by the simulator above, and stays *unsolvable in practice* because a
player only ever sees a handful of cells per run.

So the division of labour, which also keeps CLAUDE.md's runtime-LLM line exactly
where it is:

| | Who | Why |
|---|---|---|
| **Mechanics** | deterministic matrix, audited by the simulator | fair play, offline, cacheable, no latency |
| **Form** (the spec transformation) | LLM, at build time | combinatorics no human should author |
| **Name + flavour** | LLM | it's the narration layer's actual job |

The LLM never decides a number. It decides what the thing *looks like* and what
it's *called* — which is where it's strongest and where determinism doesn't
matter.

## 12. The smallest thing that proves it

§5 said: one basin, one weapon, three foods, no menu. That still holds, with one
upgrade that raises the stakes usefully:

> **All three foods must visibly change the model.**

Not a stat line, not a buff icon. You feed the blade and the blade is different
when you look at it. If that lands on the phone, everything after is content
authoring. If it doesn't, no amount of taxonomy would have told us — and we'd
have found out for the price of a day.

---

## 13. DECIDED 2026-08-05: feeding consumes the relic

Josh: *"feeding a relic consumes it."* §6's open question is closed, and closed the
way the design wanted — without permanence there is no sacrifice, and without
sacrifice the basin is a free button you press whenever you have anything.

That settles the spine. What it opens is one real risk and three consequences that
now need answers.

### The risk it creates, named in §6 and still true

> Players hoard and never feed, because **the reliquary is a visible number going
> up and the blade's growth is not.**

Loss aversion cuts both ways. The same instinct that makes feeding feel weighty
makes players *not do it*. A relic economy where the optimal play is "keep
everything, feed nothing" is worse than no economy, because it looks like a
system and behaves like a shop you never enter.

Three mitigations, and I think we need all three:

1. **Make the blade's growth visible.** This is why "taking form" (§8) is
   load-bearing rather than decorative. If feeding *visibly changes the model*,
   growth becomes a thing you can see, and the two sides of the decision are
   finally comparable. A stat line loses to a number going up; a changed
   silhouette does not.
2. **Cap what you can WEAR.** With a hard slot limit, the relic you cannot equip
   is dead weight — and feeding it costs nothing you were using. That converts
   hoarding into feeding automatically, and it rescues Josh's own "limited active
   trinkets" idea, which failed on its own as inventory management but works
   perfectly as the *pressure* behind wear-or-feed.
3. **Keep the basin scarce.** A decision you meet twice a run is an event; one you
   meet at every vendor is a menu.

### Three questions the decision now forces

- **Is there a third door?** Wear / feed / — sell? Leaving a relic on the floor is
  currently the only other option, and it's unsatisfying. The merchant is the
  obvious third door, and it prices the decision in a currency you understand.
- **Does the weapon have a capacity?** If you can feed forever the blade becomes a
  god by depth 10. Options: a hard scar cap (per `WEAPON-EVOLUTION.md`), an
  escalating cost per feed, or — the interesting one — **the weapon has slots
  too**, so a late feed *replaces* an earlier one and you choose what to lose.
  That keeps the last feed of a run as tense as the first. Unresolved; my instinct
  is the slot version, but it is exactly the kind of idea that sounds better than
  it plays and should be simulated (#132) before it is authored.
- **What happens on death?** The weapon is lost, so everything fed is gone. That
  is correct for a roguelike and it's the Souls deal — but it means feeding must
  pay off *inside* the run. Which argues for feeding early and cheaply, and
  against a system that only blooms at depth 8.
