# Harbor, Presence & Felt Progression

A **living design thread** (started 2026-06-03). Companion to
`docs/DESIGN.md`. This one is a *discussion in progress*, not settled
canon — sections are tagged **[DECIDED]**, **[LEANING]**, or **[OPEN]**.
When a section settles, it graduates into DESIGN.md / CLAUDE.md and we
trim it here.

The thread started from two complaints:

1. **Leveling feels hollow.** You slay, a number goes up, nothing
   *happens*. You don't feel the reward.
2. **The dungeon feels lonely.** You want to encounter someone —
   helpful or not — the way Dark Souls and Hollow Knight let you.

These turned out to be the same problem wearing two masks: the game
has no **release** beat with any *warmth* in it, and no progression you
can *feel in your hands*. The fix is one connected system.

---

## The three tone registers [DECIDED]

CLAUDE.md already splits two tones. This thread adds a third.

| Register | Where | Voice |
|---|---|---|
| **Grimdark** | the dungeon, all in-world text | cruel, terse, indifferent |
| **Broadcast** | system pops, achievements, announcer | snarky, fourth-wall, pop-cultural |
| **Harbor** *(new)* | the safe room, the NPCs | warm, melancholy, human |

The harbor register only *means* something because of the cruelty
around it. It is **cozy-by-contrast, never cheerful.** Hollow Knight's
benches and hummers land because the world between them is hostile.

> **Governing rule: the harbor is a held breath, not a tavern.**
> NPCs are rare, melancholy, hard-won. One quietly humming figure
> who's been here longer than you've been alive beats a bustling hub.
> That restraint *is* pillar 3 (grimdark through restraint).

---

## Why leveling feels hollow — the diagnosis [DECIDED]

From the v1 system (`src/state/character.ts`, `weapon-classes.ts`):

- **Attributes** (Vigor/Resolve/Acuity/Lore): 1 unspent point per
  level, spent at a safe room. Each point is tiny (+1 HP, +0.5 armor,
  +2% crit) and the spend is rare. Reward arrives late, unfelt.
- **Proficiencies** (10): use-based counters. Only the weapon-class
  ones do anything (a 0.5%/pt drip, cap 25%). The other 8 are tracked
  and shown but **mechanically inert.**

The architecture is fine. The problem is the reward is **invisible and
deferred.** Fix = milestones with a felt moment + make the spend
matter + let your choices reshape the *loot you're offered*.

---

## Progression model

### Proficiency carries the moment-to-moment [DECIDED]

Replace the invisible 0.5%/pt drip with **named milestone tiers** that
fire a **broadcast pop** when crossed and grant something you *feel*:

