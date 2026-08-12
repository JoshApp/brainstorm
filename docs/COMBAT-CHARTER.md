# The Combat Charter — what makes a fight good here

**Status:** CHARTER (2026-08-12). The umbrella doc for combat feel, enemy
behaviour, attack animation, and the visual language that binds them. Sits above
`COMBAT-HIT-SYSTEM.md` (how a hit resolves), `MOVE-TIMELINE.md` (the player's
attack clock), `ENEMY-AI-V2.md` (the mob's mind), and `ENEMY-DESIGN.md` (the
roster's verbs). Those stay; this says what they're all in service of.

**The goal, in Josh's words (2026-08-12): simple enough for a thumb, deep enough
to get better at.** Every proposal below is judged against that one sentence.
Depth comes from *what the player must read and answer*, never from more buttons,
more numbers, or more health.

---

## 1. The diagnosis — three things measured, not felt

Design that starts from vibes produces vibes. These are the three structural
findings that this charter exists to fix. All three were measured against the
real code on 2026-08-12.

### Finding A — the player's attacks have one clock; the enemy's have two

`MOVE-TIMELINE.md` exists because the *player's* animation and hits used to run
on separate clocks and desynced (flurries dealt damage while the weapon played
one stab). It was fixed properly: one authored timeline, motion and hits read
from the same `t`.

**The enemy never got that fix.** A mob's ability is a step timeline in real
seconds (`windup` / `strike` / `recover`), while its animation is a normalized
clip time-stretched across `windup + strike + recover`. The two are pinned to
different things — clip keyframes to the TOTAL, damage to the STRIKE window — so
their alignment is a per-mob *accident* of the phase ratios. Measured drift
between the visible SNAP keyframe and the actual damage instant:

| mob | ability | verb | w/s/r | damage at | snap at | drift |
|---|---|---|---|---|---|---|
| ghoul | strike | ghoul-rake | 0.90/0.18/0.60 | 1.008s | 1.042s | **+34ms** |
| skeleton | slash | chop | 0.50/0.15/0.45 | 0.590s | 0.682s | **+92ms** |
| skirmisher | slash | thrust | 0.40/0.14/0.50 | 0.484s | 0.645s | **+161ms** |
| defiler | slash | sweep | 0.55/0.16/0.60 | 0.646s | 0.812s | **+166ms** |
| stoneguard | strike | pound | 1.40/0.22/1.00 | 1.532s | 1.729s | **+197ms** |
| skirmisher | charge | lunge | 0.55/0.42/0.75 | 0.802s | 1.066s | **+264ms** |

Every one is positive: **the damage always lands before the limb arrives.** On
the stoneguard you are hit roughly 200ms before the maul finishes coming down.
Nobody chose these numbers — they fall out of arithmetic, and retuning a mob's
windup silently moves its visual hit relative to its damage.

*(Caveat, stated honestly: on the `charge` row the visible snap is the arm
lunge, while the real contact is positional — a dash hits when it reaches you —
so 264ms overstates the felt error there. The structural point stands
everywhere: nothing binds the two clocks.)*

### Finding B — enemy attacks have no angular gate

The player→enemy hit model is genuinely good: swept capsules against
bone-following locational hurtbox zones (`COMBAT-HIT-SYSTEM.md`).

The enemy→player model is `if (distance <= action.reach)` — a flat XZ distance
test with **no facing check at all** (`mobs/enemy.ts`, the `melee` action). A mob
can hit you while you are standing *behind* it, as long as you are inside the
radius. Facing normally hides this because mobs track you — but a mob is
facing-locked during its strike, which is exactly when you dodged around it.

This is the single largest source of "that felt unfair," and it quietly deletes
half the dodge vocabulary: **dodging AWAY works, dodging AROUND does not.** Every
soulslike is built on the second one.

### Finding C — attacks don't travel

Only `dash` and `leap` move a mob's root. `melee` never does, and root motion is
not expressible in the clip format at all (the animator writes named joint slots,
never the container). So every ordinary swing is thrown from a standstill and one
backstep beats it. Logged as ROADMAP #141.

**These three compound.** Attacks that don't travel are beaten by backing up;
attacks with no angular gate punish going around; so the only reliable answer is
retreat, and fights collapse into backpedal-poke. Fixing one without the others
mostly moves the problem.

---

## 2. The five ideas

Few, named, load-bearing. Everything else is downstream of these.

### Idea 1 — ONE CLOCK. An attack is a single authored timeline.

Motion, damage, telegraph, root motion, sound, and VFX all read the same
normalized `t` from one `MoveSpec`. This is not tidiness; it is the precondition
for the other four. You cannot author "the step-in fires on the contact frame" if
the contact frame isn't an addressable point in a shared timeline.

The player already has this. **Extend the move timeline to mobs** and delete the
stretch-a-clip-over-three-phases path. The phases stop being three separate
durations and become named MARKS on one timeline:

```
  anticipate ──────── contact ─── settle
  0                  0.62         1.0
       ^tell opens        ^damage + ^snap pose + ^step-in + ^whoosh
```

Everything that must agree is authored at the same `t`, so it cannot drift. The
drift table in Finding A becomes structurally impossible rather than a thing to
periodically re-measure.

**Frame data becomes readable as data** — startup / active / recovery, and a
derived `punishWindow` the designer tunes directly. That is the fighting-game
discipline: the numbers that decide fairness are visible, not emergent.

### Idea 2 — THE CONTRACT OF THE TELL. Readable at three ranges, bound to what it predicts.

Every committed attack must be legible three ways, because in a dark
first-person game the player will be missing at least one at any moment:

| range | channel | must carry |
|---|---|---|
| far / peripheral | **silhouette** | the anticipation pose changes the SHAPE. Readable at 6m, in fog, unlit |
| mid | **colour** | white = you may meet this. red = get out of the way. Nothing else |
| any, even off-screen | **sound** | every committed attack has an audio onset with lead time |

Two hard rules:

- **The tell is bound to the thing it predicts.** Already the stated contract in
  `abilities.ts`; enforced today for ground rings (a self-anchored ring now
  follows a creeping caster — fixed 2026-08-12 for the bloat, which was painting
  its blast radius where it armed and then walking out of it).
- **Tell LENGTH is the difficulty knob — not damage, not health.** A harder enemy
  gets a shorter or more deceptive tell. It does not get a bigger number. This is
  the rule that keeps difficulty legible instead of spongy.

### Idea 3 — COMMITMENT IS THE CURRENCY, and it is symmetric.

The player already has a commitment arc (`swing-agency.ts`): you trade agency for
a swing, and get it back as the recovery decays. **Enemies need the mirror, made
explicit:** an attack a mob commits to is one it cannot cancel, and the visible
recovery IS the player's reward for reading it.

This is what makes a fight a conversation rather than a race. It also gives us
the one honest difficulty dial: how *much* a given enemy commits, and how long it
is open afterwards.

Corollary — **every attack must have a punish window, and it must be authored,
not accidental.** If an enemy has no recovery you can hit, it isn't hard, it's
just noise.

### Idea 4 — ATTACKS TRAVEL.

A motion track on the timeline (Idea 1), authored as data next to the verb, so
the content layer writes "this swing carries 0.8m of step-in between t0.55 and
t0.70" without touching AI code. The vocabulary, and what each teaches:

| pattern | shape | what the player learns |
|---|---|---|
| **step-in** | ~0.8m on the contact frame | one backstep is not an answer. **Default on baseline melee** |
| **coil-dash** | readable coil → 3-4m dash → long recovery | dodge *through*, punish the recovery |
| **advancing combo** | each swing steps | back up and you stay in range; go sideways |
| **hit-and-run** | strike, immediate backstep | take the trade or lose the opening |
| **retreating cast** | back off while committing | close the gap under fire |

**Trap:** root motion must go through `walkable.clampMoveInto` / nav exactly as
`dash` does, or mobs will phase through geometry.

### Idea 5 — SNEAKY IS FAIR WHEN THE INFORMATION WAS ACQUIRABLE.

The thing that separates *tense* from *cheap*. A stalker that strikes from the
dark is great. A stalker that strikes with no prior perceptible signal is a
random damage tax, and the player learns nothing from dying to it.

**The contract: no damage without a signal the player could have perceived,
early enough to act on.** Not a signal they *did* perceive — one that was
available. Attention is the skill being taught; memorisation is not.

Legitimate acquirable signals, all of which suit a torchlit first-person game
better than they'd suit Souls:

- **eyeshine at the lamp's edge** — the lamp is already our discovery instrument
- **a sound with directional lead** — a scrape, a breath, a shifting weight
- **a disturbed prop** — a cobweb tearing, dust falling, a rat fleeing
- **the pack going quiet** — absence as a tell

This is also what licenses the genuinely mean behaviours in `ENEMY-AI-V2.md`
Stage 3 (`flank` to your blind side, lurk at the light's edge). They're fair
*because* the game pays out a signal first. Build the signal layer and the
sneaky enemies stop being a fairness argument.

---

## 3. The visual language of combat

Extends `VISUAL-LANGUAGE.md` (dread-light: significant forms revealed by
coloured light out of black) into the fight itself. **Colour is meaning, and
combat colours are reserved.**

| signal | meaning | may be used for nothing else |
|---|---|---|
| **white flash** on a mob | deflectable — you may meet this | ✓ reserved |
| **red flash** on a mob | unblockable — move | ✓ reserved |
| **red ground ring** | a spatial AoE resolves inside this, filling = time left | ✓ reserved |
| **held pose** | the anticipation IS the telegraph | — |
| **rim glow** | ARCANE only (per the monster reveal taxonomy) | ✓ reserved |
| **gold** | a clash / TURNED — your read landed | ✓ reserved |

The discipline that makes this work: **if we spend white or red on decoration,
we have spent the player's ability to read a fight.** The same rule the lighting
doctrine already applies to god rays, applied to combat.

Two additions this charter proposes:

- **A "committed" silhouette pass.** During anticipation, the mob's outline is
  what carries the read at distance. Author anticipation poses for SILHOUETTE
  first, detail second — check them as black-on-grey, not lit.
- **Impact must be located.** The player-side hit already resolves *where* it
  landed (locational zones). The feedback should say so: a hit on an armoured
  zone reads differently from a hit on a weak point, without a damage number
  being the only signal.

---

## 4. The animation upgrade

Concrete, in dependency order.

1. **Mob move timeline (Idea 1).** Kills the drift table. Prerequisite for 2–4.
2. **Root motion track (Idea 4).** A curve on the timeline, nav-clamped.
3. **Additive layers.** Today an attack clip is an *override* that clobbers the
   joints it owns. Hurt reactions, breathing, and head-tracking should layer
   ADDITIVELY on top, so a mob that gets hit mid-swing visibly registers it
   without cancelling the swing. This is most of what "alive" reads as.
4. **Weapon-bone hitboxes for enemies.** The mirror of Finding B's fix: resolve an
   enemy strike against a swept volume on the striking limb, the way the player's
   swing already resolves. Then "it visibly missed" and "it missed" are the same
   statement. *This is the highest-value fairness fix in the document.*
5. **Anticipation authored for silhouette.** Bench-check attack poses in
   black-on-grey at range, not lit close-up.

**What NOT to do:** do not build a general animation blend-tree/state-machine
system. The clip + verb library is the right economy for a game whose enemies
read at 6m in fog. The upgrade is *binding it to the mechanics*, not making it
richer.

---

## 5. Enemy taxonomy — roles, not stat blocks

`ENEMY-DESIGN.md` already holds the rule that earns a mob its slot: **every
enemy teaches a different verb.** This charter adds the axis that makes a *pack*
composed rather than stacked — each enemy owns a RANGE BAND and a TEMPO, and a
good encounter mixes bands.

| role | band | tempo | commitment | the question it asks |
|---|---|---|---|---|
| **pressure** | close | fast | low | can you make space? |
| **anchor** | close | slow | very high | can you punish a big window? |
| **skirmisher** | mid | in-out | medium | can you catch it? |
| **zoner** | far | steady | low | can you cross the room? |
| **detonator** | closes, once | one-shot | total | can you use it? *(the bloat)* |
| **stalker** | dark | patient | high | are you paying attention? *(needs Idea 5)* |
| **swarm** | close | constant | none | can you manage a crowd? |

Two composition rules that fall out:

- **Never two anchors.** Two big-commitment enemies produce a fight with no
  rhythm, only waiting.
- **A zoner makes every other role better** by denying the safe ground they'd
  otherwise be fought from.

The existing pack attack-token system already does the Arkham thing (only N
attack at once). Roles are what make the *non-attacking* mobs interesting while
they wait.

---

## 6. The fairness contract

Short, and each line should be mechanically checkable rather than a sentiment.

1. **No damage without a prior perceptible signal.** (Idea 5)
2. **If it visibly missed, it missed.** (Finding B — needs limb hitboxes)
3. **What you see is when it hits.** (Finding A — needs one clock)
4. **Every attack has an authored punish window.** (Idea 3)
5. **Difficulty is tell length, not damage.** (Idea 2) — with the corollary this
   session already learned the hard way: *a fully-telegraphed attack may be the
   hardest hit in the game; it may not be an instant loss from full health.*
6. **A white flash is a promise.** Never flash deflectable on something the
   parry path can't actually turn. (Was violated by charges until 2026-08-12 —
   the flag existed and two downstream systems ignored it.)
7. **The player's death should be explicable in one sentence.** If we can't write
   it, the enemy is unfair.
8. **No two attacks in one enemy's moveset share an anticipation.** Reusing a
   verb ACROSS mobs is good economy; reusing it WITHIN a moveset means two
   different attacks look identical during the only window that matters.
   (From the combat-design literature — see `COMBAT-RESEARCH.md` §3.)

**Open, and probably a real problem: our WARNING is short (the window is fine).**
Checked against Sekiro's community-verified frame data: our active parry window
(`PARRY_WINDOW_S` 420ms) is already at the generous end of Sekiro's 200–500ms —
not the issue. The tight number is `FLASH_LEAD_S` at **300ms**, the reaction
budget between the white flash and the strike. Against a ~250ms human baseline
plus 50–100ms of touch/display latency, that leaves ~zero margin for a player who
wasn't already looking. Raising it toward 0.40 costs nothing mechanically (the
flash just appears earlier). Test on the phone. `COMBAT-RESEARCH.md` §1c.

