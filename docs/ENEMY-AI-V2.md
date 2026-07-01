# Enemy AI V2 — the mob with a mind

**Status:** CHARTER (2026-07-01). Staged rewrite of the mob brain. The existing
state machine, ability runner, and pack coordinator STAY — this inserts an
**Intent layer** inside `chasing` and feeds it a **perception of the player**, a
drifting **mood**, and a per-mob **personality**. The goal: enemies that feel
alive, dangerous, and scary instead of robots shuffling toward you.

## Why (the problem)

Today a chasing mob has ONE gear: walk to a pack ring slot at constant speed,
attack the instant an ability is off cooldown and a token is free. Three failures:

1. **No modulation** — constant forward pressure reads as "shuffling." Threat
   comes from *changing tempo*: stillness, then violence.
2. **Blind to the player as an agent** — it paths to a position, never *reads*
   what you do. You dodge → it whiffs → resets → shuffles again. It never
   punishes a heal, respects a guard, or baits a dodge. Awareness is the #1
   "it has a mind" signal.
3. **Zero individuality** — every mob of a type runs identical logic. No coward,
   no berserker. The circling is mechanical (a token-less orbit), not motivated.

## Design pillars (what "alive" means here)

- **Awareness** — the mob reacts to YOU: presses when you heal/whiff, respects a
  raised guard, baits your dodge, sizes you up.
- **Tempo** — cycles hot and cold. Lulls (holds, watches, circles) then bursts
  (a committed flurry). Never one constant speed.
- **The dark is a weapon** — first-person + torchlight is our edge. Mobs flank to
  your BLIND SPOT (behind you, where you can't see), lurk at the light's edge,
  dart in and out of visibility. Souls can't do this; we can.
- **Individuality** — cowards, berserkers, patient stalkers. Variation within a
  pack and across types, authorable per-enemy.

Grounded in how Souls-likes actually read as intelligent: aggression *states* not
constant aggression; humanoids circle to size you up (aggressive but grant
breathing room); reactive behavior (interrupt the heal); distinct roles at
distinct engagement "frequencies." (Artorias breakdown / Level Design Book.)

## Architecture — the Intent layer

Keep the `EnemyState` machine (idle→alerted→chasing→winding→striking→…). Inside
`chasing`, a mob no longer runs one fixed behavior; it picks an **Intent** and
executes it, re-deciding on a **decision tick** (~0.4–0.7s, jittered) so choices
have *commitment* and don't jitter frame-to-frame.

### Intents

| Intent    | Movement          | Attacks | Feel |
|-----------|-------------------|---------|------|
| `close`   | to ring, full     | gated   | get into the fight |
| `circle`  | orbit the ring    | held    | size you up, look for an opening |
| `watch`   | hold (speed ~0)   | held    | the lull — still, staring, weighing you |
| `press`   | to ring, fast     | eager   | the burst — commit and swing |
| `flank`   | to your BLIND side | held   | get behind you in the dark (Stage 3) |
| `bait`    | half-step in/out  | feint   | draw your dodge, then punish (Stage 2) |
| `retreat` | back off          | none    | respect your guard / low aggression (Stage 2) |
| `punish`  | to ring, max      | forced  | you're healing/whiffed/staggered — NOW (Stage 2) |

Key inversion vs today: **attacks are HELD by default and only released by an
aggressive intent** (`press`/`punish`). That single change is what creates the
lull — mobs stop swinging the instant they're able and instead *choose* when.

### Intent selection (utility)

A pure function `selectIntent(input) → intent`. Scores each candidate from:
distance vs reach/commit, the mob's **aggression** mood (0→1), its **personality**
(boldness/patience/pack-loyalty), ability/token readiness, its HP, and (Stage 2+)
the **player-read**. Highest score wins for the decision window; a little
run-seeded jitter (gameRng) breaks ties so a pack doesn't move as one. Pure +
deterministic → unit-testable.

### Mood — aggression (0→1), drifts

Per-mob, slow-moving. Rises when it lands a hit or allies press; falls when it's
hurt, staggered, or whiffs. Biases the utility so a mob (and a pack) visibly
cycles hot and cold. Deterministic (a function of combat events + time), never
`Math.random`.

### Personality — per-mob, spawn-rolled

`{ boldness, patience, packLoyalty }` in 0..1, rolled at spawn from spec defaults
+ run-seeded jitter, so a pack has a coward and a berserker. Authorable per
enemy (`spec.disposition`) — the content layer writes "this thing is a skittish
darter" as DATA.

### Player-read — the awareness substrate (Stage 2)

A shared module (`player-read.ts`, module-level state per the codebase pattern)
the player systems WRITE and mobs READ: `healing`, `guarding`, `justDodged`,
`justWhiffed`, `backpedaling`, plus facing/velocity. This is the seam that makes
`punish` / `bait` / `retreat` / `flank` possible. Cheap producers first (heal,
dodge), richer ones later.

## Determinism

The AI runs in the SIM (`kind:'sim'`) — deterministic + replayable. ALL
randomness goes through `gameRng` (run-seeded): personality rolls, intent jitter,
decision-interval jitter. Mood + timers advance on sim `dt`. (Changing the RNG
draw sequence invalidates OLD replay tapes — acceptable for this prototype.)

## Data surfaces (for the content/design layers)

- `CONFIG.ENEMY_AI.INTENT` — decision cadence, utility weights, mood drift rates,
  press/hold thresholds.
- `EnemySpec.disposition` — per-enemy personality defaults + which intents it may
  use (a tank never `bait`s; a swarm rat loves `harry`).

## Staging

- **Stage 1 — the spine (this doc's first build).** Intent module (pure +
  tested), mood + personality on the Enemy, decision tick, and the intents that
  need no player-read: `close` / `circle` / `watch` / `press`. Delivers tempo
  (lull→burst) + individuality immediately. Attacks become intent-gated.
- **Stage 2 — awareness.** `player-read.ts` + producers; reactive intents
  `punish` / `bait` / `retreat`. The "it has a mind" pass.
- **Stage 3 — the dark.** `flank` to the first-person blind spot; lurk at
  light's edge; in/out of visibility. The DELVE-specific scary pass.
- **Stage 4 — polish + per-spec dispositions.** Author personalities per enemy;
  head/eye tracking (body runs the path, eyes lock on prey); tune per archetype.

## Non-goals

Not a pathfinding rewrite (nav grid stays), not a boss-scripting system (bosses
keep their phase/ability authoring), not learned/LLM runtime AI (this is local +
deterministic per the charter's build-vs-runtime line).
