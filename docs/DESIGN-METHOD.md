# How we design things (and why it kept going wrong)

Written 2026-08-04, out of a session where the same failure surfaced four
separate times in four separate systems. This is not a style guide. It is a
record of specific, diagnosed mistakes and the rules that came out of them, so
the next session doesn't rediscover them at the cost of another playtest.

The frame for everything below: **feel needs hands, math doesn't.** Whether a
swing lands heavy, whether a room reads from the doorway, whether the fire is
worth the detour — nobody has automated that and nobody will, because the thing
being measured is the player's attention. But *economies and power budgets are
arithmetic*, and they were being playtested by hand. That's the tangle worth
cutting first: spend the play sessions entirely on feel, and stop discovering
numeric answers with your thumbs.

---

## 1. The overpowered/boring diagonal

Every bad item this project has produced has been bad in one of exactly two
ways, and the two have a shape you can check before writing the numbers.

> **An effect is broken when its condition is under the player's control and
> its payoff is multiplicative. It's inert when its condition is outside the
> player's control and its payoff is additive.**

The good zone is the diagonal: conditions you control with additive payoffs, or
conditions you don't control with large ones.

The canonical case was the one-damage dagger hitting for eleven. Five bonuses —
full charge (×1.8), head zone (×1.2), overcharged release (×1.35), execute on a
staggered foe (×2.0), crit (×2.5) — each individually defensible, multiplying to
**×14.6** against a depth-1 population with one to four hit points. What made it
inevitable rather than unlucky is that *every one of those conditions is chosen
by the player*. Charge, aim high, release on the beat, wait for the stagger. So
they aren't situational bonuses at all; they're a checklist a competent player
completes every time, and "situational" was a fiction the design told itself.

The fix generalises past that one chain: **bonuses add, penalties multiply, crit
multiplies once** (`combat/damage-math.ts`). Each bonus now contributes a legible
slice of BASE — a head shot is always "+20% of base", not "+20% of whatever the
other four already compounded to" — and a sixth good idea costs a slice instead
of doubling the ceiling.

### Two questions to ask before liking a mechanic

1. **What does a second copy do?** If the answer is "nothing", it's unique by
   construction — say so in the data (`ItemSpec.unique`) rather than letting the
   drop table hand out a dud. If the answer is "twice as much, compounding", it's
   the ×14.6 bug waiting to happen.
2. **What does this let the player stop doing?** Most bad items die here. An item
   that removes a decision reads as powerful in a design document and feels like
   nothing in a run.

### Write the ceiling before the item

One line at the top of the content file — *no relic may more than double a
build's DPS; no single effect may exceed +40% of base* — and then an audit
asserts it. Constraints don't slow design down; they shrink the search space to
something you can have taste about.

---

## 2. Instrumentation that doesn't read the live system is worse than none

`scripts/balance.ts` printed a **MAX** column the entire time the eleven-damage
dagger existed, and it did not catch it — because the table re-inlined the
arithmetic (`w.dmg * HEAVY_MUL * HEAD_MUL * ...`) instead of calling
`composeStrikeDamage`. It was reporting a *model* of the game rather than the
game, and the model and the game had drifted.

That is worse than having no report, because it launders a guess as a
measurement. You look at the number, it seems fine, and you stop looking.

**The rule: every audit tool imports the real function.** When the real function
changes, the tool's numbers change with it or the tool is lying. `balance.ts`
now runs every cell through `composeStrikeDamage`; `hurtbox.ts` already exported
`ROLE_DEFAULT_MUL` for exactly this reason. Assume the same rot is elsewhere and
check before trusting a report you didn't just write.

### The same rot in a unit test: feeding it values the caller never sends

The vault step shipped with eleven passing tests and **never fired once in the
game**. Its guard rejected any move shorter than 0.35m, "so you have to be
walking into it, not brushing past" — but the caller passes *this frame's*
movement delta, which is speed × dt, about 0.056m at a walk. Every real call was
refused. Every test passed, because every test handed it a unit vector.

The test didn't fail to catch the bug; it **agreed with** it. Both the guard and
the test were written in one sitting from the same wrong idea of what the caller
sends, so they confirmed each other. Green.