**Worth stealing from Sekiro: anti-mash by SHRINKING the window, not locking it
out.** Sekiro narrows the deflect window per recent press (to as little as 4
frames) and restores it instantly on a successful deflect, rather than denying
input outright. We use a hard `DEFLECT.LOCKOUT_S` 0.40. The shrinking model
punishes panic without ever saying "no", and rewards one good read by
immediately forgiving the penalty.

---

## 7. Build order

Sequenced so each step is shippable and felt on the phone, and so nothing is
built twice.

| # | What | Why here |
|---|---|---|
| **1** | **Enemy limb hitboxes + angular gate** (Finding B) | The biggest fairness win in the doc, and it does NOT need the timeline rewrite. Standalone, immediately felt: dodging around an attack starts working |
| **2** | **Mob move timeline** (Idea 1) | The keystone. Everything below needs an addressable contact frame. Kills the drift table |
| **3** | **Root motion track + step-in as the melee default** (Idea 4, #141) | The fix for "they all stand still." Needs 2 |
| **4** | **Additive hit-reaction layer** | Cheap once 2 exists; buys most of the "alive" read |
| **5** | **The signal layer** (Idea 5) — eyeshine, sound leads, disturbed props — **then ONE stalker, end to end** | Promoted by the 2026-08-12 decision that stalkers may be mean: the permission and the signal ship together, or meanness is a damage tax. Prototype one enemy before any roster pass — this reads completely differently in the hand than on paper. Also unblocks ENEMY-AI-V2 Stage 3 |
| **6** | **Role pass over the roster** | Re-tag existing mobs to bands/tempos; fix packs that are all one band. Content, not code |

Steps 1 and 2 are the ones that change how the game feels. 3–6 are what make it
deep. Step 5 is the one most likely to need a second pass on feel, which is why
it's one enemy first and a roster later.

**Not now, deliberately:** a blend-tree animation system, per-enemy bespoke
movesets, a parry-everything Sekiro model (our deflect is one option among
several and should stay that way), and any difficulty knob that scales health.

---

## 8. Decisions

### A stalker MAY be mean — DECIDED (Josh, 2026-08-12)

Flanking to your blind side, lurking at the light's edge, waiting out your
attention: all allowed, and allowed to be genuinely nasty. This is the edge a
torchlit first-person game has over Souls, and we should take it.

**This makes the signal layer (Idea 5) load-bearing rather than a nicety, and
promotes it in the build order.** The permission and the contract are one
decision, not two: mean is licensed *by* the signal, so "mean enemies" and "no
damage without a prior perceptible signal" ship together or the first one is a
damage tax. A stalker whose ambush is unsignalled isn't difficult, it's a dice
roll the player can't learn from — and the tell for a stalker is exactly where
the craft is (eyeshine caught at the lamp's edge, a scrape behind you with real
directional lead, a rat bolting out of a corner).

Practical consequence: **prototype ONE stalker end-to-end before any roster
pass.** Meanness is the kind of thing that reads completely differently in the
hand than on paper, and it's cheaper to find the line with one enemy than with
four.

### No directional block — RECOMMENDED (open until Josh calls it)

Two things go by this name: a *facing-cone* block (Souls shield: hold, absorb
anything frontal) and a *stance-matched* block (For Honor / Mount & Blade: the
attack has a direction and you must match it). The second is an entire second
combat language, not a button.

The lean is **neither**, because a block is a SUSTAINED state and everything else
in our vocabulary is an INSTANT. Dodge and deflect both ask you to commit at a
moment and live with it; a block lets you sit in safety and wait, which is
directly opposed to the tempo Idea 3 is built on. Souls only makes it work by
bolting on stamina drain and guard-breaks — a lot of machinery bought to solve a
problem we don't currently have.

And on a phone there is no free sustained input: the right thumb already owns
look, tap-attack, and hold-to-charge.

**We already have the good half of directionality for free** — a deflect requires
`playerFacingThis`. You have to be looking at the thing to turn its blade. That
is the skill and the fairness content of a directional guard, with no extra
input and no waiting state.

If the "wall of shield" fantasy is wanted later, put it on a RELIC or a specific
weapon, so it's a build choice rather than a tempo tax on every fight.

### No hard lock-on — RECOMMENDED (open until Josh calls it)

The need ("switch from free to focused combat") is real; the usual mechanism is
the one to avoid. Every top complaint about WWM's lock-on is a variant of *"it
took my camera"* — unwanted auto-switching, re-locking with the setting off,
being unable to track enemies that move behind you.

That's worse for us than for them on three counts: we're **first-person** (the
camera IS the aim IS your awareness), we just decided **stalkers may be mean** —
so we're deliberately building enemies whose counterplay *is* looking around, and
a lock-on would remove the exact input they demand — and forced first-person
rotation carries a nausea risk third-person orbiting doesn't.

Build a ladder instead, none of which takes the camera: soft-lock aim assist
(✓ ranged already), **camera friction** (drag slows over a target — highest value
for touch, and it can only resist, never act), **target designation** (tap to
mark; attacks prefer it, HUD shows its poise, camera never moves — this is the
"focused" mode), and possibly an idle re-centre that yields instantly on touch.
Full reasoning in `COMBAT-RESEARCH.md` §1d.

### Still open

- **Do we want frame data surfaced to the player anywhere?** Souls hides it;
  fighting games expose it. Our codex could quietly teach it.
