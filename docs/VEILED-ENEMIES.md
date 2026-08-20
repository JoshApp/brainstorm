# Veiled enemies — eyes first, form later

**Status:** charter, not built. Written 2026-08-20 from Josh's brief.

> *"approaching a room from a corridor we kinda need the marker system that we use for embers
> and make a visual style for enemies where its like eyes only and then veiled silhouette and
> glowing parts"* — and *"i would like to kinda peer into a room and see oh lots of eyes"*.

## The problem, stated exactly

An enemy today is **one object with one visibility flag**. `level.enemies[i].group.visible` is
set true or false by the room culler, from whether that mob's rect is being rendered. So:

- **It pops.** A mob crosses into a rendered rect and its entire body appears at full material
  in one frame. There is no state between absent and present.
- **It attacks from nowhere.** The cull hides the enemy; it does not hide what the enemy DOES.
  Its AI keeps ticking by design, so melee lands and projectiles fly from something that is not
  drawn. Projectiles are not room-culled at all, so a bolt genuinely emerges from empty air.
- **A dark room reads as empty.** Peering down a corridor into an unlit chamber tells you
  nothing. The information the player wants — *how many things are in there* — is exactly the
  information darkness currently destroys.

None of these is a lighting problem. All three are the same structural fact: **the thing that
signals and the thing that has form are the same object, so they live and die together.**

## The idea

Three tiers of presence, and the player walks up through them:

| | what is drawn | when |
| --- | --- | --- |
| **EYES** | two emissive points, nothing else | the space is visible but dark, or far |
| **VEILED** | eyes + a near-black silhouette + any glowing parts | the space is dimly lit, or nearer |
| **REVEALED** | the full creature, materials and all | the lamp or a torch is on it |

Crucially these are not three assets. They are **one creature whose parts belong to different
layers**, and the layers already behave differently.

## Why this is mostly plumbing, not new rendering

Three systems that already exist do almost all of it.

**`scene/signal-layer.ts` already splits the channel.** It was written from Josh noticing a torch
flame surviving through a veiled doorway, and its own header names the case: *"gate rendering of
things besides things like glowing monster eyes and other such markers."* The lit layer is drawn
before the veil and multiplied toward nothing; the signal layer is drawn after it at full
strength. Signals keep `depthTest`, so a wall still occludes them and a doorway does not. **That
is precisely the eyes-through-a-doorway behaviour, already working, for flames.**

**Enemies already have eyes.** `mobs/enemy-presentation.ts` runs an `EyePresenter`: sprite-billboard
halos that dim when unaware, blaze and shift hot-red on windup, and flash a flat threat colour for
the deflect telegraph. The visual vocabulary is built and tuned. It is simply attached to a body
that gets culled.

**`effects/embers-gpu.ts` is the pattern for many points cheaply.** One `Points` draw, a
`PointsNodeMaterial`, emitter positions in a `frameGroup` uniform array, trajectories evaluated in
the vertex node. No per-particle CPU, no draw per emitter. A room of twelve mobs is twenty-four eye
points in **one draw** — which is what makes "lots of eyes" affordable at any count.

## What actually has to change

1. **Split the creature's presentation.** The body, armour and weapon are LIT. The eyes and any
   authored glow (the acolyte's light, a bone glint, a rune) are SIGNAL, via `markAsSignal`.

2. **Cull the halves separately.** The room culler currently sets one flag on `e.group`. It should
   cull the LIT half on the existing rule — a packed room behind a wall is the saving this exists
   for and it must survive — and leave the SIGNAL half to the signal layer's own occlusion, which
   is already depth-correct. An enemy behind a wall stays invisible (Josh: *"it can be invisible
   when its hidden by culled geometry"*). An enemy in a dark room you can see into becomes eyes.

3. **Promote eyes to the GPU points system when counts justify it.** Sprites per enemy are fine at
   three mobs and wrong at twenty. The embers pattern ports directly: a uniform array of eye
   positions and colours, updated per frame from live mobs, one draw.

4. **Give projectiles a source.** A bolt from an unseen shooter should still read as *fired*, not
   *spawned*. Cheapest honest fix: a muzzle signal at the origin — the shot briefly lights its own
   caster, so the flash tells you where it came from even when the caster does not.

## The rules that keep it honest

These follow from the light doctrine (`docs/VISUAL-LANGUAGE.md`) — an uncommon light means
something is happening there — and they are what stop this becoming a wallhack.

- **Depth still occludes.** Eyes are not seen through walls, ever. The signal layer already
  enforces this; nothing here may weaken it.
- **Eyes are a count, not a targeting reticle.** They say *how many* and *roughly where*. They must
  not resolve the thing well enough to fight it — that is what the REVEALED tier is for, and it
  costs the player light, which is the game's actual currency.
- **The colour is the species' promise.** Eye colour should read as faction/kind before form does,
  so a constellation in the dark is already information: this is a pack of X, not a Y.
- **Unaware eyes are dimmer than aware ones.** The presenter already does this. In a dark room it
  becomes the whole read: a room that has noticed you looks different from one that has not,
  before you can see a single body.

## Open questions

- **Does an idle mob in a dark room show eyes at all?** Showing them makes darkness informative;
  hiding them makes the dark genuinely dangerous. Possibly the answer is that *unaware* eyes are
  only visible closer than *aware* ones — the room notices you and the constellation lights up.
- **Do eyes fade with distance, or stay pin-bright?** Pin-bright reads as depth and scale. Fading
  reads as atmosphere. This wants trying both, not deciding on paper.
- **What does a thing with no eyes do?** A construct, an ooze, something masked. It needs its own
  signal — a rune, a seam of heat, a glint — or it becomes the enemy that darkness hides
  completely, which may be a feature worth having deliberately rather than by omission.
