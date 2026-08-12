# Combat research — what other games do, and what survives our constraints

**Status:** RESEARCH (2026-08-12). Requested by Josh after playing *Where Winds
Meet*. Companion to `COMBAT-CHARTER.md` — the charter says what we're building
toward; this is the evidence and the comparison behind it.

**The filter every idea below is run through:** DELVE is **first-person**, on a
**phone**, with **two thumbs**. That is a much harder constraint than it looks,
and it kills a lot of good ideas for reasons that have nothing to do with
whether they're good.

---

## 1. What *Where Winds Meet* actually has

An open-world wuxia action RPG (Everstone/NetEase) with a genuinely large combat
surface. The inventory:

### Defensive options — FOUR distinct ones

| option | input | what it does |
|---|---|---|
| **Block** | hold | absorbs, drains Qi. Some attacks ignore it |
| **Deflection (parry)** | separate button | perfectly-timed; negates damage AND drains enemy Qi |
| **Dodge** | directional dash | i-frames; Perfect Dodge triggers time dilation |
| **Assist Deflection** | automatic prompt | slows time + QTE prompt. Costs Insight Points |

The important structural detail: **block and deflect are separate buttons**, not
"block early = block, block late = parry" as in Souls. That is a deliberate
choice to make the parry a *distinct commitment* rather than a lucky block.

### Attack grammar — colour-coded, and the colours mean OPPOSITE things

- **Red glint** → can *only* be deflected. Parrying it triggers a devastating
  counter and big stagger damage.
- **Golden/yellow glint** → cannot be blocked or deflected at all. **Dodge only.**

The tell is a *glint that brightens*, and the guidance is to parry at peak
brightness — i.e. the telegraph encodes both "what kind" and "when."

### Resources — three bars

1. **Health**
2. **Qi** — the unified defensive/offensive stamina: block, dodge, and attacks
   all draw from it
3. **Insight** — a separate, slowly-regenerating pool that only pays for Assist
   Deflection

### Posture → Exhausted → Execute

Deflecting drains the enemy's Qi bar. Empty it and the enemy enters an
**Exhausted** state, opening an **Execute** for heavy bonus damage. This is
Sekiro's posture loop, near-identical.

### Breadth

- **7 weapon types** at launch (swords, dual blades, spears, rope darts, fans,
  umbrellas, blades, gauntlets…), **two weapons equipped at once** with in-combat
  swapping.
- **7 Martial Arts Paths × 2 weapons = 14 movesets.** Two different fan schools
  (one ranged, one healing/support).
- Three skill layers: **Martial Arts** (active weapon techniques), **Inner Ways**
  (passive stat/skill modifiers), **Mystic Skills** (4 active slots, utility +
  mobility + parry assists).
- **12 distinct combat inputs** on keyboard/controller.

---

## 1b. How WWM does all that ON MOBILE — and why we can't copy it

Josh's follow-up, and the most useful question in the pass: the PC scheme has
**12 combat inputs**. What happens on a phone?

**Answer: they don't collapse it. They ship the buttons.**

- **Left thumb** — movement joystick.
- **Right thumb** — camera drag *plus* the action buttons, laid over it.
- Combat gets **dedicated on-screen buttons**, roughly: light attack, block,
  deflect, dodge, martial-arts skill, up to 4 mystic skills, weapon swap,
  execute/interact.
- **Deflect stays its own button.** It is a separate input from block on PC and
  controller, and mobile keeps that split — it did *not* get merged into a
  timed block, which would have been the obvious simplification.
- Buttons are **resizable and re-transparency-able**, and the layout is
  *partially* rearrangeable — full customisation was still "coming in a future
  update" at launch.
- **Assist Deflection is ON by default** for new mobile characters.

The recommended priority hierarchy from every mobile guide is consistent, and
it's a useful ranking in its own right:

> **1. Dodge** — biggest, closest to the thumb. **2. Deflect.** **3. Main skill.**
> **4. Secondary skills.** **5. Menus.**

