# Atmosphere and polish — the plan

> Written 2026-11-24, after the Lamplight UI pass and the LOOK TEST shipped, at Josh's
> request ("write it down so we don't lose it"). Status: **agreed direction, not built.**
> The visual grammar it builds on is docs/VISUAL-LANGUAGE.md; the enemy work that runs
> beside it is the ghoul slice (scenario `ghoul-lab`).

## The question

Josh: *"how can this game become the same level of polish as something like Hollow Knight
even though it has a different art style"* — and, in the same breath, *"should we just keep
the game clean and make a really good basis instead of introducing much noise again?"*

## What polish is (and is not)

Polish is not more stuff. It is everything obeying the same hand:

1. **One hand.** Every asset obeys one set of rules (palette, density, how it takes light),
   so nothing looks borrowed. A second artist only helps if the rules are enforced by the
   pipeline, not by memory.
2. **Area identity.** You know where you are from one frame: colour, fog, particles, sound.
3. **Depth layering.** Something near the eye, the play space, and a suggestion of more
   world beyond it.
4. **Every light has a reason, every reason has a light.** Already our grammar; polish is
   applying it to the small things too (wax under a candle, soot over a sconce).
5. **Motion and sound married.** Anticipation and follow-through on every action; a sound
   for everything that moves.

## The plan, in order

### 1. The asset contract + import pipeline

For Josh's friend (a 3D modeller, offering props like candelabras) and for AI-generated
meshes (Tripo — the bone hand is the precedent, `scripts/blender/rig-bone-hand.py`).

- **Material slots by name** (`stone`, `iron`, `wood`, `wax`, `bone`, `cloth`, …): the
  importer replaces them with OUR materials, so an imported prop gets the lamp-reveal
  shader, the painted room colour, the stepped light, the shadow policy and the stone
  surface without the artist touching a shader. It cannot come out off-style.
- **Named empties for effects**: `flame_N` → our flame stacks + light-pool slots,
  `smoke_N`, `drip_N`. A candelabra arrives lit, by our light rules.
- **Conventions**: metres, Y up, −Z forward, pivot on the floor, a triangle budget, a
  faceted (not subdivided) look.
- **Tooling**: a checker that reads a GLB and says what is wrong, and a bench preview so the
  artist sees his piece in game lighting himself.
- **Creatures**: the same importer, plus binding to an archetype skeleton so the clip
  library, hurtboxes and telegraphs keep working. Eyes, embers and other signal parts stay
  code, on joints.
- **An asset guide** for the friend: one page with the conventions, the budget, the look,
  how to preview.

The hand file's own note names the debt this closes: an imported mesh "does not get the
lamp-reveal shader, the mood tint, the prop-class shadow policy — all keyed off ModelSpec."

### 2. The mood / region spec — the art bible as data

One record per region: fog colour, torch palette, stone warmth, wetness, particles, ambient
sound bed, the voice's temper. Pieces exist and are scattered (per-floor fog, mood-tinted
torches, grade presets, floor wetness, seep tint) — **not yet audited**. Unified, it is what
everyone authors against, and it gives each band of depths an identity.

### 3. A polish slice — Act 1 to final

One stretch of depths brought to finished quality end to end: the friend's props, the new
ghoul, a full region mood, near-eye dressing, the sound bed. This is how we learn what
polish costs, instead of spreading half-polish everywhere.

## The creative direction: clean, with a signature

Open — being thought through with Josh. The position so far:

**Keep it clean.** Josh's instinct is right, doubly so on a phone: at six inches, noise is
mush. Clean is not empty. What the floors lack is not decoration but **intent** — a room
with one focal thing (an altar, a hanging cage, a statue in a shaft of light) reads as a
place; a room with forty small props reads as clutter. Few, large, meaningful forms.

**The test for anything we add back** (archways, props, decoration): it must do at least
one of —
- give a silhouette or a focal point,
- carry a light or a signal,
- say something (who was here, what happened, what is coming).
Door frames and archways pass: they are the gates the veil hangs in.

**The signature.** The games that are "simple but wow" each commit to ONE rendering idea and
apply it totally (Return of the Obra Dinn's 1-bit dither, Limbo's silhouette and fog,
Signalis' graphic restraint, Iron Lung's almost-nothing). DELVE already has its candidate,
and nobody else has it: **darkness is a change of channel.** In the dark you lose form and
keep signal — eyes, flames, embers, runes through a veil — and your lamp is the only thing
that tells the truth. The veil, the signal layer, the lamp-reveal shader and the painted
room colour are all pieces of that one idea. Leaning into it everywhere is the move.

## References worth studying

| game | what to take |
| --- | --- |
| Return of the Obra Dinn | one radical rendering rule, applied without exception |
| Limbo / Inside | composition: every frame has one subject; fog layers for depth; sound |
| Signalis | low-poly + graphic restraint; colour used as a signal, rarely |
| Lunacid | PS1 fog and torchlight in first person — our nearest neighbour |
| Darkwood | limited vision as the horror; sound carries what you cannot see |
| Inscryption | darkness and one warm light as the whole stage |
| Iron Lung | how little needs to be on screen for dread |
| Shadow of the Colossus / Ico | emptiness and scale as features |
| Dark Souls | architecture as atmosphere; restraint; places that remember |
| Hollow Knight | area identity, layering, every action juiced and voiced |

## Mobile

The phone is an argument FOR this direction, not a constraint on it: bold shapes,
high-contrast light, few details, and a dithered, quantized image that already reads well
small. Every polish decision gets judged on the phone first.
