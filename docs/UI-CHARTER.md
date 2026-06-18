# DELVE UI Charter — one mobile-native HUD, the Grimoire identity

> **Folded into `docs/UI-SYSTEM.md`** (the master UI spec) — read that first. This
> charter's rules live on there; kept for the detailed mobile-native law below.

> Status: DESIGN CHARTER (2026-06-18). Supersedes nothing yet — this is the
> target the menu chrome is being reshaped toward. Current tokens live in
> `src/ui/theme.ts` ("carved from the deep"); this charter evolves them toward
> the **Grimoire** identity below, under a strict **mobile-native** rule set.
> Iterate in the UI bench (`snap ui-<specimen>`); A/B against current before
> committing.

## The one decision everything hangs on: ONE responsive HUD

Mobile-first, scaled UP to PC — never two HUDs.
- Design to the harder constraint (mobile: little space, touch, landscape).
- PC reuses the *same* layout, capped + centred, with pointer/keyboard as
  **enhancements** (hover states, shortcuts) — not a separate design.
- The pillar already says it: mobile is primary, desktop is debug.

## Mobile-native law (why it feels like the game, not "windows on a phone")

The "windows opening on a small screen" feeling comes from desktop-dialog habits.
Kill them:

1. **Full-bleed, not floating dialogs.** A menu fills the screen (or a full-width
   panel), edge-to-edge, themed as part of the world. No small centred box with a
   title bar, an OS-style ✕, and a drop shadow over a dim. The menu IS the screen.
2. **One screen at a time — no stacked modals.** This was the bug. A single
   navigation stack: opening a deeper view PUSHES (with a back affordance) or
   swaps via tabs — it never layers a second floating window over the first.
   *Never two sheets open at once.* (The satchel already does this: one tabbed
   GEAR/CHARACTER/CODEX menu.)
3. **Thumb zones own the actions.** Landscape-locked → thumbs rest at the
   **bottom-left and bottom-right corners**. Primary / confirm / back live there.
   The TOP is passive only (title, resource readouts). Never put the primary
   action top-right where no thumb reaches.
4. **Vertical chrome is the enemy.** Landscape is wide and SHORT. Don't spend a
   fat 60px header bar on a title — use a thin strip or fold the title into the
   content. Horizontal space is plentiful; use side rails / columns, not stacked
   bars.
5. **Diegetic framing.** Every menu is an in-world object (the dungeon's book, the
   fire, the deck), not an OS overlay. No title bars, no generic ✕ (a "close the
   book" gesture instead), no system-dialog metaphor.
6. **44px minimum touch targets**, generous spacing for fat fingers. Scales fine
   to a comfortable mouse target on PC.
7. **Progressive disclosure.** Show what's needed now; tap to reveal detail. One
   primary thing per screen. Don't cram a dashboard onto a phone.
8. **Direct manipulation** beats abstract buttons where possible — tap, swipe
   between tabs, drag (the cards). Feels native.

## Works on mobile / doesn't — the element list

**Use (works on mobile, scales to PC):**
- Full-screen / full-width panels; bottom-sheet for quick actions
- Bottom thumb-zone buttons; a consistent back corner
- Large tap targets (≥44px), big readable type
- Tabs / segmented controls; swipe between them
- A SINGLE vertical scroll list per screen
- Direct tap / drag on the content itself
- One clear primary action per screen

**Avoid (the "desktop window" tells):**
- Small centred dialog boxes with a title bar + ✕
- Multiple stacked modals / windows over windows
- Primary actions in the top corners (out of thumb reach)
- Hover tooltips / hover menus / right-click — **touch has no hover**
- Dense multi-column dashboards; tiny controls; tiny close ✕
- Fat header/footer bars that waste vertical space
- Anything requiring a precise pointer or keyboard to use

## Scaling one layout to PC (the responsive rules)

- Size to the viewport, not pixels: `clamp(min, vh/vw, max)` + `aspect-ratio` +
  `dvh` + `env(safe-area-inset-*)`. (Same approach as the card reading.)
- On PC: the full-bleed mobile panel becomes a large **centred page** with the
  dark world around it (a book held up to torchlight), capped by `max-width` /
  `max-height` so it never stretches across a 27″ monitor.
- **Enhancements, not layout changes**, for pointer/keyboard on PC: hover reveals,
  keyboard shortcuts, focus rings. The layout is identical.

## Header / space utilization (the specific ask)

- Header = a thin strip: the menu's NAME (diegetic, e.g. a chapter heading) +
  at most one passive status. No back button, no actions up there.
- Don't reserve empty bars "for balance" — every band of vertical space earns its
  place or it's gone. In landscape, ~16–24px of title strip, not 60.
- Resource readouts (gold, depth, HP) are passive glances → top edge, small.
- Actions → bottom thumb rails. Content → the big middle, full-bleed.

## Dialog vs standalone screen (the pattern that frees the space)

Three UI types — use the right one, don't default to a dialog:
- **Dialog** — centred box, dismissible, a ✕. For quick confirmations ONLY. This is
  what `createSheet` builds (centred, 12px edge gap, ~92vh cap, header band + ✕).
  Great for a settings panel; wrong for a primary moment — that frame *is* the
  dead space at the edges + the close-out band.
- **Standalone screen** — FULL-BLEED, owns the whole viewport, navigated into and
  out of. For primary destinations. Build it as a `position:fixed; inset:0` root
  registered straight with the screen-manager (`openScreen`/`closeScreen`), NOT via
  `createSheet`. Title hugs the top edge, the hero fills the middle, the primary
  action hugs the bottom (thumb zone). For a forced choice, **the exit is the
  action** (no ✕; system-back is the escape hatch).
- **Bottom sheet** — slides up, partial height. For contextual quick actions.

Navigate, don't "close windows": push a screen / go back (one at a time), never
stack floating windows. Reference implementation: **`src/ui/card-reading.ts`**
(the fate draw) — full-bleed, edge-anchored, no ✕, cards sized by a dual
height/width clamp so they fill but always fit three across.

## The Grimoire — visual identity (tokens)

The menus are pages of the dungeon's cursed book, the same printed-woodcut world
as the tarot deck (see docs/TAROT-CONCEPT.md). The bold move: **invert to light**
— black ink on aged cream paper. You read the grimoire BY torchlight; the dark is
the world, the page is the book.

- **Palette:** paper `#E7DEC8` · ink `#14110D` · blood `#A4231C` · tarnished gold
  `#9A7B3A` (sparse, the one "precious" note) · faded margin `#8A7B5E` · char
  edge `#1C140C` (where a page meets the dark world).
- **Type:** a heavy blackletter / woodcut DISPLAY for chapter titles + headings
  (used with restraint), a humanist serif for body/voice, a grotesque or mono for
  data (stats, numbers). (Self-host the display face for the PWA/offline.)
- **Layout:** a page with a woodcut ornament edge (reuse the card-frame tech),
  a drop-cap initial on the title, hairline rust rules, marginalia for hints.
- **Signature:** the **wax seal / ink stamp** is the primary action — pressing a
  button is pressing a seal into the page — and the **watching eye** (the
  card-back mark) recurs as the book's presence. Both already exist as assets.

The split with the in-world HUD: the menu CHROME goes Grimoire (paper); the live
combat HUD stays dark and answers to combat legibility (its own tokens in
`hud.ts`/`hud-design.ts`). Spend the boldness on the menus.
