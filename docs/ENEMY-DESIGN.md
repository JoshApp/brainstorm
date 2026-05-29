# Enemy Design — the verb map

Companion to `docs/DESIGN.md`. The governing principle: **every enemy
must teach a different verb.** If a new enemy doesn't make the player
*do something they don't already do*, it hasn't earned a slot — it's
just more HP to chew through. This doc is the live audit of the roster
against that rule.

## What the AI can actually express today

Before designing an enemy, know the behaviour vocabulary
(`src/mobs/enemy.ts`). The state machine is chase → wind → strike →
recover. On top of that, a spec can opt into:

- **melee strike** with a telegraph (windup) that's escapable when
  `strikeRange < attackRange`.
- **ranged** — strike phase fires a projectile instead.
- **preferredRange** (kiter) — backs away to hold a standoff band so
  it can't be free-killed at point blank. *Added in the verb-audit
  pass.*
- **splitsInto** — spawns children on death.
- **phasing** — ignores obstacle collision (walls still bound it).
- **armor** (physical/magic) — forces sustained damage / a damage type.
- **perception** (sight cone / hearing / lose-sight) — stealth-ish
  avoidance, weak as a combat verb.

Not yet expressible (each would unlock a new verb): **charge / leap
gap-close**, **AoE / zone denial (puddles, ground slam)**, **summon /
buff allies**, **directional block**.

## Roster verb map

| Enemy | Verb it teaches | Status |
|---|---|---|
| ghoul | read the telegraph, punish the recovery | ✅ baseline melee verb |
| stoneguard | time the dodge, grind through armor | ✅ distinct |
| wraith | can't juke around pillars; bring magic-armor | ✅ distinct (phasing + magic) |
| ooze | AoE / positioning so the split is contained | ✅ distinct |
| acolyte | **run it down** — kite-breaker | ✅ *fixed this pass* |
| acid-spitter | **commit & burst** — push the holder | ✅ *fixed this pass* |
| rat | clear chaff, don't get surrounded | ⚠️ weak verb; fine as cheap chaff |
| skirmisher | **sidestep the charge**, punish the recovery | ✅ *fixed — now the charger* |
| defiler | **don't stand there** — keep moving off the hex | ✅ *zone control* |
| skeleton | **close and break it** — pressure at every range | ✅ *new — ranged+melee, advances* |
| ooze-small | (recursion terminator / cleanup) | — |

## The verb-audit pass (what changed & why)

**Problem found:** the movement AI was pure chase. Ranged enemies
closed to `attackRange`, stopped, and shot — but never retreated. So
acolyte and acid-spitter were both free kills at point blank AND played
identically. Two of nine enemies taught nothing.

**Fix 1 — kiting (`preferredRange`).** A ranged enemy with
`preferredRange` set backs away when the player is nearer than that
band, so "close the gap under fire" becomes a real verb. Rushing it
during its windup still beats it (it can't retreat while locked in a
strike) — emergent, learnable counterplay.

**Fix 2 — split the two ranged identities into a matched pair:**
- **acolyte = the kiter.** Mobile (moveSpeed 1.7), squishy (2 HP),
  `preferredRange` 5.5. Runs from you; chase it down, corner it, or
  rush its cast. Reward for closing is quick.
- **acid-spitter = the holder.** Glacial (0.8), tanky (4 HP), NO
  kite, fast fire cadence (windup 0.85 / recover 0.55). Plants and
  chips you the longer you stay at range; closing works but is a real
  commitment because it's beefy and its acid ignores armour.

They're now foils: one makes you cover ground, the other makes you
commit through chip. Same "deal with ranged" family, opposite answers.

## Roadmap — next brutal moves (not yet done)

- ~~**skirmisher → charger/leaper.**~~ ✅ DONE — first user of the
  ability system. Coil → dash (speed 7.5, catches a backpedalling
  player) → contact slam, with a point-blank slash fallback. Teaches
  "sidestep, don't retreat." See `docs/COMBAT-ARCH.md`.
- ~~**An AoE / zone-denial enemy.**~~ ✅ DONE — the **defiler** drops a
  telegraphed ground hex at your feet (the `aoe` ability effect + a
  ground-ring telegraph). Teaches "don't stand there." Reuses the ghoul
  silhouette recoloured violet — a distinct model is pending the
  parametric-creature pass.
  A ground-slam or acid-puddle layer would add the positioning-over-
  time verb. Bigger lift (new attack system).
- **rat** is acceptable as chaff but could become genuinely
  swarm-defined (only dangerous in numbers, near-harmless solo) so its
  verb sharpens to "manage the crowd, don't get pinned."