Dodge first, unanimously. "On touch, dodge is the most important button to make
reliable — missing dodge inputs makes everything else feel worse."

### The two reasons this doesn't transfer to us

**① They're third-person; we're first-person.** In WWM the right thumb drags a
camera *around a character you can see*. Camera precision is comfortable — you're
framing a fight, not aiming. In DELVE the right thumb **is the aim**: it's the
look-drag, the tap-to-attack, and the hold-to-charge. Every button we put in the
right thumb arc costs us aiming surface in a way it doesn't cost them. This is
the real asymmetry, and it's why "just add more buttons" is a worse trade for us
than for them.

**② The honest read of their solution is "more buttons + customisation +
assists."** That's a legitimate answer when you have a live-service UI team and
can ship layout customisation as a follow-up patch. It is not elegance we can
borrow; it's headcount. And notably, the reviews say the **default layout
doesn't fit most hands** and you have to fix it yourself before combat feels
right — which is a real cost, not a solved problem.

### What DOES transfer

1. **Dodge is the button that must be reliable.** Universal across every mobile
   guide. Ours is bottom-right at 74px and doubles as sprint on hold — the same
   shape Genshin uses. This is corroboration that we got it right, and an
   argument for **not** crowding that corner with anything else.
2. **Assist Deflection, default-on.** Their answer to "parry is harder on
   touch." See §4①.
3. **Button size/transparency as a real setting.** Cheap, and reviewers treat it
   as the difference between the game feeling bad and feeling fine. We have a
   controls settings tab already.
4. **The priority ranking itself** — dodge > deflect > main > secondary — is a
   good sanity check on any HUD we build.

### Honest limits of this section

No source I found publishes a definitive default-layout diagram or an exact
on-screen button count. The list above is assembled from several mobile guides
that agree with each other on structure and priority but none of which enumerate
the layout precisely. Treat the button list as "approximately this," not gospel.
The *hierarchy* claim (dodge first) is well-corroborated; the exact inventory is
not.

---

## 2. The comparison that actually matters

Every one of these games is deep. They buy their depth in completely different
currencies, and the currency is the design decision.

| game | defensive currency | # combat verbs | where depth comes from |
|---|---|---|---|
| **Dark Souls** | stamina + i-frames | ~7 | spacing, stamina budgeting, commitment |
| **Sekiro** | **posture** (deflect *is* offence) | ~6 | ONE axis, mastered deeply. Rhythm |
| **Monster Hunter** | positioning + commitment | ~8 | reading long, unique anticipations |
| **Where Winds Meet** | Qi + 4 defensive options | **12** | **breadth** — options × weapons × schools |
| **DELVE today** | stamina + i-frames + deflect | ~6 | spacing + timing |

**The headline:** WWM buys depth with **breadth**. Sekiro buys it with **one
axis taken very deep**. Both work. Only one of them is available to us.

We cannot afford breadth. Twelve inputs needs a controller; we have two thumbs,
one of which is also the camera. **So DELVE should be Sekiro-shaped, not
WWM-shaped** — a small number of verbs with a high skill ceiling, not a large
number of options.

That is not a consolation prize. Sekiro is the most respected combat system of
the five, and it has the *fewest* verbs.

---

## 3. The theory backbone — and a number we can actually use

From GDKeys' "Anatomy of an Attack," which formalises what Monster Hunter does
by instinct. Every attack is three phases:

**Anticipation → Attack (active) → Recovery**

This maps exactly onto our `windup / strike / recover`, which is reassuring —
our vocabulary is already the standard one.

### The anticipation formula

> **Anticipation time = player reaction time + player ability trigger time + difficulty buffer**
>
> Base human reaction: **~0.25s**

**This is the most directly actionable finding in the whole research pass**,
because it converts "does this feel fair" into arithmetic.

