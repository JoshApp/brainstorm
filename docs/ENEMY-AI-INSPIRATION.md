# Enemy AI — Cross-Game Inspiration & Idea Bank

**Status:** RESEARCH SYNTHESIS (2026-07-01). Feeds the next stages of
`docs/ENEMY-AI-V2.md`. Distilled from deep research into DOOM (2016/Eternal),
F.E.A.R., Halo (Bungie era), Alien: Isolation, Left 4 Dead, Shadow of Mordor
(Nemesis), and FromSoftware (Sekiro/Elden Ring). Sources at the bottom.

## The thesis (why this matters for DELVE specifically)

Every one of these games earned a "best AI ever" reputation on **cheap, local,
deterministic rules** — F.E.A.R. shipped 1–2-step plans; Halo ran on ~15% of the
original Xbox CPU; DOOM demons are a hierarchical state machine, not behaviour
trees. The intelligence was manufactured in the **presentation layer** (barks,
telegraphs, morale postures, reaction animations) sitting on top of simple
mechanics. **That is exactly DELVE's bet** (cheap deterministic combat + a rich
`broadcast/` narration layer), so we should lean into it hard and NOT reach for
heavyweight planners.

Two fairness laws every source independently confirmed — treat as constraints:

1. **Never punish the struggling player harder.** Adapt *pacing/perception*, not
   *stats*. (Isolation forbids death-events teaching the Alien; L4D's Director
   changes frequency, never difficulty; FromSoft guarantees a recovery/punish
   window on every committed attack; Mordor guarantees every enemy keeps a
   weakness.)
2. **Every threat must be attributable to a stimulus the player produced.** The
   graded senses, loud tells, distinct silhouettes, and danger cues aren't polish
   — they're what convert "unfair" into "I did that." Legibility is load-bearing.

## DELVE's four-layer model (where each idea lives)

The cleanest mental model, mapped onto systems we already have:

- **Director (macro)** — *"the dungeon watches."* A thin layer ABOVE the pack that
  owns belief-of-player-location + a stress scalar + pacing. Decides *when/where*
  pressure arrives. (New. Ties to encounter budget + procgen.)
- **Pack coordinator (meso)** — *"the dungeon closes in."* `pack.ts`: receives
  Director hints, fans them into flank vectors, propagates alerts (`alerts.ts`),
  gates simultaneous attacks (tokens), holds "learned" unlocks.
- **Creature (micro)** — *"the dungeon's teeth."* `enemy.ts` + `intent.ts`: senses
  locally, runs the two-gauge combat economy with committed, readable attacks.
- **Memory ledger (persistent)** — *"the dungeon remembers."* `state/` + `broadcast/`:
  logs encounters; occasionally mints a named, scarred, remembering nemesis.

---

## Prioritized build order (payoff-for-effort, tied to our seams)

### TIER 1 — highest leverage, builds on what exists, some fix issues we've hit

**1. Posture/Stagger ECONOMY (DOOM's DPS-ladder + FromSoft's two-gauge).** The
biggest melee-feel win. Formalize the stagger we already have into a *sustained-
damage accumulator* per creature with legible tiers: **twitch** (nudges aim) →
**falter** (INTERRUPTS its windup) → **stagger** (execute window; make the
creature damage-resistant so the window persists). Couple it FromSoft-style: a
Posture gauge fills from deflects + heavy/committed hits and drains after ~1s
idle at a rate scaled by HP-fraction (fast at full HP, frozen when low) — so
"whittle HP a bit, THEN break & execute" emerges without a tutorial. *The
falter-interrupts-windup tier is the payoff:* it rewards committing DURING a
creature's telegraph. **For a PACK this is the crowd-control verb** — deflect the
one committing, break it, execute, use the hit-pause to reposition. Primitive
creatures = low posture (break fast, reward aggression); elites/captains = deep
pools. Seams: `combat/reactive-defense.ts`, `combat/damage.ts`, existing stagger.

