# Evolving weapons + the active lane — design, before any code

Status: **proposal, for Josh to pick from.** Nothing here is built. Written
2026-08-04 after Josh's steer:

> "not picking up things is good, but maybe we offer things to apply to the weapon"

Companion to `POWER-AND-WEAPONS.md` (which asks how a *drop* gets exciting; this
asks how the weapon *in your hand* gets a history), `BUILD-ECONOMY.md` (the
substrate), and `DESIGN-METHOD.md` (the rules this doc is trying to obey).

---

## 0. The brief, stated before any mechanic

Per DESIGN-METHOD §6 — name the role and the ceiling first, or you get six
things that are overpowered or boring.

**ROLE.** By Depth 10, the rusted sword you started with should be *yours* — and
you should be able to point at the three decisions that made it so.

**CEILING** (asserted by an audit, not hoped for):
- No weapon may exceed **+35% of its base DPS** from everything applied to it.
- **At most one modification per class** (three classes → three max). A weapon is
  a character, not a stat stack.
- A modification must change **how the weapon plays** or **what it costs you.**
  If its whole content is a number on the damage line, it does not ship.

**WHY IT EXISTS.** Weapon drops are currently disabled pending this. The reason
a drop feels flat is incumbency: your current weapon carries your comfort, so a
sidegrade reads as a downgrade. Giving the incumbent a *history* is what makes
the choice real in the other direction too — a drop is now "is this blank blade
better than my three scars?", which is exactly the tension the 2-slot carry cap
was built for.

---

## 1. What we are NOT doing

- **No materials, no reagents, no crafting bag.** That is a second inventory and
  a second economy, and Josh is right that the game is better for not asking you
  to hoard. Nothing you pick up exists only to be spent later.
- **No forging tree.** Monster Hunter's loop is a 40-hour loop. Ours is a 40-
  minute one.
- **No "the weapon levels up by use."** It rewards grinding, not deciding, and
  the decision is the thing we want.

The model is **choose-now**: you are *offered* something, on the spot, and you
take it or leave it. That is the shape DELVE already speaks — altars, basins,
the tithe, the blacksmith, the card reading. The system below adds no new
grammar; it adds a new *object* to that grammar.

---

## 2. SCARS — the mechanism

A weapon accumulates **scars**. A scar is a permanent modification to *that
weapon* (keyed by item id, like `state/weapon-temper.ts` already does), chosen
from an offer of two or three, that changes how it behaves.

Three classes, and the class is the ceiling's enforcement mechanism:

| Class | What it touches | Rule | Example |
|---|---|---|---|
| **EDGE** | what a hit *does* | a status or a condition, never a raw multiplier | *third strike in a chain opens a bleed* |
| **FORM** | what the swing *is* | must change a timing, a cone, or a reach — a real number in the weapon spec | *the heavy becomes a lunge: +40% reach, +30% windup* |
| **DEBT** | what holding it *costs* | strictly stronger than any EDGE or FORM, and takes something permanently | *it cannot be sheathed — your second weapon slot is dead while you carry it* |

**One scar per class, ever.** A second EDGE offer on a scarred weapon replaces
nothing — it isn't offered. This is DESIGN-METHOD §1's "what does a second copy
do?" answered in the data model rather than in a tooltip.

### Why DEBT is where the big numbers live

§1 again: *player-controlled condition + multiplicative payoff = broken.* An
EDGE scar's condition ("on the third strike") is player-controlled, so its payoff
must be a slice of base. A DEBT scar's condition is **not controllable** — you
pay it every second you carry the weapon, and you cannot switch it off — so it
is allowed to be large. That is the diagonal, and it is also the better fiction:
the blade that costs you something is the one worth a story.

Candidate debts, all of which the codebase can already express:
- max HP down while drawn (the health economy already treats the pool as scarce)
- the offhand slot goes dark (lamp/buckler — the light economy has teeth)
- the weapon cannot be sheathed or swapped
- it bleeds you on a miss, not on a hit (punishes flailing, rewards commitment)
- your flask heals for less while it is drawn

### Where scars are offered

No new placement system — three existing seams:

1. **The blacksmith** (`interactables/blacksmith.ts`). Today he tempers: +1 flat
   damage, five times. Keep that as the *cheap, boring, always-available* option
   — it is a fine floor — and add "he offers you three scars for the blade in
   your hand" as the expensive one. The shop already prices things.
2. **A floor event** — the quench font / the broken anvil. A staged centrepiece
   in the room-type system, priced through `content/transactions.ts` in blood or
   gold like every other bargain.
3. **Boss defeat.** The boss's ash, applied on the spot. This is the one that
   should feel like the run turning, and it is the natural home for DEBT.

### What this does to weapon drops

