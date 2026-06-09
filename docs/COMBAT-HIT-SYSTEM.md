# Combat Hit System — charter

> Status: **in progress.** Target side (hurtbox zones) is being built first;
> attacker side (per-move hitboxes + unified resolver) follows. This doc is the
> spec the rework is built against — when code and doc disagree, fix one of them
> on purpose, not by accident.

DELVE is a first-person, mobile, torch-lit melee crawler. Combat feel is pillar
#1. This document defines how a swing becomes a hit, engineered from scratch so
the system is coherent, data-driven, and legible to the content/design layers
(see CLAUDE.md "Authoring Model").

---

## How the best games do it (the references we steal from)

A quick map of the design space, from "pure authored data" to "trace the literal
weapon mesh", and what each one teaches us.

- **Fighting games (Street Fighter / Tekken / Smash)** — the source of the
  vocabulary. Every move is **hitboxes** (attacker volumes) and **hurtboxes**
  (target volumes), authored per animation, live only during **active frames**
  (startup → active → recovery). Resolution is volume-overlap, no physics. Gives
  us: active windows, **hitstop**, **per-hit dedupe**, priority/trades.
- **Character-action (DMC / Bayonetta / God of War)** — hitbox volumes ride the
  weapon bone, enabled on active frames and **swept between frames** so fast
  swings don't tunnel. Multi-hit with per-target cooldown.
- **Souls / Elden Ring** — weapon **hit capsules** along the blade, continuous
  collision against enemy **hurtbox capsules**. The gameplay capsule is a little
  **fatter than the visual blade** for feel; early-windup **tracking** rotates
  the attack toward the target; **poise/stagger** gates interrupts. (We already
  have poise/stagger + hitstop.)
- **FP dueling sims (Mordhau / Chivalry 2)** — trace the **actual animated
  blade** as a capsule every tick with sub-tick CCD; per-bone locational
  hurtboxes. Maximally skill-expressive, maximally unforgiving, and it needs the
  weapon at world scale on a real skeleton. **Not our lane** — our FP weapon is a
  `camera.add(group)` overlay at arm's length (~0.5 m); its blade literally
  cannot reach a mob at 1.9 m.
- **FP immersive-sim / boomer-melee (Dark Messiah / Skyrim / Dread Templar)** —
  the forgiving, polished approach: a capsule/sphere **swept forward from the
  camera-aim** during the active window; the animation sells the motion, the hit
  respects where you look; locational hits common. **This is our lane.**
- **Mount & Blade** (blade polyline trace, **momentum = damage**) and **Monster
  Hunter** (**motion values** per attack, **per-part hurtzones** with weakness
  multipliers) round it out.

### Principles we adopt

1. **Hitbox ≠ hurtbox.** Both are real authored volumes.
2. **Active window.** The hit is live during a *slice* of the strike, not the
   whole animation.
3. **Swept / continuous.** Interpolate the volume across the arc *and* between
   frames. No tunneling.
4. **Capsules + spheres are the workhorse.** Cheap closest-distance math.
5. **Inflate the gameplay volume past the visual** — the honest, 3D forgiveness
   knob. Never flatten an axis to forgive.
6. **Hit-once-per-swing**, multi-target nearest-first.
7. **Locational, toggleable hurtzones** (body / head / weak point / armor) with
   damage multipliers — the depth that reads as "state of the art."
8. **Attacks and bodies are DATA**, authored separate from the resolver — the
   build-time interface the content layer plugs into.

---

## DELVE's model: aim-frame swept capsules vs. locational hurtbox zones

One target-volume model, one attacker-volume model, one resolver. The debug
overlay draws the **exact structs the resolver reads** — so "draw the actual
objects" is true by construction.

### Target side — hurtbox **zones** (this is what we build first)

An enemy's hurtbox is an ordered list of **zones**. Each zone is a named volume
(capsule or sphere) in the enemy's local frame, with a damage multiplier and a
runtime **enabled** flag. This generalizes "the head" into a full toolkit:

