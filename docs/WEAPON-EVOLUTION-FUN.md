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