**2. Telegraph-the-wait / "voice the constraint" (F.E.A.R.).** The direct fix for
"waiting mobs look frozen / like satellites." A creature holding the ring without
an attack-token must *telegraph the wait* — a hungry sidestep, a feint, a
weight-shift, a low growl — so it reads as "circling for an opening," not
"standing stupidly." This converts the token queue from a tell-that-it's-a-state-
machine into a *feature the player reads*. Cheap; lives in `intent.ts`
(the `watch`/`circle` intents) + a feint animation. Highest fit for the exact
complaint from playtesting.

**3. Morale postures + leader-break cascade (Halo).** Give the danger/mood scalar
three *legible* postures: **pressing** (in the ring, attacking) / **wary** (backed
off, circling, still dangerous) / **broken** (routs, cowers in the dark). Add a
`leadershipRank` spec field; the pack picks a leader; killing it triggers a
per-archetype **break** on survivors (wail → scatter). Grimdark theater: cut down
the ringleader and the rabble breaks into the dark; a cowering cultist you then
execute is pure Souls. Keep transitions probabilistic + timing-gated (no
flip-flop). Seams: `intent.ts` mood → postures; `pack.ts` leader; `enemies.ts`
rank; feeds the voice-in-the-deep.

**4. Attack COMMITMENT + explicit recovery window as DATA (FromSoft) + distinct
windup silhouettes (all).** Make **recovery length a per-attack field** — the
punish window is *authored*, not incidental. Attacks stay non-cancelable once
triggered (commit = vulnerable through windup + recovery), so combat is a *reads*
game, not reaction-spam. Audit the attack-verb library (`mob_attack_anim`) so
every attack has a **distinct windup silhouette** (with primitive geometry: big
pose deltas — rear-back vs wind-sideways vs raise-overhead). Fold **dread-light
into the telegraph** — a windup that emits colored light makes the tell and the
atmosphere the same asset (satisfies "light = signal"). Delayed windups are legal
ONLY with a sustained readable hold pose; never input-read.

### TIER 2 — new layer, high payoff (Stage 3 territory)

**5. The Director + stress-scalar pacing (Alien two-brain + L4D).** A macro layer
that owns belief-of-player-location and a **stress scalar** (fed by damage taken,
near-misses, kills *near* you; decays over time but freezes while engaged),
driving a 4-state loop: **Build Up → Sustain Peak (hold 3–5s) → Peak Fade (wait
for a natural combat lull before resting) → Relax (30–45s floor)**. The Director
NEVER hands the pack coordinates — it emits a coarse "search region + priority"
and the pack must *path there and find you* (no teleporting onto the player).
Spawn reinforcements **out of sight, ~75% biased BEHIND** you via a moving active-
area window (cheap entity reuse — mobile-friendly). This is "the dungeon watches"
made literal + procedurally-paced floors. Seams: sits above `pack.ts`; ties to
the v3 floor-content budget + occupancy grid + Creature Render V2 pooling.

**6. Belief model + graded senses + imperfect search (Halo props + Alien).** Give
each creature a tiny **belief** (last-seen player position), and have the AI read
BELIEF, not ground truth — so it keeps lunging at your last-seen spot after you
break LOS (stealth/surprise emerge, not special-cased). **Graded senses:** hearing
in tiers (crouch < walk < run; a sword-clash / shattered vase spikes it),
vision as accumulating cones (not a binary flip). **Search on a deliberately
sub-optimal path** (check points of interest out of order, tightening radius,
sensor decay so it eventually gives up = the fairness bound). One creature hearing
you and *calling the others* (via `alerts.ts`) is the pack version of the stalk.
Our combat is LOUD — noise-as-liability is a natural tension.

### TIER 3 — memorable; ties to meta-progression + Phases 4/5