> *Sword — Adept.* (you've drawn blood 40 times)

- Novice → Adept → Master per weapon class.
- Each tier grants a real combat change, not just a stat nudge — widen
  the combo window, unlock an extra combo step, add a cleave on the
  finisher. The data shape for this already exists in
  `weapon-classes.ts`.

Why this is the keystone:
- It's the **felt reward** — pop + sound + tangible combat change, in
  the moment you earned it.
- It's **diegetic** — you get good at what you *do*, no menu.
- The pop is the **broadcast layer** doing real work (the snark and the
  grim item-tier describe the same event).
- It's the **LLM signal vector** (see below) made legible to the
  player too.

The inert proficiencies: give the ~4–5 that matter a single milestone
perk (alchemy Master → potions heal more; toughness → the
get-hit-get-harder loop the code already hints at). Demote the rest to
pure LLM-signal — don't show them as if they're stats.

**Proficiency = a per-class config, overridable per weapon [DECIDED].**
Same pattern as `scaling` / `timingMul` (class default + per-item
override; LLM-authorable). Today proficiency does ONE thing for every
class — shave timings + add damage — which *erodes* the weight we just
built (speeding up a hammer un-heavies it). Instead each class's
proficiency improves what FITS it, from a SMALL bonus vocabulary
(speed, damage, stagger, combo-window, crit, reach):
  - dagger → attack speed + crit
  - hammer/scythe → **stagger power + damage** (NOT speed — mastery
    breaks poise harder, keeping heavies heavy)
  - sword → combo window + damage
  - wand → affliction potency
This is also how proficiency feeds the poise system without coupling:
heavy-class proficiency raises stagger power alongside Might.

**Show proficiency on the item card [DECIDED].** The "see the reward"
fix: a weapon's card shows its class tier (Novice→Adept→Master) + a
slim progress bar to the next tier + the net bonus it's currently
granting ("Sword — Adept · +15% dmg, +10% combo window"). Tier + bar +
net bonus only — never every sub-stat. Pairs with the milestone pops.

These three — per-class config, milestone tiers, item-card display —
are ONE workstream: the **proficiency rework**.

### Attributes: spend at the harbor [DECIDED]

Keep the deliberate Souls-style model: **earn points by leveling,
spend them at the harbor.** Proficiency carries moment-to-moment;
attributes are the slow build-identity layer. *But each point must
matter more and be visualized* so the spend is a real beat.

**Permanence: locked per run, full wipe on death** — each run is a
fresh build experiment, cleanest roguelike stakes. No within-run
respec. (Meta-progression carryover is a separate, later thread.)

**Power model: gear scaling (WC3-style), not flat passives [DECIDED].**
Each attribute does double duty — *weapon/gear scaling* **plus** a
signature *base stat*. Gear carries scaling grades (per-item, with a
sensible default by weapon class); your attribute points multiply
matching gear through its grade. So pumping an attribute makes *your
weapon* hit dramatically harder — the felt reward — and makes
LLM-offered gear that scales your invested stat land like a gift that
*fits*. Defense lives mostly on **gear** (armor slots), so there's no
separate defense attribute — this is what lets us drop from 4 abstract
attributes to a tighter WC3-style set.

**The four attributes [DECIDED]** — WC3-style: each scales ONE gear
category + carries ONE base stat. Replaces the abstract v1 four
(Vigor/Resolve/Acuity/Lore). One mental rule for all four: *invest in
the stat, the matching gear gets better.*

Base-stat principle: **it solves that archetype's weakness or amplifies
its signature verb** — so builds *play* differently, not just hit for
different numbers. (Knockback was rejected for Might: shoving enemies
out of a slow bruiser's arc fights the build it's meant to reward.)

**No dead points.** Every stat has three layers: a **universal floor**
wanted by all builds, **family scaling** (only the matching weapon),
and a **signature verb**. Crit (Finesse) and HP (Grit) are inherently
universal, so those *are* their floors; Might + Lore get a small
universal **+all-damage %/pt** so splashing them is never wasted.
Magnitudes: universal ~1%/pt < matching-family scaling ~2%/pt, so
concentrating in your weapon's stat always wins — identity holds.

**Might = stagger only (not poise).** The engine never interrupts the
player's swing today (`damagePlayer` does hit-pause/shake but no
attack-cancel), so "poise" would protect against nothing — building it
would mean adding swing-cancellation as a new downside for *every*
build just so Might buys it back. Instead Might's heavy/charged hits
**interrupt enemies out of their `winding` state** (reliability scales
with Might) — same "smash through, they reel" fantasy via offense, no
new downside. Revisit poise only if a deliberate swing-interrupt risk
layer is ever added.

Build order: **Stage 1** ✓ = rename + family scaling + universal floor +
Finesse crit + Grit HP/armor. **Stage 2** ✓ = Lore affliction-scaling.
**Stage 3** ✓ = Might stagger (the poise model below). Plus the weapon
**weight pass** (timingMul) shipped as a prerequisite. All four stats'
scaling + signatures are now live.

**Proficiency rework** ✓ — per-class profile (overridable per weapon) of
what mastery improves (dagger speed+crit, hammer/scythe stagger+damage,
sword combo+damage, …); named tiers (Untrained/Novice/Adept/Master);
item card shows base (white) + your bonus (gold = proficiency + Might/
Finesse/Lore) + a class tier line & progress bar.

Still ahead: the in-world **"blessing" feedback** + **broadcast pop** on
tier-up (the recognition moment), **utility-proficiency perks** (alchemy/
tinkering/… milestone effects), and the **mobile menu** (tabbed
GEAR/CHARACTER/CODEX panel — character is still buried 3 taps deep).