**A unit test has to feed the values the real caller feeds.** If you can't say
what units and magnitude arrive at a function in production — per-frame or
per-second, normalised or scaled, fraction or count — you cannot write a
meaningful test for it, and the one you do write will encode your guess. Two
cheap habits: state the units in the parameter's doc comment (`~0.05m at a
walk`), and where a magnitude matters, put a real one in the test with the
arithmetic that produced it written next to it.

Same family as §4's stale constants: a number is meaningless without its units,
whether it's a config value or an argument.

---

## 3. A constraint about the final state must be checked against the final state

This one cost four separate bugs in one session, which is why it gets its own
rule.

- **The trove kept getting dressed.** It refused loot, and still came out with
  columns in front of its outer offerings, spikes between them and a crack
  across the middle — because decor, carve, the hazard modifier, the tilemap's
  own `^` tiles and *two* clutter passes that run on the finished spec were each
  answering a different question about the same room. Fixed by giving the room
  type ONE flag (`clean`) that all six read.
- **The elbow-room sweep did nothing.** First placement was before the two late
  clutter passes; it moved the number by 0.2%. Moved to genuinely last: 26.6% →
  0.0%.
- **A fire and a deal shared a room.** `floor-director.ts` states this as a HARD
  RULE and enforces it by excluding the fire's room from the deal's pool — which
  binds *the director* and nothing else. A floor's major beats come from several
  producers (the director, the floor plan's centrepiece, the manifest reconcile,
  a vault's own props), and each only knows about itself. 16 floors in 240 still
  had a bonfire and a basin in one chamber.
- **The early spark survived being cut.** There were two paths; removing one left
  the other quietly rewriting floor 1-2's first chest into a guaranteed relic.

The pattern is identical every time: a rule was expressed as an *intention* held
by one producer, when it is actually a *property of the finished floor*. If the
rule is "a room ends with at most one major beat", then check the room at the
end and cull. Intentions don't compose; final-state checks do.

---

## 4. Where the numbers went stale

`BLOOD_PRICE_HP` was a flat `4`, written when the player pool was 8 — "half your
health", with a comment saying so. The pool became 5 when the flask joined the
health budget, and nobody revisited it, so the cursed altar spent months charging
**four fifths of your total health** while its comment still said half.

**Any cost or reward denominated in another system's units is a fraction, not a
number.** `CONFIG.BLOOD_PRICE` is now a multiple of the live max HP and can't
drift again. Same class of error: `CONFIG.FLASK.HEAL_PER_CHARGE`'s comment still
says "of PLAYER_HP_MAX 8".

The tell that this had gone wrong was not a playtest — it was reading the comment
next to the constant and noticing it disagreed with the constant next to it.
That is a ten-second check nobody was running.

### The same constant, reused for the opposite question

`corridor-types.WIDEST_ROAMER_RADIUS` is 0.62 — deliberately padded above the
roster's real widest roamer (the stoneguard, 0.55). That padding is correct for
the question it was written for: *how wide must a corridor be so everything
fits.* Erring generous there costs a few centimetres of stone; erring tight
wedges a mob in a doorway.

Then the "crawl" — a doorway sized to pass the player but refuse the big
things — derived its maximum width from the same constant, because it was the
obvious one to reach for and it was even named correctly. But a crawl asks the
OPPOSITE question: *how narrow must this be so something is kept out.* Padding
is the safe error in one direction and the fatal error in the other. The
resulting band, 0.85–1.25m, excluded **nobody** — all 23 mobs walked through
it — while looking entirely reasonable in the source.

**A constant carries the direction its safety margin was chosen for.** Before
reusing one, ask which way its error falls, and whether that is still the safe
way in the new question. When it isn't, derive a fresh one from the data
(`WIDEST_ROAMER` is now read off `ENEMIES`), and note in both places why there
are two.

And the test that catches it is not the one asserting the numbers — those were
all self-consistent. It is the one asserting the **property**: at every width
across the band, the set of mobs that fit must be strictly smaller than the set
an ordinary door fits. Written that way, the bug fails immediately and the
message names the mob that walked through.

---

## 5. Simulation finds degeneracy, not fun

Worth being precise about what a tool can do here, because the temptation is to
hope for more.

It cannot find fun. It can absolutely find **degeneracy**, and degeneracy has
been most of what bites us.

The version worth building: a headless build sampler. Compose N random legal
loadouts, run the damage math and the enemy HP curve against them at each depth,
report the *distribution* of time-to-kill. You do not read the average. You read
the **tails**: the 99th-percentile build is where a broken interaction lives, and
the 1st percentile is where a dead item lives. **Any item that never moves either
tail is inert and should be cut or rewritten.**

That report would have caught six items doing literally nothing — every relic,
vestment and card carrying `action-speed-mult`, because nothing on the player
side ever read it. A tooltip promised faster attacks and the swing clock had
never heard of it.

Use simulation as a *filter*, never as a designer. It tells you what to go and
feel, and what not to bother feeling.

---

## 6. How to brief this collaboration

Observed across a long session, stated plainly because it's a stable split and
not a mood:

**Claude is good at diagnosis and bad at generation under uncertainty.** Find the
bug, measure the distribution, notice that one room in eight is empty, prove the
placement rule is violated on 16 of 240 floors — reliable. Invent an item that is
fun — unreliable, and unreliable in the specific direction of "obnoxiously
overpowered or boring", for two reasons worth naming:

1. Items get designed **flavour-first** — a good sentence, then numbers attached
   afterward. Numbers attached afterward have no relationship to anything.
   Role-first is the fix: *this floor needs something that makes crit builds care
   about attack speed*, then find the fiction.
2. **Claude never plays.** It can't feel a 0.65s plant or a 1.1m gap, so it
   optimises for what reads well in a diff — and what reads well in a diff is
   "interesting-sounding". Interesting-sounding effects are exactly the ones
   whose condition is player-controlled and whose payoff compounds. See §1.

So: **name the role and the constraint; Claude fills it and proves it doesn't
break.** "Something that rewards fighting at low health, capped at +30%" is a
brief that can be executed and verified. "Make some cool relics" is a brief where
you get six things that are overpowered or boring, repeatedly, because nothing in
that request lets the work check itself.

---

## The short version

- Bonuses add, penalties multiply, crit multiplies once.
- Player-controlled condition + multiplicative payoff = broken. Always.
- Every audit tool calls the real function; every unit test feeds the caller's real values.
- Check final-state rules against the final state.
- Costs in another system's units are fractions.
- A constant carries the direction its safety margin was chosen for; check that
  direction before reusing it, and assert the property, not the numbers.
- Simulate to find outliers, then go and feel the ones that survive.
- Brief a role and a ceiling, not a vibe.
