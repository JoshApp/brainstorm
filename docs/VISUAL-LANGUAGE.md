# DELVE — Visual Language

The grammar that makes DELVE look like DELVE. Not a mood board — a set
of RULES that assign *meaning* to rendering features, so the player can
learn to read the dungeon. Companion to the "Lighting as signal" and
"Visual Style Reference" sections of CLAUDE.md; this doc is the
authoring-facing spec the coding/content layers check work against.

Status: living document. We are mid-experiment; rules here are the
current best understanding, and overthrowing one deliberately (with a
note) beats following it accidentally.

## Thesis

**Significant form is REVEALED by colored light out of black.**
No textures — shading *is* the material; light *is* the information.
Three consequences:

1. Darkness is the baseline. Anything visible is visible *for a reason*.
2. Color is meaning, never decoration.
3. The geometry must survive being read as silhouette + light pool,
   because that's how it will actually be seen.

## The lamp is the only honest light

The player's hand-lamp is near-neutral white. Everything else lies:

- **Room torches are rhetoric** — a blood-lit hall *argues* that
  everything in it is blood-colored. Mood torches stay saturated;
  no room source may drift near white, or truth-vs-rhetoric collapses.
- **The lamp is truth** — step close and a painted creature washes
  back to its real bone color. "What color is this thing really?" is
  a *verb*, and the answer is always: bring the lamp.
- The lamp is also the BASELINE brightness. Anything brighter than the
  lamp, or in a color the lamp isn't carrying, is a signal (see budget).

## The three reveal modes (mob materials)

Every creature commits to ONE mode (see `src/content/enemies.ts`
materials, and the monster-reveal taxonomy):

| Mode | Recipe | Meaning |
| --- | --- | --- |
| **ABSORBED** | near-black, rough, emissive 0, NO rim | mundane flesh. The dark keeps it; only its eyes give it away until the lamp finds it. |
| **PAINTED** | pale, matte, emissive 0, NO rim, chroma 1.5–1.8 | a light-meter with legs. The room's color *paints* it (amplified); the lamp restores it. |
| **EMISSIVE** | rim glow (darkReactive) + emissive cores | ARCANE. It makes its own light; that's the warning. |

Guard rails:
- Rim glow = arcane only. A mundane beast with a rim is a category error.
- ABSORBED is the majority. PAINTED is the accent. EMISSIVE is rare.
  If everything goes pale, the dungeon becomes a bone-figurine shelf.
- The player's own hands are PAINTED (chroma 1.8) — a constant,
  diegetic readout of the room's intent.

### What the table above is, and what it is not (measured 2026-08-10)

The rows are a taxonomy someone concluded halfway and nobody ever
checked. Below is the part that has actually been MEASURED, on the real
roster in the real renderer, so it can be argued with.

`scenario=look-mob` stands ten shipping creatures at 2.6 / 4.4 / 6.2 m —
the whole readable band, since `FOG_FAR` is 9 and `CAMERA_FAR` is 10.
Shoot the frame, hide the roster with `__mobsVisible(false)`, shoot it
again: the pixels that changed are exactly the creature pixels. Their
mean |Δluma| against the room behind them is figure-ground separation;
the MID-BAND share is the share of creature pixels sitting at the same
middle value as the dungeon itself.

| roster configuration | mean Δluma | mid-band % |
| --- | --- | --- |
| **as it ships today** | 0.075 | **20.9** |
| 6 absorbed : 2 reflected : 1 self-lit | 0.092 | 14.3 |
| 5 absorbed : 5 reflected | 0.085 | 12.6 |
| all absorbed | 0.066 | 14.3 |
| all reflected (bone) | 0.111 | 13.9 |
| all self-lit | 0.087 | 9.4 |

Two things fall out, and only these two are claimed:

1. **The roster's defect is real and it is mid-value, not brown.** As it
   ships, one creature pixel in five sits at room value — the worst
   figure of anything tested, and roughly double an all-self-lit roster.
   "A lot of creatures are brown" is the symptom; being the same VALUE as
   the floor is the cause, and a brown creature that commits to dark
   reads fine (all-absorbed scores 14.3%).
2. **Figure-ground is not the whole test, so do not rank on the first
   column.** All-bone wins mean Δluma outright and is visibly the worst
   cell on the sheet: ten pale figures separate from the room and not
   from each other. The metric cannot see figure-FIGURE separation.

