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
- Weapon metals live in the painted band. A trash-tier blade bouncing
  torchlight like chrome out-shines real signals (open issue: the
  rusted sword blade currently reads near-glowing under warm torches —
  fix its roughness/metalness, not the torch).

## Color legend

Small, fixed palette of room moods: blood-red, sickly-green,
moonlight-blue, gold, violet. Each is a promise about the room's
character. One saturated hue per room; two hues only at a genuine
boundary or event. The fill-light auto-tint (builder.ts) keeps all
sources in agreement once a vault commits.

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

## Acceptance: the three-lights test (planned bench mode)

A model ships when it reads in all three:

1. **black** — silhouette + emissive/rim only (does the shape read?
   does only the *right* stuff glow?)
2. **lamp-only** — neutral light (true colors, gesture, connections)
3. **room-tint** — one saturated mood color (does painted carry the
   hue? does absorbed stay swallowed?)

Until the bench grows a `--three-lights` contact sheet, approximate
with `--ortho` + judgment against the rules above.

## Decisions log

- **2026-06-10 — ink outlines REMOVED** (depth-silhouette post pass +
  settings toggle). Decided against: the etched-toon line fought the
  reveal grammar (a silhouette line in the dark is free information
  the darkness was supposed to keep) and stayed toggled off in
  practice. The PS1 crunch (dither, quantize, scanlines, banded
  lighting) remains the period look.