### Weapon weight is a prerequisite for stagger [DECIDED]

Stagger and slow heavies are the SAME fantasy — a hammer that staggers
but swings as fast as a dagger isn't heavy, it's a dagger that
interrupts. Weight must be *earned* by the slow committal swing, then
stagger is the reward for committing. The combat also just felt too
fast across the board.

Shipped: a per-class **`timingMul`** (weapon-classes.ts) stretches
**windup + recover** (NOT the strike/hit-window, so detection + balance
stay stable → the "wind up… SNAP… recover" cadence). hammer 1.7 /
scythe 1.5 (heavy), sword 1.25 / spear 1.15 (modest), light + ranged
1.0 (stay fast). Proficiency still shaves timings (left as-is for now;
may later re-point off speed onto stagger/combo/reach so mastery doesn't
erode weight). Tune the per-class number to taste.

### Might stagger = poise / stagger-damage model [DECIDED]

NOT chance-based (defensive RNG = random punishment, no payoff loop).
Instead the Souls/Sekiro **poise** model — deterministic, legible
(pillar 4), with a stagger→punish reward loop:

- Each enemy has a hidden **poise** pool (default derived from maxHp,
  per-spec override; bosses high/immune).
- A player melee hit deals **stagger damage** =
  `weaponWeight[class] × (1 + Might·MIGHT_STAGGER_PER_POINT) × chargeBonus`.
  Heavy weapons have high weaponWeight (stagger even at 0 Might — now
  justified by their slowness); Might amplifies and lets lighter weapons
  stagger too; charged heavies hit poise hardest.
- `poiseLeft -= staggerDamage`; at ≤ 0 → **STAGGER**: cancel the
  enemy's current ability/`winding` telegraph, enter a brief
  `staggered` stun (~0.6s, a free damage window), reset poise.
- Poise **regenerates** when not recently hit, so you must sustain
  pressure to break it.

Wiring: `poise` on EnemySpec + per-enemy `poiseLeft`/regen/`staggered`
state in enemy.ts; an optional `applyStaggerDamage()` on the Damageable
interface called from attack.ts on heavy-target melee hits (vases
ignore). Generalizes to boss stance-breaks later.

| Attribute | Scales | Base stat | The verb |
|---|---|---|---|
| **Might** | heavy weapons (hammer, scythe, sword, spear) | **poise + stagger** — uninterruptible mid-swing; heavy hits interrupt enemy wind-ups | smashes through |
| **Finesse** | light/ranged (dagger, whip, crossbow, knives) | **+crit chance** | bursts |
| **Lore** | arcane (wand) | **affliction potency** — statuses (poison/bleed/burn) hit harder & last longer (+item-understanding later) | afflicts |
| **Grit** | **armor** (equipped armor counts for more) | **+max HP** | endures |