So the rule the numbers support is two-part — *no creature sits at room
value*, AND *the poles stay unevenly distributed* — and 6:2:1 is simply
the only configuration tested that satisfies both. It is not sacred; a
different uneven split may well beat it. Re-run the probe before
believing any successor.

Known limits of the measurement, stated so nobody over-reads it: the
darker/brighter split conflates "this material is darker" with "this
body occludes a lit floor", and the EDGED/rim question is invisible to
it entirely — a rim is authored at build time and the probe mutates a
live scene, so rims cannot be added or removed this way. The style lab
still owns that one.

## Brightness is budgeted meaning

Value hierarchy in any frame, darkest → brightest:

1. dungeon shell (absorbed walls, clutter)
2. painted forms under room light
3. the lamp pool
4. **signals** — eyes, interactables' glow, arcane rims, god rays

Nothing decorative may out-bright a signal. Corollaries:

- **Eyes are sacred.** Paired hot dots = living threat, nothing else.
  No prop may imitate them. Candles flicker; eyes don't (eyes *track*).
- Eye color is taxonomy (red scurrier, yellow hound, green caster…) —
  keep assignments consistent so players learn the legend.
- Weapon metals live in the painted band, and **shine = worth**:
  mundane metal eats light (high roughness, mid metalness; a thin
  honed-edge strip may gleam), rare/relic metal and treasure gold may
  catch it. Gleam is information about value — don't spend it on
  trash. (The rusted sword was the canonical violation; fixed
  2026-06-10, see sword.ts.)

## Color legend

Small, fixed palette of room moods: blood-red, sickly-green,
moonlight-blue, gold, violet. Each is a promise about the room's
character. One saturated hue per room; two hues only at a genuine
boundary or event. The fill-light auto-tint (builder.ts) keeps all
sources in agreement once a vault commits.

### The atmosphere signature — hues are ASSIGNED now

As of 2026-08, four of those five hues are SPOKEN FOR. A room the floor
plan promotes to a role retints its own wall fixtures
(`src/level/room-signature.ts`), and because the fill-light pass averages
torch tint per room rect, the ambient, the walls and the chandeliers all
follow. What spills out of a corridor mouth is the room announcing
itself — Isaac marks its doors; we have no map, so the light is the mark.

| Hue          | Room     | The promise                     |
| ------------ | -------- | ------------------------------- |
| gold, bright | `trove`  | a gift, laid out                |
| ember, DIM   | `sanctum`| dark, with one warm heart       |
| violet       | `shop`   | someone is trading down here    |
| blood-red    | `arena`  | this one is a fight             |
| sickly-green | `trap`   | something here is wrong         |

Three rules follow, and breaking any of them costs the whole system:

- **Don't spend an assigned hue on decoration.** A violet corridor for
  mood now reads as "shop this way" and lies to the player.
- **Only a type that always means the same thing gets a signature.**
  `feature` stages anything from a blood bargain to a free relic, so it
  has none on purpose. A signature is a promise; a room that can't keep
  it doesn't get one.
- **A signed room is lit at least sparsely** (`signatureLightDensity`) —
  the signature recolours fixtures, it can't conjure them. The one
  exception is the `dark` modifier, whose darkness is its own promise.

Moonlight-blue is unassigned and stays free for vault-authored mood.

## Light placement (unchanged, see CLAUDE.md + god-ray.ts)

God rays anchor content; colored floor glows mark hot spots; never
decorate with either. The known gap (2026-06): some anchor props
(ritual/treasure altars) are still inert geometry — the light keeps a
promise the altar can't. Until altars get a verb (interactable or
Encounter hook), don't add MORE lit altars; close the loop first.

## Overhead status glyphs (added 2026-08)

A creature can carry ONE symbol above its crown, and it means *this one
is open right now*. There are two, and they are deliberately built in
opposite registers so they can never be confused at a glance on a phone:

| Glyph | State | Register | Module |
|---|---|---|---|
| Orbiting sparks | STAGGERED — poise broken, executable | additive, spectral, cold blue-white, moving | `mobs/stun-stars.ts` |
| Bone skull | FEARED — nerve broken, routing, backstabbable | normal blending, dead bone-grey, a dark socket, hovering | `mobs/fear-skull.ts` |

Both sit at the model's measured crown (bounding box, not a guessed
height — a tall body buries a guessed cue in its chest) with depth-test
OFF, so the cue is never occluded by the pillar the coward is hiding
behind. Finding the opening is the reward; hunting for the icon isn't.