| role    | damageMul | meaning                                                        |
| ------- | --------- | -------------------------------------------------------------- |
| `body`  | 1.0       | the always-present baseline volume (feet → shoulders capsule)  |
| `head`  | ~1.5      | locational bonus + crit-on-hit; a sphere on the head bone      |
| `weak`  | > 1.0     | a **vulnerable zone** — a glowing core, an exposed back, a boss weak point. Toggle **on** to open a damage window. |
| `armor` | 0 … < 1   | an **armored zone** — blocks or soaks. Toggle **off** (break the armor) to expose what's behind it. |

```ts
ZoneShape =
  | { kind: 'capsule'; a, b, radius }   // local-space segment + radius
  | { kind: 'sphere'; center, radius }  // local-space centre + radius

HurtZone {
  id: string                 // 'body' | 'head' | 'core' | 'left-pauldron' | …
  shape: ZoneShape           // geometry in the enemy ROOT-local frame
  role: 'body' | 'head' | 'weak' | 'armor'
  damageMul: number          // 0 = immune, 1 = normal, >1 = weak point
  enabled: boolean           // runtime activate/deactivate
  priority: number           // when a hit overlaps several enabled zones, highest wins
  follow?: Object3D | null   // if set, the zone tracks this animated bone's world transform
  crit?: boolean             // force a crit when this zone is the one hit (head defaults true)
}

Hurtbox { root: Object3D; zones: HurtZone[] }
```

- **Activation / deactivation is the headline feature.** `setZoneEnabled(id,
  on)` flips a zone live. Phase-gated boss weak points, "break the carapace then
  the core opens," sever-a-limb-to-disable-an-attack — all fall out of this. A
  disabled zone is skipped by the resolver and drawn ghosted in debug.
- **Bone-following.** A zone with `follow` set tracks an animated part (the head
  sphere rides the head bone; a weak point rides a flailing arm). Without it the
  zone is static in the root-local frame (and so rotates with the body's facing,
  which is what you want for a forward-offset head on a non-animated model).
- **Derivation with override.** `deriveHurtbox(spec, built)` builds sane
  defaults from the model: a body capsule from `aimHeight` + height + `max(hitRadius,
  collisionRadius)`, and a head sphere when the model exposes a `head` part. A
  spec can override or add zones (a boss authors its `core`). The content layer
  only authors the *exceptional* — most mobs get body+head for free.

### Attacker side — per-move hit volume (built next)

Each combo step / move declares its hit volume in the **aim frame** (origin =
camera, basis = camera orientation **including pitch**), replacing the abstract
`reachMul` / `coneHalfAngleMul` scalars:

```ts
MoveHitbox {
  activeStart, activeEnd   // normalized [0..1] slice of the strike it is live
  proximal: [x,y,z]        // near capsule end, aim-local (−Z forward, +Y up)
  distal:   [x,y,z]        // far end — a thrust sits far/forward; a sweep arcs;
                           //   a smash travels high→low across the active window
  radius                   // precision knob (visual ≈ this; inflated by a global)
  maxTargets
}
```

The capsule sweeps **two ways**: along the authored arc over the active window,
*and* between frames (CCD). **Pitch matters** — aim low and the capsule dips to
the rat at your feet; aim up and you skewer the tall thing. This is the original
"hits should be 3D" ask, solved by geometry, not by ignoring the vertical axis.

### The resolver (one path)

Swept weapon capsule vs. each enabled enemy zone → closest-distance ≤ Σ radii.
Per-swing dedupe (one hit per enemy per swing). Among the zones an enemy's hit
touches, the **highest-priority enabled** zone wins and supplies the
`damageMul` + crit flag. Nearest enemies first, up to `maxTargets`.

`hasEnemyInRange()` and the tap arbiter (attack-vs-interact) call the **same**
predicate — today they use a *different* test, which is a real source of "tapped
and it did the wrong thing."

