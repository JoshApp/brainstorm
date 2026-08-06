# Movement — what DELVE has, and what its flutter jump might be

Written 2026-08-06, answering Josh:

> *"I found a super fun mechanic by accident, stemming out from our vaulting —
> when you hit the edge of an object, even if it's a pillar or something taller
> that you can't vault over, if you angle yourself correctly you can vault over
> the edge with a kinda hop… it's super nice to be able to chain these. It's like
> an unintentional mini game. I wonder what we can do with this — make it
> intentional, or make a movement mechanic out of it."*
>
> *"Is there something hidden there that makes the game more fun, like Yoshi's
> flutter jump? Can we find this game's flutter jump traversal? In Zelda it's
> spamming roll, in Dark Souls it's a normal sprint or also rolls. What about
> Terraria boots that work once you walk for a bit? I'm just throwing around
> ideas."*

**Nothing in this document is built.** It is the options laid out with a
recommendation, because this is a feel decision and feel decisions are yours.

---

## 1. What actually exists today

Worth pinning down before designing on top of it, because three of these are
easy to conflate and they are separate systems.

| | what it is | input | gates |
|---|---|---|---|
| **walk** | ordinary movement | left stick | — |
| **sprint** | ×1.55 speed (`CONFIG.SPRINT_MUL`) | HOLD the dodge button ≥180ms | none — no stamina cost today |
| **dodge** | lunge + 0.30s i-frames, 0.22s cooldown | TAP the dodge button | stamina; on empty it becomes a punishing STUMBLE, and chaining stumbles leaves you WINDED |
| **vault step** | walk *over* a knee-high obstacle instead of stopping | none — automatic on contact | **hard off** while dodging, mid-swing, or in combat |
| **dash-over** | a dodge clears a dashable obstacle if valid floor lies within 2.5m | as dodge | validated at dash start |

Two rules are load-bearing and everything below respects them:

- **THE DODGE ALWAYS WINS.** `player/vault-step.ts` states it directly: a
  traversal convenience must never eat a defensive input. In a game where the
  dodge is the entire defence, losing your i-frames to a helpful hop is a
  betrayal, not a bug.
- **Traversal is out-of-combat.** The vault step doesn't exist while a fight is
  on. That's the seam that lets movement tech get expressive without touching
  combat balance at all.

### The edge-vault, mechanically

It is not a bug in the sense of "broken". `vault-step.ts` probes a set of carry
distances (1.5 / 1.9 / 2.3m) and takes the first that lands on clear floor.
Approach a pillar dead-on and every probe lands inside it — refused. Approach at
an angle and the probe past the *corner* finds open floor, so the step fires and
you clear a thing you "shouldn't" be able to clear.

Which means the fun Josh found is real and already has three of the five
properties a great traversal tech needs.

---

## 2. What makes a flutter jump a flutter jump

Pulling the pattern out of the examples rather than copying any one of them:

1. **It extends a verb you already have.** Yoshi's flutter is the jump held
   longer. Zelda's roll-spam is the roll. Nobody learned a new button.
2. **It is input-expressive** — how much you get depends on how well you do it.
3. **It is always available.** No bar, no cooldown. That is what lets mastery
   compound instead of being rationed.
4. **It re-reads the level.** Gaps that looked impassable become passable, so
   the world changes meaning as you improve — the single biggest payoff.
5. **You find it by doing.** Nobody read about the flutter jump.

Score the edge-vault against that: it has **1** (it's the vault), **4** (tall
things become passable), **5** (Josh found it by accident), and partly **2**
(angle matters). It fails **3** — chaining is limited by the dodge's cooldown
and stamina — and it is completely illegible: nothing in the game suggests it
exists.

So the honest conclusion is: **DELVE's flutter jump is already in the build. It
is the edge-vault.** The design work is not inventing a mechanic, it is finishing
this one.

---

## 3. Four ways to finish it

### A. MOMENTUM — one hidden scalar (recommended)