Rules for any future glyph:

- **One at a time.** The skull is suppressed while a creature is
  staggered; two symbols over one head is noise, not language.
- **A glyph is a promise of an OPENING**, not a status readout. Do not
  add one for "poisoned" or "burning" — those belong to the body
  (`effects/status-vfx.ts`), which is where the player already looks for
  damage-over-time. A glyph above the head means *go now*.
- **Distinct silhouette before distinct colour.** These read at twenty
  pixels tall through torch glare; a ring of sparks and a skull are
  distinguishable by shape alone, which is what survives the dithering.

## Geometry rules (model authoring)

- **Silhouette first.** Every creature must be nameable as a pure
  black shape with hot eyes, because that's its actual first read
  in-game. If the silhouette needs the material to read, redo the
  silhouette.
- **One gesture line.** The spine curve carries the creature's
  character (ghoul: vulture slump; hound: low skulk; skeleton:
  bolt-upright — the *contrast* is the point). `hunch` bends the
  whole biped chain (skeletons.ts), not just the head.
- **Connection rule.** Every part chains to the spine via bones or
  overlap. No floating heads, no detached tails.
- **Never cute.** Round ears mounted high read as toys; sweep them
  back, drop them lateral, break symmetry. When a creature reads
  "charming," it's wrong.
- **Two-material minimum.** One material = silhouette collapse. The
  rat's bald-skin-vs-fur contrast is the pattern: a second, named
  material on the naked parts (skin, bone, membrane).
- Cones: apex is +Y before rotation. Author the aim with
  `orient()`/named intent, never by flipping signs until it looks
  right (see the 2026-06 quadruped repair — every muzzle in the
  bestiary pointed backward).

## Acceptance: the three-lights test (`npm run bench <subject> --lights`)

A model ships when it reads in all three panels of the contact sheet:

1. **BLACK** — silhouette + emissive/rim only (does the shape read?
   does only the *right* stuff glow?)
2. **LAMP** — near-neutral light (true colors, gesture, connections)
3. **TINT** — one saturated mood color, blood (does painted carry the
   hue? does absorbed stay swallowed?)

The bench readout also runs a structural linter on every render:
`floatingIslands` lists any solid geometry not connected to the main
body (the floating-head class of bug). An island = fix it before
shipping. `aim: 'forward'` on parts (model-types.ts) makes the
backwards-cone class unwritable — prefer it over raw `rot` for any
part whose axis has a meaning.

## Decisions log

- **2026-06-10 — ink outlines REMOVED** (depth-silhouette post pass +
  settings toggle). Decided against: the etched-toon line fought the
  reveal grammar (a silhouette line in the dark is free information
  the darkness was supposed to keep) and stayed toggled off in
  practice. The PS1 crunch (dither, quantize, scanlines, banded
  lighting) remains the period look.
- **2026-06-10 — amber tint HALVED** (1.05/1.00/0.92 →
  1.025/1.00/0.96), tested in the `?scenario=tint-lab` colour-legend
  bench. Finding: the multiplicative tint barely affects the dark
  mood range — the suspected legend-crush mostly comes from warm
  torch/lamp light colours, which are per-room design choices, not a
  post bug. Revisit room hue commitment before blaming the post chain.

## Item visual language — type / stat / domain (added 2026-08)

The player reads a piece of loot at a glance through ONE coherent legend,
shared across every item surface (inventory details, the floating
altar/pickup card, the shop preview — all compose `buildDetailsHeader` +
`describeItem`):

- **Stats** — `src/ui/stat-icons.ts`: a heart for life, a blade for damage,
  a shield for armour, plus bolt/spark/drop/crack for speed/crit/leech/hazard.
  Each stat-modifier line leads with its tinted category sigil.
- **Domains** — `src/ui/domain-icons.ts`: one icon + one colour per domain,
  drawn in that domain's own `register.color` (blood droplet · bone · rot
  spore · ash flame · dawn spark · grace halo · valor chevron · greed coin ·
  forbidden eye). The item-card meta line shows the domain as icon + name.
- **Cursed** — its own identity (the CHAOS mark): a violet chaos-star.
  `CURSED_VISUAL`. Cursed is the deep's independent corruption — it can ride a
  domain or stand alone; a cursed item gets the violet mark + bold CURSED so
  "something is wrong with this" reads instantly.

Rule: a NEW stat, domain, or rarity that the player must read gets an entry in
these legends — never a bare text label that blends into the rest.