**Defense = Grit scaling, NOT a weight/equip-load economy [DECIDED].**
The engine has no dodge roll / stamina / weight today (movement is a
flat `MOVE_SPEED`; armor is `physical-armor`/`magic-armor` amount
modifiers). DS-style equip-load only pays off with a roll to fatroll,
so a weight budget would be a big system with one mushy penalty knob.
Instead **Grit *scales* equipped armor** the same way Might scales
heavy weapons — same design goal ("defense is a deliberate investment,
not loot luck"), symmetric with the weapon model, nothing new to build.
If a dodge roll ever lands, *that's* when real equip-load earns its
slot; layer it on then.

The clean channel split (no double-counting):
- **Proficiency** owns **tempo** — attack speed, combo window, cleave.
- **Attributes** own **power** — gear scaling per category + one base
  stat each.

Scaling is **per-item** (a grade field), defaulting by weapon/armor
class, so the Phase-5 LLM can author odd hybrids (a blade that scales
Lore) — that's the seam it plugs into.

### LLM-tailored loot from your build vector [DECIDED — Phase 5]

The deepest fix to "I don't feel the reward": the reward for leveling
isn't +1 HP, it's that **the dungeon starts offering gear that fits who
you're becoming.**

- Acuity + dagger proficiency → it coughs up crit/bleed daggers.
- Vigor + hammer → crushers and heavy plate.

Your character vector (attributes + the proficiency ledger) *is* the
prompt. The first points you spend nudge the whole run's loot toward a
build you never picked from a menu — you *became* it. Uniquely an
LLM-game thing. **Design the stat system now so that vector is clean
and legible for Phase 5 to read.**

---

## The Harbor (safe room as hub) [DECIDED]

**One kind of safe room, and it IS the harbor** — the between-acts safe
room we already have, enriched. No separate minor "checkpoint" vs major
"hub" tiers; keep it rare and special rather than diluting it.

Today the safe room is a stat-spend pit stop. Make it the place you're
*relieved* to reach — which makes descending back out cost something
emotionally. It gathers:

1. **Spend stat points** — work on your build.
2. **Achievement loot crates** — the DCC announcer made *material*.
   Earn an achievement in the depths; the AI "hands" you a crate at the
   harbor. The snarky pop and the tangible reward are the same beat.
   Natural, cacheable LLM hook.
3. **The Smith / merchant** — build-tinkering, sell your hoard.
4. **The watcher** — pure atmosphere. Does nothing. Hums. Is
   remarkable *because* it does nothing.

> **Anti-goal: the harbor must not become a checklist.** If arriving
> greets you with "spend points, open 3 crates, buy, click NPC," the
> warmth dies. The *feeling* comes first — you arrive, the watcher is
> humming, the fire's lit — and the functions are things you *can* do,
> tucked into that, not a menu that ambushes you.

### Layout — spatial, not modal [DECIDED]

The functions are *places you walk to*, each anchored to a presence or
object, never a screen that greets you:

- **The fire** is the only thing that greets you — the rest/breath beat.
  **Spending stat points happens here** (it's the reflective moment, not
  a separate "build screen").
- **The Smith** works at an anvil off to one side. Approach if you want
  them; they work whether you come or not.
- **Achievement crates physically appear by the fire** when earned — you
  see them waiting and choose to open them. Objects, not a notification.
- **The watcher** is at the far edge, facing the dark. You never *need*
  to approach it. It's what gives the room a soul.

### NPC presence minimum [DECIDED]

What sells "a person is here" — three cheap layered things, no dialogue
tree required for the first feeling:

- **A held pose, not an idle loop.** Unnervingly still — one slow
  breath, head barely tracking you. Stillness reads as presence far more
  than animation. (The Smith gets one repeating work-motion; labor is
  its own stillness.)
- **A hum (diegetic audio).** The highest-impact element. A low,
  wordless loop that swells as you approach and bends the ambient bed.
  You *hear* the harbor is occupied before you see it. Fits the
  silence-first / vocals-signal-life audio direction — here a *friendly*
  vocal signals friendly life; the contrast is the point.
- **A light that's theirs.** Per lighting-as-signal: a dim warm steady
  ember in a colour the dungeon never uses. Their own colour = a being,
  not a fixture.

**The watcher is silent [LEANING].** Its whole character is that it
won't / can't speak — pure presence, the player projects everything onto
it. More haunting, costs nothing to build. Dialogue (a generalized
`note-card.ts` → dialogue card) is the second layer, reserved for NPCs
who *do* speak (Smith, merchant).

---

## Presence — "someone else is here" [LEANING]

The antidote to loneliness splits cleanly into two:

- **Persistent harbor NPCs** — live in the safe room, you return to
  them. Smith, merchant, the soulless watcher "becoming part of the
  dungeon, staring into the deep." Reliable warmth.
- **Wild dungeon encounters** — rare, surprising, lighting-as-signal.
  An NPC slumped in a corridor, a trader who appears once and never
  again, a phantom.

**Wild NPCs share a vessel with corpses** — both are how *other people*
register in your run. CLAUDE.md pillar 4 lists "phantom NPCs" as a
multiplayer trace. So the NPC system is *also* how dead players echo
into your run later. **Corpses = the dead you loot; phantom NPCs = the
echoes you meet.**

---

## Corpses — typed entity [LEANING]

Today `src/interactables/corpse.ts` is note-only. Make it a **typed,
data-driven entity now**, because it's literally the thing that becomes
a dead *player* later:

- `lore` — note only (today).
- `remains` — note + small loot chance (consumable, coins, sometimes a
  real item).
- `risen` — the **fake** one. Interacting triggers an ambush (a mummy /
  ghoul rising).
- `fallen-delver` *(Phase 4)* — a real dead player's corpse: loot a
  slice of their kit, LLM-narrated epitaph. Same type union.

**The fake corpse must be fair.** Grimdark ≠ unfair. A pure gotcha you
can't read teaches "never touch corpses" and kills the loot loop. The
Souls answer is **learnable tells** — the risen corpse is subtly wrong
(too fresh, no scroll sticking out, a twitch, wrong pose). First one's
a teaching scare; after that, every corpse becomes a micro-decision:
*loot it, or strike it first?* That hesitation **is** crunch. Striking
a real corpse should cost nothing but a swing — never punish caution.

---

## Spawn primitive (pentagram + smoke) [OPEN]

Being built anyway — build it as the **general "the dungeon spawns
enemies" mechanism**, not a one-off. One primitive, many triggers:

- ambush rooms (sigil ignites on entry, doors seal — we already seal
  doors on combat),
- the risen-corpse ambush (same spawn, smaller),
- boss add-waves (the phase-system boss summons onto a pentagram),
- later: a phantom of a dead player invades.

Check whether it can hang off `src/content/encounters.ts`.

---

## Bosses & demo scope [DECIDED]

Three boss floors (one per act) is the right shape for a public start.
Don't build a 4th before Phase 4. What makes the demo memorable is the
felt-progression loop above making the first three floors satisfying to
climb — not boss #4.

---

## 2026-06-06 thread — game identity, verbs, magic, NPC recruitment

> **These are DIRECTIONS, not canon.** Tagged `[LEANING]`/`[OPEN]` on
> purpose: we fully expect to iterate, and a later call may **supersede**
> any of this (strike through + date + a pointer to what replaced it —
> never a silent deletion or a quiet contradiction). Nothing here
> graduates into DESIGN.md / CLAUDE.md until it's been *felt on the phone*.
> This section is the scratchpad, not the verdict.

### The skeleton: the run IS the build [LEANING]

The influences pull two ways — Souls/Lunacid (a *persistent character* you
level over many sessions) vs Isaac/Hades/Dead Cells (a *run-scoped*
character whose build **emerges from what you find**). We pick the
roguelike: **run-build skeleton, Souls *skin*.** Weighty deliberate
combat, weapon identity, scaling, cruel restraint, the harbor — that's the
skin. The engine underneath is "descend, the build comes together this
run, you die, the dungeon forgets you, you build anew."

This is *consistent with* the attribute model already decided above
(attributes are locked-per-run and wiped on death) — it's the lens that
explains *why* that's right, and why the old per-level point-drip felt
hollow (wrong engine for a die-and-rebuild game).

**Why it's also the right call for the LLM layer:** a build-from-found
roguelike is *content-hungry* — it needs a big, surprising item/ability
pool, which is exactly what a layered LLM authoring system produces
endlessly. And it makes the "LLM-tailored loot from your build vector"
decision (above) load-bearing: the dungeon authors gear *toward (or
cruelly against)* what you're becoming. No hand-built roguelike does
adaptive, build-aware authoring at scale. Structure and authoring model
want the same thing.

### Verbs come from equipment — no skill tree [LEANING]

The missing channel. Today we have **proficiency (tempo)** and
**attributes (power)**; we add **equipment (verbs)**:
- **Weapon art** ← bound to the weapon you hold (Souls/Dead Cells). Your
  gear *is* your moveset.
- **Spell** ← bound to an **offhand focus** or a **scroll** (consumable).
- Proficiency is *mastery of the verb*; the equipment *is* the verb.

No separate skill tree to manage — build = what's in your hands. Mobile
fits: one dedicated **art button** on top of the existing dodge/charge
gestures.

### Magic [LEANING]

A **weapon family** (Lore/wand) + **offhand foci** + **scrolls**, framed
grim (hexes, afflictions, blood/bone sorcery — never Hogwarts), routed
through the buff/affliction/projectile systems that already exist. **No
mana bar** (one resource too many for thumbs). Resource:
- light, repeatable arts pay **stamina** (unify with the tuned economy);
- signature spells/arts use a **cooldown or limited charges** so they stay
  *events*, not spam.

Start with stamina (it's built); add cooldowns where spam would erode the
feel.

### Items as the build engine — incl. rule-changers [LEANING]

Stat-mods / on-hit / triggered passives already exist (the modifier
pipeline). The **Isaac layer** is the frontier: **rule-changers** — "your
dodge leaves a burning wake," "every third swing hurls a bone shard,"
"crits arc to a second enemy." Those need a few combat hooks
(on-dodge / on-Nth-hit / on-crit); some exist via passives/triggers, some
we'd add. This is where "what will this run *become*" lives — and it's
pure data for the content layer to author forever.

### Meta-progression = who you've saved [LEANING]

Make meta **human and diegetic**, not a stat menu. "What have I unlocked"
becomes **"who have I saved and brought home."** This *resolves the open
question below* ("do wild NPCs persist?") — the answer is **both**:

1. **Encounter (rare).** A roaming figure in a god-ray-lit room (an NPC is
   an *event*, per lighting-as-signal). Hollow Knight's bench beat.
2. **Transient by default.** They help *this run* — a hint, a gift, mend
   you, a moment beside you — then they're gone. Most encounters end here.
3. **Costly rescue → Harbor resident.** Inviting one home is *earned*:
   escort them out alive (fragile), carry their ember down-and-back, give
   up loot, beat what holds them. **Die and they're lost.**
4. **Resident grants a pool/service unlock, never raw stats** — smith →
   a weapon family starts appearing; hexer → spell scrolls seed into loot;
   alchemist → new potions; bellkeeper → summon a phantom. Expands *what
   the run can become* (honours "meta = unlock the pool, not power").

**Grimdark catch:** rescue sometimes **curdles** (they succumb at the
fire, or ask something dark). Cozy *by contrast*, never cheerful — same
"held breath" rule as the harbor.

**Async bridge (Phase 4):** a *failed* rescue can persist as a trace
another player finds — and you may find someone another player abandoned.
Shares the corpse/phantom vessel already noted under Presence.

### "Metroidvania-of-the-meta" [LEANING]

A *literal* metroidvania (one persistent, backtracked map) **fights the
procgen descent** — don't build it. The Hollow-Knight "the world is
opening up as I meet people" feel lives in the **meta layer instead**: the
possibility space (item / region / spell pools) is gated by **who you've
saved**. Ability- and character-gated content *across runs*, not terrain
*within* one.

### Open calls from this thread [OPEN]

- **Harbor capacity** — scarce / mutually-exclusive (saving one can cost
  another) *vs* accumulate-all over time. *(Lean: scarce — it makes your
  harbor an identity and honours "a held breath, not a tavern.")*
- **Saved NPC as a summonable phantom** in-dungeon (a gorgeous async
  bridge) *vs* home-only service. *(Lean: later phase — touches combat.)*
- **Magic resource split** — which arts are stamina vs cooldown/charges.

---

## Open questions

- **Harbor layout** — how do the functions sit in the space without
  becoming a menu? (next to discuss)
- **NPC presence system** — what's the minimum that sells "a person is
  here": idle pose + a hum (audio) + a dialogue card (generalize
  `note-card.ts`)? (next to discuss)
- ~~Do wild NPCs persist across a run, or are they one-shot encounters?~~
  *(answered 2026-06-06: **both** — transient by default, recruitable to
  the Harbor as meta. See the 2026-06-06 thread above.)*
- Achievement crates: which achievements grant them, and how is the
  reward scaled so it's a treat, not a power spike?
- How early does the first NPC appear — does the tutorial introduce the
  harbor warmth before the first death?