A single value, 0→1, that:

- **builds** while you move without stopping — roughly 1.2–1.8s of unbroken
  travel to fill, Terraria-boots style;
- **grants speed** as it fills, so sprint stops being a button and becomes a
  consequence of having run;
- **is spent by a vault** — the more momentum, the further and higher the step
  carries, so a run-up clears things a standing step cannot;
- **resets** on taking damage, on attacking, and on stopping.

Why this one:

- It is Josh's own #147 phrasing made concrete: stride, vault and chain become
  one number instead of three systems.
- It satisfies **3** (always available, no resource) and sharpens **2** (holding
  momentum through a room means *choosing a line*).
- It satisfies **4** hard: a gap you cannot clear cold, you clear with a run-up.
  The dungeon re-reads.
- **It cannot touch combat.** Momentum resets on attack and on damage, so it can
  never compete with the dodge — the rule above holds by construction, not by a
  gate someone has to remember.
- It makes the polygon rooms' extra space *mean* something, which was Josh's own
  observation: *"polygon floors give us more space in some rooms that allows for
  different gameplay we couldn't do before."* Big room = run-up room.

Risks, stated plainly:

- **A hidden scalar with no tell is unlearnable.** It needs a diegetic read, and
  it must not be a meter — FOV creeping open, footstep cadence tightening, a low
  wind rising, the lamp streaming back. The player should feel fast before they
  know why.
- **Speed vs. mobs.** Momentum resets on damage, so anything that touches you
  stops you — that is the balance lever, and it wants checking on the phone
  rather than in a spreadsheet.
- **Build-up length is the whole feel.** Too long and it never triggers; too
  short and walking is just slow. This is a phone-test number, not a design
  number.

### B. ROLL-CHAINING (the Zelda answer)

Make the dodge cheap or free out of combat so it can be spammed as travel.

Simple, proven, one constant. But it makes the dodge button the *movement*
button, and that muddies exactly the read we have spent effort keeping clean:
tap = defence. It also gives nothing back for skill — a spam is a spam.

### C. WALL-JUMP

Highest ceiling, and the answer Josh floated. It needs level geometry designed
for it (facing walls at the right spacing), it reads badly in first person on a
phone (you cannot see your feet or the wall you just left), and it is a new verb
rather than an extension — fails **1**.

Worth revisiting **after** elevation lands (#137/#139), not before.

### D. LEGIBILITY ONLY

Don't add a mechanic. Just make the edge-vault findable: a cue on approach when
an angle *would* clear, a sound and a camera beat when it fires, and level
geometry that teaches it (a pillar you must corner-hop for an optional reward).

The cheapest real improvement, and it is **not exclusive with A** — it is the
first half of A regardless.

---

## 4. Recommendation

**D then A.** Legibility first, because a mechanic nobody knows about is worth
zero no matter how good it is, and because the work is the same work either way.
Then momentum, because it is the only option that unifies what already exists
instead of bolting on a fifth system.

Smallest slice worth building and feeling on the phone:

1. `momentum` as a pure module — build rate, decay, reset triggers, no rendering.
   Testable headlessly, tunable in `config.ts`.
2. Wire it to exactly TWO things: walk speed, and `vault-step`'s carry distance.
   Nothing else. If those two do not feel good together, the idea is wrong and
   nothing has been spent finding out.
3. One diegetic tell — FOV is the cheapest and the most legible.
4. Phone pass. Momentum is a feel mechanic and the only real test is a thumb.

**Open questions for Josh, which is why none of this is built:**

- Should momentum cost or interact with **stamina** at all, or stay completely
  free? (Free is my instinct — property **3** is what makes mastery compound,
  and DELVE already has one bar governing the dodge.)
- Should a **big** momentum vault be able to clear things a small one cannot, or
  only go *further*? Height changes what the level means much more than distance
  does.
- Does the **dodge button's hold-to-sprint** survive momentum, or does momentum
  replace it? Two ways to go fast is one too many.
