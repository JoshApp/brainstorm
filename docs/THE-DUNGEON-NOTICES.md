# The Dungeon Notices — Compass, Attention & the Tarot Spread

> **STATUS: SPINE COMMITTED 2026-06-21 (conceived 2026-06-15).** The
> top brainstorm sections remain exploratory (compass axes/names, deep
> synergy model — still [OPEN]), but the **progression spine and the v3
> floor-content system are now DECIDED** — see **"Session 2026-06-21"**
> and **"v3 floor-content system"** at the bottom; build against those.
> This **supersedes the attribute-point-spend model** in
> `HARBOR-AND-PROGRESSION.md`. Tags: **[DECIDED]** = committed,
> **[LEANING]** = current preference, **[OPEN]** = unresolved fork,
> **[LOVED]** = Josh flagged it as a keeper.

Companion to `docs/HARBOR-AND-PROGRESSION.md` and `docs/DESIGN.md`.

---

## Why this exists

Two older threads — the "attention meter" (transaction grammar) and
"felt progression / proficiency milestones" (harbor) — turned out to be
the same idea seen from two sides. This note unifies them under one
root and, in doing so, reopens the whole progression model: **what if
your build isn't a stat sheet you optimize, but the fate the dungeon
deals you for how you've behaved?**

The session also rejected the half-decided attribute-spreadsheet
level-up in favour of a **tarot-card build** (see the fork below). That
choice cascades through everything here.

---

## The root: one Compass, read two ways [LEANING]

A small set of **emotional domains** describing *how you delve*. Working
names (grimdark, placeholder — see open questions):

```
                 MERCY
                   │
   WONDER ─────────┼───────── AVARICE
                   │
                 BLOOD
```

- **Blood ↔ Mercy** — *how you treat what lives.* Cruelty vs compassion.
- **Avarice ↔ Wonder** — *how you treat what you find.* Take vs understand.

Your delving puts a **needle** on this rose. Corners are archetypes the
dungeon recognizes: Blood+Avarice = the **Reaver**, Wonder+Mercy = the
**Pilgrim**, Blood+Wonder = the **Inquisitor** (cuts things open to know
them), Avarice+Mercy = the one it can't read.

**The grimdark asymmetry [LOVED]:** **Blood and Avarice are domains the
dungeon profits from** — it feeds on them, rewards them readily, prices
them fairly. **Wonder and Mercy it doesn't understand**, so it can't
fairly cost them — which makes Wonder/Mercy cards the **strangest and
most powerful**. Greed is the safe paved build; Mercy is the heretical
high-roll. The dungeon doesn't get why you'd spare anything.

### Two ledgers from the same compass [LEANING]

Every meaningful action drops into one or more domains, and each drop
splits into two ledgers:

| Ledger | What it is | Behaves | Drives |
|---|---|---|---|
| **The Mark** | permanent identity — *who you are* | accumulates; wiped on death | what you're DEALT; who the LLM thinks you are |
| **The Gaze** | the dungeon's *mood about you now* | spikes & decays toward calm | how it TALKS; what it PUSHES at you |

Same vocabulary, two timescales, two owners. The Mark is your soul; the
Gaze is its mood. This is the whole trick that keeps attention and
proficiency from becoming two competing systems — they're one compass.

**The Gaze is a per-domain float**, not a single scalar: the dungeon can
be greedy-curious about you in one moment, bloodthirsty the next.
Designers/triggers can push or pull it from anywhere; it decays toward
calm if you go quiet.

---

## The three things the dungeon does with the compass [LEANING]

1. **It speaks** (voice in the deep). Gaze *intensity* decides *when* the
   voice talks; the *dominant domain* decides *what* it says. Relishes
   your Blood, mocks your Avarice, is grudgingly unsettled by Mercy.
2. **It deals you fate** (level-up = tarot — see below). Your **Mark**
   weights the deck; a butcher draws butcher cards.
3. **It pushes events** — the **mirror rule [LOVED]:** the hot Gaze
   domain *themes what comes next.* Avarice → a baited hoard; Wonder → a
   hidden door; Blood → an ambush/champion; Mercy → a wounded trace that
   needs you. A director knob for procgen/encounter selection. A single
   scalar can only turn intensity up; a compass gives the event system a
   *flavor*.

---

