# Alpha & Backend — the road to a public DELVE

A **living design thread** (started 2026-06-16). Companion to
`CLAUDE.md` (Phases 4 & 5) and `docs/HARBOR-AND-PROGRESSION.md`.
Sections are tagged **[DECIDED]**, **[LEANING]**, or **[OPEN]**.
When a section settles, it graduates into CLAUDE.md and we trim it here.

The thread started from one goal: get DELVE ready for a **public alpha**
— players enter a name, (eventually) hold an account, see a leaderboard,
and the game grows into the async-multiplayer + LLM phases it was
always architected toward.

---

## The decision [DECIDED]

> **DELVE is building toward a *living shared dungeon*, on
> SpacetimeDB, async-first.**

We are NOT building "a single-player game with a leaderboard bolted on."
We are building the world CLAUDE.md already describes — the voice in the
deep that has watched ten thousand delvers die, phantom NPCs, an
*attention meter that is literal* — and that world is **realtime
shared state**. We commit to the living version now so we only build the
trace layer once. It **stays async for a while** (you leave bloodstains,
I read them later); realtime presence flips on when we're ready, with no
migration, because async traces are a degenerate case of the live system.

CLAUDE.md's Phase 4 already names SpacetimeDB as the assumed substrate
and the event-log seam was built for it. This thread ratifies that and
records *why* and *how*.

### Why SpacetimeDB and not Supabase

We evaluated Supabase (Postgres + Auth + Edge Functions) as the
pragmatic async-only choice. It wins **if and only if** DELVE stays
async forever. Since we're committing to the living version, the
calculus flips:

| Capability | Why it matters for DELVE |
|---|---|
| **The commit log *is* the database** | DELVE is already event-sourced (`broadcast/event-bus` → `event-log`). SpacetimeDB's core is an ordered, persisted reducer log — our `GameEvent`s map onto reducer calls and the DB log becomes the canonical event store. Replay/time-travel are inherent, not built by us. |
| **Live subscriptions** | The marquee feature. Clients subscribe to a SQL query and get a **live-synced local view** pushed over a websocket, zero sync code. This is what makes phantoms, a live global death feed, and a world-wide attention meter *possible*. Supabase Realtime is coarse change-feeds, not game-state sync. |
| **Authoritative transactional reducers** | "You can't fake picking up this trace" is enforced server-side in a transaction, no RLS policy authoring. |
| **TypeScript client** | The SDK generates typed TS bindings from the module schema. The game client stays in-language. |

### What SpacetimeDB does NOT solve (carry these costs knowingly)

- **Reducers (server logic) are Rust / C#, not TS.** For async traces
  there's almost no server logic, so the cost is small now; it grows if
  we push real game rules server-side. Budget for a small Rust module.
- **The LLM proxy must live elsewhere.** Reducers are sandboxed WASM —
  they can't cleanly call Anthropic. Phase 5 needs a separate
  Worker / Edge Function **regardless of this choice** (see below).
- **Neither DB replaces replay anti-cheat.** Verifying a leaderboard run
  means re-running *our* game headlessly — that's our stepper, not the DB.
- **Ops maturity & self-host.** SpacetimeDB 2.0 (Feb 2026) is solid, but
  self-hosting is *us* running a stateful in-memory server. Maincloud
  (managed, serverless) is the default to avoid that.

---

## Auth [DECIDED]

SpacetimeDB has a **two-layer** auth model with very different effort at
each layer:

- **Anonymous identity — built in, ~free.** Every connection gets a
  stable cryptographic `Identity` + a private token the client persists
  (localStorage). That *is* the `playerId`. Our "choose your sign"
  name-entry screen maps perfectly: the Identity is the account, the
  entered name is a display-name column. **Launch the alpha on this.**
- **Real accounts (cross-device / email / OAuth) — deferrable.**
  SpacetimeDB derives identity from the `sub`+`iss` claims of any OIDC
  JWT, so it works with Auth0, Clerk, Google, GitHub, etc. **And there's
  now `SpacetimeAuth`** — a first-party *managed* OIDC provider built
  for SpacetimeDB, so we can offer named accounts **without standing up
  or hosting an external auth service.** This is the path when we want
  "log in on a new phone and keep your progress."

> **Governing rule: never gate the alpha behind login.** You claim a
> name and descend. The Identity persists silently. Account linking is
> an *upgrade you offer* (survive device loss), never a wall.

