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

## 1c. The full mechanical inventory — and how much of it we already have

Josh asked for the detail on dodge / parry / bullet-time / poise / finisher. Here
is everything WWM runs, with what DELVE already has beside it. **The headline is
that we have most of it**, and in two places we have the better version.

### Defensive options

| WWM | what it does | DELVE |
|---|---|---|
| **Block** (hold) | *reduces* damage, doesn't negate. Explicitly "effective against minor enemies only" | ✗ none — decided against |
| **Deflection** (own button) | negates damage AND drains enemy Qi. Window described as "more generous than Sekiro or Elden Ring" | ✓ deflect — negates, riposte damage, poise chunk, **empowers your next swing** |
| **Dodge** | i-frames for the animation | ✓ dodge, i-frames |
| **Perfect Dodge** | last-moment dodge → **time dilation**, a counter window | ✓ just-dodge → **asymmetric bullet-time** |
| **Assist Deflection** | time-slow + prompt, costs Insight, **default-on mobile** | ✗ — the one real gap |

**Note the block finding.** WWM has four defensive options but block is
*deliberately weak* — reduces rather than negates, and the guides say it's for
trash only. So at high-level play WWM is functionally **deflect + dodge**, which
is exactly our vocabulary. Their fourth option is a training wheel, not a
fifth gear. That is strong support for the no-block decision.

**And our bullet-time is the better design.** Theirs is plain time dilation —
everything slows, including you. Ours is *asymmetric*: the world slows and the
player doesn't (`scaledDt` vs `playerDt`). Same read, but ours turns the reward
into agency rather than a cutscene. Also telling: WWM **disables** perfect-dodge
dilation in PvP and on higher difficulties, which marks it as a training wheel in
their design. Ours is a reward beat. Keep it that way; don't extend it.

### Attack grammar

| WWM | meaning |
|---|---|
| **Red glint** | deflect-only. Parrying yields counter damage + a critical window |
| **Gold/yellow glint** | unblockable AND unparryable — **dodge only** |
| the glint **brightens** | parry at peak brightness — the tell encodes *when*, not just *what* |

The brightening glint is worth stealing on its own: **a tell that ramps tells you
the timing, not merely the category.** Our white flash is currently binary
(on/off). A flash that *intensifies toward the strike* would teach timing
passively — and it's a shader/material change, not a system.

### Resources — they run four bars; we should not

| WWM bar | purpose | DELVE |
|---|---|---|
| Health | — | ✓ |
| **Qi** | unified: dodge, block, parry, *and* attacks. Regens by attacking, idling, or defending | ✓ stamina — but **light attacks are free** here, deliberately |
| **Insight** | segmented charges, ONLY pays for Assist Deflection | ✗ |
| **Vitality** | casts Mystic Skills; **regenerated by hitting enemies** | ✓ **this is our Hunger meter** |

Two convergences worth noticing. Their Vitality — a resource you *earn by
fighting* and spend on actives — is the same shape as our Hunger/rites lane,
arrived at independently. And their Insight is **segmented into discrete
charges** rather than a continuous bar, which reads far better at a glance on a
small screen. If we build Assist Deflection, charges beat a bar.

### The posture loop — near-identical to ours, with one twist worth taking

WWM: enemy Qi gauge sits under the health bar → fills from **landing attacks AND
parries** → full = **Exhausted** → **Execute** for heavy damage. Chaining parries
breaks a boss far faster than chipping health.

DELVE: poise → stagger → execute (charged heavy on a staggered foe), with
HP-scaled poise recovery so posture damage sticks on a wounded enemy. **We
already have this loop**, and our HP-coupling is a refinement they don't appear
to have.

**The twist worth stealing:** their Execute is a *timed prompt*, and the optimal
play is **not** to press it immediately — you keep attacking the Exhausted enemy
and fire the Execute just before the window expires, to bank both. That turns the
stagger from a button-prompt into a small decision with a risk curve. Ours is
currently "you may now execute." Adding a visible window and letting greed pay
would give the state real texture for very little work.

### The advanced mechanic — and the one that conflicts with our charter

**Parry cancels your own skill animations.** In WWM you can press parry during a
skill animation to cancel it — extending combos and giving you a defensive out of
a committed attack.

This is elegant, deep, and costs no new button. **It also contradicts Idea 3 of
our charter** (commitment is the currency, and the commitment arc in
`swing-agency.ts` is a shipped, tuned feature). A universal cancel means an
attack is never really a commitment if you have the read.