## Progression: Tarot IS the build [DECIDED THIS SESSION]

Chosen over (a) classic attribute point-spend and (b) a hybrid spine.
**No player-facing stat sheet.** Power = the **Spread** — the hand of
fate cards you've collected this run.

**Fate deals the hand; you pick the card.** That marriage is the soul of
it: pure agency would be a character creator, pure fate a slot machine.
Dealt-then-pick is the tension — you choose your fate from a hand fate
chose for you, curated by how you've behaved.

**Stats live in the background; cards grant them.** Three card flavors so
the hand never feels like a spreadsheet:
- **Number cards** — *The Glutton* is just +Might/+loot under the hood.
- **Verb cards** — *The Hound* gives your finisher a cleave you couldn't
  do before.
- **Conditional cards** — *Red Thirst* (heal on kill), *The Berserker*
  (stronger as you bleed) — these define a *build*, not a stat.

### Two arcana — the cap clash, resolved [DECIDED THIS SESSION]

A single card type can't be both the common drip *and* the precious
capped build — that contradiction is what made "1 card/level + cap 5"
feel like churn. Split it the way a real tarot deck splits, and the
clash dissolves:

- **Minor cards** — frequent, small, modular. **Accumulate freely** (high
  cap or none). This is the roguelike *take-and-take* growth.
- **Major Arcana** — rare, momentous, build-defining. **This** is the
  capped **Spread (~5)**, the synergy build. Discarding one is agony —
  *correct*, because you see only a handful a run. Never churns, because
  you're never flooded with majors.

You get both fantasies at once: Hades-style accumulation on minors,
Balatro-style tight build on majors.

### Leveling, decoupled [DECIDED THIS SESSION]

With attribute points gone (tarot replaced them) and use-based stats
rejected (see below), leveling needed a new payoff. The answer falls out
of the two-arcana split:

- **Level-up → a Minor card.** Fast leveling is now a *feature* — it's
  the heartbeat of minor-card accumulation, and minors are *built* to
  flow freely. **Pick 1 of 2** (a snap choice, not agony).
- **Majors → the fire / bosses / corpses.** Rare, weighty. **Pick 1 of
  3.**
- Levels otherwise add a **quiet auto power-creep** (small HP/damage) so
  you keep pace with depth — no menu for that part.

Two tempos: rapid little picks as you descend (minors), rare heavy picks
in the firelight (majors). If leveling currently feels *too* fast, retune
the curve now that each level is a real pick — a tuning feel, not a
blocker.

### Everything resolves at the fire — the descent is untouched [DECIDED THIS SESSION]

Popping a pick **mid-combat** would knife through Pillar 1 (crunchy
combat first) and the tone. So nothing interrupts the descent. Fires are
**per floor-clear** (the shipped per-floor bonfire — distinct from the
rare between-act *harbor*), so the pending stack is always small.

```
descend (cards accrue UNCLAIMED) → clear floor → reach the fire →
  claim your fate: minor picks + any major → descend again
```

- **Mid-combat, a level only shows a non-blocking cue** — a soft sound +
  a **card-back docked at the screen edge** ("fate waits"). No modal, no
  pause. Combat owns the moment-to-moment dopamine; the card is the
  *quiet* after the violence — a stronger hook for this audience than a
  popup, and pure restraint.
- **The fire is the sole place you "become."** You arrive, and the
  dungeon lays your accrued cards into your hands one at a time in the
  firelight — light 1-of-2 minor picks, plus the weighty 1-of-3 major.
  A ritual, not a menu slog (kept small by per-floor fires).
- **Unclaimed fate is LOST if you die before a fire.** The Dark Souls
  banked-souls loop, mapped onto fate. Creates a live decision every
  floor: **push deeper greedily** (risk the fate you earned) **or retreat
  to the fire to lock it in.** Per-floor granularity makes the loss a
  sting, not a catastrophe — and pushing-on feeds the compass (greed /
  recklessness; the dungeon notices).

### The rest of the deal rules [LEANING]

- **You must take one.** No refusing the dungeon; the choice is *which*,
  never *whether*. No skip-for-gold paralysis.
- **Wildcard temptation.** Occasionally a card from a domain you've
  *neglected* appears — the greedy delver shown a Mercy card she didn't
  earn. Drift bait.
- **Duplicate → it deepens** (Balatro edition: foil/holo). Rewards
  committing to a domain.
