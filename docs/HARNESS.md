# The Sim Harness

A way to run DELVE's simulation *without the renderer* — by hand, deterministically,
as fast as the CPU allows — so a bot can play it, a run can be recorded and
replayed, and any two runs can be compared frame-by-frame.

This is build-/debug-time tooling. The whole thing is behind `import.meta.env.DEV`
and dead-code-eliminated from the live build (`window.__sim` cannot exist in prod).

## Why it exists

Three payoffs, one substrate:

- **Bot / autoplay** — an automated adventurer you can steer, for QA and feel.
- **Balance** — run the sim at ~360× realtime, headless, across many seeds.
- **Async multiplayer (Phase 4) + trust-but-verify leaderboard** — a run *is* a
  tiny `(seed, tape)`; replay it to reproduce a death, a ghost, or to verify a
  submitted score server-side. See `docs/ALPHA-AND-BACKEND.md`.

## The two inversions

Everything rests on taking two things away from the browser:

1. **Own the clock.** The renderer's `requestAnimationFrame` loop no longer drives
   the sim. A fixed-step *stepper* calls the sim by hand, one fixed `1/60`s tick at
   a time. Freeze = don't call it. Step = call it once. Headless = call it as fast
   as possible. (The live rAF loop is still variable-dt today — see Roadmap.)
2. **Own the input.** All control — thumb, bot, replay — flows through ONE
   per-frame `Intent` on a source-agnostic **bus** (`src/harness/intent.ts`). The
   game reads intents, never the input device, so nothing can tell a bot from a
   thumb and no driver gets a power a thumb lacks.

A **run = `(seed, intentTape)`.** The world (positions, HP, AI, loot) is never
stored; it's recomputed by re-running the tape from the seed. To reach frame N,
re-run N steps (free at 360×). This is *replay-from-tape*, chosen over
world-snapshot because DELVE's state lives in scattered module singletons that
would be brittle to serialize. (Decided 2026-06-16.)

## Determinism — the rules

"Same seed → same run" holds only if every source of entropy is controlled:

- **Seeded RNG.** Outcome-affecting randomness draws from `gameRng()`
  (`src/engine/rng.ts`), never `Math.random()`. Cosmetic jitter (gore, shake,
  motes) *stays* on `Math.random` so it can't perturb the deterministic stream.
- **One seed, applied before spawn.** `resolveRunSeed()` in `main.ts` resolves
  `?seed=N` → `run.startedAt` → wall clock on *every* boot path, and seeds
  `gameRng` before any spawn (mob AI draws its schedule at spawn). `getRunSeed()`
  records whatever won, so even a wall-clock run is replayable.
- **No variable-dt window.** The live loop is variable-dt, so frames that run
  before the stepper takes over advance the world by a nondeterministic amount.
  `?simfreeze=1` (DEV) freezes the world *at spawn* so the stepper owns the clock
  from t=0. The permanent fix is a fixed-step live loop (Roadmap).

Canonical determinism check:
`?scenario=arena&seed=123&simfreeze=1`, two fresh loads → byte-identical traces.

## System tagging

`GameSystem` (`src/engine/loop.ts`) carries `kind: 'sim' | 'present'`, orthogonal
to `phase`:

- `phase` — runs while the world is paused? (`always` vs `unpaused`)
- `kind` — mutates SIM state (positions/HP/AI/cooldowns/combat) vs only PRESENTs
  it (render, camera, HUD, VFX, audio, lighting, culling). Absent = `present`
  (the safe default — an untagged system never advances a headless sim).

The stepper runs only `kind: 'sim'` systems. 15 are tagged sim; the other 33 are
present.

## `window.__sim` — API

Available in DEV. The console is the UI.