I don't think this is a "steal it" — I think it's **a genuine fork in the road**:

- **Souls/our model:** you commit, and reading the enemy means choosing *when* to
  commit. Depth is in the decision *before*.
- **WWM model:** you can bail out with skill. Depth is in reaction *during*.

Both are legitimate. Ours is the better fit for a phone (fewer inputs, less
frame-perfect demand) and for the deliberate, weighty feel the hammer work this
session was protecting. **Recommendation: don't take it.** But it's worth knowing
that the option exists and what it would buy, because if combat ever feels too
punishing this is the lever that would change its character most.

### Honest gap — no trustworthy WWM frame data exists

Searched hard for this, in English and Chinese, including PvP and datamining
angles. **Conclusion: no reliable third-party frame data for WWM exists, and the
numbers that ARE published should not be used.**

The evidence trail matters more than the conclusion:

1. **The one source claiming frame data contradicts itself.** It states the parry
   window is *"1–3 frames before impact"* AND *"more forgiving than Sekiro or
   Elden Ring"* — on the same site. **Sekiro's deflect window is 12–30 frames
   (200–500ms).** A 1–3 frame window (16–50ms at 60fps) would be roughly *ten
   times harder* than Sekiro, not more forgiving. Both claims cannot be true.
2. **The sites publishing numbers have AI-generated-SEO hallmarks** — confident
   figures, no stated methodology, no capture or frame-stepping evidence, and
   claims that conflict across their own pages.
3. **Chinese practical guides say the opposite of the English ones.** GamerSky's
   combat guide describes 卸势 (deflect) as having *"very strict timing
   requirements"*, with the author unable to consistently deflect full boss
   combos after hours of practice. That directly contradicts "more forgiving
   than Sekiro."
4. **No datamine, no frame-data project.** Sekiro has a full community
   frame-data video series for every attack in the game. WWM has nothing
   equivalent — it's newer, it's live-service (numbers move every patch), and
   the fighting-game/speedrun culture that produces frame data hasn't formed
   around it.

**So: treat every WWM timing number you find online as unsourced.** Including the
ones in the earlier sections of this doc — the "generous window" claim is
comparative marketing language, not a measurement.

### What we CAN use: Sekiro's numbers, which are real

Sekiro's deflect frame data is genuinely community-verified, and it gives us a
calibrated reference point plus one mechanic worth stealing outright:

| Sekiro | value |
|---|---|
| deflect window (base) | **12–30 frames (200–500ms)**, sources vary by measurement method |
| **window shrinks when you mash** | down to as little as **4 frames** per recent press |
| penalty clears after | **30 frames**, or **immediately on a successful deflect** |

**The anti-mash design is the steal.** Sekiro doesn't lock you out for mashing —
it *narrows the window*, and a clean deflect instantly forgives the penalty. That
is much more elegant than a hard cooldown: it punishes panic without ever telling
you "no", and it rewards the player who lands one good read by immediately
restoring full generosity.

We currently use a hard lockout (`DEFLECT.LOCKOUT_S` 0.40). A shrinking window
would be strictly better feel for the same anti-mash purpose, and it's a small
change to the parry-window computation.

### Correction to §3 — our window is generous; our LEAD is the tight part

Re-checking our own numbers against Sekiro's real ones sharpens the earlier
claim, and partly walks it back:

| | DELVE | Sekiro |
|---|---|---|
| active parry window | **420ms** (`PARRY_WINDOW_S`) | 200–500ms |
| tell lead before the strike | **300ms** (`FLASH_LEAD_S`) | — |

**Our active window (420ms) is already at the generous end of Sekiro's range.**
That is not the problem. The tight number is `FLASH_LEAD_S` at **300ms** — that's
the *reaction budget*, the time between the white flash appearing and the strike
landing. Against a ~250ms human baseline plus 50–100ms of touch and display
latency, 300ms leaves roughly zero margin for a player who wasn't already
looking.

So the refined hypothesis is narrower and more testable than what §3 originally
said: **the window is fine; the warning is short.** Raising `FLASH_LEAD_S` toward
0.40 would cost nothing mechanically (the flash simply appears earlier) and buys
the margin the arithmetic says we're missing. Worth trying on the phone before
touching anything else.

---

## 1d. Targeting / lock-on — researched, and the answer is "not the way they do it"