**Props go through the same path.** Destructibles (vases, crates, cobwebs) are
already ECS entities implementing `Damageable`; they now carry a `hurtbox` too —
a single forgiving body sphere (`propHurtbox`) — so the swing resolver tests
them exactly like enemies (`swingHitTargets` over any `Damageable`). There is no
separate destructible hit-test; a prop is just a target with one `body` zone and
no head/weak. `hurtbox` is part of the `Damageable` contract, so everything a
swing can hit presents zones.

### Executions / finishers (the poise payoff + the sustain loop)

Poise/stagger was invisible because trash dies before it breaks. The fix is a
*payoff*: an enemy is **executable** when it's **staggered** (poise broken — the
Dark Souls riposte path, finally a reason to break guard) OR at/below
`EXECUTE.HP_FRAC` of max HP (the DOOM chip path, seen on any meatier foe). A
heavy hit on an executable enemy is a **finisher**: ×`EXECUTE.DAMAGE_MUL` damage
(lethal in nearly all cases), a heavier crunch, the loud white-on-blood "EXECUTE"
number, and a **reward** — `EXECUTE.HEAL` + `EXECUTE.STAMINA`. Sustain is therefore
**earned + kill-based**, never a per-hit drain.

This is the per-weapon identity surface: a dagger executes at a *higher* HP
threshold (assassinate) + backstab; a hammer's whole job is to *make* foes
executable (stagger) → the riposte weapon; a scythe *heals more* on execute → the
vampiric reaper (sustain via finishers, not per-hit). All knobs are data
(`CONFIG.EXECUTE`); frequency vs. power is `HP_FRAC` × `DAMAGE_MUL` — raise
`HP_FRAC` for more finishers, lower it to make them special.

### Forgiveness — precise but tunable

Author volumes **precise** (≈ the visual). One global `HITBOX_INFLATION` knob in
`config.ts` adds to the weapon capsule radius: `0` = honest, `> 0` = generous.
Start generous on the phone, tighten as it feels right. Point-blank guarantee
(anything overlapping you connects) stays. Forgiveness is always 3D volume,
never axis-flattening.

---

## Constraints this honors

- **Mobile-first, camera-is-aim.** No mouse-drag swing manipulation; the camera
  orientation is the swing axis. Forgiveness lives in volume size.
- **Deterministic + local.** All hit math is local and seed-stable — required
  for the planned async multiplayer and for replays. No runtime LLM in the hit
  path (that lane stays in `broadcast/`).
- **Ranged stays separate.** Crossbow/wand/knives keep their projectile +
  auto-aim path; this rework is the melee swing.
- **Data interface.** Move hitboxes and enemy zones are data with named, stated
  fields so the content layer authors against them without reading the resolver.

---

## Rollout

1. **Target side (now).** `hurtbox.ts` zone model + derivation + geometric
   tests; enemies own a `Hurtbox` and expose `setZoneEnabled`; the debug overlay
   draws the real zones (body/head/weak/armor, ghosted when disabled). Fixes
   "enemies don't draw their hurtboxes" and lands the activate/deactivate API.
2. **Attacker side.** `MoveHitbox` per move + the unified swept capsule
   resolver, sword-first; `hasEnemyInRange` + tap arbiter unified onto it.
3. **Per-move shaping + head damage.** Author each move's capsule to match its
   animation; wire head/weak/armor multipliers into damage + a distinct "ping".
4. **Tune + retire legacy.** Expose `HITBOX_INFLATION`, tune on phone, delete
   `swingShape` / cone / `pickTargets` dead code, refresh this doc.

### On "start clean with one weapon"

We keep weapon **content** (specs, classes, movesets, proficiency, scaling) — it
is good data. We rebuild the hit **layer** under it. The unified resolver comes
online **sword-first**; other classes run on a parity shim until each one's
`MoveHitbox` set is authored, then they switch over one at a time. Nothing in the
content layer is discarded.
