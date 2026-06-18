# Menu System (mobile-first)

> **See `docs/UI-SYSTEM.md`** (the master UI spec). The Sheet shell below is now
> the **dialog** type — one of five screen types; primary screens go full-bleed.

How every panel-style menu is built. **New menus MUST use the Sheet
shell** (`src/ui/menu-shell.ts`) — don't hand-roll a panel.

## Why

The game is **landscape-locked** (`index.html` rotate-gate), so on a phone
the viewport is **wide but SHORT**. Every historical menu bug was vertical:
content ran off the bottom, action buttons (EQUIP / spend / RISE AGAIN) got
pushed off-screen, scroll regions were bounded inconsistently (some `230px`,
some `92vh`, some not at all), a few panels couldn't be dismissed, and touch
targets were sub-44px.

## The Sheet (`createSheet`)

Three bands, so the short-viewport problem can't recur:

```
┌──────────────────────────┐
│ header  (title/tabs • ✕)  │  flex:0 — never scrolls away
├──────────────────────────┤
│ body  (the ONLY scroller) │  flex:1; min-height:0; overflow-y:auto
├──────────────────────────┤
│ footer   (fixed actions)  │  flex:0 — actions always reachable; auto-hides empty
└──────────────────────────┘
```

Baked-in rules (don't re-solve these):
- **Bounded height** via `dvh` (dodges the mobile-browser `vh` trap) minus
  `env(safe-area-inset-*)`; width clamps to the viewport minus side safe-area
  (landscape notches). Never under a notch, never taller than the screen.
- **One scroll region** (the body), correctly bounded → scrolling always works.
  Inline `overflow-y` also opts the body into touch `pan-y` (see the
  `[style*="overflow-y"]` rule in index.html).
- **Fixed footer** → primary actions never scroll off.
- **Consistent dismiss** — backdrop tap (screen-manager) + always-present ✕.
- Sits **on top of the screen-manager** (policy / backdrop / layer) — it
  doesn't replace it.

`menuButton(label, onClick, {primary, small})` — use for every actionable
control; enforces ≥44px (36px `small`) touch targets.

Keep the grimdark look (the shared tokens in `inventory-shared.ts`): this is
a **structural** system, not a reskin.

## The unified in-game menu

The satchel button opens ONE sheet with a tab row: **GEAR · CHARACTER ·
CODEX** (+ a ⚙ settings gear). Character is no longer buried behind
inventory→settings.

- `inventory-panel.ts` owns the tabbed sheet. GEAR = the four columns
  (stats|doll|bag|details). CHARACTER / CODEX render extracted content
  builders so their standalone entry points still work:
  - `character-screen.ts` → `buildCharacterContent(): {el, dispose}`
  - `codex-screen.ts` → `buildCodexContent(): el`
- Switch tabs → `renderTab()` swaps the body (disposing the character
  subscription). GEAR refreshes live on inventory/equipment/stat changes.

## Migration status

- ✅ menu-shell.ts (the Sheet + menuButton)
- ✅ character screen — on the shell + a GEAR/CHARACTER/CODEX **tab**
- ✅ codex — on the shell + a tab
- ✅ inventory/gear — the tabbed game-menu
- ⬜ settings — still its own panel (least broken; min(360,92vw)+88vh+scroll)
- ⬜ note-card / stash / patchlog — mostly fine already; migrate for consistency
- ⬜ start screen — full-screen layout (not a Sheet); needs its own
  scroll-bound + safe-area + touch-target pass
- end-screen / death-overlay — full-screen, intentionally minimal-dismiss

Full-screen layouts (start/end/death) aren't Sheets — but they should reuse
`menuButton` + the shared tokens and bound their content to `dvh` + safe-area.