**Applied to DELVE, we are cutting it too fine.** Our `FLASH_LEAD_S` is **0.30s**.
Against a 0.25s baseline that leaves **50ms of margin** — and that baseline is a
*PC* number. On a phone you must also pay:

- touch input latency (~50–100ms on many Android devices)
- display latency
- the fact that a first-person player may be *looking somewhere else*

**A defensible reading: our effective mobile reaction budget is ~0.35–0.40s, and
`FLASH_LEAD_S` at 0.30 is under it.** That would mean the deflect currently
*feels* twitchy for reasons that are arithmetic, not skill. Worth testing on the
phone before tuning — but it's a real, checkable hypothesis rather than a vibe.

### Other principles worth adopting

- **"Each anticipation must be unique and drastically different."** Within a
  single enemy's moveset, no two attacks may share an anticipation pose. Our
  shared verb library (chop/thrust/sweep/pound/lunge/cast) is good economy
  *across* mobs but must not be reused *within* one mob's moveset — otherwise
  two different attacks look identical during the only window that matters.
- **Anticipation length scales with payoff.** Big attack → long tell. This is
  the charter's "tell length is the difficulty knob" arriving from the other
  direction.
- **Recovery IS the reward.** "Window of Opportunity" — the charter's authored
  punish window, same idea.
- **Active frames should be short and unambiguous**, with the dangerous part
  visually distinguished (weapon trails).

---

## 4. What we should STEAL from Where Winds Meet

Five things, ordered by value-per-effort for us.

### ① Assist Deflection — the mobile accessibility layer *(highest value)*

Time slows, a prompt appears, limited uses from a dedicated bar, **on by default
on mobile**. This is WWM's explicit answer to "parrying is harder on a
touchscreen," which is *exactly* our problem.