Josh: *should we have a targeting system, so you can switch from free to focused
combat?* The need is real. The obvious implementation is the one to avoid.

### What WWM does

A configurable lock-on: a toggle key (TAB / middle-mouse / right stick), with
settings for `lock enemy target` (nearest), `auto lock switch`, `prioritize the
target at the centre of the screen`, and `camera direction correction`. Locked
targets are marked with a white dot and the character auto-rotates.

### What their players say about it — this is the useful part

The complaints are consistent and they are all the *same* complaint:

- **Unwanted automatic target switching** mid-fight. "Clunky at best."
- **It re-locks to the wrong enemy even with the settings disabled.**
- **The camera stops being yours** — players report invisible rotation limits,
  and being unable to track enemies that move behind or above them.
- Players' recommended fix is a stack of settings to turn the automation *off*,
  and even then "these adjustments don't fully resolve" it.

**Every top complaint is a variant of "it took my camera."** That is the design
lesson, and it is much more valuable than the feature list.

### Why this is worse for us than for them

Three DELVE-specific multipliers, and together they're decisive:

1. **We're first-person. The camera IS the aim IS your situational awareness.**
   In third-person a lock-on orbits a character you can see; in first-person it
   turns your head. There is no "look at the fight while facing elsewhere."
2. **We just decided stalkers may be mean.** We are deliberately building enemies
   that flank to your blind side and lurk at the light's edge. A system that pins
   your view to one enemy is *actively hostile* to the enemies we're about to
   author — it would take away the exact input the counterplay depends on.
3. **Forced first-person camera rotation is a nausea risk** in a way that
   third-person orbiting is not.

**Recommendation: no hard lock-on.** Not a rejection of Josh's need — a rejection
of that particular mechanism.

### What to build instead — a ladder, none of which takes the camera

We already own more of this than it looks. `pickTarget` (`attack.ts`) does
cone + LOS + point-blank-grace target selection for ranged; melee resolves as a
swept capsule in the aim frame; `tap-target.ts` already raycasts a tap onto a
specific object.

| # | layer | what it does | status |
|---|---|---|---|
| **1** | **Soft-lock aim assist** | the attack resolves toward the best target in the cone | ✓ ranged has it |
| **2** | **Camera FRICTION** | look-drag *slows* as it crosses an enemy — helps you stop on target, never moves the view itself. Push harder and you sail past | ✗ **highest value for touch** |
| **3** | **Target designation** | tap an enemy to mark it: attacks prefer it, HUD shows its poise, **camera never moves**. Clears on death or on tapping elsewhere | ✗ this is the "focus" Josh wants |
| **4** | **Idle re-centre assist** | a gentle drift toward the current threat **only while the right thumb isn't touching** — instantly and totally yours the moment you touch | ✗ uncertain, prototype |

**Layer 2 is the one I'd build first.** Touch drag has no precision — there's no
analogue stick resistance and no mouse-hand fine motor control — so "friction"
(the console-shooter sticky-aim trick) buys the most accuracy per unit of
complexity, and it cannot take agency because it only ever *resists*, never
*acts*.

**Layer 3 is the real answer to "free vs focused."** It gives the commitment and
the readout of a lock-on with none of the camera cost. Note the presentation
constraint: **the marker must not be a rim glow** — rim glow means ARCANE in our
monster reveal taxonomy, and spending it here would break the colour legend.
Something carved, or a desaturation of everything else, instead.

**Layer 4 is the interesting-but-risky one.** "The camera helps while you're busy
and vanishes the moment you care" is elegant in principle, and because it only
acts when the player has expressed *no* aim intent it dodges the agency problem
in theory. In practice, drift can feel like a fight. Prototype before believing.

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
- [MumuPlayer — Comprehensive Combat Guide](https://www.mumuplayer.com/blog/where-winds-meet-combat-guide.html)
- [BuffGet — Parry Guide: Timings & Frame Data](https://buffget.com/news/where-winds-meet-parry-guide-timings-and-frame-data)
- [SportsDunia — Parry, Dodge, Counter Timing Guide](https://www.sportsdunia.com/gaming/where-winds-meet-parry-dodge-counter-timing-guide)
- [Where Winds Meet Wiki — Mystic Skills](https://wherewindsmeet.wiki.fextralife.com/Mystic_Skills)
- [Antberry — Can You Turn Off Perfect Dodge Slow Motion](https://antberry.com/can-you-turn-off-perfect-dodge-slow-motion-in-where-winds-meet)