Caveat (true of any anon scheme): the anon token is per-device. Clear
storage or switch phones and it's gone — the cure is linking a real
account, which is exactly what the OIDC/SpacetimeAuth layer buys later.

---

## Cost model [DECIDED — revisit at traction]

SpacetimeDB Maincloud, energy-based serverless pricing (verified
2026-06-16):

- **Free tier:** 2,500 TeV/month (~3M reducer calls — real apps, not
  toy demos), boostable to 100,000 TeV via the Space Race referral.
- **Pro:** $25/month, 100,000 TeV. Team/Enterprise above.
- **Storage:** $1/GB/month (dropped from $10 in late 2025).

For an alpha we live on the free tier. The LLM proxy is metered
separately (Anthropic API + whatever host runs the Worker).

---

## The event-sourcing mapping [LEANING]

The seam already exists. `src/broadcast/event-log.ts` is a 2000-event
in-memory ring whose own comment says *"Phase 4 swaps the sink for a
SpacetimeDB writer; nothing else has to change."* Plan:

1. Keep the in-memory ring for the live HUD/voice (zero latency).
2. Add a **flush sink** that batches `LoggedEvent`s to a SpacetimeDB
   reducer on floor-transition and death (where we already checkpoint
   `delve:save`).
3. The reducer appends rows keyed by `(identity, run_seed, t)`. That
   table *is* the async-multiplayer substrate: bloodstains, corpses,
   epitaph context, ghost replays all read from it.

Run identity today is `SaveData.startedAt` (the seed). Server-side the
natural key is **`(identity, run_seed)`** — stable, and replay-able.

---

## Anti-cheat via deterministic replay [LEANING — has a dependency]

DELVE runs are deterministic from a seed (`seedRng(startedAt)`, floors
re-seeded per depth). A leaderboard run is `(seed, build_version,
event_log)` and our **headless stepper** (`window.__sim`, the
`sim-determinism` branch) can re-run it server-side to confirm the score.
Almost no indie game can verify a board this cheaply.

**Dependency:** full replay-verification needs the known determinism gap
closed (`Date.now` boot seed + spawn-time AI RNG → seed-at-start +
world snapshot/restore — the open item on the determinism thread). Until
then: **trust-but-verify** for the alpha — store submissions, show the
board, spot-check suspicious entries by replay. Don't block launch on it.

> **Governing rule: leaderboards are per-build / per-season.** Balance
> changes invalidate old scores by design. Stamp `build_version` on
> every submission so we're never defending scores from an old balance.

---

## Rollout order [LEANING]

Each step ships something Josh can feel on the phone (pillar: small
testable increments).

1. **Identity + name entry** — **[DONE 2026-06-16]** pure client change,
   no backend. "NAME YOURSELF" screen before the first descent
   (`src/ui/name-entry-screen.ts`), name + a lazily-minted interim
   `playerId` (local UUID) stored in `meta-state`. The UUID is the
   stand-in until SpacetimeDB's anon Identity takes over.
2. **SpacetimeDB module + connection** — **[DONE 2026-06-16]** the win:
   2.5 supports `--lang typescript` server modules, so **no Rust** — the
   module is TS (`server/spacetimedb/src/index.ts`). `death` table +
   `reportDeath` reducer, published to Maincloud as `delve`; generated TS
   client bindings (`src/net/module_bindings/`); connect-on-boot with a
   persisted anon Identity (`src/net/delve-net.ts`). Round-trip verified
   via CLI. SDK adds ~28 KB gzip to the bundle (measured, fine).
3. **Leaderboard (trust-but-verify)** — **[DONE 2026-06-16]** deepest-
   descent board DERIVED from the death table (every death records the
   depth reached → `getLeaderboard()` aggregates MAX(depth) per player),
   so no dedicated table/redeploy. `src/ui/leaderboard-screen.ts`, opened
   from the title's STANDINGS link; own row highlighted. *Next: per-build
   seasons (filter by buildVersion), end-screen rank line, and the
   replay-verification that upgrades "trust" to "verify".*
4. **Async traces (Phase 4)** — **[DONE 2026-06-16]** bloodstains shipped:
   `deathsAtDepth()` reads the death cache; `src/level/network-bloodstains.ts`
   places up to 3 distinct delvers per floor as loot-free fallen-delver
   corpses (reusing the corpse system the seam was built for). Floors are
   procgen per seed, so stored (x,z) is ignored — bodies snap to walkable
   cells in the current floor. Runs after the deterministic build so it
   can't desync buildRng. Epitaphs are in-world template text (no free
   text → no moderation surface). *Next trace types: messages, the live
   bloodstain-at-exact-spot for same-seed runs.*