**And we already own the machinery.** We have asymmetric bullet-time
(`reactive-defense.ts` — world slows, player doesn't) and a deflect opportunity
system that already knows when a parryable attack is incoming. The pieces are
there; what's missing is the *resource* and the *default-on* framing.

The design caution: it must be a **limited, visible resource**, not a global
difficulty setting. A limited pool teaches timing (you spend it on the attack
you couldn't read, and the pool running low pushes you to learn). A permanent
slow just makes the game slower.

### ② Combos designed so ONE answer can't cover them

WWM: you can parry the first few hits of a combo, but some sequences bring the
next attack before your parry recovery finishes — so you must *mix* parry,
dodge, and block mid-combo.

This is the cheapest depth in the entire research pass for us. Our abilities are
already multi-step timelines with `{at}` and `{after}` triggers. **Authoring a
combo whose third step outpaces the parry recovery costs one data change and no
new systems**, and it instantly makes a fight a conversation instead of a single
repeated answer.

### ③ Two-weapon loadout with in-combat swap

We already have a weapon-swap chip. WWM makes swapping a *combat* action rather
than an inventory action. Worth considering — but it competes for thumb space,
so it's a "maybe," not a "should."

### ④ A separate deflect button, rather than block-timing

WWM deliberately separates block and deflect so the parry is a *distinct
commitment*. We already made this choice (deflect is its own tap, and it locks
you into a committed beat). **Confirmation we got this right**, not a change.

### ⑤ Posture → Exhausted → Execute

We already have poise → stagger → execute. **Confirmed by convergence**: Sekiro,
WWM, and DELVE all landed on the same loop independently. Keep it, and trust it.

---

## 5. What we should NOT take

- **Four defensive options.** Block + deflect + dodge + assist needs four
  inputs. We have room for two-and-a-half. Our dodge + deflect + spacing is the
  right size. (See the charter's block decision.)
- **7 weapons × 2 schools.** Beautiful, and completely outside our content
  budget — that's a live-service team's output. Our equivalent is the tarot/
  relic lane, where depth comes from *build* rather than *moveset*.
- **A third resource bar.** WWM has three. On a phone HUD, in the dark, with a
  restraint-first art direction, we should not add a bar. If Assist Deflection
  needs a resource, it should ride something we already draw.
- **Time dilation on Perfect Dodge as a constant.** We have this, and WWM
  *disables it in PvP and on higher difficulties* — a useful signal that it is a
  training-wheel, not a core mechanic. Ours is already tuned as a reward beat;
  don't extend it.

---

## 6. ⚠ A collision worth knowing about

**Our colour grammar and WWM's mean opposite things.**

| colour | Where Winds Meet | DELVE |
|---|---|---|
| **red** | deflect this (parry it!) | **do NOT deflect — dodge** |
| **gold/yellow** | unblockable, dodge only | a successful clash / TURNED |
| **white** | — | deflect this |

If you're playing both, red will read backwards. Both schemes are internally
consistent, so this is not a bug — but it's worth a deliberate decision rather
than an accident.

**My recommendation: keep ours.** Red-means-danger-get-out is the more universal
convention (traffic, Souls' "unblockable" language, Hades' unblockable tells), and
our white-for-parryable matches Sekiro's white flash. WWM's red-means-parry is
the outlier. But if the muscle memory keeps fighting you, this is a one-line
change in the colour constants and worth doing early rather than late.

---

## 7. What this changes in the charter

Nothing structural — which is itself a useful result. The five ideas hold, and
three of them got independent corroboration (posture loop, separate deflect
button, anticipation-length-as-difficulty). Two concrete additions:

1. **Test `FLASH_LEAD_S` against the mobile reaction budget** (§3). Possible that
   our parry window is arithmetically too tight and it's been read as
   difficulty.
2. **Add "no two attacks in one moveset share an anticipation"** to the fairness
   contract.
3. **Assist Deflection** joins the build order as a mobile accessibility item,
   riding the bullet-time machinery we already have.

And one thing to sit with: the strongest systems here (Sekiro, Monster Hunter)
are the ones with the *fewest* options and the most carefully authored
anticipations. **Our constraint is pointing us at the good answer.**

---

## Sources

- [Where Winds Meet Wiki — Combat](https://wherewindsmeet.wiki.fextralife.com/Combat)
- [Where Winds Meet Wiki — Controls](https://wherewindsmeet.wiki.fextralife.com/Controls)
- [Game8 — How to Parry Attacks and Best Parrying Tips](https://game8.co/games/Where-Winds-Meet/archives/565750)
- [Game8 — List of All Weapons and Weapon Types](https://game8.co/games/Where-Winds-Meet/archives/564704)
- [BlueStacks — Skills Guide: Martial Arts, Inner Ways, Mystic Skills](https://www.bluestacks.com/blog/game-guides/where-winds-meet/wwm-skills-guide-en.html)
- [GamingOnPhone — The Complete Combat System Guide](https://gamingonphone.com/guides/where-winds-meet-the-complete-combat-system-guide-and-tips/)
- [OnThaSticks — Mobile Tips: Best Settings, Controls & Performance](https://www.onthasticks.com/news-reviews/where-winds-meet-mobile-tips-best-settings)
- [GDKeys — Keys to Combat Design: Anatomy of an Attack](https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/)
- [Game Anim — The 12 Principles of Animation (in Video Games)](https://www.gameanim.com/2019/05/15/the-12-principles-of-animation-in-video-games/)
- [The Level Design Book — Enemy design](https://book.leveldesignbook.com/process/combat/enemy)
- [Sekiro Wiki — Posture](https://sekiroshadowsdietwice.wiki.fextralife.com/Posture)
- [BoostRoom — Mobile Settings & UI Guide](https://boostroom.com/blog/mobile-launch-guide-best-settings-ui)
- [Lotkeys — Mobile Launch: Cross-Progression & Control Differences](https://www.lotkeys.com/en/blog/detail/where-winds-meet-mobile-launch-must-know-cross-progression-controls)
- [AllThings.how — How Deflection Works in Where Winds Meet](https://allthings.how/how-deflection-works-in-where-winds-meet/)
