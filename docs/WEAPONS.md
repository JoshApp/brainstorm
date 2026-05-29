# Weapon Archetypes & Ranged

The design space for weapons + the plan for ranged. Decisions locked
with Josh; implementation rolling out incrementally.

## Two constraints that shape everything

1. **One-thumb, no fine aiming.** Combat is "face roughly at it, commit,
   the cone auto-targets." Ranged must NOT need a reticle: it **auto-
   targets** the nearest enemy in the forward arc (the same cone, longer
   range), and **tap-target** (already built) lets you focus a specific
   enemy — e.g. the back-line caster over the melee in front.
2. **Crunchy melee is pillar #1.** Ranged must not obsolete melee, so it
   is **constrained**. Locked model: **cooldown / draw** — ranged attacks
   have a reload/draw time, no ammo, no inventory friction. The cost is
   in the cadence (a bow's draw, a crossbow's reload, a wand's recharge),
   not a resource to manage.

## Differentiator axes

range band · cone shape (narrow↔sweep) · cadence (flurry↔commit) ·
targets (one↔many) · status identity (bleed/chill/poison/burn/sunder) ·
resource (free / cooldown).

## The archetype map

**Melee (have):** dagger (fast/crit/bleed), sword (baseline), hammer
(slow/wide/sunder).

**Melee extensions (ammo-free, new playstyles):**
- **Spear / polearm** — long narrow cone, hits the FRONT RANK from a
  step back. Anti-swarm / anti-charger.
- **Greatsword / flail** — very wide arc, low per-hit, sweeps multiple.
  Crowd-clear.

**In-between:**
- **Throwables** — thrown axe/knife/fire-flask. Projectile but short +
  **consumable-count limited** (lives in the consumable bar). Fire-flask
  = thrown AoE burn (reuses the aoe telegraph + projectile pool).
- **Charge-melee** — hold to wind a lunging strike (reuses the dash
  effect). Gap-close toward the fight.

**Ranged:**
- **Crossbow / bow** — single bolt at the auto-target. Crossbow = reload
  cooldown; bow = draw windup. Soften / snipe the back-line.
- **Wand / staff (magic)** — the player casts: a magic bolt that
  **bypasses physical armour**, on a recharge cadence. A caster build.

## Three delivery homes (this is the keystone)

Ranged doesn't replace your sword — it has three homes, and using all
three is what keeps melee alive:

| Home | Hosts | Constraint | Role |
|---|---|---|---|
| **Main hand** | melee classes OR a ranged class (crossbow/wand) | draw/reload | your PRIMARY style — melee vs ranged build |
| **Offhand** (lamp/shield today) | a sidearm — hand-crossbow, knife bandolier | cooldown | melee-primary players get a secondary poke / back-line tool |
| **Consumable bar** (exists) | throwables — bombs, fire-flasks | count | single-use AoE/utility for everyone |

A melee-first player keeps the crunchy sword AND gets ranged via the
offhand + thrown flasks. A ranged-build player puts a bow/wand in the
main hand and accepts the cadence tradeoff. Both first-class.

## Why melee stays relevant

Ranged is constrained (draw/reload); melee is the reliable, free,
high-close-DPS option. Statuses cut both ways (a poison bow softens, a
bleed dagger out-DPSes up close). The dungeon is tight — enemies close
fast; pure-ranged gets punished without spacing, like the acolyte.

## Implementation plan (rolling)

1. **Ranged engine + crossbow** (main-hand, physical) — player-side
   projectiles (pool gains a `friendly` side that hits enemies via the
   damage-sink so kills drop loot), an auto-target (cone-nearest +
   tap-target focus), a ranged weapon class whose strike FIRES a bolt
   instead of the melee cone, with a slow draw/reload cadence. Avoids
   touching main.ts (the pool reads enemies from a provider registered
   in createCombatSystem). ← building now.
2. **Wand** (main-hand, magic) — same engine, arcane bolt, armour-
   bypassing. Trivial once the engine exists.
3. **Viewmodel polish** — crossbow/wand fire/recoil animation + meshes
   (first pass reuses the thrust pose).
4. **Offhand sidearm** + **throwable consumable** (fire-flask).
5. **Spear** (reach melee), then back to **affix→on-hit + rarity +
   sets** so all of it becomes generative loot.