**7. Nemesis-lite memory ledger (Mordor), scoped small.** Log meaningful
encounters as `{eventType, creatureId, outcome}`. Most of the pack stays
anonymous fodder (correct); occasionally one **survives killing the player** and
returns **named, scarred (cause-specific: burned → burn scar), and remembering**,
speaking through the voice-in-the-deep ("You again. I remember your throat under
my hand."). Reframes death as revenge-fuel, not just failure. **This is also the
Phase-4 async-multiplayer seam** — an evolved remembering creature serialized to
SpacetimeDB and dropped into another player's world is structurally a bloodstain/
phantom trace, but *active*. Data: immutable identity + mutable scars/rank +
traits. Guardrail: any near-immune enemy keeps ≥1 weakness. Seams: `state/`
persistence + `broadcast/` + Phase 4/5.

**8. Progressive behaviour "unlocking" = fake learning (Alien).** The pack "learns"
your habits: rely on a tactic → its counter comes online (hide the same spot → it
checks there; lean on one weapon art → it exploits it). Implement as feature-flags
on intent-layer branches + a small habit ledger (favorite tiles, most-used art,
kite-vs-turtle). TWO unlock paths: organic observation OR a depth milestone
(so pattern-free players still escalate). Two hard rules: **no unlock triggered by
an event that killed the player**, and **timed failsafe unlocks**. Deeper floors'
packs come pre-unlocked with counters to what you leaned on up top — the cleanest
in-combat "the dungeon remembers," and a data surface a future LLM narration layer
can read.

### Cross-cutting (fold into whatever we build)

- **Stagger simultaneous attacks (all).** Our token system already does this;
  tune to **1–2 committing at once, ~2–3s cadence, never in unison.** First-person
  caveat: **never let an unannounced hit come from off-screen** — prefer giving
  tokens to creatures in view, or a peripheral creature emits an audio/light
  pre-tell before it commits.
- **Attack-token upgrades (DOOM).** Make tokens **stealable** by whoever has the
  best lane/angle (the aggressor role follows the best-positioned creature), and
  add a **melee-range override** (a creature you brush past can always swing → no
  greed in a crowd). Pool size = a per-depth `config.ts` knob.
- **Inverted cover / positioning (DOOM).** Score positions for *exposure* + clear
  sightline, never concealment; never let a creature build a lunge where you can't
  see it. (We already gave ranged mobs LOS-seeking — generalize it.)
- **Role-as-problem specs + "scariness" scalar (DOOM/Halo).** Each creature
  declares a *verb/role* ("forces you to close", "punishes greed", "must die
  first") + a numeric menace other creatures read to decide hold-vs-flee. The
  encounter budget composes a MIX OF PROBLEMS, not a headcount. Tuning bar: an
  encounter is right when you *run past* some creatures to kill a priority one.
- **Post-hoc paired signals (F.E.A.R.).** Choose a "bark" AFTER the coordinator
  commits (can't contradict). Non-verbal for creatures: a lead screeches +
  head-snaps at you (we have head-tracking), flankers answer with a chitter as
  they peel off — perceived coordination fired off existing ring/token roles.
- **Focus tracking → chest + hips (DOOM), not just neck.** Distribute the
  player-track across chest + hips (partial each) — reads far more menacing than a
  swiveling head. Cheap on rigid-skinned meshes (a few bone rotations, still 1
  draw); clamp per-segment angles HARD so blocky bodies don't break.
- **Runtime lunge warping + wall-check (DOOM).** One lunge clip, scale its travel
  + duration to reach the player, and **raycast the path first** (occupancy grid);
  if it'd clip a wall, fall back to a step-in. Kills "creature lunges into a wall."

---

## What NOT to build (researched and rejected)

- **GOAP planner (F.E.A.R.).** Near-unanimous: wrong tool for a small game —
  harder to build/debug, runtime-costly, loses authorial control. Our state
  machine + utility intent + pack coordinator IS the (preferred) Halo model. Keep
  it. Steal only the cheap lessons: "all AI do is move + play animations," bias
  with action *cost*, and emergent flanking = geometry + a bark, not coded maneuvers.
- **DOOM's resource-denial economy** (heal-by-glory-kill, ammo-from-chainsaw,
  Carcass shield walls). Built for a fast ranged shooter; fights our deliberate
  Souls pacing. Transferable kernel only: a creature that *manipulates navigable
  space* (blocks a corridor, cuts a retreat lane) is a great Souls-compatible role.
- **Inverse-accuracy-vs-player-speed, ranged cover/suppression machinery.** Firearm/
  cover-geometry design; irrelevant to melee.
- **Destructible-body ability-stripping (DOOM), full Nemesis system (Mordor).**
  Too heavy for now; take the lightweight doses noted above (few severable parts;
  the `{event,id,outcome}` ledger + one named survivor).
- **Widening arenas / faster tells (Eternal "racecar & track").** Tight corridors
  are our deliberate opposite. Kernel that transfers: if you speed a creature up,
  lengthen/clarify its telegraph in lockstep.

---

## Recommended next step

**Make Stage 2 a "combat legibility + it-has-a-mind" pass** from Tier 1, in this
order: **(1) the posture/stagger economy** (crunchy-combat payoff + the pack
crowd-control verb), **(2) telegraph-the-wait** (fixes the satellite/frozen read
we hit in playtest), **(3) morale postures + leader break** (texture + theater).
All three build on systems we already have, are presentation-heavy (cheap,
on-thesis), and each is independently feelable on the phone. The Director (Tier 2)
and Nemesis-lite/fake-learning (Tier 3) are the bigger, later swings once combat
feel is locked.

## Sources

**DOOM** — [Cyber Demons: The AI of DOOM (Game Developer)](https://www.gamedeveloper.com/design/cyber-demons-the-ai-of-doom-2016-) · [Bringing Hell to Life (GDC 2017)](https://www.youtube.com/watch?v=D4oh4sMgXpw) · [Embracing Push Forward Combat (GDC 2018)](https://www.youtube.com/watch?v=2KQNpQD8Ayo) · [Aggressive resource management of DOOM Eternal](https://www.gamedeveloper.com/design/the-aggressive-resource-management-of-i-doom-eternal-i-)
**F.E.A.R.** — [Three States and a Plan (PDF)](https://www.gamedevs.org/uploads/three-states-plan-ai-of-fear.pdf) · [Combat Dialogue in F.E.A.R. — Illusion of Communication (PDF)](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter02_Combat_Dialogue_in_FEAR_The_Illusion_of_Communication.pdf) · [Building the AI of F.E.A.R. with GOAP](https://www.gamedeveloper.com/design/building-the-ai-of-f-e-a-r-with-goal-oriented-action-planning)
**Halo** — [Handling Complexity in the Halo 2 AI (Isla, GDC 2005)](https://www.gamedeveloper.com/programming/gdc-2005-proceeding-handling-complexity-in-the-i-halo-2-i-ai) · [Halo 3 AI Leadership (MCC docs)](https://learn.microsoft.com/en-us/halo-master-chief-collection/h3/ai/leadership) · [Half-Minute Halo — Griesemer](https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html)
**Alien: Isolation** — [Revisiting the AI (AI and Games)](https://www.aiandgames.com/p/revisiting-alien-isolation) · [The Perfect Organism (Game Developer)](https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation)
**Left 4 Dead** — [The AI Systems of L4D (Booth, GDC 2009 PDF)](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
**Shadow of Mordor** — [Designing the Nemesis System (de Plater)](https://www.gamedeveloper.com/design/designing-i-shadow-of-mordor-i-s-nemesis-system) · [Nemesis patent](https://patents.google.com/patent/US20160279522A1/en)
**FromSoftware** — [Sekiro Posture](https://sekiroshadowsdietwice.wiki.fextralife.com/Posture) · [Anatomy of an Attack (GDKeys)](https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/) · [The cracks in Elden Ring's combat design](https://www.gamedeveloper.com/game-platforms/the-cracks-in-elden-ring-s-combat-design)
</content>
</invoke>