It un-disables them. A dropped weapon is a **blank**: full base, zero scars. The
swap-compare card (already shipped) grows one line —

> **a bone scythe** — blank · your drawn blade carries **3 scars**

— and the decision has teeth in both directions for the first time.

---

## 3. The active lane — rites (task #98)

Josh named this in the same breath, and it is the same problem from the other
end: **every rite currently is an AoE.** The effect vocabulary is `nova / cost /
heal / selfBuff`, so five rites read as one rite at five sizes. The data model is
right (`content/rites.ts` composes primitives; `combat/rites.ts` is a thin
executor with one handler per kind) — it is the *vocabulary* that is thin.

New kinds worth adding, each reusing a system that already exists so a rite stays
DATA and not executor code:

| Kind | What it does | Rides |
|---|---|---|
| `timestop` | the world's clock scales to ~0.15 for N seconds; the player doesn't | the slow-mo the death sequence already runs |
| `blink` | teleport to the aimed point within range | the dodge's `canDashOver` walkability probe — the same one the new vault step uses |
| `raise` | a corpse stands up and fights for you for N seconds | the mob spawner + `factions.ts` |
| `transmute` | nearby world objects convert — vases to loot, a spike trap disarmed | destructibles + drop tables |
| `mark` | brand one enemy; hits on it are amplified until it dies | the buff pipeline |
| `ward` | a ring enemies will not cross, briefly | hazard-field |

`timestop` and `blink` are the two that change how a fight is *played* rather
than how it ends, so they are the ones worth building first.

**Where the two systems touch, without merging:** a DEBT scar may **bind a rite
to the weapon** — the blade holds it, you cannot unslot it, and it fires cheaper.
One connection, load-bearing, not a web.

---

## 4. How this does not go OP or boring

This is the part the last few sessions say matters most, so it is specified, not
assumed.

**Written constraints, asserted in a test** (DESIGN-METHOD §1, "write the ceiling
before the item"): the +35% DPS cap and the one-per-class rule are unit tests
over the scar catalog, not comments.

**The audit calls the real function** (§2). `scripts/balance.ts` already routes
every cell through `composeStrikeDamage`; the scar table extends the same call,
never a re-inlined copy. A scar's contribution is a slice of BASE, composed by
the existing `bonuses add / penalties multiply / crit multiplies once` rule — so
a sixth good idea costs a slice instead of doubling the ceiling.

**A build sampler finds the degeneracy** (§5). Compose N legal (weapon × scars ×
passives) loadouts, run time-to-kill against the enemy HP curve at each depth,
read the **tails**, not the average. The 99th percentile is where a broken
interaction lives; the 1st is where a dead scar lives. **Any scar that moves
neither tail is inert and gets cut or rewritten** — which is the specific check
that would have caught the six items carrying `action-speed-mult` that nothing
read.

**Role-first authoring** (§6). Each scar is briefed before it is written — *this
one exists to make a slow weapon worth carrying into a crowd* — and the fiction
is found afterward. Flavour-first is how the numbers end up attached to nothing.

---

## 5. Build order

Each step is shippable and feelable on the phone alone.

- **S0 — the spine.** `content/scars.ts` (data) + `state/weapon-scars.ts`
  (per-weapon-id, serialized, mirroring `weapon-temper.ts`) + the ceiling tests.
  Three scars only, one per class, deliberately plain. No new UI: the blacksmith
  offers them through the choice UI that already exists.
- **S1 — feel.** The FORM lane properly: scars that move `coneHalfAngle`,
  `reachMul`, and the class timings, so a scarred weapon *swings* different.
  This is the step that either works or doesn't, and only Josh's thumbs can say.
- **S2 — the offer, staged.** The quench font as a floor event; the boss-ash
  offer. Placement through the room-type/centrepiece system.
- **S3 — weapon drops back on**, with the blank-vs-scarred compare line.
- **S4 — rites.** `timestop` and `blink` first; the rest as the vocabulary
  earns it.

---

## 6. What Josh has to decide (and only these)

1. **Scars-on-your-weapon, or Hades-style moveset mutations that reroll each
   run?** Scars persist with the weapon across a run and make it yours; Hades
   mutations are wilder but reset. (Leaning: scars — it matches the 2-slot
   carry cap and the "the deep keeps score" fiction.)
2. **Does DEBT ship in S0, or wait?** It is the most interesting lane and the
   most likely to be miserable on a phone. (Leaning: author one, gate it behind
   the boss offer so it lands as an event and not as a shop item.)
3. **Does the blacksmith keep plain temper?** (Leaning: yes — a cheap boring
   option makes the expensive interesting one read as a choice.)
4. **Rites: `timestop` first, or `blink`?** (Leaning: `blink` — it is
   traversal *and* defence, and it composes with what the dodge already knows.)
