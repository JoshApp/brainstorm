# Creature System — charter (the enemy rebuild, "B")

> Status: **proposed.** Replaces the early-days enemy model stack (flat
> `ModelSpec` + hand-typed `aimHeight` + maybe-a-`head`-part + per-enemy joint
> guesses). Skeleton-first. Built as a vertical slice, then migrate enemies one
> archetype at a time. Legacy enemies keep running until migrated.

## Why redo it

The audit (this branch) found there is **no shared contract** for what an enemy
*is*:

- **Dimensions are typed, not known.** `aimHeight = spec.aimHeight ?? 0.6×scale`
  assumes a ~1.05 m rig; it's wrong for the ooze (0.18), rat (0.14), acolyte
  (0.85), and the king (core at 1.3 despite scale 7). Hurtboxes, the above-head
  anchor (stars/boss-bar), and damage-number height all inherit that guess.
- **Hitzones are accidental.** The head sphere exists only if a model happens to
  name a `head` part. The stoneguard and ooze don't, so they have no head zone.
  The body capsule is `aimHeight × [0.35 .. 1.45]` — a guess off a guess.
- **Animation has no skeleton.** Keyframe clips drive `pelvis`/`spine`/`hipL/R`;
  legacy models lack those joints, so clips silently no-op. Each enemy hand-rolls
  which joints exist; the body animator hopes for `neck`/`hipL/R`.
- **Presentation is string-coupled.** `flashMaterialName`/`eyeMaterialName` are
  hardcoded (`body`/`eyes`/`core`/`no-eyes`) and unchecked — a missing material is
  a runtime error.

## The model: skeleton-first creatures

Invert the dependency. **The skeleton is the source of truth**; geometry,
dimensions, hitzones, and animation all *derive from it*.