- **High Gaze → a scar.** When you've been *noticed*, one offered card is
  **reversed** — a cost baked in, or a curse you must accept for the
  boon. This is the cheapest way attention bites the build directly (no
  LLM needed; see V1).

### Balatro as the power model [LOVED]

The point isn't cards, it's **synergy** — the joy is the broken combo,
not the +stat.

- Cards are **jokers**: persistent run modifiers that key off *each
  other*, not isolated bonuses.
- **Domains are the synergy families** — Blood cards feed Blood cards.
  Committing your needle to a corner is building an *engine*.
- **Multiples = editions** (foil/holo/polychrome) — the "duplicates
  strengthen" rule, Balatro-style.
- **The Spread is capped (~5).** Balatro's real lesson: scarcity forces
  synergy-hunting. Full Spread + new fate = **discard one**. Diegetic —
  a reader lays a fixed spread. (Position-modifies-card, Celtic-cross
  style, is a *far-future* maybe.)

Engine example (a Blood spread):
> *Red Thirst* (heal on kill) + *The Berserker* (harder the lower your
> HP) + *The Glutton* (−armor). The Glutton keeps you *in* Berserker's
> danger zone; Red Thirst keeps you alive **only while you keep
> killing**. Three cards that make each other work — stop killing and
> the engine kills you.

### Cards found on dead crawlers [LOVED]

Reuses the **shipped lootable fallen-delver corpses** (SEARCH → pickup,
`traces-and-lamp-reveal`). A dead crawler carries **the card they died
holding.**
- **Async-native** — Phase 4: real players' Spreads seed real corpses.
  For now, generated crawlers carry plausible spreads.
- **It drifts your compass** — take a dead reaver's Blood card and your
  needle pulls toward Blood even if you've been gentle. You inherit a
  stranger's fate.
- **The risk: the card that killed them.** A corpse card can be a scar.
  Take the dead man's power *and* his doom?

### Mercy / async cards [LEANING]

The un-profitable domain reaches *other players*: *The Gift* — leave aid
for the next real delver; when they find it, you're blessed back.
*The Empty Hand* — heal when you spare or aid. *The Martyr* — bleed
yourself to bless. The dungeon doesn't understand any of it.

---

## The three clean channels (what stats & proficiency become)

The reframe splits the build surface cleanly:

- **Weapon proficiency → TEMPO.** You get better at what you *wield*
  (combo window, attack speed). Already shipped, tactile, diegetic —
  **keep it.**
- **The Tarot Spread → POWER.** Your build is the fate you've been dealt.
  **Replaces** attribute point-spend.
- **The Compass → CURATION + VOICE + EVENTS.** The new root.

The four combat-math primitives (the gear-scaling values — today
Might/Finesse/Lore/Grit) **survive as the hidden math cards manipulate**,
not a sheet you pump. *The Glutton* might just *be* +Might under the
hood; you experience it as fate, not arithmetic.

### Use-based stats: a trap, routed through the deal [DECIDED THIS SESSION]

"Take damage → get tankier, dodge a lot → get agile" is a famous trap
(the Oblivion problem): it **rewards bad play** (face-tank to farm
tankiness, spam-dodge nothing), **entrenches** instead of diversifying
(positive feedback loop that can reward *failure*), and is **silent /
choiceless** — the opposite of the pick we built the whole system around.

But the *instinct* — "you become what you do" — is already in the design:
the **compass reads your behavior and the deck responds.** Route it
through the deal, not into a hidden meter:

- Keep nearly dying / take a beating → the dungeon **offers tankier
  cards.** You *choose* the tank.
- Dodge & deflect skillfully (reactive-defense system already shipped) →
  **offered agile/reactive cards.**

Same "become what you do" feeling, but you **pick it**, it **can't be
farmed** (nudges the *deal*, not a number), and it keeps agency. *How you
fight* (tanky/evasive/aggressive) is a separate read from the moral
compass, but both are just **curation inputs** — neither becomes a
player-facing stat.

**The one safe use-based system — already shipped: weapon proficiency.**
It works *because* it rewards real engagement (you must fight and win),
is bounded, and can't be idle-grinded. Rule of thumb: **use-based growth
is safe when it rewards skill and is bounded; it's a trap when it can
reward getting hit, standing still, or playing badly** — and the second
bucket goes through the card deal instead.

