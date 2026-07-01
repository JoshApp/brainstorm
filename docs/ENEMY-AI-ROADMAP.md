# Enemy AI — Master Roadmap

**Status:** COMMITTED 2026-07-01. The big plan for turning DELVE's enemies into
living, dangerous, memorable threats. This is the *sequence*; the *why* lives in
`docs/ENEMY-AI-V2.md` (architecture) and `docs/ENEMY-AI-INSPIRATION.md` (the
cross-game idea bank). We are deliberately spending real time here — combat feel
is Pillar #1.

## Principles (hold these the whole way)

- **Intelligence is manufactured in the presentation layer.** Cheap deterministic
  rules + rich telegraphs/postures/signals. No GOAP, no ML.
- **Two fairness laws:** adapt *pacing/perception*, never *stats*; every threat
  traces to something the player did (legibility is load-bearing).
- **Each sub-stage ships something feelable on the phone.** No multi-week dark
  branches. Build → feel → tune → next.
- **Everything is a data surface.** Roles, postures, personalities, recovery
  windows, menace — authored in `config.ts` / `enemies.ts` so the content layer
  (and a future LLM) can tune without touching engine code.

## The four layers (the mental model)

`Director (macro — "watches")` → `Pack (meso — "closes in")` →
`Creature (micro — "teeth")` → `Memory (persistent — "remembers")`.

Build inside-out: nail the **Creature** feel first (combat is the foundation),
then the **Pack** legibility, then the **Director** pacing, then **Memory**.

---

## PHASE 0 — Foundations ✓ SHIPPED

The intent spine + facing model already live:
- Intent utility layer (close/circle/watch/press) + drifting mood + per-mob
  personality (`intent.ts`). Bosses opt out.
- DOOM focus tracking (head tracks player, body faces movement) + movement lean +
  ranged LOS repositioning.
- Anti-jitter (bearing smoothing + step-overshoot clamp) — the satellite wiggle.

---

## PHASE 1 — Crunchy combat & "it has a mind" (the feel pass)

The Creature layer. Highest leverage, builds on what exists, each piece feelable.

### 1A — Posture/Stagger ECONOMY  ← START HERE
Rework the existing hidden `poise` pool into a real **two-gauge** system and the
DOOM/FromSoft ladder. Scope:
- **Two gauges: HP + Posture.** Posture fills from committed damage; **drains
  after ~1s idle at a rate scaled by HP-fraction** (fast at full HP → frozen when
  low) so "whittle HP a bit, THEN break & execute" emerges without a tutorial.
