# DELVE

Grimdark first-person dungeon crawler. Mobile browser. PWA-installable. Built with Vite + TypeScript + Three.js, no model files or texture pipeline — all geometry is code.

The design brief lives in [`CLAUDE.md`](./CLAUDE.md). Read that first.

## Run it

```bash
npm install
npm run dev
```

Vite prints a `http://192.168.x.x:5173` network URL. On your phone, same WiFi, open it.

## Phone install

Open the live build → Share → Add to Home Screen. You'll have a daily-iterable mobile game.

## Deploy

GitHub Pages, automatic on push.

- Workflow: `.github/workflows/deploy.yml`
- Live URL: `https://joshapp.github.io/brainstorm/`
- One-time UI step (already done): `Settings → Pages → Source: GitHub Actions`

## Tuning

All gameplay constants live in `src/config.ts`. Edit, save, hot-reload on the phone. That's the iteration loop.

## Debug URL flags

- `?scenario=<name>` — jump past the title into a posed world state (see `src/debug/scenarios.ts`)
- `?fakemeta=1` — seed meta progress for snapping the title with records
- `?fakesave=1` — seed a save so CONTINUE shows
- `?showEnd=1` / `?showCodex=1` / `?showStash=1` — snap the corresponding screen
- `?tutorial=1` — force the tutorial chamber regardless of run history

## Snap CLI

```bash
npm run snap <scenario> <viewport>
```

Headless Playwright screenshot to `/tmp/snap-<scenario>.png`. Viewports: `desktop`, `phone`, `phone-portrait`, `tablet`.
