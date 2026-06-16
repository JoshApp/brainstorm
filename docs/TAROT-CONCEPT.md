# The Dungeon's Deck — tarot concept

> Status: ACTIVE EXPLORATION, not canon. Companion to
> docs/THE-DUNGEON-NOTICES.md (compass + "tarot IS the build"). This doc is the
> *identity* of the deck — what makes a dungeon's tarot unique, and how it
> stays varied without fracturing. The art pipeline that renders it lives in
> `src/art/` + `scripts/art*.ts` (see the atelier at `/art.html`).

## Premise — the deck is the dungeon's, not yours

The thing in the deep deals you fate and finds your reactions funny. A reading
is it *playing with you*, not a menu you shop. This is why the deck knows you:
your **Mark** weights it (a butcher draws butcher cards). The deck is a warped
mirror the dungeon holds up.

In-world card art + a card's "meaning" obey the Tone Bible: grimdark, terse,
cruel. The *dealing and the reversal commentary* are the **voice in the deep**
(`src/broadcast/`): mocking, amused, gloating. "The Sun. For you? How
optimistic. Reversed, then."

## Three pillars

### 1. The Reversal — duality is mechanical
Every card has an **Upright** and a **Reversed** face, and you don't fully
choose which. Your **Gaze** (how noticed/greedy you've played) tilts the
orientation. Upright Hollow Saint = a boon; Reversed = the same saint defiled,
a curse. This is real tarot (reversed = blocked/shadow/inverted), the dungeon's
cruelty, and Balatro-grade build depth — in one mechanic. "Even good cards mean
bad things" is literally the reversed state. The voice gloats on a reversal; a
**scar** (per THE-DUNGEON-NOTICES "high Gaze → a scar") is a forced-reversed major.

Visual: a reversed card is the same art **defiled** — inverted, ink bleeding
upward, the spot colour guttering to black or curdling to the "wrong" hue.

### 2. Light = exposure, never comfort
Per the game's lighting doctrine (uncommon light = something is happening / a
price), there is **no cozy suit**. The luminous cards (The Lantern, Mercy, a
Sun) are the **rarest and most ambivalent** — beautiful, tempting, and they
cost or expose you. A bright card in the dark is a *lure*. That ambivalence is
what tarot lives on.

### 3. Treatment unison, palette divergent — the anti-monotony rule
ONE treatment across the whole deck (the woodcut/ink register) so it reads as a
single cursed object. The **spot colour varies by DOMAIN** — the same
colour=meaning law the game already uses (Mark domains, torch tints):

| Domain        | Accent              | Feel                         |
| ------------- | ------------------- | ---------------------------- |
| Blood / Wrath | dried-blood crimson | hunger, violence             |
| Bone / Death  | cold bone-white     | finality (near-colourless)   |
| Greed / Rot   | tarnished gold / sickly green | hoarding, decay    |
| Mercy / Light | pale moonlight      | the lure (ominous good)      |
| Wonder/Arcane | reserved violet     | the vast, the unknowable     |

Plus weight: **Majors** = lush full illustrations (the build-defining Spread,
capped ~5); **Minors** = spare, iconographic, the common drip. Variety of hue
and density; unity of hand.

## Open questions (for iteration)
- Do reversed faces get their own generated art, or a shader/treatment over the
  upright art at runtime? (Cheaper + more dynamic if the latter.)
- How many domains ship v1? Is "Mercy/Light" one domain or split (Mercy vs
  Wonder)?
- Minor cards: generated illustration, or authored vector icons in the UI?
