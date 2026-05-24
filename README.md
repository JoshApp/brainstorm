# DELVE — Setup & Iteration Guide

This is the project skeleton for the grimdark mobile dungeon crawler. Read this first, then point Claude Code at `CLAUDE.md` to start building.

## What You're Getting

- Vite + TypeScript + Three.js skeleton
- Phase 1 starter scene (one dungeon room, torchlight, fog, basic mobile controls)
- PWA manifest so it installs to your phone
- Deployment guide for Cloudflare Pages (auto-deploys from git push)
- `CLAUDE.md` design brief — Claude Code's north star

## First-Time Setup (10 minutes)

### 1. Initialize and install

```bash
cd crawler-starter
npm install
```

### 2. Run locally with phone access

```bash
npm run dev
```

Vite will print a network URL like `http://192.168.0.X:5173`. On your phone, connected to the same WiFi, open that URL. You'll see the dungeon room.

For real-device testing, Vite shows a QR code if you add `--host` (already in the dev script).

### 3. Deploy to GitHub Pages

Workflow is already in `.github/workflows/deploy.yml`. One-time UI step:

1. Push the repo (any branch with the workflow file).
2. Go to `github.com/joshapp/brainstorm/settings/pages`.
3. Source: **"GitHub Actions"** (NOT "Deploy from a branch").
4. Done. Next push triggers a build (~1-2 min).
5. Live URL: `https://joshapp.github.io/brainstorm/`.

Open the URL on your phone. Share → Add to Home Screen. You now have a
daily-iterable mobile game.

### 4. Alternative deploys: Cloudflare Pages / Netlify / Vercel

All three work; faster deploys (~30s on Cloudflare) and per-branch previews are
the upside. Trade is a third-party account. Build command `npm run build`,
output dir `dist`, framework Vite. If you switch, drop the `base: '/brainstorm/'`
in `vite.config.ts` (those serve from the root).

## Working With Claude Code

### Starting a session

```bash
cd crawler-starter
claude
```

Claude Code will read `CLAUDE.md` automatically. That file defines:
- The design pillars
- The phased build order
- The visual style and tone
- The architecture principles

### Good session prompts

Use the **phase checklist** in `CLAUDE.md` as your task source. Examples:

- "Read CLAUDE.md. We're in Phase 2. Implement the first mob: capsule body, sphere head, basic AI that approaches the player and attacks when in range. Use src/config.ts for all tuning values."
- "The torchlight flicker feels too uniform. Make it more organic — irregular intervals, sometimes near-darkness for a second. Iterate until it feels dread-inducing."
- "Combat doesn't feel crunchy yet. Add hit-pause (80ms freeze on connecting hit), screen shake scaled to damage, and haptic feedback. The whole feel should change."

### Bad session prompts (avoid)

- "Build the whole game" → too vague, will produce bloat
- "Add the LLM layer" → out of phase order, will break later balance work
- "Make it look like X game" → too imprecise; reference the style guide in CLAUDE.md

### Iteration loop

1. Push current build to git → Cloudflare redeploys
2. Open URL on phone, play the new build
3. Note what feels wrong
4. New Claude Code session, specific fix prompts
5. Test locally on phone via network URL
6. Commit, push, deploy
7. Repeat

The whole loop is 5-10 minutes per change once set up. That's the addictive part for *you* — the game's not addictive yet, but iterating on it is.

## File Layout

```
crawler-starter/
├── CLAUDE.md              # Design brief — Claude Code reads this first
├── README.md              # This file
├── index.html             # Vite entry point
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   ├── manifest.json      # PWA manifest
│   └── icons/             # PWA icons (replace with custom later)
└── src/
    ├── main.ts            # Entry — bootstraps the scene
    ├── config.ts          # ALL tuning constants here
    ├── scene/
    │   ├── dungeon.ts     # Room geometry, lighting, fog
    │   └── torchlight.ts  # Flickering torch logic
    ├── controls/
    │   ├── input.ts       # Touch input handling
    │   └── camera.ts      # First-person camera + look
    ├── combat/            # (Phase 2 — empty for now)
    ├── mobs/              # (Phase 2 — empty for now)
    └── ui/                # (Phase 2 — empty for now)
```

## What's Already Built (Phase 1)

- Single dungeon room with stone walls, floor, ceiling
- Flickering torch in the center (real-time point light)
- Dense fog (visibility ~6m)
- First-person camera with touch joystick + swipe look
- PWA manifest
- Vite config with mobile network exposure

This is the *atmosphere foundation*. Open it on your phone. Stand in the room. Look around. Does it feel like a place you don't want to be? If yes, the foundation is right and we build combat on top. If no, we iterate on lighting/fog/palette until it does.

## Tuning Knobs in `src/config.ts`

These are the values you'll iterate on most. All in one file by design.

- `LIGHT_INTENSITY` — torch brightness
- `LIGHT_FLICKER_AMOUNT` — how much it varies
- `FOG_NEAR` / `FOG_FAR` — visibility distance
- `WALL_COLOR` / `FLOOR_COLOR` / `AMBIENT_COLOR` — palette
- `MOVE_SPEED` — player walk speed
- `LOOK_SENSITIVITY` — swipe-to-look responsiveness

Tweak, save, hot-reload, feel it on the phone.

## Notes

- This skeleton is intentionally minimal. The point is to ship something to your phone *today* and iterate from there.
- Combat phase (Phase 2) is where the real work happens. Budget most of your time there.
- Resist scope creep. The LLM layer is Phase 5 for a reason — it's the easiest part. Atmosphere and combat are the hard parts.
- If a session goes off-rails, end it and start fresh. CLAUDE.md re-grounds the next session.