---

## The hand as LLM context [LEANING]

Your Spread + compass + death context is the **richest prompt we'll
hand the LLM.** Output should be *deep lore*, not a recital of card
names ("she held X, Y, Z" was only the seam, not the voice). The build
and the story become the **same object** — who you were is literally the
fate you collected. The periodic "character summary every 5 floors"
(Phase 5) is the natural summarizer of the Mark + Spread into prompt
context.

## The descent is the generation window — the runtime-LLM seam [DECIDED THIS SESSION]

This is the architectural payoff, and it's the answer to *the* hard,
undecided question CLAUDE.md flags about runtime LLM: **latency,
determinism, offline/PWA.** You can't block combat on a 2-second network
call. But because picks resolve **at the fire, not mid-combat**, there's
a built-in window:

> **The descent is the generation window. The fire is the reveal.**

While you play floor N — killing, looting, prying, sparing — the LLM
authors the fate you'll be offered at floor N's exit fire, tailored to
**what you just did on this floor** (your compass deltas, near-deaths,
finds). A *whole floor* of lead time. By the time you reach the fire, the
cards are ready. The latency hides inside gameplay you were doing anyway.

**What keeps it safe (and on the right side of the charter):**

- **Cards are data specs.** The LLM **authors / flavors / selects**
  them — content lane, exactly where runtime LLM is allowed to live.
- **Effects stay local & deterministic.** The LLM picks and dresses the
  card; it never computes damage or game rules.
- **Deterministic local fallback pool.** If the call is slow, fails, or
  you're **offline**, fall back to the pre-authored static pool. The pick
  **never blocks on the network** — you always get a valid card; bespoke
  or stock, the player can't tell which.

This is the "route LLM-authored values through the same data surfaces,
keep rules local" principle, made concrete. **It generalizes:** the
fire-reveal is the *universal* latency-hiding beat for all runtime LLM
content — the floor's loot flavor, the voice's line on how you played,
the epitaph-in-waiting. Generate during the descent; reveal in the
firelight. The whole Phase-5 surface hangs off this one pattern.

---

## Earlier proof-of-concept feature: branching descent [LEANING]

From the same session, the feature that could prove the compass cheaply:
**multiple ways down a floor** — stairs (safe) / trapdoor (greedy,
exposed) / marked gate (richer, costly). Choosing the greedy descent
**spikes Avarice/Blood Gaze**. Now written up in full in
**`docs/BRANCHING-DESCENT.md`**.

---

## Version One — the smallest loop that proves the feeling [LEANING]

Strip to the one loop — *"the dungeon watched how I played and dealt me a
fate I chose from"* — leaning almost entirely on shipped systems. No LLM
required for V1.

