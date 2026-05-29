# Status Effects (poison / bleed / burn …)

Status effects are **buffs** — they reuse the existing buff runtime, no
separate system. A new status is one entry in `content/buffs.ts`. This
doc is the map of how the pieces fit.

## The layering

- **Primitive (engine):** the buff runtime — `ecs/buffs.ts` +
  `ecs/types.ts`. A buff has a duration, an optional `tickEffect`
  (damage/heal), stat `modifiers`, a `stacks` count, and (new) a `vfx`
  declaration. The runtime ticks them, decays them, scales DoT damage by
  stacks, and routes DoT kills correctly.
- **Presets (content):** `burn`, `bleed`, `poison` are buff entries
  configured from those primitives. Each is a *different texture*, not a
  recolor:
  - **burn** — high, fast, short, no-stack (refresh). Physical. Bursty.
  - **bleed** — medium, **stacks per hit** (cap 5). Physical. Rewards
    fast weapons.
  - **poison** — low, long, stacks (cap 6), **magic-typed so it bypasses
    physical armour** → beats tanks. Spider/acid theme.
- **Application:** anything that hits can apply a status:
  - **Weapons →** `WeaponStats.onHit { buffId, chance, duration }`
    (e.g. the bone needle bleeds). Applied in `combat/attack.ts` after a
    landed enemy hit; stacking statuses ramp with the weapon's hit rate.
  - **Enemies →** `EnemySpec.onHit { … }` (e.g. the spider poisons).
    Applied in `mobs/enemy.ts` after a melee/dash strike on the player.
    Cuts both ways.

## The one real engine fix: DoT death attribution

`computeDamage()` only does the math; HP mutation + the death sequence
(drops, kill event, removal, player death) live in the wrappers
(`enemy.takeDamage`, player health). A raw DoT tick would drop an enemy
to 0 HP **without** killing it properly (no loot, no credit).

Fix: a **damage-sink registry** in `combat/damage.ts`. Enemies register
their `takeDamage`; the player registers its health sink (with a
`quiet` flag so a tick twice a second doesn't strobe the hit-crunch).
A DoT tick calls `applyDamageVia(event)`, which dispatches to the
registered handler — so a poison kill drops loot and credits the kill,
and a burn can actually kill the player, with full feedback.

## Visuals: one field

A buff declares `vfx: { color?, style? }` and the afflicted entity
automatically emits colored motes — `style: 'rise'` (embers, burn) or
`'drip'` (droplets, poison/bleed). Driven by `effects/status-vfx.ts`,
which reads buff data + entity positions in the presentation layer and
spawns from a small additive-sprite pool (the buff runtime stays pure).
Statuses *on the player* also show in the existing buff bar via the
buff's `displayName` + `color`.

## Adding a new status

1. Add a buff entry to `content/buffs.ts` (tickEffect for a DoT, or
   modifiers for a debuff like chill/sunder; set `maxStacks`, `vfx`).
2. Reference it from a weapon `onHit` and/or an enemy `onHit`.

That's it — no engine change. Next candidates: **chill** (modifier:
move/attack-speed down — control, not damage) and **sunder/vulnerable**
(target takes +X% damage — combo amplifier).
