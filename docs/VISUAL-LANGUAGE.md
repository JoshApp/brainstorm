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