| Call | What it does |
| --- | --- |
| `systems` | Names of the sim systems the stepper runs, in order. |
| `freeze()` / `thaw()` / `frozen()` | Park / resume the live loop's world advance. |
| `step(n)` | Advance `n` fixed steps with neutral input. |
| `seed(s)` / `snap()` | Reseed `gameRng`; current deterministic digest. |
| `bench(n)` | Steps/sec with no render (the headless-speed number). |
| `drive(source, n)` | Hand-fly: `source(frame) => Partial<Intent>` for `n` steps. |
| `record(source, n)` | Same, but capture a `{ tape, frames, digest }`. |
| `replay(tapeJson, extra?)` | Feed a tape's intents back; reproduce the run. |
| `observe()` | Structured world read (the bot's eyes). |
| `runBot(n)` | Autonomous pilot: observe → decide → drive → record. Returns a tape. |
| `trace(tapeJson)` | Replay capturing the digest every frame — full trajectory. |
| `diff(a, b)` | First frame two trajectories disagree. |
| `verify(tapeJson, claimedDigest)` | Replay + check final state — the leaderboard call. |

`Intent` (`src/harness/intent.ts`): `{ move:[x,y], look:[dx,dy], attack:boolean,
dodge:[x,y]|null }`. `move` is camera-relative (−moveY is forward).

Note the single-load constraint: each fresh load runs ONE deterministic forward
sim from t=0. Repeated/branching ops (compare two traces, fork) need a *fresh
context* — a reload or the future headless-Node runner — not an in-page reset
(which would have to clear every scattered singleton perfectly).

## Files

- `src/engine/loop.ts` — `SystemKind`, the `kind` axis, `runSystems`.
- `src/engine/rng.ts` — seeded `gameRng` / `buildRng` streams.
- `src/harness/intent.ts` — the per-frame Intent + drive-by-wire bus.
- `src/harness/tape.ts` — `Tape`, recorder, (de)serialize.
- `src/harness/pilot.ts` — `decideIntent(obs)`, the reactive bot policy.
- `src/harness/observation.ts` — `buildObservation` (reused; pure reads).
- `src/debug/sim-stepper.ts` — the stepper + `window.__sim`.
- `src/main.ts` — `resolveRunSeed`, `?simfreeze`, stepper install.

Legacy `src/harness/{index,action,pause}.ts` still implement the *older* real-time
tick-BUDGET harness (`window.harness`, high-level Action verbs). It works but is
the thing the new spine is replacing; see Roadmap.

## Roadmap

Built & proven: RNG seal · `kind` tagging · headless fixed-step stepper ·
determinism (seed everywhere + freeze-at-spawn) · intent bus · tape record/replay
· headless autonomous bot · trace / diff / verify.

Next, roughly in order:

1. **Unify the surface** — one harness object; fold `__sim` and the legacy
   `window.harness` together.
2. **Retire the real-time budget model** — actions become fixed-step drives.
   Coupled to (3).
3. **Fixed-step live loop** — makes determinism permanent, retires `?simfreeze`.
   Feel-sensitive: phone-test before it ships.
4. **Branch / fork from a frozen frame** — counterfactual exploration (try
   dodge-left vs dodge-right from the same frame). Needs a fresh-context substrate.
5. **Headless-Node runner** — run tapes/bots with no browser. The clean substrate
   for (4) and for balance sweeps; gated on decoupling a few sim systems
   (`world-ui`, `player-stats`) from their DOM tendrils.

## Known gaps

- **Headless player melee deals no damage** (the blocker for combat balance
  sweeps). Enemy → player damage works under the stepper (it uses logical
  positions); player → enemy does NOT — across a full `spar` round the bot
  swings ~11 times at point-blank and no enemy loses HP, yet the enemies kill
  the bot. The swing's strike-window hit scan (`createCombatSystem` in
  `attack.ts`) keys off `weapon.isStriking`, a viewmodel swing-phase flag
  advanced by the `weapon` system. Hurtbox matrices are NOT the cause —
  `hurtbox.ts` calls `node.updateWorldMatrix` itself. Next: instrument whether
  `weapon.isStriking` actually opens under the fixed clock, vs the cone simply
  not catching the target. Until fixed, headless runs measure movement/AI/
  enemy-damage faithfully but not player damage output.
- **Bot has no exploration** — the reactive pilot only engages visible enemies;
  it can't navigate a real procgen floor to find them. Real descending runs need
  a smarter pilot (the legacy `bot.ts` has stairs-seeking to draw from).

## Scenarios for the harness

- `?scenario=arena` — 6 ringed enemies, `enemiesInvincible` (endless sparring).
  Good for movement/observe/feed; nothing dies.
- `?scenario=spar` — 3 close melee enemies, killable + hitting back. Intended for
  combat/balance runs once headless player melee lands. DEV-only.

Pair either with `&seed=N&simfreeze=1` for a deterministic, stepper-owned run.