1. **~16 cards as data** (4 domains × 4), clear effects through the
   existing modifier pipeline (`combat/modifiers.ts` / buffs) — a few
   **cursed/double-edged** in the mix. No synergy engine yet; good boons
   + hooks. (Minor/Major split can start as just "small vs build-
   defining" tags.)
2. **A simple Mark** — tag a handful of *existing* actions (kill → Blood,
   loot/grave → Avarice, read rune/secret → Wonder, aid/spare → Mercy).
   Four counters.
3. **Level-up → pick 1 of 2 minors**, cued mid-combat (docked card-back),
   resolved at the fire. **Fire → pick 1 of 3**, capped Spread (~5).
   Reuses the shipped bonfire REST menu.
4. **The Spread view** — the tarot-layout menu (replaces the stat
   screen). The visual.
5. **One cheap use of attention:** a single Gaze float that, when hot,
   **injects a cursed/reversed card** into the next deal — "the dungeon
   noticed you," felt through the cursed-card mechanic, **no LLM.**
6. **Unclaimed-fate-lost-on-death** — the per-floor stake.

**Deferred (layers cleanly on top, no rework):** the voice/lore (Phase 5
LLM via the generation-window seam above), mirror-rule events, cards-on-
corpses + async, deep Balatro synergy, compass-curated loot.

## Open questions — still iterating

- **The axes & names [OPEN].** Do Blood↔Mercy / Avarice↔Wonder feel like
  the right two questions? Missing a domain for how you *avoid* (flight /
  dread / caution)? *Wonder* reads a touch bright for the tone — darker
  candidates: *Inquiry*, *the Pry*, *Heresy* (knowing what you
  shouldn't).
- **Needle vs zero-sum [OPEN].** Independent meters with a dominant
  *read* (current lean — freedom to play + a clear identity), or true
  opposed sliders that *force* a tragic character?
- **Meta-progression [OPEN].** Death wipes the Spread — what survives?
  Does the *deck itself* grow run to run? Do you unlock cards by playing
  a domain? Does the Mark leave a permanent trace?
- **Synergy / edition compute model [OPEN].** How combos & editions
  actually resolve on a *real-time action* game (vs Balatro's turn
  scoring) — effects keying off each other's triggers.
- **Card vs gear build-surface tension [OPEN].** Cards + weapons + gear +
  proficiency is a lot of stacked build surface. Cleanest split so far:
  **loot = your tools** (weapons/armor), **cards = your fate** (identity/
  build), and the **compass curates both**. Confirm before ship.
- **~~When dealt~~ [RESOLVED].** Everything resolves at the per-floor
  fire; the descent is uninterrupted; unclaimed fate is lost on death.
  See the deal-loop section.

---

## Relationship to existing docs

- **Supersedes (if adopted):** the attribute point-spend level-up,
  "spend at the harbor," and the WC3-style Might/Finesse/Lore/Grit *as
  player-facing stats* from `HARBOR-AND-PROGRESSION.md`. Those numbers
  survive only as hidden card math.
- **Keeps:** weapon proficiency (tempo channel), the poise/stagger combat
  model, the harbor as a warm safe-room beat, the gear-scaling math.
- **Absorbs:** the "attention meter" (transaction grammar) → the Gaze;
  "felt progression" (harbor) → the deal moment; lootable corpses
  (traces) → cards on dead crawlers.

---

## Session 2026-06-21 — the spine is committed [DECIDED]

This session moved the big forks from [LEANING]/[OPEN] to **decided**.
The vision above stands; this section is the load-bearing summary to
build against.

### 1. Tarot IS the build. Stat distribution is cut. [DECIDED]

One progression spine, not two. Today the game runs BOTH a tarot Spread
AND attribute-point allocation (might/finesse/lore/grit earned per
level, spent at the fire — `src/state/character.ts`). That dilutes both.
Stat-point allocation is the least interesting progression we can offer
(number-go-up, no identity, no synergy) and tarot does everything it
does plus identity + synergy + theme. So:

- **All in-run build decisions = tarot.** Cards change *how you fight*,
  not just +N to a stat.
- **XP/levels demote to a curve, not a menu.** Keep an automatic
  survivability creep with depth (HP/stamina) so deep floors stay fair —
  but **no point-spend screen**. The attribute-spend system + its UI
  (`src/ui/attribute-defs.ts`, the bonfire spend menu) come OUT.
- **XP → meta-progression.** Earned XP unlocks new cards into the pool /
  new starting hands / codex (the "meta carries forward" pillar). Never
  raw stat power that trivializes combat.

### 2. Two card temperatures, two rhythms [DECIDED]

Mirrors the in-world vs voice-in-the-deep tone split — a good sign it's
the right grain.

- **Minors — frequent, optional, FOUND, never gated.** Small,
  synergistic texture. From found fire-events + corpses. Skipping one is
  a real choice (speed/purity vs greed). Upright, low-stakes. Accumulate
  freely in the Spread.
- **Majors — rare, GATED, ceremonial.** The act-break fork at the
  harbor fire after a boss. Deal-3-pick-1, forced (stairs sealed —
  `src/state/fate-gate.ts` already arms on the big fire and clears on
  draw; `src/interactables/stairs.ts:705` already seals). These DEFINE
  your archetype/domain. Capped Spread (~5) so each is weighty. **This
  is where stakes live** — majors are allowed to bite (Faustian
  boon+cost, and/or an optional reversed/greedier variant). The
  card-reading screen currently deals `arcana:'minor'` only
  (`src/ui/card-reading.ts:43`) — the harbor/boss fire must request
  `'major'`.

### 3. What makes advantage/disadvantage interesting [DECIDED]

Priority order for design effort:

1. **Synergy + opportunity cost (80%).** The good decision is "which of
   these three plays with what I hold / how I fight," not "which number
   is biggest." Cards reference domains + each other. Invest here.
2. **Directional commitment.** Majors push toward an identity, closing
   other doors. Commitment = stakes.
3. **Tradeoff / reversal (seasoning, NOT the meal).** Boon-with-teeth on
   the rare majors only.

Both traps are fatal: *all-tradeoff* makes nothing feel like growth;
*all-upgrade* makes nothing a decision. So **minors are net-positive
(interesting via synergy); majors are directional + carry real cost.**

### 4. Starting hand [DECIDED]

Run start (the starter altar) deals weapon + **one starting MINOR**
(deal-3-pick-1). Teaches "this is a tarot game" from second one and
gives a gentle directional nudge without a weighty major before you've
played. Majors stay sacred to bosses.

### 5. Fires are FOUND events, not floor furniture [DECIDED]

- **Minor fires are events** the floor-content budget rolls (see §6),
  depth-weighted, NOT one-per-floor-entrance. A fire you find is an
  event; a fire at every entrance is furniture (and violates the
  lighting-as-signal doctrine).
- **The harbor/post-boss fire is the exception — always present.** It's
  the act-break ceremony and the only fire that gates the stairs.

---

## v3 floor-content system [DECIDED — supersedes the per-vault spawn model]

The bug that forced this: floors can spawn ZERO combat (empty first ~3
floors). Root cause — combat is an *accident* of vault selection, never
budgeted. At depth 1 only 2–3 combat vaults are eligible, each with 2–3
`X` slots, each slot 40% deleted by the act-1 density gate
(`acts.ts:58` light=0.6 × `procgen.ts:303-310`). 2–3 coin flips can all
miss → empty floor. Nothing says "a floor must have combat."

**The disease:** combat lives *inside* "combat"-tagged rooms (12 combat
vaults hold 44 of 48 enemy slots; the other 23 rooms author zero). A
room being shaped like a treasure room must not mean nothing can ambush
you there.

**Confirmed by inventory:** 35 vaults total — the pool is HEALTHY. We do
**not** need more vaults; we need to stop using tags as gates. Spawning
into open cells of any room is feasible today: `OccupancyGrid`
(`src/level/occupancy-grid.ts`) already reserves walls/void/props/
approach-zones; we add an "enumerate the free floor cells in this room"
helper (~100 lines) and validate picks against `WalkableRegion`. Vaults
are already ~80% "shape + anchors" (ASCII shape + `cellProps` anchors +
auto-installed `perimeterFitting`).

**The model:**

1. **Floor content budget (the new brain).** A depth curve decides per
   floor: *combat budget* (enemy count + intensity, with a GUARANTEED
   floor so empty is impossible), *feature budget* (chests/fountains/
   altars), *event rolls* (minor fire, etc.).
2. **Decouple spawns from tags.** Drop the `vaultsForTag` hard filter at
   selection (`vault-compose.ts` / `vault-library.ts:1225`). Place
   enemies into open cells of ANY room via the grid. Authored `X` tiles
   demote from "the only way enemies exist" to *preferred-spawn hints*.
3. **Tags → hints, not gates.** They keep their interior jobs (ceiling
   style, start-yaw, boss `B` expansion, encounter archetype) but stop
   deciding whether a room can hold combat. (Tag read-sites:
   `vault-compose.ts:1296` pickMiddleTag, :405 tagSeq, :153 ceiling,
   :238 encounter default, :265/:588 boss allow, :608 start yaw, :630
   stair reorient, :500 leaf pool.)
4. **Explicit safe-zones.** Today "safe" is accidental. v3 reserves
   no-spawn cells around the entry, the bonfire, and feature approaches
   so the budget never drops a mob in your lap (the grid's approach
   reservation gives us most of this).
5. **Events ride the same budget.** The minor-fire event is just a
   feature type the budget can roll. One system.

**Build order (current plan):**

1. `enumerateOpenCells(occ, roomRect, layer)` on the occupancy grid.
2. Per-floor content budget (depth-scaled combat/feature/event).
3. Spawn-injection pass: distribute combat budget into open cells across
   all rooms, honoring safe-zones; `X` tiles become hints.
4. Remove tag gating from selection; keep tags as metadata.
5. Minor-fire event as a budget feature type.
6. THEN the tarot layer (starting minor, major-at-boss + stakes) and
   pull out stat distribution.