A creature picks an **archetype** (a standard joint hierarchy with rest
proportions), tunes **proportions**, hangs **skin** (primitives) on named joints,
and optionally overrides **zones**/**materials**. Everything else is computed.

### Archetypes (the skeletons + their clip libraries)

| archetype    | skeleton (joints)                                               | covers |
| ------------ | --------------------------------------------------------------- | ------ |
| `biped`      | root→pelvis→spine→neck→head; pelvis→hipL/R→kneeL/R→footL/R; spine→shoulderL/R→elbowL/R→handL/R | ghoul, skirmisher, defiler, skeleton, stoneguard, acolyte, wraith, marrow |
| `quadruped`  | root→spine→neck→head; spine→(fore/hind)(L/R) leg chains          | rat, hound |
| `blob`       | root→core (+ optional wobble ring joints)                       | ooze, king-ooze, spore, wisp |
| `arachnid`   | root→cephalothorax→head; 4–8 leg chains                          | spider |
| `serpentine`/`flier` | root→segment chain / wing joints                        | (as needed) |

Each archetype ships a **clip library** authored once in its joint space
(`walk`, `idle`, `stagger-tumble`, `windup-overhead`, `lunge`, …). Any creature
of that archetype plays them — new enemy = new skin, animation included.

### `CreatureSpec`

```ts
interface CreatureSpec {
  id: string;
  archetype: Archetype;
  /** Scale the archetype's rest skeleton: height, headSize, limbLength, girth,
   *  hunch, neckLength… All optional — defaults per archetype. */
  proportions?: Partial<Proportions>;
  /** Primitives hung on joints: each part's `joint` names the bone it rides.
   *  Same primitive vocabulary as today (box/sphere/capsule/csg/lathe/…). */
  skin: SkinPart[];                 // SkinPart = PartSpec & { joint: string }
  /** Weak/armor/openWhenStaggered zones layered over the AUTO per-bone zones. */
  zones?: HurtZoneSpec[];
  materials: Record<string, MaterialDef>;
  /** Presentation bindings — explicit, validated at build (no magic strings).
   *  Omit `eyes` for eyeless mobs; `flash` defaults to the whole body. */
  eyes?: { material: string; emissive: number; halo?: boolean };
  flash?: { material?: string };
  /** Per-bone merge control: bones NOT listed here are merged (static); listed
   *  bones stay separate + animatable. Default: the archetype's moving joints. */
  dynamicJoints?: string[];
}
```

`aimHeight`, `collisionRadius`, `hitRadius`, `scale`, `tiltPartName`,
`flashMaterialName`, `eyeMaterialName`, `baseEyeEmissive` all **leave `EnemySpec`**
— they're derived/declared by the creature.

## The build pipeline → `Creature`

`buildCreature(spec)`:
1. **Instantiate skeleton** — archetype joints at rest, scaled by `proportions`.
2. **Build + attach skin** to its `joint` (reuses today's primitive builders,
   CSG, jitter, rim, dissolve — that part is good, keep it).
3. **Measure** — bounds per bone (from attached skin) and overall: `height`,
   `top`, `center`, fitted body `radius`, head centre. The one source of truth.
4. **Auto-hurtbox** — a body capsule along the spine, a head sphere at the head
   joint, **limb capsules** on arms/legs, each sized from the bone's skin.
   Locational damage for free (Souls/Mordhau-style). Apply `zones` overrides.
5. **Merge** static bones' skin (draw + shadow win); keep `dynamicJoints` live.
6. **Bind + validate** presentation (eyes/flash materials must exist), build eye
   halos if `eyes.halo`.
7. Return `Creature`.

```ts
interface Creature {
  group: THREE.Group;
  bounds: { height: number; top: number; center: THREE.Vector3; radius: number };
  joints: Map<string, THREE.Object3D>;     // the skeleton (animation + anchors)
  parts: Map<string, THREE.Object3D>;
  materials: Map<string, THREE.Material>;
  hurtbox: Hurtbox;                          // auto per-bone + overrides
  anim: CreatureAnim;                        // setBase/playOverride + procedural layers
  // presentation
  setEyeFlare(t: number): void;
  hitFlash(): void;
  setDissolve(v: number): void;
}
```

Game code stops reaching into raw meshes by string and hoping — it reads
`creature.bounds`, `creature.hurtbox`, `creature.joints`, `creature.anim`.

## Animation

- **Archetype clip library** — shared clips in joint space, played via the
  existing `Animator` (base/override layering is good; keep it).
- **Procedural layers become generic** functions of the skeleton: gait (hip
  swing), head-crane (aim `neck`/`head` at the player), knockback, the
  **stagger dizzy-tumble**, presence overlays — written once against the
  skeleton, not per-enemy. Today's `enemy-animation.ts` overlays move here,
  generalized.
- **Telegraph = a windup clip** per ability, blended in.

## What this fixes (maps to the audit)

- aimHeight brittleness → **measured `bounds`**.
- head-may-not-exist → **auto head sphere at the head joint** (every biped has
  one); blobs declare a `core` zone instead.
- guessed body capsule → **per-bone capsules from real skin**.
- joint mismatch / clips no-op → **archetype skeleton guarantees the joints**.
- material-name coupling → **explicit, validated `eyes`/`flash` bindings**.
- visual scale ≠ gameplay → **one measured frame**; `proportions` scales the
  skeleton and everything follows.

## Migration — vertical slice, then archetype-by-archetype

`EnemySpec` keeps its **stats / AI / behavior** fields (hp, poise, abilities,
presence, phasing, aura, burrowed, splitsInto, phases, drops…). Only the
**model + dimensions + animation** layer is replaced: `model: ModelSpec` →
`creature: CreatureSpec`. `enemy.ts` reads dimensions/hurtbox/joints from the
built `Creature`. A thin shim lets the remaining legacy `ModelSpec` enemies keep
running on the old path until each is migrated.

### Rollout
1. **Core + biped.** `creature-types.ts` (spec + skeleton), `build-creature.ts`
   (build/measure/auto-zone/merge), the biped skeleton + a starter clip library,
   the `Creature` API, and the consumer shim in `enemy.ts`.
2. **First enemy end-to-end: the stoneguard.** Tall biped we're already testing —
   exercises measured height (stars sit right), head + limb zones, stagger
   tumble, the molten-core weak zone, execute. Ship it; legacy enemies untouched.
3. **Migrate the rest** one archetype at a time (biped roster → quadruped → blob →
   arachnid), deleting legacy model factories as each archetype empties. Then
   remove the shim.

Combat work never freezes — every step ships, old enemies keep fighting.