- **The ladder:** sustained/heavy damage → **twitch** (nudge aim/timing) →
  **falter** (INTERRUPTS its windup — the commit-during-telegraph reward) →
  **stagger** (execute window; make the creature damage-resistant so the window
  persists; partial posture refund if you don't capitalize).
- **Fill sources, weighted:** heavy/charged swings and **clean deflects** are the
  posture-breakers (light hits barely dent it). This is where we **redo Might /
  heavy-weapon poise scaling** — make heavy weapons *meaningfully* better at
  breaking, and a deflect a real posture event.
- **Execute:** a grimdark finisher on the stagger tier (restrained dread-light
  reveal — a color we otherwise never use = "this one is ready").
- **Pack payoff:** posture-break-and-execute becomes the **crowd-control verb** —
  deflect the committer, break it, execute, use the hit-pause to reposition.
  Primitive creatures = low posture (break fast, reward aggression); elites =
  deep pools. Data: `CONFIG.POSTURE` + per-spec `posture`.
- Sub-steps: (i) the gauge + HP-scaled recovery, (ii) the ladder states +
  falter-interrupt, (iii) fill weights + Might/heavy rework, (iv) execute +
  reveal, (v) tune per archetype.

### 1B — Telegraph-the-wait
A token-less waiting creature *feints / weight-shifts / growls* instead of
freezing — reads as "circling for an opening," not a frozen satellite. Fixes the
playtest complaint. Lives in `intent.ts` (`watch`/`circle`) + a feint clip.

### 1C — Morale postures + leader-break cascade
The mood scalar drives three legible postures: **pressing / wary / broken**. Add
`leadershipRank`; the pack picks a leader; killing it triggers a per-archetype
**break** on survivors (wail → scatter into the dark). Probabilistic + timing-
gated (no flip-flop). Feeds the voice-in-the-deep.

### 1D — Attack commitment, authored recovery, distinct telegraphs
- **Recovery length becomes a per-attack DATA field** — the punish window is
  authored, not incidental. Attacks stay non-cancelable once committed.
- **Distinct windup silhouettes** per attack verb (big pose deltas for primitive
  geometry) + **dread-light telegraphs** (windup emits colored light = tell +
  atmosphere in one asset). Never input-read; delayed windups need a held pose.

### 1 cross-cutting
- **Attack-token upgrades:** stealable by the best-positioned creature + a
  **melee-range override** (brush past one → it can always swing). Stagger
  simultaneous attacks to 1–2 at once, ~2–3s cadence, never off-screen unannounced.
- **Focus tracking → chest + hips**, not just neck (more menacing; cheap on
  rigid-skinned meshes; clamp hard).
- **Role-as-problem specs + a "menace" scalar** — each creature declares a verb
  ("forces you to close", "punishes greed", "must die first"); the encounter
  budget composes a *mix of problems*.

---

## PHASE 2 — The Director (pacing & "the dungeon watches")

The macro layer. Procedurally-paced floors instead of fixed spawns.

### 2A — Belief model + graded senses + imperfect search
Per-creature **belief** (last-seen player pos); the AI reads belief, not truth →
searching/stealth emerge. **Graded senses:** hearing tiers (crouch<walk<run; a
sword-clash/shattered vase spikes it), vision as accumulating cones. **Search on
a sub-optimal path** with a tightening radius + sensor decay (the give-up bound).
One creature hearing you and **calling the others** (via `alerts.ts`) = the pack
stalk. Our combat is LOUD — noise-as-liability is a natural tension.

### 2B — The Director
A thin layer above the pack owning **belief-of-player-location + a stress scalar +
a pacing state machine** (Build Up → Sustain Peak 3–5s → **Peak Fade waits for a
lull** → Relax 30–45s). Emits only a coarse "search region + priority" to the
pack (never coordinates — no teleporting onto the player). **Spawn out of sight,
~75% biased BEHIND** via a moving active-area window (cheap pooled entities). Ties
to the v3 floor-content budget + occupancy grid + Creature Render V2 pooling.

---

## PHASE 3 — Memory ("the dungeon remembers")

The persistent layer. Ties to meta-progression + Phase 4 (multiplayer) + Phase 5
(LLM narration).

### 3A — Nemesis-lite
Log encounters `{eventType, creatureId, outcome}`. Most of the pack stays
anonymous fodder; occasionally one **survives killing the player** and returns
**named, scarred (cause-specific), remembering**, speaking through the voice-in-
the-deep. Death → revenge fuel. Guardrail: any near-immune enemy keeps ≥1
weakness. This is also the **Phase-4 async seam** — a remembering creature
serialized to SpacetimeDB into another player's world is an *active* trace.

### 3B — Fake learning
The pack "learns" your habits (favorite tiles, most-used art, kite-vs-turtle) →
counters unlock. Two paths: organic observation OR a depth milestone. Two rules:
**no unlock from a death-event**, and **timed failsafe unlocks**. Deeper packs
come pre-unlocked with counters to what you leaned on up top. The habit ledger is
a data surface the LLM narration layer can read.

---

## Sequencing & dependencies

```
PHASE 1 (Creature feel)  ──►  PHASE 2 (Director pacing)  ──►  PHASE 3 (Memory)
   1A posture economy            2A belief + senses            3A nemesis-lite
   1B telegraph-the-wait         2B director + stress          3B fake-learning
   1C morale + leader
   1D commitment + telegraphs
   (cross-cutting tokens/menace/focus)
```

- **1A first** (the user's call + the biggest feel win + it's the pack crowd-
  control verb everything else leans on).
- 1B–1D are independent and can interleave; the cross-cutting token/focus tweaks
  fold in as we touch those files.
- Phase 2 needs Phase 1's combat feel locked (pacing is meaningless if a single
  fight isn't good). 2A (belief/senses) precedes 2B (the Director consumes them).
- Phase 3 needs the encounter loop (Phase 2) + leans on `state/` persistence +
  `broadcast/`; it's the bridge to Phases 4/5.

## Definition of done (per phase)

- **Phase 1:** a single fight is *crunchy and readable* — you break posture with
  heavy/deflect, execute, and reposition; a pack reads as individuals with morale,
  not satellites; killing the leader is a moment.
- **Phase 2:** floors *breathe* — tension builds, peaks, and rests procedurally;
  creatures hunt and search believably; reinforcements well up from behind.
- **Phase 3:** the deep *remembers* — a foe you failed to kill returns changed and
  names the moment; the dungeon adapts to how you play.
</content>