5. **LLM proxy (Phase 5)** — separate Worker (Cloudflare Worker + AI
   Gateway, or a Supabase Edge Function). Cache on content hash (item id,
   death-context hash). **Hard spend cap + per-user rate limit from day
   one** — an open LLM endpoint is a billing catastrophe.
6. **Account linking** — SpacetimeAuth / OIDC, offered for cross-device.
7. **First realtime moment** — **[DONE 2026-06-16]** "the dungeon notices
   a death elsewhere." Live subscription on the `death` table → the voice
   in the deep remarks when another delver falls (`src/net/death-feed.ts`).
   Reporting wired into `triggerDeath`. Live + deployed; phone-verify
   pending.

---

## First realtime moment [DECIDED]

> **The first live feature is a "the dungeon notices a death elsewhere"
> feed — NOT phantoms.**

When a delver dies anywhere, the watching voice (`src/broadcast/`) may
remark on it in near-realtime: *"Someone just died on the eleventh
stair. You're doing better. For now."* Chosen because:

- **Cheapest possible subscription.** Deaths are append-only rows; the
  client subscribes to "recent deaths" and they're pushed. No position
  streaming, interpolation, or realtime physics — the hard parts of
  phantoms.
- **Feeds a seam we already built.** The voice in the deep is
  architected to react to events; a death three players away becomes a
  line it speaks. This is "the attention meter is literal" on day one.
- **The same rows are the async bloodstains (step 4).** Building the feed
  is the async trace layer with a subscription on top — one table, two
  features. Phantoms come *after* the subscription loop is proven.

---

## Hosting & deploy [DECIDED]

> **Static client stays on GitHub Pages for the alpha. Backend lives
> elsewhere. No migration needed.**

A static PWA + remote backend is the correct architecture, not a
compromise:

- **GitHub Pages** — the static client (unchanged, `base: '/brainstorm/'`).
- **SpacetimeDB Maincloud** — WSS endpoint; the client opens a secure
  websocket. Token-authed, not origin-gated — no CORS dance.
- **LLM proxy** — separate HTTPS Worker the client calls.

The client just holds backend URLs (baked in at build time). Hard rule:
page is HTTPS, so all backend calls are HTTPS/WSS (no mixed content).

**When we'd move (only two triggers):** (1) we need custom HTTP headers —
GH Pages can't set them; bites if we ever need COOP/COEP (cross-origin
isolation for `SharedArrayBuffer` / threaded WASM) or a real CSP for
public hardening; (2) GH Pages fair-use bandwidth (~100GB/mo) at scale.

**Target when we move: Cloudflare Pages** — because co-locating the
static site with the LLM Worker makes them **same-origin** (proxy
becomes `/api/*`, CORS gone, edge auth + rate-limit in front, `_headers`
for COOP/COEP/CSP). SpacetimeDB stays a separate WSS endpoint regardless.
Migration is ~1hr (same `dist/`), the real cost being a rework of the
`npm run live`/`ship` scripts (currently GH Actions → GH Pages).

---

## Pre-release checklist [OPEN — the unglamorous must-dos]

- **Crash / error telemetry** (Sentry-style, DEV-gated) — can't polish
  "feel on the phone" blind.
- **Cloud save / meta backup** once Identity exists — `localStorage`
  gets wiped; a tester losing meta-progression churns out.
- **LLM spend cap + rate limit** — non-negotiable before the endpoint is
  public.
- **Minimal privacy notice / ToS** — we now collect names + accounts.
- **Name moderation** — profanity filter on the entered name; template
  messages cover the rest.
- **Perf floor on real low-end Android** — we have the perf tooling; set
  a budget before strangers arrive.

---

## Open questions [OPEN]

- **Maincloud vs self-host** for the alpha — default Maincloud; revisit
  only if energy costs or data-residency push us.
- **Determinism branch** — land seed-at-start + snapshot/restore to
  unlock airtight replay anti-cheat (currently trust-but-verify).
- **Where the LLM proxy lives** — Cloudflare (edge cache + AI Gateway
  spend caps) vs Supabase Edge Function (one fewer vendor). Decide at
  Phase 5.
