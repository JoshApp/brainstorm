# DELVE UI System

> **The master UI spec.** Front-to-back, mobile-first, scaled to PC. Consolidates
> the old `UI-CHARTER.md` (rules) and `MENU-SYSTEM.md` (the Sheet model — now just
> one of five screen types). `VISUAL-LANGUAGE.md` still owns the *world*/reveal
> grammar; the type system lives in `src/ui/fonts.ts`.
>
> Built spec → foundation kit → migrate screens one at a time (each ships). Status
> 2026-06-18: spec drafted. Exemplars already live: the **fate draw**
> (`card-reading.ts`, a Deep full-bleed screen) and the **HUD**.

## 0. The one rule

**One responsive UI, mobile-first, scaled UP to PC.** Design to the harder
constraint (a phone, in landscape, with thumbs); PC reuses the *same* layout with
more breathing room + pointer/keyboard *enhancements*. Never a second HUD.

## 1. Two grounds, one language  (the decision everything hangs on)

The visual language is ONE. It renders on two **grounds**, chosen by context:

- **THE PAGE** — aged parchment, ink, woodcut frame. Where you **read & manage**:
  character, inventory, codex, settings, stash, merchant, item detail, patchlog.
  You are "in the dungeon's book."
- **THE DEEP** — near-black, forms revealed by coloured light (the reveal grammar
  in VISUAL-LANGUAGE.md). Where the dungeon **acts on you**: the fate draw, death,
  the bonfire ritual — and the live combat **HUD**.

Both share: the **type system** (Cinzel display / EB Garamond voice / Grenze
blackletter / system sans for data — `fonts.ts`), the **palette logic**, the
**motifs** (wax seal = commit, watching eye = the dungeon's attention, woodcut
ornament, carved corner ticks), and the **motion**. Same components, same tokens —
the ground changes.

Choosing: *reading or managing* → Page. *The dungeon acting / in-world play* →
Deep. (So "carved from the deep" becomes the Deep; the Grimoire becomes the Page.)

## 2. Screen taxonomy — five types

| Type | Ground | Use | Dismiss | Build |
|------|--------|-----|---------|-------|
| **HUD** | Deep | live combat readouts | n/a | `hud.ts` (own tokens, combat-legible) |
| **Standalone screen** (full-bleed) | Page or Deep | primary destinations | back / the action | `inset:0` root + `openScreen` |
| **Dialog** (centred box) | Page | quick confirm ONLY (abandon, quit) | ✕ / backdrop | `createSheet` |
| **Bottom sheet** | Page | contextual quick actions (item use, pickers) | swipe / tap-out | slide-up panel |
| **Toast / pop** | over all | the dungeon's voice (broadcast) | auto | `broadcast-pop` |

Default a primary moment to a **standalone screen**, not a dialog. The dialog frame
(edge gap, height cap, header + ✕) *is* wasted space — reserve it for true confirms.

## 3. Navigation

- **Push/pop, one screen at a time.** Opening a deeper view pushes (with a back) or
  swaps a tab — never a second floating window over the first.
- **The hub** is one tabbed standalone screen — the satchel/grimoire: GEAR ·
  CHARACTER · CODEX swap *within* it.
- **Back** is a consistent affordance (a fixed corner, + system back/Esc). A
  forced-choice screen (the fate draw) has **no ✕** — the action is the exit.
- The **screen-manager** owns it (`openScreen`/`closeScreen`, `hidesHud`/
  `dimsScene` policy, the shared backdrop). Don't hand-roll overlays.

## 4. Layout & responsive

- **Edge-anchored, thumb-zoned.** Passive title hugs the TOP edge; the hero fills
  the MIDDLE; the primary action hugs the BOTTOM (thumb reach). Back/close in a
  consistent corner. Never put the primary action top-right.
- **Full-bleed** for standalone screens — own the viewport, no timid centred box.
- **Size to the viewport:** `clamp(min, vh/vw, max)` + `aspect-ratio` + `dvh` +
  `env(safe-area-inset-*)`. Landscape is wide and SHORT → vertical chrome is the
  enemy (thin headers, no fat bars).
- **≥44px touch targets**, generous spacing. No hover-essential info (touch has no
  hover). One vertical scroll region per screen.

## 5. Component kit  (the foundation to build, in `src/ui/`)

One source of truth — extend `theme.ts` (tokens) + a kit module; every component
appears in a **bench gallery** (`ui-bench`, `delve ui <specimen>`).

- **Shells:** `pageScreen({title,...})` (Page full-bleed), `deepScreen({...})` (Deep
  full-bleed), `dialog()` (= today's `createSheet`), `bottomSheet()`.
- **Chrome:** title strip · bottom action bar · back affordance · tabs / segmented
  control.
- **Controls:** wax-**seal button** (the ONE primary) · ghost/secondary · danger ·
  list row · toggle · slider · stepper · detail panel.
- **Surfaces:** the parchment material + woodcut frame (Page); carved ticks +
  hairline rules (Deep); the card; the framed portrait/icon plate.
- **Motifs:** wax seal, watching eye (shared assets, `src/assets/`).

## 6. Tokens  (`theme.ts`, one place)

- **Colour — semantic, per ground:** `ink`/`paper` (Page), `void`/`ember-ground`
  (Deep); **amber** = active/torchlight, **ember** = the one primary action,
  **blood** = destructive, **gold** = precious (sparse), **fade** = dim.
- **Type — the 3 roles** (`fonts.ts`): TITLE Cinzel · VOICE EB Garamond · BOOK
  Grenze · DATA system sans.
- **Spacing scale** (4 / 8 / 12 / 16 / 24 / 36), minimal **radius**, **motion**
  (120 press · 180 select · 250 fade · 550 deal; eased), **elevation** (shadow
  steps). All named, no magic numbers in screens.

## 7. Motion & feedback

Screen in/out, deal/flip, select-lift, press-scale (0.97), claim/commit flourish,
haptics on commit. Orchestrated moments over scattered effects. **Respect
`prefers-reduced-motion`.**

## 8. PC scaling (one layout, enhanced)

- Full-bleed Deep screens stay full-bleed (the ritual fills the monitor).
- Full-bleed Page screens become a **centred, capped Page** (`max-width/height`)
  held in the dark — a book raised to torchlight — not stretched edge-to-edge.
- Add pointer/keyboard **enhancements**: hover reveals, shortcuts, focus rings.
  The layout itself never changes; never a second HUD.

## 9. Rollout (each step ships)

1. **This spec.**
2. **Foundation kit + bench gallery** — shells, tokens, the core controls.
3. **Migrate screens 1-by-1**, each to its ground:
   character/satchel hub (Page exemplar) → inventory → codex → settings →
   stash/merchant → death. (Fate draw = Deep exemplar, done. HUD = done.)
- Verify fit with `delve ui <specimen>` at every step; the gallery is the kit's
  living source of truth.

## 10. Relationship to other docs

- **Supersedes** `UI-CHARTER.md` (rules folded in here) and the Sheet-only model of
  `MENU-SYSTEM.md` (Sheet = the *dialog* type now).
- **Defers to** `VISUAL-LANGUAGE.md` for the world/reveal/lighting grammar and
  `fonts.ts` for the type system.
